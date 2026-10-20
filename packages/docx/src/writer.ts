import type { Block, DocComment, DocModel, DocSection } from "@gap/engine";
import { ACCENT, BANNER_COLOR, BORDER_COLOR, ON_ACCENT, ZEBRA_FILL, tintForColumn } from "./palette";
import { BUILTIN_STYLE_ID, STYLE_NAME, StyleTable, styleXml, withBulletList, type StyleKey } from "./styles";
import { cleanXmlText, esc } from "./xml";

export { BANNER_COLOR };
const HEADER_FILL = "D9E2F3";

// ------------------------------------------------------------------ run and paragraph properties (schema order)

export interface RPr {
  b?: boolean;
  i?: boolean;
  color?: string;
  /** Half-points. */
  sz?: number;
  spacing?: number;
  highlight?: string;
}

/** Run properties in ECMA-376 order: rFonts, b, i, color, spacing, sz, highlight, lang. */
export function rPrXml(r: RPr = {}): string {
  return (
    "<w:rPr>" +
    (r.b ? "<w:b/><w:bCs/>" : "") +
    (r.i ? "<w:i/><w:iCs/>" : "") +
    (r.color ? `<w:color w:val="${esc(r.color)}"/>` : "") +
    (r.spacing ? `<w:spacing w:val="${r.spacing}"/>` : "") +
    (r.sz ? `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>` : "") +
    (r.highlight ? `<w:highlight w:val="${esc(r.highlight)}"/>` : "") +
    '<w:lang w:val="en-US"/>' +
    "</w:rPr>"
  );
}

export interface PPr {
  style?: string;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  numPr?: { ilvl: number; numId: number };
  /** Complete w:pBdr element. */
  pBdr?: string;
  /** Fill colour (RRGGBB) of the paragraph. */
  shd?: string;
  spacing?: { before?: number; after?: number };
  ind?: { left?: number; right?: number; hanging?: number };
  jc?: "left" | "center" | "right" | "both";
  /** Complete w:sectPr element: this paragraph ends a section. */
  sectPr?: string;
}

/** Paragraph properties in ECMA-376 order: pStyle, keepNext, keepLines, pageBreakBefore, numPr, pBdr, shd, spacing, ind, jc, sectPr. */
export function pPrXml(p: PPr = {}): string {
  const inner =
    (p.style ? `<w:pStyle w:val="${esc(p.style)}"/>` : "") +
    (p.keepNext ? "<w:keepNext/>" : "") +
    (p.keepLines ? "<w:keepLines/>" : "") +
    (p.pageBreakBefore ? "<w:pageBreakBefore/>" : "") +
    (p.numPr ? `<w:numPr><w:ilvl w:val="${p.numPr.ilvl}"/><w:numId w:val="${p.numPr.numId}"/></w:numPr>` : "") +
    (p.pBdr ?? "") +
    (p.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${esc(p.shd)}"/>` : "") +
    (p.spacing ? `<w:spacing${p.spacing.before !== undefined ? ` w:before="${p.spacing.before}"` : ""}${p.spacing.after !== undefined ? ` w:after="${p.spacing.after}"` : ""}/>` : "") +
    (p.ind ? `<w:ind${p.ind.left !== undefined ? ` w:left="${p.ind.left}"` : ""}${p.ind.right !== undefined ? ` w:right="${p.ind.right}"` : ""}${p.ind.hanging !== undefined ? ` w:hanging="${p.ind.hanging}"` : ""}/>` : "") +
    (p.jc ? `<w:jc w:val="${p.jc}"/>` : "") +
    (p.sectPr ?? "");
  return inner ? `<w:pPr>${inner}</w:pPr>` : "";
}

/** Runs for some text: line breaks become w:br, tabs become w:tab, and every character is escaped. */
export function textRuns(text: string, r: RPr = {}): string {
  const rpr = rPrXml(r);
  const out: string[] = [];
  const lines = cleanXmlText(text).split(/\r\n|\r|\n/);
  lines.forEach((line, li) => {
    if (li > 0) out.push(`<w:r>${rpr}<w:br/></w:r>`);
    line.split("\t").forEach((seg, si) => {
      if (si > 0) out.push(`<w:r>${rpr}<w:tab/></w:r>`);
      if (seg) out.push(`<w:r>${rpr}<w:t xml:space="preserve">${esc(seg)}</w:t></w:r>`);
    });
  });
  return out.join("");
}

/** Wraps runs in Word comment ranges: start markers, the runs, end markers, then the reference runs. */
export function withCommentRanges(runs: string, ids: number[]): string {
  if (!ids.length) return runs;
  return (
    ids.map((id) => `<w:commentRangeStart w:id="${id}"/>`).join("") +
    runs +
    ids.map((id) => `<w:commentRangeEnd w:id="${id}"/>`).reverse().join("") +
    ids.map((id) => `<w:r><w:commentReference w:id="${id}"/></w:r>`).join("")
  );
}

export function para(runs: string, p: PPr = {}): string {
  return `<w:p>${pPrXml(p)}${runs}</w:p>`;
}

// ------------------------------------------------------------------ page geometry and section properties

export interface PageGeom {
  /** Text width (page width minus left and right margins) in twips, for a portrait and a landscape section. */
  portraitWidth: number;
  landscapeWidth: number;
  /** True when the document's own pages are landscape: no section switching is needed. */
  startsLandscape: boolean;
}

export interface SectPrs {
  /** w:sectPr xml that closes a section laid out like the template's own page. */
  portrait: string;
  /** Same, with a landscape page. */
  landscape: string;
}

// ------------------------------------------------------------------ comments

const KIND_LABEL = { reply: "Reply", resolution: "Resolution", reopen: "Reopened" } as const;

/** Plain-text lines of one Word comment: the comment, one line per response, then the status. */
export function commentLines(c: DocComment): string[] {
  return [
    `${c.id}: ${c.text}`,
    ...c.replies.map((r) => `${KIND_LABEL[r.kind]} by ${r.by}${r.role ? ` (${r.role})` : ""}, ${r.at.slice(0, 10)}: ${r.text}`),
    `Status: ${c.status}`,
  ];
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 3);
  return letters || (name.trim()[0] ?? "?").toUpperCase();
}

function wordDate(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 19) + "Z";
}

/** word/comments.xml for the comments with these indexes (the index is also the Word comment id). */
export function commentsXml(comments: DocComment[], indexes: number[], wNs: string): string {
  const items = indexes.map((i) => {
    const c = comments[i]!;
    const date = wordDate(c.at);
    const lines = commentLines(c);
    const paras = lines
      .map((line, li) => {
        const lead = li === 0 ? '<w:r><w:annotationRef/></w:r>' : "";
        return `<w:p>${lead}${textRuns(line)}</w:p>`;
      })
      .join("");
    return `<w:comment w:id="${i}" w:author="${esc(c.by)}"${date ? ` w:date="${date}"` : ""} w:initials="${esc(initialsOf(c.by))}">${paras}</w:comment>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${wNs}">${items.join("")}</w:comments>`;
}

// ------------------------------------------------------------------ writer context

export interface WriterInit {
  doc: DocModel;
  styles: StyleTable;
  page: PageGeom;
  /** Present when the template's pages are portrait: wide tables then get their own landscape section. */
  sectPrs?: SectPrs;
  numberingXml?: string;
  /** Builtin template: bullets already exist as numId 1. */
  bulletNumId?: number;
  /** The upgraded built-in look: accent table headers, zebra rows, category and severity shading. Never set for a customer's template. */
  styled?: boolean;
}

/** Everything the block writers share: style lookup, numbering, page geometry and comment anchors. */
export class WriterCtx {
  readonly doc: DocModel;
  readonly styles: StyleTable;
  readonly page: PageGeom;
  readonly sectPrs?: SectPrs;
  readonly styled: boolean;
  numberingXml?: string;
  /** Style definitions added because the template had no style of that name. */
  addedStyles: string[] = [];
  private bullet?: number;
  private styleCache = new Map<StyleKey, string>();
  private anchored = new Set<number>();
  /** Comment index lists, by section id (section-level) and by "sectionId|gapDisplayId". */
  private sectionComments = new Map<string, number[]>();
  private gapComments = new Map<string, number[]>();

  constructor(init: WriterInit) {
    this.doc = init.doc;
    this.styles = init.styles;
    this.page = init.page;
    this.sectPrs = init.sectPrs;
    this.styled = !!init.styled;
    this.numberingXml = init.numberingXml;
    this.bullet = init.bulletNumId;
    init.doc.comments.forEach((c, i) => {
      const section = init.doc.sections.find((s) => s.id === c.sectionId);
      const hasRow = !!(c.gapDisplayId && section && sectionHasCell(section, c.gapDisplayId));
      const map = hasRow ? this.gapComments : this.sectionComments;
      const key = hasRow ? `${c.sectionId}|${c.gapDisplayId}` : c.sectionId;
      map.set(key, [...(map.get(key) ?? []), i]);
    });
  }

  /** Id of the template's style for this role, adding the tool's own style when the template has none. */
  style(key: StyleKey): string {
    const cached = this.styleCache.get(key);
    if (cached) return cached;
    const type = key === "tableGrid" ? "table" : "paragraph";
    let found = this.styles.find(STYLE_NAME[key], type);
    if (!found) {
      let id = `Gap${BUILTIN_STYLE_ID[key].replace(/^Gap/, "")}`;
      for (let n = 2; this.styles.has(id); n++) id = `Gap${BUILTIN_STYLE_ID[key].replace(/^Gap/, "")}${n}`;
      const basedOn = this.styles.defaultOf(type)?.id;
      this.addedStyles.push(styleXml(key, id, basedOn));
      const addedSz = Number(/<w:sz w:val="(\d+)"/.exec(this.addedStyles[this.addedStyles.length - 1]!)?.[1]);
      found = { id, type, name: STYLE_NAME[key], basedOn, isDefault: false, ...(Number.isFinite(addedSz) ? { sz: addedSz } : {}) };
      this.styles.list.push(found);
    }
    this.styleCache.set(key, found.id);
    return found.id;
  }

  headingStyle(level: number): string {
    return this.style(`heading${Math.min(9, Math.max(1, level))}` as StyleKey);
  }

  headingNumbered(level: number): boolean {
    return this.styles.numbered(this.headingStyle(level));
  }

  bulletNumId(): number {
    if (this.bullet === undefined) {
      const r = withBulletList(this.numberingXml);
      this.numberingXml = r.xml;
      this.bullet = r.numId;
    }
    return this.bullet;
  }

  /** Width available to a table in a portrait or landscape section. */
  tableWidth(landscape: boolean): number {
    return landscape ? this.page.landscapeWidth : this.page.portraitWidth;
  }

  // -- comment anchors

  /** Comments to anchor on a section heading: the section's own, and gap comments whose row is not in a table. Each comment is handed out once. */
  takeHeadingComments(sectionId: string): number[] {
    return this.take(this.sectionComments.get(sectionId) ?? []);
  }

  takeGapComments(sectionId: string, displayId: string): number[] {
    return this.take(this.gapComments.get(`${sectionId}|${displayId}`) ?? []);
  }

  private take(ids: number[]): number[] {
    const fresh = ids.filter((i) => !this.anchored.has(i));
    fresh.forEach((i) => this.anchored.add(i));
    return fresh;
  }

  anchoredIndexes(): number[] {
    return [...this.anchored].sort((a, b) => a - b);
  }

  unanchoredIndexes(): number[] {
    return this.doc.comments.map((_, i) => i).filter((i) => !this.anchored.has(i));
  }

  /** Marks comments as anchored by something the caller wrote itself. */
  markAnchored(ids: number[]): void {
    ids.forEach((i) => this.anchored.add(i));
  }
}

function sectionHasCell(section: DocSection, text: string): boolean {
  return section.blocks.some((b) => b.type === "table" && b.rows.some((r) => r.some((c) => c === text)));
}

// ------------------------------------------------------------------ blocks

export interface HeadingOpts {
  /** Do not let the heading style's automatic numbering add a number (used for sub-headings and appendices). */
  noNumber?: boolean;
  commentIds?: number[];
  pageBreakBefore?: boolean;
}

export function headingPara(ctx: WriterCtx, level: number, text: string, o: HeadingOpts = {}): string {
  const lvl = Math.min(9, Math.max(1, level));
  return para(withCommentRanges(textRuns(text), o.commentIds ?? []), {
    style: ctx.headingStyle(lvl),
    pageBreakBefore: o.pageBreakBefore,
    numPr: o.noNumber && ctx.headingNumbered(lvl) ? { ilvl: 0, numId: 0 } : undefined,
  });
}

/** The proof-of-concept banner as a bordered, bold, dark-red paragraph. */
export function bannerPara(text: string): string {
  const side = (n: string) => `<w:${n} w:val="single" w:sz="12" w:space="4" w:color="${BANNER_COLOR}"/>`;
  return para(textRuns(text, { b: true, color: BANNER_COLOR, sz: 22 }), {
    keepLines: true,
    pBdr: `<w:pBdr>${side("top")}${side("left")}${side("bottom")}${side("right")}</w:pBdr>`,
    spacing: { before: 0, after: 160 },
    jc: "center",
  });
}

export function notePara(text: string, commentIds: number[] = []): string {
  return para(withCommentRanges(textRuns(text, { i: true }), commentIds), {
    pBdr: '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="808080"/></w:pBdr>',
    ind: { left: 200 },
  });
}

/** An empty paragraph that must follow a table (Word needs one between tables and before the end of the body). */
export function spacerPara(): string {
  return para("", { spacing: { before: 0, after: 80 } });
}

function listParas(ctx: WriterCtx, items: string[]): string {
  const numId = ctx.bulletNumId();
  return items.map((t) => para(textRuns(t), { style: ctx.style("listParagraph"), numPr: { ilvl: 0, numId } })).join("");
}

// ------------------------------------------------------------------ column widths

const NARROW = new Set([..."ijlI.,:;'|!()[]/ ftr"]);
const WIDE = new Set([..."mwMW@%"]);

/** Width of one character in em (rough Latin-text metrics, a little generous so a word fits in Arial, Calibri and Verdana). */
function charEm(ch: string): number {
  if (NARROW.has(ch)) return 0.38;
  if (WIDE.has(ch)) return 0.92;
  if (ch >= "A" && ch <= "Z") return 0.72;
  if (ch >= "0" && ch <= "9") return 0.62;
  return 0.58;
}

const CELL_PAD_TWIPS = 160 + 30; // left and right cell margin (80 + 80) plus a little room
const MAX_WORD_CHARS = 28;
const PREFERRED_CAP_CHARS = 60;

function textTwips(text: string, fontPt: number, bold: boolean): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * fontPt * 20 * (bold ? 1.1 : 1);
}

export interface ColumnNeeds {
  /** Width in twips (cell margins included) at which the longest word of the column still fits on one line. */
  min: number[];
  /** Width in twips at which most cells (the 90th percentile, at most 60 characters) fit on one line. */
  preferred: number[];
}

/** What each column needs, from its header and cell text and the table font size. */
export function columnNeeds(columns: string[], rows: string[][], fontPt: number, boldFirstColumn = false): ColumnNeeds {
  const min: number[] = [];
  const preferred: number[] = [];
  columns.forEach((h, c) => {
    const cells = rows.map((r) => r[c] ?? "");
    let longest = 0;
    const word = (w: string, bold: boolean) => {
      const clipped = [...w].slice(0, MAX_WORD_CHARS).join("");
      longest = Math.max(longest, textTwips(clipped, fontPt, bold));
    };
    for (const w of h.split(/\s+/)) if (w) word(w, true);
    for (const t of cells) for (const w of t.split(/\s+/)) if (w) word(w, boldFirstColumn && c === 0);
    const lens = cells.map((t) => Math.max(0, ...t.split("\n").map((l) => [...l].length))).sort((a, b) => a - b);
    const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.ceil(lens.length * 0.9) - 1)]! : 0;
    const typical = Math.min(PREFERRED_CAP_CHARS, p90);
    const lo = Math.ceil(longest + CELL_PAD_TWIPS);
    const wantText = typical * 0.55 * fontPt * 20 * (boldFirstColumn && c === 0 ? 1.1 : 1);
    min.push(lo);
    preferred.push(Math.max(lo, Math.ceil(wantText + CELL_PAD_TWIPS)));
  });
  return { min, preferred };
}

/**
 * Column widths in twips that add up to `total`. Every column first gets the width its longest word needs; the rest is shared in
 * proportion to how much more each column would like. Only when the longest words cannot all fit are the minimums scaled down.
 */
export function columnWidths(columns: string[], rows: string[][], total: number, fontPt = 10, boldFirstColumn = false): number[] {
  const n = columns.length;
  if (n === 0) return [];
  const { min, preferred } = columnNeeds(columns, rows, fontPt, boldFirstColumn);
  const minSum = min.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (minSum >= total) {
    // The longest words cannot all fit. Squeeze only the widest minimums (down to one common level) so narrow columns such as IDs stay whole.
    const sorted = [...min].sort((a, b) => a - b);
    let level = total / n;
    let remaining = total;
    for (let i = 0; i < sorted.length; i++) {
      const share = remaining / (sorted.length - i);
      if (sorted[i]! <= share) remaining -= sorted[i]!;
      else {
        level = share;
        break;
      }
      level = share;
    }
    widths = min.map((m) => Math.max(1, Math.floor(Math.min(m, level))));
  } else {
    const extra = total - minSum;
    const want = preferred.map((p, i) => p - min[i]!);
    const wantSum = want.reduce((a, b) => a + b, 0);
    widths = min.map((m, i) => m + Math.floor(extra * (wantSum > 0 ? want[i]! / wantSum : 1 / n)));
  }
  // Rounding leftovers go to the column that wants the most room.
  const left = total - widths.reduce((a, b) => a + b, 0);
  const wantsMost = preferred.reduce((best, p, i) => (p - min[i]! > preferred[best]! - min[best]! ? i : best), 0);
  widths[wantsMost] = widths[wantsMost]! + left;
  return widths;
}

export interface TableOpts {
  /** First row is a repeating header row (default true). */
  headerRow?: boolean;
  /** Make the first column bold (label/value tables). */
  firstColumnBold?: boolean;
  sectionId?: string;
  /** Fixed column widths in twips (they must add up to the table width); default: sized from the content. */
  widths?: number[];
}

const CELL_MARGIN = '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>';
const BORDER = (n: string, color = "808080") => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="${color}"/>`;

/** One table. A table with more than 8 columns is put in its own landscape section when the page is portrait. */
export function tableXml(ctx: WriterCtx, columns: string[], rows: string[][], o: TableOpts = {}): string {
  const header = o.headerRow !== false;
  const ncols = Math.max(columns.length, ...rows.map((r) => r.length), 1);
  const cols = Array.from({ length: ncols }, (_, i) => columns[i] ?? "");
  const fontPt = ctx.styles.fontPt(ctx.style("tableText"));
  const boldFirst = !!o.firstColumnBold;
  const canTurn = !ctx.page.startsLandscape && !!ctx.sectPrs;
  // A portrait page gives a table of many columns, or of columns whose longest words clearly do not fit, a landscape section of its own.
  const needsMin = canTurn ? columnNeeds(cols, rows, fontPt, boldFirst).min.reduce((a, b) => a + b, 0) : 0;
  const wide = canTurn && (ncols > 8 || needsMin > ctx.tableWidth(false) * 1.15);
  const total = ctx.tableWidth(ctx.page.startsLandscape || wide);
  const widths = o.widths && o.widths.length === ncols && o.widths.reduce((a, b) => a + b, 0) === total ? o.widths : columnWidths(cols, rows, total, fontPt, boldFirst);
  const textStyle = ctx.style("tableText");

  // The upgraded built-in look: accent header with white bold text, zebra rows, and a tint (plus the text) in category and severity columns.
  const styled = ctx.styled;
  const headFill = styled ? ACCENT : HEADER_FILL;
  const tints = styled ? cols.map(tintForColumn) : [];
  const cell = (text: string, w: number, opts: { head?: boolean; bold?: boolean; ids?: number[]; fill?: string }) => {
    const fill = opts.head ? headFill : opts.fill;
    const rpr = { b: opts.head || opts.bold, ...(opts.head && styled ? { color: ON_ACCENT } : {}) };
    return (
      `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>` +
      para(withCommentRanges(textRuns(text, rpr), opts.ids ?? []), { style: textStyle, keepNext: opts.head }) +
      "</w:tc>"
    );
  };

  const trs: string[] = [];
  if (header) trs.push(`<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cols.map((c, i) => cell(c, widths[i]!, { head: true })).join("")}</w:tr>`);
  rows.forEach((r, ri) => {
    const tcs = cols.map((_, i) => {
      const text = r[i] ?? "";
      const ids = o.sectionId && text ? ctx.takeGapComments(o.sectionId, text) : [];
      const fill = styled ? (tints[i]?.(text) ?? (ri % 2 === 1 ? ZEBRA_FILL : undefined)) : undefined;
      return cell(text, widths[i]!, { bold: o.firstColumnBold && i === 0, ids, fill });
    });
    trs.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs.join("")}</w:tr>`);
  });
  const line = styled ? BORDER_COLOR : undefined;
  const tbl =
    `<w:tbl><w:tblPr><w:tblStyle w:val="${esc(ctx.style("tableGrid"))}"/><w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblBorders>${BORDER("top", line)}${BORDER("left", line)}${BORDER("bottom", line)}${BORDER("right", line)}${BORDER("insideH", line)}${BORDER("insideV", line)}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/>${CELL_MARGIN}<w:tblLook w:val="04A0" w:firstRow="${header ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${trs.join("")}</w:tbl>`;
  if (wide) {
    return para("", { sectPr: ctx.sectPrs!.portrait, spacing: { before: 0, after: 0 } }) + tbl + para("", { sectPr: ctx.sectPrs!.landscape, spacing: { before: 0, after: 0 } });
  }
  return tbl + spacerPara();
}

export interface BlockOpts {
  /** Heading level for "heading" blocks inside the section. */
  subLevel: number;
  sectionId?: string;
}

export function blockXml(ctx: WriterCtx, b: Block, o: BlockOpts): string {
  switch (b.type) {
    case "paragraph":
      return para(textRuns(b.text));
    case "heading":
      return headingPara(ctx, o.subLevel, b.text, { noNumber: true });
    case "note":
      return notePara(b.text);
    case "list":
      return listParas(ctx, b.items);
    case "table":
      if (!b.rows.length) return para(textRuns("None.", { i: true }));
      return (b.caption ? para(textRuns(b.caption, { b: true }), { keepNext: true }) : "") + tableXml(ctx, b.columns, b.rows, { sectionId: o.sectionId });
  }
}

export interface SectionOpts {
  headingLevel: number;
  /** Text of the heading; default "<number>. <title>" (or "Appendix A. <title>"). */
  headingText?: string;
  /** Write no heading at all (the content goes under a heading the template already has). */
  noHeading?: boolean;
  /** Level for sub-headings inside the section; default headingLevel + 1. */
  subLevel?: number;
  /** Keep the heading style's automatic numbering off (sub-headings added under a customer heading). */
  noNumber?: boolean;
  /** Comments to anchor on the heading; default: the section's own. */
  commentIds?: number[];
  /** Start the heading on a new page (the first section after the front pages). */
  pageBreakBefore?: boolean;
}

/** Heading text as the HTML document shows it, without or with the number. */
export function sectionHeadingText(s: DocSection, withNumber: boolean): string {
  if (s.appendix) return `Appendix ${s.number}. ${s.title}`;
  return withNumber ? `${s.number}. ${s.title}` : s.title;
}

/**
 * One document section: heading, blocks, and the Word comments anchored to it.
 * Headings of an automatically numbered style get no number text (the style supplies it); appendices always carry their "Appendix A." text.
 */
export function sectionXml(ctx: WriterCtx, s: DocSection, o: SectionOpts): string {
  const out: string[] = [];
  if (!o.noHeading) {
    const numbered = ctx.headingNumbered(o.headingLevel) && !s.appendix;
    out.push(
      headingPara(ctx, o.headingLevel, o.headingText ?? sectionHeadingText(s, !numbered), {
        noNumber: !!s.appendix || !!o.noNumber,
        commentIds: o.commentIds ?? ctx.takeHeadingComments(s.id),
        pageBreakBefore: o.pageBreakBefore,
      }),
    );
  }
  const subLevel = o.subLevel ?? o.headingLevel + 1;
  for (const b of s.blocks) out.push(blockXml(ctx, b, { subLevel, sectionId: s.id }));
  return out.join("");
}

/** Banner (optional), title, status and the document-details table. */
export function frontXml(ctx: WriterCtx, o: { banner: boolean }): string {
  const d = ctx.doc;
  return (
    (o.banner ? bannerPara(d.banner) : "") +
    para(textRuns(d.title), { style: ctx.style("title") }) +
    para(textRuns(d.status, { b: true, spacing: 40 }), { spacing: { after: 160 } }) +
    (d.meta.length ? tableXml(ctx, ["Item", "Value"], d.meta.map(([k, v]) => [k, v]), { headerRow: false, firstColumnBold: true }) : "")
  );
}
