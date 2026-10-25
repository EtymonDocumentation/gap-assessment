import type { TrdDocument, TrdPart, TrdWriteup } from "@gap/process-model";
import type { Block, Run } from "./document";
import { activeParts, resolveBlank, segmentsOf, type BlankContext, type ResolvedBlank, type TextSeg } from "./trd-writeup";

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

export const OVERVIEW_KEY = "manufacturing_process_overview";
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
}

/**
 * The blocks of one write-up. `prefix` is the number the write-up's own sub-headings continue ("5.2" gives "5.2.1", "5.2.2" ...).
 * Consecutive bullets form one list and consecutive lettered steps form one lettered list.
 */
export function writeupBlocks(ctx: BlankContext, w: TrdWriteup, prefix: string): WriteupBlocksResult {
  const filled = new Map<string, ResolvedBlank>();
  const open = new Map<string, ResolvedBlank>();
  const seen = (b: ResolvedBlank) => (b.filled ? filled : open).set(b.key, b);
  const blocks: Block[] = [];
  if (w.notApplicable?.on) {
    blocks.push({ type: "rich", style: "paragraph", runs: writeupRuns(ctx, w, w.notApplicable.text, seen) });
    return { blocks, filled: [...filled.values()], open: [...open.values()] };
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
    blocks.push(...partBlocks(p, runs, `${prefix}.${p.kind === "subsection" ? ++sub : sub}`));
  }
  flush();
  return { blocks, filled: [...filled.values()], open: [...open.values()] };
}

function partBlocks(p: TrdPart, runs: () => Run[], number: string): Block[] {
  switch (p.kind) {
    case "paragraph":
      return [{ type: "rich", style: "paragraph", runs: runs() }];
    case "note":
      return [{ type: "rich", style: "note", runs: runs() }];
    case "figure":
      // The drawing itself is the author's to add; the placeholder says what belongs here.
      return [{ type: "rich", style: "note", runs: [{ text: "Figure to be added: ", bold: true }, ...runs()] }];
    case "subsection":
      return [{ type: "heading", text: `${number} ${p.title ?? ""}`.trim(), level: 2 }];
    case "heading":
      return [{ type: "heading", text: p.title ?? "", level: 2 }];
    case "table": {
      const cols = p.columns ?? [];
      // A table with no rows yet still shows its column heads and one empty row to fill in.
      return [{ type: "table", columns: cols, rows: p.rows?.length ? p.rows : [cols.map(() => "")] }];
    }
    default:
      return [];
  }
}

// ------------------------------------------------------------------ sections

export interface WriteupSectionsResult {
  filled: { writeup: TrdWriteup; blank: ResolvedBlank }[];
  open: { writeup: TrdWriteup; blank: ResolvedBlank }[];
}

type AddSection = (id: string, title: string, make: (number: string) => Block[]) => void;

/** True when the TRD has any write-up. A TRD without write-ups exports exactly as it did before write-ups existed. */
export const hasWriteups = (d: TrdDocument): boolean => Boolean(d.writeups?.length);

/**
 * Adds the sections made from the write-ups: first the TRD-level prose sections (each its own numbered section), then the
 * "Manufacturing process overview" with one numbered sub-section per step. `add` creates a section and tells the function its number.
 */
export function addWriteupSections(ctx: BlankContext, d: TrdDocument, add: AddSection): WriteupSectionsResult {
  const result: WriteupSectionsResult = { filled: [], open: [] };
  const all = d.writeups ?? [];
  if (!all.length) return result;
  const record = (w: TrdWriteup, r: WriteupBlocksResult) => {
    for (const b of r.filled) result.filled.push({ writeup: w, blank: b });
    for (const b of r.open) result.open.push({ writeup: w, blank: b });
  };
  const intro = all.find((w) => w.kind === "section" && w.key === OVERVIEW_KEY);
  const prose = all.filter((w) => w.kind === "section" && w.key !== OVERVIEW_KEY && !w.placement);
  const placed = all.filter((w) => w.kind === "section" && w.key !== OVERVIEW_KEY && w.placement);
  const unitOps = all.filter((w) => w.kind === "unitOp");

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
      const r = writeupBlocks(ctx, w, n);
      record(w, r);
      return [...note(), ...r.blocks];
    });
  }

  const hasOverview = Boolean(intro) || placed.length > 0 || unitOps.length > 0;
  if (hasOverview) {
    add("manufacturing-overview", intro?.title ?? OVERVIEW_TITLE, (n) => {
      const out: Block[] = [...note()];
      if (intro) {
        const r = writeupBlocks(ctx, intro, n);
        record(intro, r);
        out.push(...r.blocks);
      }
      let i = 0;
      const emit = (w: TrdWriteup) => {
        const prefix = `${n}.${++i}`;
        const r = writeupBlocks(ctx, w, prefix);
        record(w, r);
        out.push({ type: "heading", text: `${prefix} ${w.title}` }, ...r.blocks);
      };
      const used = new Set<string>();
      const take = (w: TrdWriteup) => {
        used.add(w.id);
        emit(w);
      };
      const placedAt = (where: "before" | "after", unitOp: string | undefined) => placed.filter((w) => w.placement?.where === where && w.placement.unitOp === unitOp && !used.has(w.id));
      for (const s of d.steps) {
        if (s.key) placedAt("before", s.key).forEach(take);
        unitOps.filter((w) => w.stepId === s.id && !used.has(w.id)).forEach(take);
        if (s.key) placedAt("after", s.key).forEach(take);
      }
      // Write-ups placed by a step the TRD does not have, and process descriptions whose step is gone, still appear (never dropped
      // silently), then the "last" ones.
      placed.filter((w) => w.placement?.where !== "last" && !used.has(w.id)).forEach(take);
      unitOps.filter((w) => !used.has(w.id)).forEach(take);
      placed.filter((w) => w.placement?.where === "last" && !used.has(w.id)).forEach(take);
      return out;
    });
  }

  if (noteBlock) noteBlock.text = openBlanksNote(result.open.length);
  return result;
}

/** The sentence about open blanks, written once the counts are known. */
export function openBlanksNote(open: number): string {
  return open
    ? `${open} blank${open === 1 ? " has" : "s have"} no value yet. Each is shown in square brackets and highlighted, and is listed in the appendix "Process description values".`
    : "Every blank in the process descriptions has a value. The appendix \"Process description values\" shows where each came from.";
}
