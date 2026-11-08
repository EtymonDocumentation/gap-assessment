import { DOCUMENT_SECTION_IDS, NO_VERSION_HISTORY, NOTICE_DOCUMENT, activityLabel, categoryLabel, formatResolved, partyTags, stageWording, stagedFor, type Assessment, type ContentBundle, type DocModel, type PartyTag, type PartyTags } from "@gap/engine";
import { resolveEntry, type Project, type SamplingPlan } from "@gap/process-model";

// ------------------------------------------------------------------ the data a template can use

export interface GapTag {
  id: string;
  section: string;
  attribute: string;
  source: string;
  target: string;
  category: string;
  detail: string;
  why: string;
  activities: string;
  severity: string;
  regulatory: string;
  owner: string;
  status: string;
  rule: string;
  sourceVerification: string;
  targetVerification: string;
}

export interface TagData {
  title: string;
  banner: string;
  status: string;
  program: string;
  modality: string;
  dosageForm: string;
  presentation: string;
  transferType: string;
  markets: string;
  sourceSite: string;
  targetSite: string;
  sourceStage: string;
  /** The project stage (the receiving site's next batches). `targetStage` is the older name for the same value. */
  projectStage: string;
  targetStage: string;
  /** Which version of the project the document was made from, as the cover states it ("v2 (saved 2026-11-04), project stage Clinical"). */
  version: string;
  /** The short form for a header: "v2" or "Working copy after v2.1" (empty when the project has no history). */
  versionLabel: string;
  generated: string;
  regulatoryStatement: string;
  verificationStatement: string;
  identityStatement: string;
  differencesCount: string;
  openItemsCount: string;
  verifiedSummary: string;
  gaps: GapTag[];
  openItems: { no: string; section: string; side: string; question: string; status: string }[];
  activities: { activity: string; description: string; gaps: string; severity: string; regulatory: string; sourceStudies: string; targetStudies: string; readiness: string }[];
  equipment: { uo: string; equipment: string; sourceQualification: string; targetQualification: string; qualifiedRange: string; required: string; relatedGaps: string }[];
  risks: { rank: string; id: string; attribute: string; category: string; severity: string; regulatory: string }[];
  sources: { id: string; type: string; identifier: string; responder: string; date: string; state: string; citedBy: string }[];
  approvals: { role: string; name: string; signature: string; date: string }[];
  /** The sampling plan's parties. Empty in every document that is not a sampling plan (an empty loop prints nothing). */
  parties: PartyTag[];
  fromParties: PartyTag[];
  toParties: PartyTag[];
  ccParties: PartyTag[];
  /** The sending unit and receiving site (the gap assessment's SU and RU sites). */
  sendingUnit: string;
  receivingSite: string;
  meta: { label: string; value: string }[];
  sections: { number: string; title: string }[];
}

const NO_PARTIES = { parties: [] as PartyTag[], fromParties: [] as PartyTag[], toParties: [] as PartyTag[], ccParties: [] as PartyTag[] };

type Table = { columns: string[]; rows: string[][] };

/** The first table of a document section, or undefined (for example when the section only says "No open items."). */
function tableOf(doc: DocModel, sectionId: string): Table | undefined {
  const b = doc.sections.find((s) => s.id === sectionId)?.blocks.find((x) => x.type === "table");
  return b && b.type === "table" ? { columns: b.columns, rows: b.rows } : undefined;
}

/**
 * Rows of a section's table as objects: `fields` maps a tag field name to the table column it comes from. A field may list several column names
 * (the one the table has is used), so documents worded "Source" / "Target" and documents worded "SU" / "RU" both fill the same tags.
 */
function rowsAs<K extends string>(doc: DocModel, sectionId: string, fields: Record<K, string | string[]>): Record<K, string>[] {
  const t = tableOf(doc, sectionId);
  if (!t) return [];
  const idx = (Object.entries(fields) as [K, string | string[]][]).map(([k, col]) => [k, Math.max(...[col].flat().map((c) => t.columns.indexOf(c)))] as const);
  return t.rows.map((r) => Object.fromEntries(idx.map(([k, i]) => [k, i < 0 ? "" : (r[i] ?? "")])) as Record<K, string>);
}

type Row = Record<string, string>;

/** Rows of a section's table keyed by column header. */
function recordsOf(doc: DocModel, sectionId: string): Row[] {
  const t = tableOf(doc, sectionId);
  return t ? t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? ""]))) : [];
}

/** The first of these columns that the row has, or undefined. */
function pick(row: Row | undefined, ...names: string[]): string | undefined {
  if (!row) return undefined;
  const name = names.find((n) => Object.prototype.hasOwnProperty.call(row, n));
  return name === undefined ? undefined : row[name];
}

const GAP_STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", closed: "Closed", accepted_no_action: "Accepted, no action" };

/**
 * One gap tag per row of the detailed gap table. The lean table (ID, Attribute, SU, RU, Gap, Severity, Actions, Notes) holds only some of the fields:
 * rule, owner, status, regulatory note and verification come from the "Gap details" appendix (by gap ID), and what neither table shows comes from the
 * assessment itself. An older document with the long table still fills every field from its own columns.
 */
function gapTags(content: ContentBundle, doc: DocModel, a: Assessment): GapTag[] {
  const details = new Map(recordsOf(doc, "gap-details").map((r) => [r["ID"] ?? "", r]));
  return recordsOf(doc, "gap-table").map((r) => {
    const id = r["ID"] ?? "";
    const d = details.get(id);
    const g = a.gaps.find((x) => x.displayId === id);
    const gapCell = pick(r, "Gap", "Category") ?? "";
    const fallbackActivities = g ? g.activities.map((x) => activityLabel(content, x)).join("; ") || "—" : "";
    return {
      id,
      section: pick(r, "Section") ?? g?.sectionTitle ?? "",
      // The lean table's Attribute cell reads "<section> — <attribute>"; the tag holds the attribute alone.
      attribute: g?.attribute ?? pick(r, "Attribute") ?? "",
      source: pick(r, "SU", "Source") ?? g?.sourceDisplay ?? "",
      target: pick(r, "RU", "Target") ?? g?.targetDisplay ?? "",
      category: g ? categoryLabel(content, g.category) : gapCell,
      detail: g ? g.detail : "",
      why: pick(r, "Why it matters") ?? g?.rationale ?? "",
      activities: pick(r, "Activities implied") ?? fallbackActivities,
      severity: pick(r, "Severity") ?? "",
      regulatory: pick(r, "Regulatory") ?? pick(d, "Regulatory") ?? g?.regulatoryNote ?? "—",
      owner: pick(r, "Owner") ?? pick(d, "Owner") ?? g?.owner ?? "[unassigned]",
      status: pick(r, "Status") ?? pick(d, "Status") ?? (g ? GAP_STATUS_LABEL[g.status] ?? g.status : ""),
      rule: pick(r, "Rule") ?? pick(d, "Rule") ?? (g ? `${g.ruleId} v${g.ruleVersion}` : ""),
      sourceVerification: pick(r, "Source verification") ?? pick(d, "SU verification", "Source verification") ?? "",
      targetVerification: pick(r, "Target verification") ?? pick(d, "RU verification", "Target verification") ?? "",
    };
  });
}

function metaValue(doc: DocModel, label: string): string {
  return doc.meta.find(([k]) => k === label)?.[1] ?? "";
}

function noteIn(doc: DocModel, sectionId: string): string {
  const b = doc.sections.find((s) => s.id === sectionId)?.blocks.find((x) => x.type === "note");
  return b && b.type === "note" ? b.text : "";
}

function scopeText(content: ContentBundle, project: Project, key: string): string {
  const q = content.questions.find((x) => x.binds === `scope.${key}`);
  const r = resolveEntry(project, `scope.${key}`);
  return r.status === "established" ? formatResolved(content, q, r) : "[TBD]";
}

function siteText(project: Project, side: "source" | "target"): string {
  const name = resolveEntry(project, `${side}.site.name`);
  const line = resolveEntry(project, `${side}.site.line`);
  const n = name.status === "established" ? String(name.value) : "[site TBD]";
  return line.status === "established" ? `${n}, ${String(line.value)}` : n;
}

/** The tags that come from the project itself, not from any one document: the scoping answers and the two sites. */
export type ProjectTags = Pick<TagData, "program" | "modality" | "dosageForm" | "presentation" | "transferType" | "markets" | "sourceSite" | "targetSite" | "sendingUnit" | "receivingSite">;

/**
 * The project's own tags. Every document belongs to a project, so every document type (gap, TRD, batch record, risk, sampling) gets the
 * same values. A value the project has not established reads the site's usual unknown wording ("[TBD]", "[site TBD]"), never a guess.
 */
export function projectTags(rawContent: ContentBundle, project: Project): ProjectTags {
  const content = stagedFor(rawContent, project);
  return {
    program: scopeText(content, project, "program"),
    modality: scopeText(content, project, "modality"),
    dosageForm: scopeText(content, project, "dosage_form"),
    presentation: scopeText(content, project, "presentation"),
    transferType: scopeText(content, project, "transfer_type"),
    markets: scopeText(content, project, "markets"),
    sourceSite: siteText(project, "source"),
    targetSite: siteText(project, "target"),
    sendingUnit: siteText(project, "source"),
    receivingSite: siteText(project, "target"),
  };
}

/**
 * Tags of the retired review workflow (schema 1.10.0). Customer templates written for earlier versions may still contain
 * {revision}, {#revisions} or {#comments}; such a template must keep working, so these tags are accepted and render as
 * empty (an empty loop prints nothing). They are deliberately not in TAG_REFERENCE, the starter template or the docs.
 */
const RETIRED_TAG_DATA = { revision: "", revisions: [] as Record<string, string>[], comments: [] as Record<string, string>[] };
const RETIRED_LOOP_FIELDS: Record<string, string[]> = {
  revisions: ["number", "status", "date", "by", "summary", "template"],
  comments: ["id", "location", "comment", "by", "date", "status", "responses"],
};

/** Everything a Word template can use. Values are the strings the HTML and Markdown documents show (taken from the DocModel tables). */
export function buildTagData(rawContent: ContentBundle, project: Project, a: Assessment, doc: DocModel): TagData {
  const content = stagedFor(rawContent, project);
  const stages = stageWording(project);
  const gaps = gapTags(content, doc, a);
  return {
    title: doc.title,
    banner: doc.banner,
    status: doc.status,
    ...RETIRED_TAG_DATA,
    ...projectTags(content, project),
    sourceStage: stages.sourceLabel,
    projectStage: doc.cover.targetStage,
    targetStage: doc.cover.targetStage,
    version: doc.cover.version?.row ?? NO_VERSION_HISTORY,
    versionLabel: doc.cover.version?.label ?? "",
    generated: metaValue(doc, "Generated"),
    regulatoryStatement: noteIn(doc, "gap-table"),
    verificationStatement: metaValue(doc, "Verification"),
    identityStatement: noteIn(doc, "verification-status"),
    differencesCount: metaValue(doc, "Differences identified"),
    openItemsCount: metaValue(doc, "Open items"),
    verifiedSummary: metaValue(doc, "Entries verified"),
    gaps,
    openItems: rowsAs(doc, "open-items", { no: "No.", section: "Section", side: "Side", question: "Question", status: "Status" }),
    activities: rowsAs(doc, "validation-plan", {
      activity: "Activity",
      description: "Description",
      gaps: "Implied by gaps",
      severity: "Severity",
      regulatory: "Regulatory",
      sourceStudies: ["Linked studies: SU status", "Linked studies: source status"],
      targetStudies: ["Linked studies: RU status", "Linked studies: target status"],
      readiness: "Readiness",
    }),
    equipment: rowsAs(doc, "equipment-qualification", {
      uo: "Unit operation",
      equipment: "Equipment",
      sourceQualification: ["SU qualification", "Source qualification"],
      targetQualification: ["RU qualification", "Target qualification"],
      qualifiedRange: ["Qualified range (RU)", "Qualified range (target)"],
      required: ["Required by RU process", "Required by target process"],
      relatedGaps: "Related gaps",
    }),
    risks: rowsAs(doc, "risk", { rank: "Rank", id: "ID", attribute: "Attribute", category: "Category", severity: "Severity", regulatory: "Regulatory" }),
    sources: rowsAs(doc, "source-register", { id: "ID", type: "Type", identifier: "Identifier, title, version", responder: "Responder", date: "Date", state: "State", citedBy: "Cited by" }),
    approvals: rowsAs(doc, "approval", { role: "Role", name: "Name", signature: "Signature", date: "Date" }),
    ...NO_PARTIES,
    meta: doc.meta.map(([label, value]) => ({ label, value })),
    sections: doc.sections.map((s) => ({ number: s.appendix ? `Appendix ${s.number}` : s.number, title: s.title })),
  };
}

/**
 * What a placeholder-tag template can use when the document is NOT the gap assessment (TRD, batch record, risk assessment, sampling
 * plan): the text tags every document has, the document-details lines, the section list and, when the project is given, the project's
 * own tags ({program}, {modality}, the sites, ...): every document belongs to a project, so they are filled for every document type.
 * The gap-only tags ({#gaps}, {differencesCount}, ...) are left out on purpose: they read "[not available]" or repeat nothing, so a
 * template never shows a gap value inside another document. The whole content is still reachable with {@body} and the section tags
 * (see RISK_SECTION_IDS).
 */
export type DocumentTagData = Pick<TagData, "title" | "banner" | "status" | "generated" | "version" | "versionLabel" | "meta" | "sections" | "gaps" | "openItems" | "activities" | "equipment" | "risks" | "sources" | "approvals" | "parties" | "fromParties" | "toParties" | "ccParties"> & Partial<ProjectTags>;

/**
 * What a placeholder-tag template can use for the sampling plan and the CMO reporting instructions: the document tags plus the plan's
 * parties (all of them, and the From / To / Cc lists the person chose), the CMO and sponsor names, and the sending unit and receiving
 * site taken from the project's two sites.
 */
export type SamplingTagData = DocumentTagData & PartyTags & ProjectTags;

export function buildSamplingTagData(doc: DocModel, project: Project, plan: SamplingPlan, content: ContentBundle): SamplingTagData {
  return { ...buildDocumentTagData(doc, content, project), ...partyTags(plan), ...projectTags(content, project) };
}

/** `content` and `project` are the project the document was made from; without them the project's tags are not filled (they read [not available]). */
export function buildDocumentTagData(doc: DocModel, content?: ContentBundle, project?: Project): DocumentTagData {
  return {
    ...(content && project ? projectTags(content, project) : {}),
    title: doc.title,
    banner: doc.banner,
    status: doc.status,
    generated: metaValue(doc, "Generated"),
    version: doc.cover.version?.row ?? NO_VERSION_HISTORY,
    versionLabel: doc.cover.version?.label ?? "",
    meta: doc.meta.map(([label, value]) => ({ label, value })),
    sections: doc.sections.map((s) => ({ number: s.appendix ? `Appendix ${s.number}` : s.number, title: s.title })),
    // The gap loops are present but empty: a loop over a missing value would print one "[not available]" row, an empty list prints nothing.
    gaps: [],
    openItems: [],
    activities: [],
    equipment: [],
    risks: [],
    sources: [],
    approvals: [],
    ...NO_PARTIES,
  };
}

/**
 * Section ids of the risk assessment document that the gap document does not have ("open-items" and "approval" are shared). They
 * are listed as raw tags so a template that uses them is not reported as having an unknown tag.
 */
export const RISK_SECTION_IDS: readonly string[] = ["purpose-scope", "method", "register", "heat", "actions", "traceability", "versions"];

/**
 * Fixed section ids of the TRD document that neither the gap nor the risk document has. The per-step sections have ids
 * "step-TS-nn" that depend on the TRD, so they are reachable with {@body} and with their own tag (section_step_TS_01), which the
 * renderer makes for every section of the document; they are not listed here because their number is not fixed.
 */
export const TRD_SECTION_IDS: readonly string[] = ["product", "site", "overview", "manufacturing-overview", "par-nor", "overrides", "writeup-values", "process-parameters", "references"];

/**
 * Fixed section ids of the master batch record that no other document has ("open-items" and "versions" are shared). The unit-operation
 * sections have ids "section-SC-nn" that depend on the record, so they are reachable with {@body} and with their own generated tag.
 */
export const MBR_SECTION_IDS: readonly string[] = ["basis", "sources"];

// ------------------------------------------------------------------ tag reference

export interface TagReferenceEntry {
  tag: string;
  kind: "text" | "loop" | "raw";
  description: string;
  fields?: { name: string; description: string }[];
  recommended?: boolean;
}

const f = (name: string, description: string) => ({ name, description });

const TEXT_TAGS: [string, string, boolean?][] = [
  ["banner", `The drafting-aid notice: "${NOTICE_DOCUMENT}" The notice is always added to the document, even when the template has no banner tag.`, true],
  ["title", "Document title.", true],
  ["status", "Document status (DRAFT)."],
  ["program", "Program name from the project's scoping answers. Filled in every document; \"[TBD]\" when the project has not established it.", true],
  ["modality", "Modality (from the project; filled in every document)."],
  ["dosageForm", "Dosage form."],
  ["presentation", "Presentation."],
  ["transferType", "Type of transfer."],
  ["markets", "Markets."],
  ["sourceSite", "Sending unit (SU) site (name and line), from the project. Filled in every document."],
  ["targetSite", "Receiving unit (RU) site (name and line), from the project. Filled in every document."],
  ["sourceStage", "Sending-site stage: Engineering / development runs, Clinical batches, PPQ batches, Commercial batches, or [TBD]."],
  ["projectStage", "Project stage (what the receiving site's next batches are): Engineering / development runs, Clinical batches, PPQ batches, Commercial batches, or [not established]."],
  ["targetStage", "The older name of projectStage; same value."],
  ["version", "Which version of the project the document was made from, for example \"v2 (saved 2026-11-04), project stage Clinical\" or \"Working copy after v2.1 (changes since not saved as a version)\"."],
  ["versionLabel", "The short form of the version for a header or footer: \"v2\" or \"Working copy after v2.1\". Empty when the project has no version history."],
  ["generated", "Date and time the document was generated (UTC)."],
  ["sendingUnit", "Sending unit's site (name and line), for example for the From line of a memo. Filled in every document."],
  ["receivingSite", "Receiving site (name and line), for example for the To line of a memo. Filled in every document."],
  ["cmoName", "Sampling plan and CMO instructions only: the names of the parties of kind CMO, joined with \", \", or \"[no CMO named]\"."],
  ["sponsorName", "Sampling plan and CMO instructions only: the names of the parties of kind Sponsor, joined with \", \", or \"[no sponsor named]\"."],
  ["fromText", "Sampling plan and CMO instructions only: the parties you put on the From line (name, role, department), joined with \"; \" on one line, or \"[none chosen]\"."],
  ["toText", "Sampling plan and CMO instructions only: the parties you put on the To line, joined with \"; \", or \"[none chosen]\"."],
  ["ccText", "Sampling plan and CMO instructions only: the parties you put on the Cc line, joined with \"; \", or \"[none chosen]\"."],
  ["regulatoryStatement", "The statement under the gap table that regulatory consequences need review. The tool never decides a filing category; it only says \"Requires regulatory affairs assessment\"."],
  ["verificationStatement", "The statement about data verification."],
  ["identityStatement", "The statement that explains how verifier identity is recorded."],
  ["differencesCount", "Number of differences identified."],
  ["openItemsCount", "Number of open items."],
  ["verifiedSummary", "Entries verified, for example \"12 of 40\"."],
];

const PARTY_FIELDS = [
  f("party", "Kind of party: CMO, Sponsor, Contract laboratory or Other."),
  f("name", "Name."),
  f("role", "Role (empty when not given)."),
  f("department", "Department (empty when not given)."),
  f("memoLine", "The memo line chosen for the party: From, To, Cc, or empty."),
  f("line", "Name, role and department joined with commas, whichever are given."),
];

const LOOP_TAGS: { tag: string; description: string; fields: { name: string; description: string }[]; recommended?: boolean }[] = [
  {
    tag: "gaps",
    recommended: true,
    description: "One item per identified difference (the detailed gap table). Put {#gaps} in the first cell and {/gaps} in the last cell of a table row to repeat the row.",
    fields: [
      f("id", "Gap ID, for example G-001."),
      f("section", "Process section."),
      f("attribute", "Attribute compared."),
      f("source", "SU value (sending unit)."),
      f("target", "RU value (receiving unit)."),
      f("category", "Category of the difference."),
      f("detail", "Explanation of the difference. The document shows category and detail together as \"<category>. <detail>\"."),
      f("why", "Why it matters."),
      f("activities", "Activities implied."),
      f("severity", "Severity."),
      f("regulatory", "Regulatory note (\"Requires regulatory affairs assessment\" or a dash)."),
      f("owner", "Owner, or \"[unassigned]\"."),
      f("status", "Status."),
      f("rule", "Comparison rule and version."),
      f("sourceVerification", "Verification state of the SU inputs."),
      f("targetVerification", "Verification state of the RU inputs."),
    ],
  },
  { tag: "openItems", description: "Open items.", fields: [f("no", "Number."), f("section", "Section."), f("side", "Scoping, SU or RU."), f("question", "The question still to be answered."), f("status", "Status.")] },
  {
    tag: "activities",
    description: "Validation plan activities.",
    fields: [
      f("activity", "Activity."),
      f("description", "Description."),
      f("gaps", "Gaps that imply the activity."),
      f("severity", "Severity."),
      f("regulatory", "Regulatory note."),
      f("sourceStudies", "Linked studies, SU status."),
      f("targetStudies", "Linked studies, RU status."),
      f("readiness", "Readiness."),
    ],
  },
  {
    tag: "equipment",
    description: "Equipment qualification comparison.",
    fields: [
      f("uo", "Unit operation."),
      f("equipment", "Equipment."),
      f("sourceQualification", "SU qualification."),
      f("targetQualification", "RU qualification."),
      f("qualifiedRange", "Qualified range (RU)."),
      f("required", "Required by the RU process."),
      f("relatedGaps", "Related gaps."),
    ],
  },
  { tag: "risks", description: "Risk ranking, highest first.", fields: [f("rank", "Rank."), f("id", "Gap ID."), f("attribute", "Attribute."), f("category", "Category."), f("severity", "Severity."), f("regulatory", "Regulatory (Yes or No).")] },
  {
    tag: "sources",
    description: "Source register appendix (empty when the appendix is left out of the document). Its letter depends on which optional sections are kept; use the sections tag for the current letters.",
    fields: [f("id", "Source ID."), f("type", "Type."), f("identifier", "Identifier, title, version."), f("responder", "Responder."), f("date", "Date."), f("state", "State."), f("citedBy", "Cited by.")],
  },
  { tag: "approvals", description: "Approval lines. The name, signature and date stay as placeholders: the tool has no electronic signature.", fields: [f("role", "Role."), f("name", "Name (placeholder)."), f("signature", "Signature (placeholder)."), f("date", "Date (placeholder).")] },
  {
    tag: "parties",
    description: "Sampling plan and CMO instructions: every responsible party named in \"Who does what\", in the order given. Empty in other documents. {#fromParties}, {#toParties} and {#ccParties} have the same fields but list only the parties you put on that memo line; the tool never chooses a memo line for a party.",
    fields: PARTY_FIELDS,
  },
  { tag: "fromParties", description: "Sampling plan and CMO instructions: the parties put on the From line (same fields as {#parties}). Empty when none is chosen.", fields: PARTY_FIELDS },
  { tag: "toParties", description: "Sampling plan and CMO instructions: the parties put on the To line (same fields as {#parties}). Empty when none is chosen.", fields: PARTY_FIELDS },
  { tag: "ccParties", description: "Sampling plan and CMO instructions: the parties put on the Cc line (same fields as {#parties}). Empty when none is chosen.", fields: PARTY_FIELDS },
  { tag: "meta", description: "The document-details lines (project, generated, counts, verification).", fields: [f("label", "Line name."), f("value", "Line value.")] },
  { tag: "sections", description: "Section numbers and titles (for a table of contents).", fields: [f("number", "Section number, or \"Appendix\" and its letter. Letters follow the sections kept in the document, so they close up when optional appendices are left out."), f("title", "Section title.")] },
];

/** Section id as used in a tag: hyphens become underscores. */
export function sectionTagName(sectionId: string): string {
  return `section_${sectionId.replace(/-/g, "_")}`;
}

export const TAG_REFERENCE: TagReferenceEntry[] = [
  ...TEXT_TAGS.map(([tag, description, recommended]): TagReferenceEntry => ({ tag, kind: "text", description, ...(recommended ? { recommended: true } : {}) })),
  ...LOOP_TAGS.map((l): TagReferenceEntry => ({ tag: l.tag, kind: "loop", description: l.description, fields: l.fields, ...(l.recommended ? { recommended: true } : {}) })),
  {
    tag: "body",
    kind: "raw",
    description: "Raw tag {@body}: all sections of the document in the tool's look, using the template's own heading, table and list styles. Put it alone in its own paragraph.",
  },
  ...DOCUMENT_SECTION_IDS.map((id): TagReferenceEntry => ({
    tag: sectionTagName(id),
    kind: "raw",
    description: `Raw tag {@${sectionTagName(id)}}: the section "${id}" (heading and content) in the tool's look. Put it alone in its own paragraph.`,
  })),
  ...RISK_SECTION_IDS.filter((id) => !DOCUMENT_SECTION_IDS.includes(id)).map((id): TagReferenceEntry => ({
    tag: sectionTagName(id),
    kind: "raw",
    description: `Raw tag {@${sectionTagName(id)}}: the section "${id}" of the risk assessment document (heading and content) in the tool's look. Put it alone in its own paragraph. Empty in a gap assessment document.`,
  })),
  ...TRD_SECTION_IDS.filter((id) => !DOCUMENT_SECTION_IDS.includes(id) && !RISK_SECTION_IDS.includes(id)).map((id): TagReferenceEntry => ({
    tag: sectionTagName(id),
    kind: "raw",
    description: `Raw tag {@${sectionTagName(id)}}: the section "${id}" of the TRD document (heading and content) in the tool's look. Put it alone in its own paragraph. Empty in other documents.`,
  })),
  ...MBR_SECTION_IDS.filter((id) => !DOCUMENT_SECTION_IDS.includes(id) && !RISK_SECTION_IDS.includes(id) && !TRD_SECTION_IDS.includes(id)).map((id): TagReferenceEntry => ({
    tag: sectionTagName(id),
    kind: "raw",
    description: `Raw tag {@${sectionTagName(id)}}: the section "${id}" of the batch record document (heading and content) in the tool's look. Put it alone in its own paragraph. Empty in other documents.`,
  })),
];

/** Names a template may use at the top level, and the field names allowed inside each loop. */
export function knownTagNames(): { top: Set<string>; loopFields: Map<string, Set<string>>; recommended: string[] } {
  return {
    top: new Set([...TAG_REFERENCE.map((t) => t.tag), "revision", ...Object.keys(RETIRED_LOOP_FIELDS)]),
    loopFields: new Map([
      ...TAG_REFERENCE.filter((t) => t.kind === "loop").map((t): [string, Set<string>] => [t.tag, new Set((t.fields ?? []).map((x) => x.name))]),
      ...Object.entries(RETIRED_LOOP_FIELDS).map(([k, v]): [string, Set<string>] => [k, new Set(v)]),
    ]),
    recommended: TAG_REFERENCE.filter((t) => t.recommended).map((t) => t.tag),
  };
}

/** The tag reference as Markdown (for the Templates page download). */
export function tagReferenceMarkdown(): string {
  const out: string[] = [
    "# Placeholder tags for Word templates",
    "",
    `> ${NOTICE_DOCUMENT}`,
    "",
    "Write a tag in your Word template where the value should appear, for example `{title}`. Type each tag in one go (do not change the formatting in the middle of a tag).",
    "",
    "- **Text tag**: `{name}` is replaced by the value. A value that is not available shows `[not available]`.",
    "- **Loop**: `{#gaps}` ... `{/gaps}` repeats what is between the two tags once per item. To repeat a table row, put `{#gaps}` in the first cell and `{/gaps}` in the last cell of that row. Inside the loop use the item's fields, for example `{id}` and `{attribute}`.",
    "- **Raw tag**: `{@body}` or `{@section_gap_table}` inserts whole sections in the tool's look, using your heading, table and list styles. Put it alone in its own paragraph.",
    "",
    "The drafting-aid notice is always added to the document. If the template has no `{banner}` tag, the notice is inserted at the top.",
    "No expressions or calculations are evaluated: a tag is only ever looked up by name.",
    "",
    "## Text tags",
    "",
    "| Tag | Meaning |",
    "| --- | --- |",
    ...TAG_REFERENCE.filter((t) => t.kind === "text").map((t) => `| \`{${t.tag}}\`${t.recommended ? " (recommended)" : ""} | ${t.description} |`),
    "",
    "## Loops",
  ];
  for (const t of TAG_REFERENCE.filter((x) => x.kind === "loop")) {
    out.push("", `### \`{#${t.tag}}\` ... \`{/${t.tag}}\`${t.recommended ? " (recommended)" : ""}`, "", t.description, "", "| Field | Meaning |", "| --- | --- |", ...(t.fields ?? []).map((x) => `| \`{${x.name}}\` | ${x.description} |`));
  }
  out.push("", "## Raw tags", "", "| Tag | Meaning |", "| --- | --- |", ...TAG_REFERENCE.filter((t) => t.kind === "raw").map((t) => `| \`{@${t.tag}}\` | ${t.description} |`), "");
  return out.join("\n");
}
