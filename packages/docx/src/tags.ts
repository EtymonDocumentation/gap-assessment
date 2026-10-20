import { DOCUMENT_SECTION_IDS, categoryLabel, formatResolved, stageWording, stagedFor, type Assessment, type ContentBundle, type DocModel } from "@gap/engine";
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
  revision: string;
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
  revisions: { number: string; status: string; date: string; by: string; summary: string; template: string }[];
  comments: { id: string; location: string; comment: string; by: string; date: string; status: string; responses: string }[];
  meta: { label: string; value: string }[];
  sections: { number: string; title: string }[];
}

type Table = { columns: string[]; rows: string[][] };

/** The first table of a document section, or undefined (for example when the section only says "No open information items."). */
function tableOf(doc: DocModel, sectionId: string): Table | undefined {
  const b = doc.sections.find((s) => s.id === sectionId)?.blocks.find((x) => x.type === "table");
  return b && b.type === "table" ? { columns: b.columns, rows: b.rows } : undefined;
}

/** Rows of a section's table as objects: `fields` maps a tag field name to the table column it comes from. */
function rowsAs<K extends string>(doc: DocModel, sectionId: string, fields: Record<K, string>): Record<K, string>[] {
  const t = tableOf(doc, sectionId);
  if (!t) return [];
  const idx = (Object.entries(fields) as [K, string][]).map(([k, col]) => [k, t.columns.indexOf(col)] as const);
  return t.rows.map((r) => Object.fromEntries(idx.map(([k, i]) => [k, i < 0 ? "" : (r[i] ?? "")])) as Record<K, string>);
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

/** Everything a Word template can use. Values are the strings the HTML and Markdown documents show (taken from the DocModel tables). */
export function buildTagData(rawContent: ContentBundle, project: Project, a: Assessment, doc: DocModel): TagData {
  const content = stagedFor(rawContent, project);
  const stages = stageWording(project);
  const gapRows = rowsAs(doc, "gap-table", {
    id: "ID",
    section: "Section",
    attribute: "Attribute",
    source: "Source",
    target: "Target",
    categoryCell: "Category",
    why: "Why it matters",
    activities: "Activities implied",
    severity: "Severity",
    regulatory: "Regulatory",
    owner: "Owner",
    status: "Status",
    rule: "Rule",
    sourceVerification: "Source verification",
    targetVerification: "Target verification",
  });
  const gaps: GapTag[] = gapRows.map((r) => {
    const g = a.gaps.find((x) => x.displayId === r.id);
    const { categoryCell, ...rest } = r;
    return { ...rest, category: g ? categoryLabel(content, g.category) : categoryCell, detail: g ? g.detail : "" };
  });
  return {
    title: doc.title,
    banner: doc.banner,
    status: doc.status,
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
    revision: metaValue(doc, "Revision"),
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
      sourceStudies: "Linked studies: source status",
      targetStudies: "Linked studies: target status",
      readiness: "Readiness",
    }),
    equipment: rowsAs(doc, "equipment-qualification", {
      uo: "Unit operation",
      equipment: "Equipment",
      sourceQualification: "Source qualification",
      targetQualification: "Target qualification",
      qualifiedRange: "Qualified range (target)",
      required: "Required by target process",
      relatedGaps: "Related gaps",
    }),
    risks: rowsAs(doc, "risk", { rank: "Rank", id: "ID", attribute: "Attribute", category: "Category", severity: "Severity", regulatory: "Regulatory" }),
    sources: rowsAs(doc, "source-register", { id: "ID", type: "Type", identifier: "Identifier, title, version", responder: "Responder", date: "Date", state: "State", citedBy: "Cited by" }),
    approvals: rowsAs(doc, "approval", { role: "Role", name: "Name", signature: "Signature", date: "Date" }),
    revisions: rowsAs(doc, "revision-history", { number: "Revision", status: "Status", date: "Date", by: "By", summary: "Summary of change", template: "Template" }),
    comments: rowsAs(doc, "reviewer-comments", { id: "ID", location: "Location", comment: "Comment", by: "By", date: "Date", status: "Status", responses: "Responses" }),
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
  ["sourceSite", "Source site (name and line)."],
  ["targetSite", "Target (receiving) site (name and line)."],
  ["sourceStage", "Program stage of the source: Commercial (process validated), Clinical (GMP, not process validated), Development / engineering runs, or [not established]."],
  ["targetStage", "Program stage of the target, with the same values as sourceStage."],
  ["generated", "Date and time the document was generated (UTC)."],
  ["revision", "Revision line: \"Not yet issued\" or the latest issued revision and its status."],
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
      f("source", "Source value."),
      f("target", "Target value."),
      f("category", "Category of the difference."),
      f("detail", "Explanation of the difference. The document shows category and detail together as \"<category>. <detail>\"."),
      f("why", "Why it matters."),
      f("activities", "Activities implied."),
      f("severity", "Severity."),
      f("regulatory", "Regulatory note (\"Requires regulatory affairs assessment\" or a dash)."),
      f("owner", "Owner, or \"[unassigned]\"."),
      f("status", "Status."),
      f("rule", "Comparison rule and version."),
      f("sourceVerification", "Verification state of the source inputs."),
      f("targetVerification", "Verification state of the target inputs."),
    ],
  },
  { tag: "openItems", description: "Open information items.", fields: [f("no", "Number."), f("section", "Section."), f("side", "Scoping, Source or Target."), f("question", "The question still to be answered."), f("status", "Status.")] },
  {
    tag: "activities",
    description: "Validation plan activities.",
    fields: [
      f("activity", "Activity."),
      f("description", "Description."),
      f("gaps", "Gaps that imply the activity."),
      f("severity", "Severity."),
      f("regulatory", "Regulatory note."),
      f("sourceStudies", "Linked studies, source status."),
      f("targetStudies", "Linked studies, target status."),
      f("readiness", "Readiness."),
    ],
  },
  {
    tag: "equipment",
    description: "Equipment qualification comparison.",
    fields: [
      f("uo", "Unit operation."),
      f("equipment", "Equipment."),
      f("sourceQualification", "Source qualification."),
      f("targetQualification", "Target qualification."),
      f("qualifiedRange", "Qualified range (target)."),
      f("required", "Required by the target process."),
      f("relatedGaps", "Related gaps."),
    ],
  },
  { tag: "risks", description: "Risk ranking, highest first.", fields: [f("rank", "Rank."), f("id", "Gap ID."), f("attribute", "Attribute."), f("category", "Category."), f("severity", "Severity."), f("regulatory", "Regulatory (Yes or No).")] },
  {
    tag: "sources",
    description: "Source register (Appendix A).",
    fields: [f("id", "Source ID."), f("type", "Type."), f("identifier", "Identifier, title, version."), f("responder", "Responder."), f("date", "Date."), f("state", "State."), f("citedBy", "Cited by.")],
  },
  { tag: "approvals", description: "Approval lines. The name, signature and date stay as placeholders: the tool has no electronic signature.", fields: [f("role", "Role."), f("name", "Name (placeholder)."), f("signature", "Signature (placeholder)."), f("date", "Date (placeholder).")] },
  { tag: "revisions", description: "Revision history (empty when nothing has been issued).", fields: [f("number", "Revision number."), f("status", "Draft or Issued for review."), f("date", "Date."), f("by", "Who issued it."), f("summary", "Summary of the change."), f("template", "Template used.")] },
  {
    tag: "comments",
    description: "Reviewer comments (empty when there are none).",
    fields: [f("id", "Comment ID, for example C-001."), f("location", "Where in the document."), f("comment", "The comment."), f("by", "Author."), f("date", "Date."), f("status", "Open or Resolved."), f("responses", "Replies and resolutions.")],
  },
  { tag: "meta", description: "The document-details lines (project, generated, counts, verification).", fields: [f("label", "Line name."), f("value", "Line value.")] },
  { tag: "sections", description: "Section numbers and titles (for a table of contents).", fields: [f("number", "Section number or \"Appendix A\"."), f("title", "Section title.")] },
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
    top: new Set(TAG_REFERENCE.map((t) => t.tag)),
    loopFields: new Map(TAG_REFERENCE.filter((t) => t.kind === "loop").map((t) => [t.tag, new Set((t.fields ?? []).map((x) => x.name))])),
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
