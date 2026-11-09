import { content } from "@gap/content";
import { openBlankCount, trdOpenItems, writeupsInOrder, type BlankContext, type ContentBundle } from "@gap/engine";
import type { Project, TrdDocument } from "@gap/process-model";

/**
 * The one "open items" count of a technical requirements document (EOU-14, EOU-15, EOU-25). Before, the chain strip and the page header
 * counted the entries of the Open items list only, the interview counted unanswered questions, and the Open items tab added "and N blank
 * fields" on the side: one TRD showed three numbers. Now a TRD has ONE number, everything still to fill: the entries of the Open items
 * list (a value not established, to be decided, provisional or a finding to look at) plus the blank fields in the text of the process
 * descriptions. The Open items tab breaks that number down, so the parts are always visible. Nothing is hidden: a count that left the blank
 * fields out would let a TRD with 25 blanks read as "no open items".
 */
export interface OpenCount {
  /** Entries of the Open items list. */
  entries: number;
  /** Blank fields in the text of the process descriptions. */
  blanks: number;
  total: number;
}

export function trdOpenCount(project: Project, d: TrdDocument, bundle: ContentBundle = content): OpenCount {
  const entries = trdOpenItems(d).length;
  const ctx: BlankContext = { project, doc: d, content: bundle };
  const blanks = writeupsInOrder(d).reduce((n, w) => n + openBlankCount(ctx, w), 0);
  return { entries, blanks, total: entries + blanks };
}

/** "1 open item", "12 open items": the same words in the chain strip, the page header, the Home cards and the interview banner. */
export function openItemsCount(n: number): string {
  return `${n} open ${n === 1 ? "item" : "items"}`;
}

/** "no open items" for none, otherwise the count (the chain strip and the Home cards read "TRD-001, no open items"). */
export function openItemsCountOrNone(n: number): string {
  return n === 0 ? "no open items" : openItemsCount(n);
}
