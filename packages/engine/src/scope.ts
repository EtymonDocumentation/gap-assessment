import { allEntries, fullRef, resolveEntry, type Actor, type Project } from "@gap/process-model";
import { evaluate } from "./conditions";
import { boundPaths, type ContentBundle } from "./content";
import type { Condition, Question } from "./content-schema";
import { formatQuestionSide } from "./format";
import { uoAnswerApplicable } from "./sequencer";

/**
 * Scope of the process steps (unit operations). The Scope step lets the project leave whole unit operations out of the
 * assessment, on both sides, before the interview. GMP reasoning: leaving a process step out is a scope decision that a
 * reviewer must be able to see and challenge, so every change is change-logged (who, when, optional reason) and the document's
 * Scope section lists what was left out. Nothing is deleted: values already recorded for a left-out step stay in the project
 * as inactive entries (like values of removed custom items and of switched-off topics) and come back when the step is ticked
 * again. The default is that every step is in scope, the most conservative choice.
 */

export class ScopeError extends Error {}

// Not imported from sequencer.ts (it would be a second copy of the same rule): sides a question is asked on.
const sidesOf = (q: Question): ("shared" | "source" | "target")[] => (q.sides === "shared" ? ["shared"] : q.sides === "paired" ? ["source", "target"] : [q.sides]);

export function isStepExcluded(project: Project, uo: string): boolean {
  return (project.stepScope?.excluded ?? []).some((e) => e.uo === uo);
}

const labelOf = (content: ContentBundle, uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.label ?? uo;

/** Recorded values (any status except not established) that belong to a unit operation, on both sides. */
export function stepEntryCount(content: ContentBundle, project: Project, uo: string): number {
  const refs = new Set<string>();
  const sectionIds = new Set(content.sections.filter((s) => s.kind === "uo" && s.uo === uo).map((s) => s.id));
  for (const q of content.questions) {
    if (!sectionIds.has(q.section)) continue;
    for (const side of sidesOf(q)) for (const p of boundPaths(q, side)) refs.add(fullRef(side, p));
  }
  let n = 0;
  for (const e of allEntries(project)) {
    if (e.status === "not_established") continue;
    if (refs.has(e.path)) n++;
  }
  return n;
}

export interface NotApplicable {
  /** Ready to show, e.g. "Not applicable: Dosage form is Liquid". */
  text: string;
  /** The interview question to change the answer, as an interview link key (`questionId@side`), when one can be named. */
  questionKey?: string;
}

function conditionRefs(c: Condition, out: string[]): void {
  if ("all" in c) c.all.forEach((x) => conditionRefs(x, out));
  else if ("any" in c) c.any.forEach((x) => conditionRefs(x, out));
  else if ("not" in c) conditionRefs(c.not, out);
  else if ("eq" in c) out.push(c.eq[0]);
  else if ("in" in c) out.push(c.in[0]);
  else if ("includes" in c) out.push(c.includes[0]);
  else if ("answered" in c) out.push(c.answered);
  else if ("isTbd" in c) out.push(c.isTbd);
  else if ("isTrue" in c) out.push(c.isTrue);
}

interface Blocker {
  q: Question;
  side: "shared" | "source";
  /** False when the answer is missing or still TBD: the scope cannot be read from it yet. */
  decided: boolean;
}

/**
 * The scoping question that keeps a unit operation out of the interview right now, or undefined when the step applies. When
 * the catalog condition reads several answers, one that is still unanswered is named first: the step may well apply once
 * that is answered, so it must not be called "not applicable".
 */
function blocker(content: ContentBundle, project: Project, uo: string): Blocker | undefined {
  if (uoAnswerApplicable(content, project, uo)) return undefined;
  const def = content.catalog.unitOperations.find((u) => u.key === uo);
  const failedApplicable = def?.applicableWhen && !evaluate(def.applicableWhen, { project, side: "shared" });
  const cond = failedApplicable ? def!.applicableWhen : def?.hiddenWhen;
  const refs: string[] = [];
  if (cond) conditionRefs(cond, refs);
  const found = refs
    .map((ref) => content.questions.find((x) => x.binds === ref && !x.parent))
    .filter((q): q is Question => !!q)
    .map((q): Blocker => {
      const side = q.sides === "shared" ? "shared" : "source";
      const status = resolveEntry(project, side === "shared" ? q.binds : `source.${q.binds}`).status;
      return { q, side, decided: status !== "not_established" && status !== "tbd" };
    });
  return found.find((f) => !f.decided) ?? found[0];
}

/**
 * Why the answers put a unit operation out of scope, or undefined when they do not (or when they cannot say yet: see
 * dependsOnReason). The reason is read from the catalog condition: the question that the condition reads is named with the
 * answer given, so a user can see which answer to revisit. An unanswered question is never read as "not applicable":
 * that would be an invented default.
 */
export function notApplicableReason(content: ContentBundle, project: Project, uo: string): NotApplicable | undefined {
  const b = blocker(content, project, uo);
  if (!b) return undefined;
  if (!b.decided) return undefined;
  const label = b.q.label ?? b.q.prompt;
  const answer = formatQuestionSide(content, project, b.q, b.side);
  // A site answer that left the step out on both sides is the same on SU and RU.
  return { text: `Not applicable: ${label} is ${answer}${b.side === "source" ? " (SU and RU)" : ""}`, questionKey: `${b.q.id}@${b.side}` };
}

/**
 * The unanswered scoping question a unit operation waits for, or undefined. The step stays in scope (nothing is decided for
 * the user); it only appears in the interview once the question is answered.
 */
export function dependsOnReason(content: ContentBundle, project: Project, uo: string): NotApplicable | undefined {
  const b = blocker(content, project, uo);
  if (!b || b.decided) return undefined;
  return { text: `Depends on an unanswered question: ${b.q.label ?? b.q.prompt}`, questionKey: `${b.q.id}@${b.side}` };
}

export type StepState = "included" | "excluded" | "not_applicable";

export interface StepInfo {
  uo: string;
  label: string;
  description: string;
  state: StepState;
  notApplicable?: NotApplicable;
  /** Set on a step that is in scope but waits for an unanswered scoping question. */
  dependsOn?: NotApplicable;
  /** Set when state is "excluded". */
  exclusion?: { reason?: string; by: string; at: string };
  /** Recorded values on both sides. For a left-out step these are the values kept as inactive. */
  answerCount: number;
}

export interface StepGroupInfo {
  key: string;
  label: string;
  description: string;
  steps: StepInfo[];
}

/** The stage groups of the catalog with the state of every unit operation, in process order. */
export function stepGroups(content: ContentBundle, project: Project): StepGroupInfo[] {
  const seq = (uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.sequence ?? 999;
  return content.catalog.stageGroups.map((g) => ({
    key: g.key,
    label: g.label,
    description: g.description,
    steps: [...g.unitOperations]
      .sort((a, b) => seq(a) - seq(b))
      .map((uo): StepInfo => {
        const def = content.catalog.unitOperations.find((u) => u.key === uo)!;
        const ex = (project.stepScope?.excluded ?? []).find((e) => e.uo === uo);
        const na = notApplicableReason(content, project, uo);
        const base = { uo, label: def.label, description: def.description, answerCount: stepEntryCount(content, project, uo) };
        // A step the user left out stays tickable even when the answers also put it out: it is shown as left out so the
        // choice is visible and can be undone; the answers decide again once it is ticked.
        if (ex) return { ...base, state: "excluded", exclusion: { ...(ex.reason ? { reason: ex.reason } : {}), by: ex.by, at: ex.at } };
        if (na) return { ...base, state: "not_applicable", notApplicable: na };
        const dep = dependsOnReason(content, project, uo);
        return { ...base, state: "included", ...(dep ? { dependsOn: dep } : {}) };
      }),
  }));
}

export interface ScopeSummary {
  /** Steps in scope now. */
  included: number;
  /** Steps the user can choose between: all except those the answers put out of scope. */
  selectable: number;
  /** Steps the answers put out of scope. */
  notApplicable: number;
}

export function stepSummary(content: ContentBundle, project: Project): ScopeSummary {
  const all = stepGroups(content, project).flatMap((g) => g.steps);
  return {
    included: all.filter((s) => s.state === "included").length,
    selectable: all.filter((s) => s.state !== "not_applicable").length,
    notApplicable: all.filter((s) => s.state === "not_applicable").length,
  };
}

function logged(project: Project, actor: Actor, action: string, uo: string, detail: string, extra: { before?: unknown; after?: unknown }): void {
  project.changeLog.push({ at: actor.at, by: actor.name, action, path: `uo.${uo}`, detail, ...extra });
}

/** Leaves a process step out of the assessment (both sides). The reason is optional; recorded values are kept as inactive entries. */
export function excludeStep(content: ContentBundle, project: Project, uo: string, reason: string | undefined, actor: Actor): Project {
  if (!content.catalog.unitOperations.some((u) => u.key === uo)) throw new ScopeError(`Unknown process step "${uo}".`);
  if (isStepExcluded(project, uo)) throw new ScopeError(`${labelOf(content, uo)} is already left out.`);
  const text = (reason ?? "").trim().replace(/\s+/g, " ");
  const kept = stepEntryCount(content, project, uo);
  const next = structuredClone(project);
  next.stepScope ??= { excluded: [] };
  const record = { uo, ...(text ? { reason: text } : {}), by: actor.name, at: actor.at };
  next.stepScope.excluded.push(record);
  logged(next, actor, "scope_exclude_uo", uo, `Left out the process step “${labelOf(content, uo)}”: ${text || "No reason recorded"}; ${kept} recorded value(s) kept as inactive`, { after: record });
  return next;
}

/** Puts a process step back in scope. Values kept while it was out become active again. */
export function includeStep(content: ContentBundle, project: Project, uo: string, actor: Actor): Project {
  const existing = (project.stepScope?.excluded ?? []).find((e) => e.uo === uo);
  if (!existing) throw new ScopeError("That process step is not left out.");
  const next = structuredClone(project);
  next.stepScope.excluded = next.stepScope.excluded.filter((e) => e.uo !== uo);
  logged(next, actor, "scope_include_uo", uo, `Put the process step “${labelOf(content, uo)}” back in scope`, { before: existing });
  return next;
}

/** Applies a group tick: every listed step is left out (with the same optional reason) or put back, one change-log entry each. */
export function setStepsExcluded(content: ContentBundle, project: Project, uos: string[], excluded: boolean, reason: string | undefined, actor: Actor): Project {
  let next = project;
  for (const uo of uos) {
    if (excluded && !isStepExcluded(next, uo)) next = excludeStep(content, next, uo, reason, actor);
    else if (!excluded && isStepExcluded(next, uo)) next = includeStep(content, next, uo, actor);
  }
  return next;
}

export interface StepExclusion {
  uo: string;
  uoLabel: string;
  reason?: string;
  by: string;
  at: string;
  /** Values still held for the step (inactive). */
  keptValues: number;
}

/** Every process step left out, in process order, for the document scope. */
export function stepExclusions(content: ContentBundle, project: Project): StepExclusion[] {
  const seq = (uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.sequence ?? 999;
  return [...(project.stepScope?.excluded ?? [])]
    .sort((a, b) => seq(a.uo) - seq(b.uo))
    .map((e) => ({
      uo: e.uo,
      uoLabel: labelOf(content, e.uo),
      ...(e.reason ? { reason: e.reason } : {}),
      by: e.by,
      at: e.at,
      keptValues: stepEntryCount(content, project, e.uo),
    }));
}
