import { describeVerification, getEntry, resolveEntry, verificationState, type Project } from "@gap/process-model";
import { activityLabel, categoryLabel, type ContentBundle } from "./content";
import { buildEquipmentQualification, buildValidationPlan, type PlanRow } from "./validation";
import { CATEGORIES } from "./content-schema";
import type { Assessment, Gap } from "./compare";
import { riskRanked } from "./compare";
import { formatQuestionSide, formatResolved, questionLabel, STATUS_TEXT } from "./format";
import { instanceRefs, type QuestionInstance } from "./sequencer";
import { entryLabel, sourceShort } from "./labels";
import { cellVerification, verificationSummary } from "./verification";
import { sourceRegisterRows } from "./source-register";
import { changeLogActionCounts } from "./changelog";
import { effectiveContent } from "./custom";

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "note"; text: string };

export interface DocSection {
  id: string;
  /** "1", "2", ... for sections; "A", "B", ... for appendices. */
  number: string;
  appendix?: boolean;
  title: string;
  blocks: Block[];
}

export interface DocModel {
  title: string;
  banner: string;
  status: string;
  meta: [string, string][];
  sections: DocSection[];
}

const SEVERITY_TEXT = { high: "High", medium: "Medium", low: "Low", none: "None" } as const;

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

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Combined verification state of the entries behind a row (see cellVerification). */
export function verificationText(project: Project, refs: string[]): string {
  return cellVerification(project, refs).text;
}

/** Verification of the entries on one side among a gap's inputs; "—" when the gap uses none from that side. */
function sideVerificationText(project: Project, refs: string[], side: "source" | "target"): string {
  const mine = refs.filter((r) => r.startsWith(`${side}.`));
  return mine.length ? verificationText(project, mine) : "—";
}

function sourcesText(project: Project, refs: string[]): string {
  const ids = new Set(refs.flatMap((r) => getEntry(project, r)?.sourceIds ?? []));
  const labels = project.sources.filter((s) => ids.has(s.id)).map(sourceShort);
  return [...new Set(labels)].join("; ") || "—";
}

function sideRows(content: ContentBundle, project: Project, insts: QuestionInstance[]): string[][] {
  return insts.map((i) => {
    const refs = instanceRefs(i);
    return [questionLabel(i.question), formatQuestionSide(content, project, i.question, i.side), sourcesText(project, refs), verificationText(project, refs)];
  });
}

function severityText(g: Gap): string {
  if (g.severityOverride) {
    return `${SEVERITY_TEXT[g.severity]} (adjusted from ${SEVERITY_TEXT[g.ruleSeverity]} by ${g.severityOverride.by}: ${g.severityOverride.justification})`;
  }
  return SEVERITY_TEXT[g.severity];
}

const STATUS_LABEL = { open: "Open", in_progress: "In progress", closed: "Closed", accepted_no_action: "Accepted, no action" } as const;

/** Builds the structured gap assessment document. Renderers turn it into Markdown or HTML. */
export function buildDocument(content: ContentBundle, project: Project, a: Assessment, generatedAt: string): DocModel {
  const t = content.templates.document;
  const vars: Record<string, string> = {
    program: scopeText(content, project, "program"),
    modality: scopeText(content, project, "modality"),
    dosageForm: scopeText(content, project, "dosage_form"),
    presentation: scopeText(content, project, "presentation"),
    transferType: scopeText(content, project, "transfer_type"),
    markets: scopeText(content, project, "markets"),
    sourceSite: siteText(project, "source"),
    targetSite: siteText(project, "target"),
    date: shortDate(generatedAt),
  };
  const diffs = a.gaps.filter((g) => g.category !== "equivalent");
  const sections: DocSection[] = [];
  let n = 0;
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(++n), title, blocks });

  add("purpose", "Purpose", [{ type: "paragraph", text: fill(t.purpose, vars) }]);

  const scoping = a.instances.filter((i) => i.side === "shared");
  add("scope", "Scope", [
    { type: "paragraph", text: fill(t.scope, vars) },
    { type: "table", columns: ["Scoping attribute", "Response", "Source", "Verification"], rows: sideRows(content, project, scoping) },
  ]);

  const sectionBlocks = (side: "source" | "target"): Block[] => {
    const blocks: Block[] = [];
    for (const sec of content.sections) {
      if (sec.kind === "scoping") continue;
      const insts = a.instances.filter((i) => i.section.id === sec.id && i.side === side);
      if (!insts.length) continue;
      blocks.push({ type: "heading", text: sec.title });
      blocks.push({ type: "table", columns: ["Attribute", side === "source" ? "Validated state" : "Planned state", "Source", "Verification"], rows: sideRows(content, project, insts) });
    }
    return blocks;
  };
  add("source-summary", "Source program summary (validated state)", [{ type: "paragraph", text: fill(t.sourceSummaryIntro, vars) }, ...sectionBlocks("source")]);
  add("target-summary", "Target summary (planned state)", [{ type: "paragraph", text: fill(t.targetSummaryIntro, vars) }, ...sectionBlocks("target")]);

  const secsWithGaps = content.sections.filter((s) => a.gaps.some((g) => g.sectionId === s.id));
  const cats = CATEGORIES;
  const diffBlocks: Block[] = [
    { type: "paragraph", text: fill(t.differencesIntro, vars) },
    {
      type: "table",
      columns: ["Section", ...cats.map((c) => categoryLabel(content, c))],
      rows: secsWithGaps.map((s) => [s.title, ...cats.map((c) => String(a.gaps.filter((g) => g.sectionId === s.id && g.category === c).length))]),
    },
  ];
  for (const s of secsWithGaps) {
    const items = diffs.filter((g) => g.sectionId === s.id).map((g) => `${g.displayId} ${g.attribute}: ${categoryLabel(content, g.category)}. ${g.detail}`);
    if (items.length) {
      diffBlocks.push({ type: "heading", text: s.title });
      diffBlocks.push({ type: "list", items });
    }
  }
  add("differences", "Summary of differences by unit operation", diffBlocks);

  add("gap-table", "Detailed gap table", [
    { type: "paragraph", text: fill(t.gapTableIntro, vars) },
    {
      type: "table",
      columns: ["ID", "Section", "Attribute", "Source", "Target", "Category", "Why it matters", "Activities implied", "Severity", "Regulatory", "Owner", "Status", "Rule", "Source verification", "Target verification"],
      rows: diffs.map((g) => [
        g.displayId,
        g.sectionTitle,
        g.attribute,
        g.sourceDisplay,
        g.targetDisplay,
        `${categoryLabel(content, g.category)}. ${g.detail}`,
        g.rationale,
        g.activities.map((x) => activityLabel(content, x)).join("; ") || "—",
        severityText(g),
        g.regulatoryNote ?? "—",
        g.owner ?? "[unassigned]",
        STATUS_LABEL[g.status],
        `${g.ruleId} v${g.ruleVersion}`,
        sideVerificationText(project, g.inputRefs, "source"),
        sideVerificationText(project, g.inputRefs, "target"),
      ]),
    },
    { type: "note", text: t.regulatoryStatement },
  ]);

  const plan = buildValidationPlan(content, project, a);
  const gapIds = (r: PlanRow) => r.gaps.map((g) => (g.status === "open" ? g.displayId : `${g.displayId} (${STATUS_LABEL[g.status]})`)).join(", ");
  const studyCell = (r: PlanRow, side: "source" | "target") =>
    r.studies.length
      ? r.studies
          .map((s) => {
            const v = s[side].entry === "not_asked" ? "" : ` [${verificationText(project, [`${side}.uo.${s.uoKey}.study.${s.key}.status`])}]`;
            return `${s.label} (${s.uoLabel}): ${s[side].display}${v}`;
          })
          .join("; ")
      : "—";
  add("validation-plan", "Validation plan", [
    { type: "paragraph", text: fill(t.activitiesIntro, vars) },
    {
      type: "table",
      columns: ["Activity", "Description", "Implied by gaps", "Severity", "Regulatory", "Linked studies: source status", "Linked studies: target status", "Readiness"],
      rows: plan.map((r) => [
        r.label,
        r.description,
        gapIds(r),
        SEVERITY_TEXT[r.severity],
        r.regulatoryNote ?? "—",
        studyCell(r, "source"),
        studyCell(r, "target"),
        r.readinessLabel,
      ]),
    },
  ]);

  const equipment = buildEquipmentQualification(content, project, a);
  const withStatus = (display: string, entry: string, refs: string[]) => (entry === "not_asked" || !refs.length ? display : `${display} [${verificationText(project, refs)}]`);
  add("equipment-qualification", "Equipment qualification comparison", [
    { type: "paragraph", text: fill(t.equipmentQualificationIntro, vars) },
    equipment.length
      ? {
          type: "table",
          columns: ["Unit operation", "Equipment", "Source qualification", "Target qualification", "Qualified range (target)", "Required by target process", "Related gaps"],
          rows: equipment.map((e) => [
            e.uoLabel,
            e.equipLabel,
            withStatus(e.source.display, e.source.entry, [`source.uo.${e.uoKey}.equip.${e.equipKey}.qualificationStatus`]),
            withStatus(e.target.display, e.target.entry, [`target.uo.${e.uoKey}.equip.${e.equipKey}.qualificationStatus`]),
            e.ranges.map((x) => `${x.attribute}: ${withStatus(x.qualified.display, x.qualified.entry, [x.ref])}`).join("; ") || "—",
            e.ranges
              .map((x) => (x.required ? `${x.attribute}: ${withStatus(x.required.display, x.required.entry, x.requiredRefs ?? [])} (${x.required.basis})` : `${x.attribute}: not derived`))
              .join("; ") || "—",
            e.gaps.map((g) => `${g.displayId} (${categoryLabel(content, g.category)})`).join(", ") || "—",
          ]),
        }
      : { type: "paragraph", text: "No equipment qualification information has been recorded." },
  ]);

  add("open-items", "Open information items", [
    { type: "paragraph", text: fill(t.openItemsIntro, vars) },
    a.openItems.length
      ? {
          type: "table",
          columns: ["No.", "Section", "Side", "Question", "Status"],
          rows: a.openItems.map((o, i) => [String(i + 1), o.sectionTitle, o.side === "shared" ? "Scoping" : o.side === "source" ? "Source" : "Target", o.prompt, STATUS_TEXT[o.status]]),
        }
      : { type: "paragraph", text: "No open information items." },
  ]);

  const ranked = riskRanked(a.gaps);
  add("risk", "Risk ranking", [
    { type: "paragraph", text: fill(t.riskIntro, vars) },
    {
      type: "table",
      columns: ["Rank", "ID", "Attribute", "Category", "Severity", "Regulatory"],
      rows: ranked.map((g, i) => [String(i + 1), g.displayId, `${g.sectionTitle}: ${g.attribute}`, categoryLabel(content, g.category), severityText(g), g.regulatoryNote ? "Yes" : "No"]),
    },
  ]);

  const vs = verificationSummary(content, project);
  const sideName = { shared: "Scoping", source: "Source", target: "Target" } as const;
  const countRow = (name: string, side: string, c: { total: number; verified: number; withdrawn: number; unverified: number; notVerifiable: number }) => [
    name,
    side,
    String(c.total),
    String(c.verified),
    String(c.withdrawn),
    String(c.unverified),
    String(c.notVerifiable),
  ];
  const activeRefsList = [...new Set(a.instances.flatMap((i) => instanceRefs(i)))];
  const eff = effectiveContent(content, project);
  const withdrawnItems: string[] = [];
  const selfItems: string[] = [];
  for (const ref of activeRefsList) {
    const st = verificationState(project, ref);
    if (st.state === "unverified") continue;
    const text = `${entryLabel(eff, project, ref).text}: ${describeVerification(st)}`;
    if (st.state === "withdrawn") withdrawnItems.push(text);
    else if (st.selfVerification) selfItems.push(text);
  }
  const vsBlocks: Block[] = [
    { type: "paragraph", text: fill(t.verificationStatusIntro, vars) },
    {
      type: "table",
      columns: ["Section", "Side", "Entries", "Verified", "Verification withdrawn", "Unverified", "Not verifiable"],
      rows: [
        ...vs.rows.map((r) => countRow(r.sectionTitle, sideName[r.side], r.counts)),
        ...(["shared", "source", "target"] as const).filter((sd) => vs.bySide[sd].total > 0).map((sd) => countRow("All sections", sideName[sd], vs.bySide[sd])),
        countRow("All sections", "Scoping, source and target", vs.all),
      ],
    },
  ];
  if (withdrawnItems.length) vsBlocks.push({ type: "heading", text: "Entries with a withdrawn verification" }, { type: "list", items: withdrawnItems });
  if (selfItems.length) vsBlocks.push({ type: "heading", text: "Entries verified by the person who recorded them" }, { type: "list", items: selfItems });
  vsBlocks.push({ type: "note", text: t.identityStatement });
  add("verification-status", "Verification status", vsBlocks);

  // References: every source cited by an active entry, plus the content versions used.
  const activeIds = new Set(a.instances.flatMap((i) => instanceRefs(i)).flatMap((r) => getEntry(project, r)?.sourceIds ?? []));
  const cited = project.sources.filter((s) => activeIds.has(s.id));
  const docs = cited.filter((s) => s.type === "document_reference");
  const interviews = cited.filter((s) => s.type === "interview_answer");
  const others = cited.filter((s) => s.type !== "document_reference" && s.type !== "interview_answer");
  const responders = new Map<string, { role?: string; dates: Set<string>; count: number }>();
  for (const s of interviews) {
    const k = s.responder?.name ?? "unknown responder";
    const r = responders.get(k) ?? { role: s.responder?.role, dates: new Set<string>(), count: 0 };
    r.dates.add(shortDate(s.date));
    r.count++;
    responders.set(k, r);
  }
  const refRows: string[][] = [
    ...docs.map((s) => [s.docRef!.identifier, s.docRef!.docType, s.docRef!.title ?? s.label, s.docRef!.version ?? "—"]),
    ...[...responders].map(([name, r]) => [`Interview: ${name}`, "Interview answers", `${r.count} answers${r.role ? `; ${r.role}` : ""}; ${[...r.dates].sort().join(", ")}`, "—"]),
    ...others.map((s) => [s.label, s.type, s.file?.name ?? "—", "—"]),
    ["Question bank", "Tool content", `Version ${content.versions.questions}`, content.versions.questions],
    ["Comparison rules", "Tool content", `Version ${content.versions.rules}`, content.versions.rules],
    ["Catalog", "Tool content", `Version ${content.versions.catalog}`, content.versions.catalog],
  ];
  add("references", "References", [
    { type: "paragraph", text: fill(t.referencesIntro, vars) },
    { type: "table", columns: ["Reference", "Type", "Description", "Version"], rows: refRows },
  ]);

  add("approval", "Approval", [
    { type: "paragraph", text: fill(t.approvalIntro, vars) },
    { type: "table", columns: ["Role", "Name", "Signature", "Date"], rows: t.approvalRoles.map((r) => [r, "[placeholder]", "[placeholder]", "[placeholder]"]) },
  ]);

  const appendix = (id: string, title: string, blocks: Block[]) =>
    sections.push({ id, number: String.fromCharCode(65 + sections.filter((x) => x.appendix).length), appendix: true, title, blocks });

  // Entries that are no longer asked about (inactive) are counted, not listed: the document shows only current values.
  const citedBy = (citing: { text: string; active: boolean }[]) => {
    const act = citing.filter((c) => c.active).map((c) => c.text);
    const hidden = citing.length - act.length;
    const parts = [...act];
    if (hidden) parts.push(`${hidden} recorded value${hidden === 1 ? "" : "s"} not currently asked about`);
    return parts.join("; ") || "—";
  };
  const allRegister = sourceRegisterRows(content, project);
  // A source that only supports recorded values no longer asked about is not listed (the document shows only current values).
  const register = allRegister.filter((r) => r.state !== "in_use" || r.citing.some((c) => c.active));
  const omitted = allRegister.length - register.length;
  appendix("source-register", "Source register", [
    { type: "paragraph", text: fill(t.sourceRegisterIntro, vars) },
    register.length
      ? {
          type: "table",
          columns: ["ID", "Type", "Identifier, title, version", "Responder", "Date", "State", "Cited by"],
          rows: register.map((r, i) => [
            `S-${String(i + 1).padStart(3, "0")}`,
            r.typeLabel,
            r.source.docRef ? [r.source.docRef.identifier, r.source.docRef.title, r.source.docRef.version ? `version ${r.source.docRef.version}` : ""].filter(Boolean).join(", ") : r.source.label,
            r.responder,
            r.date,
            r.stateText,
            citedBy(r.citing),
          ]),
        }
      : { type: "paragraph", text: "No sources have been recorded." },
    ...(omitted
      ? [{ type: "note" as const, text: `${omitted} further source${omitted === 1 ? "" : "s"} support${omitted === 1 ? "s" : ""} only recorded values that are not currently asked about; ${omitted === 1 ? "it is" : "they are"} kept in the project file and not listed here.` }]
      : []),
  ]);

  const counts = changeLogActionCounts(project);
  appendix("change-log-summary", "Change log summary", [
    { type: "paragraph", text: fill(t.changeLogSummaryIntro, vars) },
    counts.length
      ? { type: "table", columns: ["Change", "Count"], rows: [...counts.map((c) => [c.label, String(c.count)]), ["Total", String(project.changeLog.length)]] }
      : { type: "paragraph", text: "No changes have been recorded." },
  ]);

  return {
    title: fill(t.title, vars),
    banner: t.banner,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Differences identified", String(diffs.length)],
      ["Open information items", String(a.openItems.length)],
      ["Entries verified", `${vs.all.verified} of ${vs.all.total}`],
      ["Verification", t.verificationStatement],
    ],
    sections,
  };
}
