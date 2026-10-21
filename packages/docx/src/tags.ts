import { DOCUMENT_SECTION_IDS, activityLabel, categoryLabel, formatResolved, stageWording, stagedFor, type Assessment, type ContentBundle, type DocModel } from "@gap/engine";
import { resolveEntry, type Project } from "@gap/process-model";

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
  targetStage: string;
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
  meta: { label: string; value: string }[];
  sections: { number: string; title: string }[];
}

type Table = { columns: string[]; rows: string[][] };

/** The first table of a document section, or undefined (for example when the section only says "No open information items."). */
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
  return r.status === "established" ? formatResolved(content, q, r) : "[not established]";
}

function siteText(project: Project, side: "source" | "target"): string {
  const name = resolveEntry(project, `${side}.site.name`);
  const line = resolveEntry(project, `${side}.site.line`);
  const n = name.status === "established" ? String(name.value) : "[site not established]";
  return line.status === "established" ? `${n}, ${String(line.value)}` : n;
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
    program: scopeText(content, project, "program"),
    modality: scopeText(content, project, "modality"),
    dosageForm: scopeText(content, project, "dosage_form"),
    presentation: scopeText(content, project, "presentation"),
    transferType: scopeText(content, project, "transfer_type"),
    markets: scopeText(content, project, "markets"),
    sourceSite: siteText(project, "source"),
    targetSite: siteText(project, "target"),
    sourceStage: stages.sourceLabel,
    targetStage: stages.targetLabel,
    generated: metaValue(doc, "Generated"),
    regulatoryStatement: noteIn(doc, "gap-table"),
    verificationStatement: metaValue(doc, "Verification"),
    identityStatement: noteIn(doc, "verification-status"),
    differencesCount: metaValue(doc, "Differences identified"),
    openItemsCount: metaValue(doc, "Open information items"),
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
    meta: doc.meta.map(([label, value]) => ({ label, value })),
    sections: doc.sections.map((s) => ({ number: s.appendix ? `Appendix ${s.number}` : s.number, title: s.title })),
  };
}

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
  ["banner", "The proof-of-concept banner: \"Proof of concept. Not validated. Not for GMP use.\" The banner is always added to the document, even when the template has no banner tag.", true],
  ["title", "Document title.", true],
  ["status", "Document status (DRAFT)."],
  ["program", "Program name from the scoping answers.", true],
  ["modality", "Modality."],
  ["dosageForm", "Dosage form."],
  ["presentation", "Presentation."],
  ["transferType", "Type of transfer."],
  ["markets", "Markets."],
  ["sourceSite", "Sending unit (SU) site (name and line)."],
  ["targetSite", "Receiving unit (RU) site (name and line)."],
  ["sourceStage", "Program stage of the sending unit (SU): Commercial (process validated), Clinical (GMP, not process validated), Development / engineering runs, or [not established]."],
  ["targetStage", "Program stage of the receiving unit (RU), with the same values as sourceStage."],
  ["generated", "Date and time the document was generated (UTC)."],
  ["regulatoryStatement", "The statement under the gap table that regulatory consequences need review. The tool never decides a filing category; it only says \"Requires regulatory affairs assessment\"."],
  ["verificationStatement", "The statement about data verification."],
  ["identityStatement", "The statement that explains how verifier identity is recorded."],
  ["differencesCount", "Number of differences identified."],
  ["openItemsCount", "Number of open information items."],
  ["verifiedSummary", "Entries verified, for example \"12 of 40\"."],
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
  { tag: "openItems", description: "Open information items.", fields: [f("no", "Number."), f("section", "Section."), f("side", "Scoping, SU or RU."), f("question", "The question still to be answered."), f("status", "Status.")] },
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
    "> Proof of concept. Not validated. Not for GMP use.",
    "",
    "Write a tag in your Word template where the value should appear, for example `{title}`. Type each tag in one go (do not change the formatting in the middle of a tag).",
    "",
    "- **Text tag**: `{name}` is replaced by the value. A value that is not available shows `[not available]`.",
    "- **Loop**: `{#gaps}` ... `{/gaps}` repeats what is between the two tags once per item. To repeat a table row, put `{#gaps}` in the first cell and `{/gaps}` in the last cell of that row. Inside the loop use the item's fields, for example `{id}` and `{attribute}`.",
    "- **Raw tag**: `{@body}` or `{@section_gap_table}` inserts whole sections in the tool's look, using your heading, table and list styles. Put it alone in its own paragraph.",
    "",
    "The proof-of-concept banner is always added to the document. If the template has no `{banner}` tag, the banner is inserted at the top.",
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
