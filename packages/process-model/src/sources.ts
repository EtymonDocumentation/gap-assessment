import { newId } from "./entries";
import type { Actor, DocRef, Project, Source } from "./types";

/** A source could not be added or edited (blank text, duplicate, wrong type). The message is shown to the user. */
export class SourceError extends Error {}

export type NewSource =
  /** A controlled document that supports entries (e.g. a PPQ report). */
  | { type: "document_reference"; docRef: DocRef }
  /** A free-text note recorded by the user. */
  | { type: "user_entry"; label: string };

const tidy = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Identity of a document reference: type, identifier and version, ignoring case and spacing. */
export function docRefKey(d: DocRef): string {
  return [d.docType, d.identifier, d.version ?? ""].map((x) => tidy(x).toLowerCase()).join("|");
}

/** Label shown for a document-reference source. */
export function docRefLabel(d: DocRef): string {
  return d.title ? `${d.identifier} ${d.title}` : d.identifier;
}

function cleanDocRef(d: DocRef): DocRef {
  const docType = tidy(d.docType);
  const identifier = tidy(d.identifier);
  if (!identifier) throw new SourceError("Enter the document identifier");
  if (!docType) throw new SourceError("Enter the document type");
  const title = tidy(d.title);
  const version = tidy(d.version);
  return { docType, identifier, ...(title ? { title } : {}), ...(version ? { version } : {}) };
}

function duplicateOf(project: Project, d: DocRef, exceptId?: string): Source | undefined {
  const key = docRefKey(d);
  return project.sources.find((s) => s.id !== exceptId && s.type === "document_reference" && s.docRef && docRefKey(s.docRef) === key);
}

function dupMessage(s: Source): string {
  return `A document reference with the same type, identifier and version already exists (${s.label}). Attach that source instead.`;
}

function responderOf(actor: Actor): Source["responder"] {
  if (!actor.name.trim()) throw new SourceError("Set the responder name first");
  return { name: actor.name.trim(), ...(actor.role?.trim() ? { role: actor.role.trim() } : {}) };
}

/** Adds a document-reference or note source to the register. The actor becomes its responder. */
export function addSource(project: Project, input: NewSource, actor: Actor): { project: Project; source: Source } {
  const responder = responderOf(actor);
  const next = structuredClone(project);
  let source: Source;
  if (input.type === "document_reference") {
    const docRef = cleanDocRef(input.docRef);
    const dup = duplicateOf(project, docRef);
    if (dup) throw new SourceError(dupMessage(dup));
    source = { id: newId("src"), type: "document_reference", label: docRefLabel(docRef), responder, date: actor.at, docRef };
  } else {
    const label = tidy(input.label);
    if (!label) throw new SourceError("Enter the note text");
    if (project.sources.some((s) => s.type === "user_entry" && tidy(s.label).toLowerCase() === label.toLowerCase())) {
      throw new SourceError("A note with the same text already exists. Attach that source instead.");
    }
    source = { id: newId("src"), type: "user_entry", label, responder, date: actor.at };
  }
  next.sources.push(source);
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "add_source",
    detail: `${source.type}: ${source.label}`,
    after: structuredClone(source),
  });
  return { project: next, source };
}

export interface SourcePatch {
  /** New label. For a document reference, leaving it out keeps the label in step with identifier and title. */
  label?: string;
  docType?: string;
  identifier?: string;
  /** An empty string removes the title. */
  title?: string;
  /** An empty string removes the version. */
  version?: string;
}

/**
 * Edits the label and document metadata of a source.
 * Decision: this does NOT withdraw verification. Verification is judged on the recorded value and status, and
 * correcting a document title or version does not change either. The edit is logged with before and after.
 * Interview-answer sources cannot be edited because they record what was said in the interview.
 */
export function updateSource(project: Project, sourceId: string, patch: SourcePatch, actor: Actor): Project {
  const cur = project.sources.find((s) => s.id === sourceId);
  if (!cur) throw new SourceError(`Unknown source ${sourceId}`);
  if (cur.type !== "document_reference" && cur.type !== "user_entry") {
    throw new SourceError("Only document references and notes can be edited");
  }
  const next = structuredClone(project);
  const s = next.sources.find((x) => x.id === sourceId)!;
  const before = { label: cur.label, ...(cur.docRef ? { docRef: structuredClone(cur.docRef) } : {}) };
  if (cur.type === "document_reference") {
    const d = cur.docRef!;
    const docRef = cleanDocRef({
      docType: patch.docType ?? d.docType,
      identifier: patch.identifier ?? d.identifier,
      title: patch.title ?? d.title,
      version: patch.version ?? d.version,
    });
    const dup = duplicateOf(project, docRef, sourceId);
    if (dup) throw new SourceError(dupMessage(dup));
    s.docRef = docRef;
    if (patch.label !== undefined) {
      const label = tidy(patch.label);
      if (!label) throw new SourceError("Enter a label");
      s.label = label;
    } else s.label = docRefLabel(docRef);
  } else {
    if (patch.label === undefined) throw new SourceError("Enter the note text");
    const label = tidy(patch.label);
    if (!label) throw new SourceError("Enter the note text");
    s.label = label;
  }
  const after = { label: s.label, ...(s.docRef ? { docRef: structuredClone(s.docRef) } : {}) };
  if (JSON.stringify(before) === JSON.stringify(after)) throw new SourceError("Nothing was changed");
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "update_source",
    path: sourceId,
    detail: `${s.type}: ${s.label}`,
    before,
    after,
  });
  return next;
}
