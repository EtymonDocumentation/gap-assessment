import { contentPathOf, parseRef, resolveEntry, type Project, type Source } from "@gap/process-model";
import { boundPaths, fieldLabel, type ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { sidesOf } from "./sequencer";
import { formatResolved, questionLabel } from "./format";

/** Human-readable description of an entry reference: side, section and attribute. */
export interface EntryLabel {
  ref: string;
  side: "source" | "target" | "shared";
  sideText: "Source" | "Target" | "Scoping";
  sectionId?: string;
  sectionTitle: string;
  /** Question label, plus the field for parameter entries ("Mixing speed: Set point"). */
  attribute: string;
  /** "Source: Compounding: Mixing speed: Set point". */
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

const SIDE_TEXT ={ source: "Source", target: "Target", shared: "Scoping" } as const;

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

/** Short name of a source for tables: the document identifier, or "Interview (responder, date)". */
export function sourceShort(s: Source): string {
  if (s.type === "document_reference" && s.docRef) return s.docRef.identifier;
  if (s.type === "interview_answer") return `Interview (${s.responder?.name ?? "unknown responder"}, ${shortDate(s.date)})`;
  if (s.type === "imported_file") return `Imported file ${s.file?.name ?? ""}`.trim();
  return s.label;
}
