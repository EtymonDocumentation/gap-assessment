import type { TrdDocument, TrdPart, TrdWriteup } from "@gap/process-model";
import type { Block, Run } from "./document";
import { activeParts, plainOfSegments, resolveBlank, segmentsOf, type BlankContext, type ResolvedBlank, type TextSeg } from "./trd-writeup";
import { OVERVIEW_SECTION_KEY, writeupOrder } from "./trd-writeup-order";

/*
 * TRD write-ups as document blocks. Used by the TRD document builder (Word, HTML and markdown all draw the same blocks).
 *
 * The section "Manufacturing process overview" holds one numbered sub-section per process step, in the TRD's step order ("5.1 Title",
 * "5.2 Title" ...), with lettered sub-steps and numbered sub-sub-headings ("5.7.1 Filling"). The numbers are written into the heading
 * text from the section's own number, so the HTML, the built-in Word look and a customer's template all show the same numbers.
 *
 * An open blank (no value anywhere) is drawn as its label in square brackets and highlighted; a filled blank is drawn as its value.
 * Neither colour nor highlight is the only cue: the brackets are in the text. Nothing here fills a value in.
 */

export const OVERVIEW_KEY = OVERVIEW_SECTION_KEY;
export const OVERVIEW_TITLE = "Manufacturing process overview";

export interface FilledBlank {
  writeup: TrdWriteup;
  blank: ResolvedBlank;
}

function runsOf(segs: readonly TextSeg[]): Run[] {
  return segs.map((s): Run => {
    const bold = s.bold ? { bold: true as const } : {};
    if ("blank" in s) {
      if (s.blank.filled) return { text: s.blank.value!, ...bold };
      return { text: `[${s.blank.label}${s.blank.note ? `, ${s.blank.note.toLowerCase().includes("tbd") ? "TBD" : s.blank.note}` : ""}]`, open: true, ...bold };
    }
    return { text: s.text, ...bold };
  });
}

/** Rich runs for a text of one write-up; every blank met is reported to `seen`. */
export function writeupRuns(ctx: BlankContext, w: TrdWriteup, src: string, seen?: (b: ResolvedBlank) => void): Run[] {
  const segs = segmentsOf(src, (key, label) => {
    const b = resolveBlank(ctx, w, key, label);
    seen?.(b);
    return b;
  });
  return runsOf(segs);
}

export interface WriteupBlocksResult {
  blocks: Block[];
  filled: ResolvedBlank[];
  open: ResolvedBlank[];
  /** Figure parts in the document that have no picture yet (each is shown as "Figure to be added"). */
  openFigures: TrdPart[];
}

/** Figures are numbered through the whole document ("Figure 1", "Figure 2" ...), so one counter is passed to every write-up. */
export interface FigureCounter {
  n: number;
}

/**
 * The blocks of one write-up. `prefix` is the number the write-up's own sub-headings continue ("5.2" gives "5.2.1", "5.2.2" ...).
 * Consecutive bullets form one list and consecutive lettered steps form one lettered list.
 */
export function writeupBlocks(ctx: BlankContext, w: TrdWriteup, prefix: string, figures: FigureCounter = { n: 0 }): WriteupBlocksResult {
  const filled = new Map<string, ResolvedBlank>();
  const open = new Map<string, ResolvedBlank>();
  const openFigures: TrdPart[] = [];
  const seen = (b: ResolvedBlank) => (b.filled ? filled : open).set(b.key, b);
  const blocks: Block[] = [];
  const result = (): WriteupBlocksResult => ({ blocks, filled: [...filled.values()], open: [...open.values()], openFigures });
  if (w.notApplicable?.on) {
    blocks.push({ type: "rich", style: "paragraph", runs: writeupRuns(ctx, w, w.notApplicable.text, seen) });
    return result();
  }
  let sub = 0;
  let list: { style: "bullet" | "letter"; items: Run[][] } | undefined;
  const flush = () => {
    if (list) blocks.push({ type: "rich-list", style: list.style, items: list.items });
    list = undefined;
  };
  for (const p of activeParts(w)) {
    const runs = () => writeupRuns(ctx, w, p.text, seen);
    if (p.kind === "bullet" || p.kind === "step") {
      const style = p.kind === "bullet" ? "bullet" : "letter";
      if (list && list.style !== style) flush();
      list = list ?? { style, items: [] };
      list.items.push(runs());
      continue;
    }
    flush();
    const cell = (src: string) =>
      plainOfSegments(
        segmentsOf(src, (key, label) => {
          const b = resolveBlank(ctx, w, key, label);
          seen(b);
          return b;
        }),
      );
    blocks.push(...partBlocks(p, { runs, cell, figures, openFigures }, `${prefix}.${p.kind === "subsection" ? ++sub : sub}`));
  }
  flush();
  return result();
}

interface PartTools {
  runs: () => Run[];
  /** A table cell with its blanks resolved: a value, or the open blank's label in square brackets. Plain text (a cell has no rich runs). */
  cell: (src: string) => string;
  figures: FigureCounter;
  openFigures: TrdPart[];
}

function partBlocks(p: TrdPart, t: PartTools, number: string): Block[] {
  const { runs } = t;
  switch (p.kind) {
    case "paragraph":
      return [{ type: "rich", style: "paragraph", runs: runs() }];
    case "note":
      return [{ type: "rich", style: "note", runs: runs() }];
    case "figure": {
      if (p.image) {
        // A numbered picture. The caption is the author's words; the alternative text falls back to the caption so a screen reader
        // never meets a picture with no name at all (an empty alt is still possible when both are empty, and the editor warns).
        return [
          {
            type: "picture",
            number: ++t.figures.n,
            caption: (p.caption ?? "").trim(),
            alt: (p.alt ?? "").trim() || (p.caption ?? "").trim(),
            mime: p.image.mime,
            data: p.image.data,
            width: p.image.width,
            height: p.image.height,
          },
        ];
      }
      // No picture yet: the placeholder says what belongs here, and counts as an open item of the document.
      t.openFigures.push(p);
      // The colon sits outside the bold run: markdown cannot close bold after a trailing space.
      const lead: Run[] = [{ text: "Figure to be added", bold: true }, { text: ": " }];
      if (p.caption?.trim()) lead.push({ text: p.caption.trim() + (p.text.trim() ? ". " : "") });
      return [{ type: "rich", style: "note", runs: [...lead, ...runs()] }];
    }
    case "subsection":
      return [{ type: "heading", text: `${number} ${p.title ?? ""}`.trim(), level: 2 }];
    case "heading":
      return [{ type: "heading", text: p.title ?? "", level: 2 }];
    case "table": {
      const cols = p.columns ?? [];
      // A table with no rows yet still shows its column heads and one empty row to fill in. An empty cell stays empty.
      return [{ type: "table", columns: cols, rows: p.rows?.length ? p.rows.map((r) => cols.map((_, i) => t.cell(r[i] ?? ""))) : [cols.map(() => "")] }];
    }
    default:
      return [];
  }
}

// ------------------------------------------------------------------ sections

export interface WriteupSectionsResult {
  filled: { writeup: TrdWriteup; blank: ResolvedBlank }[];
  open: { writeup: TrdWriteup; blank: ResolvedBlank }[];
  /** Figure placeholders in the document with no picture yet: open items, like an open blank. */
  openFigures: { writeup: TrdWriteup; part: TrdPart }[];
  /** How many numbered pictures the document holds. */
  pictures: number;
}

type AddSection = (id: string, title: string, make: (number: string) => Block[]) => void;

/** True when the TRD has any write-up. A TRD without write-ups exports exactly as it did before write-ups existed. */
export const hasWriteups = (d: TrdDocument): boolean => Boolean(d.writeups?.length);

/**
 * Adds the sections made from the write-ups: first the TRD-level prose sections (each its own numbered section), then the
 * "Manufacturing process overview" with one numbered sub-section per step. `add` creates a section and tells the function its number.
 * The order is `writeupOrder`, the same order the Descriptions tab shows and "move up / down" changes.
 */
export function addWriteupSections(ctx: BlankContext, d: TrdDocument, add: AddSection): WriteupSectionsResult {
  const result: WriteupSectionsResult = { filled: [], open: [], openFigures: [], pictures: 0 };
  const all = d.writeups ?? [];
  if (!all.length) return result;
  const figures: FigureCounter = { n: 0 };
  const record = (w: TrdWriteup, r: WriteupBlocksResult) => {
    for (const b of r.filled) result.filled.push({ writeup: w, blank: b });
    for (const b of r.open) result.open.push({ writeup: w, blank: b });
    for (const p of r.openFigures) result.openFigures.push({ writeup: w, part: p });
  };
  const { prose, intro, overview: items } = writeupOrder(d);

  // The note on open blanks goes once, at the head of the first section made here. The count is known only after the blocks are made,
  // so the first section's note is filled in afterwards.
  let noteBlock: { type: "note"; text: string } | undefined;
  const note = (): Block[] => {
    if (noteBlock) return [];
    noteBlock = { type: "note", text: "" };
    return [noteBlock];
  };

  for (const w of prose) {
    add(`writeup-${w.key}`, w.title, (n) => {
      const r = writeupBlocks(ctx, w, n, figures);
      record(w, r);
      return [...note(), ...r.blocks];
    });
  }

  if (intro || items.length) {
    add("manufacturing-overview", intro?.title ?? OVERVIEW_TITLE, (n) => {
      const out: Block[] = [...note()];
      if (intro) {
        const r = writeupBlocks(ctx, intro, n, figures);
        record(intro, r);
        out.push(...r.blocks);
      }
      items.forEach((w, i) => {
        const prefix = `${n}.${i + 1}`;
        const r = writeupBlocks(ctx, w, prefix, figures);
        record(w, r);
        out.push({ type: "heading", text: `${prefix} ${w.title}` }, ...r.blocks);
      });
      return out;
    });
  }

  result.pictures = figures.n;
  if (noteBlock) noteBlock.text = openBlanksNote(result.open.length, result.openFigures.length);
  return result;
}

/** The sentence about open blanks and figures, written once the counts are known. */
export function openBlanksNote(open: number, openFigures = 0): string {
  const figs = openFigures ? ` ${openFigures} figure${openFigures === 1 ? " has" : "s have"} no picture yet and ${openFigures === 1 ? "is" : "are"} shown as "Figure to be added".` : "";
  return open
    ? `${open} blank${open === 1 ? " has" : "s have"} no value yet. Each is shown in square brackets and highlighted, and is listed in the appendix "Process description values".${figs}`
    : `Every blank in the process descriptions has a value. The appendix "Process description values" shows where each came from.${figs}`;
}
