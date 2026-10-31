import {
  getEntry,
  type Actor,
  type Entry,
  type Project,
  type SavedAnswer,
  type SavedAnswerInput,
  type SavedAnswerSet,
  type SavedSetRef,
  SAVED_SET_FORMAT,
  SAVED_SET_FORMAT_VERSION,
} from "@gap/process-model";
import { fieldLabel, parameterFields, type ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { formatQuestionSide, formatValue, questionLabel } from "./format";
import { applyAnswer, AnswerError, normalizeParamField, normalizeValue, type AnswerInput } from "./interview";
import { instanceRefs, visibleInstances, type QuestionInstance } from "./sequencer";
import { valuesEqual } from "./values";

/*
 * Saved answer sets (see process-model/saved-answers.ts for what a set holds and why). This file turns a project's answers into a set,
 * builds the REVIEW LIST for applying a set to another project, and applies the ticked rows through the same applyAnswer the interview
 * uses, so every rule of a typed answer (allowed options, units, justification) holds for an applied one too. Nothing here decides an
 * answer: a set only repeats what an author once recorded, and only after the author has ticked it.
 */

export type SetSides = "source" | "target" | "both";

export interface SaveSkips {
  /** Answers left out because they are TBD. TBD stays TBD in the project that owns it. */
  tbd: number;
  /** Answers left out because they say "same as SU", which would point at a different answer in another project. */
  sameAsSource: number;
}

const savedRef = (set: { name: string; savedAt: string }): SavedSetRef => ({ name: set.name, savedAt: set.savedAt });

/** "2026-10-31" from an ISO timestamp, as shown in the notes and lists. */
export const savedDay = (savedAt: string): string => savedAt.slice(0, 10);

/** What one question holds right now, as a saveable input: undefined when it is open, "tbd" or "same" when it must not be saved. */
function readInput(project: Project, inst: QuestionInstance): SavedAnswerInput | undefined | "tbd" | "same" {
  const side = inst.side as "source" | "target";
  const q = inst.question;
  const one = (e: Entry | undefined): { kind: "value"; value: NonNullable<Entry["value"]> } | { kind: "not_applicable"; justification: string } | undefined | "tbd" | "same" => {
    if (!e || e.status === "not_established") return undefined;
    if (e.status === "tbd") return "tbd";
    if (e.sameAsSource) return "same";
    if (e.status === "not_applicable") return e.justification?.trim() ? { kind: "not_applicable", justification: e.justification.trim() } : undefined;
    return e.value === undefined ? undefined : { kind: "value", value: e.value };
  };
  if (q.input.type !== "parameter") return one(getEntry(project, instanceRefs(inst)[0]!)) as SavedAnswerInput | undefined | "tbd" | "same";
  const fields: Record<string, NonNullable<ReturnType<typeof one>> & object> = {};
  let tbd = false;
  let same = false;
  let open = false;
  for (const f of parameterFields(q, side)) {
    const r = one(getEntry(project, `${side}.${q.binds}.${f}`));
    if (r === "tbd") tbd = true;
    else if (r === "same") same = true;
    else if (!r) open = true;
    else fields[f] = r;
  }
  // A parameter is saved only when every field is a statement. One TBD field would otherwise travel as a half answer.
  if (tbd) return "tbd";
  if (same) return "same";
  if (open) return undefined;
  return { kind: "composite", fields };
}

/**
 * Builds a set from the answers of the open project. Only questions the project asks (visible) and has answered are saved, for the
 * chosen unit(s). TBD and "same as SU" answers are counted in `skipped` so the author can see what was left out.
 */
export function buildSavedSet(
  content: ContentBundle,
  project: Project,
  opts: { name: string; sides: SetSides; savedAt: string; id: string },
): { set: SavedAnswerSet; skipped: SaveSkips } {
  const name = opts.name.trim();
  if (!name) throw new AnswerError("Give the set a name.");
  const skipped: SaveSkips = { tbd: 0, sameAsSource: 0 };
  const answers: SavedAnswer[] = [];
  for (const inst of visibleInstances(content, project, "paired")) {
    if (inst.side === "shared") continue;
    if (opts.sides !== "both" && inst.side !== opts.sides) continue;
    const r = readInput(project, inst);
    if (r === "tbd") skipped.tbd++;
    else if (r === "same") skipped.sameAsSource++;
    else if (r) answers.push({ questionId: inst.question.id, side: inst.side, input: r });
  }
  return {
    set: { format: SAVED_SET_FORMAT, formatVersion: SAVED_SET_FORMAT_VERSION, id: opts.id, name, savedAt: opts.savedAt, sourceProject: project.meta.title, sides: opts.sides, answers },
    skipped,
  };
}

// ------------------------------------------------------------------ the review list

export interface ReviewRow {
  /** "questionId@side", the same key the interview uses. */
  key: string;
  answer: SavedAnswer;
  /** Question wording in THIS catalog; the id when the catalog no longer has the question. */
  label: string;
  sectionTitle?: string;
  /** The saved answer in words. */
  savedText: string;
  /**
   * ready = can be applied; not_asked = this project does not ask the question (out of scope or condition not met, or no longer in
   * the catalog); cannot = asked, but the saved answer no longer fits (an option or unit that this catalog does not have).
   */
  state: "ready" | "not_asked" | "cannot";
  problem?: string;
  /** What this project already holds for the question. "different" and "tbd" mean applying would overwrite something visible. */
  existing: "none" | "same" | "different" | "tbd";
  existingText?: string;
  inst?: QuestionInstance;
}

/** The saved answer in words, using this catalog's labels. */
function savedAnswerText(content: ContentBundle, q: Question | undefined, a: SavedAnswer): string {
  const field = (x: { kind: "value"; value: never } | { kind: "not_applicable"; justification: string } | Record<string, unknown>, optionSet?: string): string =>
    (x as { kind: string }).kind === "not_applicable" ? `Not applicable: ${(x as { justification: string }).justification}` : formatValue(content, q, (x as { value: never }).value, optionSet);
  const i = a.input;
  if (i.kind !== "composite") return field(i);
  return Object.entries(i.fields)
    .map(([f, v]) => `${fieldLabel(content, f)} ${field(v, f === "classification" || f === "rangeBasis" ? f : undefined)}`)
    .join("; ");
}

/** Checks the saved answer against THIS catalog without writing anything. Returns the first problem in plain words. */
function problemWith(content: ContentBundle, inst: QuestionInstance, a: SavedAnswer): string | undefined {
  const q = inst.question;
  const side = a.side;
  try {
    const i = a.input;
    if (q.input.type === "parameter") {
      if (i.kind !== "composite") return "This question now takes a separate answer for each field.";
      const want = parameterFields(q, side);
      const have = Object.keys(i.fields);
      if (want.some((f) => !i.fields[f]) || have.some((f) => !(want as string[]).includes(f))) return "The fields of this question have changed since the set was saved.";
      for (const f of want) {
        const x = i.fields[f]!;
        if (x.kind === "value") normalizeParamField(content, q, f, x.value);
      }
      return undefined;
    }
    if (i.kind === "composite") return "This question no longer takes a separate answer for each field.";
    if (i.kind === "value") normalizeValue(content, q, i.value);
    return undefined;
  } catch (e) {
    return e instanceof AnswerError ? e.message : "The saved answer does not fit this question.";
  }
}

/** The target project's current answer for one asked question, compared with the saved one. */
function existingOf(content: ContentBundle, project: Project, inst: QuestionInstance, a: SavedAnswer): Pick<ReviewRow, "existing" | "existingText"> {
  const side = inst.side as "source" | "target";
  const q = inst.question;
  const entries = instanceRefs(inst).map((r) => getEntry(project, r));
  if (entries.every((e) => !e || e.status === "not_established")) return { existing: "none" };
  const existingText = formatQuestionSide(content, project, q, side);
  if (entries.some((e) => e?.status === "tbd")) return { existing: "tbd", existingText };
  const same = (() => {
    const i = a.input;
    if (i.kind === "composite") {
      return parameterFields(q, side).every((f) => {
        const e = getEntry(project, `${side}.${q.binds}.${f}`);
        const x = i.fields[f];
        return !!e && !!x && sameOne(e, x);
      });
    }
    const e = entries[0];
    return !!e && sameOne(e, i);
  })();
  return { existing: same ? "same" : "different", existingText };
}

function sameOne(e: Entry, x: { kind: "value"; value: unknown } | { kind: "not_applicable"; justification: string }): boolean {
  if (e.sameAsSource) return false;
  if (x.kind === "not_applicable") return e.status === "not_applicable" && (e.justification ?? "").trim() === x.justification.trim();
  return e.status === "established" && valuesEqual(e.value, x.value as never);
}

/**
 * The review list for applying a set to a project: one row per saved answer, in the order the interview asks them, then the answers
 * for questions this project does not ask. Computed from the project as it is now; applying one row can open follow-up questions,
 * which a second Apply of the same set then offers (nothing is applied that was not shown).
 */
export function reviewSavedSet(content: ContentBundle, project: Project, set: Pick<SavedAnswerSet, "answers">): ReviewRow[] {
  const asked = new Map(visibleInstances(content, project, "paired").map((i) => [i.key, i]));
  const order = [...asked.keys()];
  const seen = new Set<string>();
  const rows: ReviewRow[] = [];
  for (const a of set.answers) {
    const key = `${a.questionId}@${a.side}`;
    if (seen.has(key)) continue; // a damaged file could repeat a question; the first one counts
    seen.add(key);
    const inst = asked.get(key);
    const q = content.questionById.get(a.questionId);
    const base = { key, answer: a, label: q ? questionLabel(q) : a.questionId, savedText: savedAnswerText(content, q, a) };
    if (!inst) {
      rows.push({ ...base, state: "not_asked", existing: "none" });
      continue;
    }
    const problem = problemWith(content, inst, a);
    rows.push({ ...base, sectionTitle: inst.section.title, inst, state: problem ? "cannot" : "ready", ...(problem ? { problem } : {}), ...existingOf(content, project, inst, a) });
  }
  const asc = (r: ReviewRow) => (r.inst ? order.indexOf(r.key) : Number.MAX_SAFE_INTEGER);
  return rows.map((r, i) => [r, i] as const).sort((x, y) => asc(x[0]) - asc(y[0]) || x[1] - y[1]).map((x) => x[0]);
}

// ------------------------------------------------------------------ applying

export interface ApplyResult {
  project: Project;
  applied: number;
  /** Rows that were ticked but could not be written; the project is unchanged for them. */
  failed: { key: string; message: string }[];
}

/**
 * Applies the ticked rows. Each goes through applyAnswer (same checks, new interview-answer source, change-log record), and is then
 * marked with where it came from: on the answer record (shown on the question), in the source's label and in the change-log record's
 * detail. Rows that are not ready are never applied, ticked or not.
 */
export function applySavedSet(project: Project, content: ContentBundle, set: Pick<SavedAnswerSet, "name" | "savedAt" | "answers">, ticked: ReadonlySet<string>, actor: Actor): ApplyResult {
  const ref = savedRef(set);
  const note = `From saved answers: ${ref.name}, ${savedDay(ref.savedAt)}`;
  let cur = project;
  let applied = 0;
  const failed: ApplyResult["failed"] = [];
  for (const row of reviewSavedSet(content, project, set)) {
    if (row.state !== "ready" || !row.inst || !ticked.has(row.key)) continue;
    const logBefore = cur.changeLog.length;
    try {
      cur = applyAnswer(cur, content, row.inst, row.answer.input as AnswerInput, actor);
    } catch (e) {
      failed.push({ key: row.key, message: (e as Error).message });
      continue;
    }
    const rec = cur.answers[cur.answers.length - 1]!;
    rec.fromSavedSet = ref;
    const src = cur.sources.find((s) => s.id === rec.sourceId);
    if (src) src.label = `${src.label} (from saved answers: ${ref.name}, ${savedDay(ref.savedAt)})`;
    for (const ev of cur.changeLog.slice(logBefore)) ev.detail = note;
    applied++;
  }
  if (applied) cur.changeLog.push({ at: actor.at, by: actor.name, action: "apply_saved_answers", detail: `${ref.name}, saved ${savedDay(ref.savedAt)}: ${applied} ${applied === 1 ? "answer" : "answers"} applied` });
  return { project: cur, applied, failed };
}

/**
 * Where the answer on a question came from, when it was applied from a saved set and has not been changed since. Typing a new answer
 * writes a new record without a set, so the note leaves by itself; clearing the answer empties the entries, which also removes it.
 * The older record stays in the project and the change log keeps the history.
 */
export function savedSetOf(project: Project, inst: QuestionInstance): SavedSetRef | undefined {
  if (inst.side === "shared") return undefined;
  let rec;
  for (let i = project.answers.length - 1; i >= 0; i--) {
    const a = project.answers[i]!;
    if (a.questionId === inst.question.id && a.side === inst.side) {
      rec = a;
      break;
    }
  }
  if (!rec?.fromSavedSet) return undefined;
  const live = instanceRefs(inst).every((r) => {
    const e = getEntry(project, r);
    return !!e && e.status !== "not_established" && e.sourceIds.includes(rec.sourceId);
  });
  return live ? rec.fromSavedSet : undefined;
}
