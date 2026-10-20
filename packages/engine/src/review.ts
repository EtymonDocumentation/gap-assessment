import { stableStringify, type Actor, type DocumentExport, type DocumentRevision, type Project, type ReviewComment, type RevisionStatus, type TemplateRecord } from "@gap/process-model";
import type { DocModel } from "./document";

/**
 * Revision history and reviewer comments for the generated document.
 *
 * Decisions:
 * - A revision is a record (who, when, why, fingerprint of the content), not an approval. The tool has no
 *   electronic signature, so nothing here says "approved".
 * - The fingerprint covers the document content only. The generation time, the Revision line, the revision
 *   history and the reviewer comments are left out, so issuing a revision or commenting never makes the
 *   document look changed since it was issued.
 * - Revision and comment numbers are never reused: comments are only ever added to, never deleted.
 * - Exports are recorded without a change-log entry, because downloading a file does not change the project.
 */

/** A revision or comment could not be recorded (blank text, unknown comment, wrong state). The message is shown to the user. */
export class ReviewError extends Error {}

/** Every section id buildDocument can produce, in document order. A comment must be anchored to one of these. */
export const DOCUMENT_SECTION_IDS: readonly string[] = [
  "purpose",
  "scope",
  "source-summary",
  "target-summary",
  "differences",
  "gap-table",
  "validation-plan",
  "equipment-qualification",
  "open-items",
  "risk",
  "verification-status",
  "references",
  "approval",
  "source-register",
  "change-log-summary",
  "revision-history",
  "reviewer-comments",
];

/** Sections and meta rows whose content describes the review itself; they are not part of the fingerprint. */
const FINGERPRINT_SKIP_SECTIONS = new Set(["revision-history", "reviewer-comments"]);
const FINGERPRINT_SKIP_META = new Set(["Generated", "Revision"]);

/** FNV-1a 64-bit hash of the text, as 16 hex digits. Adequate for change detection in a PoC; not a security control. */
function fnv1a64(s: string): string {
  const MASK = 0xffffffffffffffffn;
  const PRIME = 0x100000001b3n;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Stable hash of the document content. The same content always gives the same hash. The generation time, the
 * Revision line, the revision history, the reviewer comments and the lists of revisions and comments do not count.
 */
export function documentFingerprint(doc: DocModel): string {
  const canonical = {
    title: doc.title,
    banner: doc.banner,
    status: doc.status,
    meta: doc.meta.filter(([k]) => !FINGERPRINT_SKIP_META.has(k)),
    sections: doc.sections.filter((s) => !FINGERPRINT_SKIP_SECTIONS.has(s.id)),
  };
  return fnv1a64(stableStringify(canonical));
}

/** The latest issued revision (highest number) and whether the document content differs from it. */
export function revisionState(project: Project, doc: DocModel): { latest?: DocumentRevision; changedSinceIssue: boolean } {
  let latest: DocumentRevision | undefined;
  for (const r of project.document.revisions) if (!latest || r.number > latest.number) latest = r;
  if (!latest) return { changedSinceIssue: false };
  return { latest, changedSinceIssue: latest.fingerprint !== documentFingerprint(doc) };
}

const REVISION_STATUS_TEXT: Record<RevisionStatus, string> = { draft: "Draft", issued_for_review: "Issued for review" };

/** "Draft" or "Issued for review". Never "Approved". */
export function revisionStatusLabel(status: RevisionStatus): string {
  return REVISION_STATUS_TEXT[status];
}

/** "C-001" for comment number 1. */
export function commentDisplayId(seq: number): string {
  return `C-${String(seq).padStart(3, "0")}`;
}

// ------------------------------------------------------------------ helpers

function person(actor: Actor, what: string): { by: string; role?: string } {
  const by = actor.name.trim();
  if (!by) throw new ReviewError(`Enter the name of the person ${what}`);
  const role = actor.role?.trim();
  return { by, ...(role ? { role } : {}) };
}

function required(text: string, message: string): string {
  const t = (text ?? "").trim();
  if (!t) throw new ReviewError(message);
  return t;
}

const TEMPLATE_MODES = ["builtin", "their_look", "mapped", "tags"];

function cleanTemplate(t: TemplateRecord): TemplateRecord {
  if (!TEMPLATE_MODES.includes(t.mode)) throw new ReviewError(`Unknown template mode ${String(t.mode)}`);
  const name = required(t.name, "The template needs a name");
  return {
    mode: t.mode,
    name,
    version: String(t.version ?? "").trim(),
    ...(t.sha256 ? { sha256: t.sha256 } : {}),
    ...(t.fileName ? { fileName: t.fileName } : {}),
  };
}

function findComment(project: Project, seq: number): ReviewComment {
  const c = project.document.comments.find((x) => x.seq === seq);
  if (!c) throw new ReviewError(`There is no comment ${commentDisplayId(seq)}`);
  return c;
}

// ------------------------------------------------------------------ revisions

export interface RevisionInput {
  status: RevisionStatus;
  /** What changed, or why this revision is issued. Required. */
  summary: string;
  /** The template chosen on the Document page when the revision is issued, if any. */
  template?: TemplateRecord;
}

/**
 * Records a new revision of the document as it is now. The number is one more than the highest so far.
 * `doc` must be the document built from this same project; its fingerprint is stored with the revision.
 */
export function issueRevision(project: Project, doc: DocModel, input: RevisionInput, actor: Actor): Project {
  if (input.status !== "draft" && input.status !== "issued_for_review") {
    throw new ReviewError("Choose Draft or Issued for review");
  }
  const who = person(actor, "issuing the revision");
  const summary = required(input.summary, "Enter a summary of what changed or why this revision is issued");
  const template = input.template ? cleanTemplate(input.template) : undefined;
  const next = structuredClone(project);
  const number = next.document.revisions.reduce((m, r) => Math.max(m, r.number), 0) + 1;
  const rev: DocumentRevision = {
    number,
    status: input.status,
    summary,
    ...who,
    at: actor.at,
    fingerprint: documentFingerprint(doc),
    ...(template ? { template } : {}),
  };
  next.document.revisions.push(rev);
  next.changeLog.push({
    at: actor.at,
    by: who.by,
    action: "issue_revision",
    path: `document.revision.${number}`,
    detail: `Revision ${number} (${revisionStatusLabel(input.status)}): ${summary}`,
    after: structuredClone(rev),
  });
  return next;
}

// ------------------------------------------------------------------ comments

export interface CommentInput {
  /** A document section id (see DOCUMENT_SECTION_IDS). */
  sectionId: string;
  /** The stable Gap.key of one gap in that section, if the comment is about a single row. */
  gapKey?: string;
  text: string;
}

/** Adds an open comment. The number is one more than the highest so far, so it is never reused. */
export function addComment(project: Project, input: CommentInput, actor: Actor): Project {
  const who = person(actor, "adding the comment");
  if (!DOCUMENT_SECTION_IDS.includes(input.sectionId)) {
    throw new ReviewError(`"${input.sectionId}" is not a section of the document`);
  }
  const text = required(input.text, "Enter the comment");
  const gapKey = input.gapKey?.trim();
  const next = structuredClone(project);
  const seq = next.document.comments.reduce((m, c) => Math.max(m, c.seq), 0) + 1;
  const comment: ReviewComment = {
    seq,
    anchor: { sectionId: input.sectionId, ...(gapKey ? { gapKey } : {}) },
    ...who,
    at: actor.at,
    text,
    status: "open",
    replies: [],
  };
  next.document.comments.push(comment);
  next.changeLog.push({
    at: actor.at,
    by: who.by,
    action: "add_comment",
    path: `document.comment.${seq}`,
    detail: `${commentDisplayId(seq)}: ${text}`,
    after: structuredClone(comment),
  });
  return next;
}

/** Applies a reply, resolution or reopening to one comment and logs it. */
function respond(project: Project, seq: number, kind: "reply" | "resolution" | "reopen", text: string, actor: Actor, action: string): Project {
  const c = findComment(project, seq);
  const id = commentDisplayId(seq);
  if (kind === "resolution" && c.status === "resolved") throw new ReviewError(`${id} is already resolved`);
  if (kind === "reopen" && c.status === "open") throw new ReviewError(`${id} is already open`);
  const who = person(actor, kind === "reply" ? "replying" : kind === "resolution" ? "resolving the comment" : "reopening the comment");
  const body = required(
    text,
    kind === "reply" ? "Enter your reply" : kind === "resolution" ? "Enter how the comment was resolved" : "Enter the reason for reopening the comment",
  );
  const next = structuredClone(project);
  const target = next.document.comments.find((x) => x.seq === seq)!;
  const reply = { kind, ...who, at: actor.at, text: body };
  target.replies.push(reply);
  if (kind === "resolution") target.status = "resolved";
  if (kind === "reopen") target.status = "open";
  const detail = kind === "reply" ? `${id}: ${body}` : kind === "resolution" ? `${id} resolved: ${body}` : `${id} reopened: ${body}`;
  next.changeLog.push({
    at: actor.at,
    by: who.by,
    action,
    path: `document.comment.${seq}`,
    detail,
    before: { status: c.status },
    after: { status: target.status, reply: structuredClone(reply) },
  });
  return next;
}

/** Adds a reply to a comment (open or resolved) without changing its status. */
export function replyToComment(project: Project, seq: number, text: string, actor: Actor): Project {
  return respond(project, seq, "reply", text, actor, "reply_comment");
}

/** Resolves an open comment. A written resolution is required and is kept with the comment. */
export function resolveComment(project: Project, seq: number, resolution: string, actor: Actor): Project {
  return respond(project, seq, "resolution", resolution, actor, "resolve_comment");
}

/** Reopens a resolved comment. A reason is required and is kept with the comment. */
export function reopenComment(project: Project, seq: number, reason: string, actor: Actor): Project {
  return respond(project, seq, "reopen", reason, actor, "reopen_comment");
}

// ------------------------------------------------------------------ exports

/** Appends an export record. No change-log entry: downloading the document does not change the project. */
export function recordExport(project: Project, record: DocumentExport): Project {
  if (record.format !== "markdown" && record.format !== "html" && record.format !== "docx") {
    throw new ReviewError(`Unknown export format ${String(record.format)}`);
  }
  if (!record.fingerprint) throw new ReviewError("An export record needs the document fingerprint");
  const next = structuredClone(project);
  next.document.exports.push({ ...structuredClone(record), template: cleanTemplate(record.template) });
  return next;
}
