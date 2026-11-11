import { containsSeq, sameSeq, toks } from "./import-shared";
import { TRD_FRONT_UNIT, type TrdUnitInfo } from "./trd-units";

/*
 * Matching the TRD to the headings of a person's own Word template (M15, job 2).
 *
 * The person's template has headings ("3 Process Description", "4 Equipment"); Cascade's TRD has pieces of content (its units, see
 * trd-units.ts). The match says which pieces go under which heading, and for a heading with content whether the template's own text under
 * it is replaced or kept. Everything here is plain data in, plain data out, so the screen, the Word download and the tests share it.
 *
 * Rules kept here (see the spec):
 *  - A suggestion is only a suggestion. It is never stored, and never used for a Word file, until a person confirms it.
 *  - Nothing is picked for the person: the "replace or keep" pick has no default, and a heading with content and no pick is not savable.
 *  - A placement is by stable unit id and by the heading's text as well as its position, so a template that changed later is re-matched by
 *    its words, and a heading that no longer fits is listed to be matched again instead of receiving content by accident.
 *  - Placements for content the open TRD does not have are kept when saving (another TRD may have it).
 */

/** The part of a template heading the match needs (a structural copy of the Word package's own outline entry). */
export interface MatchHeading {
  index: number;
  level: number;
  text: string;
  number?: string;
  /** True when the template has text, a table or a picture of its own under the heading. */
  hasBody: boolean;
}

export const TRD_HEADING_PICKS = ["replace", "keep"] as const;
export type TrdHeadingPick = (typeof TRD_HEADING_PICKS)[number];

/** One heading of the template and the TRD content placed under it, in the order the person chose. */
export interface TrdPlacement {
  headingIndex: number;
  /** The heading's words when the match was saved: how a changed template is re-matched. */
  headingText: string;
  /** Unit ids, in order. Never section numbers. */
  units: string[];
  /** What happens to the template's own text under the heading: "replace" it or "keep" it above Cascade's content. */
  existing: TrdHeadingPick;
}

/** The match kept with a template (`trdMapping` on the template record). Headings with no content are not stored. */
export interface TrdMapping {
  headings: TrdPlacement[];
  /** The template version the match was saved against: a different version is re-matched by heading text. */
  templateVersion?: string;
}

/** A suggestion for one heading. Not stored: a person confirms it first. */
export interface TrdSuggestion {
  headingIndex: number;
  headingText: string;
  units: string[];
}

// ------------------------------------------------------------------ suggestions

/**
 * Words a template may use for each piece of TRD content. A suggestion only: the person confirms it. The first words of an entry are the
 * plainest name. Single common words are avoided where they would pull a piece under the wrong heading ("buffer" alone is also "dilution
 * buffer"). Process descriptions are keyed by the library entry they came from.
 */
const SYNONYMS: Record<string, string[]> = {
  front: ["document details", "document information", "document control", "general information", "document properties"],
  "purpose-scope": ["purpose and scope", "purpose scope", "objective and scope", "scope and purpose"],
  product: ["about this document", "about the document"],
  overview: ["process overview", "overview of the process", "process steps"],
  "process-parameters": ["process steps and parameters", "process parameters", "operating parameters", "critical process parameters", "parameters"],
  "open-items": ["open items", "outstanding items", "open points", "open issues", "outstanding information", "items still open"],
  approval: ["approval", "approvals", "sign off", "signoff", "signatures", "authorisation", "authorization", "review and approval"],
  references: ["references", "reference documents", "referenced documents", "source documents"],
  overrides: ["overrides", "deviations from the project", "changes to project values"],
  "manufacturing-overview": ["manufacturing process overview", "manufacturing process", "process description", "process overview", "description of the process"],
  "writeup-acronyms": ["acronyms", "abbreviations", "glossary", "definitions and abbreviations", "abbreviations and acronyms"],
  "writeup-introduction": ["introduction", "background", "general"],
  "writeup-purpose": ["purpose", "objective", "objectives", "aim"],
  "writeup-scope": ["scope", "applicability", "scope of this document"],
  "writeup-batch_size": ["batch size", "batch sizes", "batch size and yield"],
  "writeup-general_attributes": ["general attributes", "product attributes", "drug substance general attributes", "drug substance and bulk placebo"],
  "writeup-formulation_precautions": ["formulation and manufacturing precautions", "manufacturing precautions", "formulation precautions", "precautions"],
  "writeup-dilution_buffer": ["dilution buffer", "buffer for dilution"],
  "writeup-process_parameters": ["overall process parameters", "process parameters", "operating parameters", "critical process parameters"],
  "writeup-contact_surfaces": ["product contact surfaces", "approved product contact surfaces", "contact surfaces", "materials of construction"],
  "writeup-container_closure": ["primary container closure", "container closure", "container closure system", "primary packaging"],
  "writeup-filling_technology": ["filling technology", "filling technology recommendation", "filling method"],
  "writeup-fill_weights": ["fill weights", "fill weight", "fill volume", "fill volumes"],
  "writeup-stopper_position": ["stopper position", "stopper placement"],
  "writeup-sampling_plan": ["sampling plan", "sampling", "sampling strategy"],
  "writeup-open_manipulations": ["open bottle manipulations", "open manipulations", "open handling"],
  "writeup-rtu_components": ["ready to fill syringe and stopper", "ready to use components", "rtu components", "syringe and stopper production"],
  "writeup-aseptic_environment": ["aseptic processing environment", "aseptic environment", "cleanroom environment"],
  "writeup-total_time_out_of_refrigeration": ["total time out of refrigeration", "time out of refrigeration", "tor"],
  "writeup-tacit_knowledge": ["tacit knowledge", "know how", "lessons learned"],
  "writeup-process_history": ["process history", "development history", "history of the process", "process development history"],
  "overview:wu_ds_shipping_inbound": ["drug substance shipping", "shipping of drug substance", "inbound shipping", "shipping"],
  "overview:wu_ds_receipt_thaw": ["receipt and storage", "receipt and thawing", "thawing", "drug substance receipt", "receipt storage and thawing"],
  "overview:wu_buffer_prep": ["buffer preparation", "preparation of buffer", "buffer prep"],
  "overview:wu_compounding": ["pooling compounding and dilution", "compounding", "pooling and dilution", "dilution and compounding"],
  "overview:wu_bbr_filtration": ["bioburden reduction filtration", "bioburden reduction", "pre filtration", "prefiltration"],
  "overview:wu_sterile_filtration": ["sterile filtration", "sterilising filtration", "sterilizing filtration", "final filtration"],
  "overview:wu_aseptic_filling": ["filling and stoppering", "aseptic filling", "filling stoppering and stopper insertion", "filling"],
  "overview:wu_aseptic_filling_stopper_placement": ["plunger stopper placement", "stopper placement in cartridges", "plunger placement"],
};

/** The leading numbers of a heading's words ("3 1 purpose" -> "purpose") are not part of its name. */
const nameTokens = (s: string): string[] => {
  const t = toks(s);
  while (t.length > 1 && /^\d+$/.test(t[0]!)) t.shift();
  return t;
};

/** How well one phrase fits one heading: 3 the same words, 2 the heading holds a phrase of two or more words, 1 a single word or a heading inside the phrase. */
function fit(heading: readonly string[], phrase: readonly string[]): number {
  if (!heading.length || !phrase.length) return 0;
  if (sameSeq(heading, phrase)) return 3;
  if (containsSeq(heading, phrase)) return phrase.length >= 2 ? 2 : 1;
  if (heading.length >= 2 && containsSeq(phrase, heading)) return 1;
  return 0;
}

/** The unit of the manufacturing process overview (its introduction); the process-step descriptions are units of their own, "overview:<step>". */
const PROCESS_OVERVIEW_UNIT = "manufacturing-overview";
const isStepDescription = (u: TrdUnitInfo): boolean => u.id.startsWith("overview:");

/** The words a unit may be called: the table, its own title without a bracketed part, and any names the TRD itself gives it (its step names). */
function phrasesOf(u: TrdUnitInfo, hints: Record<string, readonly string[]>): string[][] {
  const own = u.title.replace(/\([^)]*\)/g, " ");
  return [...(SYNONYMS[u.id] ?? []), own, ...(hints[u.id] ?? [])].map(nameTokens).filter((p) => p.length > 0);
}

/**
 * Suggested places for the pieces of the TRD, from the words of the template's headings. Each piece goes to the heading it fits best (the
 * first one in document order when two fit equally), and a heading may receive several pieces. Headings that fit nothing get no entry.
 * `hints` are other names of a piece (a process step's own name and the catalog's), by unit id.
 */
export function suggestTrdMatch(headings: readonly MatchHeading[], units: readonly TrdUnitInfo[], hints: Record<string, readonly string[]> = {}): TrdSuggestion[] {
  const names = headings.map((h) => nameTokens(h.text));
  const best = new Map<number, string[]>();
  const stepsWithoutHeading: string[] = [];
  for (const u of units) {
    const phrases = phrasesOf(u, hints);
    let top = 0;
    let at = -1;
    headings.forEach((h, i) => {
      const score = Math.max(0, ...phrases.map((p) => fit(names[i]!, p)));
      if (score > top) {
        top = score;
        at = h.index;
      }
    });
    if (at >= 0) best.set(at, [...(best.get(at) ?? []), u.id]);
    else if (isStepDescription(u)) stepsWithoutHeading.push(u.id);
  }
  // Process-step descriptions follow the process overview: a template usually has ONE heading for the whole process ("Process description"), and
  // the person should not have to place about twenty steps one by one. A step whose own name fits another heading was placed there above.
  const overviewAt = [...best].find(([, ids]) => ids.includes(PROCESS_OVERVIEW_UNIT))?.[0];
  if (overviewAt !== undefined && stepsWithoutHeading.length) {
    // Process order: the TRD lists the overview first and then its steps; other pieces that fit this heading keep their place among them.
    const ids = new Set([...best.get(overviewAt)!, ...stepsWithoutHeading]);
    best.set(overviewAt, units.map((u) => u.id).filter((id) => ids.has(id)));
  }
  return headings.filter((h) => best.has(h.index)).map((h) => ({ headingIndex: h.index, headingText: h.text, units: best.get(h.index)! }));
}

// ------------------------------------------------------------------ a changed template

/** The heading words as compared when a template changed: case, spacing and punctuation do not count. */
export const headingKey = (text: string): string => nameTokens(text).join(" ");

export interface Rematched {
  /** The stored match fitted to the template as it is now. */
  mapping: TrdMapping;
  /** Placements whose heading is no longer in the template: listed for the person to match again. Their content is not placed meanwhile. */
  again: TrdPlacement[];
}

/**
 * Fits a stored match to the headings the template has now. A heading keeps its content when it is still at the same place with the same
 * words; otherwise it is found again by its words (the first heading with those words that is not taken); a heading that is gone is
 * listed in `again`. A template that did not change comes back unchanged.
 */
export function rematchTrdMapping(headings: readonly MatchHeading[], stored: TrdMapping | undefined): Rematched {
  if (!stored) return { mapping: { headings: [] }, again: [] };
  const taken = new Set<number>();
  const found = new Map<TrdPlacement, number>();
  for (const e of stored.headings) {
    const h = headings.find((x) => x.index === e.headingIndex);
    if (h && headingKey(h.text) === headingKey(e.headingText) && !taken.has(h.index)) {
      taken.add(h.index);
      found.set(e, h.index);
    }
  }
  for (const e of stored.headings) {
    if (found.has(e)) continue;
    const h = headings.find((x) => !taken.has(x.index) && headingKey(x.text) === headingKey(e.headingText));
    if (h) {
      taken.add(h.index);
      found.set(e, h.index);
    }
  }
  const out: TrdPlacement[] = [];
  const again: TrdPlacement[] = [];
  for (const e of stored.headings) {
    const index = found.get(e);
    if (index === undefined) again.push(e);
    else out.push({ ...e, headingIndex: index, headingText: headings.find((x) => x.index === index)!.text, units: [...e.units] });
  }
  out.sort((a, b) => a.headingIndex - b.headingIndex);
  return { mapping: { headings: out, ...(stored.templateVersion ? { templateVersion: stored.templateVersion } : {}) }, again };
}

// ------------------------------------------------------------------ the screen's working copy

/** One heading as the match screen holds it before saving. `existing` stays unset until the person picks. */
export interface TrdDraftRow {
  headingIndex: number;
  headingText: string;
  units: string[];
  existing?: TrdHeadingPick;
}

/** The draft of a saved match: a row for every heading, content as saved, picks as saved. */
export function draftFromMapping(headings: readonly MatchHeading[], mapping: TrdMapping | undefined, known?: ReadonlySet<string>): TrdDraftRow[] {
  const byIndex = new Map((mapping?.headings ?? []).map((e) => [e.headingIndex, e]));
  return headings.map((h) => {
    const e = byIndex.get(h.index);
    const units = e ? e.units.filter((u) => !known || known.has(u)) : [];
    return { headingIndex: h.index, headingText: h.text, units, ...(e && units.length ? { existing: e.existing } : {}) };
  });
}

/** Suggestions as draft rows. A suggested heading has content and no pick yet. */
export function draftFromSuggestions(headings: readonly MatchHeading[], suggestions: readonly TrdSuggestion[]): TrdDraftRow[] {
  const by = new Map(suggestions.map((s) => [s.headingIndex, s]));
  return headings.map((h) => ({ headingIndex: h.index, headingText: h.text, units: [...(by.get(h.index)?.units ?? [])] }));
}

/** The headings (by their words) that have content and no pick: saving is held back until each has one. */
export function draftMissingPicks(rows: readonly TrdDraftRow[]): string[] {
  return rows.filter((r) => r.units.length > 0 && !r.existing).map((r) => r.headingText);
}

/**
 * The match to store, from the screen's draft. Placements for content the open TRD does not have (`known` is what it has) are kept as they
 * were stored, at their heading, after the new content: another TRD may have that content, and saving from this one must not lose it. Only
 * rows with a pick are stored, so call `draftMissingPicks` first.
 */
export function mappingFromDraft(rows: readonly TrdDraftRow[], stored: TrdMapping | undefined, known: ReadonlySet<string> | undefined, templateVersion?: string): TrdMapping {
  const keptOf = new Map<number, TrdPlacement>();
  const placedNow = new Set(rows.flatMap((r) => r.units));
  if (known) for (const e of stored?.headings ?? []) keptOf.set(e.headingIndex, e);
  const headings: TrdPlacement[] = [];
  for (const r of rows) {
    const old = keptOf.get(r.headingIndex);
    const foreign = old ? old.units.filter((u) => known && !known.has(u) && !placedNow.has(u)) : [];
    const units = [...r.units, ...foreign];
    if (!units.length) continue;
    const existing = r.units.length ? r.existing : old?.existing;
    if (!existing) continue;
    headings.push({ headingIndex: r.headingIndex, headingText: r.headingText, units, existing });
  }
  return { headings, ...(templateVersion ? { templateVersion } : {}) };
}

// ------------------------------------------------------------------ the count line

export interface TrdMatchCounts {
  headings: number;
  /** Headings with Cascade content under them. */
  withContent: number;
  /** Headings with none: shown as such, and written or kept text goes there, else "[To be completed.]". */
  withoutContent: number;
  /** Pieces of the TRD placed under a heading. */
  placed: number;
  /** Pieces the template has no heading for, in document order. */
  notInTemplate: TrdUnitInfo[];
}

export function trdMatchCounts(headings: readonly MatchHeading[], rows: readonly { headingIndex: number; units: readonly string[] }[], units: readonly TrdUnitInfo[]): TrdMatchCounts {
  const byIndex = new Map(rows.map((r) => [r.headingIndex, r]));
  const withContent = headings.filter((h) => (byIndex.get(h.index)?.units.length ?? 0) > 0).length;
  const used = new Set(rows.flatMap((r) => r.units));
  return {
    headings: headings.length,
    withContent,
    withoutContent: headings.length - withContent,
    placed: units.filter((u) => used.has(u.id) && u.id !== TRD_FRONT_UNIT).length,
    // The title block is not counted: a template has its own cover and title, so "not placed" is the normal case and not a gap.
    notInTemplate: units.filter((u) => !used.has(u.id) && u.id !== TRD_FRONT_UNIT),
  };
}

/** The count line on top of the match screen, in plain words. */
export function trdMatchCountLine(c: TrdMatchCounts): string {
  const h = (n: number) => `${n} heading${n === 1 ? "" : "s"}`;
  const s = (n: number) => `${n} section${n === 1 ? "" : "s"}`;
  return `Your template has ${h(c.headings)}. Cascade content is placed under ${c.withContent} of them. ${s(c.notInTemplate.length)} not in your template yet.`;
}

// ------------------------------------------------------------------ text written under a heading

/** Text written under a template heading, as the TRD keeps it. */
export interface HeadingTextLike {
  headingIndex: number;
  headingText: string;
  text: string;
}

/**
 * The written text for each heading of the template as it is now: found where the heading is with the same words, else by its words alone.
 * Text whose heading is gone is returned apart (the person matches it again; it is never moved to another heading).
 */
export function resolveHeadingTexts<T extends HeadingTextLike>(headings: readonly MatchHeading[], texts: readonly T[] | undefined): { byIndex: Map<number, T>; again: T[] } {
  const byIndex = new Map<number, T>();
  const rest: T[] = [];
  for (const t of texts ?? []) {
    const h = headings.find((x) => x.index === t.headingIndex);
    if (h && headingKey(h.text) === headingKey(t.headingText) && !byIndex.has(h.index)) byIndex.set(h.index, t);
    else rest.push(t);
  }
  const again: T[] = [];
  for (const t of rest) {
    const h = headings.find((x) => !byIndex.has(x.index) && headingKey(x.text) === headingKey(t.headingText));
    if (h) byIndex.set(h.index, t);
    else again.push(t);
  }
  return { byIndex, again };
}

/**
 * The pieces of the TRD that will NOT be in the Word file: no heading of the template holds them and they were not added back. The Document
 * page says how many, so a section is never missing without the person being told. `mapping` is the match as it fits the template now.
 */
export function trdLeftOut(units: readonly TrdUnitInfo[], mapping: TrdMapping | undefined, addedBack: readonly string[] = []): TrdUnitInfo[] {
  const placed = new Set((mapping?.headings ?? []).flatMap((h) => h.units));
  const back = new Set(addedBack);
  return units.filter((u) => u.id !== TRD_FRONT_UNIT && !placed.has(u.id) && !back.has(u.id));
}

/**
 * Reads a stored match from data of unknown origin (an imported template file). A placement that is not whole (no heading words, no unit
 * list, no replace-or-keep pick) is dropped rather than guessed at; nothing is filled in. Returns nothing when no placement is left.
 */
export function parseTrdMapping(raw: unknown): TrdMapping | undefined {
  const o = raw as { headings?: unknown; templateVersion?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.headings)) return undefined;
  const headings: TrdPlacement[] = [];
  for (const e of o.headings as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") continue;
    const units = Array.isArray(e.units) ? e.units.filter((u): u is string => typeof u === "string" && u.length > 0) : [];
    if (typeof e.headingIndex !== "number" || !Number.isInteger(e.headingIndex) || e.headingIndex < 0) continue;
    if (typeof e.headingText !== "string" || !e.headingText.trim() || !units.length) continue;
    if (e.existing !== "replace" && e.existing !== "keep") continue;
    headings.push({ headingIndex: e.headingIndex, headingText: e.headingText, units, existing: e.existing });
  }
  if (!headings.length) return undefined;
  return { headings, ...(typeof o.templateVersion === "string" && o.templateVersion ? { templateVersion: o.templateVersion } : {}) };
}
