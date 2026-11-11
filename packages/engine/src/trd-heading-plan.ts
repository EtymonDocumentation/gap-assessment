import { rematchTrdMapping, resolveHeadingTexts, type HeadingTextLike, type MatchHeading, type TrdMapping } from "./trd-heading-match";
import { TRD_FRONT_UNIT } from "./trd-units";

/*
 * Which piece of a TRD goes under which heading of a person's own template, and which headings are still to complete (M15, job 3B).
 *
 * ONE definition, used by the Word render (what it writes under each heading), by the preview / HTML / Markdown order, by the open-item list
 * and by the Document page's "headings to complete" line. The interview groups (trd-heading-interview.ts) apply the same rules and a unit test
 * keeps the two equal. Rules (product owner, 2026-11-11): a heading with no Cascade content under it, no text of the person's own and no kept
 * template text is marked "[To be completed.]" and counts as an open item. A heading whose template text is kept is NOT open.
 * Pure: the caller passes the headings and the match in; nothing here reads a template store.
 */

/** What the Word file (and now the preview, HTML and Markdown) says under a heading that has nothing. */
export const TRD_TO_COMPLETE_TEXT = "[To be completed.]";
/** HTML, Markdown and the preview cannot carry the template's own text, so a heading that keeps it says so. Not an open item. */
export const TRD_KEPT_TEXT_NOTE = "[The text of your template stays under this heading in the Word file.]";
/** The heading at the end that holds the pieces added back because the template has no heading for them. */
export const TRD_ADDITIONAL_HEADING = "Additional content";

export type HeadingSlotState = "content" | "written" | "kept" | "empty";

export interface HeadingSlot {
  heading: MatchHeading;
  /** The pieces of the TRD under this heading, in the stored order: known, and not already under an earlier heading. */
  ids: string[];
  /** What the person wrote under this heading, trimmed. */
  text: string;
  /** The template has text of its own here (and it is kept). */
  keptText: boolean;
  /** Replace or keep the template's own text where there is Cascade content (as picked). */
  existing: "replace" | "keep";
  /** content: Cascade pieces; written: only the person's words; kept: only the template's own text; empty: nothing at all = open. */
  state: HeadingSlotState;
}

export interface HeadingPlanInput {
  headings: readonly MatchHeading[];
  mapping: TrdMapping | undefined;
  /** Every piece the TRD has, in document order ("front" first). */
  unitIds: readonly string[];
  headingTexts?: readonly HeadingTextLike[];
  addedBack?: readonly string[];
  /** Whether the template's own text stays under a heading. Default: the heading's `hasBody`. The Word render passes what it found in the file (none for a PDF). */
  keptText?: (h: MatchHeading) => boolean;
}

export interface HeadingPlan {
  slots: HeadingSlot[];
  /** Pieces added back, in document order, for "Additional content". */
  back: string[];
  /** Pieces with no heading that were not added back: not in the document. In document order, front excluded. */
  leftOut: string[];
}

export function trdHeadingPlan(input: HeadingPlanInput): HeadingPlan {
  const known = new Set(input.unitIds);
  const { mapping } = rematchTrdMapping(input.headings, input.mapping);
  const entries = new Map(mapping.headings.map((h) => [h.headingIndex, h]));
  const { byIndex: written } = resolveHeadingTexts(input.headings, input.headingTexts);
  const kept = input.keptText ?? ((h: MatchHeading) => h.hasBody);
  const used = new Set<string>();
  const slots: HeadingSlot[] = [];
  for (const heading of input.headings) {
    const entry = entries.get(heading.index);
    // Content the TRD does not have (a placement kept from another TRD) or that an earlier heading already holds is not written twice.
    const ids = (entry?.units ?? []).filter((id) => known.has(id) && !used.has(id));
    for (const id of ids) used.add(id);
    const text = written.get(heading.index)?.text.trim() ?? "";
    const keptText = kept(heading);
    const state: HeadingSlotState = ids.length ? "content" : text ? "written" : keptText ? "kept" : "empty";
    slots.push({ heading, ids, text, keptText, existing: entry?.existing ?? "replace", state });
  }
  const added = new Set(input.addedBack ?? []);
  const unplaced = input.unitIds.filter((id) => !used.has(id));
  return {
    slots,
    back: unplaced.filter((id) => added.has(id)),
    leftOut: unplaced.filter((id) => !added.has(id) && id !== TRD_FRONT_UNIT),
  };
}

export interface HeadingToComplete {
  headingIndex: number;
  /** The heading as the file shows it: number, then words. */
  title: string;
  text: string;
  number?: string;
}

const titleOf = (h: Pick<MatchHeading, "number" | "text">): string => (h.number ? `${h.number} ${h.text}` : h.text);

/** The headings that say "[To be completed.]" and count as open items, in the template's order. Headings to match again are not in here. */
export function trdHeadingsToComplete(input: HeadingPlanInput): HeadingToComplete[] {
  return trdHeadingPlan(input)
    .slots.filter((s) => s.state === "empty")
    .map((s) => ({ headingIndex: s.heading.index, title: titleOf(s.heading), text: s.heading.text, ...(s.heading.number ? { number: s.heading.number } : {}) }));
}
