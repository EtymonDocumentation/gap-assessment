/**
 * Shared process data model.
 *
 * This package is deliberately free of gap-assessment logic so that the
 * future TRD and MBR generators can read the same ProcessModel, Entry and
 * Source structures without restructuring.
 */

export type Side = "source" | "target";

/** Every attribute value lives in an Entry; there are no bare values in the model. */
export type EntryStatus =
  /** A value exists and is supported by at least one live source. */
  | "established"
  /**
   * To be determined (schema 1.7.0): the one "not known yet" answer. Becomes an open information item. Every detail is
   * optional: with none it is exactly what the retired "Unknown" answer was (schema 1.9.0 converts those); someone may also
   * name an owner and a due date, and record a best guess. The best guess is NOT a value (see Entry.tbd); it only drives a
   * provisional comparison.
   */
  | "tbd"
  /** The user stated the attribute does not apply (justification required). */
  | "not_applicable"
  /** Nothing has been recorded, or the supporting source was removed. */
  | "not_established";

/**
 * A status as it may appear in OLD records (change-log history, answers). "unknown" was retired in schema 1.9.0; history is
 * never rewritten (GMP: a record stays as it was written), so only code that renders old records still reads this word.
 */
export type RecordedStatus = EntryStatus | "unknown";

export interface Quantity {
  value: number;
  unit: string;
}

/** Inclusive range. A missing bound means the range is open on that side. */
export interface Range {
  min?: Quantity;
  max?: Quantity;
}

export type EntryValue = string | number | boolean | string[] | Quantity | Range;

/** What is known about a TBD entry. Every field is optional and none is ever pre-filled. */
export interface TbdInfo {
  /** Same shape as the question's value. Drives the comparison, which labels the result provisional. Never counts as established. */
  bestGuess?: EntryValue;
  /** Free text. Not an authenticated identity. */
  owner?: string;
  /** Calendar date, YYYY-MM-DD. Overdue is judged against the viewer's local date, never stored. */
  due?: string;
  note?: string;
}

/** Where inside a cited document a value is found (added in schema 1.7.0). Both parts are optional free text. */
export interface SourceLocation {
  section?: string;
  page?: string;
}

export interface Verification {
  by: string;
  /** Free text, as typed in the verifier dialog. Not an authenticated identity. */
  role?: string;
  at: string;
  /** Fingerprint of the resolved status and value at the time of verification. */
  fingerprint: string;
  /** Resolved status at the time of verification (lets a withdrawal say whether the value or the status changed). */
  status?: EntryStatus;
  /** True when the entry was "same as source" at the time of verification. */
  sameAsSource?: boolean;
  /** True when the verifier is the same person as the one who recorded the entry (four-eyes override). */
  selfVerification?: boolean;
}

export interface Entry<T extends EntryValue = EntryValue> {
  id: string;
  /** Full reference, e.g. "source.uo.aseptic_filling.equip.filler.operatingPrinciple" or "scope.modality". */
  path: string;
  status: EntryStatus;
  /** Present only when status is "established" and sameAsSource is not set. */
  value?: T;
  /** Target only: the user asserted the target equals the source. Resolves live to the source entry. */
  sameAsSource?: boolean;
  /** Required when status is "not_applicable". */
  justification?: string;
  /** Present exactly when status is "tbd". */
  tbd?: TbdInfo;
  /** Optional place inside a cited document, keyed by source id (added in schema 1.7.0). Only for ids in sourceIds. */
  sourceLocations?: Record<string, SourceLocation>;
  /** Sources supporting this entry. An established entry with no sources reverts to not_established. */
  sourceIds: string[];
  recordedBy: string;
  recordedAt: string;
  revision: number;
  /** Verification is valid only while its fingerprint matches the current resolved value. */
  verification?: Verification;
}

export type SourceType =
  | "interview_answer"
  | "user_entry"
  | "imported_file"
  | "catalog_rule"
  | "document_reference"
  /** Reserved for a future backend document-extraction service. Never written by the PoC. */
  | "ai_extraction"
  /** Reserved for a future backend author-interview assistant. Never written by the PoC. */
  | "ai_suggestion";

export interface DocRef {
  docType: string;
  identifier: string;
  title?: string;
  version?: string;
}

export interface Source {
  id: string;
  type: SourceType;
  label: string;
  responder?: { name: string; role?: string };
  date: string;
  file?: { name: string; sha256: string };
  docRef?: DocRef;
  /** Set when an answer is re-answered; the superseded source no longer supports any entry. */
  supersededBy?: string;
}

/**
 * A structural item inside a unit operation (a parameter, piece of equipment,
 * material, in-process control, study or document). Field names are defined
 * by the catalog, which keeps custom parameters and custom unit operations
 * possible without code changes.
 */
export interface ModelItem {
  key: string;
  label: string;
  custom?: boolean;
  fields: Record<string, Entry>;
}

export type CollectionKind = "param" | "equip" | "mat" | "ipc" | "study" | "doc";

export const COLLECTION_KINDS: readonly CollectionKind[] = ["param", "equip", "mat", "ipc", "study", "doc"];

export const COLLECTION_LABELS: Record<CollectionKind, string> = {
  param: "Process parameters",
  equip: "Equipment",
  mat: "Materials and components",
  ipc: "In-process controls and sampling",
  study: "Validation and supporting studies",
  doc: "Procedures, systems and training",
};

export interface UnitOperation {
  key: string;
  label: string;
  custom?: boolean;
  sequence: number;
  /** Unit-operation level fields, e.g. "presence". */
  fields: Record<string, Entry>;
  collections: Record<CollectionKind, Record<string, ModelItem>>;
}

export interface ProcessModel {
  side: Side;
  site: { fields: Record<string, Entry> };
  unitOperations: Record<string, UnitOperation>;
}

/** Interview log record. The entries it wrote carry its sourceId. */
export interface AnswerRecord {
  id: string;
  questionId: string;
  side: Side | "shared";
  /** "value" | "tbd" | "same_as_source" | "not_applicable" | "composite" ("unknown" in answers recorded before schema 1.9.0) */
  kind: string;
  raw: unknown;
  sourceId: string;
  by: string;
  at: string;
}

export type GapStatus = "open" | "in_progress" | "closed" | "accepted_no_action";
export type Severity = "high" | "medium" | "low" | "none";

export interface GapOverlay {
  gapKey: string;
  severityOverride?: { value: Severity; justification: string; by: string; at: string };
  owner?: string;
  status: GapStatus;
  notes?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface ChangeEvent {
  at: string;
  by: string;
  action: string;
  path?: string;
  detail?: string;
  before?: unknown;
  after?: unknown;
}

export interface SectionConfirmation {
  sectionId: string;
  side: Side | "shared" | "both";
  by: string;
  at: string;
}

/** The document the interview is currently citing, and which side(s) it applies to. */
export interface AnsweringFrom {
  sourceId: string;
  sides: "source" | "target" | "both";
  section?: string;
  page?: string;
}

/** Collections a user can add custom items to. */
export type CustomItemKind = "param" | "equip" | "mat" | "ipc";

export const CUSTOM_ITEM_KINDS: readonly CustomItemKind[] = ["param", "equip", "mat", "ipc"];

/** A unit operation defined by the user. Its key always starts with "x_". */
export interface CustomUnitOperation {
  key: string;
  label: string;
  /** Position among the unit operations (the catalog uses 10, 20, 30...). */
  sequence: number;
  description?: string;
  createdBy: string;
  createdAt: string;
}

/** A parameter, equipment, material or in-process control defined by the user on any unit operation. */
export interface CustomItem {
  /** Unit operation key: a catalog key or the key of a custom unit operation. */
  uo: string;
  coll: CustomItemKind;
  /** Always starts with "x_". Unique within its unit operation. */
  key: string;
  label: string;
  /** Unit dimension from the units table. Required for parameters; for equipment it enables a capacity question. */
  dimension?: string;
  /** Why the item matters (shown as "Why is this asked?"). */
  why?: string;
  createdBy: string;
  createdAt: string;
}

export interface CustomDefinitions {
  unitOperations: CustomUnitOperation[];
  items: CustomItem[];
}

/**
 * Revisions and reviewer comments were removed from the tool in schema 1.10.0 (formal review, versioning and approval belong
 * in the company's document system, the system of record; a second set here would create conflicting records). The types
 * stay only to describe the records an older file may still hold in `document.archivedReview`.
 */
export type RevisionStatus = "draft" | "issued_for_review";

/** Which template produced an output. */
export interface TemplateRecord {
  mode: "builtin" | "their_look" | "mapped" | "tags";
  /** "Built-in default" or the name the user gave the template in the library. */
  name: string;
  /** Built-in: the built-in template version. Library template: the version string the user entered. */
  version: string;
  /** Hex SHA-256 of the original uploaded file. Absent for the built-in template. */
  sha256?: string;
  fileName?: string;
}

/** One issued revision of the generated document (archived since schema 1.10.0). */
export interface DocumentRevision {
  number: number;
  status: RevisionStatus;
  /** Required: what changed, or why the revision was issued. */
  summary: string;
  /** Free text name and role, as typed. Not an authenticated identity. */
  by: string;
  role?: string;
  at: string;
  /** Fingerprint of the document content when the revision was issued (see documentFingerprint in the engine). */
  fingerprint: string;
  /** Template chosen on the Document page at that time, if any. */
  template?: TemplateRecord;
  /** How many TBD values the document listed when the revision was issued (added in schema 1.7.0). */
  tbdCount?: number;
}

export interface ReviewCommentReply {
  kind: "reply" | "resolution" | "reopen";
  by: string;
  role?: string;
  at: string;
  text: string;
}

/** A reviewer comment on a document section, optionally on one gap row in it (archived since schema 1.10.0). */
export interface ReviewComment {
  /** 1, 2, 3 ... shown as "C-001". Never reused. */
  seq: number;
  /** sectionId is a document section id; gapKey is the stable Gap.key, not the display ID. */
  anchor: { sectionId: string; gapKey?: string };
  by: string;
  role?: string;
  at: string;
  text: string;
  status: "open" | "resolved";
  replies: ReviewCommentReply[];
}

/** A record that the document was downloaded. Exports are not changes, so they have no change-log entry. */
export interface DocumentExport {
  at: string;
  by?: string;
  format: "markdown" | "html" | "docx";
  /** Markdown and HTML always use mode "builtin". */
  template: TemplateRecord;
  /** Latest issued revision number at export time. */
  revision?: number;
  fingerprint: string;
  /** Only on records made before schema 1.10.0 (revisions existed then). */
  changedSinceRevision?: boolean;
  /**
   * True when the document content differs from the previous download of this project; absent on the first download and on
   * records made before schema 1.10.0. This replaced "changed since revision": the tool no longer issues revisions.
   */
  changedSincePrevious?: boolean;
  /** Ids of the optional sections left out of this export (added in schema 1.5.0). Absent means none were left out. */
  omittedSections?: string[];
  /** How many TBD values the exported document listed (added in schema 1.7.0). */
  tbdCount?: number;
}

/**
 * Revisions and reviewer comments of a file written before schema 1.10.0. They are kept in the file exactly as they were
 * written (GMP: a record is never destroyed because the tool stopped showing it), but they are not shown, not edited and not
 * part of any output. `archivedAt` is when the file was converted.
 */
export interface ArchivedReview {
  archivedAt: string;
  revisions: DocumentRevision[];
  comments: ReviewComment[];
}

/** Export records and the optional-section choice (revisions and comments moved to `archivedReview` in schema 1.10.0). */
export interface DocumentState {
  exports: DocumentExport[];
  archivedReview?: ArchivedReview;
  /**
   * Ids of the optional document sections the user left out (added in schema 1.5.0). Absent or empty means the document
   * includes everything. Only optional sections can be listed; the mandatory ones are always included.
   */
  omittedSections?: string[];
}

/**
 * One topic of a unit-operation section that the project has switched off (added in schema 1.8.0). GMP: leaving a topic
 * out of an assessment is a scope decision, so it always carries a reason, the person and the time. Values recorded for
 * the topic are kept (inactive), never deleted, so switching the topic back on restores them.
 */
export interface TailoredTopic {
  uo: string;
  topic: string;
  /** Optional since schema 1.10.0 (offered, never required); a document then says "No reason recorded". */
  reason?: string;
  by: string;
  at: string;
}

export interface Tailoring {
  excluded: TailoredTopic[];
}

/**
 * A whole process step (unit operation) the project leaves out of the assessment on both sides (added in schema 1.10.0).
 * GMP: leaving a step out is a scope decision a reviewer must be able to see, so it carries who and when; the reason is
 * offered but optional. Values recorded for the step stay in the project as inactive entries and return when it is included.
 */
export interface ExcludedStep {
  uo: string;
  reason?: string;
  by: string;
  at: string;
}

export interface StepScope {
  excluded: ExcludedStep[];
}

export interface Project {
  schemaVersion: string;
  meta: {
    id: string;
    title: string;
    createdAt: string;
    createdBy: string;
    /** True for the bundled fictional demonstration project. */
    demo?: boolean;
  };
  /** Versions of the content (catalog, questions, rules, templates) the project was built with. */
  contentRefs: { catalog: string; questions: string; rules: string; templates: string };
  settings: { entrySequence: "paired" | "sequential" };
  interview: {
    responder?: { name: string; role?: string };
    confirmations: SectionConfirmation[];
    /** The "Answering from" bar of the interview (added in schema 1.7.0). Kept in the project so it survives a reload. */
    answeringFrom?: AnsweringFrom;
  };
  /** Shared scoping answers (not compared). */
  scope: Record<string, Entry>;
  processes: { source: ProcessModel; target: ProcessModel };
  /** User-defined unit operations and items. Values recorded against them live in `processes` like any other entry. */
  custom: CustomDefinitions;
  /** Topics switched off for this project (schema 1.8.0). Default and migration: nothing excluded. */
  tailoring: Tailoring;
  /** Process steps left out of the assessment (schema 1.10.0). Default and migration: nothing left out. */
  stepScope: StepScope;
  /** Export records and the optional-section choice for the generated document. */
  document: DocumentState;
  sources: Source[];
  answers: AnswerRecord[];
  gapOverlays: GapOverlay[];
  changeLog: ChangeEvent[];
}

/** Who is acting and when. Passed explicitly so engine functions stay pure and testable. */
export interface Actor {
  name: string;
  role?: string;
  at: string;
}
