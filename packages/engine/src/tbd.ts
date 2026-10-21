import type { TbdInfo } from "@gap/process-model";
import type { Assessment } from "./compare";
import type { ContentBundle } from "./content";
import { formatValue, STATUS_TEXT } from "./format";
import { entryLabel } from "./labels";
import type { Project } from "@gap/process-model";

/*
 * TBD (to be determined) views.
 *
 * A TBD is a recorded commitment to find a value out: someone may be named as owner, with a due date, and may have written
 * down a best guess. It is NOT a value. The views here are derived from the project every time and never stored, so they
 * cannot drift from the entries. "Overdue" depends on today's date, so it is only ever computed for screens, never written
 * into the generated document (that would make the document look changed from one day to the next).
 */

export interface TbdItem {
  ref: string;
  side: "source" | "target" | "shared";
  /** "SU" or "RU" (or "Scoping"), as shown to people. */
  sideText: string;
  questionId: string;
  /** The question as asked. */
  prompt: string;
  /** The question label, plus the field for a parameter ("Mixing speed: Set point"). */
  attribute: string;
  sectionId: string;
  sectionTitle: string;
  info: TbdInfo;
  /** The best guess as people read it (option labels, units); undefined when none was recorded. */
  bestGuess?: string;
  owner?: string;
  /** YYYY-MM-DD. */
  due?: string;
  note?: string;
}

/**
 * One item per active entry that is a TBD. "Same as SU" on a TBD is not listed again: the SU entry is the one to resolve.
 * Entries of questions that are no longer asked about are not listed (they are not in the assessment either).
 */
export function tbdItems(content: ContentBundle, project: Project, a: Assessment): TbdItem[] {
  const out: TbdItem[] = [];
  for (const o of a.openItems) {
    if (o.status !== "tbd" || !o.tbd) continue;
    const l = entryLabel(content, project, o.ref);
    const optionSet = l.question?.input.type === "parameter" && l.field === "classification" ? "classification" : l.field === "rangeBasis" ? "rangeBasis" : undefined;
    const item: TbdItem = {
      ref: o.ref,
      side: o.side,
      sideText: l.sideText,
      questionId: o.questionId,
      prompt: o.prompt,
      attribute: l.attribute,
      sectionId: o.sectionId,
      sectionTitle: o.sectionTitle,
      info: o.tbd,
    };
    if (o.tbd.bestGuess !== undefined) item.bestGuess = formatValue(content, l.question, o.tbd.bestGuess, optionSet);
    if (o.tbd.owner) item.owner = o.tbd.owner;
    if (o.tbd.due) item.due = o.tbd.due;
    if (o.tbd.note) item.note = o.tbd.note;
    out.push(item);
  }
  return out;
}

/**
 * Overdue means the due date is before today. Both are calendar dates (YYYY-MM-DD) and compare as text. `today` is passed
 * in by the caller as the local date of the person looking, so this stays pure and testable. A due date of today is not overdue.
 */
export function isOverdue(due: string | undefined, today: string): boolean {
  return !!due && due < today;
}

/** Today's date in the local time zone, YYYY-MM-DD (not UTC: a due date is a calendar date for the person who set it). */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface TbdSummary {
  total: number;
  overdue: number;
  withBestGuess: number;
}

export function tbdSummary(items: TbdItem[], today: string): TbdSummary {
  return {
    total: items.length,
    overdue: items.filter((i) => isOverdue(i.due, today)).length,
    withBestGuess: items.filter((i) => i.bestGuess !== undefined).length,
  };
}

/** "N to be confirmed (M overdue)" for the Home card. */
export function tbdSummaryText(s: TbdSummary): string {
  return `${s.total} to be confirmed (${s.overdue} overdue)`;
}

/**
 * The status text of a TBD in the open-items table of the document: the facts as recorded and nothing date-dependent.
 * The best guess is always labelled provisional so a reader cannot take it for a confirmed value.
 */
export function tbdStatusText(item: Pick<TbdItem, "bestGuess" | "owner" | "due" | "note">): string {
  const parts = [STATUS_TEXT.tbd + "."];
  parts.push(item.bestGuess !== undefined ? `Best guess: ${item.bestGuess} (provisional).` : "No best guess recorded.");
  if (item.owner) parts.push(`Owner: ${item.owner}.`);
  if (item.due) parts.push(`Due: ${item.due}.`);
  if (item.note) parts.push(`Note: ${item.note}`);
  return parts.join(" ");
}
