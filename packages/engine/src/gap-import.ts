import {
  fullRef,
  getEntry,
  SCHEMA_VERSION,
  unitDef,
  type Actor,
  type ChangeEvent,
  type Entry,
  type EntryValue,
  type Option,
  type Project,
  type Quantity,
  type Range,
} from "@gap/process-model";
import { fieldLabel, optionsFor, parameterFields, sameAsSourceAllowed, type ContentBundle } from "./content";
import type { ParameterField, Question, Section } from "./content-schema";
import type { DocModel } from "./document";
import { formatQuestionSide, formatValue, questionLabel } from "./format";
import type { GapImportSynonyms } from "./gap-synonyms";
import { cellKey, filledControl, linkCells, majorVersion, norm, sameSeq, containsSeq, toks, type Confidence, type ImportCounts, type UploadRead, type ViewBlock, type WordTable } from "./import-shared";
import { applyAnswer, AnswerError, normalizeParamField, normalizeValue, type AnswerInput, type FieldAnswer } from "./interview";
import { documentFingerprint } from "./review";
import { instanceRefs, treeOrder, visibleInstances, type QuestionInstance } from "./sequencer";
import { readValue } from "./trd-value";

/**
 * Upload a finished GAP ASSESSMENT (job I4). The same three levels as the TRD and sampling plan uploads, on the same shared reader and
 * review words (import-shared.ts):
 *
 *  - Level 1: a Word file this tool made (the Document page). It carries every answer as the tool recorded it, and the printed answer
 *    tables. On upload the printed tables are compared with the stored ones: an answer somebody typed over in Word is a "Changed in Word"
 *    row that stays OPEN until the person takes the file's text or keeps the exported answer.
 *  - Level 2: the fill-in form. One table per section, a content control per answer tagged with the question and the side. A control
 *    nobody filled is NOT ESTABLISHED (an open item), never a value.
 *  - Level 3: any other Word or PDF (gap-match.ts): rows are matched to the catalogue by the question's text and every answer is a
 *    SUGGESTION ("Matched").
 *
 * The review model is QUESTION BASED: one row per question of the catalogue, with the sending-unit and the receiving-unit answer in it.
 * Rules kept here (the product's own rules):
 *  - NOTHING IS DECIDED for the person. An answer becomes part of a project only when it is accepted (or typed) on the review screen, and
 *    it goes in through the same applyAnswer the interview uses, so every rule of a typed answer holds for an imported one too.
 *  - NO DEFAULTS: an unfilled cell is an open item; an accepted empty value never clears an answer the project already has.
 *  - UNITS ARE NEVER CONVERTED, and a number with no unit is not put in where the question asks for a quantity.
 *  - An answer that does not fit the question's choices is Not found, with the reason, and its words go to "Not used yet".
 *  - The tool never decides a filing category, and it never sets the project stage by itself (the stage is an ordinary question).
 */

export const GAP_DATA_FORMAT = "cascade.gap-data";
export const GAP_FORM_FORMAT = "cascade.gap-form";
export const GAP_DATA_VERSION = "1.0.0";

export class GapImportError extends Error {}

export type GapSide = "source" | "target" | "shared";
export const GAP_SIDE_LABEL: Record<GapSide, string> = { source: "Sending unit (SU)", target: "Receiving unit (RU)", shared: "Both units" };
export const GAP_SIDE_SHORT: Record<GapSide, string> = { source: "SU", target: "RU", shared: "Both" };

export const gapFieldId = (questionId: string, side: GapSide) => `gap.q.${questionId}.${side}`;
export const GAP_TITLE_ID = "gap.title";
export const parseGapFieldId = (id: string): { questionId: string; side: GapSide } | undefined => {
  const m = /^gap\.q\.([a-z0-9_.]+)\.(source|target|shared)$/.exec(id);
  return m ? { questionId: m[1]!, side: m[2] as GapSide } : undefined;
};

const sidesOfQuestion = (q: Question): GapSide[] => (q.sides === "shared" ? ["shared"] : q.sides === "paired" ? ["source", "target"] : [q.sides]);

/** The questions in the order the interview asks them: sections in order, each section's tree. */
export function orderedQuestions(content: ContentBundle): { q: Question; section: Section; depth: number }[] {
  const out: { q: Question; section: Section; depth: number }[] = [];
  for (const s of [...content.sections].sort((a, b) => a.order - b.order)) for (const { q, depth } of treeOrder(content, s.id)) out.push({ q, section: s, depth });
  return out;
}

// ------------------------------------------------------------------ the answer as text (what the tables and the form show)

const TBD_TEXT = /^(?:tbd|tbc|to be decided(?: \(tbd\))?|to be determined|to be confirmed)$/i;
const SAME_TEXT = /^same as (?:su|the su|sending unit|the sending unit|sending site|source)\.?$/i;
const NA_TEXT = /^(?:not applicable|n\/a|n\.a\.|na)\s*(?:[:\-–]\s*(.*))?$/i;

const PARAM_OPTION_SET: Partial<Record<ParameterField, string>> = { classification: "classification", rangeBasis: "rangeBasis" };

function fieldText(content: ContentBundle, q: Question, f: ParameterField | undefined, a: FieldAnswer): string {
  switch (a.kind) {
    case "tbd":
      return "TBD";
    case "same_as_source":
      return "Same as SU";
    case "not_applicable":
      return `Not applicable: ${a.justification}`;
    case "value":
      return formatValue(content, q, a.value, f ? PARAM_OPTION_SET[f] : undefined);
  }
}

/** An answer as the text the review screen, the form and the tables show. Reading the text back (parseGapAnswer) gives the same answer. */
export function gapInputText(content: ContentBundle, q: Question, input: AnswerInput): string {
  if (input.kind !== "composite") return fieldText(content, q, undefined, input);
  return Object.entries(input.fields)
    .map(([f, a]) => `${fieldLabel(content, f)}: ${fieldText(content, q, f as ParameterField, a!)}`)
    .join("; ");
}

// ------------------------------------------------------------------ reading an answer from text (every level)

export type GapParsed = { ok: true; input: AnswerInput } | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const list = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join("; ")}; ...` : xs.join("; "));

function matchOption(options: readonly Option[], text: string, loose: boolean): Option | undefined {
  const t = toks(text);
  if (!t.length) return undefined;
  const exact = options.filter((o) => sameSeq(toks(o.label), t) || sameSeq(toks(o.value.replace(/_/g, " ")), t));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || !loose) return undefined;
  // Level 3 only: a longer cell ("Frozen, -80 °C") that contains exactly one choice (the longest). The review shows the choice, not the cell.
  const inside = options.filter((o) => toks(o.label).length > 0 && containsSeq(t, toks(o.label)));
  const longest = Math.max(0, ...inside.map((o) => toks(o.label).length));
  const best = inside.filter((o) => toks(o.label).length === longest);
  return best.length === 1 ? best[0] : undefined;
}

function unitFor(q: Question, unit: string | undefined): { unit: string } | { reason: string } {
  const allowed = q.input.units ?? [];
  // A count (batches, runs, units) has no unit symbol: the question's own unit "count" is the number itself, not a unit the tool adds.
  if (!unit && allowed.length === 1 && allowed[0] === "count") return { unit: "count" };
  if (!unit) return { reason: `it has no unit. This question takes a unit: ${allowed.join(", ")}. Units are never added for you.` };
  const hit = allowed.filter((u) => u === unit || u.toLowerCase() === unit.toLowerCase());
  if (hit.length === 1 && unitDef(hit[0]!)) return { unit: hit[0]! };
  return { reason: `the unit "${unit}" is not one this question takes (${allowed.join(", ")}). Units are never converted.` };
}

function readQuantity(q: Question, text: string): { ok: true; value: Quantity } | { ok: false; reason: string } {
  const r = readValue(text);
  if (r.kind === "refused") return fail(`"${norm(text)}" cannot be read: ${r.reason}`);
  if (r.kind !== "number") return fail(`"${norm(text)}" is not a number with a unit${q.input.units?.length ? ` (${q.input.units.join(", ")})` : ""}.`);
  const u = unitFor(q, r.unit);
  if ("reason" in u) return fail(`"${norm(text)}": ${u.reason}`);
  return { ok: true, value: { value: r.value, unit: u.unit } };
}

function readRange(q: Question, text: string): { ok: true; value: Range } | { ok: false; reason: string } {
  const r = readValue(text);
  if (r.kind === "refused") return fail(`"${norm(text)}" cannot be read: ${r.reason}`);
  const one = (n: number, unit: string | undefined): Quantity | string => {
    const u = unitFor(q, unit);
    return "reason" in u ? `"${norm(text)}": ${u.reason}` : { value: n, unit: u.unit };
  };
  if (r.kind === "range") {
    const lo = one(r.low, r.lowUnit ?? r.unit);
    const hi = one(r.high, r.highUnit ?? r.unit);
    if (typeof lo === "string") return fail(lo);
    if (typeof hi === "string") return fail(hi);
    if (lo.unit === hi.unit && lo.value > hi.value) return fail(`"${norm(text)}": the minimum is greater than the maximum.`);
    return { ok: true, value: { min: lo, max: hi } };
  }
  if (r.kind === "max" || r.kind === "min") {
    const x = one(r.value, r.unit);
    if (typeof x === "string") return fail(x);
    return { ok: true, value: r.kind === "max" ? { max: x } : { min: x } };
  }
  return fail(`"${norm(text)}" is not a range or a limit with a unit, for example "2-8 ${q.input.units?.[0] ?? "°C"}".`);
}

/** Words for the parts of a parameter answer, longest first: "Set point 5 °C; NOR 2-8 °C" or "NOR: 2-8 °C". */
function paramAliases(content: ContentBundle): { field: ParameterField; words: string[] }[] {
  const base: Record<ParameterField, string[]> = {
    classification: ["classification", "class", "parameter class", "criticality"],
    setPoint: ["set point", "setpoint", "set-point", "sp", "target"],
    nor: ["nor", "normal operating range"],
    par: ["par", "proven acceptable range"],
    validatedRange: ["validated range", "demonstrated range", "validated", "demonstrated"],
    rangeBasis: ["range basis", "basis of range", "basis"],
  };
  return (Object.keys(base) as ParameterField[]).map((f) => ({ field: f, words: [...new Set([...base[f], fieldLabel(content, f).toLowerCase()])] }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]*");

function splitParts(content: ContentBundle, text: string): { field: ParameterField; text: string }[] | { reason: string } {
  const aliases = paramAliases(content).flatMap((a) => a.words.map((w) => ({ field: a.field, w }))).sort((x, y) => y.w.length - x.w.length);
  const out: { field: ParameterField; text: string }[] = [];
  for (const part of text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const hit = aliases.map((a) => ({ a, m: new RegExp(`^${escapeRe(a.w)}(?:\\s*[:=]\\s*|\\s+)(.+)$`, "i").exec(part) })).find((x) => x.m);
    if (!hit) return { reason: `"${part}" does not start with the name of a part (Set point, NOR, PAR, ...).` };
    if (out.some((o) => o.field === hit.a.field)) return { reason: `${fieldLabel(content, hit.a.field)} is given twice.` };
    out.push({ field: hit.a.field, text: hit.m![1]!.trim() });
  }
  return out;
}

function parseField(content: ContentBundle, q: Question, side: GapSide, f: ParameterField | undefined, text: string, syn: GapImportSynonyms | undefined, loose: boolean): { ok: true; answer: FieldAnswer } | { ok: false; reason: string } {
  const t = norm(text);
  if (TBD_TEXT.test(t)) return { ok: true, answer: { kind: "tbd" } };
  if (SAME_TEXT.test(t)) {
    if (side !== "target" || !sameAsSourceAllowed(q)) return fail("\"Same as SU\" is only available for the receiving unit of a question asked of both units.");
    return { ok: true, answer: { kind: "same_as_source" } };
  }
  const na = NA_TEXT.exec(t);
  if (na) {
    const why = norm(na[1]);
    return why ? { ok: true, answer: { kind: "not_applicable", justification: why } } : fail('"Not applicable" needs a reason: write "Not applicable: <why>".');
  }
  if (/\(TBD best guess, provisional\)$/i.test(t)) return fail("a TBD best guess cannot be read back as an answer. Write the value you know, or TBD.");
  const wrap = (r: { ok: true; value: EntryValue } | { ok: false; reason: string }): { ok: true; answer: FieldAnswer } | { ok: false; reason: string } => (r.ok ? { ok: true, answer: { kind: "value", value: r.value } } : r);
  if (f) {
    const set = PARAM_OPTION_SET[f];
    if (set) {
      const o = matchOption(content.catalog.optionSets[set] ?? [], t, loose);
      return o ? { ok: true, answer: { kind: "value", value: o.value } } : fail(`"${t}" is not one of the choices for ${fieldLabel(content, f)}: ${list((content.catalog.optionSets[set] ?? []).map((x) => x.label))}.`);
    }
    return wrap(f === "setPoint" ? readQuantity(q, t) : readRange(q, t));
  }
  const type = q.input.type;
  if (type === "choice") {
    const opts = optionsFor(content, q);
    const o = matchOption(opts, t, loose);
    return o ? { ok: true, answer: { kind: "value", value: o.value } } : fail(`"${t}" is not one of the choices: ${list(opts.map((x) => x.label))}.`);
  }
  if (type === "multi_choice") {
    const opts = optionsFor(content, q);
    const tryParts = (parts: string[]) => {
      const values: string[] = [];
      const bad: string[] = [];
      for (const p of parts) {
        const o = matchOption(opts, p, loose);
        if (o) values.push(o.value);
        else bad.push(p);
      }
      return { values, bad };
    };
    let r = tryParts(t.split(/[;\n]/).map((p) => p.trim()).filter(Boolean));
    if (r.bad.length && !/[;\n]/.test(t)) {
      const comma = tryParts(t.split(/,\s*|\s+\band\b\s+/i).map((p) => p.trim()).filter(Boolean));
      if (comma.bad.length === 0) r = comma;
    }
    if (r.bad.length) return fail(`${r.bad.map((b) => `"${b}"`).join(", ")} ${r.bad.length === 1 ? "is" : "are"} not among the choices: ${list(opts.map((x) => x.label))}. Separate several choices with a semicolon.`);
    return r.values.length ? { ok: true, answer: { kind: "value", value: [...new Set(r.values)] } } : fail("choose at least one of the options.");
  }
  if (type === "yes_no") {
    const k = toks(t);
    const yes = ["yes", "y", "true", ...(syn?.yesNo.yes ?? [])].map((w) => toks(w));
    const no = ["no", "n", "false", ...(syn?.yesNo.no ?? [])].map((w) => toks(w));
    const isYes = yes.some((w) => sameSeq(w, k));
    const isNo = no.some((w) => sameSeq(w, k));
    if (isYes === isNo) return fail(`"${t}" is not a yes or a no.`);
    return { ok: true, answer: { kind: "value", value: isYes } };
  }
  if (type === "text") return { ok: true, answer: { kind: "value", value: t } };
  if (type === "quantity") return wrap(readQuantity(q, t));
  if (type === "range") return wrap(readRange(q, t));
  return fail("this question takes a separate answer for each part.");
}

/**
 * The answer a text says for one side of one question, or the reason it cannot be put in as it stands. `loose` is for level 3 only: it
 * lets a longer cell that contains exactly one of the question's choices stand for that choice.
 */
export function parseGapAnswer(content: ContentBundle, q: Question, side: GapSide, text: string, syn?: GapImportSynonyms, loose = false): GapParsed {
  const t = norm(text);
  if (!t) return fail("there is no answer to read.");
  if (q.input.type !== "parameter") {
    const r = parseField(content, q, side, undefined, t, syn, loose);
    return r.ok ? { ok: true, input: r.answer.kind === "value" ? { kind: "value", value: r.answer.value } : r.answer } : r;
  }
  if (side === "shared") return fail("a parameter is asked of one unit at a time.");
  const whole = parseField(content, q, side, undefined, t, syn, loose);
  // A whole-question statement (TBD, Same as SU, Not applicable) applies to every part, as in the interview.
  if (whole.ok === false && !/^[A-Za-z]/.test(t)) return whole;
  const wholeKind = TBD_TEXT.test(t) || SAME_TEXT.test(t) || NA_TEXT.test(t);
  if (wholeKind) return whole.ok ? { ok: true, input: whole.answer as AnswerInput } : whole;
  const parts = splitParts(content, t);
  if ("reason" in parts) return fail(`${parts.reason} Write each part like "Set point 5 °C; NOR 2-8 °C".`);
  const want = parameterFields(q, side);
  const missing = want.filter((f) => !parts.some((p) => p.field === f));
  if (missing.length) return fail(`this question needs every part (${want.map((f) => fieldLabel(content, f)).join(", ")}); missing: ${missing.map((f) => fieldLabel(content, f)).join(", ")}. Write TBD for a part you do not know yet.`);
  const extra = parts.filter((p) => !want.includes(p.field));
  if (extra.length) return fail(`${extra.map((e) => fieldLabel(content, e.field)).join(", ")} is not asked of the ${side === "source" ? "sending" : "receiving"} unit for this question.`);
  const fields: Partial<Record<ParameterField, FieldAnswer>> = {};
  for (const p of parts) {
    const r = parseField(content, q, side, p.field, p.text, syn, loose);
    if (!r.ok) return fail(`${fieldLabel(content, p.field)}: ${r.reason}`);
    fields[p.field] = r.answer;
  }
  return { ok: true, input: { kind: "composite", fields } };
}

/** Why a text cannot be put in as it stands, or undefined when it can (an empty text is "nothing", not a problem). Accept is off for a text with a reason. */
export function checkGapValue(content: ContentBundle, q: Question, side: GapSide, text: string, syn?: GapImportSynonyms): string | undefined {
  if (!norm(text)) return undefined;
  const r = parseGapAnswer(content, q, side, text, syn);
  return r.ok ? undefined : r.reason;
}

/** Why a stored answer (the data a Word file carries) does not fit this catalogue's question, or undefined. Nothing is written. */
function problemWithInput(content: ContentBundle, q: Question, side: GapSide, input: AnswerInput): string | undefined {
  try {
    if (input.kind === "same_as_source") return side === "target" && sameAsSourceAllowed(q) ? undefined : "\"Same as SU\" does not fit this question.";
    if (input.kind === "tbd" || input.kind === "not_applicable") return undefined;
    if (q.input.type === "parameter") {
      if (input.kind !== "composite") return "this question takes a separate answer for each part.";
      const want = side === "shared" ? [] : parameterFields(q, side);
      if (want.some((f) => !input.fields[f]) || Object.keys(input.fields).some((f) => !(want as string[]).includes(f))) return "the parts of this question have changed since the file was made.";
      for (const f of want) {
        const a = input.fields[f]!;
        if (a.kind === "value") normalizeParamField(content, q, f, a.value);
      }
      return undefined;
    }
    if (input.kind === "composite") return "this question no longer takes a separate answer for each part.";
    if (input.kind === "value") normalizeValue(content, q, input.value);
    return undefined;
  } catch (e) {
    return e instanceof AnswerError ? e.message : "the stored answer does not fit this question.";
  }
}

// ------------------------------------------------------------------ what a project holds now

export interface GapProjectAnswer {
  input: AnswerInput;
  text: string;
}

const oneEntry = (e: Entry | undefined): FieldAnswer | undefined => {
  if (!e || e.status === "not_established") return undefined;
  if (e.sameAsSource) return { kind: "same_as_source" };
  if (e.status === "tbd") return { kind: "tbd", ...(e.tbd?.bestGuess !== undefined ? { bestGuess: e.tbd.bestGuess } : {}), ...(e.tbd?.owner ? { owner: e.tbd.owner } : {}), ...(e.tbd?.due ? { due: e.tbd.due } : {}), ...(e.tbd?.note ? { note: e.tbd.note } : {}) };
  if (e.status === "not_applicable") return e.justification?.trim() ? { kind: "not_applicable", justification: e.justification.trim() } : undefined;
  return e.value === undefined ? undefined : { kind: "value", value: e.value };
};

/**
 * What the project holds for one question instance, as an answer the interview could record again (and as text). Undefined when the
 * question is open, or when a question of parts is only partly answered (it is not an answer yet).
 */
export function projectAnswerOf(content: ContentBundle, project: Project, inst: QuestionInstance): GapProjectAnswer | undefined {
  const q = inst.question;
  if (inst.side === "shared" || q.input.type !== "parameter") {
    const a = oneEntry(getEntry(project, instanceRefs(inst)[0]!));
    if (!a) return undefined;
    const input: AnswerInput = a;
    return { input, text: gapInputText(content, q, input) };
  }
  const side = inst.side;
  const fields: Partial<Record<ParameterField, FieldAnswer>> = {};
  for (const f of parameterFields(q, side)) {
    const a = oneEntry(getEntry(project, fullRef(side, `${q.binds}.${f}`)));
    if (!a) return undefined;
    fields[f] = a;
  }
  const all = Object.values(fields) as FieldAnswer[];
  // The same statement on every part is one whole-question answer, as the interview records it.
  if (all.every((a) => a.kind === "tbd" && !("bestGuess" in a) && !("owner" in a) && !("due" in a) && !("note" in a))) return { input: { kind: "tbd" }, text: "TBD" };
  if (all.every((a) => a.kind === "same_as_source")) return { input: { kind: "same_as_source" }, text: "Same as SU" };
  const input: AnswerInput = { kind: "composite", fields };
  return { input, text: gapInputText(content, q, input) };
}

/** The same as `projectAnswerOf` for a question id and side, using the questions the project asks now (undefined when it is not asked). */
export function projectAnswerFor(content: ContentBundle, project: Project, instances: ReadonlyMap<string, QuestionInstance>, questionId: string, side: GapSide): GapProjectAnswer | undefined {
  const inst = instances.get(`${questionId}@${side}`);
  return inst ? projectAnswerOf(content, project, inst) : undefined;
}

// ------------------------------------------------------------------ the data a Word file carries

/** An answer table as the Word export printed it, with the question each row is about. */
export interface PrintedGapTable {
  columns: string[];
  rows: string[][];
  /** "questionId@side" for each row. */
  keys: string[];
}

export interface GapDataEnvelope {
  format: typeof GAP_DATA_FORMAT;
  version: string;
  schemaVersion: string;
  fingerprint: string;
  projectId: string;
  projectTitle: string;
  answers: { key: string; input: AnswerInput }[];
  /** Questions the project asked that had no answer when the file was made (open items). */
  unanswered: number;
  tables: PrintedGapTable[];
}

const ANSWER_TABLE_FIRST_COLUMNS = ["Attribute", "Scoping attribute"];

/** The answer tables of the gap assessment document (scoping, then each section for the sending and then the receiving unit). */
export function printedGapTables(doc: DocModel, instances: readonly QuestionInstance[]): PrintedGapTable[] {
  // Which instances each table is about: the document prints scoping first, then each section's rows for SU and then for RU. A section the
  // person left out of the document leaves a table out, so every printed table is matched to the next candidate list with the same labels.
  const groups: QuestionInstance[][] = [];
  const shared = instances.filter((i) => i.side === "shared");
  if (shared.length) groups.push(shared);
  for (const side of ["source", "target"] as const) {
    const sections = new Map<string, QuestionInstance[]>();
    for (const i of instances) if (i.side === side && i.section.kind !== "scoping") sections.set(i.section.id, [...(sections.get(i.section.id) ?? []), i]);
    for (const list of sections.values()) groups.push(list);
  }
  const out: PrintedGapTable[] = [];
  let at = 0;
  for (const s of doc.sections)
    for (const b of s.blocks) {
      if (b.type !== "table" || !ANSWER_TABLE_FIRST_COLUMNS.includes(b.columns[0] ?? "") || b.columns.length < 2) continue;
      const labels = b.rows.map((r) => norm(String(r[0])));
      let g = at;
      while (g < groups.length && !(groups[g]!.length === labels.length && groups[g]!.every((i, k) => norm(questionLabel(i.question)) === labels[k]))) g++;
      if (g >= groups.length) continue;
      at = g + 1;
      out.push({ columns: [...b.columns], rows: b.rows.map((r) => r.map((c) => String(c))), keys: groups[g]!.map((i) => i.key) });
    }
  return out;
}

/** The data part of a gap assessment Word export (JSON text). */
export function buildGapData(content: ContentBundle, project: Project, doc: DocModel): string {
  const instances = visibleInstances(content, project, "paired");
  const answers: GapDataEnvelope["answers"] = [];
  let unanswered = 0;
  for (const inst of instances) {
    const a = projectAnswerOf(content, project, inst);
    if (a) answers.push({ key: inst.key, input: a.input });
    else unanswered++;
  }
  const env: GapDataEnvelope = {
    format: GAP_DATA_FORMAT,
    version: GAP_DATA_VERSION,
    schemaVersion: SCHEMA_VERSION,
    fingerprint: documentFingerprint(doc),
    projectId: project.meta.id,
    projectTitle: project.meta.title,
    answers,
    unanswered,
    tables: printedGapTables(doc, instances),
  };
  return JSON.stringify(env);
}

export function parseGapData(json: string): GapDataEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new GapImportError("The data stored in this Word file is damaged, so it cannot be read exactly.");
  }
  const e = raw as Partial<GapDataEnvelope> | null;
  if (!e || e.format !== GAP_DATA_FORMAT) throw new GapImportError("This file does not carry gap assessment data from this tool.");
  if (majorVersion(e.version ?? "") !== majorVersion(GAP_DATA_VERSION)) throw new GapImportError(`This file was made with a different format version (${e.version ?? "unknown"}). Open the project it came from and download the document again.`);
  if (!Array.isArray(e.answers)) throw new GapImportError("The answers stored in this file are not valid.");
  return { ...(e as GapDataEnvelope), answers: e.answers.filter((a) => a && typeof a.key === "string" && a.input && typeof a.input === "object"), unanswered: Number(e.unanswered) || 0, tables: Array.isArray(e.tables) ? e.tables : [], projectTitle: String(e.projectTitle ?? "") };
}

// ------------------------------------------------------------------ the fill-in form

export interface GapFormQuestion {
  id: string;
  /** What the form prints; absent in the copy that travels inside the file. */
  label?: string;
  hint?: string;
  sides: GapSide[];
  /** The answer so far, as text, for each side (a pre-filled form). Empty answers are absent. */
  values: Partial<Record<GapSide, string>>;
}
export interface GapFormSection {
  id: string;
  title: string;
  questions: GapFormQuestion[];
}
export interface GapFormSpec {
  format: typeof GAP_FORM_FORMAT;
  version: string;
  source: "blank" | "project";
  projectId?: string;
  title: string;
  sections: GapFormSection[];
}

/** What a person may write in an answer, in plain words, printed under the question on the form. */
export function gapAnswerHint(content: ContentBundle, q: Question): string {
  const t = q.input.type;
  if (t === "choice") return `Choose one: ${optionsFor(content, q).map((o) => o.label).join("; ")}.`;
  if (t === "multi_choice") return `Choose one or more, separated by semicolons: ${optionsFor(content, q).map((o) => o.label).join("; ")}.`;
  if (t === "yes_no") return "Yes or No.";
  if (t === "text") return "Write the answer in your own words.";
  if (t === "quantity") return `A number with its unit (${(q.input.units ?? []).join(" or ")}), for example "10 ${q.input.units?.[0] ?? ""}".`;
  if (t === "range") return `A range or a limit with its unit (${(q.input.units ?? []).join(" or ")}), for example "2-8 ${q.input.units?.[0] ?? ""}".`;
  const sample = `Set point 5 ${q.input.units?.[0] ?? ""}; NOR 2-8 ${q.input.units?.[0] ?? ""}`.replace(/\s+;/g, ";").trim();
  const parts = (s: "source" | "target") => parameterFields(q, s).map((f) => fieldLabel(content, f)).join(", ");
  return `Write each part with its unit, like "${sample}". Parts for SU: ${parts("source")}. Parts for RU: ${parts("target")}.`;
}

const formSectionsFor = (content: ContentBundle, values: (id: string, side: GapSide) => string | undefined): GapFormSection[] => {
  const out: GapFormSection[] = [];
  for (const { q, section } of orderedQuestions(content)) {
    let s = out[out.length - 1];
    if (!s || s.id !== section.id) {
      s = { id: section.id, title: section.title, questions: [] };
      out.push(s);
    }
    const sides = sidesOfQuestion(q);
    const v: Partial<Record<GapSide, string>> = {};
    for (const side of sides) {
      const t = values(q.id, side);
      if (t) v[side] = t;
    }
    s.questions.push({ id: q.id, label: questionLabel(q), hint: gapAnswerHint(content, q), sides, values: v });
  }
  return out;
};

/** The blank form: every question of the catalogue. A question the project would not ask is skipped on upload (the review says so). */
export function buildBlankGapFormSpec(content: ContentBundle): GapFormSpec {
  return { format: GAP_FORM_FORMAT, version: GAP_DATA_VERSION, source: "blank", title: "", sections: formSectionsFor(content, () => undefined) };
}

/** The form with what the project holds so far. Empty answers stay empty. */
export function buildGapFormSpec(content: ContentBundle, project: Project): GapFormSpec {
  const have = new Map<string, string>();
  for (const inst of visibleInstances(content, project, "paired")) {
    const a = projectAnswerOf(content, project, inst);
    if (a) have.set(inst.key, a.text);
  }
  return { format: GAP_FORM_FORMAT, version: GAP_DATA_VERSION, source: "project", projectId: project.meta.id, title: project.meta.title, sections: formSectionsFor(content, (id, side) => have.get(`${id}@${side}`)) };
}

/** The copy of the spec that travels inside the file: only what the upload needs (the form prints the rest). */
export function compactGapFormSpec(spec: GapFormSpec): GapFormSpec {
  return { ...spec, sections: spec.sections.map((s) => ({ id: s.id, title: s.title, questions: s.questions.map((q) => ({ id: q.id, sides: q.sides, values: {} })) })) };
}

export function parseGapFormSpec(json: string): GapFormSpec {
  let s: GapFormSpec;
  try {
    s = JSON.parse(json) as GapFormSpec;
  } catch {
    throw new GapImportError("The form description stored in this file is damaged. Download a new form.");
  }
  if (!s || s.format !== GAP_FORM_FORMAT || !Array.isArray(s.sections)) throw new GapImportError("This file is not a gap assessment form of this tool.");
  if (majorVersion(s.version ?? "") !== majorVersion(GAP_DATA_VERSION)) throw new GapImportError(`This form was made with a different format version (${s.version ?? "unknown"}). Download a new form and copy your answers over.`);
  return s;
}

// ------------------------------------------------------------------ the review model

export interface GapField {
  id: string;
  /** The question id. */
  row: string;
  side: GapSide;
  label: string;
  /** The answer the file gives, as text ("" = the file gives none: not established). */
  value: string;
  confidence: Confidence;
  /** Where the value was found, in words. This is what the change log keeps as evidence. */
  source: string;
  /** Why the text cannot be put in as it stands. */
  unreadable?: string;
  /** Level 3: the document had words for this answer that do not fit the question; the answer stays open and this says why. */
  notUsedWhy?: string;
  /** A "Changed in Word" row: what the export printed and what the file says now. */
  change?: { old: string; new: string };
  /**
   * Texts this tool wrote itself for this field with the answer each stands for, so accepting one unchanged records the answer exactly
   * (a TBD with its owner and date, for example) and not the shorter words on the screen.
   */
  known?: { text: string; input: AnswerInput }[];
  /** Level 3: the table of the document (index in the view blocks) the answer was matched from. */
  table?: number;
}

export interface GapRow {
  questionId: string;
  label: string;
  sectionId: string;
  sectionTitle: string;
  sides: GapSide[];
  /** Where in the document, in words (level 3). */
  where?: string;
}

export interface GapImportSession {
  level: 1 | 2 | 3;
  fileName: string;
  /** A name for a new project, from the file ("" = none). */
  title: { value: string; source: string };
  rows: GapRow[];
  fields: GapField[];
  /** Cell positions in the view blocks ("block:row:col") and the fields they feed. */
  cellFields: Record<string, string[]>;
  fieldCells: Record<string, string[]>;
  blocks: ViewBlock[];
  /** Things in the file that were left out, in words ("Not used yet"). */
  notUsed: string[];
  readAs: string;
  /** Questions of a level 1 or 2 file that have no answer in it: not established, open. */
  unfilled: number;
  /** Level 3: tables that gave at least one match, in document order. */
  matchedTables?: { block: number; label: string }[];
}

export const emptyGapField = (questionId: string, side: GapSide, source: string): GapField => ({
  id: gapFieldId(questionId, side),
  row: questionId,
  side,
  label: GAP_SIDE_LABEL[side],
  value: "",
  confidence: "not_found",
  source,
});

export function newGapSession(level: 1 | 2 | 3, read: UploadRead, readAs: string): GapImportSession {
  return { level, fileName: read.fileName, title: { value: "", source: "" }, rows: [], fields: [], cellFields: {}, fieldCells: {}, blocks: read.blocks, notUsed: [], readAs, unfilled: 0 };
}

/** Adds the row of a question to a session (once) and returns it. */
export function ensureGapRow(content: ContentBundle, s: GapImportSession, q: Question, where?: string): GapRow {
  let row = s.rows.find((r) => r.questionId === q.id);
  if (!row) {
    const section = content.sectionById.get(q.section)!;
    row = { questionId: q.id, label: questionLabel(q), sectionId: section.id, sectionTitle: section.title, sides: sidesOfQuestion(q), ...(where ? { where } : {}) };
    s.rows.push(row);
  }
  return row;
}

/** Puts the rows in the order the interview asks the questions (sessions are built in the order the file gives them). */
export function sortGapRows(content: ContentBundle, s: GapImportSession): void {
  const order = new Map(orderedQuestions(content).map((x, i) => [x.q.id, i]));
  s.rows.sort((a, b) => (order.get(a.questionId) ?? 1e9) - (order.get(b.questionId) ?? 1e9) || a.where?.localeCompare(b.where ?? "") || 0);
}

export const gapFieldOf = (s: GapImportSession, questionId: string, side: GapSide): GapField | undefined => s.fields.find((f) => f.row === questionId && f.side === side);

/** Level 2: the form. Every control the person left in the file belongs to a question side; a side nobody wrote in is not established. */
export function gapSessionFromForm(read: UploadRead, content: ContentBundle, syn?: GapImportSynonyms): GapImportSession {
  const form = parseGapFormSpec(read.dataJson ?? "");
  const s = newGapSession(2, read, "The fill-in form of this tool, read exactly.");
  const title = filledControl(read.controls[GAP_TITLE_ID]);
  if (title) s.title = { value: title, source: "Form cell: project title" };
  const asked = new Set<string>();
  for (const sec of form.sections) for (const q of sec.questions) for (const side of q.sides) asked.add(gapFieldId(q.id, side));
  for (const id of Object.keys(read.controls)) if (parseGapFieldId(id)) asked.add(id);
  let stray = 0;
  for (const id of asked) {
    const p = parseGapFieldId(id)!;
    const q = content.questionById.get(p.questionId);
    const text = filledControl(read.controls[id]);
    if (!q || !sidesOfQuestion(q).includes(p.side)) {
      if (text) stray++;
      continue;
    }
    if (!text) {
      s.unfilled++;
      continue;
    }
    ensureGapRow(content, s, q);
    const f = emptyGapField(q.id, p.side, `Form cell: ${questionLabel(q)}, ${GAP_SIDE_LABEL[p.side]}`);
    const why = checkGapValue(content, q, p.side, text, syn);
    Object.assign(f, { value: text, confidence: "exact" as const, ...(why ? { unreadable: why } : {}) });
    s.fields.push(f);
  }
  sortGapRows(content, s);
  // Which cell of the form each field is in (for highlighting).
  read.blocks.forEach((b, bi) => {
    if (b.kind !== "table") return;
    b.rows.forEach((r, ri) => r.forEach((cell, ci) => cell.controlId && s.fields.some((f) => f.id === cell.controlId) && linkCells(s, cell.controlId, cellKey(bi, ri, ci))));
  });
  const stray2 = Object.keys(read.controls).filter((id) => id !== GAP_TITLE_ID && !parseGapFieldId(id));
  if (stray + stray2.length) s.notUsed.push(`${stray + stray2.length} entries in the file do not belong to this form (or to a question this version of the tool asks) and were not used.`);
  if (s.fields.length === 0) s.notUsed.push("Nothing is written in the answer boxes of the form.");
  return s;
}

// ------------------------------------------------------------------ level 1: comparing the printed tables

export interface GapCellChange {
  key: string;
  old: string;
  new: string;
  at: { block: number; row: number; col: number };
}

export interface GapTableComparison {
  changes: GapCellChange[];
  covered: { key: string; at: { block: number; row: number; col: number } }[];
  notes: string[];
  tablesExpected: number;
  tablesFound: number;
}

/**
 * Compares the answer tables stored in the file with the tables that are really in it. A table is found by its column headings, in order;
 * a row by its question; the answer is the second column. A text that is not what the export printed is a "Changed in Word" cell.
 */
export function compareGapTables(env: GapDataEnvelope, word: readonly WordTable[]): GapTableComparison {
  const out: GapTableComparison = { changes: [], covered: [], notes: [], tablesExpected: env.tables.length, tablesFound: 0 };
  const key = (s: string) => norm(s).toLowerCase();
  let from = 0;
  for (const t of env.tables) {
    const head = t.columns.map(key);
    let at = -1;
    for (let i = from; i < word.length; i++) {
      const h = (word[i]!.rows[0] ?? []).map(key);
      if (h.length !== head.length || !h.every((x, j) => x === head[j])) continue;
      // The same headings return in every section: the table is the one that has these questions.
      const labels = new Set(word[i]!.rows.slice(1).map((r) => key(r[0] ?? "")));
      if (t.rows.filter((r) => labels.has(key(r[0] ?? ""))).length * 2 >= t.rows.length) {
        at = i;
        break;
      }
    }
    const first = t.rows[0]?.[0] ?? "?";
    if (at < 0) {
      out.notes.push(`An answer table of the export (${t.rows.length} ${t.rows.length === 1 ? "question" : "questions"}, starting at "${first}") is not in the file any more, so it could not be compared.`);
      continue;
    }
    from = at + 1;
    out.tablesFound++;
    const w = word[at]!;
    const used = new Set<number>();
    t.rows.forEach((row, ri) => {
      const k = t.keys[ri];
      if (!k) return;
      const wi = w.rows.findIndex((r, i) => i > 0 && !used.has(i) && key(r[0] ?? "") === key(row[0] ?? ""));
      if (wi < 0) {
        out.notes.push(`"${row[0]}" is not in its table of the file any more (the row was deleted or the question was reworded). It is left as it is.`);
        return;
      }
      used.add(wi);
      const at2 = { block: w.blockIndex, row: wi, col: 1 };
      out.covered.push({ key: k, at: at2 });
      const stored = norm(row[1]);
      const now = norm(w.rows[wi]![1]);
      if (stored !== now) out.changes.push({ key: k, old: stored, new: now, at: at2 });
    });
  }
  return out;
}

/** Level 1: our own Word export. The recorded answers are Exact; every answer typed over in Word is a "Changed in Word" row. */
export function gapSessionFromData(read: UploadRead, content: ContentBundle, syn?: GapImportSynonyms): GapImportSession {
  const env = parseGapData(read.dataJson ?? "");
  const s = newGapSession(1, read, "A Word file made by this tool, read exactly from the data stored in it, then compared with the tables you can see.");
  s.unfilled = env.unanswered;
  if (env.projectTitle) s.title = { value: env.projectTitle, source: "The data stored in the Word file: project title" };
  const from = "The data stored in the Word file";
  let skipped = 0;
  for (const a of env.answers) {
    const m = /^(.+)@(source|target|shared)$/.exec(a.key);
    const q = m ? content.questionById.get(m[1]!) : undefined;
    const side = m?.[2] as GapSide | undefined;
    if (!q || !side || !sidesOfQuestion(q).includes(side)) {
      skipped++;
      continue;
    }
    const input = a.input as AnswerInput;
    ensureGapRow(content, s, q);
    const f = emptyGapField(q.id, side, `${from}: ${questionLabel(q)}, ${GAP_SIDE_LABEL[side]}`);
    const why = problemWithInput(content, q, side, input);
    if (why) Object.assign(f, { value: "", confidence: "not_found" as const, unreadable: why });
    else {
      const text = gapInputText(content, q, input);
      Object.assign(f, { value: text, confidence: "exact" as const, known: [{ text, input }] });
    }
    s.fields.push(f);
  }
  if (skipped) s.notUsed.push(`${skipped} stored ${skipped === 1 ? "answer is" : "answers are"} for questions this version of the tool does not ask, and ${skipped === 1 ? "was" : "were"} not used.`);

  const cmp = compareGapTables(env, read.tables);
  const keyOfField = new Map(s.fields.map((f) => [`${f.row}@${f.side}`, f]));
  for (const ch of cmp.changes) {
    const m = /^(.+)@(source|target|shared)$/.exec(ch.key)!;
    const q = content.questionById.get(m[1]!);
    const side = m[2] as GapSide;
    if (!q) continue;
    ensureGapRow(content, s, q);
    let f = keyOfField.get(ch.key);
    if (!f) {
      f = emptyGapField(q.id, side, "");
      s.fields.push(f);
      keyOfField.set(ch.key, f);
    }
    // The exported answer stays available as "keep" (decision = its text); a question that had no answer keeps nothing (decision = empty).
    const keep = f.value && f.confidence === "exact" ? f.known : undefined;
    const why = ch.new ? checkGapValue(content, q, side, ch.new, syn) : "the cell is empty. An empty cell does not clear an answer; type the answer or keep the exported one.";
    Object.assign(f, {
      value: ch.new,
      confidence: "changed" as const,
      source: `Word table, "${questionLabel(q)}", ${GAP_SIDE_LABEL[side]}: the export printed "${ch.old || "(empty)"}", the file now says "${ch.new || "(empty)"}"`,
      change: { old: ch.old, new: ch.new },
      known: keep ?? [],
      ...(why ? { unreadable: why } : {}),
    });
    linkCells(s, f.id, cellKey(ch.at.block, ch.at.row, ch.at.col));
  }
  for (const c of cmp.covered) {
    const m = /^(.+)@(source|target|shared)$/.exec(c.key)!;
    const id = gapFieldId(m[1]!, m[2] as GapSide);
    if (s.fields.some((f) => f.id === id) && !s.fieldCells[id]) linkCells(s, id, cellKey(c.at.block, c.at.row, c.at.col));
  }
  sortGapRows(content, s);
  s.notUsed.push(...cmp.notes);
  if (env.tables.length === 0) s.notUsed.push("This file has no answer tables to compare, so only the stored answers were read.");
  return s;
}

// ------------------------------------------------------------------ decisions and counts

export interface GapDecision {
  value: string;
}
export type GapDecisions = Record<string, GapDecision>;

/** A field that can be accepted as it stands ("Accept all exact" takes exactly these). */
export const isExactGapField = (f: GapField) => f.confidence === "exact" && !f.unreadable && f.value !== "";

export function gapCounts(s: GapImportSession, decisions: GapDecisions): ImportCounts {
  let taken = 0;
  let open = 0;
  let notFound = 0;
  for (const f of s.fields) {
    const v = decisions[f.id]?.value;
    if (f.change) {
      // A changed answer is its own row on the screen: it counts as taken once decided and is never "open" next to the values.
      if (v) taken++;
      continue;
    }
    if (v !== undefined && v !== "") taken++;
    else {
      open++;
      if (f.confidence === "not_found") notFound++;
    }
  }
  // An answer typed on the review screen for a side the file gave no value for (it has no field of its own).
  const known = new Set(s.fields.map((f) => f.id));
  for (const [id, d] of Object.entries(decisions)) if (!known.has(id) && parseGapFieldId(id) && norm(d.value)) taken++;
  // Questions the file has no answer for are open items too (levels 1 and 2). In a document of another layout they are simply not in it.
  if (s.level !== 3) open += s.unfilled;
  return { taken, open, notFound, changed: s.fields.filter((f) => f.change).length };
}

// ------------------------------------------------------------------ the project now (update path)

export interface GapCurrent {
  exists: boolean;
  text: string;
}

export function currentGapText(content: ContentBundle, project: Project, instances: ReadonlyMap<string, QuestionInstance>, f: GapField): GapCurrent {
  const a = projectAnswerFor(content, project, instances, f.row, f.side);
  return a ? { exists: true, text: a.text } : { exists: false, text: "" };
}

// ------------------------------------------------------------------ applying the accepted values

export interface GapApplyOptions {
  actor: Actor;
  content: ContentBundle;
  syn?: GapImportSynonyms;
}

export interface GapApplyResult {
  project: Project;
  counts: ImportCounts;
  warnings: string[];
  /** Answers recorded. */
  applied: number;
  /** Accepted answers the project already had, word for word: nothing was recorded for them. */
  unchanged: number;
}

interface Pending {
  field: GapField;
  q: Question;
  input: AnswerInput;
  name: string;
}

const fieldName = (s: GapImportSession, f: GapField) => {
  const row = s.rows.find((r) => r.questionId === f.row);
  return row && row.sides.length === 2 ? `${row.label} (${GAP_SIDE_SHORT[f.side]})` : (row?.label ?? f.row);
};

/**
 * Brings the accepted answers into the project through applyAnswer, the interview's own function (so allowed options, units and the
 * justification rule hold, and every answer gets its source and change-log record). A question only exists in a project once the answers it
 * depends on are in (a follow-up, a step that is in scope), so the answers go in over several rounds: whatever the project asks after the
 * first round is offered in the next. An answer whose question is still not asked at the end is reported, not forced.
 */
export function applyGapImport(project: Project, s: GapImportSession, decisions: GapDecisions, opts: GapApplyOptions): GapApplyResult {
  const { actor, content, syn } = opts;
  const counts = gapCounts(s, decisions);
  const warnings: string[] = [];
  const pending: Pending[] = [];
  for (const row of s.rows) {
    const q = content.questionById.get(row.questionId);
    if (!q) continue;
    for (const side of row.sides) {
      const f = gapFieldOf(s, row.questionId, side) ?? emptyGapField(row.questionId, side, "typed on the review screen");
      const v = decisions[f.id]?.value;
      // An accepted empty value never clears an answer the project already has.
      if (!f || v === undefined || norm(v) === "") continue;
      const known = f.known?.find((k) => k.text === v);
      let input: AnswerInput;
      if (known) input = known.input;
      else {
        const r = parseGapAnswer(content, q, side, v, syn);
        if (!r.ok) {
          warnings.push(`${fieldName(s, f)} was not put in: ${r.reason}`);
          continue;
        }
        input = r.input;
      }
      pending.push({ field: f, q, input, name: fieldName(s, f) });
    }
  }

  let cur = project;
  let applied = 0;
  let unchanged = 0;
  const evidence: { field: string; value: string; source: string }[] = [];
  const todo = new Set(pending);
  for (let round = 0; round < 12 && todo.size > 0; round++) {
    const asked = new Map(visibleInstances(content, cur, "paired").map((i) => [i.key, i]));
    let progress = false;
    for (const p of [...todo]) {
      const inst = asked.get(`${p.q.id}@${p.field.side}`);
      if (!inst) continue;
      todo.delete(p);
      progress = true;
      const now = projectAnswerOf(content, cur, inst);
      const text = gapInputText(content, p.q, p.input);
      if (now && now.text === text && JSON.stringify(now.input) === JSON.stringify(p.input)) {
        unchanged++;
        continue;
      }
      const logBefore = cur.changeLog.length;
      try {
        cur = applyAnswer(cur, content, inst, p.input, actor);
      } catch (e) {
        if (e instanceof AnswerError) {
          warnings.push(`${p.name} was not put in: ${e.message}`);
          continue;
        }
        throw e;
      }
      const rec = cur.answers[cur.answers.length - 1]!;
      const src = cur.sources.find((x) => x.id === rec.sourceId);
      if (src) src.label = `${src.label} (imported from ${s.fileName})`;
      for (const ev of cur.changeLog.slice(logBefore)) ev.detail = `Imported from ${s.fileName}: ${p.field.source || "typed on the review screen"}`;
      evidence.push({ field: p.name, value: text, source: p.field.source });
      applied++;
    }
    if (!progress) break;
  }
  for (const p of todo) warnings.push(`${p.name} was not put in: this project does not ask this question. A question appears only when the answers it depends on (and the Scope) include it.`);

  const log = (ev: Omit<ChangeEvent, "at" | "by">) => cur.changeLog.push({ at: actor.at, by: actor.name, ...ev });
  cur = structuredClone(cur);
  log({
    action: "gap_import",
    path: "answers",
    detail: `Imported from ${s.fileName}: ${counts.taken} ${counts.taken === 1 ? "value" : "values"} taken; ${applied} ${applied === 1 ? "answer" : "answers"} recorded, ${unchanged} already the same.`,
    after: { file: s.fileName, level: s.level, counts, applied, unchanged, evidence, warnings },
  });
  return { project: cur, counts, warnings, applied, unchanged };
}
