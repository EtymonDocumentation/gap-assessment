import { TemplateError } from "./errors";
import { ACCENT, MUTED_HEADING } from "./palette";
import { W_NS, XML_DECL, attrByLocal, childElements, esc, firstChildByLocal, localName, parseXml } from "./xml";

// ------------------------------------------------------------------ reading a styles part

export interface StyleInfo {
  id: string;
  type: string;
  /** The style's name as stored in the file. Built-in names are stored in English ("heading 1") whatever the Word language. */
  name: string;
  basedOn?: string;
  isDefault: boolean;
  numId?: string;
  ilvl?: string;
  outlineLvl?: number;
  /** Font size in half-points set by the style itself. */
  sz?: number;
}

/** Style lookup. Everything is found by name, never by style id (ids are localised, for example "berschrift1"). */
export class StyleTable {
  list: StyleInfo[] = [];
  /** Font size in half-points from the document defaults (Word's own default is 10 pt when none is given). */
  defaultSz = 20;

  static parse(xml: string): StyleTable {
    const t = new StyleTable();
    const root = parseXml(xml, "word/styles.xml").documentElement!;
    const dd = firstChildByLocal(root, "docDefaults");
    const ddSz = dd && firstChildByLocal(dd, "rPrDefault") && firstChildByLocal(firstChildByLocal(dd, "rPrDefault")!, "rPr") && firstChildByLocal(firstChildByLocal(firstChildByLocal(dd, "rPrDefault")!, "rPr")!, "sz");
    const ddVal = ddSz ? Number(attrByLocal(ddSz, "val")) : NaN;
    if (Number.isFinite(ddVal) && ddVal >= 12 && ddVal <= 72) t.defaultSz = ddVal;
    for (const s of childElements(root)) {
      if (localName(s) !== "style") continue;
      const id = attrByLocal(s, "styleId");
      if (!id) continue;
      const info: StyleInfo = {
        id,
        type: attrByLocal(s, "type") ?? "paragraph",
        name: (firstChildByLocal(s, "name") && attrByLocal(firstChildByLocal(s, "name")!, "val")) || id,
        basedOn: firstChildByLocal(s, "basedOn") ? attrByLocal(firstChildByLocal(s, "basedOn")!, "val") : undefined,
        isDefault: attrByLocal(s, "default") === "1" || attrByLocal(s, "default") === "true",
      };
      const rPr = firstChildByLocal(s, "rPr");
      const szEl = rPr && firstChildByLocal(rPr, "sz");
      if (szEl) {
        const n = Number(attrByLocal(szEl, "val"));
        if (Number.isFinite(n) && n >= 12 && n <= 72) info.sz = n;
      }
      const pPr = firstChildByLocal(s, "pPr");
      if (pPr) {
        const numPr = firstChildByLocal(pPr, "numPr");
        if (numPr) {
          const numId = firstChildByLocal(numPr, "numId");
          const ilvl = firstChildByLocal(numPr, "ilvl");
          if (numId) info.numId = attrByLocal(numId, "val");
          if (ilvl) info.ilvl = attrByLocal(ilvl, "val");
        }
        const ol = firstChildByLocal(pPr, "outlineLvl");
        if (ol) {
          const n = Number(attrByLocal(ol, "val"));
          if (Number.isFinite(n)) info.outlineLvl = n;
        }
      }
      t.list.push(info);
    }
    return t;
  }

  byId(id: string | undefined): StyleInfo | undefined {
    return id ? this.list.find((s) => s.id === id) : undefined;
  }

  find(name: string, type?: string): StyleInfo | undefined {
    const n = name.toLowerCase();
    return this.list.find((s) => s.name.toLowerCase() === n && (!type || s.type === type));
  }

  defaultOf(type: string): StyleInfo | undefined {
    return this.list.find((s) => s.type === type && s.isDefault);
  }

  /** Walks the "based on" chain (with a loop guard) and returns the first value `pick` finds. */
  private chain<T>(id: string | undefined, pick: (s: StyleInfo) => T | undefined): T | undefined {
    const seen = new Set<string>();
    let cur = this.byId(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const v = pick(cur);
      if (v !== undefined) return v;
      cur = this.byId(cur.basedOn);
    }
    return undefined;
  }

  /** True when the style (or one it is based on) puts paragraphs into an automatic list. */
  numbered(id: string | undefined): boolean {
    const n = this.chain(id, (s) => s.numId);
    return n !== undefined && n !== "0";
  }

  numPr(id: string | undefined): { numId: string; ilvl?: string } | undefined {
    const numId = this.chain(id, (s) => s.numId);
    if (numId === undefined || numId === "0") return undefined;
    return { numId, ilvl: this.chain(id, (s) => s.ilvl) };
  }

  /** Font size in points of paragraphs in this style (the style, what it is based on, then the document default). */
  fontPt(id: string | undefined): number {
    return (this.chain(id, (s) => s.sz) ?? this.defaultSz) / 2;
  }

  outlineLevel(id: string | undefined): number | undefined {
    return this.chain(id, (s) => s.outlineLvl);
  }

  has(id: string): boolean {
    return this.list.some((s) => s.id === id);
  }
}

// ------------------------------------------------------------------ the tool's own styles

export type StyleKey = "title" | `heading${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | "listParagraph" | "tableGrid" | "tableText" | "header" | "footer";

export const STYLE_NAME: Record<StyleKey, string> = {
  title: "Title",
  heading1: "heading 1",
  heading2: "heading 2",
  heading3: "heading 3",
  heading4: "heading 4",
  heading5: "heading 5",
  heading6: "heading 6",
  heading7: "heading 7",
  heading8: "heading 8",
  heading9: "heading 9",
  listParagraph: "List Paragraph",
  tableGrid: "Table Grid",
  tableText: "Gap Table Text",
  header: "header",
  footer: "footer",
};

export const BUILTIN_STYLE_ID: Record<StyleKey, string> = {
  title: "Title",
  heading1: "Heading1",
  heading2: "Heading2",
  heading3: "Heading3",
  heading4: "Heading4",
  heading5: "Heading5",
  heading6: "Heading6",
  heading7: "Heading7",
  heading8: "Heading8",
  heading9: "Heading9",
  listParagraph: "ListParagraph",
  tableGrid: "TableGrid",
  tableText: "GapTableText",
  header: "Header",
  footer: "Footer",
};

const HEADING_SIZE = [28, 24, 22, 20, 20, 20, 20, 20, 20];
const HEADING_BEFORE = [360, 240, 200, 160, 160, 160, 160, 160, 160];

/** XML of one of the tool's styles. `basedOn` is the id of the template's Normal (or Normal Table) style. */
export function styleXml(key: StyleKey, id: string, basedOn: string | undefined): string {
  const based = basedOn ? `<w:basedOn w:val="${esc(basedOn)}"/>` : "";
  const name = `<w:name w:val="${esc(STYLE_NAME[key])}"/>`;
  const head = (type: string) => `<w:style w:type="${type}" w:styleId="${esc(id)}">${name}${based}`;
  const hm = /^heading(\d)$/.exec(key);
  if (hm) {
    const n = Number(hm[1]);
    return (
      head("paragraph") +
      `<w:next w:val="${esc(basedOn ?? "Normal")}"/><w:uiPriority w:val="9"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${HEADING_BEFORE[n - 1]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:bCs/><w:color w:val="1F3864"/><w:sz w:val="${HEADING_SIZE[n - 1]}"/><w:szCs w:val="${HEADING_SIZE[n - 1]}"/></w:rPr></w:style>`
    );
  }
  switch (key) {
    case "title":
      return (
        head("paragraph") +
        `<w:next w:val="${esc(basedOn ?? "Normal")}"/><w:uiPriority w:val="10"/><w:qFormat/>` +
        `<w:pPr><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/></w:pPr>` +
        `<w:rPr><w:b/><w:bCs/><w:color w:val="1F3864"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>`
      );
    case "listParagraph":
      return head("paragraph") + `<w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>`;
    case "tableText":
      return head("paragraph") + `<w:qFormat/><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>`;
    case "header":
    case "footer":
      return head("paragraph") + `<w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>`;
    case "tableGrid": {
      const b = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
      return (
        head("table") +
        `<w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
        `<w:tblPr><w:tblBorders>${b("top")}${b("left")}${b("bottom")}${b("right")}${b("insideH")}${b("insideV")}</w:tblBorders></w:tblPr></w:style>`
      );
    }
    default:
      throw new Error(`No style definition for ${key}`);
  }
}

/** The title and heading styles of the upgraded built-in look: one accent colour, and a thin accent rule under Heading 1. */
function accentStyleXml(key: StyleKey, id: string, basedOn: string): string {
  const head = `<w:style w:type="paragraph" w:styleId="${esc(id)}"><w:name w:val="${esc(STYLE_NAME[key])}"/><w:basedOn w:val="${esc(basedOn)}"/><w:next w:val="${esc(basedOn)}"/>`;
  if (key === "title") {
    return (
      head +
      `<w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/></w:pPr>` +
      `<w:rPr><w:b/><w:bCs/><w:color w:val="${ACCENT}"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>`
    );
  }
  const n = Number(/^heading(\d)$/.exec(key)![1]);
  const rule = n === 1 ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="3" w:color="${ACCENT}"/></w:pBdr>` : "";
  const color = n <= 2 ? ACCENT : MUTED_HEADING;
  return (
    head +
    `<w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/>${rule}<w:spacing w:before="${HEADING_BEFORE[n - 1]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${HEADING_SIZE[n - 1]}"/><w:szCs w:val="${HEADING_SIZE[n - 1]}"/></w:rPr></w:style>`
  );
}

/** "Contents" heading (not an outline level, so it stays out of the table of contents) and the three table-of-contents entry styles. */
function tocStylesXml(rightTab: number): string {
  const entry = (n: number, indent: number) =>
    `<w:style w:type="paragraph" w:styleId="TOC${n}"><w:name w:val="toc ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:autoRedefine/><w:uiPriority w:val="39"/><w:unhideWhenUsed/>` +
    `<w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${rightTab}"/></w:tabs><w:spacing w:before="${n === 1 ? 80 : 0}" w:after="40"/><w:ind w:left="${indent}"/></w:pPr>` +
    (n === 1 ? `<w:rPr><w:b/><w:bCs/></w:rPr>` : "") +
    `</w:style>`;
  return (
    `<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="3" w:color="${ACCENT}"/></w:pBdr><w:spacing w:before="0" w:after="240"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:color w:val="${ACCENT}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>` +
    entry(1, 0) +
    entry(2, 240) +
    entry(3, 480)
  );
}

/**
 * A complete styles part for the built-in template. `upgraded` is the M5.1 look (accent headings, table-of-contents styles); without it the
 * part is the original one, which the starter template and the PDF-outline output still use.
 */
export function builtinStylesXml(upgraded = false, tocTab = 15138): string {
  const keys: StyleKey[] = ["title", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "heading7", "heading8", "heading9", "listParagraph", "tableText", "header", "footer"];
  const own = (k: StyleKey) => (upgraded && (k === "title" || k.startsWith("heading")) ? accentStyleXml(k, BUILTIN_STYLE_ID[k], "Normal") : styleXml(k, BUILTIN_STYLE_ID[k], "Normal"));
  return (
    XML_DECL +
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
    `<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    keys.map(own).join("") +
    styleXml("tableGrid", BUILTIN_STYLE_ID.tableGrid, "TableNormal") +
    (upgraded ? tocStylesXml(tocTab) : "") +
    `</w:styles>`
  );
}

// ------------------------------------------------------------------ numbering

export interface NumLevel {
  ilvl: number;
  start: number;
  numFmt: string;
  lvlText: string;
  pStyle?: string;
}

export interface NumberingInfo {
  abstracts: Map<string, NumLevel[]>;
  nums: Map<string, string>;
  maxAbstractId: number;
  maxNumId: number;
}

export function parseNumbering(xml: string | undefined): NumberingInfo {
  const info: NumberingInfo = { abstracts: new Map(), nums: new Map(), maxAbstractId: 0, maxNumId: 0 };
  if (!xml) return info;
  const root = parseXml(xml, "word/numbering.xml").documentElement!;
  for (const e of childElements(root)) {
    const n = localName(e);
    if (n === "abstractNum") {
      const id = attrByLocal(e, "abstractNumId") ?? "";
      const levels: NumLevel[] = [];
      for (const l of childElements(e)) {
        if (localName(l) !== "lvl") continue;
        const get = (name: string) => {
          const c = firstChildByLocal(l, name);
          return c ? attrByLocal(c, "val") : undefined;
        };
        levels.push({ ilvl: Number(attrByLocal(l, "ilvl") ?? 0), start: Number(get("start") ?? 1), numFmt: get("numFmt") ?? "decimal", lvlText: get("lvlText") ?? "", pStyle: get("pStyle") });
      }
      info.abstracts.set(id, levels);
      info.maxAbstractId = Math.max(info.maxAbstractId, Number(id) || 0);
    } else if (n === "num") {
      const id = attrByLocal(e, "numId") ?? "";
      const a = firstChildByLocal(e, "abstractNumId");
      if (a) info.nums.set(id, attrByLocal(a, "val") ?? "");
      info.maxNumId = Math.max(info.maxNumId, Number(id) || 0);
    }
  }
  return info;
}

/** Adds a one-level bullet list to a numbering part (creating the part if there is none). Returns the new xml and the numId to use. */
export function withBulletList(xml: string | undefined): { xml: string; numId: number } {
  const info = parseNumbering(xml);
  const abstractId = info.maxAbstractId + 1;
  const numId = info.maxNumId + 1;
  const abstract =
    `<w:abstractNum w:abstractNumId="${abstractId}"><w:multiLevelType w:val="singleLevel"/>` +
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>`;
  const num = `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/></w:num>`;
  if (!xml) return { xml: `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${abstract}${num}</w:numbering>`, numId };
  // Schema order: all abstractNum elements, then all num elements, then numIdMacAtCleanup.
  if (!/<w:numbering[\s>]/.test(xml) || !xml.includes("</w:numbering>")) {
    throw new TemplateError("The numbering part of the template cannot be extended. Open the file in Word, save it again as a .docx, and upload that copy.");
  }
  let out = xml;
  const end = (s: string) => {
    const cleanup = s.search(/<w:numIdMacAtCleanup[\s/>]/);
    return cleanup >= 0 ? cleanup : s.lastIndexOf("</w:numbering>");
  };
  const firstNum = out.search(/<w:num[\s>]/);
  const absAt = firstNum >= 0 ? firstNum : end(out);
  out = out.slice(0, absAt) + abstract + out.slice(absAt);
  const numAt = end(out);
  out = out.slice(0, numAt) + num + out.slice(numAt);
  return { xml: out, numId };
}

// ------------------------------------------------------------------ formatting a list number

function roman(n: number): string {
  const map: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let r = "";
  for (const [v, s] of map) while (n >= v) { r += s; n -= v; }
  return r;
}

export function formatCounter(n: number, fmt: string): string {
  switch (fmt) {
    case "decimal":
      return String(n);
    case "decimalZero":
      return String(n).padStart(2, "0");
    case "upperLetter":
      return String.fromCharCode(64 + (((n - 1) % 26) + 1)).repeat(Math.floor((n - 1) / 26) + 1);
    case "lowerLetter":
      return String.fromCharCode(96 + (((n - 1) % 26) + 1)).repeat(Math.floor((n - 1) / 26) + 1);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "lowerRoman":
      return roman(n);
    case "none":
    case "bullet":
      return "";
    default:
      return String(n);
  }
}
