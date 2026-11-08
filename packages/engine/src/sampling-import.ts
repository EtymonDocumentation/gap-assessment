import {
  samplingPlanSchema,
  SAMPLING_TYPES,
  SCHEMA_VERSION,
  UNIT_OP_CUSTOM_STEP,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  type Actor,
  type ChangeEvent,
  type PlanStep,
  type Project,
  type SamplingPlan,
  type SamplingPoint,
  type SamplingType,
  type TimingOption,
} from "@gap/process-model";
import { stepOf, TIMING_LABEL, timingText, TYPE_LABEL } from "@gap/sampling";
import type { ContentBundle } from "./content";
import type { DocModel } from "./document";
import { cellKey, filledControl, linkCells, majorVersion, norm, sameSeq, toks, type Confidence, type ImportCounts, type UploadRead, type ViewBlock, type WordTable } from "./import-shared";
import { documentFingerprint } from "./review";
import { addPoint, addStep, catalogInsertIndex, createPlan, projectScopeSteps, SamplingError, updatePoint, type PointPatch } from "./sampling";
import { unitOpLabels } from "./sampling-document";
import type { SamplingImportSynonyms } from "./sampling-synonyms";
import { readValue } from "./trd-value";

/**
 * Upload a finished SAMPLING PLAN (job I3). The same three levels as the TRD upload, on the same shared reader and review words:
 *
 *  - Level 1: a Word file this tool made. It carries the plan record and the points tables as they were printed. On upload the printed
 *    tables are compared with the stored ones: an attribute or a timing somebody typed over in Word is a "Changed in Word" row that
 *    stays OPEN until the person accepts it or keeps the tool's value.
 *  - Level 2: the fill-in form. One points table; every cell is a Word content control tagged with a field id. A control nobody filled
 *    is NOT ESTABLISHED. A row nobody touched is not a point at all.
 *  - Level 3: any other Word or PDF (sampling-match.ts): the points table is found by its header words and every match is a SUGGESTION.
 *
 * The review model is ROW BASED (one sampling point per row, six values: step, attribute, test, amount, timing, type) because a plan is
 * a table; the TRD's is parameter based. What is shared is everything that does not depend on that: the document view, the confidence
 * words, the upload rules, the value reader, the header-word matching and the summary sentence.
 *
 * Rules kept here (the product's own rules):
 *  - Nothing is decided for the person. A value becomes part of a plan only when it is accepted (or typed) on the review screen.
 *  - NO DEFAULTS: an unfilled cell is an open item; a point is never given a study type, timing or amount the file did not state, and an
 *    accepted empty value never clears what the plan already says.
 *  - UNITS ARE NEVER CONVERTED, and an amount with no unit is not put in (the plan stores an amount with its unit).
 *  - A process step is never invented: a step name that is not in the catalogue or the plan is added only as a custom step the person
 *    accepted; a row with no accepted step is not added.
 *  - The tool never decides a filing category, and it never sets the project stage.
 */

export const SAMPLING_DATA_FORMAT = "cascade.sampling-data";
export const SAMPLING_FORM_FORMAT = "cascade.sampling-form";
export const SAMPLING_DATA_VERSION = "1.0.0";

export const SAMPLING_COLUMNS = ["step", "attribute", "test", "amount", "timing", "type"] as const;
export type SamplingColumn = (typeof SAMPLING_COLUMNS)[number];
export const SAMPLING_COLUMN_LABEL: Record<SamplingColumn, string> = {
  step: "Process step",
  attribute: "Attribute",
  test: "Test or method",
  amount: "Amount per sample",
  timing: "Timing",
  type: "Study type",
};

export class SamplingImportError extends Error {}

const rowId = (n: number, col: SamplingColumn) => `sampling.row.${n}.${col}`;
export const SAMPLING_TITLE_ID = "sampling.title";
export const parseSamplingFieldId = (id: string): { row: number; column: SamplingColumn } | undefined => {
  const m = /^sampling\.row\.(\d+)\.(step|attribute|test|amount|timing|type)$/.exec(id);
  return m ? { row: Number(m[1]), column: m[2] as SamplingColumn } : undefined;
};

// ------------------------------------------------------------------ reading values (shared by every level)

/** Study type from a cell: the tool's own name or key, or a word of the synonyms list. Exactly one type, or none. */
export function resolveSamplingType(text: string, syn?: SamplingImportSynonyms): SamplingType | undefined {
  const head = norm(text.split(":")[0]);
  const t = toks(head);
  if (t.length === 0) return undefined;
  const phrases: { type: SamplingType; toks: string[] }[] = [];
  for (const k of SAMPLING_TYPES) {
    phrases.push({ type: k, toks: toks(TYPE_LABEL[k]) }, { type: k, toks: toks(k.replace(/_/g, " ")) });
  }
  for (const s of syn?.types ?? []) for (const w of s.words) phrases.push({ type: s.type, toks: toks(w) });
  const exact = new Set(phrases.filter((p) => sameSeq(p.toks, t)).map((p) => p.type));
  if (exact.size === 1) return [...exact][0];
  if (exact.size > 1) return undefined;
  // A longer cell ("Lot release testing"): the phrases it contains; more than one type means the cell is unclear.
  const found = new Set(phrases.filter((p) => p.toks.length > 0 && p.toks.length <= t.length && t.some((_w, i) => p.toks.every((w, j) => t[i + j] === w))).map((p) => p.type));
  return found.size === 1 ? [...found][0] : undefined;
}

/** An amount per sample: one number WITH its unit ("10 mL"). A range, a number alone or a decimal comma is refused with the reason. */
export function readAmount(text: string): { value: number; unit: string } | { reason: string } {
  const r = readValue(text);
  if (r.kind === "number") {
    if (!r.unit) return { reason: `"${norm(text)}" has no unit. The plan keeps an amount with its unit, for example "10 mL"; write the unit.` };
    if (!(r.value > 0)) return { reason: "the amount must be more than zero" };
    return { value: r.value, unit: r.unit };
  }
  if (r.kind === "refused") return { reason: `"${norm(text)}" cannot be read: ${r.reason}` };
  if (r.kind === "range" || r.kind === "max" || r.kind === "min") return { reason: `"${norm(text)}" is a range or a limit; the plan keeps one amount per sample` };
  return { reason: `"${norm(text)}" is not an amount with a unit, for example "10 mL"` };
}

const TIMING_PHRASES = (syn?: SamplingImportSynonyms): { option: TimingOption; toks: string[] }[] => {
  const out: { option: TimingOption; toks: string[] }[] = [];
  for (const o of ["beginning", "middle", "end"] as const) out.push({ option: o, toks: toks(TIMING_LABEL[o]) }, { option: o, toks: toks(o) });
  for (const s of syn?.timing ?? []) for (const w of s.words) out.push({ option: s.option, toks: toks(w) });
  return out;
};

/**
 * A timing cell as the plan stores it. A cell made only of the position words (beginning, middle, end of the run) becomes those options;
 * anything else is kept WORD FOR WORD as "Other", so nothing is reworded or guessed.
 */
export function timingFromText(text: string, syn?: SamplingImportSynonyms): { options: TimingOption[]; other?: string } {
  const t = norm(text).replace(/^other:\s*/i, "");
  const parts = t.split(/\s*(?:,|;|\/|&|\band\b)\s*/i).filter(Boolean);
  const phrases = TIMING_PHRASES(syn);
  const options: TimingOption[] = [];
  for (const part of parts) {
    const hit = phrases.find((p) => sameSeq(p.toks, toks(part)));
    if (!hit) return { options: ["other"], other: t };
    if (!options.includes(hit.option)) options.push(hit.option);
  }
  return options.length ? { options } : { options: ["other"], other: t };
}

/** Why a text cannot be put in the plan as it stands, or undefined when it can. Accept is off for a value with a reason. */
export function checkSamplingValue(column: SamplingColumn, text: string, syn?: SamplingImportSynonyms): string | undefined {
  const t = norm(text);
  if (!t) return undefined;
  if (column === "amount") {
    const a = readAmount(t);
    return "reason" in a ? a.reason : undefined;
  }
  if (column === "type") return resolveSamplingType(t, syn) ? undefined : `"${t}" is not one of the study types of this tool, or it could mean more than one. Pick the type from the list.`;
  return undefined;
}

// ------------------------------------------------------------------ the text of a point (what the tables and the form show)

export const stepLabelOf = (plan: SamplingPlan, p: SamplingPoint, labels: ReadonlyMap<string, string>): string => stepOf(plan, p)?.label ?? (p.unitOp === UNIT_OP_CUSTOM_STEP ? "" : (labels.get(p.unitOp) ?? ""));

export function pointTexts(plan: SamplingPlan, p: SamplingPoint, labels: ReadonlyMap<string, string>): Record<SamplingColumn, string> {
  return {
    step: stepLabelOf(plan, p, labels),
    attribute: p.attribute.trim(),
    test: p.testMethodRef?.trim() ?? "",
    amount: p.quantity ? `${p.quantity.value} ${p.quantity.unit}` : "",
    timing: p.timing.options.length || p.timing.note?.trim() ? timingText(p) : "",
    type: p.type ? (p.typeLabel?.trim() ? `${TYPE_LABEL[p.type]}: ${p.typeLabel.trim()}` : TYPE_LABEL[p.type]) : "",
  };
}

// ------------------------------------------------------------------ the data a Word file carries

/** A points table as the Word export printed it (the study-type sections). */
export interface PrintedPointTable {
  columns: string[];
  rows: string[][];
}

export interface SamplingDataEnvelope {
  format: typeof SAMPLING_DATA_FORMAT;
  version: string;
  schemaVersion: string;
  fingerprint: string;
  projectId: string;
  record: SamplingPlan;
  /** The process step of each point as the document names it (the step's label, or the catalog name). */
  pointSteps: Record<string, string>;
  tables: PrintedPointTable[];
}

/** The points tables of a plan document: the ones whose first column is "ID" and whose second starts "Attribute / test". */
export function printedPointTables(doc: DocModel): PrintedPointTable[] {
  const out: PrintedPointTable[] = [];
  for (const s of doc.sections)
    for (const b of s.blocks) if (b.type === "table" && b.columns[0] === "ID" && (b.columns[1] ?? "").startsWith("Attribute / test")) out.push({ columns: [...b.columns], rows: b.rows.map((r) => r.map((c) => String(c))) });
  return out;
}

/** The data part of a sampling plan Word export (JSON text). */
export function buildSamplingData(content: ContentBundle, project: Project, plan: SamplingPlan, doc: DocModel): string {
  const labels = unitOpLabels(content, project);
  const env: SamplingDataEnvelope = {
    format: SAMPLING_DATA_FORMAT,
    version: SAMPLING_DATA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    fingerprint: documentFingerprint(doc),
    projectId: project.meta.id,
    record: plan,
    pointSteps: Object.fromEntries(plan.points.map((p) => [p.id, stepLabelOf(plan, p, labels)])),
    tables: printedPointTables(doc),
  };
  return JSON.stringify(env);
}

const majorOf = majorVersion;

export function parseSamplingData(json: string): SamplingDataEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SamplingImportError("The data stored in this Word file is damaged, so it cannot be read exactly.");
  }
  const e = raw as Partial<SamplingDataEnvelope> | null;
  if (!e || e.format !== SAMPLING_DATA_FORMAT) throw new SamplingImportError("This file does not carry sampling plan data from this tool.");
  if (majorOf(e.version ?? "") !== majorOf(SAMPLING_DATA_VERSION)) throw new SamplingImportError(`This file was made with a different format version (${e.version ?? "unknown"}). Open the plan it came from and download it again.`);
  const record = samplingPlanSchema.safeParse(e.record);
  if (!record.success) throw new SamplingImportError(`The sampling plan stored in this file is not valid: ${record.error.issues[0]?.message ?? "unknown problem"}.`);
  return { ...(e as SamplingDataEnvelope), record: record.data, pointSteps: e.pointSteps ?? {}, tables: Array.isArray(e.tables) ? e.tables : [] };
}

// ------------------------------------------------------------------ the fill-in form

export interface SamplingFormRow {
  n: number;
  /** The point this row came from (a pre-filled form). Absent for a blank row. */
  pointId?: string;
  values: Partial<Record<SamplingColumn, string>>;
}

export interface SamplingFormSpec {
  format: typeof SAMPLING_FORM_FORMAT;
  version: string;
  source: "blank" | "plan";
  projectId?: string;
  planId?: string;
  title: string;
  rows: SamplingFormRow[];
  /** The process step names a person can use (a hint printed above the table). */
  steps: string[];
}

/** Rows left empty on a form for new points. */
export const SAMPLING_FORM_SPARE_ROWS = 20;

export function buildBlankSamplingFormSpec(stepNames: string[]): SamplingFormSpec {
  return { format: SAMPLING_FORM_FORMAT, version: SAMPLING_DATA_VERSION, source: "blank", title: "", rows: Array.from({ length: SAMPLING_FORM_SPARE_ROWS }, (_x, i) => ({ n: i + 1, values: {} })), steps: stepNames };
}

/** The form with what the plan says so far: a row per point, then spare rows. Empty values stay empty. */
export function buildSamplingFormSpec(project: Project, plan: SamplingPlan, labels: ReadonlyMap<string, string>, stepNames: string[]): SamplingFormSpec {
  const rows: SamplingFormRow[] = plan.points.map((p, i) => ({ n: i + 1, pointId: p.id, values: Object.fromEntries(Object.entries(pointTexts(plan, p, labels)).filter(([, v]) => v !== "")) }));
  for (let i = 0; i < 5; i++) rows.push({ n: rows.length + 1, values: {} });
  return { format: SAMPLING_FORM_FORMAT, version: SAMPLING_DATA_VERSION, source: "plan", projectId: project.meta.id, planId: plan.id, title: plan.title, rows, steps: stepNames };
}

export function parseSamplingFormSpec(json: string): SamplingFormSpec {
  let s: SamplingFormSpec;
  try {
    s = JSON.parse(json) as SamplingFormSpec;
  } catch {
    throw new SamplingImportError("The form description stored in this file is damaged. Download a new form.");
  }
  if (!s || s.format !== SAMPLING_FORM_FORMAT || !Array.isArray(s.rows)) throw new SamplingImportError("This file is not a sampling plan form of this tool.");
  if (majorOf(s.version ?? "") !== majorOf(SAMPLING_DATA_VERSION)) throw new SamplingImportError(`This form was made with a different format version (${s.version ?? "unknown"}). Download a new form and copy your entries over.`);
  return s;
}

/** The step names to offer on a form and on the review screen: the plan's own steps, or the catalogue's steps of the project scope. */
export function stepNamesFor(content: ContentBundle, project: Project, plan?: SamplingPlan): string[] {
  if (plan) return plan.steps.map((s) => s.label);
  return projectScopeSteps(content, project).map((s) => s.label);
}

// ------------------------------------------------------------------ the review model

export interface SamplingField {
  id: string;
  /** 0 = the plan title. */
  row: number;
  column: SamplingColumn | "title";
  label: string;
  /** The value the file gives ("" = the file gives none: not established). */
  value: string;
  confidence: Confidence;
  /** Where the value was found, in words. This is what the change log keeps as evidence. */
  source: string;
  /** Why the text cannot be put in the plan as it stands. */
  unreadable?: string;
  /** Set when the document had a word for this value that is not a known step or study type: the value stays open and this says why. */
  notUsedWhy?: string;
  /** A "Changed in Word" row: what the export printed and what the file says now. */
  change?: { old: string; new: string };
  /** Level 3: the table of the document (index in the view blocks) the value was matched from. */
  table?: number;
}

export interface SamplingRow {
  n: number;
  /** The point of the file's plan this row came from (levels 1 and 2). */
  pointId?: string;
  /** A short name for the row on the screen ("SP-003", "Row 4"). */
  label: string;
  /** Where in the document, in words (level 3). */
  where?: string;
}

export interface SamplingImportSession {
  level: 1 | 2 | 3;
  fileName: string;
  title: SamplingField;
  rows: SamplingRow[];
  fields: SamplingField[];
  /** Cell positions in the view blocks ("block:row:col") and the fields they feed. */
  cellFields: Record<string, string[]>;
  fieldCells: Record<string, string[]>;
  blocks: ViewBlock[];
  /** Things in the file that were left out, in words ("Not used yet"). */
  notUsed: string[];
  readAs: string;
  /** Levels 1: the record. */
  record?: SamplingDataEnvelope;
  form?: SamplingFormSpec;
  /** Level 3: tables that gave at least one match, in document order. */
  matchedTables?: { block: number; label: string }[];
}

export const emptyField = (row: number, column: SamplingColumn | "title", label: string, source: string): SamplingField => ({
  id: column === "title" ? SAMPLING_TITLE_ID : rowId(row, column),
  row,
  column,
  label,
  value: "",
  confidence: "not_found",
  source,
});

const FILLED = filledControl;

/** Level 2: the form. Every control the person left in the file belongs to a row; a row with nothing in it is not a point. */
export function samplingSessionFromForm(read: UploadRead, syn?: SamplingImportSynonyms): SamplingImportSession {
  const form = parseSamplingFormSpec(read.dataJson ?? "");
  const s: SamplingImportSession = {
    level: 2,
    fileName: read.fileName,
    title: emptyField(0, "title", "Plan title", "Form cell: plan title"),
    rows: [],
    fields: [],
    cellFields: {},
    fieldCells: {},
    blocks: read.blocks,
    notUsed: [],
    readAs: "The fill-in form of this tool, read exactly.",
    form,
  };
  const titleText = FILLED(read.controls[SAMPLING_TITLE_ID]);
  if (titleText) Object.assign(s.title, { value: titleText, confidence: "exact" as const });
  s.fields.push(s.title);
  // Rows are found from the tags in the file, so a form with more rows than it was made with is still read in full.
  const numbers = new Set<number>(form.rows.map((r) => r.n));
  for (const id of Object.keys(read.controls)) {
    const p = parseSamplingFieldId(id);
    if (p) numbers.add(p.row);
  }
  let empty = 0;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const texts = SAMPLING_COLUMNS.map((c) => FILLED(read.controls[rowId(n, c)]));
    if (texts.every((t) => !t)) {
      empty++;
      continue;
    }
    const spec = form.rows.find((r) => r.n === n);
    s.rows.push({ n, ...(spec?.pointId ? { pointId: spec.pointId } : {}), label: spec?.pointId ?? `Row ${n}` });
    SAMPLING_COLUMNS.forEach((c, i) => {
      const f = emptyField(n, c, SAMPLING_COLUMN_LABEL[c], `Form cell: row ${n}, ${SAMPLING_COLUMN_LABEL[c]}`);
      if (texts[i]) {
        const why = checkSamplingValue(c, texts[i]!, syn);
        Object.assign(f, { value: texts[i], confidence: "exact" as const, source: `Form cell: row ${n}, ${SAMPLING_COLUMN_LABEL[c]}`, ...(why ? { unreadable: why } : {}) });
      }
      s.fields.push(f);
    });
  }
  // Which cell of the form each field is in (for highlighting).
  read.blocks.forEach((b, bi) => {
    if (b.kind !== "table") return;
    b.rows.forEach((r, ri) => r.forEach((cell, ci) => cell.controlId && s.fields.some((f) => f.id === cell.controlId) && linkCells(s, cell.controlId, cellKey(bi, ri, ci))));
  });
  if (empty) s.notUsed.push(`${empty} empty ${empty === 1 ? "row" : "rows"} of the form ${empty === 1 ? "was" : "were"} ignored (nothing was written in ${empty === 1 ? "it" : "them"}).`);
  const stray = Object.keys(read.controls).filter((id) => id !== SAMPLING_TITLE_ID && !parseSamplingFieldId(id));
  if (stray.length) s.notUsed.push(`${stray.length} entries in the file do not belong to this form and were not used.`);
  if (s.rows.length === 0) s.notUsed.push("No row of the form has anything written in it.");
  return s;
}

// ------------------------------------------------------------------ level 1: comparing the printed tables

export interface SamplingCellChange {
  pointId: string;
  column: "attribute" | "timing";
  old: string;
  new: string;
  /** False when the cell no longer ends the way the export printed it, so the new attribute cannot be told from the study type. */
  readable: boolean;
  at: { block: number; row: number; col: number };
}

export interface SamplingTableComparison {
  changes: SamplingCellChange[];
  covered: { pointId: string; column: "attribute" | "timing"; at: { block: number; row: number; col: number } }[];
  notes: string[];
  tablesExpected: number;
  tablesFound: number;
}

/**
 * Compares the points tables stored in the file with the tables that are really in it. Rows are matched by the point ID. Two cells are
 * read back: "Attribute / test (study type)" and "Timing / location". The attribute cell is the attribute followed by the study type
 * and method as the export printed them; only the part before that is the attribute, so a change in the printed rest is reported as a
 * note and not read as a new attribute.
 */
export function compareSamplingTables(env: SamplingDataEnvelope, word: readonly WordTable[], labelOf: (pointId: string) => string = (id) => id): SamplingTableComparison {
  const out: SamplingTableComparison = { changes: [], covered: [], notes: [], tablesExpected: env.tables.length, tablesFound: 0 };
  const key = (s: string) => norm(s).toLowerCase();
  let from = 0;
  for (const t of env.tables) {
    const head = t.columns.map(key);
    let at = -1;
    for (let i = from; i < word.length; i++) {
      const h = (word[i]!.rows[0] ?? []).map(key);
      if (h.length === head.length && h.every((x, j) => x === head[j])) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      out.notes.push(`A points table of the export (${t.rows.length} ${t.rows.length === 1 ? "point" : "points"}, starting at ${t.rows[0]?.[0] ?? "?"}) is not in the file any more, so it could not be compared.`);
      continue;
    }
    from = at + 1;
    out.tablesFound++;
    const w = word[at]!;
    const attrCol = t.columns.findIndex((c) => c.startsWith("Attribute / test"));
    const timeCol = t.columns.findIndex((c) => c.startsWith("Timing"));
    for (const row of t.rows) {
      const id = row[0] ?? "";
      const wi = w.rows.findIndex((r, i) => i > 0 && key(r[0] ?? "") === key(id));
      if (wi < 0) {
        out.notes.push(`${id} is not in the table of the file any more (the row was deleted or its ID changed). It is left as it is.`);
        continue;
      }
      const point = env.record.points.find((p) => p.id === id);
      if (!point) continue;
      const wr = w.rows[wi]!;
      // Attribute: the cell is "<attribute> (<study type>)<method><material>"; the part after the attribute is what the export printed.
      if (attrCol >= 0) {
        const stored = norm(row[attrCol]);
        const now = norm(wr[attrCol]);
        const shown = point.attribute.trim() || "Not given";
        covered(out, id, "attribute", { block: w.blockIndex, row: wi, col: attrCol });
        if (stored !== now) {
          const rest = stored.startsWith(shown) ? stored.slice(shown.length) : "";
          if (rest && now.endsWith(rest)) {
            const next = norm(now.slice(0, now.length - rest.length));
            if (next !== shown) out.changes.push({ pointId: id, column: "attribute", old: point.attribute.trim(), new: next === "Not given" ? "" : next, readable: true, at: { block: w.blockIndex, row: wi, col: attrCol } });
          } else {
            out.changes.push({ pointId: id, column: "attribute", old: point.attribute.trim(), new: now, readable: false, at: { block: w.blockIndex, row: wi, col: attrCol } });
          }
        }
      }
      if (timeCol >= 0 && point.type !== "stability" && point.type !== "retain_reserve") {
        const stored = norm(row[timeCol]);
        const now = norm(wr[timeCol]);
        covered(out, id, "timing", { block: w.blockIndex, row: wi, col: timeCol });
        if (stored !== now) out.changes.push({ pointId: id, column: "timing", old: stored === "Not given" ? "" : stored, new: now === "Not given" ? "" : now, readable: true, at: { block: w.blockIndex, row: wi, col: timeCol } });
      }
    }
  }
  void labelOf;
  return out;
}
function covered(out: SamplingTableComparison, pointId: string, column: "attribute" | "timing", at: { block: number; row: number; col: number }) {
  out.covered.push({ pointId, column, at });
}

/** Level 1: our own Word export. The record's values are Exact; every cell typed over in Word is a "Changed in Word" row. */
export function samplingSessionFromData(read: UploadRead, syn?: SamplingImportSynonyms): SamplingImportSession {
  const env = parseSamplingData(read.dataJson ?? "");
  const plan = env.record;
  const s: SamplingImportSession = {
    level: 1,
    fileName: read.fileName,
    title: emptyField(0, "title", "Plan title", "The data stored in the Word file: plan title"),
    rows: [],
    fields: [],
    cellFields: {},
    fieldCells: {},
    blocks: read.blocks,
    notUsed: [],
    readAs: "A Word file made by this tool, read exactly from the data stored in it, then compared with the tables you can see.",
    record: env,
  };
  const from = "The data stored in the Word file";
  Object.assign(s.title, { value: plan.title, confidence: plan.title ? ("exact" as const) : ("not_found" as const), source: `${from}: plan title` });
  s.fields.push(s.title);
  const labels = new Map<string, string>();
  const cmp = compareSamplingTables(env, read.tables);
  plan.points.forEach((p, i) => {
    const n = i + 1;
    s.rows.push({ n, pointId: p.id, label: p.id });
    const texts = pointTexts(plan, p, labels);
    // The step comes from what the export printed (the catalogue name is not known to this reader).
    texts.step = env.pointSteps[p.id] ?? texts.step;
    for (const c of SAMPLING_COLUMNS) {
      const f = emptyField(n, c, SAMPLING_COLUMN_LABEL[c], `${from}: ${p.id}, ${SAMPLING_COLUMN_LABEL[c]}`);
      if (texts[c]) Object.assign(f, { value: texts[c], confidence: "exact" as const });
      s.fields.push(f);
    }
  });
  for (const ch of cmp.changes) {
    const i = plan.points.findIndex((p) => p.id === ch.pointId);
    if (i < 0) continue;
    const f = s.fields.find((x) => x.id === rowId(i + 1, ch.column))!;
    const why = ch.readable ? checkSamplingValue(ch.column, ch.new, syn) : "the cell no longer ends with the study type and method the export printed, so the attribute cannot be told apart. Type the attribute yourself.";
    Object.assign(f, {
      value: ch.new,
      confidence: "changed" as const,
      source: `Word table, ${ch.pointId}, ${SAMPLING_COLUMN_LABEL[ch.column]}: the export printed "${ch.old || "(empty)"}", the file now says "${ch.new || "(empty)"}"`,
      change: { old: ch.old, new: ch.new },
      ...(why ? { unreadable: why } : {}),
    });
    linkCells(s, f.id, cellKey(ch.at.block, ch.at.row, ch.at.col));
  }
  for (const c of cmp.covered) {
    const i = plan.points.findIndex((p) => p.id === c.pointId);
    const id = rowId(i + 1, c.column);
    if (i >= 0 && !s.fieldCells[id]) linkCells(s, id, cellKey(c.at.block, c.at.row, c.at.col));
  }
  s.notUsed.push(...cmp.notes);
  if (env.tables.length === 0) s.notUsed.push("This file has no points tables to compare (the plan may have no points yet).");
  return s;
}

// ------------------------------------------------------------------ decisions and counts

export interface SamplingDecision {
  value: string;
}
export type SamplingDecisions = Record<string, SamplingDecision>;

/** A field that can be accepted as it stands ("Accept all exact" takes exactly these). */
export const isExactField = (f: SamplingField) => f.confidence === "exact" && !f.unreadable && f.value !== "";

export function samplingCounts(s: SamplingImportSession, decisions: SamplingDecisions): ImportCounts {
  let taken = 0;
  let open = 0;
  let notFound = 0;
  for (const f of s.fields) {
    const v = decisions[f.id]?.value;
    if (f.change) {
      // A changed cell is its own row on the screen: it counts as taken once decided and is never "open" next to the values.
      if (v) taken++;
      continue;
    }
    if (v !== undefined && v !== "") taken++;
    else {
      open++;
      if (f.confidence === "not_found") notFound++;
    }
  }
  return { taken, open, notFound, changed: s.fields.filter((f) => f.change).length };
}

// ------------------------------------------------------------------ the plan now (update path)

export interface SamplingCurrent {
  exists: boolean;
  text: string;
}

/** The step the plan has for a point, or the catalogue step it would resolve to: used to tell which existing point a row is about. */
export function findTargetPoint(plan: SamplingPlan, s: SamplingImportSession, row: SamplingRow, labels: ReadonlyMap<string, string>, projectId?: string): SamplingPoint | undefined {
  // A point id means something only inside the plan the file was made from.
  if (row.pointId && s.record && s.record.projectId === projectId && s.record.record.id === plan.id) {
    const p = plan.points.find((x) => x.id === row.pointId);
    if (p) return p;
  }
  const value = (c: SamplingColumn) => s.fields.find((f) => f.row === row.n && f.column === c)?.value ?? "";
  const attr = norm(value("attribute")).toLowerCase();
  if (!attr) return undefined;
  const step = norm(value("step")).toLowerCase();
  const hits = plan.points.filter((p) => norm(p.attribute).toLowerCase() === attr && (!step || !stepLabelOf(plan, p, labels) || norm(stepLabelOf(plan, p, labels)).toLowerCase() === step));
  return hits.length === 1 ? hits[0] : undefined;
}

export function currentPointText(plan: SamplingPlan, point: SamplingPoint | undefined, column: SamplingColumn, labels: ReadonlyMap<string, string>): SamplingCurrent {
  if (!point) return { exists: false, text: "" };
  return { exists: true, text: pointTexts(plan, point, labels)[column] };
}

// ------------------------------------------------------------------ applying the accepted values

export type SamplingTarget = { kind: "new"; title: string } | { kind: "update"; planId: string };

export interface SamplingApplyOptions {
  actor: Actor;
  target: SamplingTarget;
  content: ContentBundle;
  syn?: SamplingImportSynonyms;
}

export interface SamplingApplyResult {
  project: Project;
  planId: string;
  counts: ImportCounts;
  warnings: string[];
  added: number;
  updated: number;
}

type StepTarget = { kind: "plan"; step: PlanStep } | { kind: "special"; uo: string } | { kind: "catalog"; uo: string; label: string } | { kind: "custom"; label: string };

/** A step name against the plan, then the catalogue (and the two special values), else a step of the person's own. */
function resolveStep(plan: SamplingPlan, labels: ReadonlyMap<string, string>, text: string): StepTarget {
  const t = norm(text).toLowerCase();
  const byLabel = plan.steps.find((x) => norm(x.label).toLowerCase() === t);
  if (byLabel) return { kind: "plan", step: byLabel };
  for (const [uo, label] of labels) {
    if (norm(label).toLowerCase() !== t && uo.toLowerCase() !== t) continue;
    if (uo === UNIT_OP_FINISHED_PRODUCT || uo === UNIT_OP_NONE) return { kind: "special", uo };
    const onPlan = plan.steps.find((x) => x.unitOp === uo);
    return onPlan ? { kind: "plan", step: onPlan } : { kind: "catalog", uo, label };
  }
  return { kind: "custom", label: norm(text) };
}

const asPatch = (column: SamplingColumn, text: string, syn?: SamplingImportSynonyms): PointPatch => {
  switch (column) {
    case "attribute":
      return { attribute: norm(text) };
    case "test":
      return { testMethodRef: norm(text) };
    case "amount": {
      const a = readAmount(text);
      return "reason" in a ? {} : { quantity: a };
    }
    case "type": {
      const k = resolveSamplingType(text, syn);
      return k ? { type: k } : {};
    }
    default:
      return {};
  }
};

/** Makes a sampling plan from the accepted values (new), or brings them into an existing plan (update). The change log keeps the evidence. */
export function applySamplingImport(project: Project, s: SamplingImportSession, decisions: SamplingDecisions, opts: SamplingApplyOptions): SamplingApplyResult {
  const { actor, content, syn } = opts;
  const counts = samplingCounts(s, decisions);
  const warnings: string[] = [];
  const labels = unitOpLabels(content, project);
  let cur = project;
  let planId: string;
  let added = 0;
  let updated = 0;
  if (opts.target.kind === "new") {
    const title = opts.target.title.trim();
    if (!title) throw new SamplingImportError("Give the new plan a title.");
    const r = createPlan(cur, { title, steps: projectScopeSteps(content, cur) }, actor);
    cur = r.project;
    planId = r.planId;
  } else {
    planId = opts.target.planId;
    if (!cur.sampling.plans.some((p) => p.id === planId)) throw new SamplingImportError(`Sampling plan ${planId} is not in this project.`);
  }
  const evidence: { field: string; value: string; source: string }[] = [];
  // Accepted values that did not go into the plan (a value that failed the check, a row that was refused). They are not "taken".
  let notPut = 0;
  const planNow = () => cur.sampling.plans.find((p) => p.id === planId)!;
  const isUpdate = opts.target.kind === "update";

  // The change log is the audit trail, so it lists a value only when it really went into the plan. A row can still be refused after its
  // values passed the format check (no step, a point that would not add), so the evidence of a row is kept apart and joins `evidence`
  // only when the row changed the plan. Without this the log said values were taken that are not in the plan (CR-08).
  for (const row of s.rows) {
    const fieldOf = (c: SamplingColumn) => s.fields.find((f) => f.row === row.n && f.column === c)!;
    const accepted = new Map<SamplingColumn, string>();
    const rowEvidence = new Map<SamplingColumn, { field: string; value: string; source: string }>();
    // The plan as it was before this row: a step added for a row whose point then fails to add must not stay behind as an empty step.
    const beforeRow = cur;
    for (const c of SAMPLING_COLUMNS) {
      const f = fieldOf(c);
      const v = decisions[f.id]?.value;
      if (v === undefined || norm(v) === "") continue; // an accepted empty value never clears what the plan already says
      const why = f.value === v ? f.unreadable : checkSamplingValue(c, v, syn);
      if (why) {
        warnings.push(`${row.label}: ${SAMPLING_COLUMN_LABEL[c]} was not put in: ${why}`);
        notPut++;
        continue;
      }
      accepted.set(c, norm(v));
      rowEvidence.set(c, { field: `${row.label}: ${SAMPLING_COLUMN_LABEL[c]}`, value: norm(v), source: f.source });
    }
    if (accepted.size === 0) continue;
    // How many of this row's accepted values did not go in; added to `notPut` when the row is done, whichever way it ends.
    let refused = 0;
    try {
      const plan = planNow();
      const target = isUpdate ? findTargetPoint(plan, s, row, labels, project.meta.id) : undefined;
      if (target) {
        const patch: PointPatch = {};
        const now = pointTexts(plan, target, labels);
        for (const [c, text] of accepted) {
          if (c === "step") continue;
          if (norm(now[c]).toLowerCase() === text.toLowerCase()) continue;
          if (c === "timing") {
            const t = timingFromText(text, syn);
            // The interval and the note of the old timing belong to the old wording; the note is kept, the interval is dropped with it.
            patch.timing = { options: t.options, ...(t.other ? { other: t.other } : {}), ...(target.timing.note ? { note: target.timing.note } : {}) };
          } else Object.assign(patch, asPatch(c, text, syn));
        }
        const stepText = accepted.get("step");
        if (stepText && norm(now.step).toLowerCase() !== stepText.toLowerCase()) {
          const t = resolveStep(plan, labels, stepText);
          if (t.kind === "plan") patch.flow = { stepId: t.step.id };
          else {
            warnings.push(`${row.label}: the step "${stepText}" is not a step of ${planId}, so ${target.id} stays on its step.`);
            rowEvidence.delete("step");
            refused = 1;
          }
        }
        if (Object.keys(patch).length === 0) continue;
        cur = updatePoint(cur, planId, target.id, patch, actor);
        updated++;
        evidence.push(...rowEvidence.values());
        continue;
      }
      // A new point needs its process step and at least one more value; without them it would be an empty row in the plan.
      const stepText = accepted.get("step");
      if (!stepText || accepted.size < 2) {
        warnings.push(`${row.label} was not added: ${!stepText ? "its process step was not accepted" : "only the process step was accepted, with nothing else to say about the sample"}.`);
        refused = accepted.size;
        continue;
      }
      let t = resolveStep(plan, labels, stepText);
      if (t.kind === "catalog") {
        const r = addStep(cur, planId, { unitOp: t.uo, label: t.label }, actor, catalogInsertIndex(content, plan.steps, t.uo));
        cur = r.project;
        t = { kind: "plan", step: planNow().steps.find((x) => x.id === r.stepId)! };
      } else if (t.kind === "custom") {
        const r = addStep(cur, planId, { label: t.label }, actor);
        cur = r.project;
        t = { kind: "plan", step: planNow().steps.find((x) => x.id === r.stepId)! };
      }
      const draft = t.kind === "special" ? { unitOp: t.uo } : { unitOp: (t as { step: PlanStep }).step.unitOp ?? UNIT_OP_CUSTOM_STEP, flow: { stepId: (t as { step: PlanStep }).step.id } };
      const typeText = accepted.get("type");
      const kind = typeText ? resolveSamplingType(typeText, syn) : undefined;
      const r = addPoint(cur, planId, { ...draft, ...(kind ? { type: kind } : {}), ...(accepted.has("attribute") ? { attribute: accepted.get("attribute")! } : {}) }, actor);
      cur = r.project;
      const patch: PointPatch = {};
      for (const [c, text] of accepted) {
        if (c === "timing") {
          const tm = timingFromText(text, syn);
          patch.timing = { options: tm.options, ...(tm.other ? { other: tm.other } : {}) };
        } else if (c === "test" || c === "amount") Object.assign(patch, asPatch(c, text, syn));
      }
      if (Object.keys(patch).length) cur = updatePoint(cur, planId, r.pointId, patch, actor);
      added++;
      evidence.push(...rowEvidence.values());
    } catch (e) {
      if (e instanceof SamplingError) {
        // Back to the plan as it was before this row: no new step without its point, and no evidence for values that did not go in.
        cur = beforeRow;
        refused = accepted.size;
        warnings.push(`${row.label} was not applied: ${e.message}`);
      } else throw e;
    } finally {
      notPut += refused;
    }
  }
  const log = (ev: Omit<ChangeEvent, "at" | "by">) => cur.changeLog.push({ at: actor.at, by: actor.name, ...ev });
  cur = structuredClone(cur);
  // What was accepted on the review screen is not always what went in: a value that failed the check, or a row that was refused, stays
  // open. The count in the log and in the summary after the upload follows what the plan really took.
  const put = Math.max(0, Math.min(counts.taken, counts.taken - notPut));
  const done: ImportCounts = { ...counts, taken: put, open: counts.open + (counts.taken - put) };
  const sumText = `${done.taken} ${done.taken === 1 ? "value" : "values"} taken`;
  log({
    action: "sampling_import",
    path: `sampling.${planId}`,
    detail: `Imported from ${s.fileName}: ${sumText}; ${added} ${added === 1 ? "point" : "points"} added, ${updated} updated${isUpdate ? ` (update of ${planId})` : ` (new plan ${planId})`}.`,
    after: { file: s.fileName, level: s.level, counts: done, added, updated, evidence, warnings },
  });
  return { project: cur, planId, counts: done, warnings, added, updated };
}
