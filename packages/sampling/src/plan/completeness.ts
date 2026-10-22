import { reportOnlyAllowed, type BatchResult, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { appliedBatches, calculatePoint } from "./calc.js";
import { CATEGORY_LABEL } from "./labels.js";

/** Status shown as TEXT beside every point (never colour alone). */
export type PointStatus = "complete" | "incomplete";
export const STATUS_TEXT: Record<PointStatus, string> = { complete: "Complete", incomplete: "Incomplete" };

export interface PointCheck {
  status: PointStatus;
  /** One sentence per missing or wrong thing. Empty when complete. */
  problems: string[];
  /** The fresh calculation, one entry per applicable batch. */
  perBatch: BatchResult[];
}

/**
 * Everything a point still needs before it can be called complete. A point is never completed by a default: each missing
 * decision is listed here and shown as an open item. The checks say whether the *entries* are there, never whether the choices
 * are adequate for the process; that is for QA and statistics.
 */
export function checkPoint(plan: SamplingPlan, point: SamplingPoint): PointCheck {
  const problems: string[] = [];
  const perBatch = calculatePoint(plan, point);

  if (!point.attribute.trim()) problems.push("Name the attribute or test.");
  if (!point.rationale.trim()) problems.push("Give the rationale: why this point is sampled.");
  const t = point.timing;
  if (t.options.length === 0) problems.push("Choose when or where the samples are taken.");
  if (t.options.includes("interval") && !t.interval) problems.push("Give the interval (a number and units or minutes).");
  if (t.options.includes("other") && !t.other?.trim()) problems.push('Say what "other" timing means.');
  if (point.locationsCount === undefined) problems.push("Give how many locations or time points are sampled per batch.");
  if (point.category === "other" && !point.categoryLabel?.trim()) problems.push('Say what the "other" category is.');

  if (!point.acceptance) {
    problems.push("Choose an acceptance criterion, or report only where that is allowed.");
  } else if (point.acceptance.kind === "criterion" && !point.acceptance.text.trim()) {
    problems.push("Write the acceptance criterion.");
  } else if (point.acceptance.kind === "report_only" && !reportOnlyAllowed(point.category)) {
    // The schema refuses this too; the text here covers a point built in memory before it is saved.
    problems.push(`Report only is not allowed for ${CATEGORY_LABEL[point.category].toLowerCase()} points.`);
  }

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

  return { status: problems.length === 0 ? "complete" : "incomplete", problems, perBatch };
}

export interface OpenItem {
  /** "plan", a batch id or a point id. */
  ref: string;
  kind: "plan" | "batch" | "point";
  text: string;
}

/** Plan-level open items, then one per problem of every incomplete point. The document and the page list the same items. */
export function openItems(plan: SamplingPlan): OpenItem[] {
  const items: OpenItem[] = [];
  if (plan.batches.length === 0) items.push({ ref: "plan", kind: "plan", text: "No PPQ batches yet. The number of batches is a decision for the team; there is no default." });
  if (!plan.batchRationale.trim()) items.push({ ref: "plan", kind: "plan", text: "The rationale for the number of batches is empty." });
  if (plan.points.length === 0) items.push({ ref: "plan", kind: "plan", text: "No sampling points yet." });
  for (const p of plan.points) {
    for (const text of checkPoint(plan, p).problems) items.push({ ref: p.id, kind: "point", text });
  }
  return items;
}
