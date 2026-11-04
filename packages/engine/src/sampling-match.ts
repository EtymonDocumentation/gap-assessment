import { TYPE_LABEL } from "@gap/sampling";
import { cellKey, clip, containsSeq, headerKindsOf, important, linkCells, norm, sameSeq, SCANNED_PDF_MESSAGE, tableGrid, toks, type GridCell, type UploadRead, type ViewBlock } from "./import-shared";
import {
  checkSamplingValue,
  emptyField,
  resolveSamplingType,
  SAMPLING_COLUMN_LABEL,
  type SamplingColumn,
  type SamplingField,
  type SamplingImportSession,
} from "./sampling-import";
import type { SamplingColumnKind, SamplingImportSynonyms } from "./sampling-synonyms";
import { readValue } from "./trd-value";

/**
 * Level 3 of the sampling plan upload: a plan written by somebody else, in any layout, Word or PDF. FIXED RULES only (no AI):
 *
 *  - The points table is found by the words in its header row (content/sampling-import/synonyms.yaml). Several tables can be points tables.
 *  - Each row of such a table becomes one sampling point to review. Every value read is only a SUGGESTION ("Matched"); the person
 *    accepts it, edits it or leaves it. What the document does not say stays "Not found" and is never filled in for the person.
 *  - A process step is matched to the catalogue by its name or a synonym; the document's wording is kept in the evidence. A step the
 *    catalogue does not know is shown as written and would become a step of the person's own, only if accepted.
 *  - Text and columns that were not used are listed ("Not used yet") so nothing in the document vanishes silently.
 */

export interface SamplingMatchContext {
  syn: SamplingImportSynonyms;
  /** The steps the catalogue knows (key, label); the special "Finished product" is added here. */
  steps: { key: string; label: string }[];
  /** The tests the catalogue knows (used only to say in the evidence that a test is a known one). */
  tests?: { uo: string; attribute: string; type: string }[];
}

interface ColSpec {
  col: number;
  kind: SamplingColumn;
  header: string;
  /** A unit in the heading, "Volume (mL)": a bare number in the column is read with it. */
  unit?: string;
}

const MAX_NOT_USED_PARAS = 12;

function stepPhrases(ctx: SamplingMatchContext): { label: string; toks: string[] }[] {
  const out: { label: string; toks: string[] }[] = [];
  const all = [...ctx.steps, { key: "finished_product", label: "Finished product" }];
  for (const s of all) out.push({ label: s.label, toks: toks(s.label) });
  for (const syn of ctx.syn.steps) {
    const label = all.find((s) => s.key === syn.uo)?.label;
    if (label) for (const w of syn.words) out.push({ label, toks: toks(w) });
  }
  return out.filter((p) => p.toks.length);
}

/** The catalogue step a text names: the whole text, or the one step whose name it contains. Undefined when unclear. */
export function matchStepName(text: string, ctx: SamplingMatchContext): string | undefined {
  const t = toks(text);
  if (!t.length) return undefined;
  const phrases = stepPhrases(ctx);
  const exact = new Set(phrases.filter((p) => sameSeq(p.toks, t)).map((p) => p.label));
  if (exact.size === 1) return [...exact][0];
  if (exact.size > 1) return undefined;
  const hits = phrases.filter((p) => containsSeq(t, p.toks));
  // The longest name wins ("Final filtration" over "Filtration"); two different longest names are unclear.
  const longest = Math.max(0, ...hits.map((h) => h.toks.length));
  const best = new Set(hits.filter((h) => h.toks.length === longest).map((h) => h.label));
  return best.size === 1 ? [...best][0] : undefined;
}

/** The header row of a points table: among the first three rows the one naming most kinds; it must name an attribute or a test. */
function findHeader(grid: GridCell[][], words: { kind: SamplingColumnKind; toks: string[] }[]): { row: number; cols: ColSpec[] } | undefined {
  let best: { row: number; cols: ColSpec[]; kinds: number } | undefined;
  for (let r = 0; r < Math.min(3, grid.length); r++) {
    const cols: ColSpec[] = [];
    const seen = new Set<SamplingColumn>();
    let prev = "";
    grid[r]!.forEach((cell, col) => {
      // A header merged over several columns is read once.
      if (cell.text === prev && col > 0 && grid[r]![col - 1]!.c === cell.c) return;
      prev = cell.text;
      const kinds = headerKindsOf(words, cell.text);
      if (kinds.size !== 1) return;
      const kind = [...kinds][0]!;
      if (seen.has(kind)) return;
      seen.add(kind);
      const unit = /\(([^)]{1,12})\)/.exec(cell.text)?.[1]?.trim();
      cols.push({ col, kind, header: cell.text, ...(unit ? { unit } : {}) });
    });
    const kinds = new Set(cols.map((c) => c.kind));
    if (kinds.size >= 2 && (kinds.has("attribute") || kinds.has("test")) && (!best || kinds.size > best.kinds)) best = { row: r, cols, kinds: kinds.size };
  }
  return best ? { row: best.row, cols: best.cols } : undefined;
}

/** A row that only names a group ("Filling"): one distinct text spread over the row, no values. It sets the step for the rows below. */
function subHeading(cells: GridCell[]): string | undefined {
  const texts = cells.map((c) => c.text).filter(Boolean);
  if (!texts.length) return undefined;
  const distinct = new Set(texts);
  return distinct.size === 1 && (texts.length === 1 || cells.every((c) => !c.text || c.text === texts[0])) && cells.length > 2 ? texts[0] : undefined;
}

/** The nearest heading or paragraph above a table that names a step, e.g. "Sampling at filling". */
function stepAbove(blocks: ViewBlock[], at: number, ctx: SamplingMatchContext): { label: string; text: string } | undefined {
  for (let i = at - 1; i >= Math.max(0, at - 3); i--) {
    const b = blocks[i]!;
    if (b.kind === "table") return undefined;
    const hit = matchStepName(b.text, ctx);
    if (hit) return { label: hit, text: b.text };
  }
  return undefined;
}

function headingAbove(blocks: ViewBlock[], at: number): string {
  for (let i = at - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === "heading") return clip(b.text, 60);
  }
  return "";
}

export function samplingSessionFromOther(read: UploadRead, ctx: SamplingMatchContext): SamplingImportSession {
  const s: SamplingImportSession = {
    level: 3,
    fileName: read.fileName,
    title: emptyField(0, "title", "Plan title", "Not found in the document"),
    rows: [],
    fields: [],
    cellFields: {},
    fieldCells: {},
    blocks: read.blocks,
    notUsed: [],
    readAs: `A document in another layout (${read.format === "pdf" ? "PDF" : "Word"}), read by fixed rules. Everything found is a suggestion for you to check.`,
    matchedTables: [],
  };
  s.fields.push(s.title);
  if (read.noText) {
    s.notUsed.push(SCANNED_PDF_MESSAGE);
    return s;
  }
  // The title of a plan is its first line: a heading, or a short line that is not a sentence or a "label: value" line.
  const first = read.blocks[0];
  if (first && first.kind !== "table" && norm(first.text) && (first.kind === "heading" || (norm(first.text).length <= 100 && !/[:.]s*$/.test(norm(first.text)) && !norm(first.text).includes(":")))) {
    Object.assign(s.title, { value: clip(first.text, 120), confidence: "matched" as const, source: `First line of the document: "${clip(first.text, 120)}"` });
  }

  const words = ctx.syn.columns.flatMap((c) => c.words.map((w) => ({ kind: c.kind, toks: toks(w) }))).filter((w) => w.toks.length);
  let n = 0;
  let tableNo = 0;
  const usedBlocks = new Set<number>();

  read.blocks.forEach((block, bi) => {
    if (block.kind !== "table") return;
    tableNo++;
    const grid = tableGrid(block.rows);
    const head = findHeader(grid, words);
    if (!head) {
      if (grid.length > 1) s.notUsed.push(`Table ${tableNo} (${grid.length - 1} rows) was not used: no column heading looked like a sampling point (step, attribute, test, amount, timing, type).`);
      return;
    }
    const where = headingAbove(read.blocks, bi);
    const label = `Table ${tableNo}${where ? ` under "${where}"` : ""}`;
    const byKind = new Map(head.cols.map((c) => [c.kind, c]));
    const mapped = new Set(head.cols.map((c) => c.col));
    // Columns of the table that mean nothing to the reader are listed, not dropped silently.
    const seenHeader = new Set<string>();
    grid[head.row]!.forEach((cell, col) => {
      if (mapped.has(col) || !cell.text || seenHeader.has(`${cell.r}:${cell.c}`)) return;
      seenHeader.add(`${cell.r}:${cell.c}`);
      s.notUsed.push(`${label}: the column "${clip(cell.text, 40)}" was not used.`);
    });
    const above = byKind.has("step") ? undefined : stepAbove(read.blocks, bi, ctx);
    let context: { label: string | undefined; text: string } | undefined = above ? { label: above.label, text: above.text } : undefined;
    let tableRows = 0;

    for (let r = head.row + 1; r < grid.length; r++) {
      const cells = grid[r]!;
      const sub = subHeading(cells);
      if (sub) {
        context = { label: matchStepName(sub, ctx), text: sub };
        continue;
      }
      const cellText = (k: SamplingColumn) => {
        const c = byKind.get(k);
        return c ? (cells[c.col]?.text ?? "") : "";
      };
      if (head.cols.every((c) => !cells[c.col]?.text)) continue;
      // The same header repeated on the next page of a long table.
      if (head.cols.every((c) => !cells[c.col]?.text || norm(cells[c.col]!.text).toLowerCase() === norm(c.header).toLowerCase())) continue;
      n++;
      tableRows++;
      const rowLabel = `Row ${n}`;
      s.rows.push({ n, label: rowLabel, where: `${label}, line ${r - head.row}` });
      const set = (k: SamplingColumn, value: string, source: string, cellAt?: GridCell, note?: string, dropped?: string) => {
        const f = emptyField(n, k, SAMPLING_COLUMN_LABEL[k], `${label}, line ${r - head.row}: ${SAMPLING_COLUMN_LABEL[k]} not found in the document`) as SamplingField;
        f.table = bi;
        // A step or type that is not known is never offered as Matched: the field stays open (Not found, with the reason)
        // and the document's own words are listed under "Not used yet".
        if (dropped && value) {
          f.source = dropped;
          f.notUsedWhy = `"${clip(value, 60)}" was not used: ${dropped}`;
          s.notUsed.push(`${label}, line ${r - head.row}: ${SAMPLING_COLUMN_LABEL[k]} "${clip(value, 60)}" was not used: ${dropped}`);
        } else if (value) {
          const why = checkSamplingValue(k, value, ctx.syn);
          Object.assign(f, { value, confidence: "matched" as const, source: `${label}, line ${r - head.row}, column "${clip(byKind.get(k)?.header ?? "", 40)}": ${source}${note ? `; ${note}` : ""}`, ...(why ? { unreadable: why } : {}) });
        }
        s.fields.push(f);
        if (value && cellAt && !dropped) linkCells(s, f.id, cellKey(bi, cellAt.r, cellAt.c));
      };
      const at = (k: SamplingColumn) => {
        const c = byKind.get(k);
        return c ? cells[c.col] : undefined;
      };

      // step: the step column, else the group heading, else the heading above the table.
      const stepCell = cellText("step");
      let stepVal = "";
      let stepSrc = "";
      if (stepCell) {
        const m = matchStepName(stepCell, ctx);
        stepVal = m ?? stepCell;
        stepSrc = m && norm(m).toLowerCase() !== norm(stepCell).toLowerCase() ? `"${clip(stepCell, 60)}" is the catalogue step "${m}"` : m ? `"${clip(stepCell, 60)}"` : `"${clip(stepCell, 60)}" (not a step name of the catalogue, it would be a step of your own)`;
      } else if (context) {
        stepVal = context.label ?? context.text;
        stepSrc = context.label ? `from the heading "${clip(context.text, 60)}"` : `from the heading "${clip(context.text, 60)}" (not a step name of the catalogue, it would be a step of your own)`;
      }
      const stepKnown = !!stepVal && (stepCell ? !!matchStepName(stepCell, ctx) : !!context?.label);
      set("step", stepVal, stepSrc || "", at("step"), undefined, stepVal && !stepKnown ? "no process step of this project is called this" : undefined);

      // attribute (a document with only a test column: the test is what is being measured)
      const attr = cellText("attribute");
      const test = cellText("test");
      const known = (a: string) => ctx.tests?.some((t) => norm(t.attribute).toLowerCase() === norm(a).toLowerCase());
      if (attr) set("attribute", attr, `"${clip(attr, 60)}"`, at("attribute"), known(attr) ? "a test of the catalogue" : undefined);
      else if (test && !byKind.has("attribute")) set("attribute", test, `"${clip(test, 60)}" (the document has a test column and no attribute column)`, at("test"), known(test) ? "a test of the catalogue" : undefined);
      else set("attribute", "", "");
      set("test", attr || !byKind.has("attribute") ? (attr ? test : "") : test, test ? `"${clip(test, 60)}"` : "", at("test"));

      // amount: a bare number is read with the unit of the column heading
      const amountCol = byKind.get("amount");
      let amount = cellText("amount");
      let amountNote: string | undefined;
      if (amount && amountCol?.unit) {
        const v = readValue(amount);
        if (v.kind === "number" && !v.unit) {
          amount = `${norm(amount)} ${amountCol.unit}`;
          amountNote = `the unit "${amountCol.unit}" is from the column heading`;
        }
      }
      set("amount", amount, `"${clip(cellText("amount"), 60)}"`, at("amount"), amountNote);

      set("timing", cellText("timing"), `"${clip(cellText("timing"), 60)}"`, at("timing"));

      const typeText = cellText("type");
      const kind = typeText ? resolveSamplingType(typeText, ctx.syn) : undefined;
      set("type", kind ? TYPE_LABEL[kind] : typeText, kind && norm(TYPE_LABEL[kind]).toLowerCase() !== norm(typeText).toLowerCase() ? `"${clip(typeText, 60)}" is the study type "${TYPE_LABEL[kind]}"` : `"${clip(typeText, 60)}"`, at("type"), undefined, typeText && !kind ? "this is not one of the study types of the catalogue" : undefined);
    }
    if (tableRows) {
      usedBlocks.add(bi);
      s.matchedTables!.push({ block: bi, label });
    }
  });

  // Text that looks important and was not part of a points table.
  const paras = read.blocks.filter((b): b is Extract<ViewBlock, { kind: "para" }> => b.kind === "para" && important(b.text));
  paras.slice(0, MAX_NOT_USED_PARAS).forEach((b) => s.notUsed.push(`Text not used: "${clip(b.text, 140)}"`));
  if (paras.length > MAX_NOT_USED_PARAS) s.notUsed.push(`${paras.length - MAX_NOT_USED_PARAS} more passages with amounts or requirements were not used.`);
  if (s.rows.length === 0) s.notUsed.unshift("No points table was recognised in this document. If it has one, its column headings may use words this tool does not know yet.");
  return s;
}
