import {
  SCHEMA_VERSION,
  TRD_DETAIL_KEYS,
  TRD_FORMAT_VERSION,
  trdDocumentSchema,
  type Actor,
  type Catalog,
  type ChangeEvent,
  type Project,
  type Source,
  type TrdDocument,
  type TrdItem,
  type TrdLimits,
  type TrdRange,
  type TrdStep,
} from "@gap/process-model";
import type { DocModel } from "./document";
import { documentFingerprint } from "./review";
import { createTrd, effectiveField, nextTrdDocumentId, nextTrdStepId } from "./trd";
import { rangeText, setPointText } from "./trd-check";
import { trdVisibleTables, TRD_TABLE_COLUMNS, type TrdVariant, type TrdVisibleTable } from "./trd-document";
import type { TrdLibraryWriteup } from "@gap/process-model";
import { importSummaryText, norm, type Confidence, type ImportCounts, type UploadRead, type ViewBlock, type ViewCell, type WordTable } from "./import-shared";

// The reader's types and the upload rules are shared with the other upload features (the sampling plan); re-exported so imports of this module keep working.
export { CONFIDENCE_LABEL, classifyUpload, importSummaryText, SCANNED_PDF_MESSAGE, UPLOAD_MAX_BYTES } from "./import-shared";
export type { Confidence, ImportCounts, UploadKind, UploadRead, ViewBlock, ViewCell, WordTable } from "./import-shared";

/**
 * Upload a finished TRD (job I1: levels 1 and 2).
 *
 *  - Level 1: a Word file this tool made. It carries the TRD record, the schema version, a fingerprint and the parameter tables as
 *    they were printed, in a custom XML part. On upload the printed tables in the file are compared with the stored ones: a cell
 *    somebody typed over in Word is a "Changed in Word" row that stays OPEN until the person accepts or rejects it.
 *  - Level 2: the fill-in form of this tool. Every fillable cell is a Word content control tagged with a field id. A control nobody
 *    filled is NOT ESTABLISHED, never a blank value.
 *
 * Rules kept here (GMP and the product's own rules):
 *  - Nothing is decided for the person. A value becomes part of the TRD only when it is accepted (or typed) on the review screen.
 *  - NO DEFAULTS: an unfilled cell is an open item. A range with one end the file did not state is shown as one-ended and noted;
 *    it is never completed with a guess.
 *  - UNITS ARE NEVER CONVERTED. A value keeps the unit its cell states; where the cell has none the unit column of the same row is used.
 *  - A range is only built when every end the file states has been accepted: accepting one end of two would quietly turn "15 to 25"
 *    into "from 15", which says something the document did not.
 *  - The tool never decides a filing category.
 */

export const TRD_DATA_FORMAT = "cascade.trd-data";
export const TRD_FORM_FORMAT = "cascade.trd-form";
export const TRD_DATA_VERSION = "1.0.0";
/** The XML namespace of the custom part that carries the data in a Word file. */
export const TRD_DATA_NAMESPACE = "urn:cascade:transfer-data";

export const TRD_PARTS = ["set", "nor_low", "nor_high", "par_low", "par_high", "unit"] as const;
export type TrdPart = (typeof TRD_PARTS)[number];
export const TRD_PART_LABEL: Record<TrdPart, string> = { set: "Set point", nor_low: "NOR low", nor_high: "NOR high", par_low: "PAR low", par_high: "PAR high", unit: "Unit" };

const PLACEHOLDER = "not established";

// ------------------------------------------------------------------ reading values

/** A single number with an optional unit: "5", "-80", "5 mL". A decimal comma is not read (a thousands comma would be misread). */
export function parseNumberText(text: string): { value: number; unit?: string } | undefined {
  const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(norm(text).replace(/\s*\(provisional\)$/i, ""));
  if (!m) return undefined;
  const unit = m[2]!.trim();
  // "5 to 8" or "5, 6" is not one number.
  if (/^(to|-|–|,)/i.test(unit) || /^\d/.test(unit)) return undefined;
  return { value: Number(m[1]), ...(unit ? { unit } : {}) };
}

/** A range as the documents write it: "15 to 25 °C", "up to 25", "from 15", "at least 15", "15 - 25". */
export function parseRangeText(text: string): { low?: number; high?: number; unit?: string; lowUnit?: string; highUnit?: string } | undefined {
  const t = norm(text).replace(/\s*\(provisional\)$/i, "");
  const tail = (x: string | undefined) => (x && x.trim() ? x.trim() : undefined);
  let m = /^(-?\d+(?:\.\d+)?)\s*([A-Za-z\u00b5\u03bc\u00b0%][^\s\d]*)?\s*(?:to|\u2013|-)\s*(-?\d+(?:\.\d+)?)\s*(.*)$/i.exec(t);
  if (m) {
    const first = tail(m[2]);
    const last = tail(m[4]);
    // "15 to 25 C" is one unit for both ends; "1 mL to 2 L" states a unit at each end (they are kept apart, never converted).
    const lowUnit = first ?? last;
    const highUnit = last ?? first;
    return { low: Number(m[1]), high: Number(m[3]), ...(lowUnit && lowUnit === highUnit ? { unit: lowUnit } : { ...(lowUnit ? { lowUnit } : {}), ...(highUnit ? { highUnit } : {}) }) };
  }
  m = /^(?:up to|max(?:imum)?)\s*(-?\d+(?:\.\d+)?)\s*(.*)$/i.exec(t);
  if (m) return { high: Number(m[1]), ...(tail(m[2]) ? { unit: tail(m[2])! } : {}) };
  m = /^(?:from|at least|min(?:imum)?)\s*(-?\d+(?:\.\d+)?)\s*(.*)$/i.exec(t);
  if (m) return { low: Number(m[1]), ...(tail(m[2]) ? { unit: tail(m[2])! } : {}) };
  return undefined;
}

/** The six values of a parameter's set point, NOR and PAR as cell text. One shared unit goes in `unit`; mixed units stay in the cells. */
export function limitParts(limits: TrdLimits | undefined): Partial<Record<TrdPart, string>> {
  if (!limits) return {};
  const units = new Set([limits.setPoint?.unit, limits.nor?.unit, limits.par?.unit].map((u) => (u ?? "").trim()).filter(Boolean));
  const single = units.size <= 1;
  const mk = (n: number | undefined, unit: string | undefined): string | undefined => (n === undefined ? undefined : single || !(unit ?? "").trim() ? String(n) : `${n} ${(unit ?? "").trim()}`);
  const out: Partial<Record<TrdPart, string>> = {};
  const put = (p: TrdPart, v: string | undefined) => {
    if (v !== undefined) out[p] = v;
  };
  put("set", mk(limits.setPoint?.value, limits.setPoint?.unit));
  put("nor_low", mk(limits.nor?.min, limits.nor?.unit));
  put("nor_high", mk(limits.nor?.max, limits.nor?.unit));
  put("par_low", mk(limits.par?.min, limits.par?.unit));
  put("par_high", mk(limits.par?.max, limits.par?.unit));
  if (single && units.size === 1) out.unit = [...units][0]!;
  return out;
}

/** The step a form or file names: its unit-operation key when that is unique in the TRD, else its step id. */
export function stepRefs(d: TrdDocument): Map<string, string> {
  const count = new Map<string, number>();
  for (const s of d.steps) if (s.key) count.set(s.key, (count.get(s.key) ?? 0) + 1);
  return new Map(d.steps.map((s) => [s.id, s.key && count.get(s.key) === 1 ? s.key : s.id]));
}

export const partId = (ref: string, key: string, part: string) => `trd.step.${ref}.param.${key}.${part}`;
const PART_ID = /^trd\.step\.([^.]+)\.param\.([^.]+)\.(set|nor_low|nor_high|par_low|par_high|unit|cell_set|cell_nor|cell_par|cell_unit)$/;
export const parseFieldId = (id: string): { ref: string; key: string; part: string } | undefined => {
  const m = PART_ID.exec(id);
  return m ? { ref: m[1]!, key: m[2]!, part: m[3]! } : undefined;
};

const DOC_FIELDS = [
  { id: "trd.title", label: "TRD title", multiline: false },
  { id: "trd.docRef", label: "Document reference", multiline: false },
  { id: "trd.version", label: "Document version", multiline: false },
  { id: "trd.purpose", label: "Purpose", multiline: true },
  { id: "trd.scopeNote", label: "Scope note", multiline: true },
] as const;

// ------------------------------------------------------------------ the data a Word file carries

export interface TrdDataEnvelope {
  format: typeof TRD_DATA_FORMAT;
  version: string;
  schemaVersion: string;
  trdFormat: string;
  /** Fingerprint of the exported document (the same hash the export history holds). */
  fingerprint: string;
  variant: TrdVariant;
  projectId: string;
  record: TrdDocument;
  /** The source register entries the record cites, so a copy in another project keeps its citations readable. */
  sources: Source[];
  /** The parameter tables as printed. */
  tables: TrdVisibleTable[];
}

/** The data part of a TRD Word export (JSON text). */
export function buildTrdData(project: Project, d: TrdDocument, doc: DocModel, variant: TrdVariant = "standard"): string {
  const cited = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "sourceIds" && Array.isArray(x)) for (const id of x) cited.add(String(id));
      else walk(x);
    }
  };
  walk(d);
  const env: TrdDataEnvelope = {
    format: TRD_DATA_FORMAT,
    version: TRD_DATA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    trdFormat: TRD_FORMAT_VERSION,
    fingerprint: documentFingerprint(doc),
    variant,
    projectId: project.meta.id,
    record: d,
    sources: project.sources.filter((s) => cited.has(s.id)),
    tables: trdVisibleTables(project, d, variant),
  };
  return JSON.stringify(env);
}

export class TrdImportError extends Error {}

const majorOf = (v: string) => v.split(".")[0];

/** Reads and checks the data part of a file. The message says in plain words what is wrong. */
export function parseTrdData(json: string): TrdDataEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new TrdImportError("The data stored in this Word file is damaged, so it cannot be read exactly.");
  }
  const e = raw as Partial<TrdDataEnvelope> | null;
  if (!e || e.format !== TRD_DATA_FORMAT) throw new TrdImportError("This file does not carry TRD data from this tool.");
  if (majorOf(e.version ?? "") !== majorOf(TRD_DATA_VERSION)) throw new TrdImportError(`This file was made with a different format version (${e.version ?? "unknown"}). Open the TRD it came from and download it again.`);
  const record = trdDocumentSchema.safeParse(e.record);
  if (!record.success) throw new TrdImportError(`The TRD stored in this file is not valid: ${record.error.issues[0]?.message ?? "unknown problem"}.`);
  return { ...(e as TrdDataEnvelope), record: record.data, sources: Array.isArray(e.sources) ? e.sources : [], tables: Array.isArray(e.tables) ? e.tables : [] };
}

// ------------------------------------------------------------------ the fill-in form

export interface TrdFormControl {
  id: string;
  label: string;
  /** What the form already holds ("TRD form with what we know so far"); empty for a blank form. */
  value: string;
  multiline?: boolean;
}
export interface TrdFormParam {
  key: string;
  label: string;
  values: Partial<Record<TrdPart, string>>;
}
export interface TrdFormStep {
  ref: string;
  key?: string;
  label: string;
  params: TrdFormParam[];
}
export interface TrdFormSpec {
  format: typeof TRD_FORM_FORMAT;
  version: string;
  schemaVersion: string;
  trdFormat: string;
  source: "blank" | "trd";
  trdId?: string;
  document: TrdFormControl[];
  details: TrdFormControl[];
  steps: TrdFormStep[];
}

const specBase = { format: TRD_FORM_FORMAT, version: TRD_DATA_VERSION, schemaVersion: SCHEMA_VERSION, trdFormat: TRD_FORMAT_VERSION } as const;

/** The blank form: the document sections and one parameter table per process step of the catalog. Nothing is filled in. */
export function buildBlankFormSpec(catalog: Catalog): TrdFormSpec {
  return {
    ...specBase,
    source: "blank",
    document: DOC_FIELDS.map((f) => ({ id: f.id, label: f.label, value: "", ...(f.multiline ? { multiline: true } : {}) })),
    details: TRD_DETAIL_KEYS.map(([k, label]) => ({ id: `trd.detail.${k}`, label, value: "" })),
    steps: [...catalog.unitOperations]
      .sort((a, b) => a.sequence - b.sequence)
      .map((u) => ({ ref: u.key, key: u.key, label: u.label, params: u.items.filter((i) => i.coll === "param").map((i) => ({ key: i.key, label: i.label, values: {} })) }))
      .filter((s) => s.params.length > 0),
  };
}

/** The form with what the TRD says so far: its own values only. Project values that are not in the TRD are not copied in. */
export function buildTrdFormSpec(d: TrdDocument): TrdFormSpec {
  const refs = stepRefs(d);
  const text: Record<string, string> = { "trd.title": d.title, "trd.docRef": d.docRef ?? "", "trd.version": d.version ?? "", "trd.purpose": d.purpose ?? "", "trd.scopeNote": d.scopeNote ?? "" };
  return {
    ...specBase,
    source: "trd",
    trdId: d.id,
    document: DOC_FIELDS.map((f) => ({ id: f.id, label: f.label, value: text[f.id] ?? "", ...(f.multiline ? { multiline: true } : {}) })),
    details: TRD_DETAIL_KEYS.map(([k, label]) => {
      const f = d.details.find((x) => x.key === k);
      const v = f ? effectiveField(f) : undefined;
      return { id: `trd.detail.${k}`, label, value: v && v.status === "established" ? v.text : "" };
    }),
    steps: d.steps
      .filter((s) => s.items.some((i) => i.collection === "param"))
      .map((s) => ({
        ref: refs.get(s.id)!,
        ...(s.key ? { key: s.key } : {}),
        label: s.label,
        params: s.items.filter((i) => i.collection === "param").map((i) => ({ key: i.key, label: i.label, values: limitParts(i.limits) })),
      })),
  };
}

/** Every control id of a form, with its label and group, in form order. */
export function formControls(spec: TrdFormSpec): { id: string; label: string; group: string; sub?: string; part?: TrdPart; value: string }[] {
  const out: { id: string; label: string; group: string; sub?: string; part?: TrdPart; value: string }[] = [];
  for (const c of spec.document) out.push({ id: c.id, label: c.label, group: "Document", value: c.value });
  for (const c of spec.details) out.push({ id: c.id, label: c.label, group: "Product and site", value: c.value });
  for (const s of spec.steps)
    for (const p of s.params) for (const part of TRD_PARTS) out.push({ id: partId(s.ref, p.key, part), label: TRD_PART_LABEL[part], group: s.label, sub: p.label, part, value: p.values[part] ?? "" });
  return out;
}

export function parseTrdFormSpec(json: string): TrdFormSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new TrdImportError("The data stored in this form is damaged.");
  }
  const s = raw as Partial<TrdFormSpec> | null;
  if (!s || s.format !== TRD_FORM_FORMAT || !Array.isArray(s.steps) || !Array.isArray(s.document) || !Array.isArray(s.details)) throw new TrdImportError("This file does not carry a TRD form from this tool.");
  if (majorOf(s.version ?? "") !== majorOf(TRD_DATA_VERSION)) throw new TrdImportError(`This form was made with a different format version (${s.version ?? "unknown"}). Download a new form and copy your entries over.`);
  return s as TrdFormSpec;
}

// ------------------------------------------------------------------ comparing the printed tables

export type CellColumn = "Set point" | "NOR" | "PAR" | "Unit";
const COLUMN_PART: Record<CellColumn, "cell_set" | "cell_nor" | "cell_par" | "cell_unit"> = { "Set point": "cell_set", NOR: "cell_nor", PAR: "cell_par", Unit: "cell_unit" };

export interface CellChange {
  stepId: string;
  itemKey: string;
  column: CellColumn;
  old: string;
  new: string;
  at: { block: number; row: number; col: number };
}

export interface TableComparison {
  changes: CellChange[];
  /** Cells the comparison covered, by position, for highlighting. */
  covered: { stepId: string; itemKey: string; column: CellColumn; at: { block: number; row: number; col: number } }[];
  /** Rows or tables that do not line up, in words. */
  notes: string[];
  tablesExpected: number;
  tablesFound: number;
}

/** Compares the printed tables stored in the file with the tables that are really in it. Rows are matched by the parameter name. */
export function compareVisibleTables(stored: readonly TrdVisibleTable[], word: readonly WordTable[], labelOf: (stepId: string) => string = (s) => s): TableComparison {
  const changes: CellChange[] = [];
  const covered: TableComparison["covered"] = [];
  const notes: string[] = [];
  let found = 0;
  let from = 0;
  const header = TRD_TABLE_COLUMNS.map((c) => c.toLowerCase());
  for (const t of stored) {
    const labels = new Set(t.rows.map((r) => norm(r[0]).toLowerCase()));
    let at = -1;
    for (let j = from; j < word.length; j++) {
      const w = word[j]!;
      const head = (w.rows[0] ?? []).slice(0, 5).map((c) => norm(c).toLowerCase());
      if (head.length < 5 || head.some((c, i) => c !== header[i])) continue;
      if (t.rows.length === 0 || w.rows.slice(1).some((r) => labels.has(norm(r[0]).toLowerCase()))) {
        at = j;
        break;
      }
    }
    if (at < 0) {
      notes.push(`The parameter table of "${labelOf(t.stepId)}" was not found in the file (it may have been deleted or changed in Word), so its cells were not compared.`);
      continue;
    }
    from = at + 1;
    found++;
    const w = word[at]!;
    const used = new Set<number>();
    t.rows.forEach((row, i) => {
      const label = norm(row[0]);
      const ri = w.rows.findIndex((r, k) => k > 0 && !used.has(k) && norm(r[0]).toLowerCase() === label.toLowerCase());
      if (ri < 0) {
        notes.push(`"${label}" (${labelOf(t.stepId)}) is no longer in the table in Word.`);
        return;
      }
      used.add(ri);
      (["Set point", "NOR", "PAR", "Unit"] as const).forEach((column, k) => {
        const col = k + 1;
        const a = norm(row[col]);
        const b = norm(w.rows[ri]![col]);
        const pos = { block: w.blockIndex, row: ri, col };
        covered.push({ stepId: t.stepId, itemKey: t.itemKeys[i]!, column, at: pos });
        if (a !== b) changes.push({ stepId: t.stepId, itemKey: t.itemKeys[i]!, column, old: a, new: b, at: pos });
      });
    });
    w.rows.forEach((r, k) => {
      if (k > 0 && !used.has(k) && norm(r[0])) notes.push(`"${norm(r[0])}" is a row that was added in Word (${labelOf(t.stepId)}). It is not in the TRD record, so it is not used.`);
    });
  }
  return { changes, covered, notes, tablesExpected: stored.length, tablesFound: found };
}

/** A cell's text as the parts it stands for, or undefined when it cannot be read as numbers. Parts the cell does not state are "". */
export function cellToParts(column: CellColumn, text: string): Partial<Record<TrdPart, string>> | undefined {
  const t = norm(text);
  if (column === "Unit") return { unit: t === "See cells" ? "" : t };
  if (column === "Set point") {
    if (!t) return { set: "" };
    const n = parseNumberText(t);
    return n ? { set: n.unit ? `${n.value} ${n.unit}` : String(n.value) } : undefined;
  }
  const low = column === "NOR" ? "nor_low" : "par_low";
  const high = column === "NOR" ? "nor_high" : "par_high";
  if (!t) return { [low]: "", [high]: "" };
  const r = parseRangeText(t);
  if (!r) return undefined;
  const at = (n: number | undefined, own: string | undefined) => (n === undefined ? "" : `${n}${(own ?? r.unit) ? ` ${own ?? r.unit}` : ""}`);
  return { [low]: at(r.low, r.lowUnit), [high]: at(r.high, r.highUnit) };
}

// ------------------------------------------------------------------ the review model

export interface ImportField {
  id: string;
  /** "Document", "Product and site" or the step's name. */
  group: string;
  /** The parameter the field belongs to. */
  sub?: string;
  label: string;
  /** The value the file gives ("" = the file gives none: not established). */
  value: string;
  confidence: Confidence;
  /** Where the value was found, in words. This is what the change log keeps as evidence. */
  source: string;
  multiline?: boolean;
  /** A "Changed in Word" row: what the export printed and what the file says now. The row is about the whole cell. */
  change?: { old: string; new: string; column: CellColumn };
  /** A value inside a changed cell: it waits for the choice on that row. */
  lockedBy?: string;
  /** Parts a changed cell stands for. */
  parts?: TrdPart[];
  /** Level 3: the table of the document (index in the view blocks) the value was matched from, for "Accept all matched in this table". */
  table?: number;
}

export interface ImportSession {
  level: 1 | 2 | 3;
  fileName: string;
  fields: ImportField[];
  /** Cell positions in the view blocks ("block:row:col") and the fields they feed. */
  cellFields: Record<string, string[]>;
  fieldCells: Record<string, string[]>;
  blocks: ViewBlock[];
  /** Things in the file that were left out, in words ("Not used yet"). */
  notUsed: string[];
  /** What the file is, in words, for the screen. */
  readAs: string;
  /** Level 1: the record. Level 2: the form. Level 3: the blank form (it names the steps and parameters the matches can fill). */
  record?: TrdDataEnvelope;
  form?: TrdFormSpec;
  /** Level 3: the tables of the document that gave at least one match, in document order (for "Accept all matched in this table"). */
  matchedTables?: { block: number; label: string }[];
}

const FILLED = (c: { text: string; placeholder: boolean } | undefined): string => {
  if (!c || c.placeholder) return "";
  const t = c.text.trim();
  return !t || t.toLowerCase() === PLACEHOLDER ? "" : t;
};

function cellKey(b: number, r: number, c: number) {
  return `${b}:${r}:${c}`;
}

function linkCells(s: ImportSession, id: string, key: string): void {
  (s.cellFields[key] ??= []).push(id);
  (s.fieldCells[id] ??= []).push(key);
}

/** Level 2: the form. Every control the person left in the file is a field; an unfilled one is "Not found" and stays open. */
export function sessionFromForm(read: UploadRead): ImportSession {
  const form = parseTrdFormSpec(read.dataJson ?? "");
  const s: ImportSession = { level: 2, fileName: read.fileName, fields: [], cellFields: {}, fieldCells: {}, blocks: read.blocks, notUsed: [], readAs: "The fill-in form of this tool, read exactly.", form };
  const known = new Set<string>();
  for (const c of formControls(form)) {
    known.add(c.id);
    const ctl = read.controls[c.id];
    if (!ctl) continue;
    const value = FILLED(ctl);
    const spec = form.document.find((x) => x.id === c.id);
    s.fields.push({
      id: c.id,
      group: c.group,
      ...(c.sub ? { sub: c.sub } : {}),
      label: c.label,
      value,
      confidence: value ? "exact" : "not_found",
      source: `Form cell: ${[c.group, c.sub, c.label].filter(Boolean).join(", ")}`,
      ...(spec?.multiline ? { multiline: true } : {}),
    });
  }
  read.blocks.forEach((b, bi) => {
    if (b.kind !== "table") return;
    b.rows.forEach((r, ri) =>
      r.forEach((cell, ci) => {
        if (cell.controlId && known.has(cell.controlId)) linkCells(s, cell.controlId, cellKey(bi, ri, ci));
      }),
    );
  });
  const missing = formControls(form).filter((c) => !read.controls[c.id]).length;
  if (missing) s.notUsed.push(`${missing} cells of the form are not in this file any more (a row or table was deleted in Word). They are left open.`);
  const other = Object.keys(read.controls).filter((id) => !known.has(id));
  if (other.length) s.notUsed.push(`${other.length} entries in the file do not belong to this form and were not used.`);
  return s;
}

/** Level 1: our own Word export. The record's values are Exact; every cell typed over in Word is a "Changed in Word" row. */
export function sessionFromData(read: UploadRead): ImportSession {
  const env = parseTrdData(read.dataJson ?? "");
  const d = env.record;
  const refs = stepRefs(d);
  const s: ImportSession = {
    level: 1,
    fileName: read.fileName,
    fields: [],
    cellFields: {},
    fieldCells: {},
    blocks: read.blocks,
    notUsed: [],
    readAs: "A Word file made by this tool, read exactly from the data stored in it, then compared with the tables you can see.",
    record: env,
  };
  const from = "The data stored in the Word file";
  const doc: Record<string, string> = { "trd.title": d.title, "trd.docRef": d.docRef ?? "", "trd.version": d.version ?? "", "trd.purpose": d.purpose ?? "", "trd.scopeNote": d.scopeNote ?? "" };
  for (const f of DOC_FIELDS) s.fields.push({ id: f.id, group: "Document", label: f.label, value: doc[f.id] ?? "", confidence: doc[f.id] ? "exact" : "not_found", source: `${from}: ${f.label}`, ...(f.multiline ? { multiline: true } : {}) });
  for (const [k, label] of TRD_DETAIL_KEYS) {
    const f = d.details.find((x) => x.key === k);
    const v = f ? effectiveField(f) : undefined;
    const value = v && v.status === "established" ? v.text : "";
    s.fields.push({ id: `trd.detail.${k}`, group: "Product and site", label, value, confidence: value ? "exact" : "not_found", source: `${from}: ${label}` });
  }
  const stepOf = new Map(d.steps.map((x) => [x.id, x]));
  const cmp = compareVisibleTables(env.tables, read.tables, (id) => stepOf.get(id)?.label ?? id);
  const itemOf = (stepId: string, key: string): { step: TrdStep; item: TrdItem } | undefined => {
    const step = stepOf.get(stepId);
    const item = step?.items.find((i) => i.collection === "param" && i.key === key);
    return step && item ? { step, item } : undefined;
  };
  const byParam = new Map<string, ImportField[]>();
  const add = (stepId: string, key: string, f: ImportField) => {
    s.fields.push(f);
    const k = `${stepId}|${key}`;
    byParam.set(k, [...(byParam.get(k) ?? []), f]);
  };
  const partField = (stepId: string, key: string, part: TrdPart, value: string): ImportField => {
    const at = itemOf(stepId, key)!;
    const id = partId(refs.get(stepId)!, key, part);
    return { id, group: at.step.label, sub: at.item.label, label: TRD_PART_LABEL[part], value, confidence: value ? "exact" : "not_found", source: `${from}: ${at.step.label}, ${at.item.label}, ${TRD_PART_LABEL[part]}` };
  };
  for (const step of d.steps)
    for (const item of step.items) {
      if (item.collection !== "param") continue;
      const parts = limitParts(item.limits);
      for (const part of TRD_PARTS) if (parts[part] !== undefined) add(step.id, item.key, partField(step.id, item.key, part, parts[part]!));
    }
  // Changed cells: one row for the whole cell, and its values wait for the choice.
  for (const ch of cmp.changes) {
    const at = itemOf(ch.stepId, ch.itemKey);
    if (!at) continue;
    const ref = refs.get(ch.stepId)!;
    const id = partId(ref, ch.itemKey, COLUMN_PART[ch.column]);
    const stored = cellToParts(ch.column, ch.old);
    const word = cellToParts(ch.column, ch.new);
    const involved = new Set<TrdPart>([...(Object.keys(stored ?? {}) as TrdPart[]), ...(Object.keys(word ?? {}) as TrdPart[])]);
    const field: ImportField = {
      id,
      group: at.step.label,
      sub: at.item.label,
      label: `${ch.column} (cell in the table)`,
      value: ch.new,
      confidence: "changed",
      source: `Word table, ${at.step.label}, row "${at.item.label}", column ${ch.column}: the export printed "${ch.old || "(empty)"}", the file now says "${ch.new || "(empty)"}"`,
      change: { old: ch.old, new: ch.new, column: ch.column },
      parts: [...involved],
    };
    s.fields.push(field);
    byParam.set(`${ch.stepId}|${ch.itemKey}`, [...(byParam.get(`${ch.stepId}|${ch.itemKey}`) ?? []), field]);
    for (const part of involved) {
      let pf = s.fields.find((x) => x.id === partId(ref, ch.itemKey, part));
      if (!pf) {
        pf = partField(ch.stepId, ch.itemKey, part, "");
        s.fields.push(pf);
      }
      pf.lockedBy = id;
    }
    linkCells(s, id, cellKey(ch.at.block, ch.at.row, ch.at.col));
  }
  // Compared cells that did not change feed their parts (highlight only).
  for (const c of cmp.covered) {
    if (cmp.changes.some((x) => x.stepId === c.stepId && x.itemKey === c.itemKey && x.column === c.column)) continue;
    const ref = refs.get(c.stepId);
    if (!ref) continue;
    const parts: TrdPart[] = c.column === "Set point" ? ["set"] : c.column === "NOR" ? ["nor_low", "nor_high"] : c.column === "PAR" ? ["par_low", "par_high"] : ["unit"];
    for (const p of parts) if (s.fields.some((f) => f.id === partId(ref, c.itemKey, p))) linkCells(s, partId(ref, c.itemKey, p), cellKey(c.at.block, c.at.row, c.at.col));
  }
  s.notUsed.push(...cmp.notes);
  if (env.tables.length === 0) s.notUsed.push("This file has no parameter tables to compare (the Word document may have been made without them).");
  // Keep each parameter's fields together, in a stable order.
  const order = new Map<string, number>();
  s.fields.forEach((f, i) => order.set(f.id, i));
  s.fields.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
  return s;
}

// ------------------------------------------------------------------ decisions and counts

/** What the person did with a field. `value` is the text that goes into the TRD ("" = accepted as having no value). */
export interface ImportDecision {
  value: string;
}
export type ImportDecisions = Record<string, ImportDecision>;

const field = (s: ImportSession, id: string) => s.fields.find((f) => f.id === id);

/** A field that can be accepted as it stands ("Accept all exact" takes exactly these). */
export const isExact = (f: ImportField) => f.confidence === "exact" && !f.lockedBy && f.value !== "";

/**
 * The value a field has after the person's choices. A value inside a changed cell has none until the row is decided; then it comes from
 * the cell text that was chosen (the old one, the Word one, or typed).
 */
export function resolvedValues(s: ImportSession, decisions: ImportDecisions): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const f of s.fields) {
    if (f.change) continue;
    if (f.lockedBy) {
      const cell = field(s, f.lockedBy)!;
      const dec = decisions[cell.id];
      if (!dec) {
        out.set(f.id, undefined);
        continue;
      }
      const parts = cellToParts(cell.change!.column, dec.value);
      const p = f.id.split(".").pop() as TrdPart;
      out.set(f.id, parts ? (parts[p] ?? "") : undefined);
      continue;
    }
    out.set(f.id, decisions[f.id]?.value);
  }
  return out;
}

/** "38 values taken, 12 still open, 5 changed in Word" is the sentence (importSummaryText); this counts it. */
export function importCounts(s: ImportSession, decisions: ImportDecisions): ImportCounts {
  const r = resolvedValues(s, decisions);
  let taken = 0;
  let open = 0;
  let notFound = 0;
  for (const f of s.fields) {
    if (f.change) continue;
    const v = r.get(f.id);
    if (v !== undefined && v !== "") taken++;
    else {
      open++;
      if (f.confidence === "not_found") notFound++;
    }
  }
  return { taken, open, notFound, changed: s.fields.filter((f) => f.change).length };
}

/** Whether a cell text can stand in for the cell of a changed row (so Accept is allowed). */
export function cellTextReadable(column: CellColumn, text: string): boolean {
  return cellToParts(column, text) !== undefined;
}

// ------------------------------------------------------------------ the TRD now (update path)

export interface CurrentValue {
  exists: boolean;
  text: string;
  /** The value is an override of a project value: it is kept unless the person chooses to replace it. */
  overridden: boolean;
}

/** What the TRD says now for a field id, for the "TRD now" column when the upload updates an existing TRD. */
export function currentValue(d: TrdDocument, id: string): CurrentValue {
  const none: CurrentValue = { exists: false, text: "", overridden: false };
  if (id === "trd.title") return { exists: true, text: d.title, overridden: false };
  if (id === "trd.docRef") return { exists: Boolean(d.docRef), text: d.docRef ?? "", overridden: false };
  if (id === "trd.version") return { exists: Boolean(d.version), text: d.version ?? "", overridden: false };
  if (id === "trd.purpose") return { exists: Boolean(d.purpose), text: d.purpose ?? "", overridden: false };
  if (id === "trd.scopeNote") return { exists: Boolean(d.scopeNote), text: d.scopeNote ?? "", overridden: false };
  const detail = /^trd\.detail\.(.+)$/.exec(id)?.[1];
  if (detail) {
    const f = d.details.find((x) => x.key === detail);
    if (!f) return none;
    const v = effectiveField(f);
    return { exists: v.status === "established", text: v.status === "established" ? v.text : "", overridden: v.overridden };
  }
  const p = parseFieldId(id);
  if (!p || p.part.startsWith("cell_")) return none;
  const step = findStep(d, p.ref);
  const item = step?.items.find((i) => i.collection === "param" && i.key === p.key);
  if (!item) return none;
  const v = limitParts(item.limits)[p.part as TrdPart];
  return { exists: v !== undefined, text: v ?? "", overridden: false };
}

function findStep(d: TrdDocument, ref: string): TrdStep | undefined {
  const refs = stepRefs(d);
  return d.steps.find((s) => refs.get(s.id) === ref) ?? d.steps.find((s) => s.id === ref);
}

// ------------------------------------------------------------------ building the limits

interface PartState {
  /** The file states a value. */
  has: boolean;
  /** The accepted text ("" = accepted as no value); undefined = not accepted. */
  accepted: string | undefined;
}

/**
 * The set point, NOR and PAR of one parameter from the accepted values. `current` is what the TRD has now (left alone when a part
 * cannot be built); `meta` is where a value that did not change takes its sources and basis from. Warnings say, in words, what was
 * left open and why.
 */
function buildLimits(label: string, parts: Map<TrdPart, PartState>, current: TrdLimits | undefined, meta: TrdLimits | undefined, note: string): { limits: TrdLimits | undefined; warnings: string[] } {
  const warnings: string[] = [];
  const out: TrdLimits = current ? structuredClone(current) : {};
  const unit = parts.get("unit");
  const unitText = unit?.accepted?.trim() || undefined;
  const unitOpen = Boolean(unit?.has && unit.accepted === undefined);
  const say = (m: string) => warnings.push(`${label}: ${m}`);

  const read = (p: TrdPart, what: string): { value: number; unit?: string } | "pending" | "bad" | "none" => {
    const st = parts.get(p);
    if (!st || (!st.has && st.accepted === undefined)) return "none";
    if (st.accepted === undefined) return "pending";
    if (st.accepted === "") return "none";
    const n = parseNumberText(st.accepted);
    if (!n) {
      say(`${what} "${st.accepted}" is not a number, so it was left open.`);
      return "bad";
    }
    return n;
  };
  const pickUnit = (own: (string | undefined)[], what: string): { unit?: string; ok: boolean } => {
    const owns = [...new Set(own.filter((u): u is string => Boolean(u)))];
    if (owns.length > 1) {
      say(`${what} gives two different units (${owns.join(" and ")}). Units are never converted, so it was left open.`);
      return { ok: false };
    }
    const u = owns[0] ?? unitText;
    if (!u && unitOpen) say(`the unit of ${what} was not accepted, so it is stored without a unit.`);
    if (owns[0] && unitText && owns[0] !== unitText) say(`${what} states ${owns[0]} while the unit column says ${unitText}. The unit written in the cell was kept.`);
    return { ...(u ? { unit: u } : {}), ok: true };
  };

  // Set point
  const set = read("set", "the set point");
  if (set === "pending" || set === "bad") {
    if (set === "pending") say("the set point was not accepted, so it is left open.");
  } else if (set !== "none") {
    const u = pickUnit([set.unit], "the set point");
    if (u.ok) {
      const same = meta?.setPoint && meta.setPoint.value === set.value && (meta.setPoint.unit ?? "") === (u.unit ?? "");
      out.setPoint = same ? structuredClone(meta!.setPoint!) : { value: set.value, ...(u.unit ? { unit: u.unit } : {}), sourceIds: [] };
    }
  } else if (parts.get("set")?.accepted === "" && parts.get("set")?.has) delete out.setPoint;

  for (const [name, lowP, highP] of [["NOR", "nor_low", "nor_high"], ["PAR", "par_low", "par_high"]] as const) {
    const key = name === "NOR" ? "nor" : "par";
    const lo = read(lowP, `${name} low`);
    const hi = read(highP, `${name} high`);
    if (lo === "bad" || hi === "bad") continue;
    if (lo === "pending" || hi === "pending") {
      say(`${name} was not built: every end the file states has to be accepted first (one end alone would change what the range says).`);
      continue;
    }
    if (lo === "none" && hi === "none") {
      if ((parts.get(lowP)?.has || parts.get(highP)?.has) && parts.get(lowP)?.accepted === "" && parts.get(highP)?.accepted === "") delete out[key];
      continue;
    }
    const u = pickUnit([lo !== "none" ? lo.unit : undefined, hi !== "none" ? hi.unit : undefined], name);
    if (!u.ok) continue;
    const min = lo === "none" ? undefined : lo.value;
    const max = hi === "none" ? undefined : hi.value;
    const base = meta?.[key];
    const same = base && base.min === min && base.max === max && (base.unit ?? "") === (u.unit ?? "");
    if (same) out[key] = structuredClone(base!);
    else {
      const r: TrdRange = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(u.unit ? { unit: u.unit } : {}), sourceIds: [...(base?.sourceIds ?? [])] };
      if (base?.locations) r.locations = base.locations;
      if (base?.basis) r.basis = base.basis;
      if (base?.provisional) r.provisional = true;
      r.note = note;
      out[key] = r;
    }
    if (min === undefined || max === undefined) say(`${name} has only ${min === undefined ? "an upper" : "a lower"} end: the file did not state the other one, which stays not established.`);
  }
  const empty = !out.setPoint && !out.nor && !out.par;
  return { limits: empty ? undefined : out, warnings };
}

// ------------------------------------------------------------------ applying

export interface ApplyOptions {
  actor: Actor;
  /** New TRD (the title is required) or an update of the TRD with this id. */
  target: { kind: "new"; title: string } | { kind: "update"; trdId: string };
  library?: readonly TrdLibraryWriteup[];
}

export interface ImportApplyResult {
  project: Project;
  trdId: string;
  counts: ImportCounts;
  /** What was left open or noted while the limits were built. */
  warnings: string[];
}

const DOC_KEY: Record<string, "title" | "docRef" | "version" | "purpose" | "scopeNote"> = { "trd.title": "title", "trd.docRef": "docRef", "trd.version": "version", "trd.purpose": "purpose", "trd.scopeNote": "scopeNote" };

function paramLabel(s: ImportSession, ref: string, key: string): { step: string; param: string } {
  const f = s.fields.find((x) => { const p = parseFieldId(x.id); return p && p.ref === ref && p.key === key; });
  return { step: f?.group ?? ref, param: f?.sub ?? key };
}

/** Makes a TRD from the accepted values (new), or brings the accepted values into an existing TRD (update). The change log keeps the evidence. */
export function applyImport(project: Project, s: ImportSession, decisions: ImportDecisions, opts: ApplyOptions): ImportApplyResult {
  const { actor } = opts;
  const values = resolvedValues(s, decisions);
  const counts = importCounts(s, decisions);
  const isNew = opts.target.kind === "new";
  const warnings: string[] = [];
  let next: Project;
  let trdId: string;

  if (opts.target.kind === "new") {
    const title = opts.target.title.trim();
    if (!title) throw new TrdImportError("Give the new TRD a title.");
    if (s.level === 1) {
      const r = adoptRecord(project, s.record!, title, actor);
      next = r.project;
      trdId = r.trdId;
    } else {
      const r = createTrd(project, { title, start: { kind: "blank" }, ...(opts.library ? { library: opts.library } : {}) }, actor);
      next = r.project;
      trdId = r.trdId;
    }
  } else {
    next = structuredClone(project);
    trdId = opts.target.trdId;
  }
  const d = next.trd.documents.find((x) => x.id === trdId);
  if (!d) throw new TrdImportError(`TRD ${trdId} is not in this project.`);
  const log = (ev: Omit<ChangeEvent, "at" | "by">) => next.changeLog.push({ at: actor.at, by: actor.name, ...ev });
  const evidence: { field: string; value: string; source: string }[] = [];
  const note = `Taken from ${s.fileName} on upload`;

  // Document fields and details.
  const refOf = (id: string) => s.fields.find((f) => f.id === id);
  for (const f of s.fields) {
    const v = values.get(f.id);
    if (f.change || v === undefined || v === "") continue;
    const dk = DOC_KEY[f.id];
    if (dk) {
      if (isNew && dk === "title") continue;
      if (d[dk] === v) continue;
      const before = d[dk] ?? null;
      d[dk] = v;
      evidence.push({ field: f.id, value: v, source: f.source });
      if (!isNew) log({ action: "trd_import_value", path: `trd.${d.id}.${dk}`, detail: `${d.id}, ${f.label}: ${before ?? "(empty)"} -> ${v}. Imported from ${s.fileName}.`, before, after: v });
      continue;
    }
    const dm = /^trd\.detail\.(.+)$/.exec(f.id)?.[1];
    if (dm) {
      const df = d.details.find((x) => x.key === dm);
      if (!df) continue;
      const now = effectiveField(df);
      if (now.status === "established" && now.text === v) continue;
      const before = df.override ?? null;
      df.override = { status: "established", display: v, reason: `Imported from ${s.fileName}`, by: actor.name, at: actor.at };
      evidence.push({ field: f.id, value: v, source: f.source });
      if (!isNew) log({ action: "trd_import_value", path: `trd.${d.id}.details.${dm}`, detail: `${d.id}, ${f.label}: ${now.status === "established" ? now.text : "not established"} -> ${v}${now.overridden ? " (replaced your override)" : ""}. Imported from ${s.fileName}.`, before, after: df.override });
    }
  }

  // A decided cell whose text is not numbers cannot be turned into a value: say so, never guess.
  for (const f of s.fields) {
    const dec = f.change ? decisions[f.id] : undefined;
    if (f.change && dec && dec.value.trim() && !cellToParts(f.change.column, dec.value)) warnings.push(`${f.group}, ${f.sub ?? ""}: "${dec.value}" in the ${f.change.column} column could not be read as numbers, so it was left open.`);
  }

  // Parameters. Group the parameter fields by step and parameter.
  const params = new Map<string, { ref: string; key: string }>();
  for (const f of s.fields) {
    const p = parseFieldId(f.id);
    if (p) params.set(`${p.ref}|${p.key}`, { ref: p.ref, key: p.key });
  }
  const taken: string[] = [];
  const refs = isNew && s.level === 1 ? stepRefs(d) : undefined;
  void refs;
  for (const { ref, key } of params.values()) {
    const state = new Map<TrdPart, PartState>();
    let any = false;
    for (const part of TRD_PARTS) {
      const f = refOf(partId(ref, key, part));
      if (!f) continue;
      const accepted = values.get(f.id);
      state.set(part, { has: f.value !== "" || (f.lockedBy !== undefined && accepted !== undefined), accepted });
      if (accepted !== undefined) any = true;
    }
    const names = paramLabel(s, ref, key);
    const label = `${names.step}, ${names.param}`;
    let step = findStep(d, ref);
    let item = step?.items.find((i) => i.collection === "param" && i.key === key);
    const meta = s.level === 1 ? s.record!.record.steps.find((x) => stepRefs(s.record!.record).get(x.id) === ref)?.items.find((i) => i.collection === "param" && i.key === key)?.limits : undefined;
    // New TRD from a record: nothing is carried that was not accepted, so the record's limits start out empty.
    if (isNew && s.level === 1 && item) delete item.limits;
    if (!any) continue;
    const built = buildLimits(label, state, item?.limits, meta, note);
    warnings.push(...built.warnings);
    if (!built.limits) continue;
    if (!step) {
      const known = s.form?.steps.find((x) => x.ref === ref);
      step = { id: nextTrdStepId(next, d.id, d.steps.map((x) => x.id)), ...(known?.key ? { key: known.key } : {}), label: names.step, custom: !known?.key, entered: true, fields: [], items: [] };
      d.steps.push(step);
    }
    if (!item) {
      item = { collection: "param", key, label: names.param, custom: false, entered: true, fields: [{ key: "classification", label: "Classification" }] };
      step.items.push(item);
    }
    const before = item.limits ? structuredClone(item.limits) : null;
    if (JSON.stringify(before) === JSON.stringify(built.limits)) continue;
    item.limits = built.limits;
    const text = [built.limits.setPoint ? `set point ${setPointText(built.limits.setPoint)}` : "", built.limits.nor ? `NOR ${rangeText(built.limits.nor)}` : "", built.limits.par ? `PAR ${rangeText(built.limits.par)}` : ""].filter(Boolean).join("; ");
    for (const part of TRD_PARTS) {
      const f = refOf(partId(ref, key, part));
      const v = f ? values.get(f.id) : undefined;
      if (f && v !== undefined && v !== "") {
        const cell = f.lockedBy ? field(s, f.lockedBy) : undefined;
        evidence.push({ field: f.id, value: v, source: cell ? `${cell.source}; chosen on the review screen` : f.source });
        taken.push(f.id);
      }
    }
    if (!isNew) log({ action: "trd_import_value", path: `trd.${d.id}.${step.id}.param.${key}.limits`, detail: `${d.id}, ${label}: ${text}. Imported from ${s.fileName}.`, before, after: built.limits });
  }

  d.updatedAt = actor.at;
  const check = trdDocumentSchema.safeParse(d);
  if (!check.success) throw new TrdImportError(`The TRD would not be valid: ${check.error.issues[0]?.message ?? "unknown problem"}.`);
  log({
    action: "trd_import",
    path: `trd.${d.id}`,
    detail: `Imported from ${s.fileName}: ${importSummaryText(counts, s.level)}${isNew ? ` (new TRD ${d.id})` : ` (update of ${d.id})`}.`,
    after: { file: s.fileName, level: s.level, counts, evidence, warnings },
  });
  return { project: next, trdId: d.id, counts, warnings };
}

/**
 * A new TRD from the record stored in a Word file. Everything outside the parameter values (descriptions, equipment, the source
 * register entries it cites) comes as it was exported; the set points and ranges start empty and are rebuilt from what is accepted.
 * The TRD is a draft again, it starts a new history here, and a citation that would point at a different document in this project is
 * dropped from the list of sources it brings (the id is kept, so the gap shows as "Source not found in the register").
 */
function adoptRecord(project: Project, env: TrdDataEnvelope, title: string, actor: Actor): { project: Project; trdId: string } {
  const next = structuredClone(project);
  const d = structuredClone(env.record);
  const id = nextTrdDocumentId(next);
  d.id = id;
  d.title = title;
  d.status = "draft";
  d.createdAt = actor.at;
  d.updatedAt = actor.at;
  const sameProject = env.projectId === project.meta.id;
  d.origin = { ...d.origin, kind: d.origin.kind === "project" && !sameProject ? "seed-import" : d.origin.kind, importedAt: actor.at };
  delete d.origin.updatedFromAt;
  for (const src of env.sources) {
    const have = next.sources.find((x) => x.id === src.id);
    if (!have) next.sources.push(src);
  }
  next.trd.documents.push(d);
  next.changeLog.push({ at: actor.at, by: actor.name, action: "trd_add", path: `trd.${id}`, detail: `TRD ${id}: ${title}, made from a Word file this tool wrote (${d.steps.length} process steps)`, after: { id, title, origin: d.origin.kind, steps: d.steps.map((s) => s.label) } });
  return { project: next, trdId: id };
}

