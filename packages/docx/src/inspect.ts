import { paraInfo, splitElement, type BodySplit, type Chunk, type ParaInfo } from "./scan";
import { StyleTable, formatCounter, type NumberingInfo } from "./styles";
import type { PageGeom, SectPrs } from "./writer";
import type { OutlineHeading } from "./types";

// ------------------------------------------------------------------ body classification

export interface BodyItem {
  chunk: Chunk;
  kind: "heading" | "para" | "table" | "other";
  para?: ParaInfo;
  /** Set for headings: position among the outline headings. */
  headingIndex?: number;
}

function headingLevel(p: ParaInfo, styles: StyleTable): number | undefined {
  const style = styles.byId(p.styleId);
  const m = style && /^heading (\d)$/i.exec(style.name);
  if (m) return Math.min(9, Math.max(1, Number(m[1])));
  const ol = p.outlineLvl ?? styles.outlineLevel(p.styleId);
  if (ol !== undefined && ol >= 0 && ol <= 8 && !(style && /^(title|subtitle|toc heading)$/i.test(style.name))) return ol + 1;
  return undefined;
}

/** Numbering list a paragraph belongs to: its own numPr, else its style's. */
function listOf(p: ParaInfo, styles: StyleTable, numbering: NumberingInfo): { abstractId: string; ilvl: number } | undefined {
  let numId = p.numId;
  let ilvl = p.ilvl;
  if (numId === undefined) {
    const sp = styles.numPr(p.styleId);
    if (sp) {
      numId = sp.numId;
      ilvl = ilvl ?? sp.ilvl;
    }
  }
  if (numId === undefined || numId === "0") return undefined;
  const abstractId = numbering.nums.get(numId);
  if (abstractId === undefined) return undefined;
  if (ilvl === undefined) {
    // A list level linked to the paragraph style (w:pStyle inside w:lvl) decides the level.
    const linked = numbering.abstracts.get(abstractId)?.find((l) => l.pStyle === p.styleId);
    ilvl = String(linked?.ilvl ?? 0);
  }
  return { abstractId, ilvl: Number(ilvl) };
}

function trimNumber(s: string): string {
  return s.replace(/[\s.) ]+$/, "").trim();
}

/** Classifies every body child and builds the outline of headings (with automatic numbers worked out from the numbering part). */
export function classifyBody(split: BodySplit, styles: StyleTable, numbering: NumberingInfo): { items: BodyItem[]; outline: OutlineHeading[] } {
  const items: BodyItem[] = [];
  const outline: OutlineHeading[] = [];
  const counters = new Map<string, number[]>();
  for (const chunk of split.children) {
    if (chunk.name === "w:p") {
      const para = paraInfo(chunk.xml);
      const level = para.text.trim() ? headingLevel(para, styles) : undefined;
      if (level !== undefined) {
        let number: string | undefined;
        const list = listOf(para, styles, numbering);
        if (list) {
          const levels = numbering.abstracts.get(list.abstractId) ?? [];
          const c = counters.get(list.abstractId) ?? [];
          for (let k = c.length; k <= list.ilvl; k++) c[k] = 0;
          const info = (k: number) => levels.find((l) => l.ilvl === k);
          c[list.ilvl] = (c[list.ilvl] ? c[list.ilvl]! : (info(list.ilvl)?.start ?? 1) - 1) + 1;
          for (let k = list.ilvl + 1; k < c.length; k++) c[k] = 0;
          counters.set(list.abstractId, c);
          const lvl = info(list.ilvl);
          if (lvl && lvl.numFmt !== "bullet" && lvl.numFmt !== "none") {
            number = trimNumber(
              lvl.lvlText.replace(/%(\d)/g, (_m, d: string) => {
                const k = Number(d) - 1;
                return formatCounter(c[k] || info(k)?.start || 1, info(k)?.numFmt ?? "decimal");
              }),
            );
          }
        }
        const text = para.text.replace(/\s+/g, " ").trim();
        const heading: OutlineHeading = { index: outline.length, level, text, hasBody: false, ...(number ? { number } : {}) };
        outline.push(heading);
        items.push({ chunk, kind: "heading", para, headingIndex: heading.index });
      } else {
        items.push({ chunk, kind: "para", para });
      }
    } else if (chunk.name === "w:tbl") items.push({ chunk, kind: "table" });
    else items.push({ chunk, kind: "other" });
  }
  // A heading "has body" when real content (text, a table or a picture) follows it before the next heading.
  let current: OutlineHeading | undefined;
  for (const it of items) {
    if (it.kind === "heading") current = outline[it.headingIndex!];
    else if (current && !current.hasBody) {
      if (it.kind === "table") current.hasBody = true;
      else if (it.kind === "para" && !it.para!.hasSectPr && (it.para!.text.trim() !== "" || it.para!.hasDrawing)) current.hasBody = true;
      else if (it.kind === "other" && /^<w:sdt[\s>]/.test(it.chunk.xml) && />[^<]*[A-Za-z0-9]/.test(it.chunk.xml)) current.hasBody = true;
    }
  }
  return { items, outline };
}

// ------------------------------------------------------------------ page setup

const num = (s: string | undefined, d: number) => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : d);

/** Page geometry from the document's final section properties (Letter with 1-inch margins if there is none). */
export function pageFromSectPr(sectPr: string | undefined): PageGeom & { widthTwips: number; heightTwips: number; orientation: "portrait" | "landscape" } {
  const pgSz = /<w:pgSz\b[^>]*>/.exec(sectPr ?? "")?.[0] ?? "";
  const pgMar = /<w:pgMar\b[^>]*>/.exec(sectPr ?? "")?.[0] ?? "";
  const attr = (tag: string, name: string) => new RegExp(`w:${name}="(-?\\d+)"`).exec(tag)?.[1];
  const w = num(attr(pgSz, "w"), 12240);
  const h = num(attr(pgSz, "h"), 15840);
  const left = Math.max(0, num(attr(pgMar, "left"), 1440));
  const right = Math.max(0, num(attr(pgMar, "right"), 1440));
  const landscape = /w:orient="landscape"/.test(pgSz) || w > h;
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  return {
    portraitWidth: Math.max(2000, short - left - right),
    landscapeWidth: Math.max(2000, long - left - right),
    startsLandscape: landscape,
    widthTwips: w,
    heightTwips: h,
    orientation: landscape ? "landscape" : "portrait",
  };
}

const SECT_ORDER = [
  "headerReference",
  "footerReference",
  "footnotePr",
  "endnotePr",
  "type",
  "pgSz",
  "pgMar",
  "paperSrc",
  "pgBorders",
  "lnNumType",
  "pgNumType",
  "cols",
  "formProt",
  "vAlign",
  "noEndnote",
  "titlePg",
  "textDirection",
  "bidi",
  "rtlGutter",
  "docGrid",
  "printerSettings",
];

/**
 * Copies of the template's final w:sectPr for the two page layouts. They keep the headers, footers, margins and
 * columns, but drop the section type, page-number restart and "different first page", which belong to the template's own sections.
 */
export function deriveSectPrs(sectPr: string | undefined): SectPrs {
  const page = pageFromSectPr(sectPr);
  const parts = sectPr ? splitElement(sectPr) : undefined;
  const open = parts?.open && !parts.open.endsWith("/>") ? parts.open : "<w:sectPr>";
  const kept = (parts?.children ?? [])
    .filter((c) => c.name.startsWith("w:") && !["w:type", "w:pgNumType", "w:titlePg", "w:pgSz"].includes(c.name))
    .map((c) => c.xml);
  const originalPgSz = /<w:pgSz\b[^>]*\/>/.exec(sectPr ?? "")?.[0];
  const mk = (pgSz: string) => {
    const all = [...kept, pgSz];
    const rank = (x: string) => {
      const n = /^<w:(\w+)/.exec(x)?.[1] ?? "";
      const i = SECT_ORDER.indexOf(n);
      return i < 0 ? SECT_ORDER.length : i;
    };
    return `${open}${all
      .map((x, i) => ({ x, i }))
      .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
      .map((e) => e.x)
      .join("")}</w:sectPr>`;
  };
  const short = Math.min(page.widthTwips, page.heightTwips);
  const long = Math.max(page.widthTwips, page.heightTwips);
  const portraitSz = page.orientation === "portrait" && originalPgSz ? originalPgSz : `<w:pgSz w:w="${short}" w:h="${long}"/>`;
  return { portrait: mk(portraitSz), landscape: mk(`<w:pgSz w:w="${long}" w:h="${short}" w:orient="landscape"/>`) };
}

/** Puts "different first page" into a w:sectPr, at its place in the schema order. */
function withTitlePg(sectPr: string): string {
  if (/<w:titlePg\b/.test(sectPr)) return sectPr;
  const parts = splitElement(sectPr);
  const rank = (x: string) => {
    const i = SECT_ORDER.indexOf(/^<w:(\w+)/.exec(x)?.[1] ?? "");
    return i < 0 ? SECT_ORDER.length : i;
  };
  const all = [...parts.children.map((c) => c.xml), "<w:titlePg/>"];
  return `${parts.open}${all
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
    .map((e) => e.x)
    .join("")}${parts.close}`;
}

/**
 * Keeps a first-page-only header (and footer) of the template on page 1.
 *
 * The tool puts each wide table in a landscape section of its own, so the document has several sections although the template had
 * one. Word reads "different first page" (w:titlePg) per section, and deriveSectPrs leaves it out of the sections it makes, so the
 * template's first-page header would be lost and, left on the template's own (now last) section, would reappear at the top of that
 * section instead. When the first section of the finished document is one the tool made and the template's last section has
 * titlePg, the first section gets titlePg (its first / default header and footer references are copied from the template) and the last
 * section loses it: page 1 shows the first-page header, every later page the default one, as in the template. A template that has its
 * own sections before the tool's first one is left as it is, and so is a document with a single section.
 */
export function restoreFirstPageHeader(mainXml: string, sectPrs: SectPrs | undefined): string {
  if (!sectPrs) return mainXml;
  const found = [...mainXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)];
  if (found.length < 2) return mainXml;
  const first = found[0]!;
  const last = found[found.length - 1]!;
  if (first[0] !== sectPrs.portrait || !/<w:titlePg\b/.test(last[0])) return mainXml;
  const lastFixed = last[0].replace(/<w:titlePg\b[^>]*\/>/, "");
  return mainXml.slice(0, first.index) + withTitlePg(first[0]) + mainXml.slice(first.index! + first[0].length, last.index) + lastFixed + mainXml.slice(last.index! + last[0].length);
}
