import { isAnswered, omittedSectionIds, type Assessment } from "@gap/engine";
import type { Project } from "@gap/process-model";

/** The six gap assessment steps, in the order a new user works through them. */
export const GAP_STEPS = [
  { id: "scope", path: "/scope", label: "Scope" },
  { id: "interview", path: "/interview", label: "Interview" },
  { id: "compare", path: "/compare", label: "Side by side" },
  { id: "register", path: "/register", label: "Gap register" },
  { id: "validation", path: "/validation", label: "Validation" },
  { id: "document", path: "/document", label: "Document" },
] as const;

export type GapStepId = (typeof GAP_STEPS)[number]["id"];

/** True when a scope choice has been recorded: a process step or a document section was left out. */
export function scopeRecorded(project: Project): boolean {
  return project.stepScope.excluded.length > 0 || omittedSectionIds(project).length > 0;
}

export function unansweredCount(project: Project, a: Assessment): number {
  return a.instances.filter((i) => !isAnswered(project, i)).length;
}

/**
 * Scope counts as dealt with once a choice is recorded, or once interview answers exist (a user who answered questions has plainly
 * moved on). "Everything stays in scope" is a legitimate decision that leaves no trace, so a fresh project is always offered the
 * Scope step first rather than guessing.
 */
export function scopePassed(project: Project, a: Assessment): boolean {
  return scopeRecorded(project) || a.instances.some((i) => isAnswered(project, i));
}

export interface NextStep {
  /** Route path, e.g. "/scope". */
  path: string;
  /** Button text. */
  label: string;
  /** Which step this belongs to, for the step bar. */
  step: GapStepId;
}

/** The one thing to do next in an open project. Used by the Home page card and the "Gap assessment" menu link. */
export function nextStep(project: Project, a: Assessment): NextStep {
  if (!scopePassed(project, a)) return { path: "/scope", label: "Choose the scope", step: "scope" };
  const open = unansweredCount(project, a);
  if (open > 0) return { path: "/interview", label: `Answer ${open} more question${open === 1 ? "" : "s"}`, step: "interview" };
  return { path: "/register", label: "Review the gap register", step: "register" };
}

/**
 * Which steps can honestly be shown as done. Only what the project data proves is true or false; a step with no way to tell is
 * absent (never a guess): reading the register, the validation view or the document leaves no trace in the project.
 */
export function stepDone(project: Project, a: Assessment): Partial<Record<GapStepId, boolean>> {
  const done: Partial<Record<GapStepId, boolean>> = {};
  if (scopeRecorded(project)) done.scope = true;
  if (a.instances.length > 0 && unansweredCount(project, a) === 0) done.interview = true;
  return done;
}
