import {
  attachSourceMany,
  cleanLocation,
  detachSource,
  getEntry,
  type Actor,
  type AnsweringFrom,
  type Entry,
  type Project,
  type Source,
  type SourceLocation,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import { effectiveStaged } from "./custom";
import { entryDisplay, entryLabel, locationText, sourceShort, type EntryLabel } from "./labels";
import { activeRefs, instanceRefs, visibleInstances, type QuestionInstance } from "./sequencer";

/*
 * Drafting from documents: the interview's "Answering from" bar and the Sources page's "Link values" bulk cite.
 *
 * Both only ever add a citation (entry -> document, with an optional place inside it). Neither writes or changes a value,
 * and neither cites an entry that has no value: a citation says "this document supports this value", so there must be one.
 */

export class DraftingError extends Error {}

// ------------------------------------------------------------------ which entries can be cited

/**
 * An entry has a value to cite when it holds a stated value, a stated "not applicable" or a TBD best guess.
 * Unknown, a TBD without a best guess, "same as SU" (it has no value of its own: it follows the SU entry, which is the
 * one to cite) and entries with nothing recorded do not.
 */
export function hasCitableValue(e: Entry | undefined): boolean {
  if (!e) return false;
  if (e.status === "established") return !e.sameAsSource && e.value !== undefined;
  if (e.status === "not_applicable") return true;
  if (e.status === "tbd") return e.tbd?.bestGuess !== undefined;
  return false;
}

// ------------------------------------------------------------------ the bar

function documentSource(project: Project, sourceId: string): Source {
  const s = project.sources.find((x) => x.id === sourceId);
  if (!s || s.type !== "document_reference") throw new DraftingError("Choose a document from the register");
  if (s.supersededBy) throw new DraftingError("That source was superseded and cannot be cited");
  return s;
}

/** The bar as saved, or undefined when it is off or its document is no longer in the register. */
export function answeringFrom(project: Project): (AnsweringFrom & { source: Source }) | undefined {
  const bar = project.interview.answeringFrom;
  if (!bar) return undefined;
  const source = project.sources.find((s) => s.id === bar.sourceId && s.type === "document_reference");
  return source ? { ...bar, source } : undefined;
}

export const SIDES_TEXT = { source: "SU", target: "RU", both: "SU and RU" } as const;

/** "ABC-001 — Title, SU, §4.2 p.12": the one-line description of the bar. */
export function answeringFromText(bar: AnsweringFrom & { source: Source }): string {
  const loc = locationText(bar);
  return `${sourceShort(bar.source)} (${SIDES_TEXT[bar.sides]}${loc ? `, ${loc}` : ""})`;
}

/**
 * Turns the bar on or changes it. Saved in the project so it survives a reload and travels with the file. Changing it is
 * logged, because it decides which documents later answers are cited to.
 */
export function setAnsweringFrom(project: Project, input: AnsweringFrom, actor: Actor): Project {
  const source = documentSource(project, input.sourceId);
  if (input.sides !== "source" && input.sides !== "target" && input.sides !== "both") throw new DraftingError("Choose SU, RU or both");
  const loc = cleanLocation(input);
  const bar: AnsweringFrom = { sourceId: source.id, sides: input.sides, ...(loc ?? {}) };
  const prior = project.interview.answeringFrom;
  if (prior && JSON.stringify(prior) === JSON.stringify(bar)) return project;
  const next = structuredClone(project);
  next.interview.answeringFrom = bar;
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "set_answering_from",
    detail: `${sourceShort(source)} (${SIDES_TEXT[bar.sides]}${loc ? `, ${locationText(loc)}` : ""})`,
    ...(prior ? { before: structuredClone(prior) } : {}),
    after: structuredClone(bar),
  });
  return next;
}

/** Turns the bar off. Logged once; clearing a bar that is already off changes nothing. */
export function clearAnsweringFrom(project: Project, actor: Actor): Project {
  const prior = project.interview.answeringFrom;
  if (!prior) return project;
  const next = structuredClone(project);
  delete next.interview.answeringFrom;
  next.changeLog.push({ at: actor.at, by: actor.name, action: "clear_answering_from", before: structuredClone(prior) });
  return next;
}

// ------------------------------------------------------------------ cite

export interface CiteResult {
  project: Project;
  /** Entries that gained the citation now (the ones to undo). */
  cited: CitedRef[];
  /** Entries left alone, with the reason. */
  skipped: { ref: string; reason: "no_value" | "already_cited" }[];
}

/** What an automatic citation did to one entry. The revision guards the undo against a later re-answer. */
export interface CitedRef {
  ref: string;
  sourceId: string;
  revision: number;
}

/**
 * Cites a document (and optionally a place in it) for every listed entry that has a value. Entries without a value are
 * skipped and never cited. Entries that already cite the document are left untouched, so doing it twice changes nothing.
 * One change-log record is written per entry cited.
 */
export function citeEntries(project: Project, refs: string[], sourceId: string, location: SourceLocation | undefined, actor: Actor): CiteResult {
  documentSource(project, sourceId);
  const skipped: CiteResult["skipped"] = [];
  const valued: string[] = [];
  for (const ref of [...new Set(refs)]) {
    if (hasCitableValue(getEntry(project, ref))) valued.push(ref);
    else skipped.push({ ref, reason: "no_value" });
  }
  const res = attachSourceMany(project, valued, sourceId, actor, location);
  for (const ref of res.alreadyCited) skipped.push({ ref, reason: "already_cited" });
  const cited = res.attached.map((ref) => ({ ref, sourceId, revision: getEntry(res.project, ref)!.revision }));
  return { project: res.project, cited, skipped };
}

/** Does this bar apply to answers on this side of a card? "Both" also covers scoping answers, which belong to neither side. */
export function barAppliesTo(bar: Pick<AnsweringFrom, "sides">, side: QuestionInstance["side"]): boolean {
  return bar.sides === "both" || bar.sides === side;
}

/**
 * Cites the bar's document for the entries a just-saved answer wrote, if the bar covers that side. Call it right after
 * applyAnswer: saving an answer replaces the entry's sources with the new interview answer, so any earlier citation is
 * gone and the bar's document is added fresh. On a paired card each side is saved on its own, so "SU" cites only the SU
 * side, "RU" only the RU side and "Both" each of them.
 */
export function autoCiteAnswer(project: Project, inst: QuestionInstance, actor: Actor): CiteResult {
  const bar = answeringFrom(project);
  if (!bar || !barAppliesTo(bar, inst.side)) return { project, cited: [], skipped: [] };
  const loc = cleanLocation(bar);
  return citeEntries(project, instanceRefs(inst), bar.sourceId, loc, actor);
}

/**
 * Takes back automatic citations, and only those: each listed entry loses that one document (and its place), which puts the
 * source list back exactly as it was before (the citation was appended last). The removal is change-logged like any other
 * detach. An entry whose answer has been replaced since (a newer revision) or that no longer cites the document is skipped,
 * so undo can never remove something a later action put there.
 */
export function undoCitations(project: Project, cited: CitedRef[], actor: Actor): { project: Project; undone: string[] } {
  let cur = project;
  const undone: string[] = [];
  for (const c of cited) {
    const e = getEntry(cur, c.ref);
    if (!e || e.revision !== c.revision || !e.sourceIds.includes(c.sourceId)) continue;
    cur = detachSource(cur, c.ref, c.sourceId, actor).project;
    undone.push(c.ref);
  }
  return { project: cur, undone };
}

// ------------------------------------------------------------------ "Link values..." on the Sources page

export interface LinkCandidate {
  ref: string;
  label: EntryLabel;
  display: string;
  /** Already cites this document. */
  citedHere: boolean;
  /** Cites at least one document (any document). */
  citedToDocument: boolean;
  /** Where this entry cites this document, when it does and a place was recorded. */
  location: string;
}

export interface LinkFilter {
  side?: "all" | "source" | "target";
  sectionId?: string;
  onlyUncited?: boolean;
  text?: string;
}

/** Every asked-about entry with a value, in document order (Link values never lists an entry without a value). */
export function linkCandidates(content: ContentBundle, project: Project, sourceId: string): LinkCandidate[] {
  const eff = effectiveStaged(content, project);
  const active = activeRefs(visibleInstances(eff, project, "paired"));
  const docIds = new Set(project.sources.filter((s) => s.type === "document_reference").map((s) => s.id));
  const out: LinkCandidate[] = [];
  for (const ref of active) {
    const e = getEntry(project, ref);
    if (!e || !hasCitableValue(e)) continue;
    out.push({
      ref,
      label: entryLabel(eff, project, ref),
      display: entryDisplay(eff, project, ref),
      citedHere: e.sourceIds.includes(sourceId),
      citedToDocument: e.sourceIds.some((id) => docIds.has(id)),
      location: locationText(e.sourceLocations?.[sourceId]),
    });
  }
  return out;
}

export function filterLinkCandidates(rows: LinkCandidate[], f: LinkFilter): LinkCandidate[] {
  const text = (f.text ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.side === "source" && r.label.side !== "source") return false;
    if (f.side === "target" && r.label.side !== "target") return false;
    if (f.sectionId && r.label.sectionId !== f.sectionId) return false;
    if (f.onlyUncited && r.citedToDocument) return false;
    if (!text) return true;
    return [r.label.text, r.label.sectionTitle, r.display].join(" ").toLowerCase().includes(text);
  });
}
