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
  /** The user answered "Unknown / to be confirmed". Becomes an open information item. */
  | "unknown"
  /** The user stated the attribute does not apply (justification required). */
  | "not_applicable"
  /** Nothing has been recorded, or the supporting source was removed. */
  | "not_established";

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
  /** "value" | "unknown" | "same_as_source" | "not_applicable" | "composite" */
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

/** Never "approved": the tool has no electronic signature, so a revision is a record, not an approval. */
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

/** One issued revision of the generated document. The numbers are never reused. */
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
}

export interface ReviewCommentReply {
  kind: "reply" | "resolution" | "reopen";
  by: string;
  role?: string;
  at: string;
  text: string;
}

/** A reviewer comment on a document section, optionally on one gap row in it. */
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
  changedSinceRevision: boolean;
  /** Ids of the optional sections left out of this export (added in schema 1.5.0). Absent means none were left out. */
  omittedSections?: string[];
}

/** Revision history, reviewer comments and export records (added in schema 1.3.0). */
export interface DocumentState {
  revisions: DocumentRevision[];
  comments: ReviewComment[];
  exports: DocumentExport[];
  /**
   * Ids of the optional document sections the user left out (added in schema 1.5.0). Absent or empty means the document
   * includes everything. Only optional sections can be listed; the mandatory ones are always included.
   */
  omittedSections?: string[];
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
  };
  /** Shared scoping answers (not compared). */
  scope: Record<string, Entry>;
  processes: { source: ProcessModel; target: ProcessModel };
  /** User-defined unit operations and items. Values recorded against them live in `processes` like any other entry. */
  custom: CustomDefinitions;
  /** Revision history, reviewer comments and export records for the generated document. */
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
