/// <reference types="node" />
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";

/**
 * A strict check that a .docx is a well-formed package, close to what Word does before it opens a file without a repair prompt.
 * It throws (with a plain message) on the first thing that is wrong.
 */

export interface StrictResult {
  zip: PizZip;
  names: string[];
  xml: Map<string, Document>;
  text(name: string): string;
}

const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function parseStrict(name: string, text: string): Document {
  const problems: string[] = [];
  const parser = new DOMParser({
    onError: (level, msg) => problems.push(`${level}: ${msg}`),
  });
  const doc = parser.parseFromString(text, "text/xml") as unknown as Document;
  if (problems.length) throw new Error(`${name} is not well-formed XML: ${problems.slice(0, 3).join(" | ")}`);
  if (!doc || !doc.documentElement) throw new Error(`${name} has no root element`);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`${name} contains a DOCTYPE or ENTITY`);
  // Characters that are not allowed in XML 1.0.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(text)) throw new Error(`${name} contains a character that XML does not allow`);
  return doc;
}

function all(doc: Document | Element, tag: string, ns?: string): Element[] {
  const list = ns ? doc.getElementsByTagNameNS(ns, tag) : doc.getElementsByTagName(tag);
  return Array.from({ length: list.length }, (_, i) => list.item(i) as Element);
}

function resolveTarget(partName: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = partName.includes("/") ? partName.slice(0, partName.lastIndexOf("/") + 1) : "";
  const parts = (base + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

const attr = (e: Element, local: string): string | null => {
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes.item(i)!;
    if (a.localName === local || a.name === local) return a.value;
  }
  return null;
};

export function checkPackage(bytes: Uint8Array): StrictResult {
  const zip = new PizZip(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error(`duplicate part names: ${dup.join(", ")}`);
  if (names[0] !== "[Content_Types].xml") throw new Error(`[Content_Types].xml must be the first entry, found ${names[0]}`);

  const xml = new Map<string, Document>();
  for (const n of names) {
    if (/\.(xml|rels)$/i.test(n)) xml.set(n, parseStrict(n, zip.files[n]!.asText()));
  }

  // Content types.
  const ct = xml.get("[Content_Types].xml")!;
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const d of all(ct, "Default", NS_CT)) defaults.set(attr(d, "Extension")!.toLowerCase(), attr(d, "ContentType")!);
  for (const o of all(ct, "Override", NS_CT)) {
    const part = attr(o, "PartName")!;
    if (!part.startsWith("/")) throw new Error(`Override PartName ${part} must start with /`);
    if (overrides.has(part)) throw new Error(`duplicate Override for ${part}`);
    overrides.set(part, attr(o, "ContentType")!);
  }
  for (const part of overrides.keys()) if (!zip.files[part.slice(1)]) throw new Error(`Override for a part that does not exist: ${part}`);
  for (const n of names) {
    if (n === "[Content_Types].xml") continue;
    const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "";
    if (!overrides.has("/" + n) && !defaults.has(ext)) throw new Error(`part ${n} has no content type`);
  }
  if (!defaults.has("rels") || !defaults.has("xml")) throw new Error("Default entries for rels and xml are required");
  for (const [n, doc] of xml) {
    if (n === "[Content_Types].xml" || n.endsWith(".rels")) continue;
    if (!overrides.has("/" + n) && defaults.get("xml") !== "application/xml" && !defaults.has(n.slice(n.lastIndexOf(".") + 1))) throw new Error(`xml part ${n} has no content type`);
    void doc;
  }

  // Relationships.
  for (const [n, doc] of xml) {
    if (!n.endsWith(".rels")) continue;
    const owner = n === "_rels/.rels" ? "" : n.replace(/_rels\/([^/]+)\.rels$/, "$1").replace(/^([^/]*)$/, "$1");
    const ownerPath = n === "_rels/.rels" ? "" : n.slice(0, n.indexOf("_rels/")) + n.slice(n.lastIndexOf("/") + 1, -5);
    void owner;
    if (ownerPath && !zip.files[ownerPath]) throw new Error(`${n} belongs to ${ownerPath}, which does not exist`);
    const ids = new Set<string>();
    for (const r of all(doc, "Relationship", NS_REL)) {
      const id = attr(r, "Id")!;
      if (ids.has(id)) throw new Error(`${n}: duplicate relationship id ${id}`);
      ids.add(id);
      if (attr(r, "TargetMode") === "External") continue;
      const target = resolveTarget(ownerPath ? ownerPath : "x", attr(r, "Target")!);
      if (!zip.files[target]) throw new Error(`${n}: relationship ${id} points to a missing part ${target}`);
    }
  }
  if (!zip.files["_rels/.rels"]) throw new Error("missing _rels/.rels");

  return { zip, names, xml, text: (name) => zip.files[name]!.asText() };
}

/** Checks specific to word/document.xml (and headers, footers) that Word is strict about. */
export function checkWordParts(res: StrictResult): void {
  const docRelIds = new Set<string>();
  const relDoc = res.xml.get("word/_rels/document.xml.rels");
  if (relDoc) for (const r of all(relDoc, "Relationship", NS_REL)) docRelIds.add(attr(r, "Id")!);

  const main = res.xml.get("word/document.xml");
  if (!main) throw new Error("no word/document.xml");
  const body = all(main, "body", NS_W)[0];
  if (!body) throw new Error("document has no body");
  const kids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes.item(i)).filter((n) => n.nodeType === 1) as Element[];
  const last = kids[kids.length - 1];
  if (!last || last.localName !== "sectPr") throw new Error("the last child of w:body must be w:sectPr");
  if (kids.filter((k) => k.localName === "sectPr").length !== 1) throw new Error("w:body must have exactly one direct sectPr");

  for (const name of ["word/document.xml", ...res.names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))]) {
    const doc = res.xml.get(name)!;
    // Every table cell ends in a paragraph, every table has a grid.
    for (const tc of all(doc, "tc", NS_W)) {
      const ps = Array.from({ length: tc.childNodes.length }, (_, i) => tc.childNodes.item(i)).filter((n) => n.nodeType === 1) as Element[];
      if (!ps.length || ps[ps.length - 1]!.localName !== "p") throw new Error(`${name}: a w:tc does not end with a w:p`);
    }
    for (const tbl of all(doc, "tbl", NS_W)) {
      if (!Array.from({ length: tbl.childNodes.length }, (_, i) => tbl.childNodes.item(i)).some((n) => (n as Element).localName === "tblGrid")) throw new Error(`${name}: a w:tbl has no w:tblGrid`);
      if (!all(tbl, "tr", NS_W).length) throw new Error(`${name}: a w:tbl has no rows`);
    }
    // r:id / r:embed references resolve against the part's own rels.
    const partRels = new Set<string>(name === "word/document.xml" ? docRelIds : []);
    const rp = res.xml.get(name.replace("word/", "word/_rels/") + ".rels");
    if (name !== "word/document.xml" && rp) for (const r of all(rp, "Relationship", NS_REL)) partRels.add(attr(r, "Id")!);
    const walk = (n: Node): void => {
      if (n.nodeType !== 1) return;
      const e = n as Element;
      for (let i = 0; i < e.attributes.length; i++) {
        const a = e.attributes.item(i)!;
        if (a.namespaceURI === "http://schemas.openxmlformats.org/officeDocument/2006/relationships" && !partRels.has(a.value)) throw new Error(`${name}: r:${a.localName}="${a.value}" has no relationship`);
      }
      for (let c = e.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(doc.documentElement);

    // Fields are balanced: begin / separate / end.
    let depth = 0;
    for (const fc of all(doc, "fldChar", NS_W)) {
      const t = attr(fc, "fldCharType");
      if (t === "begin") depth++;
      else if (t === "end") depth--;
      if (depth < 0) throw new Error(`${name}: a field ends before it begins`);
    }
    if (depth !== 0) throw new Error(`${name}: unbalanced complex field`);
  }

  // Unique ids: bookmarks, drawing docPr, comment ids with matching ranges and references.
  const bm = all(main, "bookmarkStart", NS_W).map((b) => attr(b, "id"));
  if (new Set(bm).size !== bm.length) throw new Error("duplicate bookmark ids");
  const bmEnd = all(main, "bookmarkEnd", NS_W).map((b) => attr(b, "id"));
  if ([...bm].sort().join() !== [...bmEnd].sort().join()) throw new Error("bookmark start/end do not match");
  const docPr = all(main, "docPr").map((d) => attr(d, "id"));
  if (new Set(docPr).size !== docPr.length) throw new Error("duplicate drawing ids (docPr)");

  const starts = all(main, "commentRangeStart", NS_W).map((e) => attr(e, "id")!);
  const ends = all(main, "commentRangeEnd", NS_W).map((e) => attr(e, "id")!);
  const refs = all(main, "commentReference", NS_W).map((e) => attr(e, "id")!);
  const norm = (a: string[]) => [...a].sort().join(",");
  if (norm(starts) !== norm(ends) || norm(starts) !== norm(refs)) throw new Error(`comment ranges do not match (start ${norm(starts)}, end ${norm(ends)}, ref ${norm(refs)})`);
  if (new Set(starts).size !== starts.length) throw new Error("duplicate comment ids in the body");
  const cx = res.xml.get("word/comments.xml");
  if (starts.length && !cx) throw new Error("comments are anchored but there is no comments.xml");
  if (cx) {
    const defined = all(cx, "comment", NS_W).map((c) => attr(c, "id")!);
    if (new Set(defined).size !== defined.length) throw new Error("duplicate ids in comments.xml");
    for (const id of starts) if (!defined.includes(id)) throw new Error(`comment ${id} is anchored but not defined`);
    for (const id of defined) if (!starts.includes(id)) throw new Error(`comment ${id} is defined but not anchored`);
  }
}

/** Full check: package structure plus Word rules. */
export function strictDocx(bytes: Uint8Array): StrictResult {
  const res = checkPackage(bytes);
  checkWordParts(res);
  return res;
}

/** Plain text of a part: paragraphs joined by newlines. */
export function plainText(res: StrictResult, name = "word/document.xml"): string {
  const doc = res.xml.get(name);
  if (!doc) return "";
  return all(doc, "p", NS_W)
    .map((p) =>
      all(p, "t", NS_W)
        .map((t) => t.textContent ?? "")
        .join(""),
    )
    .join("\n");
}

export function countElements(res: StrictResult, local: string, name = "word/document.xml"): number {
  const doc = res.xml.get(name);
  return doc ? all(doc, local, NS_W).length : 0;
}

export function customProps(res: StrictResult): Record<string, string> {
  const doc = res.xml.get("docProps/custom.xml");
  const out: Record<string, string> = {};
  if (!doc) return out;
  for (const p of all(doc, "property")) out[attr(p, "name")!] = p.textContent ?? "";
  return out;
}
