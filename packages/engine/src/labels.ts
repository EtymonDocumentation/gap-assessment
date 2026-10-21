import { contentPathOf, getEntry, parseRef, resolveEntry, type Entry, type Project, type Source, type SourceLocation } from "@gap/process-model";
import { boundPaths, fieldLabel, type ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { sidesOf } from "./sequencer";
import { formatResolved, questionLabel } from "./format";

/** Human-readable description of an entry reference: side, section and attribute. */
export interface EntryLabel {
  ref: string;
  side: "source" | "target" | "shared";
  sideText: "SU" | "RU" | "Scoping";
  sectionId?: string;
  sectionTitle: string;
  /** Question label, plus the field for parameter entries ("Mixing speed: Set point"). */
  attribute: string;
  /** "SU: Compounding: Mixing speed: Set point". */
  text: string;
  question?: Question;
  /** The field name of the entry (for option-set formatting of parameter fields). */
  field?: string;
}

interface Hit {
  q: Question;
  field?: string;
}

const index = new WeakMap<ContentBundle, Map<string, Hit>>();

function hits(content: ContentBundle): Map<string, Hit> {
  let m = index.get(content);
  if (m) return m;
  m = new Map();
  for (const q of content.questions) {
    for (const side of sidesOf(q)) {
      for (const p of boundPaths(q, side)) {
        const hit: Hit = { q };
        if (q.input.type === "parameter") hit.field = p.slice(q.binds.length + 1);
        if (!m.has(p)) m.set(p, hit);
      }
    }
  }
  index.set(content, m);
  return m;
}

const FIELD_OPTION_SET: Record<string, string> = { classification: "classification", rangeBasis: "rangeBasis" };

/** The value of an entry as shown to people (with option labels and units), for any reference. */
export function entryDisplay(content: ContentBundle, project: Project, ref: string): string {
  const l = entryLabel(content, project, ref);
  const r = resolveEntry(project, ref);
  const optionSet = l.question?.input.type === "parameter" && l.field ? FIELD_OPTION_SET[l.field] : undefined;
  return formatResolved(content, l.question, r, optionSet);
}

/** The user-facing name of a side: "SU" (sending unit), "RU" (receiving unit) or "Scoping". Stored keys stay source, target and shared. */
export function sideName(side: string): string {
  return side === "source" ? "SU" : side === "target" ? "RU" : side === "shared" ? "Scoping" : side;
}

const SIDE_TEXT = { source: "SU", target: "RU", shared: "Scoping" } as const;

/** Describes a reference in words. Works for entries that no longer have a visible question (inactive values). */
export function entryLabel(content: ContentBundle, project: Project, ref: string): EntryLabel {
  const p = parseRef(ref);
  const side = p.side;
  const hit = hits(content).get(contentPathOf(ref));
  let sectionId: string | undefined;
  let sectionTitle = side === "shared" ? "Scoping" : "";
  let attribute = "";
  if (hit) {
    sectionId = hit.q.section;
    sectionTitle = content.sectionById.get(hit.q.section)?.title ?? sectionTitle;
    attribute = hit.field ? `${questionLabel(hit.q)}: ${fieldLabel(content, hit.field)}` : questionLabel(hit.q);
  } else if (p.side !== "shared") {
    if (p.kind === "site") {
      sectionTitle = "Site and facility";
      attribute = fieldLabel(content, p.field);
    } else {
      const uo = project.processes[p.side].unitOperations[p.uo];
      sectionTitle = uo?.label ?? p.uo;
      sectionId = content.sections.find((s) => s.kind === "uo" && s.uo === p.uo)?.id;
      if (p.kind === "uo") attribute = fieldLabel(content, p.field);
      else attribute = `${uo?.collections[p.coll][p.item]?.label ?? p.item}: ${fieldLabel(content, p.field)}`;
    }
  } else attribute = p.key;
  const field = p.side === "shared" ? p.key : p.field;
  const label: EntryLabel = {
    ref,
    side,
    sideText: SIDE_TEXT[side],
    sectionTitle,
    attribute,
    // Shared (scoping) entries: the side text already reads "Scoping", so the section title is not repeated.
    text: `${SIDE_TEXT[side]}: ${sectionTitle && sectionTitle !== SIDE_TEXT[side] ? `${sectionTitle}: ` : ""}${attribute}`,
    field,
  };
  if (sectionId) label.sectionId = sectionId;
  if (hit) label.question = hit.q;
  return label;
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Text of a stored label or log entry as people read it: an older record may carry the side tags "[source]" and "[target]"; they are shown as
 * "[SU]" and "[RU]". Display only: the stored text is never changed.
 */
export function displaySideTags(text: string): string {
  return text.replace(/\[source\]/g, "[SU]").replace(/\[target\]/g, "[RU]");
}

/** The label of a stored source as shown to people (see displaySideTags). */
export function sourceLabel(s: Pick<Source, "label">): string {
  return displaySideTags(s.label);
}

/** "IDENTIFIER — Title": a dash, not brackets, because the title may itself contain parentheses. */
export function idWithTitle(id: string, title?: string): string {
  return title ? `${id} — ${title}` : id;
}

/** Short name of a source for tables: the document identifier with its title, or "Interview (responder, date)". */
export function sourceShort(s: Source): string {
  if (s.type === "document_reference" && s.docRef) return idWithTitle(s.docRef.identifier, s.docRef.title);
  if (s.type === "interview_answer") return `Interview (${s.responder?.name ?? "unknown responder"}, ${shortDate(s.date)})`;
  if (s.type === "imported_file") return `Imported file ${s.file?.name ?? ""}`.trim();
  return sourceLabel(s);
}

/**
 * The sources to show next to a value: documents first. When at least one document reference backs the value, only the
 * document references are shown; "Interview (name, date)" and the other kinds are shown only when no document backs it.
 * This is a display rule only. The sources stay attached to the entry and are all listed in the source register.
 */
export function displaySources(sources: Source[]): Source[] {
  const docs = sources.filter((s) => s.type === "document_reference" && s.docRef);
  return docs.length ? docs : sources;
}

/**
 * Where inside a cited document a value is found, as people write it: "§4.2 p.12". A part that already starts with the
 * symbol or the abbreviation is not doubled. Empty text when no location was recorded (nothing is ever invented).
 */
export function locationText(loc: SourceLocation | undefined): string {
  if (!loc) return "";
  const section = loc.section?.trim();
  const page = loc.page?.trim();
  const parts: string[] = [];
  if (section) parts.push(section.startsWith("§") ? section : `§${section}`);
  if (page) parts.push(/^p{1,2}\.?\s*\d/i.test(page) ? page : `p.${page}`);
  return parts.join(" ");
}

/** "DOC-1 — Title §4.2 p.12": the short name of a source followed by the location of this particular citation. */
export function sourceWithLocation(s: Source, loc: SourceLocation | undefined): string {
  const l = locationText(loc);
  return l ? `${sourceShort(s)} ${l}` : sourceShort(s);
}

/** The location of one entry's citation of a source, if one was recorded. */
export function entryLocation(e: Entry | undefined, sourceId: string): SourceLocation | undefined {
  return e?.sourceLocations?.[sourceId];
}

/**
 * Sources to show for the entries behind one table cell, each followed by its location ("<doc> §4.2 p.12"). The same
 * document cited at two different places by two entries of the cell is listed twice, once per place.
 */
export function citationNames(project: Project, refs: string[]): string[] {
  // A reference that is not an entry path (hand-made input) simply has no citations.
  const entries = refs.map((r) => { try { return getEntry(project, r); } catch { return undefined; } }).filter((e): e is Entry => !!e);
  const ids = new Set(entries.flatMap((e) => e.sourceIds));
  const shown = displaySources(project.sources.filter((s) => ids.has(s.id)));
  const out: string[] = [];
  for (const s of shown) {
    for (const e of entries) if (e.sourceIds.includes(s.id)) out.push(sourceWithLocation(s, entryLocation(e, s.id)));
  }
  return [...new Set(out)];
}

/** The short names of the sources to show for a value (see displaySources), without duplicates. */
export function displaySourceNames(sources: Source[]): string[] {
  return [...new Set(displaySources(sources).map(sourceShort))];
}
