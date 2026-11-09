import {
  EXCIPIENT_SIDES,
  excipientAssessmentSchema,
  excipientAssessments,
  excipientFactDef,
  excipientFactPath,
  newId,
  stableStringify,
  type Actor,
  type ChangeEvent,
  type Entry,
  type EntryValue,
  type ExcipientAssessment,
  type ExcipientFactDef,
  type ExcipientLine,
  type ExcipientLinks,
  type ExcipientSide,
  type ExcipientSpecRow,
  type ExcipientSpecSide,
  type Project,
  type Source,
  type SourceLocation,
  type TbdInfo,
} from "@gap/process-model";
import { isIsoDate } from "./interview";

/**
 * Edits of the excipient assessments in a project. Every edit returns a new project and adds one change-log event with the old value
 * kept (GMP: a reviewer must be able to see what an excipient fact was before it was changed, and by whom).
 *
 * Nothing here decides a value. A new line has no class, no grade and no supplier; a fact is what a person entered; a comparison row has
 * both sides open until somebody types them. Saving the same value again changes nothing and logs nothing. Nothing is ever refused
 * because something else is still unanswered: the only refusals are a value that cannot be stored (a number that is not a number, a
 * choice that is not on the list) and a delete without a reason.
 */

export class ExcipientError extends Error {}

const pad = (n: number) => String(n).padStart(3, "0");
const text = (v: string | undefined) => (v ?? "").trim();

type IdPrefix = "EXA" | "EXL" | "EXR";

/**
 * Next id of a kind. Ids are never reused: an id that only survives in the change log still counts as taken, so a deleted line's number
 * cannot come back and make an old log entry point at a new, different excipient.
 * Change-log paths: excipient.EXA-001 (assessment), excipient.EXA-001.EXL-001 (line and, with a key, a fact),
 * excipient.EXA-001.EXL-001.spec.EXR-001 (comparison row).
 */
function nextId(project: Project, prefix: IdPrefix, assessmentId: string | undefined, lineId: string | undefined, existing: readonly string[]): string {
  let max = 0;
  const take = (id: string | undefined) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  };
  existing.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] !== "excipient") continue;
    if (prefix === "EXA") take(parts[1]);
    else if (parts[1] === assessmentId) {
      if (prefix === "EXL") take(parts[2]);
      else if (parts[2] === lineId && parts[3] === "spec") take(parts[4]);
    }
  }
  return `${prefix}-${pad(max + 1)}`;
}

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function ensurePart(project: Project): void {
  project.excipients ??= { assessments: [] };
}

export function excipientAssessmentOf(project: Project, id: string): ExcipientAssessment {
  const a = excipientAssessments(project).find((x) => x.id === id);
  if (!a) throw new ExcipientError(`Excipient assessment ${id} does not exist`);
  return a;
}

export function excipientLineOf(a: ExcipientAssessment, id: string): ExcipientLine {
  const l = a.lines.find((x) => x.id === id);
  if (!l) throw new ExcipientError(`Excipient ${id} is not in ${a.id}`);
  return l;
}

function rowOf(l: ExcipientLine, id: string): ExcipientSpecRow {
  const r = l.specs.find((x) => x.id === id);
  if (!r) throw new ExcipientError(`Comparison row ${id} is not in ${l.id}`);
  return r;
}

/** The assessment must still satisfy its schema (unique ids, a class or the person's words, never both). The first problem is shown. */
function assertValid(a: ExcipientAssessment): void {
  const r = excipientAssessmentSchema.safeParse(a);
  if (!r.success) throw new ExcipientError(r.error.issues[0]?.message ?? "The excipient assessment is not valid");
}

const reasonOf = (reason: string | undefined, what: string): string => {
  const r = text(reason);
  if (!r) throw new ExcipientError(`Say why you are removing ${what}. The reason is kept in the change log.`);
  return r;
};

// ------------------------------------------------------------------ assessments

export function createExcipientAssessment(project: Project, input: { title: string; scopeNote?: string }, actor: Actor): { project: Project; assessmentId: string } {
  const title = text(input.title);
  if (!title) throw new ExcipientError("The assessment needs a title");
  const next = structuredClone(project);
  ensurePart(next);
  const id = nextId(next, "EXA", undefined, undefined, next.excipients!.assessments.map((a) => a.id));
  const a: ExcipientAssessment = { id, title, status: "draft", lines: [], createdAt: actor.at, updatedAt: actor.at };
  if (text(input.scopeNote)) a.scopeNote = text(input.scopeNote);
  assertValid(a);
  next.excipients!.assessments.push(a);
  log(next, actor, { action: "excipient_assessment_add", path: `excipient.${id}`, detail: `Excipient assessment ${id}: ${title}`, after: { id, title, ...(a.scopeNote ? { scopeNote: a.scopeNote } : {}) } });
  return { project: next, assessmentId: id };
}

export type ExcipientAssessmentPatch = { title?: string; scopeNote?: string };

export function updateExcipientAssessment(project: Project, id: string, patch: ExcipientAssessmentPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, id);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of ["title", "scopeNote"] as const) {
    if (!(k in patch)) continue;
    const v = text(patch[k]);
    if (k === "title" && !v) throw new ExcipientError("The assessment needs a title");
    if (text(a[k]) === v) continue;
    before[k] = a[k] ?? "";
    after[k] = v;
    if (v) a[k] = v;
    else delete a[k];
  }
  if (!Object.keys(after).length) return project;
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_assessment_update", path: `excipient.${id}`, detail: `Excipient assessment ${id} edited`, before, after });
  return next;
}

/** Deletes an assessment with everything in it. A reason is needed and is kept, with the whole assessment, in the change log. */
export function deleteExcipientAssessment(project: Project, id: string, reason: string, actor: Actor): Project {
  const why = reasonOf(reason, `excipient assessment ${id}`);
  const a = excipientAssessmentOf(project, id);
  const next = structuredClone(project);
  next.excipients!.assessments = next.excipients!.assessments.filter((x) => x.id !== id);
  log(next, actor, { action: "excipient_assessment_remove", path: `excipient.${id}`, detail: `Excipient assessment ${id} removed: ${why}`, before: structuredClone(a), after: { reason: why } });
  return next;
}

// ------------------------------------------------------------------ lines

export interface ExcipientLineInput {
  name: string;
  /** A key of the class list. Never chosen for the person: a line can start without one. */
  classKey?: string;
  /** The person's own words for the role, when no listed class fits. */
  classLabel?: string;
}
export interface ExcipientClassCheck {
  /** The keys of content/excipient/classes.yaml. When given, a class key outside the list is refused. */
  classKeys?: readonly string[];
}

const blankLinks = (): ExcipientLinks => ({ gapIds: [], riskItems: [] });

export function addExcipientLine(project: Project, assessmentId: string, input: ExcipientLineInput, actor: Actor, check: ExcipientClassCheck = {}): { project: Project; lineId: string } {
  const name = text(input.name);
  if (!name) throw new ExcipientError("The excipient needs a name");
  if (input.classKey && text(input.classLabel)) throw new ExcipientError("Choose a class or write your own words, not both");
  if (input.classKey && check.classKeys && !check.classKeys.includes(input.classKey)) throw new ExcipientError(`${input.classKey} is not on the class list`);
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const id = nextId(next, "EXL", assessmentId, undefined, a.lines.map((l) => l.id));
  const line: ExcipientLine = { id, name, facts: {}, specs: [], links: blankLinks(), createdAt: actor.at, updatedAt: actor.at };
  if (input.classKey) line.classKey = input.classKey;
  else if (text(input.classLabel)) line.classLabel = text(input.classLabel);
  a.lines.push(line);
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_line_add", path: `excipient.${assessmentId}.${id}`, detail: `Excipient ${id} added to ${assessmentId}: ${name}`, after: { id, name, ...(line.classKey ? { classKey: line.classKey } : {}), ...(line.classLabel ? { classLabel: line.classLabel } : {}) } });
  return { project: next, lineId: id };
}

export interface ExcipientLinePatch {
  name?: string;
  /** A class key; `null` or "" clears it. Setting one clears the person's own words, and the other way round. */
  classKey?: string | null;
  classLabel?: string | null;
  gapIds?: string[];
  /** Draft risk items started from this excipient. */
  riskItems?: { assessmentId: string; itemId: string }[];
  /** The buffer or diluent material of a technical requirements document; `null` removes the link. */
  trdItem?: { trdId: string; stepKey: string; itemKey: string } | null;
  /** Where the regulatory affairs assessment is written. Empty clears it. The marker itself never depends on it. */
  regulatoryReference?: string;
}

export function updateExcipientLine(project: Project, assessmentId: string, lineId: string, patch: ExcipientLinePatch, actor: Actor, check: ExcipientClassCheck = {}): Project {
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const l = excipientLineOf(a, lineId);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const note = (k: string, was: unknown, now: unknown) => {
    before[k] = was ?? null;
    after[k] = now ?? null;
  };
  if ("name" in patch) {
    const v = text(patch.name);
    if (!v) throw new ExcipientError("The excipient needs a name");
    if (v !== l.name) {
      note("name", l.name, v);
      l.name = v;
    }
  }
  if ("classKey" in patch || "classLabel" in patch) {
    const key = text(patch.classKey ?? undefined) || undefined;
    const label = text(patch.classLabel ?? undefined) || undefined;
    if (key && label) throw new ExcipientError("Choose a class or write your own words, not both");
    if (key && check.classKeys && !check.classKeys.includes(key)) throw new ExcipientError(`${key} is not on the class list`);
    // Only the part the patch speaks about is replaced; saying one of them clears the other so the two can never both be held.
    if ("classKey" in patch && key !== l.classKey) {
      note("classKey", l.classKey, key);
      if (key && l.classLabel) {
        note("classLabel", l.classLabel, undefined);
        delete l.classLabel;
      }
      if (key) l.classKey = key;
      else delete l.classKey;
    }
    if ("classLabel" in patch && label !== l.classLabel) {
      note("classLabel", l.classLabel, label);
      if (label && l.classKey) {
        note("classKey", l.classKey, undefined);
        delete l.classKey;
      }
      if (label) l.classLabel = label;
      else delete l.classLabel;
    }
  }
  if ("gapIds" in patch) {
    const list = [...new Set((patch.gapIds ?? []).map(text).filter(Boolean))];
    if (stableStringify(list) !== stableStringify(l.links.gapIds)) {
      note("gapIds", l.links.gapIds, list);
      l.links.gapIds = list;
    }
  }
  if ("riskItems" in patch) {
    const seen = new Set<string>();
    const list = (patch.riskItems ?? []).filter((r) => {
      const k = `${r.assessmentId}/${r.itemId}`;
      if (!r.assessmentId || !r.itemId || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (stableStringify(list) !== stableStringify(l.links.riskItems)) {
      note("riskItems", l.links.riskItems, list);
      l.links.riskItems = list;
    }
  }
  if ("trdItem" in patch) {
    const v = patch.trdItem ?? undefined;
    if (stableStringify(v ?? null) !== stableStringify(l.links.trdItem ?? null)) {
      note("trdItem", l.links.trdItem, v);
      if (v) l.links.trdItem = { trdId: v.trdId, stepKey: v.stepKey, itemKey: v.itemKey };
      else delete l.links.trdItem;
    }
  }
  if ("regulatoryReference" in patch) {
    const v = text(patch.regulatoryReference);
    if (v !== text(l.links.regulatoryReference)) {
      note("regulatoryReference", l.links.regulatoryReference, v);
      if (v) l.links.regulatoryReference = v;
      else delete l.links.regulatoryReference;
    }
  }
  if (!Object.keys(after).length) return project;
  assertValid(a);
  l.updatedAt = actor.at;
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_line_update", path: `excipient.${assessmentId}.${lineId}`, detail: `Excipient ${lineId} (${l.name}) edited`, before, after });
  return next;
}

/** Deletes an excipient with its facts and comparison rows. A reason is needed and is kept, with the whole line, in the change log. */
export function deleteExcipientLine(project: Project, assessmentId: string, lineId: string, reason: string, actor: Actor): Project {
  const why = reasonOf(reason, `excipient ${lineId}`);
  const a0 = excipientAssessmentOf(project, assessmentId);
  const line = excipientLineOf(a0, lineId);
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  a.lines = a.lines.filter((l) => l.id !== lineId);
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_line_remove", path: `excipient.${assessmentId}.${lineId}`, detail: `Excipient ${lineId} (${line.name}) removed from ${assessmentId}: ${why}`, before: structuredClone(line), after: { reason: why } });
  return next;
}

// ------------------------------------------------------------------ facts

export type ExcipientFactAnswer =
  | { kind: "value"; value: EntryValue }
  /** The receiving site's fact is the sending site's fact, read live. Only for a fact that has two sides, and only on the receiving side. */
  | { kind: "same_as_sending" }
  | { kind: "not_applicable"; justification: string }
  /** To be decided. Every detail is optional and none is ever filled in for the person. */
  | { kind: "tbd"; bestGuess?: EntryValue; owner?: string; due?: string; note?: string };

export interface ExcipientFactOptions {
  /** Document references (source register ids) cited for this answer, with the place in each. Encouraged, never needed. */
  sourceIds?: string[];
  locations?: Record<string, SourceLocation>;
  /** Hides the buffer-step places when the program does not dilute with a buffer; the caller (the question list) decides. */
  allowedOptions?: readonly string[];
}

function isQuantityValue(v: unknown): v is { value: number; unit: string } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { value?: unknown }).value === "number" && typeof (v as { unit?: unknown }).unit === "string";
}

/** Checks a value against what the fact accepts and returns the form that is stored. A refusal says what to do, in plain words. */
export function normalizeExcipientValue(def: ExcipientFactDef, v: unknown, allowed?: readonly string[]): EntryValue {
  const options = allowed ?? def.options;
  switch (def.kind) {
    case "text":
    case "long_text": {
      if (typeof v !== "string" || !v.trim()) throw new ExcipientError("Type an answer, or choose Don't know yet.");
      return v.trim();
    }
    case "choice": {
      if (typeof v !== "string" || !options?.includes(v)) throw new ExcipientError("Choose one of the options.");
      return v;
    }
    case "multi_choice": {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "string" && options?.includes(x))) throw new ExcipientError("Choose at least one option, or choose Don't know yet.");
      // Kept in the order of the option list so the same ticks always read the same.
      return (options ?? []).filter((o) => (v as string[]).includes(o));
    }
    case "quantity": {
      if (!isQuantityValue(v) || !Number.isFinite(v.value)) throw new ExcipientError("Enter the amount as a number, for example 12.5.");
      if (!def.units?.includes(v.unit)) throw new ExcipientError(`Choose a unit from the list (${(def.units ?? []).join(", ")}).`);
      return { value: v.value, unit: v.unit };
    }
  }
}

/** What an entry says, in the form the change log keeps (so a TBD's best guess, owner and due date are all traceable). */
const snapshot = (e: Entry | undefined) =>
  e ? { status: e.status, value: e.value, sameAsSource: e.sameAsSource, ...(e.justification ? { justification: e.justification } : {}), ...(e.tbd ? { tbd: structuredClone(e.tbd) } : {}) } : undefined;

/**
 * Records one fact of one line. `side` is given for a fact with two sides and left out for a fact about the whole product.
 * The answer cites a "user_entry" source that says who answered and when, so a fact always has a source of its own (the project's rule
 * that a value is never anonymous); documents are cited on top, never instead. The same answer twice changes nothing.
 */
export function setExcipientFact(project: Project, assessmentId: string, lineId: string, key: string, side: ExcipientSide | undefined, answer: ExcipientFactAnswer, actor: Actor, opts: ExcipientFactOptions = {}): Project {
  const def = excipientFactDef(key);
  if (!def) throw new ExcipientError(`${key} is not a fact of an excipient`);
  if (def.perSide && !side) throw new ExcipientError(`${def.label} is asked for each site: say which site`);
  if (!def.perSide && side) throw new ExcipientError(`${def.label} is one answer for the whole product, not for one site`);
  if (side && !EXCIPIENT_SIDES.includes(side)) throw new ExcipientError(`Unknown site ${String(side)}`);
  if (answer.kind === "same_as_sending" && side !== "receiving") throw new ExcipientError("“Same as the sending site” is only available for the receiving site");
  if (answer.kind === "not_applicable" && !text(answer.justification)) throw new ExcipientError("Say why this is not applicable here.");
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const line = excipientLineOf(a, lineId);
  const path = excipientFactPath(assessmentId, lineId, key, side);
  const existing = line.facts[path];

  const entry: Entry = { id: existing?.id ?? newId("ent"), path, status: "established", sourceIds: [], recordedBy: actor.name, recordedAt: actor.at, revision: (existing?.revision ?? 0) + 1 };
  switch (answer.kind) {
    case "value":
      entry.value = normalizeExcipientValue(def, answer.value, opts.allowedOptions);
      break;
    case "same_as_sending":
      entry.sameAsSource = true;
      break;
    case "not_applicable":
      entry.status = "not_applicable";
      entry.justification = text(answer.justification);
      break;
    case "tbd": {
      entry.status = "tbd";
      const info: TbdInfo = {};
      if (answer.bestGuess !== undefined) info.bestGuess = normalizeExcipientValue(def, answer.bestGuess, opts.allowedOptions);
      if (text(answer.owner)) info.owner = text(answer.owner);
      if (text(answer.due)) {
        if (!isIsoDate(text(answer.due))) throw new ExcipientError("Enter the due date as year-month-day, for example 2026-11-30.");
        info.due = text(answer.due);
      }
      if (text(answer.note)) info.note = text(answer.note);
      entry.tbd = info;
      break;
    }
  }
  // Same answer again: nothing is written, nothing is logged, no source is made.
  const sameCitation = stableStringify([...(opts.sourceIds ?? [])].sort()) === stableStringify((existing?.sourceIds ?? []).filter((id) => next.sources.find((s) => s.id === id)?.type !== "user_entry").sort());
  if (existing && stableStringify(snapshot(existing)) === stableStringify(snapshot(entry)) && sameCitation) return project;

  for (const id of opts.sourceIds ?? []) if (!next.sources.some((s) => s.id === id)) throw new ExcipientError(`Source ${id} is not in the source register`);
  const source: Source = {
    id: newId("src"),
    type: "user_entry",
    label: `Excipient answer: ${line.name}, ${def.label}${side ? ` (${side} site)` : ""}`,
    responder: { name: actor.name, ...(actor.role ? { role: actor.role } : {}) },
    date: actor.at,
  };
  next.sources.push(source);
  // The earlier answer's source is superseded by this one, as in the interview; a document reference stays in the register.
  for (const id of existing?.sourceIds ?? []) {
    const s = next.sources.find((x) => x.id === id);
    if (s && s.type === "user_entry" && !s.supersededBy) s.supersededBy = source.id;
  }
  entry.sourceIds = [source.id, ...(opts.sourceIds ?? [])];
  if (opts.locations) {
    const kept = Object.fromEntries((opts.sourceIds ?? []).filter((id) => opts.locations![id]).map((id) => [id, opts.locations![id]!]));
    if (Object.keys(kept).length) entry.sourceLocations = kept;
  }
  // A verification stays on the entry; its fingerprint no longer matches a changed value, so it shows as withdrawn (the project's rule).
  if (existing?.verification) entry.verification = existing.verification;
  line.facts[path] = entry;
  line.updatedAt = actor.at;
  a.updatedAt = actor.at;
  assertValid(a);
  log(next, actor, { action: "excipient_fact_set", path, detail: `Excipient ${line.name}: ${def.label}${side ? ` (${side} site)` : ""}`, before: snapshot(existing), after: snapshot(entry) });
  return next;
}

// ------------------------------------------------------------------ specification comparison rows

export interface SpecSidePatch {
  /** "open": nothing entered. "stated": the criterion is written (given with `criterion`). "not_tested": the site's specification has no such test. */
  state?: "open" | "stated" | "not_tested";
  method?: string;
  criterion?: string;
  unit?: string;
  sourceIds?: string[];
  sourceLocations?: Record<string, SourceLocation>;
}

export function addSpecRow(project: Project, assessmentId: string, lineId: string, input: { test: string; promptKey?: string }, actor: Actor): { project: Project; rowId: string } {
  const test = text(input.test);
  if (!test) throw new ExcipientError("The test needs a name");
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const l = excipientLineOf(a, lineId);
  const id = nextId(next, "EXR", assessmentId, lineId, l.specs.map((r) => r.id));
  const open = (): ExcipientSpecSide => ({ state: "open", sourceIds: [] });
  const row: ExcipientSpecRow = { id, test, ...(input.promptKey ? { promptKey: input.promptKey } : {}), sending: open(), receiving: open() };
  l.specs.push(row);
  assertValid(a);
  l.updatedAt = actor.at;
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_spec_add", path: `excipient.${assessmentId}.${lineId}.spec.${id}`, detail: `Comparison row ${id} (${test}) added to ${lineId}`, after: { id, test, ...(row.promptKey ? { promptKey: row.promptKey } : {}) } });
  return { project: next, rowId: id };
}

function applySide(project: Project, side: ExcipientSpecSide, p: SpecSidePatch): void {
  for (const k of ["method", "unit"] as const) {
    if (!(k in p)) continue;
    const v = text(p[k]);
    if (v) side[k] = v;
    else delete side[k];
  }
  let state = p.state;
  if ("criterion" in p) {
    const v = text(p.criterion);
    if (v) {
      if (state && state !== "stated") throw new ExcipientError("A criterion is only kept when the test is stated");
      state = "stated";
      side.criterion = v;
    } else delete side.criterion;
  }
  if (state) side.state = state;
  // Whatever the state says, a criterion only belongs to a stated test; leaving a state removes the criterion and its unit.
  if (side.state !== "stated") {
    delete side.criterion;
    if (side.state === "not_tested") delete side.unit;
  }
  if (side.state === "stated" && !side.criterion) throw new ExcipientError("Type the acceptance criterion, or choose “Not in this specification” or “Open”.");
  if ("sourceIds" in p) {
    const ids = [...new Set(p.sourceIds ?? [])];
    for (const id of ids) if (!project.sources.some((s) => s.id === id)) throw new ExcipientError(`Source ${id} is not in the source register`);
    side.sourceIds = ids;
    if (side.sourceLocations) {
      for (const id of Object.keys(side.sourceLocations)) if (!ids.includes(id)) delete side.sourceLocations[id];
      if (!Object.keys(side.sourceLocations).length) delete side.sourceLocations;
    }
  }
  if ("sourceLocations" in p) {
    const kept = Object.fromEntries(Object.entries(p.sourceLocations ?? {}).filter(([id, loc]) => side.sourceIds.includes(id) && (text(loc.section) || text(loc.page))).map(([id, loc]) => [id, { ...(text(loc.section) ? { section: text(loc.section) } : {}), ...(text(loc.page) ? { page: text(loc.page) } : {}) }]));
    if (Object.keys(kept).length) side.sourceLocations = kept;
    else delete side.sourceLocations;
  }
}

export interface SpecRowPatch {
  test?: string;
  note?: string;
  sending?: SpecSidePatch;
  receiving?: SpecSidePatch;
}

export function updateSpecRow(project: Project, assessmentId: string, lineId: string, rowId: string, patch: SpecRowPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const l = excipientLineOf(a, lineId);
  const r = rowOf(l, rowId);
  const was = structuredClone(r);
  if ("test" in patch) {
    const v = text(patch.test);
    if (!v) throw new ExcipientError("The test needs a name");
    r.test = v;
  }
  if ("note" in patch) {
    const v = text(patch.note);
    if (v) r.note = v;
    else delete r.note;
  }
  if (patch.sending) applySide(next, r.sending, patch.sending);
  if (patch.receiving) applySide(next, r.receiving, patch.receiving);
  // Nothing changed (the same values typed again): nothing is logged.
  if (stableStringify(was) === stableStringify(r)) return project;
  assertValid(a);
  l.updatedAt = actor.at;
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_spec_update", path: `excipient.${assessmentId}.${lineId}.spec.${rowId}`, detail: `Comparison row ${rowId} (${r.test}) edited`, before: was, after: structuredClone(r) });
  return next;
}

/** Deletes one comparison row. A reason is needed and is kept, with the row, in the change log. */
export function deleteSpecRow(project: Project, assessmentId: string, lineId: string, rowId: string, reason: string, actor: Actor): Project {
  const why = reasonOf(reason, `comparison row ${rowId}`);
  const row = rowOf(excipientLineOf(excipientAssessmentOf(project, assessmentId), lineId), rowId);
  const next = structuredClone(project);
  const a = excipientAssessmentOf(next, assessmentId);
  const l = excipientLineOf(a, lineId);
  l.specs = l.specs.filter((r) => r.id !== rowId);
  l.updatedAt = actor.at;
  a.updatedAt = actor.at;
  log(next, actor, { action: "excipient_spec_remove", path: `excipient.${assessmentId}.${lineId}.spec.${rowId}`, detail: `Comparison row ${rowId} (${row.test}) removed from ${lineId}: ${why}`, before: structuredClone(row), after: { reason: why } });
  return next;
}
