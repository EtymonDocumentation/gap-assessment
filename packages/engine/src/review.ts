import { stableStringify, type DocumentExport, type Project, type TemplateRecord } from "@gap/process-model";
import type { DocModel } from "./document";

/**
 * Optional document sections and the export record.
 *
 * Decisions:
 * - Revisions, Draft / Issued for review and reviewer comments were removed in schema 1.10.0. Formal review, comments,
 *   versioning and approval happen in the company's document system (the system of record); a second set of revisions and
 *   comments here would create conflicting records. Old ones stay in the stored file (document.archivedReview), untouched.
 * - The fingerprint covers the document content only. The generation time is left out, so downloading twice never looks
 *   like a change.
 * - Exports are recorded without a change-log entry, because downloading a file does not change the project.
 */

/** A section choice or export record could not be stored (unknown section, unknown format). The message is shown to the user. */
export class ReviewError extends Error {}

/** Every section id buildDocument can produce, in document order (used for the section tags of Word templates). */
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
  "gap-details",
  "source-register",
  "change-log-summary",
];

/**
 * The sections a user may leave out of the document, in document order. Everything else is mandatory: the purpose, the
 * scope, the SU and RU summaries, the detailed gap table and the open information items (TBD values must stay visible).
 * The titles here are the titles buildDocument uses.
 */
export const OPTIONAL_SECTIONS: readonly { id: string; title: string; appendix: boolean }[] = [
  { id: "differences", title: "Summary of differences by unit operation", appendix: false },
  { id: "validation-plan", title: "Validation plan", appendix: false },
  { id: "equipment-qualification", title: "Equipment qualification comparison", appendix: false },
  { id: "risk", title: "Risk ranking", appendix: false },
  { id: "verification-status", title: "Verification status", appendix: false },
  { id: "references", title: "References", appendix: false },
  { id: "approval", title: "Approval", appendix: false },
  { id: "gap-details", title: "Gap details", appendix: true },
  { id: "source-register", title: "Source register", appendix: true },
  { id: "change-log-summary", title: "Change log summary", appendix: true },
];

/**
 * Every section of the document in document order, for the Scope step and the Document page: the optional ones can be ticked
 * off, the others are always included (shown ticked and disabled). The titles of the SU and RU summaries are the general ones;
 * the document itself adds the program stage to the SU heading.
 */
export const SECTION_CHOICES: readonly { id: string; title: string; appendix: boolean; optional: boolean }[] = [
  { id: "purpose", title: "Purpose", appendix: false, optional: false },
  { id: "scope", title: "Scope", appendix: false, optional: false },
  { id: "source-summary", title: "Sending unit (SU) program summary", appendix: false, optional: false },
  { id: "target-summary", title: "Receiving unit (RU) summary", appendix: false, optional: false },
  { id: "differences", title: "Summary of differences by unit operation", appendix: false, optional: true },
  { id: "gap-table", title: "Detailed gap table", appendix: false, optional: false },
  { id: "validation-plan", title: "Validation plan", appendix: false, optional: true },
  { id: "equipment-qualification", title: "Equipment qualification comparison", appendix: false, optional: true },
  { id: "open-items", title: "Open information items", appendix: false, optional: false },
  { id: "risk", title: "Risk ranking", appendix: false, optional: true },
  { id: "verification-status", title: "Verification status", appendix: false, optional: true },
  { id: "references", title: "References", appendix: false, optional: true },
  { id: "approval", title: "Approval", appendix: false, optional: true },
  { id: "gap-details", title: "Gap details", appendix: true, optional: true },
  { id: "source-register", title: "Source register", appendix: true, optional: true },
  { id: "change-log-summary", title: "Change log summary", appendix: true, optional: true },
];

/** Title of an optional section, or undefined for a mandatory or unknown id. */
export function optionalSectionTitle(id: string): string | undefined {
  return OPTIONAL_SECTIONS.find((s) => s.id === id)?.title;
}

/** The sections currently left out of the document: the stored choice, limited to optional sections, in document order. */
export function omittedSectionIds(project: Project): string[] {
  const stored = new Set(project.document.omittedSections ?? []);
  return OPTIONAL_SECTIONS.filter((s) => stored.has(s.id)).map((s) => s.id);
}

/**
 * Records which optional sections the document leaves out. Mandatory and unknown ids are refused. An empty list means
 * the document includes everything (the default). This is an export setting, not a change to the assessment, so it has no
 * change-log entry; the document says what it omits (the "Sections omitted" line) and each export record keeps the list.
 */
export function setOmittedSections(project: Project, ids: string[]): Project {
  for (const id of ids) {
    if (!optionalSectionTitle(id)) throw new ReviewError(`"${id}" cannot be left out of the document`);
  }
  const next = structuredClone(project);
  const wanted = new Set(ids);
  const list = OPTIONAL_SECTIONS.filter((s) => wanted.has(s.id)).map((s) => s.id);
  if (list.length) next.document.omittedSections = list;
  else delete next.document.omittedSections;
  return next;
}

/** Meta rows that change on every download without the content changing; they are not part of the fingerprint. */
const FINGERPRINT_SKIP_META = new Set(["Generated"]);

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
 * Stable hash of the document content. The same content always gives the same hash. The generation time does not count.
 */
export function documentFingerprint(doc: DocModel): string {
  const canonical = {
    title: doc.title,
    banner: doc.banner,
    status: doc.status,
    meta: doc.meta.filter(([k]) => !FINGERPRINT_SKIP_META.has(k)),
    sections: doc.sections,
  };
  return fnv1a64(stableStringify(canonical));
}

// ------------------------------------------------------------------ helpers

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

// ------------------------------------------------------------------ exports

const EXPORT_FORMATS: readonly DocumentExport["format"][] = ["markdown", "html", "docx", "trd-seed-json", "trd-outline-docx", "trd-outline-html", "sampling-plan-docx", "sampling-plan-html", "sampling-cmo-instructions-docx", "sampling-cmo-instructions-html", "risk-assessment-docx", "risk-assessment-html", "trd-docx", "trd-html"];

/** True for the three TRD seed outputs (the seed JSON and its Word and HTML outlines). The TRD module's own document is not one of them. */
export function isTrdFormat(format: DocumentExport["format"]): boolean {
  return format.startsWith("trd-") && !isTrdDocumentFormat(format);
}

/** True for the two outputs of the TRD module's editable document (Word and HTML). */
export function isTrdDocumentFormat(format: DocumentExport["format"]): boolean {
  return format === "trd-docx" || format === "trd-html";
}

/** True for the two sampling plan outputs (Word and HTML). */
export function isSamplingFormat(format: DocumentExport["format"]): boolean {
  return format.startsWith("sampling-plan-");
}

/** True for the two risk assessment outputs (Word and HTML). */
export function isRiskFormat(format: DocumentExport["format"]): boolean {
  return format.startsWith("risk-assessment-");
}

/** Which document an output belongs to: the gap assessment, the TRD outputs, the sampling plan or the risk assessment. Each is compared with its own previous download. */
function exportFamily(format: DocumentExport["format"]): "gap" | "trd" | "trd-document" | "sampling" | "risk" {
  return isTrdFormat(format) ? "trd" : isTrdDocumentFormat(format) ? "trd-document" : isSamplingFormat(format) ? "sampling" : isRiskFormat(format) ? "risk" : "gap";
}

/** Appends an export record. No change-log entry: downloading the document does not change the project. */
export function recordExport(project: Project, record: DocumentExport): Project {
  if (!EXPORT_FORMATS.includes(record.format)) {
    throw new ReviewError(`Unknown export format ${String(record.format)}`);
  }
  if (!record.fingerprint) throw new ReviewError("An export record needs the document fingerprint");
  const next = structuredClone(project);
  // The export keeps which optional sections it left out. A record that does not say takes the project's current choice;
  // an empty list is stored as no field at all, so "nothing omitted" reads the same as before this setting existed.
  const { omittedSections, changedSincePrevious: given, ...rest } = structuredClone(record);
  // A TRD output is not the gap assessment document, so the document's omitted-section choice does not apply to it.
  // The same holds for the sampling plan: the gap document's optional sections are not part of it.
  const family = exportFamily(record.format);
  const left = omittedSections ?? (family === "gap" ? omittedSectionIds(project) : []);
  // Whether the answers changed since the previous download is worked out here, from the fingerprints, so every caller records it
  // the same way. The first download has nothing to compare with and records nothing.
  // A TRD output is compared with the previous TRD output only: a gap document download says nothing about whether the seed changed.
  // The same holds for the sampling plan.
  const previous = [...project.document.exports].reverse().find((e) => exportFamily(e.format) === family);
  const changedSincePrevious = given ?? (previous ? previous.fingerprint !== record.fingerprint : undefined);
  next.document.exports.push({
    ...rest,
    template: cleanTemplate(record.template),
    ...(changedSincePrevious !== undefined ? { changedSincePrevious } : {}),
    ...(left.length ? { omittedSections: left } : {}),
  });
  return next;
}
