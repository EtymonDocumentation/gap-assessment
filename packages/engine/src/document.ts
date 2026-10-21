import { describeVerification, getEntry, resolveEntry, verificationState, type Project } from "@gap/process-model";
import { activityLabel, categoryLabel, type ContentBundle } from "./content";
import { buildEquipmentQualification, buildValidationPlan, PROVISIONAL_LABEL, type PlanRow } from "./validation";
import { tbdItems, tbdStatusText } from "./tbd";
import { CATEGORIES } from "./content-schema";
import type { Assessment, Gap } from "./compare";
import { riskRanked } from "./compare";
import { formatQuestionSide, formatResolved, questionLabel, STATUS_TEXT } from "./format";
import { scopeExclusions } from "./tailoring";
import { stepExclusions } from "./scope";
import { instanceRefs, type QuestionInstance } from "./sequencer";
import { citationNames, entryLabel, locationText, sourceLabel } from "./labels";
import { cellVerification, verificationSummary } from "./verification";
import { sourceRegisterRows } from "./source-register";
import { changeLogActionCounts } from "./changelog";
import { effectiveStaged } from "./custom";
import { omittedSectionIds, optionalSectionTitle } from "./review";
import { STAGE_NOT_ESTABLISHED, stageBasis, stagedFor, stageWording } from "./stage";

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

export interface DocCover {
  /** Program or product code, e.g. "ARX-217". */
  program: string;
  /** Modality, dosage form and presentation joined with ", ". */
  product: string;
  /** Site name and line, as in the document header. */
  sourceSite: string;
  targetSite: string;
  /** Program stage label per side, e.g. "Commercial (process validated)". */
  sourceStage: string;
  targetStage: string;
}

export interface DocModel {
  title: string;
  banner: string;
  status: string;
  meta: [string, string][];
  /** Facts for renderers that draw a cover page (the built-in Word template). Values not established read "[not established]". */
  cover: DocCover;
  sections: DocSection[];
  /** How many TBD values the document lists as open items (also the "TBD values" line). Date-independent by design. */
  tbdCount: number;
}

const SEVERITY_TEXT = { high: "High", medium: "Medium", low: "Low", none: "None" } as const;

function scopeText(content: ContentBundle, project: Project, key: string): string {
  const q = content.questions.find((x) => x.binds === `scope.${key}`);
  const r = resolveEntry(project, `scope.${key}`);
  return r.status === "established" ? formatResolved(content, q, r) : STAGE_NOT_ESTABLISHED;
}

function siteText(project: Project, side: "source" | "target"): string {
  const name = resolveEntry(project, `${side}.site.name`);
  const line = resolveEntry(project, `${side}.site.line`);
  const n = name.status === "established" ? String(name.value) : "[site not established]";
  return line.status === "established" ? `${n}, ${String(line.value)}` : n;
}

/** Where labelling and secondary packaging happen for one side, in words for the Scope section. */
export function labellingScopeText(content: ContentBundle, project: Project, side: "source" | "target"): string {
  const loc = resolveEntry(project, `${side}.site.labellingLocation`);
  if (loc.status !== "established") return `${STAGE_NOT_ESTABLISHED}: where labelling and secondary packaging are done is an open item.`;
  if (loc.value === "this_site") return "done at this site and assessed in the labelling and packaging section.";
  const where = resolveEntry(project, `${side}.site.labellingSite`);
  const name = where.status === "established" ? ` (${String(where.value)})` : "";
  return `out of scope: labelling and secondary packaging are done at another site${name}; they are not assessed here.`;
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
  // Documents first: when a document backs the value, only the documents are shown (see displaySources).
  // Each carries the place it was cited at, when one was recorded.
  return citationNames(project, refs).join("; ") || "—";
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
/** The register number the document prints for the i-th listed source (S-001, S-002, ...). */
export function sourceRegisterRef(i: number): string {
  return `S-${String(i + 1).padStart(3, "0")}`;
}

/** The sources the document's register lists, in its order. */
function documentSourceRegister(all: ReturnType<typeof sourceRegisterRows>): ReturnType<typeof sourceRegisterRows> {
  // A source that only supports recorded values no longer asked about is not listed (the document shows only current values).
  return all.filter((r) => r.state !== "in_use" || r.citing.some((c) => c.active));
}

/**
 * Source id -> the register number the gap assessment document gives it. The TRD outline cites the same numbers, so a
 * reader moving between the two documents finds the same source under the same number. `content` must be the staged
 * content the document is built from.
 */
export function documentSourceRefs(content: ContentBundle, project: Project): Map<string, string> {
  return new Map(documentSourceRegister(sourceRegisterRows(content, project)).map((r, i) => [r.source.id, sourceRegisterRef(i)]));
}

export function buildDocument(rawContent: ContentBundle, project: Project, a: Assessment, generatedAt: string): DocModel {
  // Texts, headings and labels follow the program stage of the source (see stage.ts).
  const content = stagedFor(rawContent, project);
  const w = stageWording(project);
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
    sourceStage: w.sourceLabel,
    targetStage: w.targetLabel,
    date: shortDate(generatedAt),
  };
  const diffs = a.gaps.filter((g) => g.category !== "equivalent");
  const sections: DocSection[] = [];
  // Optional sections the user left out are not built at all, so section numbers and appendix letters close up.
  const omittedIds = omittedSectionIds(project);
  const omitted = new Set(omittedIds);
  let n = 0;
  const add = (id: string, title: string, blocks: Block[]) => {
    if (omitted.has(id)) return;
    sections.push({ id, number: String(++n), title, blocks });
  };

  add("purpose", "Purpose", [{ type: "paragraph", text: fill(t.purpose, vars) }]);

  const scoping = a.instances.filter((i) => i.side === "shared");
  // What is out of scope is stated in the document itself (GMP: a reader must not assume labelling or a topic was assessed
  // when it was not). Both blocks sit inside the Scope section so section numbers stay stable.
  const exclusions = scopeExclusions(content, project);
  const steps = stepExclusions(content, project);
  const noReason = "No reason recorded";
  const scopeBlocks: Block[] = [
    { type: "paragraph", text: fill(t.scope, vars) },
    { type: "table", columns: ["Scoping attribute", "Response", "Source", "Verification"], rows: sideRows(content, project, scoping) },
    { type: "heading", text: "Labelling and secondary packaging" },
    { type: "list", items: (["source", "target"] as const).map((side) => `${side === "source" ? "SU" : "RU"}: ${labellingScopeText(content, project, side)}`) },
    { type: "heading", text: "Scope exclusions" },
  ];
  if (steps.length) {
    scopeBlocks.push(
      { type: "paragraph", text: "The following process steps were left out of this assessment, for both SU and RU. They are not compared and not part of the gap table or the validation plan. Values recorded for them are kept in the project and return when the step is put back in scope." },
      {
        type: "table",
        columns: ["Process step left out", "Reason", "Recorded by", "Date"],
        rows: steps.map((e) => [e.uoLabel, e.reason ?? noReason, e.by, shortDate(e.at)]),
      },
    );
  } else {
    scopeBlocks.push({ type: "paragraph", text: "No process steps were left out of this assessment." });
  }
  if (exclusions.length) {
    scopeBlocks.push(
      { type: "paragraph", text: "The following topics were switched off for this assessment. They are not compared and not part of the gap table or the validation plan. Values recorded for them are kept in the project and return when the topic is switched on again." },
      {
        type: "table",
        columns: ["Section", "Topic left out", "Reason", "Recorded by", "Date"],
        rows: exclusions.map((e) => [e.uoLabel, e.topicLabel, e.reason ?? noReason, e.by, shortDate(e.at)]),
      },
    );
  } else {
    scopeBlocks.push({ type: "paragraph", text: "No topics were left out of this assessment." });
  }
  add("scope", "Scope", scopeBlocks);

  const sectionBlocks = (side: "source" | "target"): Block[] => {
    const blocks: Block[] = [];
    for (const sec of content.sections) {
      if (sec.kind === "scoping") continue;
      const insts = a.instances.filter((i) => i.section.id === sec.id && i.side === side);
      if (!insts.length) continue;
      blocks.push({ type: "heading", text: sec.title });
      blocks.push({ type: "table", columns: ["Attribute", side === "source" ? w.sourceStateColumn : "Planned state", "Source", "Verification"], rows: sideRows(content, project, insts) });
    }
    return blocks;
  };
  add("source-summary", w.sourceSummaryHeading, [{ type: "paragraph", text: fill(t.sourceSummaryIntro, vars) }, ...sectionBlocks("source")]);
  add("target-summary", w.targetSummaryHeading, [{ type: "paragraph", text: fill(t.targetSummaryIntro, vars) }, ...sectionBlocks("target")]);

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
    const items = diffs.filter((g) => g.sectionId === s.id).map((g) => `${g.displayId} ${g.attribute}: ${categoryLabel(content, g.category)}. ${g.detail}${g.provisional ? ` ${PROVISIONAL_LABEL}.` : ""}`);
    if (items.length) {
      diffBlocks.push({ type: "heading", text: s.title });
      diffBlocks.push({ type: "list", items });
    }
  }
  add("differences", "Summary of differences by unit operation", diffBlocks);

  const actionsText = (g: Gap) => {
    const acts = g.activities.map((x) => activityLabel(content, x)).join("; ");
    // Joined with "; " so the regulatory sentence never runs into the last action ("Training Requires ...").
    return [acts, g.regulatoryNote].filter(Boolean).join("; ") || "—";
  };
  add("gap-table", "Detailed gap table", [
    { type: "paragraph", text: fill(t.gapTableIntro, vars) },
    {
      type: "table",
      columns: ["ID", "Attribute", "SU", "RU", "Gap", "Severity", "Actions", "Notes"],
      rows: diffs.map((g) => [
        g.displayId,
        `${g.sectionTitle} — ${g.attribute}`,
        g.sourceDisplay,
        g.targetDisplay,
        // The label is words, not colour: a gap computed from a TBD best guess must never read as a settled finding. It comes last so the cell still starts with the category (the Word look tints by it).
        `${categoryLabel(content, g.category)}. ${g.detail} Why it matters: ${g.rationale}${g.provisional ? ` ${PROVISIONAL_LABEL}.` : ""}`,
        severityText(g),
        actionsText(g),
        g.notes ?? "—",
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
  const basis = stageBasis(w);
  add("validation-plan", "Validation plan", [
    { type: "paragraph", text: `Stage basis. ${basis.statement}` },
    { type: "list", items: [basis.sourcePoint, basis.targetPoint] },
    { type: "note", text: basis.closing },
    { type: "paragraph", text: fill(t.activitiesIntro, vars) },
    {
      type: "table",
      columns: ["Activity", "Description", "Implied by gaps", "Severity", "Regulatory", "Linked studies: SU status", "Linked studies: RU status", "Readiness"],
      rows: plan.map((r) => [
        r.provisional ? `${r.label} (${PROVISIONAL_LABEL})` : r.label,
        r.stageNote ? `${r.description} Program stage: ${r.stageNote}` : r.description,
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
          columns: ["Unit operation", "Equipment", "SU qualification", "RU qualification", "Qualified range (RU)", "Required by RU process", "Related gaps"],
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

  const tbdList = tbdItems(content, project, a);
  const tbdByRef = new Map(tbdList.map((i) => [i.ref, i]));
  add("open-items", "Open information items", [
    { type: "paragraph", text: fill(t.openItemsIntro, vars) },
    a.openItems.length
      ? {
          type: "table",
          columns: ["No.", "Section", "Side", "Question", "Status"],
          rows: a.openItems.map((o, i) => {
            const tbd = o.status === "tbd" ? tbdByRef.get(o.ref) : undefined;
            // A TBD row carries its best guess, owner and due date as recorded. "Overdue" is deliberately not here: it depends
            // on today's date and would make the document look changed from one day to the next.
            return [String(i + 1), o.sectionTitle, o.side === "shared" ? "Scoping" : o.side === "source" ? "SU" : "RU", tbd ? tbd.attribute : o.prompt, tbd ? tbdStatusText(tbd) : STATUS_TEXT[o.status]];
          }),
        }
      : { type: "paragraph", text: "No open information items." },
  ]);

  const ranked = riskRanked(a.gaps);
  add("risk", "Risk ranking", [
    { type: "paragraph", text: fill(t.riskIntro, vars) },
    {
      type: "table",
      columns: ["Rank", "ID", "Attribute", "Category", "Severity", "Regulatory"],
      rows: ranked.map((g, i) => [String(i + 1), g.displayId, `${g.sectionTitle}: ${g.attribute}`, g.provisional ? `${categoryLabel(content, g.category)} (${PROVISIONAL_LABEL})` : categoryLabel(content, g.category), severityText(g), g.regulatoryNote ? "Yes" : "No"]),
    },
  ]);

  const vs = verificationSummary(content, project);
  const sideName = { shared: "Scoping", source: "SU", target: "RU" } as const;
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
  const eff = effectiveStaged(content, project);
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
        countRow("All sections", "Scoping, SU and RU", vs.all),
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
    ...docs.map((s) => [s.docRef!.identifier, s.docRef!.docType, s.docRef!.title ?? sourceLabel(s), s.docRef!.version ?? "—"]),
    ...[...responders].map(([name, r]) => [`Interview: ${name}`, "Interview answers", `${r.count} answers${r.role ? `; ${r.role}` : ""}; ${[...r.dates].sort().join(", ")}`, "—"]),
    ...others.map((s) => [sourceLabel(s), s.type, s.file?.name ?? "—", "—"]),
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

  const appendix = (id: string, title: string, blocks: Block[]) => {
    if (omitted.has(id)) return;
    sections.push({ id, number: String.fromCharCode(65 + sections.filter((x) => x.appendix).length), appendix: true, title, blocks });
  };

  appendix("gap-details", "Gap details", [
    { type: "paragraph", text: fill(t.gapDetailsIntro, vars) },
    diffs.length
      ? {
          type: "table",
          columns: ["ID", "Rule", "Owner", "Status", "Regulatory", "SU verification", "RU verification"],
          rows: diffs.map((g) => [
            g.displayId,
            `${g.ruleId} v${g.ruleVersion}`,
            g.owner ?? "[unassigned]",
            STATUS_LABEL[g.status],
            g.regulatoryNote ?? "—",
            sideVerificationText(project, g.inputRefs, "source"),
            sideVerificationText(project, g.inputRefs, "target"),
          ]),
        }
      : { type: "paragraph", text: "No differences have been identified." },
  ]);

  // Entries that are no longer asked about (inactive) are counted, not listed: the document shows only current values.
  const citedBy = (citing: { text: string; active: boolean; location: string }[]) => {
    // The place inside the document follows each entry that cites it, "<entry> (§4.2 p.12)".
    const act = citing.filter((c) => c.active).map((c) => (c.location ? `${c.text} (${c.location})` : c.text));
    const hidden = citing.length - act.length;
    const parts = [...act];
    if (hidden) parts.push(`${hidden} recorded value${hidden === 1 ? "" : "s"} not currently asked about`);
    return parts.join("; ") || "—";
  };
  const allRegister = sourceRegisterRows(content, project);
  const register = documentSourceRegister(allRegister);
  const hiddenSourceCount = allRegister.length - register.length;
  appendix("source-register", "Source register", [
    { type: "paragraph", text: fill(t.sourceRegisterIntro, vars) },
    register.length
      ? {
          type: "table",
          columns: ["ID", "Type", "Identifier, title, version", "Responder", "Date", "State", "Cited by"],
          rows: register.map((r, i) => [
            sourceRegisterRef(i),
            r.typeLabel,
            r.source.docRef ? [r.source.docRef.identifier, r.source.docRef.title, r.source.docRef.version ? `version ${r.source.docRef.version}` : ""].filter(Boolean).join(", ") : sourceLabel(r.source),
            r.responder,
            r.date,
            r.stateText,
            citedBy(r.citing),
          ]),
        }
      : { type: "paragraph", text: "No sources have been recorded." },
    ...(hiddenSourceCount
      ? [{ type: "note" as const, text: `${hiddenSourceCount} further source${hiddenSourceCount === 1 ? "" : "s"} support${hiddenSourceCount === 1 ? "s" : ""} only recorded values that are not currently asked about; ${hiddenSourceCount === 1 ? "it is" : "they are"} kept in the project file and not listed here.` }]
      : []),
  ]);

  // Events of the retired review workflow (revisions, comments) can still sit in the log of an old project. They are not counted:
  // that history is archived, not part of this document.
  const counts = changeLogActionCounts(project, { excludeReview: true });
  const countedTotal = counts.reduce((sum, c) => sum + c.count, 0);
  appendix("change-log-summary", "Change log summary", [
    { type: "paragraph", text: fill(t.changeLogSummaryIntro, vars) },
    counts.length
      ? { type: "table", columns: ["Change", "Count"], rows: [...counts.map((c) => [c.label, String(c.count)]), ["Total", String(countedTotal)]] }
      : { type: "paragraph", text: "No changes have been recorded." },
    { type: "note", text: t.changeLogReviewNote },
  ]);

  const doc: DocModel = {
    title: fill(t.title, vars),
    banner: t.banner,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["SU program stage", w.sourceLabel],
      ["RU program stage", w.targetLabel],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Differences identified", String(diffs.length)],
      ["Open information items", String(a.openItems.length)],
      ["TBD values", String(tbdList.length)],
      ["Entries verified", `${vs.all.verified} of ${vs.all.total}`],
      ["Sections omitted", omittedIds.length ? omittedIds.map((id) => optionalSectionTitle(id)).join("; ") : "None"],
      ["Verification", t.verificationStatement],
    ],
    cover: {
      program: scopeText(content, project, "program"),
      product: ["modality", "dosage_form", "presentation"].map((k) => scopeText(content, project, k)).join(", "),
      sourceSite: siteText(project, "source"),
      targetSite: siteText(project, "target"),
      sourceStage: w.sourceLabel,
      targetStage: w.targetLabel,
    },
    sections,
    tbdCount: tbdList.length,
  };
  return doc;
}
