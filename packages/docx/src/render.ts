import type { DocModel } from "@gap/engine";
import type { TemplateRecord } from "@gap/process-model";
import { BUILTIN_TEMPLATE_VERSION } from "./version";
import { DOCUMENT_CLOSE, createBuiltin, documentOpen } from "./builtin";
import { TemplateError } from "./errors";
import { DocPackage } from "./docpkg";
import { finalisePackage, type FinaliseInput } from "./finalise";
import { builtinFrontXml } from "./front";
import { classifyBody, deriveSectPrs, pageFromSectPr, type BodyItem } from "./inspect";
import { FRONT_BLOCK_ID, FRONT_BLOCK_TITLE, mappingReport, toolBlocks } from "./mapping";
import { CT, Pkg, REL } from "./package";
import { splitDocument, splitParagraph, type BodySplit } from "./scan";
import { StyleTable, builtinStylesXml, parseNumbering } from "./styles";
import { fillTemplate, inspectTags, NOT_AVAILABLE } from "./templater";
import { sectionTagName } from "./tags";
import type { OutlineHeading, RenderDocxInput, RenderDocxResult, TemplateAnalysis, TemplateMapping } from "./types";
import { WriterCtx, bannerPara, frontXml, headingPara, notePara, para, sectionHeadingText, sectionXml, textRuns } from "./writer";
import { cleanXmlText, decodeXml, parseXml } from "./xml";

const OUT_OF_MAPPING_HEADING = "Additional content not mapped to a template heading";
const FLAG_TEXT = "[No content from the gap assessment tool is mapped to this heading. To be completed.]";

// ------------------------------------------------------------------ helpers on paragraph xml

/** A dropped paragraph that ended a section keeps its section properties, so the page layout does not change. */
function keepSectionBreak(xml: string): string {
  const p = splitParagraph(xml);
  return p ? `${p.open}${p.pPr}</w:p>` : "";
}

/** The text of the w:t elements of a part, one line per paragraph. */
export function textOfXml(xml: string): string {
  return xml
    .split("</w:p>")
    .map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] !== undefined ? decodeXml(m[1]) : "\t")).join(""),
    )
    .join("\n");
}

// ------------------------------------------------------------------ pieces shared by the modes

function finaliseInput(input: RenderDocxInput, record: TemplateRecord): FinaliseInput {
  return {
    doc: input.doc,
    mode: input.mode,
    templateName: record.name,
    templateVersion: record.version,
    templateSha256: record.sha256,
    generatedAt: input.generatedAt,
  };
}

/** What closes every document: a note for left-out content and the banner. */
function endMatter(ctx: WriterCtx, omitted: string[] = []): string {
  let out = "";
  if (omitted.length) out += notePara(`The following tool content was left out by choice: ${omitted.join("; ")}.`);
  return out + bannerPara(ctx.doc.banner);
}

function allSections(ctx: WriterCtx, firstOnNewPage = false): string {
  return ctx.doc.sections.map((s, i) => sectionXml(ctx, s, { headingLevel: 1, pageBreakBefore: firstOnNewPage && i === 0 })).join("");
}

/** The banner must be in the body of every output. A last check on what is about to be written. */
function assertBanner(documentXml: string, banner: string): void {
  if (!textOfXml(documentXml).includes(banner)) throw new Error("Internal error: the proof-of-concept banner is missing from the generated document.");
}

interface OpenedTemplate {
  dp: DocPackage;
  split: BodySplit;
  ctx: WriterCtx;
  numbering: string | undefined;
  styles: StyleTable;
}

/** Opens the (already sanitised) customer package and prepares the writer for its styles, numbering and page. */
function openTemplate(doc: DocModel, bytes: Uint8Array): OpenedTemplate {
  const dp = DocPackage.open(Pkg.fromBytes(bytes));
  const mainXml = dp.mainXml();
  parseXml(mainXml, dp.mainName);
  const split = splitDocument(mainXml);
  const stylesPart = dp.partOf(REL.styles);
  let stylesXml = stylesPart ? dp.pkg.text(stylesPart) : undefined;
  if (!stylesXml) {
    stylesXml = builtinStylesXml();
    dp.setPart("word/styles.xml", stylesXml, CT.styles, REL.styles);
  }
  const styles = StyleTable.parse(stylesXml);
  const numPart = dp.partOf(REL.numbering);
  const numbering = numPart ? dp.pkg.text(numPart) : undefined;
  const page = pageFromSectPr(split.sectPr);
  const ctx = new WriterCtx({ doc, styles, page, sectPrs: page.startsLandscape || !split.sectPr ? undefined : deriveSectPrs(split.sectPr), numberingXml: numbering });
  return { dp, split, ctx, numbering, styles };
}

function writeBody(dp: DocPackage, split: BodySplit, body: string, banner: string): void {
  const xml = split.head + body + (split.sectPr ?? "") + split.tail;
  assertBanner(xml, banner);
  parseXml(xml, "generated document");
  dp.setMainXml(xml);
}

// ------------------------------------------------------------------ built-in

function renderBuiltin(input: RenderDocxInput, record: TemplateRecord): Uint8Array {
  const { doc } = input;
  // Only the built-in default gets the upgraded look; the other kinds of Word document keep the customer's own look.
  const { dp, ctx, sectPr, numbering } = createBuiltin(doc, { upgraded: true });
  const body = builtinFrontXml(ctx) + allSections(ctx, true) + endMatter(ctx);
  const xml = documentOpen() + body + sectPr + DOCUMENT_CLOSE;
  assertBanner(xml, doc.banner);
  dp.setMainXml(xml);
  finalisePackage(dp, ctx, finaliseInput(input, record), numbering);
  return dp.commit();
}

// ------------------------------------------------------------------ their look

function renderTheirLook(input: RenderDocxInput, record: TemplateRecord, bytes: Uint8Array): Uint8Array {
  const { doc } = input;
  const { dp, split, ctx, numbering } = openTemplate(doc, bytes);
  writeBody(dp, split, frontXml(ctx, { banner: true }) + allSections(ctx) + endMatter(ctx), doc.banner);
  finalisePackage(dp, ctx, finaliseInput(input, record), numbering);
  return dp.commit();
}

// ------------------------------------------------------------------ mapped

interface Item {
  kind: "heading" | "para" | "table" | "other";
  xml: string;
  headingIndex?: number;
  /** A real paragraph, table or picture (not a section break or an empty paragraph). */
  content: boolean;
  sectionBreak: boolean;
}

function itemsOf(items: BodyItem[]): Item[] {
  return items.map((it) => ({
    kind: it.kind,
    xml: it.chunk.xml,
    headingIndex: it.headingIndex,
    sectionBreak: !!it.para?.hasSectPr,
    content: it.kind === "table" || (it.kind === "para" && !it.para!.hasSectPr && (it.para!.text.trim() !== "" || it.para!.hasDrawing)),
  }));
}

/** Content of one tool block. `level` is the heading level of the sections' own headings. */
function blockContent(ctx: WriterCtx, id: string, o: { sub: boolean; level: number; anchorIds?: number[] }): string {
  if (id === FRONT_BLOCK_ID) {
    return (o.sub ? headingPara(ctx, o.level, FRONT_BLOCK_TITLE, { noNumber: true }) : "") + frontXml(ctx, { banner: false });
  }
  const s = ctx.doc.sections.find((x) => x.id === id)!;
  if (o.sub) return sectionXml(ctx, s, { headingLevel: o.level, headingText: sectionHeadingText(s, false), subLevel: o.level + 1, noNumber: true });
  return sectionXml(ctx, s, { headingLevel: o.level - 1, noHeading: true, subLevel: o.level });
}

interface MappedResult {
  body: string;
  omitted: string[];
  warnings: string[];
}

/** The mapping algorithm, shared by Word and PDF templates (a PDF has only headings, no customer text). */
function assembleMapped(ctx: WriterCtx, items: Item[], outline: OutlineHeading[], mapping: TemplateMapping, pdf: boolean): MappedResult {
  const doc = ctx.doc;
  const warnings: string[] = [];
  const entries = new Map(mapping.headings.map((h) => [h.headingIndex, h]));
  const used = new Set<string>();
  const out: string[] = [bannerPara(doc.banner)];

  for (let i = 0; i < items.length; ) {
    const it = items[i]!;
    if (it.kind !== "heading") {
      out.push(it.xml);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < items.length && items[j]!.kind !== "heading") j++;
    const region = items.slice(i + 1, j);
    const heading = outline[it.headingIndex!]!;
    const entry = entries.get(heading.index);
    const ids = entry?.blocks ?? [];
    const existing = entry?.existing ?? "keep";
    const level = heading.level;
    const regionXml = region.map((r) => r.xml).join("");

    if (!ids.length) {
      out.push(it.xml, regionXml);
      if (existing === "flag" || pdf) {
        if (pdf && existing === "keep") warnings.push(`The PDF template has no text of its own to keep under "${heading.text}", so the heading is marked as still to be completed.`);
        out.push(para(textRuns(FLAG_TEXT, { b: true, highlight: "yellow" })));
      }
    } else {
      const sectionIds = ids.filter((id) => id !== FRONT_BLOCK_ID);
      const single = ids.length === 1;
      out.push(it.xml);
      if (existing === "keep") out.push(regionXml);
      else {
        // The customer's own text is replaced by choice; section breaks are kept so the page layout does not change.
        if (region.some((r) => r.content)) warnings.push(`The template's own text under "${heading.text}" was replaced by tool content, as chosen.`);
        for (const r of region) if (r.sectionBreak) out.push(keepSectionBreak(r.xml));
      }
      for (const id of ids) {
        used.add(id);
        out.push(blockContent(ctx, id, { sub: !single, level: level + 1 }));
      }
    }
    i = j;
  }

  const unmapped = toolBlocks(doc).filter((b) => !used.has(b.id));
  const omitted: string[] = [];
  if (unmapped.length) {
    if (mapping.unmappedBlocks === "append") {
      out.push(headingPara(ctx, 1, OUT_OF_MAPPING_HEADING, { noNumber: true }));
      for (const b of unmapped) out.push(blockContent(ctx, b.id, { sub: true, level: 2 }));
    } else {
      omitted.push(...unmapped.map((b) => b.title));
    }
  }
  return { body: out.join(""), omitted, warnings };
}

function checkMapping(analysis: TemplateAnalysis, mapping: TemplateMapping, doc: DocModel): void {
  const errors = mappingReport(analysis, mapping, doc).errors;
  if (errors.length) throw new TemplateError(`The heading mapping has problems and cannot be used yet: ${errors.join(" ")}`);
}

function renderMapped(input: RenderDocxInput, record: TemplateRecord, warnings: string[]): { bytes: Uint8Array; omitted: string[] } {
  const { doc } = input;
  const t = input.template!;
  if (!t.mapping) throw new TemplateError("Choose how the tool content maps to the template's headings before creating the document.");
  checkMapping(t.analysis, t.mapping, doc);
  const fin = finaliseInput(input, record);

  if (t.analysis.sourceFormat === "pdf") {
    const { dp, ctx, sectPr, numbering } = createBuiltin(doc);
    const items: Item[] = t.analysis.outline.map((h) => ({
      kind: "heading",
      xml: headingPara(ctx, h.level, h.number ? `${h.number} ${h.text}` : h.text, { noNumber: true }),
      headingIndex: h.index,
      content: false,
      sectionBreak: false,
    }));
    const r = assembleMapped(ctx, items, t.analysis.outline, t.mapping, true);
    warnings.push(...r.warnings);
    const xml = documentOpen() + r.body + endMatter(ctx, r.omitted) + sectPr + DOCUMENT_CLOSE;
    assertBanner(xml, doc.banner);
    dp.setMainXml(xml);
    finalisePackage(dp, ctx, fin, numbering);
    return { bytes: dp.commit(), omitted: r.omitted };
  }

  const { dp, split, ctx, numbering, styles } = openTemplate(doc, t.bytes);
  const { items, outline } = classifyBody(split, styles, parseNumbering(numbering));
  const r = assembleMapped(ctx, itemsOf(items), outline, t.mapping, false);
  warnings.push(...r.warnings);
  writeBody(dp, split, r.body + endMatter(ctx, r.omitted), doc.banner);
  finalisePackage(dp, ctx, fin, numbering);
  return { bytes: dp.commit(), omitted: r.omitted };
}

// ------------------------------------------------------------------ placeholder tags

/** A copy of the tag data with no prototype and no illegal XML characters, so a tag can only ever look up a plain value by name. */
function plainData(value: unknown): unknown {
  if (typeof value === "string") return cleanXmlText(value);
  if (Array.isArray(value)) return value.map(plainData);
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value)) o[k] = plainData(v);
    return o;
  }
  return value === undefined || value === null ? NOT_AVAILABLE : String(value);
}

function renderTags(input: RenderDocxInput, record: TemplateRecord, warnings: string[]): Uint8Array {
  const { doc } = input;
  const t = input.template!;
  const problems = inspectTags(t.bytes).errors;
  if (problems.length) throw new TemplateError(`The template has problems with its tags and cannot be filled in yet: ${problems.join(" ")}`);

  const opened = openTemplate(doc, t.bytes);
  const { ctx } = opened;
  if (!input.tagData) throw new TemplateError("Internal error: a tagged template needs the tag data.");
  const data = plainData(input.tagData) as Record<string, unknown>;
  // Raw tags are written on demand, so only the sections the template really uses are written.
  const lazy = (name: string, make: () => string) => {
    let cache: string | undefined;
    Object.defineProperty(data, name, { enumerable: true, get: () => (cache ??= make()) });
  };
  lazy("body", () => allSections(ctx));
  for (const s of doc.sections) lazy(sectionTagName(s.id), () => sectionXml(ctx, s, { headingLevel: 1 }));

  const filled = fillTemplate(t.bytes, data);
  const out = new Pkg();
  for (const name of Object.keys(filled.files)) {
    const f = filled.files[name]!;
    if (!f.dir) out.set(name, f.asUint8Array());
  }
  const dp = DocPackage.open(out);
  if (!dp.partOf(REL.styles)) dp.setPart("word/styles.xml", builtinStylesXml(), CT.styles, REL.styles);

  let pre = "";
  let post = "";
  if (!textOfXml(dp.mainXml()).includes(doc.banner)) {
    pre = bannerPara(doc.banner);
    warnings.push("The template has no {banner} tag, so the proof-of-concept banner was inserted at the top of the document.");
  }
  if (pre || post) {
    const split = splitDocument(dp.mainXml());
    const xml = split.head + pre + split.children.map((c) => c.xml).join("") + post + (split.sectPr ?? "") + split.tail;
    dp.setMainXml(xml);
  }
  assertBanner(dp.mainXml(), doc.banner);
  parseXml(dp.mainXml(), "generated document");
  if (!t.analysis.tags?.found.length) warnings.push("The template contains no tags, so nothing from the tool was filled in apart from the banner.");
  for (const u of t.analysis.tags?.unknown ?? []) warnings.push(`The template has a tag that is not in the tag reference: {${u}}. It shows ${NOT_AVAILABLE}.`);
  finalisePackage(dp, ctx, finaliseInput(input, record), opened.numbering);
  return dp.commit();
}

// ------------------------------------------------------------------ entry point

function recordFor(input: RenderDocxInput): TemplateRecord {
  if (input.mode === "builtin") return { mode: "builtin", name: "Built-in default", version: BUILTIN_TEMPLATE_VERSION };
  const t = input.template;
  if (!t) throw new TemplateError("Choose a template from the library for this kind of Word document.");
  return { mode: input.mode, name: t.name, version: t.version, sha256: t.sha256, ...(t.fileName ? { fileName: t.fileName } : {}) };
}

/** Creates the Word document. The proof-of-concept banner is in every result; the tool never decides a filing category. */
export async function renderDocx(input: RenderDocxInput): Promise<RenderDocxResult> {
  const record = recordFor(input);
  const warnings: string[] = [];
  const t = input.template;
  if (input.mode !== "builtin" && t) {
    if (t.analysis.sourceFormat === "pdf" && input.mode !== "mapped") {
      throw new TemplateError("A PDF template can only be used with \"Map to their headings\". Choose that, or upload a Word version of the template.");
    }
    if (!t.analysis.usableModes.includes(input.mode)) throw new TemplateError(`This template cannot be used for the chosen kind of Word document (${input.mode.replace("_", " ")}).`);
  }
  let bytes: Uint8Array;
  let omittedBlocks: string[] = [];
  switch (input.mode) {
    case "builtin":
      bytes = renderBuiltin(input, record);
      break;
    case "their_look":
      bytes = renderTheirLook(input, record, t!.bytes);
      break;
    case "mapped": {
      const r = renderMapped(input, record, warnings);
      bytes = r.bytes;
      omittedBlocks = r.omitted;
      break;
    }
    case "tags":
      bytes = renderTags(input, record, warnings);
      break;
    default:
      throw new TemplateError("Unknown kind of Word document.");
  }
  if (t) for (const w of t.analysis.warnings) if (!warnings.includes(w)) warnings.push(w);
  return { bytes, templateRecord: record, warnings, omittedBlocks };
}
