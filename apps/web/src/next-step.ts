import { isAnswered, isTbdAnswer, omittedSectionIds, type Assessment, type QuestionInstance } from "@gap/engine";
import type { Project } from "@gap/process-model";
import { openItemsCountOrNone } from "./open-count";

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

export interface InterviewCounts {
  total: number;
  /** Questions with a real answer (not "to be decided"). */
  known: number;
  /** Questions answered "to be decided" / "Don't know yet": a response, but the value is still unknown. */
  tbd: number;
  /** Questions with no answer yet plus the "to be decided" ones: everything that is still open. */
  open: number;
}

/**
 * The one count every page uses for the interview. "Don't know yet" is a response but not an answer: it counts as open, so an
 * interview of nothing but unknowns never reads as complete (a GMP document must not look finished while its values are unknown).
 */
export function interviewCounts(project: Project, instances: QuestionInstance[]): InterviewCounts {
  const total = instances.length;
  const tbd = instances.filter((i) => isAnswered(project, i) && isTbdAnswer(project, i)).length;
  const answered = instances.filter((i) => isAnswered(project, i)).length;
  const known = answered - tbd;
  return { total, known, tbd, open: total - known };
}

/**
 * "5 of 43 answered, 42 open items (3 to be decided)": the same words in the interview banner and on Home. The open items are the ones the
 * Open items tab and the document list (a.openItems), so the interview, Home, the chain strip and the document all give ONE count for what is
 * still to fill, instead of "38 still open" here and "42 open items" there (EOU-14, EOU-15, EOU-25).
 */
export function interviewCountsText(c: InterviewCounts, openItems: number): string {
  return `${c.known} of ${c.total} answered, ${openItemsCountOrNone(openItems)}${c.tbd > 0 ? ` (${c.tbd} to be decided)` : ""}`;
}

/**
 * Which steps can honestly be shown as done, worked out from the project data (no stored flag). A step with no way to tell stays
 * absent (never a guess): reading the validation view leaves no trace in the project.
 * - Scope: a scope choice is recorded. Answering interview questions does NOT tick it (a first-time tester saw "Scope done" after one answer, without
 *   ever opening the Scope step). "Everything stays in scope" leaves no trace, so there is no way to tell; the tick stays absent rather than guessing.
 *   (nextStep still moves on to the interview once answers exist, see scopePassed.)
 * - Interview: every question has a real answer; "to be decided" counts as still open.
 * - Gap register: the interview is done and either there are no differences or at least one gap has an owner, status or note recorded.
 * - Document: the gap assessment document was downloaded and no open items are left. A download while items are still open is not
 *   "done" (a first-time tester saw "done" after one download with 38 items open): see documentDownloadedNote for what it shows then.
 */
export function stepDone(project: Project, a: Assessment): Partial<Record<GapStepId, boolean>> {
  const done: Partial<Record<GapStepId, boolean>> = {};
  if (scopeRecorded(project)) done.scope = true;
  const counts = interviewCounts(project, a.instances);
  if (counts.total > 0 && counts.open === 0) {
    done.interview = true;
    const differences = a.gaps.filter((g) => g.category !== "equivalent").length;
    if (differences === 0 || project.gapOverlays.length > 0) done.register = true;
  }
  if (gapDocumentDownloaded(project) && a.openItems.length === 0) done.document = true;
  return done;
}

/**
 * The export history also holds the TRD seed, sampling plan, risk and batch record downloads. Only the three formats of the gap
 * assessment document itself say anything about this step.
 */
const GAP_DOCUMENT_FORMATS: ReadonlySet<string> = new Set(["markdown", "html", "docx"]);

export function gapDocumentDownloaded(project: Project): boolean {
  return project.document.exports.some((e) => GAP_DOCUMENT_FORMATS.has(e.format));
}

/** "downloaded, 38 open items": what the Document step shows instead of a tick after a download that still lists open items. */
export function documentDownloadedNote(project: Project, a: Assessment): string | undefined {
  const open = a.openItems.length;
  return gapDocumentDownloaded(project) && open > 0 ? `downloaded, ${open} open ${open === 1 ? "item" : "items"}` : undefined;
}
