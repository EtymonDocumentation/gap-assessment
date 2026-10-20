import { TemplateError } from "./errors";
import { decodeXml } from "./xml";

/**
 * A small scanner that splits well-formed XML into its direct children *without* re-serialising them, so
 * the template's own markup is carried over byte for byte. Callers must have checked the XML parses first.
 */
export interface Chunk {
  /** Qualified name for elements (for example "w:p"); "" for text, comments and processing instructions. */
  name: string;
  xml: string;
}

/** Index of the ">" that closes the tag starting at `i`, skipping quoted attribute values. */
function tagEnd(xml: string, i: number): number {
  let q = "";
  for (let k = i + 1; k < xml.length; k++) {
    const c = xml[k]!;
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return k;
  }
  throw new TemplateError("A part of the template is not well-formed XML.");
}

function skipSpecial(xml: string, i: number): number {
  if (xml.startsWith("<!--", i)) {
    const j = xml.indexOf("-->", i + 4);
    return j < 0 ? xml.length : j + 3;
  }
  if (xml.startsWith("<![CDATA[", i)) {
    const j = xml.indexOf("]]>", i + 9);
    return j < 0 ? xml.length : j + 3;
  }
  if (xml.startsWith("<?", i)) {
    const j = xml.indexOf("?>", i + 2);
    return j < 0 ? xml.length : j + 2;
  }
  return -1;
}

function nameAt(xml: string, i: number): string {
  const m = /^<([^\s/>]+)/.exec(xml.slice(i, i + 120));
  return m ? m[1]! : "";
}

/** End index (exclusive) of the element that starts at `i`. */
function elementEnd(xml: string, i: number): number {
  let end = tagEnd(xml, i);
  if (xml[end - 1] === "/") return end + 1;
  let depth = 1;
  let k = end + 1;
  while (depth > 0) {
    const lt = xml.indexOf("<", k);
    if (lt < 0) throw new TemplateError("A part of the template is not well-formed XML.");
    const sp = skipSpecial(xml, lt);
    if (sp >= 0) {
      k = sp;
      continue;
    }
    end = tagEnd(xml, lt);
    if (xml[lt + 1] === "/") depth--;
    else if (xml[end - 1] !== "/") depth++;
    k = end + 1;
  }
  return k;
}

/** Splits `xml.slice(from, to)` into top-level chunks. */
export function scanChunks(xml: string, from = 0, to = xml.length): Chunk[] {
  const out: Chunk[] = [];
  let i = from;
  while (i < to) {
    if (xml[i] !== "<") {
      const j = xml.indexOf("<", i);
      const e = j < 0 || j > to ? to : j;
      out.push({ name: "", xml: xml.slice(i, e) });
      i = e;
      continue;
    }
    const sp = skipSpecial(xml, i);
    if (sp >= 0) {
      out.push({ name: "", xml: xml.slice(i, sp) });
      i = sp;
      continue;
    }
    const e = elementEnd(xml, i);
    out.push({ name: nameAt(xml, i), xml: xml.slice(i, e) });
    i = e;
  }
  return out;
}

/** Opening tag, children and closing tag of one element given as a string. */
export function splitElement(xml: string): { open: string; children: Chunk[]; close: string } {
  const end = tagEnd(xml, 0);
  if (xml[end - 1] === "/") return { open: xml, children: [], close: "" };
  const closeAt = xml.lastIndexOf("</");
  return { open: xml.slice(0, end + 1), children: scanChunks(xml, end + 1, closeAt), close: xml.slice(closeAt) };
}

export interface BodySplit {
  /** Everything up to and including the opening <w:body> tag. */
  head: string;
  /** Direct children of the body, in order, excluding the final sectPr. */
  children: Chunk[];
  /** The body's final <w:sectPr>, if there is one. */
  sectPr?: string;
  /** </w:body> and everything after it. */
  tail: string;
}

/** Splits word/document.xml into head, body children, final sectPr and tail. */
export function splitDocument(xml: string): BodySplit {
  const top = scanChunks(xml);
  const rootIdx = top.findIndex((c) => c.name !== "" && /(^|:)document$/.test(c.name));
  if (rootIdx < 0) throw new TemplateError("The template has no document body.");
  const root = top[rootIdx]!;
  const rootStart = top.slice(0, rootIdx).reduce((n, c) => n + c.xml.length, 0);
  const inner = splitElement(root.xml);
  const bodyIdx = inner.children.findIndex((c) => /(^|:)body$/.test(c.name));
  if (bodyIdx < 0) throw new TemplateError("The template has no document body.");
  const body = inner.children[bodyIdx]!;
  if (body.name !== "w:body") throw new TemplateError("The template uses an unusual XML prefix for Word elements, so it cannot be read. Open it in Word, save it again as a .docx, and upload that copy.");
  const beforeBody = xml.slice(0, rootStart) + inner.open + inner.children.slice(0, bodyIdx).map((c) => c.xml).join("");
  const afterBody = inner.children.slice(bodyIdx + 1).map((c) => c.xml).join("") + inner.close + xml.slice(rootStart + root.xml.length);
  const b = body.xml.endsWith("/>") ? { open: "<w:body>", children: [] as Chunk[], close: "</w:body>" } : splitElement(body.xml);
  const children = b.children.filter((c) => c.name !== "" || c.xml.trim() !== "");
  let sectPr: string | undefined;
  const last = children[children.length - 1];
  if (last && last.name === "w:sectPr") {
    sectPr = last.xml;
    children.pop();
  }
  return { head: beforeBody + b.open, children, sectPr, tail: b.close + afterBody };
}

/**
 * Splits a paragraph into its opening tag, its paragraph properties (balanced: a w:pPrChange holds a second w:pPr) and the rest
 * without the closing tag. Undefined for an empty element such as `<w:p/>`.
 */
export function splitParagraph(xml: string): { open: string; pPr: string; content: string } | undefined {
  const open = /^<w:p(?:\s[^>]*)?>/.exec(xml);
  if (!open || open[0].endsWith("/>")) return undefined;
  const rest = xml.slice(open[0].length);
  const end = rest.lastIndexOf("</w:p>");
  if (end < 0) return undefined;
  const inner = rest.slice(0, end);
  let pPrLen = 0;
  const lead = /^\s*/.exec(inner)![0].length;
  if (inner.startsWith("<w:pPr", lead)) {
    let depth = 0;
    const re = /<(\/?)w:pPr(?:\s[^>]*)?(\/?)>/g;
    re.lastIndex = lead;
    for (let m = re.exec(inner); m; m = re.exec(inner)) {
      if (m[1]) depth--;
      else if (!m[2]) depth++;
      if (depth === 0) {
        pPrLen = m.index + m[0].length;
        break;
      }
    }
  }
  return { open: open[0], pPr: inner.slice(0, pPrLen), content: inner.slice(pPrLen) };
}

export interface ParaInfo {
  styleId?: string;
  text: string;
  hasSectPr: boolean;
  outlineLvl?: number;
  numId?: string;
  ilvl?: string;
  hasDrawing: boolean;
}

/** Properties of a <w:p> chunk, read with patterns (the chunk is already known to be well-formed). */
export function paraInfo(xml: string): ParaInfo {
  const open = /^<w:p(?:\s[^>]*)?>/.exec(xml);
  const rest = open ? xml.slice(open[0].length) : xml;
  const pPrMatch = /^\s*(<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>)/.exec(rest);
  const pPr = pPrMatch ? pPrMatch[1]! : "";
  const val = (re: RegExp) => re.exec(pPr)?.[1];
  const ol = val(/<w:outlineLvl\s+w:val="(\d+)"/);
  const numPr = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1] ?? "";
  let text = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)) text += m[1] !== undefined ? decodeXml(m[1]) : "\t";
  return {
    styleId: val(/<w:pStyle\s+w:val="([^"]*)"/),
    text,
    hasSectPr: /<w:sectPr[\s>]/.test(pPr),
    outlineLvl: ol !== undefined ? Number(ol) : undefined,
    numId: /<w:numId\s+w:val="([^"]*)"/.exec(numPr)?.[1],
    ilvl: /<w:ilvl\s+w:val="([^"]*)"/.exec(numPr)?.[1],
    hasDrawing: /<w:drawing[\s>]|<w:pict[\s>]|<w:object[\s>]/.test(xml),
  };
}
