import type { Catalog } from "@gap/process-model";
import { buildBlankFormSpec, formControls, partId, type ImportField, type ImportSession, type UploadRead, type ViewBlock, type ViewCell } from "./trd-import";
import type { ColumnKind, TrdSynonyms } from "./trd-synonyms";
import { readValue, type ReadValue } from "./trd-value";
import { clip, containsSeq, headerKindsOf, important, norm, sameSeq, tableGrid, toks, type GridCell } from "./import-shared";

// Shared with the sampling plan upload; re-exported so existing imports keep working.
export { tableGrid } from "./import-shared";

/**
 * Upload a finished TRD, level 3 (job I2): ANY OTHER WORD OR PDF. The file is already split into headings, paragraphs and tables
 * (Word: word/document.xml; PDF: text lines and simple column tables). This module matches what it recognises with FIXED RULES (word
 * lists in content/trd-import/synonyms.yaml and the parameter catalog; no AI) and builds the same review session the other levels use.
 *
 * What the rules guarantee (each one is a GMP or product rule, not a convenience):
 *  - EVERY MATCH IS A SUGGESTION. It is labelled "Matched", it is never "exact", so "Accept all exact" never takes it. The person
 *    accepts it (per row, or per table they can see) or leaves it; what is left stays NOT ESTABLISHED and becomes an open item.
 *  - NOTHING IS GUESSED. A row that could belong to two steps, a column that does not say NOR or PAR, a comma between digits, a
 *    plus-or-minus value, a "fill weight" without a volume unit: each is left out and listed under "Not used yet" with the reason.
 *  - UNITS ARE NEVER CONVERTED. A value keeps the unit the file states; where the file states none, a unit in the Unit column, the
 *    column heading or the row name is used and says so. The original text of every cell is kept as the evidence.
 *  - NOTHING DISAPPEARS SILENTLY. Text that looks important (numbers with units, "shall", "must", "limit") and was not used is listed.
 */

// ------------------------------------------------------------------ words

// ------------------------------------------------------------------ the word index

interface ParamPhrase {
  uo: string;
  key: string;
  label: string;
  toks: string[];
  /** Only counts when the unit states one of these units ("fill weight" is a fill volume only with a volume unit). */
  needsUnit?: string[];
  needsKind?: string;
}

interface Index {
  sections: { field: string; toks: string[] }[];
  labels: { field: string; toks: string[] }[];
  columns: { kind: ColumnKind; toks: string[] }[];
  steps: { uo: string; toks: string[] }[];
  params: ParamPhrase[];
  unitKinds: Map<string, Set<string>>;
  stepLabel: Map<string, string>;
  paramsByStep: Map<string, ParamPhrase[]>;
}

function buildIndex(catalog: Catalog, syn: TrdSynonyms): Index {
  const unitKinds = new Map<string, Set<string>>(Object.entries(syn.unitKinds).map(([k, ws]) => [k, new Set(ws.map((w) => w.toLowerCase()))]));
  const stepLabel = new Map(catalog.unitOperations.map((u) => [u.key, u.label]));
  const steps: Index["steps"] = [];
  for (const u of catalog.unitOperations) steps.push({ uo: u.key, toks: toks(u.label) });
  for (const s of syn.steps) for (const w of s.words) steps.push({ uo: s.uo, toks: toks(w) });
  const params: ParamPhrase[] = [];
  for (const u of catalog.unitOperations)
    for (const i of u.items)
      if (i.coll === "param") {
        params.push({ uo: u.key, key: i.key, label: i.label, toks: toks(i.label) });
        for (const s of syn.parameters.filter((x) => x.uo === u.key && x.key === i.key)) {
          for (const w of s.words) params.push({ uo: u.key, key: i.key, label: i.label, toks: toks(w) });
          for (const o of s.onlyWithUnit) for (const w of o.words) params.push({ uo: u.key, key: i.key, label: i.label, toks: toks(w), needsKind: o.kind, needsUnit: [...(unitKinds.get(o.kind) ?? [])] });
        }
      }
  const paramsByStep = new Map<string, ParamPhrase[]>();
  for (const p of params) paramsByStep.set(p.uo, [...(paramsByStep.get(p.uo) ?? []), p]);
  return {
    sections: syn.sections.flatMap((s) => s.words.map((w) => ({ field: s.field, toks: toks(w) }))),
    labels: syn.labels.flatMap((s) => s.words.map((w) => ({ field: s.field, toks: toks(w) }))),
    columns: syn.columns.flatMap((s) => s.words.map((w) => ({ kind: s.kind, toks: toks(w) }))),
    steps,
    params,
    unitKinds,
    stepLabel,
    paramsByStep,
  };
}

const knownUnit = (ix: Index, u: string) => [...ix.unitKinds.values()].some((set) => set.has(u.trim().toLowerCase()));

/** The steps a piece of text names: those with the longest matching phrase (a tie keeps all of them, which the caller treats as unclear). */
function stepsIn(ix: Index, text: string): Set<string> | undefined {
  const t = toks(text);
  let best = 0;
  let hit = new Set<string>();
  for (const s of ix.steps) {
    if (!containsSeq(t, s.toks)) continue;
    if (s.toks.length > best) {
      best = s.toks.length;
      hit = new Set([s.uo]);
    } else if (s.toks.length === best) hit.add(s.uo);
  }
  return hit.size ? hit : undefined;
}

// ------------------------------------------------------------------ headers and columns

/** Words in brackets that are a unit ("Set point (°C)") are a unit hint; other bracketed words ("(NOR)") stay part of the text. */
function splitHint(ix: Index, raw: string): { text: string; hint?: string } {
  let hint: string | undefined;
  const text = raw.replace(/[([]([^)\]]{1,14})[)\]]/g, (_all, inner: string) => {
    const t = inner.trim();
    const isColumnWord = ix.columns.some((c) => c.kind !== "unit" && sameSeq(c.toks, toks(t)));
    if (knownUnit(ix, t) || (!isColumnWord && t.length <= 6 && !t.includes(" ") && /[°%/µ]|^[a-z]{1,4}$/i.test(t))) {
      hint ??= t;
      return " ";
    }
    return ` ${t} `;
  });
  return { text, ...(hint ? { hint } : {}) };
}

/** The column kinds a header text names. "Lower limit" is a low end, not "limit"; "hold time" is not "time". */
function headerKinds(ix: Index, text: string): Set<ColumnKind> {
  return headerKindsOf(ix.columns, text);
}

type ColSpec =
  | { kind: "name" }
  | { kind: "step" }
  | { kind: "unit" }
  | { kind: "set" }
  | { kind: "range"; range: "nor" | "par" }
  | { kind: "part"; range: "nor" | "par"; end: "low" | "high" }
  | { kind: "unresolved"; why: string }
  | { kind: "ignored" };

function resolveColumn(kinds: Set<ColumnKind>, label: string): ColSpec {
  if (kinds.size === 0) return { kind: "ignored" };
  const ranges = (["nor", "par"] as const).filter((k) => kinds.has(k));
  const ends = (["low", "high"] as const).filter((k) => kinds.has(k));
  if (ranges.length === 2) return { kind: "unresolved", why: `the heading "${label}" names both NOR and PAR` };
  if (ranges.length === 1) {
    if (ends.length === 2) return { kind: "unresolved", why: `the heading "${label}" names both a low and a high end` };
    return ends.length === 1 ? { kind: "part", range: ranges[0]!, end: ends[0]! } : { kind: "range", range: ranges[0]! };
  }
  const rest = [...kinds].filter((k) => k !== "low" && k !== "high");
  if (rest.length === 1 && ends.length === 0) {
    const k = rest[0]!;
    if (k === "name" || k === "step" || k === "unit" || k === "set") return { kind: k };
  }
  if (rest.length === 0 && ends.length > 0) return { kind: "unresolved", why: `the heading "${label}" does not say whether it is a NOR or a PAR value` };
  if (rest.every((k) => k === "limit" || k === "hold" || k === "time") && rest.length > 0) return { kind: "unresolved", why: `the heading "${label}" does not say whether it is a NOR or a PAR value` };
  return { kind: "unresolved", why: `the heading "${label}" could mean more than one thing` };
}

// ------------------------------------------------------------------ the table as a grid

const sameOrigin = (a: GridCell, b: GridCell) => a.r === b.r && a.c === b.c;
const cellKey = (b: number, r: number, c: number) => `${b}:${r}:${c}`;

// ------------------------------------------------------------------ the matcher

interface TableCtx {
  blockIndex: number;
  /** "Table 2" or "Page 3, table 2", plus the heading it sits under. */
  where: string;
}

class Matcher {
  fields = new Map<string, ImportField>();
  notUsed: string[] = [];
  usedCells = new Set<string>();
  usedBlocks = new Set<number>();
  cellFields: Record<string, string[]> = {};
  fieldCells: Record<string, string[]> = {};
  matchedTables: { block: number; label: string }[] = [];
  private tableCount = 0;

  constructor(
    private read: UploadRead,
    private ix: Index,
  ) {}

  setField(id: string, value: string, source: string, cells: string[], table?: TableCtx): boolean {
    const f = this.fields.get(id);
    if (!f) return false;
    if (f.value !== "") {
      this.notUsed.push(`${table?.where ?? "Text"}: "${clip(value)}" for ${f.sub ? `${f.sub}, ` : ""}${f.label} was not used: it already has "${clip(f.value, 60)}" from ${f.source}.`);
      for (const k of cells) this.usedCells.add(k);
      return true;
    }
    f.value = value;
    f.confidence = "matched";
    f.source = source;
    if (table) {
      f.table = table.blockIndex;
      if (!this.matchedTables.some((t) => t.block === table.blockIndex)) this.matchedTables.push({ block: table.blockIndex, label: table.where });
    }
    for (const k of cells) {
      this.usedCells.add(k);
      (this.cellFields[k] ??= []).push(id);
      (this.fieldCells[id] ??= []).push(k);
    }
    return true;
  }

  /** Heading, paragraph and table walk. */
  run(): void {
    const blocks = this.read.blocks;
    const stack: { level: number; text: string }[] = [];
    let section: { field: string; heading: string; first: number; paras: string[]; blocks: number[] } | undefined;
    const closeSection = () => {
      if (!section) return;
      const text = section.paras.join("\n\n");
      if (text) {
        const where = `${this.pageOf(section.first)}heading "${section.heading}"`;
        this.setField(section.field, text, `${where}: the text below it`, []);
        for (const b of section.blocks) this.usedBlocks.add(b);
      }
      section = undefined;
    };
    blocks.forEach((b, bi) => {
      const head = this.asHeading(b);
      if (head) {
        closeSection();
        while (stack.length && stack[stack.length - 1]!.level >= head.level) stack.pop();
        stack.push(head);
        const t = toks(head.text).filter((w, i, all) => !(i === 0 && /^\d+$/.test(w) && all.length > 1));
        const hit = this.ix.sections.find((s) => sameSeq(s.toks, t) || (s.toks.length >= 2 && containsSeq(t, s.toks)));
        if (hit) {
          if (this.fields.get(hit.field)?.value) this.notUsed.push(`${this.pageOf(bi)}heading "${clip(head.text, 60)}" also looks like ${this.fields.get(hit.field)!.label}, which was already taken from another heading, so it was not used.`);
          else section = { field: hit.field, heading: head.text, first: bi, paras: [], blocks: [] };
          this.usedBlocks.add(bi);
        }
        return;
      }
      if (b.kind === "para") {
        // "Label: value" lines.
        const kv = /^([^:]{2,40}):\s*(.+)$/.exec(norm(b.text));
        if (kv) {
          const hit = this.labelFor(kv[1]!);
          if (hit && this.setField(hit, kv[2]!.trim(), `${this.pageOf(bi)}line "${clip(b.text, 80)}"`, [])) {
            this.usedBlocks.add(bi);
            return;
          }
        }
        if (section) {
          section.paras.push(norm(b.text));
          section.blocks.push(bi);
        }
        return;
      }
      if (b.kind === "table") {
        closeSection();
        this.table(b, bi, stack, blocks[bi - 1]);
      }
    });
    closeSection();
    this.listUnused();
  }

  private pageOf(bi: number): string {
    const p = this.read.blocks[bi]?.page;
    return p ? `Page ${p}, ` : "";
  }

  private asHeading(b: ViewBlock): { level: number; text: string } | undefined {
    if (b.kind === "heading") return { level: b.level, text: b.text };
    // A numbered line with no sentence end is a heading even when the file does not mark it ("3.1 Process parameters").
    if (b.kind === "para" && b.text.length <= 70 && /^\d+(?:\.\d+){0,4}\.?\s+\p{Lu}/u.test(b.text) && !/[.;,:]$/.test(b.text.trim())) return { level: (b.text.match(/\./g)?.length ?? 0) + 1, text: b.text };
    return undefined;
  }

  private labelFor(label: string): string | undefined {
    const t = toks(label);
    const hit = this.ix.labels.find((l) => sameSeq(l.toks, t));
    return hit && this.fields.has(hit.field) ? hit.field : undefined;
  }

  /** The steps the headings above a table (and its caption) name. */
  private stepContext(stack: readonly { text: string }[], caption: ViewBlock | undefined): { uos: Set<string>; from: string } | undefined {
    if (caption?.kind === "para" && caption.text.length <= 120) {
      const hit = stepsIn(this.ix, caption.text);
      if (hit && /^table\b/i.test(caption.text.trim())) return { uos: hit, from: caption.text.trim() };
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const hit = stepsIn(this.ix, stack[i]!.text);
      if (hit) return { uos: hit, from: stack[i]!.text };
    }
    return undefined;
  }

  private table(b: Extract<ViewBlock, { kind: "table" }>, bi: number, stack: readonly { level: number; text: string }[], before: ViewBlock | undefined): void {
    this.tableCount++;
    const under = stack.length ? ` under "${clip(stack[stack.length - 1]!.text, 50)}"` : "";
    const ctx: TableCtx = { blockIndex: bi, where: `${b.page ? `Page ${b.page}, table` : "Table"} ${this.tableCount}${under}` };
    const grid = tableGrid(b.rows);
    const width = Math.max(0, ...grid.map((r) => r.length));
    const keyOf = (g: GridCell) => cellKey(bi, g.r, g.c);

    // Leading rows that are one cell across the whole table are a caption, not a header.
    let first = 0;
    while (first < grid.length && grid[first]!.length > 1 && grid[first]!.every((g) => sameOrigin(g, grid[first]![0]!))) {
      this.usedCells.add(keyOf(grid[first]![0]!));
      first++;
    }

    // Header rows: consecutive rows from there (at most three) in which at least two columns carry a known heading word.
    const headerRows: number[] = [];
    for (let r = first; r < Math.min(grid.length, first + 3); r++) {
      // Count cells, not grid columns: one merged "NOR" over two columns is one heading word.
      const named = new Set(grid[r]!.filter((g) => headerKinds(this.ix, splitHint(this.ix, g.text).text).size > 0).map((g) => cellKey(bi, g.r, g.c)));
      // A row with numbers in it is data, even if its name and unit cells ("Filtration duration", "min") look like heading words.
      const hasNumber = grid[r]!.some((g) => ["number", "range", "max", "min"].includes(readValue(g.text).kind));
      if (named.size >= 2 && !hasNumber) headerRows.push(r);
      else break;
    }
    if (headerRows.length === 0) {
      this.plainTable(bi, grid, ctx);
      return;
    }
    const specs: ColSpec[] = [];
    const hints: (string | undefined)[] = [];
    const labels: string[] = [];
    for (let c = 0; c < width; c++) {
      const kinds = new Set<ColumnKind>();
      const texts: string[] = [];
      let hint: string | undefined;
      for (const r of headerRows) {
        const g = grid[r]![c];
        if (!g) continue;
        const sp = splitHint(this.ix, g.text);
        hint ??= sp.hint;
        for (const k of headerKinds(this.ix, sp.text)) kinds.add(k);
        if (g.text && !texts.includes(g.text)) texts.push(g.text);
        this.usedCells.add(keyOf(g));
      }
      labels[c] = texts.join(" ");
      hints[c] = hint;
      specs[c] = resolveColumn(kinds, labels[c]!);
    }
    let nameCol = specs.findIndex((s) => s.kind === "name");
    if (nameCol < 0 && specs[0] && specs[0].kind === "ignored") nameCol = 0;
    const stepCol = specs.findIndex((s) => s.kind === "step");
    const unitCol = specs.findIndex((s) => s.kind === "unit");
    if (nameCol < 0) {
      this.plainTable(bi, grid, ctx);
      return;
    }
    const valueCols = specs.map((s, i) => (s.kind === "set" || s.kind === "range" || s.kind === "part" ? i : -1)).filter((i) => i >= 0);
    const unresolvedCols = specs.map((s, i) => (s.kind === "unresolved" ? i : -1)).filter((i) => i >= 0);
    if (!valueCols.length) {
      // No column says what it holds in terms of set point, NOR or PAR: nothing to match; the cells are listed.
      for (const i of unresolvedCols) this.notUsed.push(`${ctx.where}: the column "${labels[i]}" was not used because ${(specs[i] as { why: string }).why}. Use "Pick from document" on the field it belongs to.`);
      this.plainTable(bi, grid, ctx);
      return;
    }
    for (const i of unresolvedCols) this.notUsed.push(`${ctx.where}: the column "${labels[i]}" was not used because ${(specs[i] as { why: string }).why}. Use "Pick from document" on the field it belongs to.`);

    // Data rows.
    let rowStep: { uos: Set<string>; from: string } | undefined;
    const headCtx = this.stepContext(stack, before);
    for (let r = headerRows[headerRows.length - 1]! + 1; r < grid.length; r++) {
      const row = grid[r]!;
      if (row.every((g) => !g.text)) continue;
      // One cell across the whole row: a sub-heading ("Sterile filtration") that sets the step for the rows below.
      if (row.length > 1 && row.every((g) => sameOrigin(g, row[0]!))) {
        this.usedCells.add(keyOf(row[0]!));
        const hit = stepsIn(this.ix, row[0]!.text);
        rowStep = hit ? { uos: hit, from: row[0]!.text } : rowStep;
        continue;
      }
      // A header repeated at a page break.
      if (row.filter((g) => headerKinds(this.ix, splitHint(this.ix, g.text).text).size > 0).length >= 2 && !valueCols.some((c) => readValue(row[c]?.text ?? "").kind !== "none")) {
        for (const g of row) this.usedCells.add(keyOf(g));
        continue;
      }
      this.dataRow(row, r, { ctx, specs, hints, labels, nameCol, stepCol, unitCol, valueCols, unresolvedCols, rowStep, headCtx, bi });
    }
  }

  private dataRow(
    row: GridCell[],
    r: number,
    t: {
      ctx: TableCtx;
      specs: ColSpec[];
      hints: (string | undefined)[];
      labels: string[];
      nameCol: number;
      stepCol: number;
      unitCol: number;
      valueCols: number[];
      unresolvedCols: number[];
      rowStep: { uos: Set<string>; from: string } | undefined;
      headCtx: { uos: Set<string>; from: string } | undefined;
      bi: number;
    },
  ): void {
    const { ctx, specs, hints, labels } = t;
    const keyOf = (g: GridCell) => cellKey(t.bi, g.r, g.c);
    const nameCell = row[t.nameCol];
    const rawName = nameCell?.text ?? "";
    if (!rawName) return;
    const nameSplit = splitHint(this.ix, rawName);
    const nameToks = toks(nameSplit.text);
    const rowWhere = `${ctx.where}, row "${clip(rawName, 60)}"`;

    // The step: a step column wins over a sub-heading row, which wins over the headings above the table.
    let step = t.headCtx;
    if (t.rowStep) step = t.rowStep;
    if (t.stepCol >= 0 && row[t.stepCol]?.text) {
      const hit = stepsIn(this.ix, row[t.stepCol]!.text);
      if (hit) {
        step = { uos: hit, from: row[t.stepCol]!.text };
        this.usedCells.add(keyOf(row[t.stepCol]!));
      } else this.notUsed.push(`${rowWhere}: the step "${clip(row[t.stepCol]!.text, 50)}" is not a step this tool knows, so the row was not matched.`);
    }

    // Values of the row.
    interface Piece {
      part: "set" | "nor_low" | "nor_high" | "par_low" | "par_high";
      value: number;
      unit?: string;
      original: string;
      col: number;
      strict?: boolean;
    }
    const pieces: Piece[] = [];
    const problems: { col: number; text: string; why: string }[] = [];
    for (const c of t.valueCols) {
      const g = row[c];
      const spec = specs[c]!;
      if (!g || !g.text) continue;
      const v: ReadValue = readValue(g.text);
      if (v.kind === "blank") {
        this.usedCells.add(keyOf(g));
        continue;
      }
      const bad = (why: string) => problems.push({ col: c, text: g.text, why });
      if (v.kind === "none") {
        bad("it is not a number the review can read");
        continue;
      }
      if (v.kind === "refused") {
        bad(v.reason);
        continue;
      }
      const base = { col: c, original: v.original };
      if (spec.kind === "set") {
        if (v.kind === "number") pieces.push({ ...base, part: "set", value: v.value, ...(v.unit ? { unit: v.unit } : {}) });
        else bad("a set point is one number, and this is a range or a limit");
      } else if (spec.kind === "range") {
        const lo = `${spec.range}_low` as Piece["part"];
        const hi = `${spec.range}_high` as Piece["part"];
        if (v.kind === "range") {
          pieces.push({ ...base, part: lo, value: v.low, ...((v.lowUnit ?? v.unit) ? { unit: (v.lowUnit ?? v.unit)! } : {}) });
          pieces.push({ ...base, part: hi, value: v.high, ...((v.highUnit ?? v.unit) ? { unit: (v.highUnit ?? v.unit)! } : {}) });
        } else if (v.kind === "max") pieces.push({ ...base, part: hi, value: v.value, ...(v.unit ? { unit: v.unit } : {}), ...(v.strict ? { strict: true } : {}) });
        else if (v.kind === "min") pieces.push({ ...base, part: lo, value: v.value, ...(v.unit ? { unit: v.unit } : {}), ...(v.strict ? { strict: true } : {}) });
        else bad("a single number in a range column does not say whether it is the low or the high end");
      } else if (spec.kind === "part") {
        const part = `${spec.range}_${spec.end}` as Piece["part"];
        const fits = v.kind === "number" || (v.kind === "min" && spec.end === "low") || (v.kind === "max" && spec.end === "high");
        if (fits) pieces.push({ ...base, part, value: (v as { value: number }).value, ...((v as { unit?: string }).unit ? { unit: (v as { unit?: string }).unit! } : {}), ...((v as { strict?: boolean }).strict ? { strict: true } : {}) });
        else bad(`the ${spec.end === "low" ? "low" : "high"} end of ${spec.range.toUpperCase()} is one number, and this is a range or points the other way`);
      }
    }

    // The unit of the row: the Unit column, else the unit the cells state, else a unit in a heading or in the row name.
    const unitText = t.unitCol >= 0 ? readUnit(row[t.unitCol]?.text) : undefined;
    const stated = [...new Set(pieces.map((p) => p.unit).filter((u): u is string => Boolean(u)))];
    const hintPool = [...new Set([...pieces.map((p) => hints[p.col]), nameSplit.hint].filter((u): u is string => Boolean(u)))];
    const rowUnit = unitText ?? (stated.length === 1 ? stated[0] : undefined) ?? (stated.length === 0 && hintPool.length === 1 ? hintPool[0] : undefined);
    const unitIsFrom = unitText ? "the Unit column" : stated.length === 1 ? "the cells" : "the column heading or the row name";

    const found = this.findParam(nameToks, step?.uos, rowUnit ?? stated[0]);
    if (!found.hit) {
      // The row is not matched; what looks important in it is listed with the reason.
      // A bare number under a "Set point" or "NOR" heading is a value too, even without a unit.
      const cells = row.filter((g, i) => i !== t.nameCol && g.text && (important(g.text) || (t.valueCols.includes(i) && /\d/.test(g.text))) && !this.usedCells.has(keyOf(g)));
      if (cells.length) this.notUsed.push(`${rowWhere}: ${[...new Set(cells.map((g) => `"${clip(g.text, 60)}"`))].join(", ") || "the row"} was not used: ${found.why}.`);
      this.usedCells.add(keyOf(nameCell!));
      for (const g of row) this.usedCells.add(keyOf(g));
      return;
    }
    const hit = found.hit;
    const ref = hit.uo;
    this.usedCells.add(keyOf(nameCell!));
    const via = nameToks.length && !sameSeq(nameToks, hit.toks) ? `; "${clip(rawName, 50)}" was read as "${hit.label}"` : "";
    const stepNote = step ? `; step from "${clip(step.from, 50)}"` : "";

    for (const p of pieces) {
      const own = p.unit;
      // Numbers are bare when the row has one unit (it goes into the Unit field); otherwise the unit stays with the number.
      const keep = own !== undefined && (rowUnit === undefined || own !== rowUnit);
      const text = keep ? `${p.value} ${own}` : String(p.value);
      const g = row[p.col]!;
      const strictNote = p.strict ? `; it is written as strictly ${p.part.endsWith("low") ? "greater" : "less"} than, and the TRD keeps the number as the ${p.part.endsWith("low") ? "lower" : "upper"} end` : "";
      this.setField(partId(ref, hit.key, p.part), text, `${rowWhere}, column ${clip(labels[p.col]!, 40)}: "${clip(p.original, 80)}"${stepNote}${via}${strictNote}`, [keyOf(g)], ctx);
    }
    if (rowUnit && pieces.some((p) => !p.unit || p.unit === rowUnit)) {
      const unitCell = t.unitCol >= 0 && unitText ? [keyOf(row[t.unitCol]!)] : pieces.filter((p) => p.unit === rowUnit).map((p) => keyOf(row[p.col]!));
      this.setField(partId(ref, hit.key, "unit"), rowUnit, `${rowWhere}: unit taken from ${unitIsFrom}${unitText ? ` ("${unitText}")` : ""}${stepNote}${via}`, unitCell, ctx);
    }
    if (t.unitCol >= 0) this.usedCells.add(keyOf(row[t.unitCol]!));
    for (const p of problems) {
      this.usedCells.add(keyOf(row[p.col]!));
      this.notUsed.push(`${rowWhere}, column ${clip(labels[p.col]!, 40)}: "${clip(p.text, 60)}" was not used because ${p.why}.`);
    }
    for (const i of t.unresolvedCols) {
      const g = row[i];
      if (g?.text && important(g.text)) {
        this.usedCells.add(keyOf(g));
        this.notUsed.push(`${rowWhere}, column ${clip(labels[i]!, 40)}: "${clip(g.text, 60)}" was not used (${(specs[i] as { why: string }).why}).`);
      }
    }
  }

  /** The catalog parameter a row name stands for. Never a guess: no step, an unclear step or a unit that does not fit leave the row out. */
  private findParam(nameToks: string[], ctx: Set<string> | undefined, unit: string | undefined): { hit?: ParamPhrase; why: string } {
    if (!nameToks.length) return { why: "the row has no name" };
    const best = new Map<string, { p: ParamPhrase; score: number }>();
    let unitBlocked: ParamPhrase | undefined;
    for (const p of this.ix.params) {
      let score = 0;
      if (sameSeq(nameToks, p.toks)) score = 3;
      else if (containsSeq(nameToks, p.toks)) score = 2;
      else if (ctx && ctx.has(p.uo) && nameToks.length >= 2 && containsSeq(p.toks, nameToks)) score = 1;
      if (!score) continue;
      if (p.needsUnit && !(unit && p.needsUnit.includes(unit.trim().toLowerCase()))) {
        unitBlocked ??= p;
        continue;
      }
      const k = `${p.uo}|${p.key}`;
      const now = best.get(k);
      if (!now || score > now.score) best.set(k, { p, score });
    }
    let cands = [...best.values()];
    if (!cands.length) {
      if (unitBlocked) return { why: `"${unitBlocked.toks.join(" ")}" only counts as ${unitBlocked.label.toLowerCase()} when the document gives a ${unitBlocked.needsKind} unit (${unit ? `it gives "${unit}"` : "it gives none"})` };
      return { why: "no parameter of this tool has that name" };
    }
    if (ctx) {
      const inStep = cands.filter((c) => ctx.has(c.p.uo));
      if (!inStep.length) return { why: `no parameter with that name is known in ${[...ctx].map((u) => this.ix.stepLabel.get(u) ?? u).join(" or ")}` };
      cands = inStep;
    }
    const top = Math.max(...cands.map((c) => c.score));
    const tops = cands.filter((c) => c.score === top);
    if (tops.length > 1) return { why: `the name fits ${tops.length} steps (${tops.map((c) => this.ix.stepLabel.get(c.p.uo) ?? c.p.uo).join(", ")}) and the headings do not say which` };
    return { hit: tops[0]!.p, why: "" };
  }

  /** A table with no parameter header: two-column "label | value" rows fill document and product fields, the rest is listed. */
  private plainTable(bi: number, grid: GridCell[][], ctx: TableCtx): void {
    const keyOf = (g: GridCell) => cellKey(bi, g.r, g.c);
    grid.forEach((row) => {
      if (row.length < 2 || !row[0]!.text) return;
      const field = this.labelFor(row[0]!.text);
      const value = row[1]!.text;
      if (field && value && !sameOrigin(row[0]!, row[1]!)) {
        this.setField(field, value, `${ctx.where}, row "${clip(row[0]!.text, 60)}": "${clip(value, 80)}"`, [keyOf(row[1]!), keyOf(row[0]!)], ctx);
      }
    });
  }

  /** Everything that looks important and was not used, in the order of the document. */
  private listUnused(): void {
    const out: string[] = [];
    let tableNo = 0;
    this.read.blocks.forEach((b, bi) => {
      if (b.kind === "para") {
        if (!this.usedBlocks.has(bi) && important(b.text)) out.push(`${this.pageOf(bi)}text "${clip(b.text)}"`);
        return;
      }
      if (b.kind !== "table") return;
      tableNo++;
      const where = `${b.page ? `Page ${b.page}, table` : "Table"} ${tableNo}`;
      b.rows.forEach((row, r) => {
        const left = row.map((c, ci) => ({ c, ci })).filter(({ c, ci }) => c.text && !c.vContinue && !this.usedCells.has(cellKey(bi, r, ci)) && important(c.text));
        if (left.length) out.push(`${where}, row ${r + 1} "${clip(row[0]?.text ?? "", 40)}": ${left.map(({ c }) => `"${clip(c.text, 60)}"`).join(", ")}`);
      });
    });
    const MAX = 40;
    this.notUsed.push(...out.slice(0, MAX).map((s) => `${s} was not matched to a field.`));
    if (out.length > MAX) this.notUsed.push(`${out.length - MAX} more pieces of text that look important were not matched to a field.`);
  }
}

/** A unit column cell: the text, unless it is empty or "not applicable". */
function readUnit(text: string | undefined): string | undefined {
  const t = norm(text);
  return !t || /^(?:-|–|n\/?a|na|none|see cells)$/i.test(t) ? undefined : t;
}

// ------------------------------------------------------------------ the session

/**
 * Level 3: a Word or PDF file in a layout this tool did not write. Every field of the blank form exists (so a person can pick a value
 * for any of them); those the rules recognised carry a suggestion and the word "Matched"; the rest are "Not found" and stay open.
 */
export function sessionFromOther(read: UploadRead, catalog: Catalog, synonyms: TrdSynonyms): ImportSession {
  const ix = buildIndex(catalog, synonyms);
  const form = buildBlankFormSpec(catalog);
  const m = new Matcher(read, ix);
  const multiline = new Set(form.document.filter((c) => c.multiline).map((c) => c.id));
  for (const c of formControls(form)) {
    m.fields.set(c.id, {
      id: c.id,
      group: c.group,
      ...(c.sub ? { sub: c.sub } : {}),
      label: c.label,
      value: "",
      confidence: "not_found",
      source: "Not found in the file",
      ...(multiline.has(c.id) ? { multiline: true } : {}),
    });
  }
  m.run();
  const fields = [...m.fields.values()];
  return {
    level: 3,
    fileName: read.fileName,
    fields,
    cellFields: m.cellFields,
    fieldCells: m.fieldCells,
    blocks: read.blocks,
    notUsed: [...new Set(m.notUsed)],
    readAs:
      read.format === "pdf"
        ? "A PDF in another layout, read by fixed rules (words, columns and units). Every match below is a suggestion for you to check."
        : "A Word document in another layout, read by fixed rules (headings, table columns and units). Every match below is a suggestion for you to check.",
    form,
    matchedTables: m.matchedTables.sort((a, b) => a.block - b.block),
  };
}
