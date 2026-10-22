import {
  PROCESS_MODEL_VERSION,
  SAMPLING_PLAN_FORMAT_VERSION,
  SCHEMA_VERSION,
  UNIT_OP_FINISHED_PRODUCT,
  UNIT_OP_NONE,
  type Project,
  type SamplingMethod,
  type SamplingPlan,
  type SamplingPoint,
} from "@gap/process-model";
import {
  categoryText,
  checkPoint,
  CATEGORY_LABEL,
  METHOD_HELP,
  METHOD_LABEL,
  methodInputsText,
  openItems,
  planTotals,
  resultText,
  SAMPLING_STATS_VERSION,
  tablesUsed,
  timingText,
  unitsPerBatch,
  type OpenItem,
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
 * out of the assessment. Such a point is kept (the plan never deletes anything by itself) but the owner must decide about it.
 */
export function samplingOpenItems(content: ContentBundle, project: Project, plan: SamplingPlan): OpenItem[] {
  const items = openItems(plan);
  const live = liveUnitOps(content, project);
  for (const p of plan.points) {
    if (p.unitOp === UNIT_OP_FINISHED_PRODUCT || p.unitOp === UNIT_OP_NONE) continue;
    if (!live.has(p.unitOp)) items.push({ ref: p.id, kind: "point", text: "Its process step is now left out of the assessment or does not apply. Keep the point on purpose, or remove it." });
  }
  return items;
}

function liveUnitOps(content: ContentBundle, project: Project): Set<string> {
  const seed = buildTrdSeed(content, project, { exportedAt: "1970-01-01T00:00:00.000Z" });
  return new Set(seed.scope.included.map((u) => u.key));
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

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

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
  ]);

  // 3. PPQ batches
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
  ]);

  // 4. Statistical bases, one sub-section per method used
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
  add("statistical-bases", "Statistical bases used", basisBlocks);

  // 5. Sampling points per process step (routine, release and enhanced PPQ sampling)
  const unitsCell = (p: SamplingPoint): string => {
    const per = unitsPerBatch(plan, p).filter((u) => u.applies);
    if (!per.length) return "No batch";
    if (per.every((u) => u.text === per[0]!.text)) return per[0]!.text;
    return per.map((u) => `${u.batchLabel}: ${u.text}`).join("; ");
  };
  const locationsCell = (p: SamplingPoint): string => {
    const per = checks.get(p.id)!.perBatch;
    const n = [...new Set(per.map((r) => (r.hundredPercent ? "100% of lot" : r.sampleSize !== undefined ? String(r.sampleSize) : "?")))];
    return `${p.locationsCount ?? "?"} x ${n.length ? n.join(" / ") : "?"}`;
  };
  const pointTable = (points: SamplingPoint[]): Block => ({
    type: "table",
    columns: ["ID", "Attribute / test (category)", "Timing / location", "Locations x n", "Units per batch", "Method and key inputs", "Acceptance", "Status"],
    rows: points.map((p) => [
      p.id,
      `${p.attribute.trim() || "Not given"} (${categoryText(p)})${p.testMethodRef ? `; method ${p.testMethodRef}` : ""}${p.materialType ? `; ${p.materialType}` : ""}`,
      timingText(p) || "Not given",
      locationsCell(p),
      unitsCell(p),
      `${p.sampleSize.method ? METHOD_LABEL[p.sampleSize.method] : "No method"}: ${checks.get(p.id)!.perBatch.length ? stop(methodInputsText(p)) : methodInputsText(p)}${checks.get(p.id)!.perBatch.length ? ` ${stop(`Result: ${[...new Set(checks.get(p.id)!.perBatch.map(resultText))].join(" / ")}`)}` : ""}`,
      acceptanceText(p),
      checks.get(p.id)!.status === "complete" ? "Complete" : "Incomplete",
    ]),
  });
  const routine = plan.points.filter((p) => p.category === "routine_ipc_release" || p.category === "ppq_enhanced");
  const studies = plan.points.filter((p) => !(p.category === "routine_ipc_release" || p.category === "ppq_enhanced"));
  const stepOrder = [...new Set(plan.points.map((p) => p.unitOp))];
  const rank = (uo: string) => {
    const i = seed.scope.included.find((u) => u.key === uo)?.sequence;
    return i ?? (uo === UNIT_OP_FINISHED_PRODUCT ? 9000 : uo === UNIT_OP_NONE ? 9100 : 8000);
  };
  stepOrder.sort((x, y) => rank(x) - rank(y));
  const groupBlocks = (points: SamplingPoint[], empty: string): Block[] => {
    if (!points.length) return [{ type: "paragraph", text: empty }];
    const out: Block[] = [];
    for (const uo of stepOrder) {
      const mine = points.filter((p) => p.unitOp === uo);
      if (mine.length) out.push({ type: "heading", text: stepText(uo) }, pointTable(mine));
    }
    return out;
  };
  add("points", "Sampling points", [
    { type: "paragraph", text: `Routine in-process, release and enhanced PPQ sampling, by process step. "Locations x n" is the number of locations or time points per batch times the sample size per location. Categories: ${CATEGORY_LABEL.routine_ipc_release.toLowerCase()}, ${CATEGORY_LABEL.ppq_enhanced.toLowerCase()}.` },
    ...groupBlocks(routine, "No routine or enhanced PPQ sampling points have been entered."),
  ]);

  // 6. Characterization and supporting studies
  add("studies", "Characterization and supporting studies", [
    { type: "paragraph", text: 'Material taken from the PPQ batches for characterization, supporting studies and other work. A point marked "Report only" is collected and reported; it has no acceptance criterion.' },
    ...groupBlocks(studies, "No characterization or supporting study points have been entered."),
  ]);

  // 7. Totals
  add("totals", "Sample totals per batch", [
    {
      type: "paragraph",
      text: "Units consumed are the sample size times the number of locations, added over the points that apply to the batch. A point inspected at 100% of the lot is shown as such and is not counted. Totals are not complete while a point is not worked out.",
    },
    plan.batches.length
      ? {
          type: "table",
          columns: ["Point", ...plan.batches.map((b) => b.label)],
          rows: [
            ...plan.points.map((p) => {
              const per = new Map(unitsPerBatch(plan, p).map((u) => [u.batchId, u.text]));
              return [`${p.id} ${p.attribute.trim() || "(no attribute)"}`, ...plan.batches.map((b) => per.get(b.id) ?? "Not planned")];
            }),
            ["Total units", ...totals.perBatch.map((t) => String(t.units))],
          ],
          caption: "Units per point and batch",
        }
      : { type: "paragraph", text: "No batches, so no totals." },
    ...(plan.batches.length ? ([{ type: "paragraph", text: `Total over all batches: ${totals.units} units.` }] as Block[]) : []),
    ...totals.notes.map((text): Block => ({ type: "note", text })),
  ]);

  // 8. Open items
  add("open-items", "Open items", [
    {
      type: "paragraph",
      text: open.length
        ? "Entries still missing or to be decided. Nothing has been filled in on behalf of the team. The plan cannot be approved while these remain."
        : "No open items. This does not mean the plan is adequate; that is for QA and statistics to judge.",
    },
    ...(open.length
      ? ([{ type: "table", columns: ["Reference", "Item", "Open item"], rows: open.map((o) => [o.ref === "plan" ? "Plan" : o.ref, o.kind === "point" ? (plan.points.find((p) => p.id === o.ref)?.attribute.trim() || "(no attribute)") : "", o.text]) }] as Block[])
      : []),
  ]);

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

  // Appendix B: source register (sources the plan cites)
  const cited = project.sources.filter((s) => plan.points.some((p) => p.sourceIds.includes(s.id)));
  appendix("source-register", "Source register", [
    cited.length
      ? {
          type: "table",
          columns: ["Ref", "Id", "Type", "Label", "Document", "Date"],
          rows: cited.map((s) => [sourceRef(s.id), s.id, s.type, s.label, s.docRef ? [s.docRef.identifier, s.docRef.title, s.docRef.version ? `v${s.docRef.version}` : ""].filter(Boolean).join(", ") : (s.file?.name ?? ""), s.date]),
        }
      : { type: "paragraph", text: "No sources are cited by the sampling points." },
  ]);

  // Appendix C: versions
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
