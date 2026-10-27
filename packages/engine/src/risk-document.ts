import { PROCESS_MODEL_VERSION, RISK_FORMAT_VERSION, RISK_REVIEW_TRIGGER_LABEL, SCHEMA_VERSION, type FailureModeSuggestions, type Project, type RiskAssessment, type RiskItem } from "@gap/process-model";
import { describeAnswers, describeMethod, factorColumns, heatCounts, INTERVENTION_LABEL, INTERVENTION_SIMULATION_HINT, interventionIsEmpty, interventionTally, isTr44, LMH_LABEL, RISK_SCORING_VERSION, severityConfidenceText } from "@gap/risk";
import { assess } from "./compare";
import type { ContentBundle } from "./content";
import type { Block, DocModel, DocSection } from "./document";
import { documentSourceRefs } from "./document";
import { evaluateItem, hasResidual, linkedConfidence, riskOpenItems, thresholdReading, type RiskOpenItem } from "./risk";
import { buildTrdSeed } from "./trd-seed";

/**
 * The risk assessment as a document (the same DocModel the other outputs use, so the shared renderers and the built-in Word style draw it).
 *
 * GMP rules kept here:
 *  - The document never says a risk is acceptable. A band or level appears only as the user's own label, in the user's own words; with no
 *    bands the score stands alone and the document says that no bands were defined.
 *  - An item that is not scored says so ("Not scored") and is listed under open items. Nothing is guessed.
 *  - The gap severity is shown in the traceability appendix as reference text. It is never part of a score.
 *  - The document is a draft: it never states it is approved, and it states no filing category.
 */

export const RISK_ASSESSMENT_TITLE = "Risk assessment — draft";
export const RISK_BANNER = "Proof of concept. Not validated. Not for GMP use.";
const NOT_ESTABLISHED = "Not established";

/** Sections the person can leave out of one export. Everything else is always there, so an export cannot hide the method or the open items. */
export const RISK_OPTIONAL_SECTIONS = [
  { id: "actions", label: "Action list" },
  { id: "traceability", label: "Traceability appendix" },
  { id: "heat", label: "Matrix heat table (matrix method only)" },
  { id: "residual", label: "Residual risk columns" },
] as const;
export type RiskOptionalSection = (typeof RISK_OPTIONAL_SECTIONS)[number]["id"];

export interface RiskDocumentOptions {
  generatedAt?: string;
  generatorName?: string;
  appVersion?: string;
  /** Optional sections to leave out of this export. */
  omit?: readonly RiskOptionalSection[];
}

export const riskBasisText = (projectId: string): string => `Draft risk assessment generated from project ${projectId}. Not approved.`;

const STATUS_TEXT = { open: "Open", in_progress: "In progress", done: "Done", dropped: "Dropped" } as const;

/** Open items of the assessment as the document lists them (the same list the page and the download warning count). */
export const riskDocumentOpenItems = (project: Project, a: RiskAssessment): RiskOpenItem[] => riskOpenItems(project, a);

export function buildRiskAssessmentDocument(
  content: ContentBundle,
  project: Project,
  assessment: RiskAssessment,
  library: FailureModeSuggestions,
  opts: RiskDocumentOptions = {},
): DocModel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const omit = new Set<string>(opts.omit ?? []);
  const seed = buildTrdSeed(content, project, { exportedAt: generatedAt, ...(opts.appVersion ? { appVersion: opts.appVersion } : {}) });
  const a = assessment;
  const cfg = a.config;
  const open = riskOpenItems(project, a);
  const program = seed.meta.product.program.display ?? NOT_ESTABLISHED;
  const stepLabel = (id?: string) => (id ? (a.steps.find((s) => s.id === id)?.label ?? id) : "Not placed on a step");
  const refOf = documentSourceRefs(content, project);
  const stop = (s: string) => (/[.!?]$/.test(s.trimEnd()) ? s : `${s}.`);
  const evals = new Map(a.items.map((i) => [i.id, evaluateItem(a, i)]));
  const showResidual = hasResidual(a) && !omit.has("residual");

  const sections: DocSection[] = [];
  const add = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String(sections.filter((s) => !s.appendix).length + 1), title, blocks });
  const appendix = (id: string, title: string, blocks: Block[]) => sections.push({ id, number: String.fromCharCode(65 + sections.filter((s) => s.appendix).length), appendix: true, title, blocks });

  // 1. Purpose and scope
  add("purpose-scope", "Purpose and scope", [
    { type: "note", text: riskBasisText(project.meta.id) },
    {
      type: "paragraph",
      text: `This draft records a quality risk assessment of the technology transfer of ${program} to the receiving unit, in the manner of ICH Q9(R1): the failure modes the team identified, how the team scored them with the method chosen below, the controls in place and the actions agreed. It records the team's own judgement. The tool calculates the scores from the team's entries and does not judge whether any risk is acceptable.`,
    },
    { type: "paragraph", text: `Assessment ${a.id}: ${a.title}. ${a.items.length} item${a.items.length === 1 ? "" : "s"}, ${a.actions.length} action${a.actions.length === 1 ? "" : "s"}, ${open.length} open item${open.length === 1 ? "" : "s"}.` },
    ...(a.scopeNote?.trim() ? ([{ type: "heading", text: "Scope" }, { type: "paragraph", text: a.scopeNote.trim() }] as Block[]) : []),
    ...(a.context?.trim() ? ([{ type: "heading", text: "Context" }, { type: "paragraph", text: a.context.trim() }] as Block[]) : []),
    ...(a.steps.length ? ([{ type: "heading", text: "Process steps covered" }, { type: "list", items: a.steps.map((s) => s.label) }] as Block[]) : []),
  ]);

  // 2. Method, described from the saved config
  const methodBlocks: Block[] = [];
  if (!cfg) {
    methodBlocks.push({ type: "paragraph", text: "No risk method has been chosen yet. This is an open item. No item can be scored until the team chooses one." });
  } else {
    const d = describeMethod(cfg);
    methodBlocks.push({ type: "paragraph", text: `Method: ${d.title}. ${cfg.libraryRef ? `Taken from the method library: ${cfg.libraryRef.name}, version ${cfg.libraryRef.version}. ` : ""}${d.formula}` });
    for (const s of d.scales) {
      methodBlocks.push({ type: "heading", text: `${s.name}: scale ${s.min} to ${s.max}` });
      methodBlocks.push(s.levels.length ? { type: "table", columns: ["Level", "Description"], rows: s.levels.map((l) => [String(l.value), l.description]) } : { type: "paragraph", text: "No level descriptions were given for this scale." });
    }
    for (const l of d.levelLists) {
      methodBlocks.push({ type: "heading", text: l.name });
      methodBlocks.push({ type: "table", columns: ["Level", "Description"], rows: l.levels.map((x) => [x.label, x.description ?? ""]) });
    }
    if (d.grid) {
      methodBlocks.push({ type: "heading", text: "Matrix (rows: likelihood, columns: severity)" });
      methodBlocks.push({ type: "table", columns: ["Likelihood \\ Severity", ...d.grid.cols], rows: d.grid.rows.map((r, i) => [r, ...d.grid!.cells[i]!.map((c) => c || "No label")]) });
    }
    methodBlocks.push({ type: "paragraph", text: d.bandsText });
    if (d.bands.length) methodBlocks.push({ type: "table", columns: ["Band (user's label)", "Range", "Note"], rows: d.bands.map((b) => [b.label, b.range, b.note ?? ""]) });
    if (d.extra.length) methodBlocks.push({ type: "list", items: d.extra });
    for (const p of d.problems) methodBlocks.push({ type: "note", text: `Method problem: ${p}` });
    if (isTr44(cfg)) {
      // The threshold is the team's number; the document only repeats it. The one example figure of the report is not printed as a value.
      methodBlocks.push({ type: "heading", text: "Action threshold" });
      methodBlocks.push({
        type: "paragraph",
        text: a.actionThreshold !== undefined ? `A row whose risk priority is above ${a.actionThreshold} needs recommended actions (threshold entered by the team).` : "No action threshold has been entered. This is an open item.",
      });
      methodBlocks.push({ type: "note", text: `Layout after PDA TR 44 s4.1; severity and sampling confidence after PDA TR 60 s6.1; intervention scoring after PDA TR 22 Example 3 (paraphrased, not reproduced).` });
    }
  }
  add("method", "Risk method", methodBlocks);

  // 3. Register
  const factors = cfg ? factorColumns(cfg) : [];
  const qualitative = cfg?.method === "qualitative";
  const scoreCell = (r: ReturnType<typeof evaluateItem>["initial"] | undefined): string => (!r ? "" : !r.scored ? "Not scored" : r.score !== undefined ? String(r.score) : "Not applicable");
  const bandCell = (r: ReturnType<typeof evaluateItem>["initial"] | undefined): string => {
    if (!r) return "";
    if (!r.scored) return "Not scored";
    const parts: string[] = [];
    if (r.label) parts.push(r.label);
    else if (cfg && (cfg.method === "fmea" || cfg.method === "custom") && r.score !== undefined) parts.push("No band defined");
    if (r.trigger) parts.push(`Rule: ${r.trigger.label}`);
    return parts.join("; ");
  };
  const controls = (i: RiskItem) => [i.controlsPrevention ? `Prevention: ${i.controlsPrevention}` : "", i.controlsDetection ? `Detection: ${i.controlsDetection}` : ""].filter(Boolean).join("; ");
  const actionsOf = (i: RiskItem) => a.actions.filter((x) => x.itemId === i.id).map((x) => `${x.id} ${x.text} (${STATUS_TEXT[x.status]})`).join("; ");
  const columns = ["ID", "Step", "Failure mode", "Effect", "Cause", "Controls", cfg ? (qualitative ? "Level" : "Answers") : "Answers", qualitative ? "Reason" : "Score", ...(qualitative ? [] : ["Band"]), ...(showResidual ? (qualitative ? ["Residual level", "Residual reason"] : ["Residual answers", "Residual score", "Residual band"]) : []), "Actions"];
  const rows = a.items.map((i) => {
    const e = evals.get(i.id)!;
    const row = [i.id, stepLabel(i.stepId), i.failureMode || "Not described", i.effect ?? "", i.causes ?? "", controls(i), cfg ? describeAnswers(cfg, i.initial) || "Not given" : "Not given"];
    if (qualitative) row.push(i.initial.reason ?? (e.initial.scored ? "Missing" : ""));
    else row.push(scoreCell(e.initial), bandCell(e.initial));
    if (showResidual) {
      if (qualitative) row.push(i.residual ? (cfg ? describeAnswers(cfg, i.residual) : "") : "", i.residual?.reason ?? (i.residual ? "Missing" : ""));
      else row.push(i.residual && cfg ? describeAnswers(cfg, i.residual) || "Not given" : "", scoreCell(e.residual), bandCell(e.residual));
    }
    row.push(actionsOf(i));
    return row;
  });
  // PDA TR 44 layout: the columns of the report's FMEA, in its order. The failure mode carries its effect so no entered text is lost.
  const tr44 = isTr44(cfg);
  const tr44Columns = ["ID", "Step", "Failure mode and effect", "Severity", "Causes", "Occurrence", "Current controls", "Detection (reversed: high = poor)", "Risk priority (S x O x D)", "Risk accepted?", "Recommended actions", "After actions: S, O, D", "After actions: priority"];
  const tr44Rows = tr44
    ? a.items.map((i) => {
        const e = evals.get(i.id)!;
        const t = thresholdReading(a, e);
        const v = (k: string) => (i.initial.values[k] !== undefined ? String(i.initial.values[k]) : "Not given");
        const side = (above: boolean | undefined) => (above === true ? `; above the action threshold (${t.threshold})` : above === false ? `; not above the action threshold (${t.threshold})` : "");
        const priority = e.initial.scored ? `${e.initial.score}${side(t.above)}` : "Not scored";
        const after = !e.residual ? "None entered" : e.residual.scored ? `${e.residual.score}${t.residualAbove === true ? `; still above the action threshold (${t.threshold})` : t.residualAbove === false ? `; not above the action threshold (${t.threshold})` : ""}` : "Not scored";
        return [
          i.id,
          stepLabel(i.stepId),
          [i.failureMode || "Not described", i.effect ? `Effect: ${i.effect}` : ""].filter(Boolean).join(". "),
          v("severity"),
          i.causes ?? "",
          v("occurrence"),
          controls(i),
          v("detection"),
          priority,
          i.accepted === "yes" ? "Yes" : i.accepted === "no" ? "No" : "Not answered",
          actionsOf(i),
          i.residual ? describeAnswers(cfg!, i.residual) || "Not given" : "None entered",
          after,
        ];
      })
    : [];
  add("register", "Risk register", [
    {
      type: "paragraph",
      text: a.items.length
        ? `The register lists ${a.items.length} item${a.items.length === 1 ? "" : "s"}, in the order the team entered them. ${cfg ? "Each score is calculated from the team's answers with the method above; the working for every score is in the project, and can be repeated by hand." : "Nothing is scored because no method has been chosen."} ${showResidual ? "Residual columns show the score after the controls and actions, where the team entered one." : "No residual score was entered."}`
        : "No items have been entered yet. This is an open item.",
    },
    ...(a.items.length ? ([{ type: "table", columns: tr44 ? tr44Columns : columns, rows: tr44 ? tr44Rows : rows, caption: `Risk register ${a.id}` }] as Block[]) : []),
    ...(cfg?.method === "fmea" && cfg.severityTrigger ? ([{ type: "note", text: `Rule defined by the user: a severity of ${cfg.severityTrigger.min} or more gives "${cfg.severityTrigger.label}" whatever the RPN.` }] as Block[]) : []),
  ]);

  // 3b. Matrix heat table: counts per cell
  if (cfg?.method === "matrix" && !omit.has("heat")) {
    const heat = heatCounts(cfg, a.items.map((i) => i.initial));
    add("heat", "Items per matrix cell", [
      { type: "paragraph", text: `${heat.placed} item${heat.placed === 1 ? " is" : "s are"} placed in the matrix (initial scores); ${heat.notScored} ${heat.notScored === 1 ? "is" : "are"} not scored and cannot be placed.` },
      { type: "table", columns: ["Likelihood \\ Severity", ...cfg.severity.map((s) => s.label)], rows: cfg.likelihood.map((l, r) => [l.label, ...cfg.severity.map((_, c) => `${heat.counts[r]![c]} item${heat.counts[r]![c] === 1 ? "" : "s"}${cfg.cells.find((x) => x.row === r + 1 && x.col === c + 1)?.label ? ` (${cfg.cells.find((x) => x.row === r + 1 && x.col === c + 1)!.label})` : ""}`)] ) },
    ]);
  }

  // 3c. Intervention scoring (PDA TR 22 example): only for items that carry it. The overall level is the team's choice.
  const withIv = a.items.filter((i) => !interventionIsEmpty(i.intervention));
  if (tr44 && withIv.length) {
    add("interventions", "Intervention risk scoring", [
      { type: "paragraph", text: "Each aseptic intervention below was rated low, medium or high on five aspects, and the team chose the overall level. The tool counts the answers but does not turn them into a level. The simulation frequency is a hint from PDA TR 22, not a decision." },
      {
        type: "table",
        columns: ["Item", "Intervention", ...Object.values(INTERVENTION_LABEL), "Overall level (team's choice)", "Simulation frequency hint"],
        rows: withIv.map((i) => [
          i.id,
          i.failureMode || "Not described",
          ...(["complexity", "duration", "proximity", "frequency", "airflow"] as const).map((k) => (i.intervention?.[k] ? LMH_LABEL[i.intervention[k]!] : "Not given")),
          i.intervention?.level ? LMH_LABEL[i.intervention.level] : "Not chosen",
          i.intervention?.level ? INTERVENTION_SIMULATION_HINT[i.intervention.level] : "",
        ]),
      },
      ...(withIv.some((i) => interventionTally(i.intervention).missing.length) ? ([{ type: "note", text: "At least one intervention has an aspect that was not rated. It stays \"Not given\"." }] as Block[]) : []),
    ]);
  }
  const linked = tr44 ? a.items.flatMap((i) => linkedConfidence(project, i).map((l) => ({ item: i.id, ...l }))) : [];
  if (tr44 && linked.length) {
    add("confidence", "Severity and sampling confidence", [
      { type: "paragraph", text: severityConfidenceText() },
      { type: "table", columns: ["Item", "Sampling point", "Confidence entered on the sample set"], rows: linked.map((l) => [l.item, l.ref, l.confidencePercent !== undefined ? `${l.confidencePercent} %` : "Not entered"]) },
    ]);
  }

  // 3d. Review triggers and history (a living document). Present only when the team entered any of it.
  if (a.reviewTriggers?.length || a.nextReview || a.reviews?.length) {
    add("review", "Review triggers and history", [
      { type: "paragraph", text: "This assessment is a living document. It is looked at again when one of the reasons below arises." },
      ...(a.reviewTriggers?.length ? ([{ type: "list", items: a.reviewTriggers.map((t) => RISK_REVIEW_TRIGGER_LABEL[t]) }] as Block[]) : ([{ type: "paragraph", text: "No review triggers were ticked." }] as Block[])),
      { type: "paragraph", text: a.nextReview ? `Next periodic review planned: ${a.nextReview}.` : "No date for the next periodic review has been entered." },
      a.reviews?.length
        ? { type: "table", columns: ["Review", "Date", "Reason", "Note", "By"], rows: a.reviews.map((r) => [r.id, r.date, r.trigger ? RISK_REVIEW_TRIGGER_LABEL[r.trigger] : "Not given", r.note, r.by ?? "Not given"]) }
        : { type: "paragraph", text: "No review has been recorded yet." },
    ]);
  }

  // 4. Actions
  if (!omit.has("actions")) {
    add("actions", "Action list", [
      a.actions.length
        ? { type: "table", columns: ["Action", "Item", "Description", "Owner", "Due", "Status"], rows: a.actions.map((x) => [x.id, x.itemId, x.text, x.owner ?? "Not given", x.due ?? "Not given", STATUS_TEXT[x.status]]) }
        : { type: "paragraph", text: "No actions have been entered." },
    ]);
  }

  // 5. Open items (always in the document)
  add("open-items", "Open items", [
    {
      type: "paragraph",
      text: open.length
        ? "Entries still missing or to be decided. Nothing has been filled in on behalf of the team. The assessment cannot be approved while these remain."
        : "No open items. This does not mean the risks are acceptable; that is for the team and QA to judge.",
    },
    ...(open.length ? ([{ type: "table", columns: ["Item", "Open item"], rows: open.map((o) => [o.itemId ?? "Assessment", stop(o.text)]) }] as Block[]) : []),
  ]);

  // 6. Approval, only when the team named approvers
  if (a.approvals?.length) {
    add("approval", "Approval", [
      { type: "paragraph", text: "The roles below were named by the team. This document is a draft and is not signed." },
      { type: "table", columns: ["Role", "Name", "Signature", "Date"], rows: a.approvals.map((x) => [x.role, x.name ?? "[placeholder]", "[placeholder]", x.date ?? "[placeholder]"]) },
    ]);
  }

  // Appendix: traceability
  if (!omit.has("traceability")) {
    const gapSeverity = new Map(assess(content, project).gaps.map((g) => [g.displayId, g.severity]));
    const origin = (i: RiskItem): string => (i.origin?.kind === "gap" ? "From the gap assessment" : i.origin?.kind === "catalog" ? `Failure-mode catalog: ${i.origin.suggestionKey ?? ""}${i.origin.catalogVersion ? ` (version ${i.origin.catalogVersion})` : ""}` : "Added by hand");
    appendix("traceability", "Traceability", [
      { type: "paragraph", text: "For each item, where it came from and what it is linked to. Gap ids can renumber when the gap assessment changes. The gap severity is shown as reference only: it is never part of a risk score." },
      a.items.length
        ? {
            type: "table",
            columns: ["Item", "Origin", "Gap ids", "Gap severity (reference only)", "Sampling points", "Sources"],
            rows: a.items.map((i) => [i.id, origin(i), i.gapIds.join(", "), i.gapIds.map((g) => `${g}: ${gapSeverity.get(g) ?? "gap no longer in the assessment"}`).join("; "), i.samplingPointIds.join(", "), i.sourceIds.map((s) => refOf.get(s) ?? s).join(", ")]),
          }
        : { type: "paragraph", text: "No items." },
    ]);
  }

  // Appendix: versions
  appendix("versions", "Versions", [
    {
      type: "table",
      columns: ["Item", "Value"],
      rows: [
        ["Generator", `${opts.generatorName ?? "Gap Assessment Generator (proof of concept)"} ${opts.appVersion ?? "unversioned"}`],
        ["Risk assessment format", RISK_FORMAT_VERSION],
        ["Process model", PROCESS_MODEL_VERSION],
        ["Risk scoring", RISK_SCORING_VERSION],
        ["Failure-mode catalog", library.catalog.version],
        ["Project schema", project.schemaVersion ?? SCHEMA_VERSION],
        ["Assessment last changed", a.updatedAt.replace("T", " ").slice(0, 16) + " UTC"],
      ],
    },
    { type: "note", text: "This document uses the built-in style only. A customer template is not applied to the risk assessment." },
  ]);

  const m = seed.meta;
  return {
    title: RISK_ASSESSMENT_TITLE,
    banner: RISK_BANNER,
    status: "DRAFT",
    meta: [
      ["Project", project.meta.title],
      ["Assessment", `${a.id}: ${a.title}`],
      ["Method", cfg ? describeMethod(cfg).title : "Not chosen"],
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
