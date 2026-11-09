import { excipientClasses, excipientWording } from "@gap/content";
import { deriveExcipientQuestions, type ExcipientOpenItem, type ExcipientQuestion } from "@gap/engine";
import type { ExcipientAssessment, Project } from "@gap/process-model";
import { useMemo } from "react";
import type { CardStatus } from "./pages/InterviewCardBase";
import { useStore } from "./store";

/*
 * Small pure helpers of the excipient assessment screens: the tab addresses, how a question or a fact reads as an icon plus words, and
 * the link from an open item to its question. Nothing here changes the assessment.
 */

export const EXCIPIENT_PATH = "/excipient";

export type ExcipientTab = "excipients" | "questions" | "specs" | "open" | "document";
export const EXCIPIENT_TAB_LABEL: Record<ExcipientTab, string> = { excipients: "1. Excipients", questions: "2. Questions", specs: "3. Specifications", open: "4. Open items", document: "5. Document" };
export const EXCIPIENT_TABS = Object.keys(EXCIPIENT_TAB_LABEL) as ExcipientTab[];

/** The said-once sentence of an assessment with no excipient yet (the spec's wording; the Questions tab and the list use it too). */
export const EXCIPIENT_EMPTY_TEXT = "Add the excipients of your product and answer a few questions. Anything you don't know stays open.";

/** The questions of one assessment, derived again whenever the project changes (nothing is stored). */
export function useExcipientQuestions(a: ExcipientAssessment): ExcipientQuestion[] {
  const project = useStore((s) => s.project)!;
  return useMemo(() => deriveExcipientQuestions(project, a.id, { wording: excipientWording, classes: excipientClasses }), [project, a]);
}

/** The same words as the other interviews' cards (M12), so the status reads the same everywhere. A symbol plus the words: never colour alone. */
export function questionStatus(q: Pick<ExcipientQuestion, "state">): CardStatus {
  switch (q.state) {
    case "answered":
      return { icon: "✓", text: "Answered", tone: "done" };
    case "same_as_sending":
      return { icon: "✓", text: "Same as the sending site", tone: "done" };
    case "not_applicable":
      return { icon: "–", text: "Not applicable here", tone: "done" };
    case "tbd":
      return { icon: "◐", text: "To be decided (TBD)", tone: "open" };
    default:
      return { icon: "○", text: "Open", tone: "open" };
  }
}

/** What a fact shows in a table cell or on the line page: an unknown stays visible as "Not established". */
export function factCell(q: ExcipientQuestion | undefined): { icon: string; text: string; open: boolean } {
  if (!q) return { icon: "–", text: "Not asked", open: false };
  switch (q.state) {
    case "answered":
    case "same_as_sending":
      return { icon: "✓", text: q.current ?? "Answered", open: false };
    case "not_applicable":
      return { icon: "–", text: q.reason ? `Not applicable (${q.reason})` : "Not applicable", open: false };
    case "tbd":
      return { icon: "◐", text: "To be decided (TBD)", open: true };
    default:
      return { icon: "○", text: "Not established", open: true };
  }
}

/** The key of the question for a fact (the same as deriveExcipientQuestions makes). */
export const factQuestionKey = (lineId: string, factKey: string, side?: string): string => `${lineId}/fact:${factKey}${side ? `.${side}` : ""}`;

/** The question an open item points to, or undefined when it is not about a fact (a comparison row, a line without a document). */
export function openItemQuestionKey(o: ExcipientOpenItem): string | undefined {
  return o.factKey ? factQuestionKey(o.lineId, o.factKey, o.side) : undefined;
}

export const KIND_TEXT: Record<ExcipientOpenItem["kind"], string> = {
  not_established: "Not established",
  tbd: "TBD",
  not_compared: "Not compared yet",
  no_sources: "No document cited",
};

/** The class of a line in words: the listed class's label, the person's own words, or nothing yet. */
export function classText(line: { classKey?: string | undefined; classLabel?: string | undefined }): string | undefined {
  if (line.classKey) return excipientClasses.classes.find((c) => c.key === line.classKey)?.label ?? line.classKey;
  return line.classLabel;
}

/** "Excipient assessment" is the name in the menu, the header and the document. */
export const EXCIPIENT_NAME = "Excipient assessment";

export const assessmentOf = (project: Project, id: string | null): ExcipientAssessment | undefined => (id ? project.excipients?.assessments.find((a) => a.id === id) : undefined);

// ------------------------------------------------------------------ browser storage (a per-viewer convenience)

const LAST = "gap-excipient-interview-last";
const where = (projectId: string, assessmentId: string) => `${LAST}:${projectId}:${assessmentId}`;

/** The key of the question last looked at, so "Continue where you left off" can return to it. Nothing when storage is blocked. */
export function readLastQuestion(projectId: string, assessmentId: string): string | undefined {
  try {
    return window.localStorage.getItem(where(projectId, assessmentId)) ?? undefined;
  } catch {
    return undefined;
  }
}
export function writeLastQuestion(projectId: string, assessmentId: string, key: string): void {
  try {
    window.localStorage.setItem(where(projectId, assessmentId), key);
  } catch {
    // Storage is blocked or full: the page works without it.
  }
}
