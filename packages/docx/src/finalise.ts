import type { DocModel } from "@gap/engine";
import { documentFingerprint } from "@gap/engine";
import type { DocPackage } from "./docpkg";
import { CT, REL, resolveTarget } from "./package";
import type { TemplateMode } from "./types";
import { W_NS, XML_DECL, attrByLocal, childElements, esc, localName, parseXml, textOf } from "./xml";
import { restoreFirstPageHeader } from "./inspect";
import type { WriterCtx } from "./writer";

export const CREATOR = "Gap Assessment Generator (proof of concept)";
const FALLBACK_DATE = "2000-01-01T00:00:00Z";

export interface FinaliseInput {
  doc: DocModel;
  mode: TemplateMode;
  templateName: string;
  templateVersion: string;
  templateSha256?: string;
  generatedAt: string;
}

/** W3CDTF timestamp without milliseconds; a fixed date when the input is not a date (the output must not depend on the clock). */
export function w3cDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? FALLBACK_DATE : d.toISOString().slice(0, 19) + "Z";
}

/** "questions 1.0.0; rules 1.0.0; catalog 1.0.0" from the References table of the document. */
export function contentVersionsText(doc: DocModel): string {
  const refs = doc.sections.find((s) => s.id === "references");
  const table = refs?.blocks.find((b) => b.type === "table");
  if (!table || table.type !== "table") return "not recorded";
  const pick = (name: string, label: string) => {
    const row = table.rows.find((r) => r[0] === name);
    return row ? `${label} ${row[3] ?? ""}`.trim() : "";
  };
  return [pick("Question bank", "questions"), pick("Comparison rules", "rules"), pick("Catalog", "catalog")].filter(Boolean).join("; ") || "not recorded";
}

function metaValue(doc: DocModel, label: string): string {
  return doc.meta.find(([k]) => k === label)?.[1] ?? "";
}

// ------------------------------------------------------------------ document properties

function coreXml(doc: DocModel, generatedAt: string): string {
  const when = w3cDate(generatedAt);
  return (
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(doc.title)}</dc:title><dc:creator>${esc(CREATOR)}</dc:creator><cp:lastModifiedBy>${esc(CREATOR)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`
  );
}

function appXml(): string {
  return `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(CREATOR)}</Application></Properties>`;
}

const VT_TYPES = new Set(["lpwstr", "lpstr", "i4", "i2", "i8", "r8", "bool", "filetime", "date"]);

/** Simple properties from an existing custom.xml (the customer's own), as [name, type, text]. Anything else is dropped. */
function existingCustom(xml: string | undefined): [string, string, string][] {
  if (!xml) return [];
  try {
    const root = parseXml(xml, "docProps/custom.xml").documentElement!;
    const out: [string, string, string][] = [];
    for (const p of childElements(root)) {
      if (localName(p) !== "property") continue;
      const name = attrByLocal(p, "name");
      const v = childElements(p)[0];
      if (!name || !v || !VT_TYPES.has(localName(v))) continue;
      out.push([name, localName(v), textOf(v)]);
    }
    return out;
  } catch {
    return [];
  }
}

function customXml(own: [string, string][], existing: [string, string, string][]): string {
  const ownNames = new Set(own.map(([n]) => n));
  const all: [string, string, string][] = [...existing.filter(([n]) => !ownNames.has(n)), ...own.map(([n, v]) => [n, "lpwstr", v] as [string, string, string])];
  const props = all
    .slice(0, 200)
    .map(([name, type, text], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(name)}"><vt:${type}>${esc(text)}</vt:${type}></property>`)
    .join("");
  return `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props}</Properties>`;
}

function rootPartFor(dp: DocPackage, type: string, fallback: string): string {
  const r = dp.rootRels.find((x) => x.type === type && !x.external);
  return r ? resolveTarget("x", r.target) : fallback;
}

/** Writes docProps/core.xml, app.xml and custom.xml (replacing the template's own; the creator is never a person). */
export function writeDocProps(dp: DocPackage, input: FinaliseInput): void {
  const { doc } = input;
  const own: [string, string][] = [
    ["templateMode", input.mode],
    ["templateName", input.templateName],
    ["templateVersion", input.templateVersion],
    ["templateSha256", input.templateSha256 ?? "not applicable (built-in template)"],
    ["documentFingerprint", documentFingerprint(doc)],
    ["contentVersions", contentVersionsText(doc)],
  ];
  const corePart = rootPartFor(dp, REL.coreProps, "docProps/core.xml");
  const extPart = rootPartFor(dp, REL.extProps, "docProps/app.xml");
  const customPart = rootPartFor(dp, REL.customProps, "docProps/custom.xml");
  const existing = existingCustom(dp.pkg.text(customPart));
  dp.pkg.set(corePart, coreXml(doc, input.generatedAt));
  dp.pkg.set(extPart, appXml());
  dp.pkg.set(customPart, customXml(own, existing));
  dp.ct.overrides.set(corePart, CT.core);
  dp.ct.overrides.set(extPart, CT.ext);
  dp.ct.overrides.set(customPart, CT.custom);
  dp.ensureRootRel(REL.coreProps, corePart);
  dp.ensureRootRel(REL.extProps, extPart);
  dp.ensureRootRel(REL.customProps, customPart);
  // A thumbnail shows the customer's own first page; it is not ours.
  for (const n of dp.pkg.names()) if (/^docProps\/thumbnail\./i.test(n)) dp.removePart(n);
}

// ------------------------------------------------------------------ styles, numbering

/** Writes everything the writer context collected: added styles, extended numbering, document properties. */
export function finalisePackage(dp: DocPackage, ctx: WriterCtx, input: FinaliseInput, originalNumbering: string | undefined): void {
  // The sections the tool adds for wide tables must not drop the template's first-page-only header (see restoreFirstPageHeader).
  const main = dp.mainXml();
  const restored = restoreFirstPageHeader(main, ctx.sectPrs);
  if (restored !== main) dp.setMainXml(restored);
  const stylesPart = dp.partOf(REL.styles) ?? "word/styles.xml";
  if (ctx.addedStyles.length) {
    const xml = dp.pkg.text(stylesPart);
    if (xml && xml.includes("</w:styles>")) {
      const at = xml.lastIndexOf("</w:styles>");
      dp.setPart(stylesPart, xml.slice(0, at) + ctx.addedStyles.join("") + xml.slice(at), CT.styles, REL.styles);
    } else {
      dp.setPart(stylesPart, `${XML_DECL}<w:styles xmlns:w="${W_NS}">${ctx.addedStyles.join("")}</w:styles>`, CT.styles, REL.styles);
    }
  }
  if (ctx.numberingXml !== undefined && ctx.numberingXml !== originalNumbering) {
    dp.setPart(dp.partOf(REL.numbering) ?? "word/numbering.xml", ctx.numberingXml, CT.numbering, REL.numbering);
  }
  // Pictures of the figures: the parts, their relationships and the png content type.
  if (ctx.media.length) {
    for (const m of ctx.media) {
      dp.pkg.set(m.part, m.bytes);
      dp.mainRels.push({ id: m.relId, type: REL.image, target: m.part.replace(/^word\//, ""), external: false });
    }
    if (ctx.media.some((m) => m.part.endsWith(".png")) && !dp.ct.defaults.has("png")) dp.ct.defaults.set("png", CT.png);
    if (ctx.media.some((m) => m.part.endsWith(".jpg")) && !dp.ct.defaults.has("jpg")) dp.ct.defaults.set("jpg", CT.jpeg);
  }
  // The tool writes no Word comments (reviewer comments were removed in schema 1.10.0); a comments part is never carried over.
  dp.removePart(dp.partOf(REL.comments) ?? "word/comments.xml");
  writeDocProps(dp, input);
}
