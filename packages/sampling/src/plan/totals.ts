import type { SamplingPlan, SamplingPoint } from "@gap/process-model";
import { checkPoint } from "./completeness.js";

/** What one point takes from one batch. */
export interface BatchUnits {
  batchId: string;
  batchLabel: string;
  /** False when the point is not planned for this batch. */
  applies: boolean;
  /** Units per location (the method's sample size). */
  sampleSize?: number;
  /** The method says to inspect the whole lot. The units are then the lot, which is not a pull from the batch to count. */
  hundredPercent: boolean;
  /** sampleSize x locationsCount. Absent for 100 % inspection and for anything not worked out. */
  units?: number;
  /** Text for a table cell: "3 x 5 = 15", "100% of lot", "Not worked out", "Not planned". */
  text: string;
}

/**
 * Units a point takes from each batch: sample size x number of locations. A 100 % inspection is shown as "100% of lot" and
 * kept out of the totals (it is the whole lot, not a pull); the totals say so. A point that cannot be worked out yet shows
 * "Not worked out" and adds nothing; it is also an open item, so the total is never presented as complete while it is missing.
 */
export function unitsPerBatch(plan: SamplingPlan, point: SamplingPoint): BatchUnits[] {
  const results = new Map(checkPoint(plan, point).perBatch.map((r) => [r.batchId, r]));
  return plan.batches.map((b) => {
    const r = results.get(b.id);
    const base = { batchId: b.id, batchLabel: b.label };
    if (!r) return { ...base, applies: false, hundredPercent: false, text: "Not planned" };
    if (r.hundredPercent) return { ...base, applies: true, hundredPercent: true, ...(r.sampleSize !== undefined ? { sampleSize: r.sampleSize } : {}), text: "100% of lot" };
    if (!r.ok || r.sampleSize === undefined) return { ...base, applies: true, hundredPercent: false, text: "Not worked out" };
    if (point.locationsCount === undefined) return { ...base, applies: true, hundredPercent: false, sampleSize: r.sampleSize, text: "Not worked out" };
    const units = r.sampleSize * point.locationsCount;
    return { ...base, applies: true, hundredPercent: false, sampleSize: r.sampleSize, units, text: `${r.sampleSize} x ${point.locationsCount} = ${units}` };
  });
}

export interface BatchTotal {
  batchId: string;
  batchLabel: string;
  /** Units consumed by the points that could be worked out. */
  units: number;
  /** Points that apply but could not be worked out (the total is a lower bound while any is listed). */
  notWorkedOut: string[];
  /** Points inspected at 100 % of the lot, left out of `units`. */
  hundredPercent: string[];
}

export interface PlanTotals {
  perBatch: BatchTotal[];
  units: number;
  notWorkedOut: string[];
  hundredPercent: string[];
  /** Sentences the document prints under the totals table. */
  notes: string[];
}

export function planTotals(plan: SamplingPlan): PlanTotals {
  const perBatch: BatchTotal[] = plan.batches.map((b) => ({ batchId: b.id, batchLabel: b.label, units: 0, notWorkedOut: [], hundredPercent: [] }));
  for (const point of plan.points) {
    for (const u of unitsPerBatch(plan, point)) {
      if (!u.applies) continue;
      const total = perBatch.find((t) => t.batchId === u.batchId)!;
      if (u.hundredPercent) total.hundredPercent.push(point.id);
      else if (u.units === undefined) total.notWorkedOut.push(point.id);
      else total.units += u.units;
    }
  }
  const union = (pick: (t: BatchTotal) => string[]) => [...new Set(perBatch.flatMap(pick))];
  const notWorkedOut = union((t) => t.notWorkedOut);
  const hundredPercent = union((t) => t.hundredPercent);
  const notes: string[] = [];
  if (hundredPercent.length) notes.push(`${hundredPercent.join(", ")}: 100% of the lot is inspected. The lot is not counted in the totals.`);
  if (notWorkedOut.length) notes.push(`${notWorkedOut.join(", ")}: not worked out yet, so the totals are a lower bound. See the open items.`);
  return { perBatch, units: perBatch.reduce((s, t) => s + t.units, 0), notWorkedOut, hundredPercent, notes };
}
