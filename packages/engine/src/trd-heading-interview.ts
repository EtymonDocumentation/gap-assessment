import { rematchTrdMapping, resolveHeadingTexts, trdLeftOut, type HeadingTextLike, type MatchHeading, type TrdMapping, type TrdPlacement } from "./trd-heading-match";
import { INTERVIEW_DOCUMENT_GROUP, trdInterviewProgress, type InterviewCounts, type InterviewFilter, type InterviewQuestion } from "./trd-interview";
import type { TrdUnitInfo } from "./trd-units";

/*
 * The TRD interview in the order of a person's own Word template (M15, job 3A).
 *
 * The questions are the same ones the interview always asks. What changes is the grouping: instead of Cascade's process steps, one group per
 * heading of the template, in the template's order, holding the questions whose answers land under that heading. Where an answer lands is
 * decided by the match the person confirmed (which pieces of the TRD sit under which heading), never guessed here.
 *
 * Rules kept here:
 *  - A question is in exactly ONE place: a group, or the not-asked list. Nothing is lost, nothing is asked twice.
 *  - Content with no heading and not added back is not part of the Word file, so its questions are not asked. Their answers stay in the TRD
 *    untouched and the questions come back the moment the content is placed or added back. Changing the match only regroups; no answer is
 *    read, written or removed by anything in this file.
 *  - A heading with no Cascade content gets ONE writing box ("What goes under this heading?"): the person's own words, kept apart from the
 *    questions (`headingTexts` on the TRD). A heading whose own template text is kept is shown as such and is not open.
 *  - Pure: the caller passes the template's headings and the stored match in. Nothing here reads a template store.
 */

/** The label of the group with the document fields and details. Named so it cannot be confused with the TRD section "About this document" (unit "product"), which can sit under a heading or in "Not in your template". */
export const HEADING_ABOUT_TITLE = "Details of this TRD";
/** The label of the group holding the pieces the person added back at the end of the Word file. */
export const HEADING_ADDITIONAL_TITLE = "Additional content";
/** The question of a writing box. */
export const HEADING_WRITING_PROMPT = "What goes under this heading?";

/** The key a writing box has where the interview needs one key per card (Continue where you left off, one question at a time). */
export const headingTextKey = (headingIndex: number): string => `heading-text:${headingIndex}`;

/** The step label inside a heading for the TRD's own prose questions (introduction, scope ...): they belong to no process step. */
const PROSE_LABEL = "Text of the document";

export interface HeadingSubGroup {
  /** A process step, or INTERVIEW_DOCUMENT_GROUP for the TRD's own prose. */
  stepKey: string;
  stepLabel: string;
  /** In the interview's own order: Essentials first, then More detail. */
  questions: InterviewQuestion[];
}

/** The text a person writes under a heading that has no Cascade content. */
export interface HeadingWriting {
  key: string;
  headingIndex: number;
  /** The heading's words as in the template now. */
  headingText: string;
  /** What is written now; empty = open. */
  text: string;
}

export interface GroupCounts {
  essentials: InterviewCounts;
  moreDetail: InterviewCounts;
}

/**
 * about: document fields, details and any question with no landing place; heading: one heading of the template; additional: the pieces added
 * back at the end.
 */
export type HeadingGroupKind = "about" | "heading" | "additional";

/**
 * What a heading group shows:
 *  - questions: Cascade content is under it and at least one question lands there;
 *  - nothing: Cascade content is under it but no question lands there ("Nothing to answer here.");
 *  - writing: no Cascade content and no template text of its own: one writing box;
 *  - kept_text: no Cascade content, the template's own text stays: shown, nothing to answer, not open.
 */
export type HeadingGroupState = "questions" | "nothing" | "writing" | "kept_text";

export interface HeadingGroup {
  /** "about", "heading-<index>" or "additional". */
  id: string;
  kind: HeadingGroupKind;
  /** The heading's number and words as in the file ("6.2 Filling"), or the group's own name. */
  title: string;
  headingIndex?: number;
  level?: number;
  state: HeadingGroupState;
  /** The pieces of the TRD under this heading (or added back), in the order they were placed. */
  units: TrdUnitInfo[];
  subGroups: HeadingSubGroup[];
  /** A heading with no Cascade content, or with text written earlier. */
  writing?: HeadingWriting;
  counts: GroupCounts;
}

export interface HeadingInterviewInput {
  questions: readonly InterviewQuestion[];
  /** Question key -> the unit its answer lands in (`trdAnswerLandings`). A question not listed has no landing place. */
  unitOf: ReadonlyMap<string, string>;
  /** The pieces of this TRD (`trdUnitsOf(trdUnitModel(...))`). */
  units: readonly TrdUnitInfo[];
  /** The template's headings, in the file's order. */
  headings: readonly MatchHeading[];
  /** The match as stored on the template. It is fitted to the headings here, so a re-uploaded template is read by heading words. */
  mapping: TrdMapping | undefined;
  /** `headingTexts` of the TRD. */
  headingTexts?: readonly HeadingTextLike[];
  /** `addedBack` of the TRD. */
  addedBack?: readonly string[];
  /** The Keep marks (see trdInterviewProgress). */
  kept?: ReadonlySet<string>;
}

export interface HeadingLanding {
  groupId: string;
  /** "6.2 Filling" or "Additional content". */
  title: string;
  /** Set for a group of the template, not for "Additional content". */
  headingIndex?: number;
}

export interface HeadingInterview {
  /** Details of this TRD first, then one per heading in the template's order, then Additional content (only when something was added back). */
  groups: HeadingGroup[];
  /** Questions of content with no heading that is not added back: not asked, answers kept. */
  notAsked: InterviewQuestion[];
  /** The pieces that will not be in the Word file: no heading holds them and they were not added back. */
  leftOut: TrdUnitInfo[];
  /** Stored placements whose heading is not in the template any more. */
  again: TrdPlacement[];
  /** Written text whose heading is not in the template any more (never moved to another heading). */
  textsAgain: HeadingTextLike[];
  /** How many headings need matching again: a heading with a stored place or text that the template no longer has. */
  needMatching: number;
  /** Where each asked question lands (questions of "Details of this TRD" have no entry). Writing boxes are listed under their own key. */
  landing: Map<string, HeadingLanding>;
  /** Counts over everything asked. */
  overall: GroupCounts;
  /** What went to "Details of this TRD": document fields and details, and the questions with no landing place (the third is the one to watch). */
  aboutKinds: { document: number; detail: number; noPlace: number };
}

const zero = (): InterviewCounts => ({ total: 0, answered: 0, open: 0, toConfirm: 0, tbd: 0 });
const emptyCounts = (): GroupCounts => ({ essentials: zero(), moreDetail: zero() });

function addTo(into: InterviewCounts, c: InterviewCounts): void {
  into.total += c.total;
  into.answered += c.answered;
  into.open += c.open;
  into.toConfirm += c.toConfirm;
  into.tbd += c.tbd;
}

/** The heading as the file shows it: its number, then its words. */
export const headingTitle = (h: Pick<MatchHeading, "number" | "text">): string => (h.number ? `${h.number} ${h.text}` : h.text);

function countsOf(qs: readonly InterviewQuestion[], kept: ReadonlySet<string>, writing?: HeadingWriting): GroupCounts {
  const p = trdInterviewProgress(qs, kept).overall;
  const out: GroupCounts = { essentials: { ...p.essentials }, moreDetail: { ...p.moreDetail } };
  // A writing box is the one way a heading gets its words, so it counts as an Essential: open until something is written.
  if (writing) addTo(out.essentials, { total: 1, answered: writing.text.trim() ? 1 : 0, open: writing.text.trim() ? 0 : 1, toConfirm: 0, tbd: 0 });
  return out;
}

function subGroupsOf(qs: readonly InterviewQuestion[], prose: boolean): HeadingSubGroup[] {
  const out = new Map<string, HeadingSubGroup>();
  for (const q of qs) {
    let g = out.get(q.stepKey);
    if (!g) out.set(q.stepKey, (g = { stepKey: q.stepKey, stepLabel: prose && q.stepKey === INTERVIEW_DOCUMENT_GROUP ? PROSE_LABEL : q.stepLabel, questions: [] }));
    g.questions.push(q);
  }
  return [...out.values()];
}

/**
 * The interview's groups for a TRD that follows the headings of a template. See the rules at the top of this file. Within a heading the
 * questions keep the interview's own order (process steps in checklist order, each with its Essentials and then its More detail); a heading
 * that holds more than one step gets one sub-group per step so a heading such as "Process description" stays walkable.
 */
export function trdHeadingInterview(input: HeadingInterviewInput): HeadingInterview {
  const kept = input.kept ?? new Set<string>();
  const known = new Set(input.units.map((u) => u.id));
  const unitInfo = new Map(input.units.map((u) => [u.id, u] as const));
  const { mapping, again } = rematchTrdMapping(input.headings, input.mapping);
  const { byIndex: written, again: textsAgain } = resolveHeadingTexts(input.headings, input.headingTexts);
  // A piece of the TRD can sit under one heading only; if a stored match lists it twice the first heading in the file keeps it, as the Word file does.
  const owner = new Map<string, number>();
  const placedAt = new Map<number, TrdUnitInfo[]>();
  for (const h of input.headings) {
    const entry = mapping.headings.find((e) => e.headingIndex === h.index);
    const mine: TrdUnitInfo[] = [];
    for (const id of entry?.units ?? []) {
      if (!known.has(id) || owner.has(id)) continue;
      owner.set(id, h.index);
      mine.push(unitInfo.get(id)!);
    }
    placedAt.set(h.index, mine);
  }
  const back = (input.addedBack ?? []).filter((id, i, all) => known.has(id) && !owner.has(id) && all.indexOf(id) === i);
  const backSet = new Set(back);

  const aboutQs: InterviewQuestion[] = [];
  const byHeading = new Map<number, InterviewQuestion[]>();
  const additionalQs: InterviewQuestion[] = [];
  const notAsked: InterviewQuestion[] = [];
  const aboutKinds = { document: 0, detail: 0, noPlace: 0 };
  // The interview's own order is kept by sorting on `order`: the caller may hand over a filtered or shuffled list.
  for (const q of [...input.questions].sort((a, b) => a.order - b.order)) {
    const unit = input.unitOf.get(q.key);
    if (q.target.kind === "document" || q.target.kind === "detail") {
      aboutQs.push(q);
      aboutKinds[q.target.kind] += 1;
    } else if (!unit || !known.has(unit)) {
      // Never dropped: with no landing place the question is still asked, in the group that is always asked.
      aboutQs.push(q);
      aboutKinds.noPlace += 1;
    } else if (owner.has(unit)) {
      const at = owner.get(unit)!;
      byHeading.set(at, [...(byHeading.get(at) ?? []), q]);
    } else if (backSet.has(unit)) additionalQs.push(q);
    else notAsked.push(q);
  }

  const landing = new Map<string, HeadingLanding>();
  const groups: HeadingGroup[] = [{ id: "about", kind: "about", title: HEADING_ABOUT_TITLE, state: "questions", units: [], subGroups: subGroupsOf(aboutQs, false), counts: countsOf(aboutQs, kept) }];

  for (const h of input.headings) {
    const mine = placedAt.get(h.index) ?? [];
    const qs = byHeading.get(h.index) ?? [];
    const text = written.get(h.index)?.text ?? "";
    const holds = mine.length > 0;
    const state: HeadingGroupState = holds ? (qs.length ? "questions" : "nothing") : h.hasBody ? "kept_text" : "writing";
    // Text written earlier is shown wherever its heading now is, so words that will print in the Word file are never out of sight.
    const writing: HeadingWriting | undefined = state === "writing" || text.trim() ? { key: headingTextKey(h.index), headingIndex: h.index, headingText: h.text, text } : undefined;
    const title = headingTitle(h);
    const id = `heading-${h.index}`;
    for (const q of qs) landing.set(q.key, { groupId: id, title, headingIndex: h.index });
    if (writing) landing.set(writing.key, { groupId: id, title, headingIndex: h.index });
    groups.push({ id, kind: "heading", title, headingIndex: h.index, level: h.level, state, units: mine, subGroups: subGroupsOf(qs, true), ...(writing ? { writing } : {}), counts: countsOf(qs, kept, writing) });
  }

  if (back.length) {
    for (const q of additionalQs) landing.set(q.key, { groupId: "additional", title: HEADING_ADDITIONAL_TITLE });
    groups.push({ id: "additional", kind: "additional", title: HEADING_ADDITIONAL_TITLE, state: additionalQs.length ? "questions" : "nothing", units: back.map((id) => unitInfo.get(id)!), subGroups: subGroupsOf(additionalQs, true), counts: countsOf(additionalQs, kept) });
  }

  const overall = emptyCounts();
  for (const g of groups) {
    addTo(overall.essentials, g.counts.essentials);
    addTo(overall.moreDetail, g.counts.moreDetail);
  }
  const againTitles = new Set([...again.map((p) => p.headingText), ...textsAgain.map((t) => t.headingText)].map((t) => t.trim().toLowerCase()));
  return {
    groups,
    notAsked,
    leftOut: trdLeftOut(input.units, mapping, back),
    again,
    textsAgain,
    needMatching: againTitles.size,
    landing,
    overall,
    aboutKinds,
  };
}

/** Every card of the interview in the order it is asked, by key: the questions, and a heading's writing box after the questions of that heading. */
export function headingInterviewKeys(hi: Pick<HeadingInterview, "groups">): string[] {
  return hi.groups.flatMap((g) => [...g.subGroups.flatMap((s) => s.questions.map((q) => q.key)), ...(g.writing ? [g.writing.key] : [])]);
}

/**
 * The same filters as `filterInterviewQuestions`, for a writing box: it has no Essentials / More detail split (it is always shown), it is
 * "still open" while nothing is written, it is never a project value to confirm, and a search finds it by its heading.
 */
export function headingWritingMatches(w: HeadingWriting, f: InterviewFilter = {}): boolean {
  const needle = (f.search ?? "").trim().toLowerCase();
  if (f.level === "more") return false;
  if (f.show === "confirm") return false;
  if (f.show === "open" && w.text.trim()) return false;
  if (needle && ![w.headingText, HEADING_WRITING_PROMPT, w.text].some((s) => s.toLowerCase().includes(needle))) return false;
  return true;
}
