import {
  clearEntries,
  compareQuantities,
  fullRef,
  getEntry,
  newId,
  putEntry,
  unitDef,
  type Actor,
  type DocRef,
  type Entry,
  type EntryValue,
  type Project,
  type Quantity,
  type Range,
  type Source,
  type TbdInfo,
} from "@gap/process-model";
import { fieldLabel, labelResolver, optionsFor, parameterFields, sameAsSourceAllowed, type ContentBundle } from "./content";
import type { ParameterField, Question } from "./content-schema";
import { instanceRefs, type QuestionInstance } from "./sequencer";
import { isQuantity, isRange } from "./values";

export type FieldAnswer =
  | { kind: "value"; value: EntryValue }
  | { kind: "same_as_source" }
  | { kind: "not_applicable"; justification: string }
  /**
   * To be determined. Every detail is optional and none is ever filled in for the user. The best guess has the same shape
   * as the question's value; it is checked like a value but is stored under `tbd`, never as the entry's value.
   */
  | { kind: "tbd"; bestGuess?: EntryValue; owner?: string; due?: string; note?: string };

export type AnswerInput = FieldAnswer | { kind: "composite"; fields: Partial<Record<ParameterField, FieldAnswer>> };

export class AnswerError extends Error {}

const PARAM_OPTION_SETS: Partial<Record<ParameterField, string>> = {
  classification: "classification",
  rangeBasis: "rangeBasis",
};

function checkQuantity(q: Question, v: unknown, what: string): Quantity {
  if (!isQuantity(v) || typeof v.value !== "number" || !Number.isFinite(v.value)) {
    throw new AnswerError(`${what}: enter a number`);
  }
  if (!q.input.units?.includes(v.unit) || !unitDef(v.unit)) throw new AnswerError(`${what}: unit "${v.unit}" is not allowed`);
  return { value: v.value, unit: v.unit };
}

function checkRange(q: Question, v: unknown, what: string): Range {
  if (!isRange(v)) throw new AnswerError(`${what}: enter at least one bound`);
  const out: Range = {};
  if (v.min) out.min = checkQuantity(q, v.min, `${what} minimum`);
  if (v.max) out.max = checkQuantity(q, v.max, `${what} maximum`);
  if (!out.min && !out.max) throw new AnswerError(`${what}: enter at least one bound`);
  if (out.min && out.max && compareQuantities(out.min, out.max) > 0) {
    throw new AnswerError(`${what}: minimum is greater than maximum`);
  }
  return out;
}

/** Validates and normalizes a value for a (non-parameter) question. */
export function normalizeValue(content: ContentBundle, q: Question, v: unknown): EntryValue {
  const t = q.input.type;
  if (t === "choice") {
    if (typeof v !== "string" || !optionsFor(content, q).some((o) => o.value === v)) throw new AnswerError("Choose one of the options");
    return v;
  }
  if (t === "multi_choice") {
    const opts = new Set(optionsFor(content, q).map((o) => o.value));
    if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "string" && opts.has(x))) {
      throw new AnswerError("Choose at least one option");
    }
    return [...new Set(v as string[])];
  }
  if (t === "yes_no") {
    if (v === "yes" || v === true) return true;
    if (v === "no" || v === false) return false;
    throw new AnswerError("Answer yes or no");
  }
  if (t === "text") {
    if (typeof v !== "string" || !v.trim()) throw new AnswerError("Enter text");
    return v.trim();
  }
  if (t === "quantity") return checkQuantity(q, v, "Value");
  if (t === "range") return checkRange(q, v, "Range");
  throw new AnswerError(`Parameter questions take a composite answer`);
}

function normalizeParamField(content: ContentBundle, q: Question, field: ParameterField, v: unknown): EntryValue {
  const set = PARAM_OPTION_SETS[field];
  if (set) {
    const opts = content.catalog.optionSets[set] ?? [];
    if (typeof v !== "string" || !opts.some((o) => o.value === v)) throw new AnswerError(`${field}: choose one of the options`);
    return v;
  }
  if (field === "setPoint") return checkQuantity(q, v, "Set point");
  return checkRange(q, v, field === "nor" ? "NOR" : field === "par" ? "PAR" : fieldLabel(content, "validatedRange"));
}

/** True for a real calendar date written YYYY-MM-DD (so "2026-02-31" is refused rather than silently shifted). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

type TbdAnswer = Extract<FieldAnswer, { kind: "tbd" }>;

/** Checks a TBD answer and returns the details to store. Empty text is dropped, not stored as an empty value. */
function tbdInfoOf(a: TbdAnswer, normalizeGuess: (v: unknown) => EntryValue): TbdInfo {
  const info: TbdInfo = {};
  if (a.bestGuess !== undefined) info.bestGuess = normalizeGuess(a.bestGuess);
  const owner = a.owner?.trim();
  if (owner) info.owner = owner;
  const due = a.due?.trim();
  if (due) {
    if (!isIsoDate(due)) throw new AnswerError("TBD due date: enter a real date");
    info.due = due;
  }
  const note = a.note?.trim();
  if (note) info.note = note;
  return info;
}

export interface AnswerOptions {
  /** Supporting documents cited for this answer (e.g., a PPQ report). Become document_reference sources. */
  docRefs?: DocRef[];
}

function sideLabel(side: QuestionInstance["side"]): string {
  return side === "shared" ? "scoping" : side === "source" ? "SU" : "RU";
}

/**
 * Records an answer. Every answer creates an interview_answer source carrying
 * the responder and date; every entry written cites that source. Values are
 * never inferred: fields not answered are rejected rather than defaulted.
 */
export function applyAnswer(
  project: Project,
  content: ContentBundle,
  inst: QuestionInstance,
  input: AnswerInput,
  actor: Actor,
  opts: AnswerOptions = {},
): Project {
  const q = inst.question;
  const side = inst.side;
  type Write = { path: string; ans: Exclude<FieldAnswer, { kind: "tbd" }> | { kind: "tbd"; info: TbdInfo } };
  const writes: Write[] = [];
  const normalizeAnswer = (a: FieldAnswer, norm: (v: unknown) => EntryValue): Write["ans"] =>
    a.kind === "value" ? { kind: "value", value: norm(a.value) } : a.kind === "tbd" ? { kind: "tbd", info: tbdInfoOf(a, norm) } : a;

  if (q.input.type === "parameter") {
    if (side === "shared") throw new AnswerError("Parameter questions are not shared");
    if (input.kind === "value") throw new AnswerError("Parameter questions take a composite answer");
    if (input.kind !== "composite") {
      // A whole-question answer (TBD / same as source / N/A) applies to every field.
      // One guess cannot fit every field of a parameter (set point, NOR, PAR...), so guesses are entered per field.
      if (input.kind === "tbd" && input.bestGuess !== undefined) throw new AnswerError("A best guess for a parameter is entered per field");
      for (const f of parameterFields(q, side)) writes.push({ path: `${q.binds}.${f}`, ans: normalizeAnswer(input, (v) => normalizeParamField(content, q, f, v)) });
    } else {
      for (const f of parameterFields(q, side)) {
        const a = input.fields[f];
        if (!a) throw new AnswerError(`Answer every field (missing: ${content.catalog.fieldLabels[f] ?? f}), or mark it TBD`);
        writes.push({ path: `${q.binds}.${f}`, ans: normalizeAnswer(a, (v) => normalizeParamField(content, q, f, v)) });
      }
    }
  } else {
    if (input.kind === "composite") throw new AnswerError("Composite answers are only for parameter questions");
    writes.push({ path: q.binds, ans: normalizeAnswer(input, (v) => normalizeValue(content, q, v)) });
  }

  for (const w of writes) {
    if (w.ans.kind === "same_as_source" && (side !== "target" || !sameAsSourceAllowed(q))) {
      throw new AnswerError("“Same as SU” is only available on RU-side paired questions");
    }
    if (w.ans.kind === "not_applicable" && !w.ans.justification.trim()) {
      throw new AnswerError("Not applicable requires a justification");
    }
  }

  const next = structuredClone(project);
  const labels = labelResolver(content);
  const source: Source = {
    id: newId("src"),
    type: "interview_answer",
    label: `Interview answer: ${q.prompt} [${sideLabel(side)}]`,
    responder: { name: actor.name, ...(actor.role ? { role: actor.role } : {}) },
    date: actor.at,
  };
  next.sources.push(source);

  const docSourceIds: string[] = [];
  for (const d of opts.docRefs ?? []) {
    let ds = next.sources.find((s) => s.type === "document_reference" && s.docRef?.identifier === d.identifier);
    if (!ds) {
      ds = { id: newId("src"), type: "document_reference", label: d.title ? `${d.identifier} ${d.title}` : d.identifier, responder: { name: actor.name, ...(actor.role ? { role: actor.role } : {}) }, date: actor.at, docRef: d };
      next.sources.push(ds);
      next.changeLog.push({ at: actor.at, by: actor.name, action: "add_source", detail: `${ds.type}: ${ds.label}`, after: structuredClone(ds) });
    }
    if (!docSourceIds.includes(ds.id)) docSourceIds.push(ds.id);
  }

  const prev = next.answers.filter((a) => a.questionId === q.id && a.side === side);
  for (const a of prev) {
    const s = next.sources.find((x) => x.id === a.sourceId);
    if (s && !s.supersededBy) s.supersededBy = source.id;
  }

  for (const w of writes) {
    const ref = fullRef(side, w.path);
    const existing = getEntry(next, ref);
    const entry: Entry = {
      id: existing?.id ?? newId("ent"),
      path: ref,
      status: "established",
      sourceIds: [source.id],
      recordedBy: actor.name,
      recordedAt: actor.at,
      revision: (existing?.revision ?? 0) + 1,
    };
    if (existing?.verification) entry.verification = existing.verification;
    switch (w.ans.kind) {
      case "value":
        entry.value = w.ans.value;
        entry.sourceIds.push(...docSourceIds);
        // A document that stays cited keeps the place in it that was recorded; re-saving a value must not lose that.
        if (existing?.sourceLocations) {
          const kept = Object.fromEntries(docSourceIds.filter((id) => existing.sourceLocations![id]).map((id) => [id, existing.sourceLocations![id]!]));
          if (Object.keys(kept).length) entry.sourceLocations = kept;
        }
        break;
      case "same_as_source":
        entry.sameAsSource = true;
        break;
      case "not_applicable":
        entry.status = "not_applicable";
        entry.justification = w.ans.justification.trim();
        break;
      case "tbd":
        entry.status = "tbd";
        // w.ans.info was checked when the answer was normalised.
        entry.tbd = w.ans.info;
        break;
    }
    putEntry(next, entry, labels);
    next.changeLog.push({
      at: actor.at,
      by: actor.name,
      action: "answer",
      path: ref,
      // Everything recorded about a TBD (best guess, owner, due date, note) is in the log, so every TBD change is traceable.
      before: existing
        ? { status: existing.status, value: existing.value, sameAsSource: existing.sameAsSource, ...(existing.justification ? { justification: existing.justification } : {}), ...(existing.tbd ? { tbd: structuredClone(existing.tbd) } : {}) }
        : undefined,
      after: { status: entry.status, value: entry.value, sameAsSource: entry.sameAsSource, ...(entry.justification ? { justification: entry.justification } : {}), ...(entry.tbd ? { tbd: structuredClone(entry.tbd) } : {}) },
    });
  }

  next.answers.push({
    id: newId("ans"),
    questionId: q.id,
    side,
    kind: input.kind,
    raw: input,
    sourceId: source.id,
    by: actor.name,
    at: actor.at,
  });
  return next;
}

/** Switches the order questions are asked in. Logged when an actor is given. */
export function setEntrySequence(project: Project, mode: "paired" | "sequential", actor?: Actor): Project {
  const next: Project = { ...project, settings: { ...project.settings, entrySequence: mode } };
  if (actor && mode !== project.settings.entrySequence) {
    next.changeLog = [...project.changeLog, { at: actor.at, by: actor.name, action: "set_entry_sequence", before: project.settings.entrySequence, after: mode }];
  }
  return next;
}

/** Sets who is answering. Logged when `at` is given (the new responder is recorded as the actor). */
export function setResponder(project: Project, responder: { name: string; role?: string }, at?: string): Project {
  if (!responder.name.trim()) throw new AnswerError("Responder name is required");
  const next: Project = { ...project, interview: { ...project.interview, responder } };
  if (at) {
    next.changeLog = [
      ...project.changeLog,
      { at, by: responder.name, action: "set_responder", before: project.interview.responder ? { ...project.interview.responder } : undefined, after: { ...responder } },
    ];
  }
  return next;
}

export function confirmSection(project: Project, sectionId: string, side: "source" | "target" | "shared" | "both", actor: Actor): Project {
  const next = structuredClone(project);
  const prior = next.interview.confirmations.find((c) => c.sectionId === sectionId && c.side === side);
  next.interview.confirmations = next.interview.confirmations.filter((c) => !(c.sectionId === sectionId && c.side === side));
  next.interview.confirmations.push({ sectionId, side, by: actor.name, at: actor.at });
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "confirm_section",
    detail: `${sectionId} (${side})`,
    ...(prior ? { before: { sectionId, side, by: prior.by, at: prior.at } } : {}),
    after: { sectionId, side },
  });
  return next;
}

// ------------------------------------------------------------------ clearing answers

/** Entry references behind some instances that hold something (a value, TBD, not applicable, same as source). */
export function clearableRefs(project: Project, insts: QuestionInstance[]): string[] {
  const refs = [...new Set(insts.flatMap(instanceRefs))];
  return refs.filter((r) => {
    const e = getEntry(project, r);
    return !!e && e.status !== "not_established";
  });
}

/**
 * Clears the answers of the given instances (one side, both sides, or a whole section's list). Pass only visible
 * instances: a question hidden by scoping is not in that list, so its recorded values are left exactly as the hide
 * logic keeps them. Clearing a scoping answer therefore never deletes the values of the questions it hides.
 * Returns how many entries were cleared; clearing what is already empty changes nothing and logs nothing.
 */
export function clearInstances(project: Project, insts: QuestionInstance[], actor: Actor): { project: Project; cleared: number } {
  const res = clearEntries(project, clearableRefs(project, insts), actor);
  return { project: res.project, cleared: res.cleared.length };
}
