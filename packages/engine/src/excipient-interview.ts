import { BUFFER_STEP_PLACES, excipientAssessments, resolveEntry, type Actor, type EntryValue, type ExcipientAssessment, type ExcipientLine, type ExcipientSide, type Project, type SourceLocation } from "@gap/process-model";
import { ExcipientError, excipientAssessmentOf, excipientLineOf, setExcipientFact, updateExcipientLine } from "./excipient";
import { applicableFacts, type ApplicableFact } from "./excipient-analysis";
import { excipientClassOf, type ExcipientClasses, type ExcipientLookAtTopic, type ExcipientWording } from "./excipient-content";
import { adaptText, projectStage, resolveStageMarkers, sourceValidated } from "./stage";

/*
 * The excipient interview: plain questions that fill the SAME excipient facts the forms fill. Nothing here is stored. The question
 * list is derived from the lines, the facts, the class list and the wording file every time it is asked for, so it can never disagree
 * with the assessment; an answer is written through the module's own edit functions (one change-log event each). No question has a
 * default, "Don't know yet" writes nothing, and nothing here blocks saving.
 */

export type ExcipientInput = "choice" | "multi_choice" | "text" | "long_text" | "quantity";
export type ExcipientQuestionState = "answered" | "open" | "tbd" | "not_applicable" | "same_as_sending";

export type ExcipientTarget = { kind: "class" } | { kind: "fact"; factKey: string; side?: ExcipientSide };

export interface ExcipientChoice {
  value: string;
  label: string;
}

export interface ExcipientQuestion {
  /** EXL-001/line:class or EXL-001/fact:<key>[.sending|.receiving]. Unique inside an assessment. */
  key: string;
  assessmentId: string;
  lineId: string;
  /** The group heading: the excipient's name. A line is a "step" for the interview map. */
  lineName: string;
  target: ExcipientTarget;
  prompt: string;
  why: string;
  hint?: string;
  glossary: string[];
  input: ExcipientInput;
  units: string[];
  choices: ExcipientChoice[];
  /** The class question also takes the person's own words when no listed class fits. */
  allowOwnWords: boolean;
  state: ExcipientQuestionState;
  /** What the record says now, in words. A not-known answer stays visible as such. */
  current?: string;
  reason?: string;
  canTbd: boolean;
  canNotApplicable: boolean;
  /** Only the receiving site's question of a fact that has two sides. */
  canSameAsSending: boolean;
  /** False: the sentence was generated from the label (no wording written yet). */
  wordingWritten: boolean;
}

export interface ExcipientInterviewOptions {
  wording: ExcipientWording;
  classes: ExcipientClasses;
}

const SITE_WORDS: Record<ExcipientSide, string> = { sending: "the sending site", receiving: "the receiving site" };
const TOPIC_OF: Record<string, ExcipientLookAtTopic> = { origin: "origin", nitrosamine: "nitrosamine", elemental: "elemental" };

const text = (v: string | undefined) => (v ?? "").trim();

function readable(v: EntryValue | undefined, label: (x: string) => string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return label(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? label(x) : String(x))).join(", ");
  if (typeof v === "object" && v !== null && "value" in v && "unit" in v) return `${(v as { value: number }).value} ${(v as { unit: string }).unit}`;
  return String(v);
}

/** The questions of one assessment, line by line: the class first, then the facts that apply, in the order of the fact list. */
export function deriveExcipientQuestions(project: Project, assessmentId: string, opts: ExcipientInterviewOptions): ExcipientQuestion[] {
  const a = excipientAssessments(project).find((x) => x.id === assessmentId);
  if (!a) return [];
  const staged = (s: string) => adaptText(resolveStageMarkers(s, projectStage(project)), sourceValidated(project));
  // The two places that only exist when the program dilutes or formulates with a buffer are offered only then (never chosen for the person).
  const dilutes = resolveEntry(project, "scope.dilution").value === "yes";
  const out: ExcipientQuestion[] = [];

  for (const line of a.lines) {
    out.push(classQuestion(a, line, opts, staged));
    for (const f of applicableFacts(project, a.id, line)) out.push(factQuestion(project, a, line, f, opts, staged, dilutes));
  }
  return out;
}

function classQuestion(a: ExcipientAssessment, line: ExcipientLine, opts: ExcipientInterviewOptions, staged: (s: string) => string): ExcipientQuestion {
  const w = opts.wording.questions["line:class"];
  const cls = excipientClassOf(opts.classes, line.classKey);
  const own = text(line.classLabel);
  const answered = Boolean(cls || own);
  return {
    key: `${line.id}/line:class`,
    assessmentId: a.id,
    lineId: line.id,
    lineName: line.name,
    target: { kind: "class" },
    prompt: staged(w?.prompt ?? "What does this excipient do in the product?"),
    why: staged(w?.why ?? "The role decides which comparison tests and topics are offered as prompts."),
    ...(w?.hint ? { hint: staged(w.hint) } : {}),
    glossary: w?.glossary ?? [],
    input: "choice",
    units: [],
    choices: opts.classes.classes.map((c) => ({ value: c.key, label: c.label })),
    allowOwnWords: true,
    state: answered ? "answered" : "open",
    ...(answered ? { current: cls ? cls.label : own } : {}),
    canTbd: false,
    canNotApplicable: false,
    canSameAsSending: false,
    wordingWritten: Boolean(w),
  };
}

function factQuestion(project: Project, a: ExcipientAssessment, line: ExcipientLine, f: ApplicableFact, opts: ExcipientInterviewOptions, staged: (s: string) => string, dilutes: boolean): ExcipientQuestion {
  const { def, side, path } = f;
  const w = opts.wording.questions[`fact:${def.key}`];
  const labelOf = (v: string) => w?.choices?.[v] ?? v;
  const r = resolveEntry(project, path);
  const held = line.facts[path];

  let choices: ExcipientChoice[] = (def.options ?? []).map((o) => ({ value: o, label: labelOf(o) }));
  if (def.key === "whereAdded" && !dilutes) {
    const keep = new Set(Array.isArray(held?.value) ? (held!.value as string[]) : []);
    choices = choices.filter((c) => !BUFFER_STEP_PLACES.includes(c.value) || keep.has(c.value));
  }

  let state: ExcipientQuestionState = "open";
  if (held) {
    if (held.status === "established") state = held.sameAsSource ? "same_as_sending" : "answered";
    else if (held.status === "tbd") state = "tbd";
    else if (held.status === "not_applicable") state = "not_applicable";
  }
  const siteText = (s: string) => (side ? s.replaceAll("{site}", SITE_WORDS[side]) : s);
  const generated = `What is the ${def.label.toLowerCase()}${side ? ` at ${SITE_WORDS[side]}` : ""}?`;
  const topic = TOPIC_OF[def.key];
  const cls = excipientClassOf(opts.classes, line.classKey);
  const look = topic ? cls?.teamsOftenLookAt[topic] : undefined;
  const hint = [w?.hint, look ? `Teams often look at: ${look}` : undefined].filter(Boolean).join(" ");

  const current = state === "same_as_sending" ? `Same as the sending site${r.status === "established" && r.value !== undefined ? ` (${readable(r.value, labelOf)})` : ""}` : state === "answered" ? readable(r.value, labelOf) : state === "tbd" ? "To be decided (TBD)" : state === "not_applicable" ? "Not applicable" : undefined;

  return {
    key: `${line.id}/fact:${def.key}${side ? `.${side}` : ""}`,
    assessmentId: a.id,
    lineId: line.id,
    lineName: line.name,
    target: { kind: "fact", factKey: def.key, ...(side ? { side } : {}) },
    prompt: staged(siteText(w?.prompt ?? generated)),
    why: staged(siteText(w?.why ?? `The ${def.label.toLowerCase()} is kept so the two sites can be compared.`)),
    ...(hint ? { hint: staged(siteText(hint)) } : {}),
    glossary: w?.glossary ?? [],
    input: def.kind,
    units: [...(def.units ?? [])],
    choices,
    allowOwnWords: false,
    state,
    ...(current !== undefined ? { current } : {}),
    ...(state === "not_applicable" && held?.justification ? { reason: held.justification } : {}),
    canTbd: true,
    canNotApplicable: true,
    canSameAsSending: side === "receiving",
    wordingWritten: Boolean(w),
  };
}

// ------------------------------------------------------------------ progress and filter

export interface ExcipientCounts {
  total: number;
  answered: number;
  open: number;
  tbd: number;
}
export interface ExcipientLineProgress extends ExcipientCounts {
  lineId: string;
  lineName: string;
}
export interface ExcipientInterviewProgress {
  overall: ExcipientCounts;
  lines: ExcipientLineProgress[];
}

/** "N of M answered, N left open". A "Not applicable here" answer and "Same as the sending site" count as answered; "To be decided" does not. */
export function excipientInterviewProgress(qs: readonly ExcipientQuestion[]): ExcipientInterviewProgress {
  const none = (): ExcipientCounts => ({ total: 0, answered: 0, open: 0, tbd: 0 });
  const lines = new Map<string, ExcipientLineProgress>();
  const overall = none();
  const count = (c: ExcipientCounts, q: ExcipientQuestion) => {
    c.total++;
    if (q.state === "answered" || q.state === "not_applicable" || q.state === "same_as_sending") c.answered++;
    else {
      c.open++;
      if (q.state === "tbd") c.tbd++;
    }
  };
  for (const q of qs) {
    let l = lines.get(q.lineId);
    if (!l) lines.set(q.lineId, (l = { lineId: q.lineId, lineName: q.lineName, ...none() }));
    count(l, q);
    count(overall, q);
  }
  return { overall, lines: [...lines.values()] };
}

/** "Everything" or "only what is open" (open and to-be-decided questions). */
export function filterExcipientQuestions(qs: readonly ExcipientQuestion[], which: "all" | "open"): ExcipientQuestion[] {
  return which === "all" ? [...qs] : qs.filter((q) => q.state === "open" || q.state === "tbd");
}

// ------------------------------------------------------------------ answers

export type ExcipientAnswer =
  /** A typed or chosen value: `value` for text and choice, `values` for a multi-choice, `amount` and `unit` for a quantity. */
  | { kind: "value"; value?: string; values?: string[]; amount?: number; unit?: string; sourceIds?: string[]; locations?: Record<string, SourceLocation> }
  /** The class question: a key of the class list, or the person's own words. */
  | { kind: "class"; classKey?: string; classLabel?: string }
  | { kind: "same_as_sending" }
  | { kind: "not_applicable"; reason: string }
  | { kind: "tbd"; owner?: string; due?: string; note?: string };

/**
 * Writes one answer through the module's own edit functions. "Don't know yet" is not an answer and has no function here: the page
 * simply moves on and nothing is written.
 */
export function answerExcipientQuestion(project: Project, q: ExcipientQuestion, answer: ExcipientAnswer, actor: Actor, opts: Pick<ExcipientInterviewOptions, "classes">): Project {
  excipientLineOf(excipientAssessmentOf(project, q.assessmentId), q.lineId);
  if (q.target.kind === "class") {
    if (answer.kind !== "class") throw new ExcipientError("Choose a class or write your own words.");
    const keys = opts.classes.classes.map((c) => c.key);
    const key = text(answer.classKey);
    const label = text(answer.classLabel);
    if (!key && !label) throw new ExcipientError("Choose a class or write your own words.");
    return updateExcipientLine(project, q.assessmentId, q.lineId, key ? { classKey: key, classLabel: null } : { classKey: null, classLabel: label }, actor, { classKeys: keys });
  }
  const { factKey, side } = q.target;
  switch (answer.kind) {
    case "value": {
      const kind = q.input;
      let value: EntryValue;
      if (kind === "multi_choice") value = answer.values ?? [];
      else if (kind === "quantity") value = { value: answer.amount as number, unit: answer.unit ?? "" };
      else value = answer.value ?? "";
      return setExcipientFact(project, q.assessmentId, q.lineId, factKey, side, { kind: "value", value }, actor, { ...(answer.sourceIds ? { sourceIds: answer.sourceIds } : {}), ...(answer.locations ? { locations: answer.locations } : {}) });
    }
    case "same_as_sending":
      return setExcipientFact(project, q.assessmentId, q.lineId, factKey, side, { kind: "same_as_sending" }, actor);
    case "not_applicable":
      return setExcipientFact(project, q.assessmentId, q.lineId, factKey, side, { kind: "not_applicable", justification: answer.reason }, actor);
    case "tbd":
      return setExcipientFact(project, q.assessmentId, q.lineId, factKey, side, { kind: "tbd", ...(answer.owner ? { owner: answer.owner } : {}), ...(answer.due ? { due: answer.due } : {}), ...(answer.note ? { note: answer.note } : {}) }, actor);
    case "class":
      throw new ExcipientError("This question is not about the class.");
  }
}

// ------------------------------------------------------------------ marker wording and prompts

/** The explanation under a change-risk marker, with the stage wording resolved for the project's stage. Empty when none is written. */
export function excipientMarkerExplanation(project: Project, wording: ExcipientWording, markerKey: string): string {
  const w = wording.markers[markerKey];
  return w ? adaptText(resolveStageMarkers(w.explanation, projectStage(project)), sourceValidated(project)) : "";
}

/** The "often compared" tests of the line's class that are not yet a row of its comparison table. A prompt list only: nothing is added until a person picks one. */
export function oftenComparedPrompts(line: ExcipientLine, classes: ExcipientClasses): { key: string; test: string }[] {
  const cls = excipientClassOf(classes, line.classKey);
  if (!cls) return [];
  const have = new Set(line.specs.map((r) => r.promptKey).filter(Boolean));
  return cls.oftenCompared.filter((t) => !have.has(t.key));
}
