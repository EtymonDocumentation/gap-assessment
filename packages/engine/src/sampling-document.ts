import {
  MEMO_LINE_LABEL,
  PROCESS_MODEL_VERSION,
  SAMPLING_PLAN_FORMAT_VERSION,
  SCHEMA_VERSION,
  UNIT_OP_CUSTOM_STEP,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  type Project,
  SAMPLING_TYPES,
  type SamplingMethod,
  type SamplingPlan,
  type SamplingPoint,
  type SamplingType,
  type CustomSubsection,
} from "@gap/process-model";
import {
  acceptanceStatement,
  buildFigures,
  type FigureStyle,
  agencyCoverage,
  checkPoint,
  METHOD_HELP,
  METHOD_LABEL,
  methodInputsText,
  mixingDesign,
  NO_TYPE_SECTION_KEY,
  openItems,
  placementText,
  planTotals,
  pointsAt,
  renderSubsection,
  reportingInstructions,
  requestLine,
  resultText,
  RESPONSIBLE_LABEL,
  SAMPLING_STATS_VERSION,
  stabilityDerivation,
  stepOf,
  subsectionProblems,
  subsectionsAt,
  tablesUsed,
  timingText,
  tokenContext,
  trayPoints,
  TYPE_HELP,
  TYPE_LABEL,
  typeSectionKey,
  typeText,
  unitsPerBatch,
  AGENCY_KIND_LABEL,
  AGENCY_STATUS_LABEL,
  type OpenItem,
  type TokenContext,
} from "@gap/sampling";
import type { ContentBundle } from "./content";
import { effectiveContent } from "./custom";
import type { Block, DocModel, DocSection } from "./document";
import { documentSourceRefs } from "./document";
import type { SamplingSuggestions } from "./sampling-seed";
import { buildTrdSeed } from "./trd-seed";

/**
 * The draft PPQ sampling plan as a document (the same DocModel the gap assessment and the TRD outline use, so the shared
 * renderers and the built-in Word style draw it).
 *
 * GMP rules kept here:
 *  - Every sample size is shown with the working that produced it and the citation of the method. The document never says a
 *    method or a sample size is adequate; it says what the person chose and what the arithmetic gave.
 *  - Open items are listed in full. An incomplete point stays in the tables with its gaps visible ("Not worked out", "Not given").
 *  - "Report only" is written in words. The document is a draft: it never states it is approved, and it states no filing category.
 */

export const SAMPLING_PLAN_TITLE = "PPQ sampling plan — draft";
export const SAMPLING_BANNER = "Proof of concept. Not validated. Not for GMP use.";
const NOT_ESTABLISHED = "Not established";
const REPORT_ONLY_TEXT = "Report only (no acceptance criterion)";

export interface SamplingDocumentOptions {
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  /**
   * The flow figure drawn in the process-flow section: "time_scale" (the default when the plan has steps), "step_cards" or "none".
   * One style per export; it is a choice made when exporting, not stored in the plan.
   */
  figureStyle?: FigureStyle;
}

/** The sentence under the title and in the first section. */
export const samplingBasisText = (projectId: string): string => `Draft sampling plan generated from project ${projectId}. Not approved.`;

export function acceptanceText(p: SamplingPoint): string {
  if (!p.acceptance) return "Not given";
  return p.acceptance.kind === "report_only" ? REPORT_ONLY_TEXT : p.acceptance.text.trim() || "Not given";
}

/** Labels of the process steps (catalog and the project's own), plus the two special values a point can have. */
function unitOpLabels(content: ContentBundle, project: Project): Map<string, string> {
  const eff = effectiveContent(content, project);
  const m = new Map(eff.catalog.unitOperations.map((u) => [u.key, u.label]));
  m.set(UNIT_OP_FINISHED_PRODUCT, "Finished product");
  m.set(UNIT_OP_NONE, "Supporting work (no single step)");
  return m;
}

/**
 * Open items of a plan: the plan's own (see @gap/sampling) plus a warning for each point whose process step has since been left
 * out of the assessment, and the problems of the custom subsections (an unknown token, an empty title). Such a point is kept (the
 * plan never deletes anything by itself) but the owner must decide about it.
 */
export function samplingOpenItems(content: ContentBundle, project: Project, plan: SamplingPlan): OpenItem[] {
  const items = openItems(plan);
  const seed = buildTrdSeed(content, project, { exportedAt: "1970-01-01T00:00:00.000Z" });
  const live = new Set(seed.scope.included.map((u) => u.key));
  for (const p of plan.points) {
    if (p.unitOp === UNIT_OP_FINISHED_PRODUCT || p.unitOp === UNIT_OP_NONE) continue;
    // A point on one of the plan's own steps follows the plan's step list, which is separate from the gap Scope: no warning.
    if (stepOf(plan, p) || p.unitOp === UNIT_OP_CUSTOM_STEP) continue;
    if (!live.has(p.unitOp)) items.push({ ref: p.id, kind: "point", text: "Its process step is now left out of the assessment or does not apply. Keep the point on purpose, or remove it." });
  }
  const ctx = tokenContext(plan, { ...(seed.meta.product.program.display ? { productName: seed.meta.product.program.display } : {}), ...(seed.meta.receivingSite.name.display ? { ruSite: seed.meta.receivingSite.name.display } : {}) });
  for (const s of subsectionProblems(plan, ctx)) for (const text of s.problems) items.push({ ref: s.id, kind: "subsection", text: `${s.id}: ${text}` });
  return items;
}


const METHOD_EXPLANATION: Record<SamplingMethod, string> = {
  "company-table": "The sample size is read from the company's own sampling table: the row whose lot range holds the batch's planned lot size (and, for a per-test table, the test key). The tool does not extend a table beyond its ranges.",
  fixed: "The sample size is a number chosen by the team, with the basis written down. The tool does not check the basis.",
  "conf-rel":
    "The sample size is the smallest n for which, if the true share of good units were exactly the stated reliability, the chance of seeing no more than the allowed number of failures in n units is at most 1 minus the confidence (binomial distribution). With no failures allowed, n = ceil( ln(1 - confidence) / ln(reliability) ).",
  "aql-105e":
    "The sample size and the accept and reject numbers are read from the MIL-STD-105E tables: Table I gives the sample size code letter from the lot size and the inspection level, and Table II-A, II-B or II-C (single sampling, normal, tightened or reduced) gives n and the accept and reject numbers for the code letter and the acceptable quality level (AQL). Where the table shows an arrow, the plan follows it to the first plan, and uses that plan's n and its accept and reject numbers. When n reaches the lot size, the whole lot is inspected.",
  "var-414": "The sample size and the acceptability constant are read from the MIL-STD-414 tables (variability unknown, standard deviation method): the code letter from the lot size and the inspection level, then n and k (one specification limit) or M (two limits) for the AQL and the inspection severity.",
};

const LICENSED_NOTE = "These tables are equivalent to the current ANSI/ASQ standard and the ISO standard of the same family, which are copyrighted. Confirm the values against your licensed copy before relying on them.";

const NOT_GIVEN = "Not given";

/** Labels of the filter tests, for the plan text. */
const FILTER_TEST_TEXT: Record<string, string> = { integrity_pre_post: "Integrity test before and after use", bioburden_pre_filtration: "Bioburden before filtration", flush: "Flush", other: "Other" };
const RETAIN_PURPOSE_TEXT: Record<string, string> = { retain: "Retain", reserve: "Reserve", both: "Retain and reserve" };

export function buildSamplingPlanDocument(
  content: ContentBundle,
  project: Project,
  plan: SamplingPlan,
  library: SamplingSuggestions,
  opts: SamplingDocumentOptions = {},
): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const seed = buildTrdSeed(content, project, { exportedAt: generatedAt, ...(opts.appVersion ? { appVersion: opts.appVersion } : {}) });
  const labels = unitOpLabels(content, project);
  const labelOf = (uo: string) => labels.get(uo) ?? uo;
  const live = new Set(seed.scope.included.map((u) => u.key));
  const stepText = (uo: string) => (uo === UNIT_OP_FINISHED_PRODUCT || uo === UNIT_OP_NONE || live.has(uo) ? labelOf(uo) : `${labelOf(uo)} (now left out of the assessment)`);
  const basis = samplingBasisText(project.meta.id);
  const open = samplingOpenItems(content, project, plan);
  const totals = planTotals(plan);
  const checks = new Map(plan.points.map((p) => [p.id, checkPoint(plan, p)]));
  const refOf = documentSourceRefs(content, project);
  const sourceRef = (id: string) => refOf.get(id) ?? id;
  /** Ends a sentence with a full stop unless it already ends in one (basis texts typed by the team often do). */
  const stop = (s: string) => (/[.!?]$/.test(s.trimEnd()) ? s : `${s}.`);
  const program = seed.meta.product.program.display ?? NOT_ESTABLISHED;
  const batchLabel = (id: string) => plan.batches.find((b) => b.id === id)?.label ?? id;
  const tokenCtx: TokenContext = tokenContext(plan, {
    ...(seed.meta.product.program.display ? { productName: seed.meta.product.program.display } : {}),
    ...(seed.meta.receivingSite.name.display ? { ruSite: seed.meta.receivingSite.name.display } : {}),
  });

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  /** Custom subsections as blocks: a heading, the body with its tokens filled in, and a note for every problem (nothing is hidden). */
  const subBlocks = (subs: CustomSubsection[], point?: SamplingPoint): Block[] =>
    subs.flatMap((sub) => {
      const r = renderSubsection(sub, tokenCtx, point ? { id: point.id, attribute: point.attribute } : undefined);
      const out: Block[] = [{ type: "heading", text: `${r.title} (${sub.id})` }];
      for (const b of r.blocks) out.push(b.type === "paragraph" ? { type: "paragraph", text: b.text } : b.type === "list" ? { type: "list", items: b.items } : { type: "table", columns: b.columns, rows: b.rows });
      for (const pr of r.problems) out.push({ type: "note", text: `${sub.id}: ${pr}` });
      return out;
    });
  const subsAfter = (key: string): Block[] => subBlocks(subsectionsAt(plan, `after_section:${key}`));

  // 1. Purpose and scope
  add("purpose-scope", "Purpose and scope", [
    { type: "note", text: basis },
    {
      type: "paragraph",
      text: `This draft plan sets out which samples are taken from which process steps during the process performance qualification (PPQ) of ${program} at the receiving unit (RU), how many, and why. It records the choices made by the team and the arithmetic that followed from them. It does not judge whether a choice is adequate for the process: that decision belongs to QA and statistics.`,
    },
    {
      type: "paragraph",
      text: `Plan ${plan.id}: ${plan.title}. Run type: PPQ. ${plan.points.length} sampling point${plan.points.length === 1 ? "" : "s"} over ${plan.batches.length} batch${plan.batches.length === 1 ? "" : "es"}. ${open.length} open item${open.length === 1 ? "" : "s"}.`,
    },
    ...(plan.notes?.trim() ? ([{ type: "paragraph", text: plan.notes.trim() }] as Block[]) : []),
    ...subsAfter("purpose-scope"),
  ]);

  // 2. Product, presentation, site
  const m = seed.meta;
  const a = (x: { display?: string }) => x.display ?? NOT_ESTABLISHED;
  add("product-site", "Product, presentation and receiving site", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Program", a(m.product.program)],
        ["Modality", a(m.product.modality)],
        ["Dosage form", a(m.product.dosageForm)],
        ["Presentation", a(m.product.presentation)],
        ["RU site", a(m.receivingSite.name)],
        ["RU line", a(m.receivingSite.line)],
        ["RU program stage", a(m.receivingSite.programStage)],
      ],
    },
    ...subsAfter("product-site"),
  ]);

  // 3. PPQ batches and responsible parties
  add("batches", "PPQ batches", [
    {
      type: "paragraph",
      text: plan.batches.length
        ? `The plan has ${plan.batches.length} PPQ batch${plan.batches.length === 1 ? "" : "es"}. The number of batches is the team's decision.`
        : "No PPQ batches have been entered yet. The number of batches is the team's decision and the tool does not suggest one.",
    },
    plan.batches.length
      ? {
          type: "table",
          columns: ["Batch", "Label", "Planned lot size (units)", "Batch size", "Notes"],
          rows: plan.batches.map((b) => [b.id, b.label, b.plannedLotSizeUnits !== undefined ? String(b.plannedLotSizeUnits) : "Not given", b.batchSize !== undefined ? `${b.batchSize}${b.batchSizeUnit ? ` ${b.batchSizeUnit}` : ""}` : "Not given", b.notes ?? ""]),
        }
      : { type: "paragraph", text: "No batches." },
    { type: "heading", text: "Rationale for the number of batches" },
    { type: "paragraph", text: plan.batchRationale.trim() || "Not given. This is an open item." },
    { type: "heading", text: "Responsible parties" },
    plan.parties.length
      ? { type: "table", columns: ["Party", "Name", "Role"], rows: plan.parties.map((p) => [RESPONSIBLE_LABEL[p.party], p.name, p.role ?? ""]) }
      : { type: "paragraph", text: "No responsible parties have been named yet. This is an open item." },
    ...subsAfter("batches"),
  ]);

  // 3b. Process flow: the steps in order, which points sit on which step and position, and the points that are not on the diagram.
  // "Position not set" and "Not on the diagram" are normal states here, listed plainly; neither is an open item.
  const idLine = (ps: SamplingPoint[]): string => (ps.length ? ps.map((p) => `${p.id}${p.attribute.trim() ? ` ${p.attribute.trim()}` : ""}`).join("; ") : "");
  const tray = trayPoints(plan);
  // The figure is drawn from the plan's own flow data (hours, holds, time targets); what is not given is not invented. The long sample
  // table after it is unchanged and uses the same SP ids, so every number in a figure can be looked up.
  const figures = buildFigures(plan, { style: opts.figureStyle ?? "time_scale" });
  const figureBlocks: Block[] = figures.length
    ? [
        {
          type: "paragraph",
          text: `${figures.length === 1 ? "Figure" : "Figures"} ${figures.map((f) => f.number).join(figures.length > 2 ? ", " : " and ")} draw${figures.length === 1 ? "s" : ""} the process flow with the holds, the time targets and the samples. Each sample carries the number of its sampling point (SP); the table after the figure${figures.length === 1 ? "" : "s"} lists every point.`,
        },
        ...figures.map((f) => ({ type: "figure" as const, number: f.number, caption: f.caption, alt: f.alt, pages: f.pages.map((p) => ({ svg: p.svg, width: p.width, height: p.height })), hoursNotGiven: f.hoursNotGiven })),
      ]
    : [];
  add("process-flow", "Process flow", [
    {
      type: "paragraph",
      text: plan.steps.length
        ? `The plan follows ${plan.steps.length} process step${plan.steps.length === 1 ? "" : "s"}, in process order. Each sampling point is placed on a step, before, during or after it, or is not on the diagram. The team chose the steps and the positions.`
        : "No process steps have been chosen for this plan yet. The sampling points are listed below as not on the diagram.",
    },
    ...figureBlocks,
    ...(plan.steps.length
      ? ([
          {
            type: "table",
            columns: ["No.", "Process step", "Before", "During", "After", "Position not set"],
            rows: plan.steps.map((s, i) => [String(i + 1), s.label, idLine(pointsAt(plan, s.id, "before")), idLine(pointsAt(plan, s.id, "during")), idLine(pointsAt(plan, s.id, "after")), idLine(pointsAt(plan, s.id, "unset"))]),
            caption: "Sampling points per process step and position",
          },
        ] as Block[])
      : []),
    { type: "heading", text: "Points not on the diagram" },
    tray.length
      ? { type: "table", columns: ["Point", "Test", "Study type"], rows: tray.map((p) => [p.id, p.attribute.trim() || "Not given", typeText(p)]) }
      : { type: "paragraph", text: "Every sampling point is placed on a process step." },
    ...subsAfter("process-flow"),
  ]);

  // 4. Statistical bases used, one sub-section per method used
  const used = [...new Set(plan.points.flatMap((p) => (p.sampleSize.method ? [p.sampleSize.method] : [])))];
  const basisBlocks: Block[] = [];
  if (!used.length) basisBlocks.push({ type: "paragraph", text: "No sample-size method has been chosen for any point yet." });
  for (const method of used) {
    basisBlocks.push({ type: "heading", text: METHOD_LABEL[method] }, { type: "paragraph", text: METHOD_HELP[method] }, { type: "paragraph", text: METHOD_EXPLANATION[method] });
    const points = plan.points.filter((p) => p.sampleSize.method === method);
    const results = points.flatMap((p) => checks.get(p.id)!.perBatch.map((r) => ({ p, r })));
    const citations = [...new Set(results.map((x) => x.r.citation).filter(Boolean))];
    for (const c of citations) basisBlocks.push({ type: "paragraph", text: `Source: ${c}` });
    if (method === "aql-105e" || method === "var-414") basisBlocks.push({ type: "note", text: LICENSED_NOTE });
    if (method === "company-table") {
      for (const t of tablesUsed(plan)) {
        basisBlocks.push(
          { type: "paragraph", text: `Table ${t.name}, version ${t.version}${t.documentRef ? `, document ${t.documentRef}` : ""}${t.owner ? `, owner ${t.owner}` : ""}. The plan keeps this copy of the table as it was when the point was set up.` },
          {
            type: "table",
            columns: ["Lot size from", "Lot size to", "Sample size", "Accept", "Reject", "Test key"],
            rows: t.rows.map((r) => [String(r.lotMin), r.lotMax === null ? "and above" : String(r.lotMax), String(r.sampleSize), r.accept !== undefined ? String(r.accept) : "", r.reject !== undefined ? String(r.reject) : "", r.testKey ?? ""]),
            caption: `${t.name} version ${t.version}`,
          },
        );
      }
    }
    const working: string[][] = [];
    for (const { p, r } of results) {
      if (!r.working.length) continue;
      for (const w of r.working) working.push([p.id, plan.batches.length > 1 ? batchLabel(r.batchId) : "", w.label, w.value]);
    }
    if (working.length) basisBlocks.push({ type: "table", columns: ["Point", "Batch", "Step", "Value"], rows: working, caption: `Working: ${METHOD_LABEL[method]}` });
  }
  add("statistical-bases", "Statistical bases used", [...basisBlocks, ...subsAfter("statistical-bases")]);

  // 5. One section per study type, in a fixed order. Each point: a summary row, its details, any subsection placed inside it,
  // and its Reporting instructions block (which the CMO can copy as it is).
  const unitsCell = (p: SamplingPoint): string => {
    const per = unitsPerBatch(plan, p).filter((u) => u.applies);
    if (!per.length) return "No batch";
    if (per.every((u) => u.text === per[0]!.text)) return per[0]!.text;
    return per.map((u) => `${u.batchLabel}: ${u.text}`).join("; ");
  };
  const locationsCell = (p: SamplingPoint): string => {
    if (p.type === "stability" || p.type === "retain_reserve") return "Not applicable";
    const per = checks.get(p.id)!.perBatch;
    const n = [...new Set(per.map((r) => (r.hundredPercent ? "100% of lot" : r.sampleSize !== undefined ? String(r.sampleSize) : "?")))];
    return `${p.locationsCount ?? "?"} x ${n.length ? n.join(" / ") : "?"}`;
  };
  const methodCell = (p: SamplingPoint): string => {
    if (p.type === "stability") return "Pulls = storage conditions x time points; units = pulls x units per pull (working below).";
    if (p.type === "retain_reserve") return "Units kept per batch, as entered.";
    const c = checks.get(p.id)!;
    return `${p.sampleSize.method ? METHOD_LABEL[p.sampleSize.method] : "No method"}: ${c.perBatch.length ? stop(methodInputsText(p)) : methodInputsText(p)}${c.perBatch.length ? ` ${stop(`Result: ${[...new Set(c.perBatch.map(resultText))].join(" / ")}`)}` : ""}`;
  };
  const pointTable = (points: SamplingPoint[]): Block => ({
    type: "table",
    columns: ["ID", "Attribute / test (study type)", "Timing / location", "Locations x n", "Units per batch", "Method and key inputs", "Acceptance", "Status"],
    rows: points.map((p) => [
      p.id,
      `${p.attribute.trim() || "Not given"} (${typeText(p)})${p.testMethodRef ? `; method ${p.testMethodRef}` : ""}${p.materialType ? `; ${p.materialType}` : ""}`,
      p.type === "stability" ? "Per stability protocol" : p.type === "retain_reserve" ? "Kept at batch release" : timingText(p) || "Not given",
      locationsCell(p),
      unitsCell(p),
      methodCell(p),
      acceptanceText(p),
      checks.get(p.id)!.status === "complete" ? "Complete" : "Incomplete",
    ]),
  });
  const kv = (rows: [string, string | undefined][]): Block[] => {
    const shown = rows.filter(([, v]) => v !== undefined && v.trim() !== "");
    return shown.length ? [{ type: "table", columns: ["Item", "Value"], rows: shown.map(([k, v]) => [k, v!]) }] : [];
  };
  const requestRef = (id: string) => plan.agencyRequests.find((r) => r.id === id);
  const commonFacts = (p: SamplingPoint): Block[] =>
    kv([
      ["Process step", stepOf(plan, p)?.label ?? stepText(p.unitOp)],
      ["Position on the process flow", placementText(plan, p)],
      ["Purpose and rationale", p.rationale.trim() || NOT_GIVEN],
      ["Responsible", p.responsible ? `${RESPONSIBLE_LABEL[p.responsible.party]}${p.responsible.name?.trim() ? `, ${p.responsible.name.trim()}` : ""}` : NOT_GIVEN],
      ["Applies to", p.appliesTo === "all" ? "All batches" : p.appliesTo.map(batchLabel).join(", ")],
      ["Container", p.container],
      ["Closure", p.closure],
      ["Quantity per sample", p.quantity ? `${p.quantity.value} ${p.quantity.unit}` : undefined],
      ["Containers per sample", p.containerUnitsPerSample !== undefined ? String(p.containerUnitsPerSample) : undefined],
      ["Storage and handling", p.storageCondition],
      ["Transport", p.transportCondition],
      ["Chain of custody", p.chainOfCustody],
      ["Destination laboratory", p.destinationLab],
      ["Agency requests", p.agencyRequestIds?.length ? p.agencyRequestIds.map((id) => { const r = requestRef(id); return r ? requestLine(r) : id; }).join("; ") : undefined],
      ["Sources", p.sourceIds.length ? p.sourceIds.map(sourceRef).join(", ") : undefined],
    ]);
  const typeBlocks = (p: SamplingPoint): Block[] => {
    const d = p.detail;
    switch (p.type) {
      case "mixing_homogeneity": {
        const mx = d?.mixing;
        const design = mixingDesign(p);
        return [
          ...kv([
            ["Vessel or equipment", mx?.vesselRef],
            ["Mixing parameters", mx?.parameters],
            ["Sampling positions", mx?.positions?.length ? mx.positions.map((x) => (x === "other" ? mx.positionsOther?.trim() || "other" : x)).join(", ") : undefined],
            ["Time points", mx?.timePoints?.length ? mx.timePoints.map((t) => `${t.label} (${t.time})`).join("; ") : undefined],
            ["Criterion basis", mx?.criterionBasis],
            ["Study design", design.approach],
          ]),
          ...(design.matrix ? ([{ type: "table", columns: design.matrix.columns, rows: design.matrix.rows, caption: `Study design runs ${p.id}` }] as Block[]) : []),
          ...design.rangeLines.map((text): Block => ({ type: "paragraph", text: stop(text) })),
        ];
      }
      case "hold_time": {
        const h = d?.hold;
        return kv([
          ["Hold step", h?.holdStep ? stepText(h.holdStep) : undefined],
          ["Hold starts", h?.start],
          ["Hold ends", h?.end],
          ["Durations tested", h?.durations?.length ? h.durations.map((x) => `${x.value} ${x.unit}`).join("; ") : undefined],
          ["Condition", h?.condition],
          ["Container", h?.container],
          ["Time points sampled", h?.timePointsSampled],
          ["Result supports", h?.supports],
        ]);
      }
      case "ppq_enhanced": {
        const e = d?.enhanced;
        return kv([["Interventions or stoppages covered", e?.interventions], ["Interval definition", e?.intervalDefinition], ["Per needle or shelf", e?.perNeedleShelf]]);
      }
      case "filter_study": {
        const f = d?.filter;
        return kv([["Filter", f?.filterRef], ["Test", f?.test ? (f.test === "other" ? f.testOther?.trim() || "Other" : FILTER_TEST_TEXT[f.test]) : undefined], ["PUPSIT answer in the gap assessment", f?.pupsitItemPath]]);
      }
      case "stability": {
        const s = d?.stability;
        const der = stabilityDerivation(p);
        return [
          ...kv([["Stability protocol", s?.protocolRef], ["Orientation", s?.orientation], ["Reported against the stability protocol", s?.reportedAgainstProtocol === undefined ? undefined : s.reportedAgainstProtocol ? "Yes" : "No"]]),
          ...(s?.conditions?.length ? ([{ type: "table", columns: ["Storage condition", "Temperature and humidity"], rows: s.conditions.map((c) => [c.label, c.detail]) }] as Block[]) : []),
          ...(der.working.length ? ([{ type: "table", columns: ["Working", "Value"], rows: der.working.map((w) => [w.label, w.value]), caption: `Stability pulls ${p.id}` }] as Block[]) : []),
        ];
      }
      case "retain_reserve": {
        const r = d?.retain;
        return kv([
          ["Purpose", r?.purpose ? RETAIN_PURPOSE_TEXT[r.purpose] : undefined],
          ["Basis of the quantity", r?.quantityBasis],
          ["Units kept per batch", r?.unitsPerBatch !== undefined ? String(r.unitsPerBatch) : undefined],
          ["Retention period", r?.retentionPeriod],
          ["Storage", r?.storage],
          ["Requirement", r?.requirementRef],
        ]);
      }
      case "characterization":
      case "supporting_study": {
        const an = d?.analyses;
        return [
          ...(an?.analyses?.length ? ([{ type: "table", columns: ["Analysis", "Method"], rows: an.analyses.map((x) => [x.name, x.methodRef]) }] as Block[]) : []),
          ...kv([["Informs", an?.informs]]),
        ];
      }
      case "regulatory_commitment":
        return kv([["How this study answers the request", d?.commitment?.answer]]);
      default:
        return [];
    }
  };
  const pointBlocks = (p: SamplingPoint): Block[] => {
    const instr = reportingInstructions(plan, p, { unitOpLabel: labelOf });
    return [
      { type: "heading", text: `${p.id}: ${p.attribute.trim() || "(no attribute)"}` },
      pointTable([p]),
      ...commonFacts(p),
      ...typeBlocks(p),
      ...subBlocks(subsectionsAt(plan, `in_point:${p.id}`), p),
      { type: "heading", text: instr.heading },
      ...instr.paragraphs.map((text): Block => ({ type: "paragraph", text })),
    ];
  };
  const rank = (uo: string) => {
    const i = seed.scope.included.find((u) => u.key === uo)?.sequence;
    return i ?? (uo === UNIT_OP_FINISHED_PRODUCT ? 9000 : uo === UNIT_OP_NONE ? 9100 : 8000);
  };
  // Points are grouped under the plan's own process steps, in the plan's step order; points that are not on the diagram follow,
  // grouped by their unit operation as before.
  const groupOf = (p: SamplingPoint): { key: string; rank: number; heading: string } => {
    const step = stepOf(plan, p);
    if (step) return { key: step.id, rank: plan.steps.indexOf(step), heading: step.label };
    return { key: `uo:${p.unitOp}`, rank: 1000 + rank(p.unitOp), heading: stepText(p.unitOp) };
  };
  const stepGroups = (points: SamplingPoint[]): Block[] => {
    const groups = new Map<string, { rank: number; heading: string; mine: SamplingPoint[] }>();
    for (const p of points) {
      const g = groupOf(p);
      if (!groups.has(g.key)) groups.set(g.key, { rank: g.rank, heading: g.heading, mine: [] });
      groups.get(g.key)!.mine.push(p);
    }
    const out: Block[] = [];
    for (const g of [...groups.values()].sort((x, y) => x.rank - y.rank)) {
      out.push({ type: "heading", text: `Process step: ${g.heading}` });
      for (const p of g.mine) out.push(...pointBlocks(p));
    }
    return out;
  };
  for (const t of SAMPLING_TYPES as readonly SamplingType[]) {
    const points = plan.points.filter((p) => p.type === t);
    const inType = subBlocks(subsectionsAt(plan, `in_study_type:${t}`));
    const after = subsAfter(typeSectionKey(t));
    if (!points.length && !inType.length && !after.length) continue;
    add(typeSectionKey(t), TYPE_LABEL[t], [
      { type: "paragraph", text: `${TYPE_HELP[t]} ${points.length} point${points.length === 1 ? "" : "s"}.${points.length ? ' "Locations x n" is the number of locations or time points per batch times the sample size per location.' : ""}` },
      ...inType,
      ...stepGroups(points),
      ...after,
    ]);
  }
  const untyped = plan.points.filter((p) => !p.type);
  if (untyped.length || subsectionsAt(plan, `after_section:${NO_TYPE_SECTION_KEY}`).length) {
    add(NO_TYPE_SECTION_KEY, "Points without a study type", [
      { type: "paragraph", text: "These points have no study type yet (a point migrated from the older \"routine in-process / release\" category has to be classified by the team). Each is an open item." },
      ...stepGroups(untyped),
      ...subsAfter(NO_TYPE_SECTION_KEY),
    ]);
  }

  // Agency requests and commitments
  // Built here with the other point-related facts but PRINTED last, after the open items (the interview ends with it too).
  const cover = agencyCoverage(plan);
  const addAgency = () => add("agency-requests", "Agency requests and commitments", [
    {
      type: "paragraph",
      text: plan.agencyRequests.length
        ? "Agency requests, and answers to earlier requests, that refer to PPQ samples or studies. The questions are quoted as received. The plan links each request to the sampling points that answer it; it does not say what a request means for a filing."
        : plan.noAgencyRequests
          ? "The team states that no agency requests or answers refer to PPQ samples or studies."
          : "Not yet stated whether agency requests or answers refer to PPQ samples or studies. This is an open item.",
    },
    ...(plan.agencyRequests.length
      ? ([
          {
            type: "table",
            columns: ["Request", "Agency", "Kind", "Reference", "Received", "Question (as received)", "Response or commitment", "Status", "Sampling points"],
            rows: cover.map((c) => [
              c.request.id,
              c.request.marketCode?.trim() ? `${c.request.agency} (${c.request.marketCode.trim()})` : c.request.agency,
              c.request.kind ? AGENCY_KIND_LABEL[c.request.kind] : "Not given",
              c.request.reference ?? "Not given",
              c.request.dateReceived ?? "Not given",
              c.request.question,
              [c.request.response ?? "", c.request.responseDate ? `(${c.request.responseDate})` : ""].filter(Boolean).join(" ") || "Not given",
              c.request.status ? AGENCY_STATUS_LABEL[c.request.status] : "Not given",
              c.text,
            ]),
          },
        ] as Block[])
      : []),
    ...subsAfter("agency-requests"),
  ]);

  // Totals
  const pointRowCells = (p: SamplingPoint) => {
    const per = new Map(unitsPerBatch(plan, p).map((u) => [u.batchId, u.text]));
    return [`${p.id} ${p.attribute.trim() || "(no attribute)"}`, ...plan.batches.map((b) => per.get(b.id) ?? "Not planned")];
  };
  const stabilityPoints = plan.points.filter((p) => p.type === "stability");
  add("totals", "Sample totals per batch", [
    {
      type: "paragraph",
      text: "Units consumed are the sample size times the number of locations, added over the points that apply to the batch. Stability units (pulls times units per pull) and retain or reserve units are counted in their own rows. A point inspected at 100% of the lot is shown as such and is not counted. Totals are not complete while a point is not worked out.",
    },
    plan.batches.length
      ? {
          type: "table",
          columns: ["Point", ...plan.batches.map((b) => b.label)],
          rows: [
            ...plan.points.map(pointRowCells),
            ["Total sample units (testing)", ...totals.perBatch.map((t) => String(t.units))],
            ["Total stability units", ...totals.perBatch.map((t) => String(t.stabilityUnits))],
            ["Total retain and reserve units", ...totals.perBatch.map((t) => String(t.retainUnits))],
            ["Total units, all kinds", ...totals.perBatch.map((t) => String(t.units + t.stabilityUnits + t.retainUnits))],
          ],
          caption: "Units per point and batch",
        }
      : { type: "paragraph", text: "No batches, so no totals." },
    ...(plan.batches.length
      ? ([{ type: "paragraph", text: `Total over all batches: ${totals.units} sample units, ${totals.stabilityUnits} stability units and ${totals.retainUnits} retain and reserve units; ${totals.allUnits} units in all.` }] as Block[])
      : []),
    ...(stabilityPoints.length
      ? ([
          {
            type: "table",
            columns: ["Point", "Step", "Value"],
            rows: stabilityPoints.flatMap((p) => stabilityDerivation(p).working.map((w) => [p.id, w.label, w.value])),
            caption: "Working: stability pulls and units",
          },
        ] as Block[])
      : []),
    ...totals.notes.map((text): Block => ({ type: "note", text })),
    ...subsAfter("totals"),
  ]);

  // Open items
  add("open-items", "Open items", [
    {
      type: "paragraph",
      text: open.length
        ? "Entries still missing or to be decided. Nothing has been filled in on behalf of the team. The plan cannot be approved while these remain."
        : "No open items. This does not mean the plan is adequate; that is for QA and statistics to judge.",
    },
    ...(open.length
      ? ([
          {
            type: "table",
            columns: ["Reference", "Item", "Open item"],
            rows: open.map((o) => [o.ref === "plan" ? "Plan" : o.ref, o.kind === "point" ? (plan.points.find((p) => p.id === o.ref)?.attribute.trim() || "(no attribute)") : "", o.text]),
          },
        ] as Block[])
      : []),
    ...subsAfter("open-items"),
  ]);

  addAgency();

  // Appendix A: traceability
  const trace = plan.points.map((p) => {
    const o = p.origin;
    return [
      p.id,
      o.kind === "manual" ? "Added by hand" : o.suggestionKey ? `Suggestion: ${o.suggestionKey}` : "From a suggestion",
      o.kind === "seeded" ? (o.itemPath ?? "") : "",
      o.kind === "seeded" ? o.gapIds.join(", ") : "",
      o.kind === "seeded" ? (o.validationActivity ?? "") : "",
      p.sourceIds.map(sourceRef).join(", "),
    ];
  });
  appendix("traceability", "Traceability", [
    {
      type: "paragraph",
      text: "For each point, where it came from: the RU item it was suggested from, the gap register rows (gap ids, which can renumber when the gap assessment changes), the validation activity, and the sources it cites.",
    },
    plan.points.length ? { type: "table", columns: ["Point", "Origin", "RU item", "Gap ids", "Validation activity", "Sources"], rows: trace } : { type: "paragraph", text: "No points." },
  ]);

  // Appendix B: source register (sources the plan cites, by points and by agency requests)
  const cited = project.sources.filter((s) => plan.points.some((p) => p.sourceIds.includes(s.id)) || plan.agencyRequests.some((r) => r.sourceIds.includes(s.id)));
  appendix("source-register", "Source register", [
    cited.length
      ? {
          type: "table",
          columns: ["Ref", "Id", "Type", "Label", "Document", "Date"],
          rows: cited.map((s) => [sourceRef(s.id), s.id, s.type, s.label, s.docRef ? [s.docRef.identifier, s.docRef.title, s.docRef.version ? `v${s.docRef.version}` : ""].filter(Boolean).join(", ") : (s.file?.name ?? ""), s.date]),
        }
      : { type: "paragraph", text: "No sources are cited by the sampling points." },
  ]);

  // Appendix: subsections placed in an appendix
  const appendixSubs = subsectionsAt(plan, "appendix");
  if (appendixSubs.length) appendix("plan-subsections", "Additional subsections", subBlocks(appendixSubs));

  // Appendix: versions
  appendix("versions", "Versions", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Generator", `${opts.generatorName ?? "Gap Assessment Generator (proof of concept)"} ${opts.appVersion ?? "unversioned"}`],
        ["Sampling plan format", SAMPLING_PLAN_FORMAT_VERSION],
        ["Process model", PROCESS_MODEL_VERSION],
        ["Sampling statistics", SAMPLING_STATS_VERSION],
        ["PPQ suggestions catalog", library.catalog.version],
        ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
        ["Plan last changed", plan.updatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ],
    },
    { type: "note", text: "This document uses the built-in style only. A customer template is not applied to the sampling plan." },
  ]);

  return {
    title: SAMPLING_PLAN_TITLE,
    banner: SAMPLING_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Plan", `${plan.id}: ${plan.title}`],
      ["Basis", basis],
      ["Generated", generatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ["Open items", String(open.length)],
    ],
    cover: {
      program,
      product: [m.product.modality, m.product.dosageForm, m.product.presentation].map((x) => x.display ?? NOT_ESTABLISHED).join(", "),
      sourceSite: "",
      targetSite: [m.receivingSite.name.display, m.receivingSite.line.display].filter(Boolean).join(", ") || NOT_ESTABLISHED,
      sourceStage: "",
      targetStage: m.receivingSite.programStage.display ?? NOT_ESTABLISHED,
    },
    sections,
    tbdCount: open.length,
  };
}

// ------------------------------------------------------------------ parties as template data

/** One party as a Word template sees it. Empty text stays empty: a template shows what the plan says and nothing else. */
export interface PartyTag {
  /** The kind of party: CMO, Sponsor, Contract laboratory or Other. */
  party: string;
  name: string;
  role: string;
  department: string;
  /** From, To, Cc, or empty when the person put the party on no memo line. */
  memoLine: string;
  /** Name, role and department joined with commas (what is given), ready for a memo line. */
  line: string;
}

export interface PartyTags {
  parties: PartyTag[];
  fromParties: PartyTag[];
  toParties: PartyTag[];
  ccParties: PartyTag[];
  /** The lines of the From / To / Cc parties joined with "; " on one line, or "[none chosen]" when no party is on that memo line. */
  fromText: string;
  toText: string;
  ccText: string;
  /** Names of the parties of kind CMO, joined with ", ", or "[no CMO named]". */
  cmoName: string;
  /** Names of the parties of kind Sponsor, joined with ", ", or "[no sponsor named]". */
  sponsorName: string;
}

/**
 * The plan's parties as template data. The From / To / Cc lists contain only the parties the person put on that memo line: the
 * tool never guesses a memo line from the kind of party (a sponsor is not always the sender), and a party on no line is in
 * {#parties} only. A name that is missing stays visible as a bracketed text rather than an empty line.
 */
export function partyTags(plan: SamplingPlan): PartyTags {
  const tag = (p: SamplingPlan["parties"][number]): PartyTag => ({
    party: RESPONSIBLE_LABEL[p.party],
    name: p.name,
    role: p.role ?? "",
    department: p.department ?? "",
    memoLine: p.memoLine ? MEMO_LINE_LABEL[p.memoLine] : "",
    line: [p.name, p.role, p.department].filter((x) => x && x.trim()).join(", "),
  });
  const all = plan.parties.map(tag);
  const on = (line: "from" | "to" | "cc") => plan.parties.filter((p) => p.memoLine === line).map(tag);
  const names = (kind: SamplingPlan["parties"][number]["party"], none: string) => {
    const n = plan.parties.filter((p) => p.party === kind).map((p) => p.name);
    return n.length ? n.join(", ") : none;
  };
  const text = (list: PartyTag[]) => (list.length ? list.map((x) => x.line).join("; ") : "[none chosen]");
  const [from, to, cc] = [on("from"), on("to"), on("cc")];
  return { parties: all, fromParties: from, toParties: to, ccParties: cc, fromText: text(from), toText: text(to), ccText: text(cc), cmoName: names("cmo", "[no CMO named]"), sponsorName: names("sponsor", "[no sponsor named]") };
}
