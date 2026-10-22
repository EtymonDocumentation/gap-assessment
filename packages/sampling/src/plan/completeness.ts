import { reportOnlyAllowed, type BatchResult, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { agencyOpenItems } from "./agency.js";
import { appliedBatches, calculatePoint } from "./calc.js";
import { retainDerivation, stabilityDerivation, usesSampleSizeMethod } from "./derive.js";
import { TYPE_LABEL } from "./labels.js";

/** Status shown as TEXT beside every point (never colour alone). */
export type PointStatus = "complete" | "incomplete";
export const STATUS_TEXT: Record<PointStatus, string> = { complete: "Complete", incomplete: "Incomplete" };

export interface PointCheck {
  status: PointStatus;
  /** One sentence per missing or wrong thing. Empty when complete. */
  problems: string[];
  /** The fresh calculation, one entry per applicable batch. Empty for stability and retain points (no sample-size method). */
  perBatch: BatchResult[];
}

const blank = (s: string | undefined): boolean => !s || !s.trim();

/**
 * What each study type needs besides the common entries. These sentences ARE the "required set per type": the tests list them.
 * Each returns the missing things; none supplies a value.
 */
function typeProblems(point: SamplingPoint): string[] {
  const d = point.detail;
  const out: string[] = [];
  switch (point.type) {
    case "ipc":
    case "release":
      break;
    case "ppq_enhanced": {
      const e = d?.enhanced;
      if (blank(e?.interventions)) out.push("Say which interventions or stoppages the enhanced sampling covers.");
      if (point.timing.options.includes("interval") && blank(e?.intervalDefinition)) out.push("Define the sampling interval (what is counted and when).");
      if ((point.timing.options.includes("per_needle") || point.timing.options.includes("per_lyo_shelf")) && blank(e?.perNeedleShelf)) out.push("Give the per-needle or per-shelf details (which needles or shelves, how many).");
      break;
    }
    case "mixing_homogeneity": {
      const m = d?.mixing;
      if (blank(m?.vesselRef)) out.push("Name the vessel or equipment.");
      if (blank(m?.parameters)) out.push("Give the mixing parameters (for example speed and time).");
      if (!m?.positions?.length) out.push("Choose the sampling positions (top, middle, bottom or other).");
      else if (m.positions.includes("other") && blank(m.positionsOther)) out.push('Say what the "other" sampling position is.');
      if (!m?.timePoints?.length) out.push("Add at least one time point.");
      if (blank(m?.criterionBasis)) out.push("Give the basis of the criterion (for example an RSD or a percentage of target).");
      // The study design (runs, ranges) is optional on purpose: it is never required or checked here.
      break;
    }
    case "hold_time": {
      const h = d?.hold;
      if (blank(h?.holdStep)) out.push("Choose the step after which the material is held.");
      if (blank(h?.start)) out.push("Define when the hold starts.");
      if (blank(h?.end)) out.push("Define when the hold ends.");
      if (!h?.durations?.length) out.push("Add at least one hold duration to test.");
      if (blank(h?.condition)) out.push("Give the hold temperature or condition.");
      if (blank(h?.supports)) out.push("Say what the result supports (the proposed maximum hold time).");
      break;
    }
    case "filter_study": {
      const f = d?.filter;
      if (blank(f?.filterRef)) out.push("Name the filter (identifier or type).");
      if (!f?.test) out.push("Choose the filter test.");
      else if (f.test === "other" && blank(f.testOther)) out.push('Say what the "other" filter test is.');
      break;
    }
    case "stability": {
      const s = d?.stability;
      if (blank(s?.protocolRef)) out.push("Give the stability protocol reference.");
      out.push(...stabilityDerivation(point).problems);
      break;
    }
    case "retain_reserve": {
      const r = d?.retain;
      if (!r?.purpose) out.push("Say whether this is a retain, a reserve or both.");
      if (blank(r?.quantityBasis)) out.push("Write the basis of the quantity.");
      if (blank(r?.retentionPeriod)) out.push("Give the retention period.");
      if (blank(r?.storage)) out.push("Give the storage condition.");
      if (blank(r?.requirementRef)) out.push("Cite the requirement the quantity and period come from.");
      out.push(...retainDerivation(point).problems);
      break;
    }
    case "characterization":
    case "supporting_study": {
      const a = d?.analyses;
      if (!a?.analyses?.length) out.push("List at least one analysis.");
      else if (a.analyses.some((x) => blank(x.name))) out.push("Name every analysis.");
      if (blank(a?.informs)) out.push("Say what decision or report the result informs.");
      break;
    }
    case "regulatory_commitment":
      if (!point.agencyRequestIds?.length) out.push("Link at least one agency request this study answers.");
      if (blank(d?.commitment?.answer)) out.push("Say how this study answers the request.");
      break;
    case "other":
      if (blank(point.typeLabel)) out.push('Say what the "other" study type is.');
      break;
  }
  return out;
}

/**
 * Everything a point still needs before it can be called complete. A point is never completed by a default: each missing
 * decision is listed here and shown as an open item. The checks say whether the *entries* are there, never whether the choices
 * are adequate for the process; that is for QA and statistics.
 *
 * The common entries (attribute, rationale, responsible party, acceptance, what to report) apply to every type. Timing,
 * locations and a sample-size method apply to every type except stability and retain, whose quantity is worked out from their own
 * entries (see derive.ts). The entries that only one type asks for are in typeProblems().
 */
export function checkPoint(plan: SamplingPlan, point: SamplingPoint): PointCheck {
  const problems: string[] = [];
  const byMethod = usesSampleSizeMethod(point);
  const perBatch = byMethod ? calculatePoint(plan, point) : [];

  if (!point.type) problems.push("Choose the study type (for a migrated routine point: in-process control or release).");
  if (!point.attribute.trim()) problems.push("Name the attribute or test.");
  if (!point.rationale.trim()) problems.push("Give the rationale: why this point is sampled.");
  if (!point.responsible) problems.push("Say who is responsible for this sample (CMO, sponsor, contract laboratory or other).");
  else if (point.responsible.party === "other" && blank(point.responsible.name)) problems.push('Name the responsible party ("other").');

  if (byMethod) {
    const t = point.timing;
    if (t.options.length === 0) problems.push("Choose when or where the samples are taken.");
    if (t.options.includes("interval") && !t.interval) problems.push("Give the interval (a number and units or minutes).");
    if (t.options.includes("other") && !t.other?.trim()) problems.push('Say what "other" timing means.');
    if (point.locationsCount === undefined) problems.push("Give how many locations or time points are sampled per batch.");
  }

  if (!point.acceptance) {
    problems.push("Choose an acceptance criterion, or report only where that is allowed.");
  } else if (point.acceptance.kind === "criterion" && !point.acceptance.text.trim()) {
    problems.push("Write the acceptance criterion.");
  } else if (point.acceptance.kind === "report_only") {
    if (!reportOnlyAllowed(point.type)) {
      // The schema refuses this too; the text here covers a point built in memory before it is saved.
      problems.push(point.type ? `Report only is not allowed for ${TYPE_LABEL[point.type].toLowerCase()} points.` : "Report only is not allowed until the study type is chosen.");
    } else if (point.type === "stability" && point.detail?.stability?.reportedAgainstProtocol !== true) {
      problems.push("Report only is allowed for stability only when the results are reported against the stability protocol. Confirm that, or write a criterion.");
    }
  }

  if (byMethod) {
    if (!point.sampleSize.method) {
      problems.push("Choose a sample-size method.");
    } else if (appliedBatches(plan, point).length === 0) {
      problems.push(plan.batches.length === 0 ? "Add the PPQ batches first; sample sizes are worked out per batch." : "The point applies to no batch.");
    } else {
      // A problem every batch has (a missing confidence) is said once. A problem only some batches have (one batch has no lot size,
      // or its lot size falls outside the table) names the batch, so the reader knows where to fix it.
      const label = (id: string) => plan.batches.find((b) => b.id === id)?.label ?? id;
      const count = new Map<string, number>();
      for (const r of perBatch) for (const p of new Set(r.problems)) count.set(p, (count.get(p) ?? 0) + 1);
      const said = new Set<string>();
      for (const r of perBatch) {
        for (const p of r.problems) {
          const everywhere = count.get(p) === perBatch.length;
          const text = everywhere ? p : `${label(r.batchId)}: ${p}`;
          if (said.has(text)) continue;
          said.add(text);
          problems.push(text);
        }
        if (!r.ok && r.problems.length === 0) problems.push(`${label(r.batchId)}: no sample size could be worked out.`);
      }
    }
  } else if (appliedBatches(plan, point).length === 0) {
    problems.push(plan.batches.length === 0 ? "Add the PPQ batches first." : "The point applies to no batch.");
  }

  problems.push(...typeProblems(point));

  const rep = point.reporting;
  if (!rep?.what?.length) problems.push("Say what the CMO reports for this point (the reporting instructions).");
  else if (rep.what.includes("other") && blank(rep.whatOther)) problems.push('Say what the "other" reporting item is.');

  return { status: problems.length === 0 ? "complete" : "incomplete", problems, perBatch };
}

export interface OpenItem {
  /** "plan", a batch id, a point id, an agency request id or a subsection id. */
  ref: string;
  kind: "plan" | "batch" | "point" | "agency" | "subsection";
  text: string;
}

/** Plan-level open items, then one per problem of every incomplete point, then the agency-request items. The document and the page list the same items. */
export function openItems(plan: SamplingPlan): OpenItem[] {
  const items: OpenItem[] = [];
  if (plan.batches.length === 0) items.push({ ref: "plan", kind: "plan", text: "No PPQ batches yet. The number of batches is a decision for the team; there is no default." });
  if (!plan.batchRationale.trim()) items.push({ ref: "plan", kind: "plan", text: "The rationale for the number of batches is empty." });
  if (plan.parties.length === 0) items.push({ ref: "plan", kind: "plan", text: "No responsible parties named yet (who samples, tests and reports)." });
  if (plan.points.length === 0) items.push({ ref: "plan", kind: "plan", text: "No sampling points yet." });
  for (const p of plan.points) {
    for (const text of checkPoint(plan, p).problems) items.push({ ref: p.id, kind: "point", text });
  }
  items.push(...agencyOpenItems(plan));
  return items;
}
