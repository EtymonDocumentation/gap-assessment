import type { SamplingPlan, SamplingPoint } from "@gap/process-model";
import { appliedBatches } from "./calc.js";
import { checkPoint } from "./completeness.js";
import { retainDerivation, stabilityDerivation } from "./derive.js";

/** Which column of the totals a point's units go in. */
export type UnitsKind = "process" | "stability" | "retain";

export const unitsKindOf = (point: Pick<SamplingPoint, "type">): UnitsKind => (point.type === "stability" ? "stability" : point.type === "retain_reserve" ? "retain" : "process");

/** What one point takes from one batch. */
export interface BatchUnits {
  batchId: string;
  batchLabel: string;
  /** False when the point is not planned for this batch. */
  applies: boolean;
  kind: UnitsKind;
  /** Units per location (the method's sample size). */
  sampleSize?: number;
  /** The method says to inspect the whole lot. The units are then the lot, which is not a pull from the batch to count. */
  hundredPercent: boolean;
  /** sampleSize x locationsCount for process samples; pulls x units per pull for stability; the typed count for retains. */
  units?: number;
  /** Text for a table cell: "3 x 5 = 15", "100% of lot", "Not worked out", "Not planned". */
  text: string;
}

/**
 * Units a point takes from each batch. Process samples: sample size x number of locations. Stability: pulls x units per pull
 * (conditions x time points x units, from the person's entries). Retain: the typed count. A 100 % inspection is shown as
 * "100% of lot" and kept out of the totals (it is the whole lot, not a pull); the totals say so. A point that cannot be worked
 * out yet shows "Not worked out" and adds nothing; it is also an open item, so the total is never presented as complete while
 * it is missing.
 */
export function unitsPerBatch(plan: SamplingPlan, point: SamplingPoint): BatchUnits[] {
  const kind = unitsKindOf(point);
  if (kind !== "process") {
    // Stability and retain quantities do not depend on a lot size, so they are the same for every batch the point applies to.
    const applied = new Set(appliedBatches(plan, point).map((b) => b.id));
    const derived = kind === "stability" ? stabilityDerivation(point) : retainDerivation(point);
    const units = derived.units;
    const text = units === undefined ? "Not worked out" : kind === "stability" ? `${(derived as ReturnType<typeof stabilityDerivation>).pulls} x ${(derived as ReturnType<typeof stabilityDerivation>).unitsPerPull} = ${units}` : `${units} kept`;
    return plan.batches.map((b) =>
      applied.has(b.id)
        ? { batchId: b.id, batchLabel: b.label, applies: true, kind, hundredPercent: false, ...(units !== undefined ? { units } : {}), text }
        : { batchId: b.id, batchLabel: b.label, applies: false, kind, hundredPercent: false, text: "Not planned" },
    );
  }
  const results = new Map(checkPoint(plan, point).perBatch.map((r) => [r.batchId, r]));
  return plan.batches.map((b) => {
    const r = results.get(b.id);
    const base = { batchId: b.id, batchLabel: b.label, kind };
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
  /** Process-sample units consumed by the points that could be worked out. */
  units: number;
  /** Stability units (pulls x units per pull). Kept in their own column: they are put on the stability programme, not tested in the run. */
  stabilityUnits: number;
  /** Retain and reserve units. */
  retainUnits: number;
  /** Points that apply but could not be worked out (the total is a lower bound while any is listed). */
  notWorkedOut: string[];
  /** Points inspected at 100 % of the lot, left out of `units`. */
  hundredPercent: string[];
}

export interface PlanTotals {
  perBatch: BatchTotal[];
  units: number;
  stabilityUnits: number;
  retainUnits: number;
  /** Process + stability + retain. */
  allUnits: number;
  notWorkedOut: string[];
  hundredPercent: string[];
  /** Sentences the document prints under the totals table. */
  notes: string[];
}

export function planTotals(plan: SamplingPlan): PlanTotals {
  const perBatch: BatchTotal[] = plan.batches.map((b) => ({ batchId: b.id, batchLabel: b.label, units: 0, stabilityUnits: 0, retainUnits: 0, notWorkedOut: [], hundredPercent: [] }));
  for (const point of plan.points) {
    for (const u of unitsPerBatch(plan, point)) {
      if (!u.applies) continue;
      const total = perBatch.find((t) => t.batchId === u.batchId)!;
      if (u.hundredPercent) total.hundredPercent.push(point.id);
      else if (u.units === undefined) total.notWorkedOut.push(point.id);
      else if (u.kind === "stability") total.stabilityUnits += u.units;
      else if (u.kind === "retain") total.retainUnits += u.units;
      else total.units += u.units;
    }
  }
  const union = (pick: (t: BatchTotal) => string[]) => [...new Set(perBatch.flatMap(pick))];
  const notWorkedOut = union((t) => t.notWorkedOut);
  const hundredPercent = union((t) => t.hundredPercent);
  const notes: string[] = [];
  if (hundredPercent.length) notes.push(`${hundredPercent.join(", ")}: 100% of the lot is inspected. The lot is not counted in the totals.`);
  if (notWorkedOut.length) notes.push(`${notWorkedOut.join(", ")}: not worked out yet, so the totals are a lower bound. See the open items.`);
  const sum = (pick: (t: BatchTotal) => number) => perBatch.reduce((s, t) => s + pick(t), 0);
  const units = sum((t) => t.units);
  const stabilityUnits = sum((t) => t.stabilityUnits);
  const retainUnits = sum((t) => t.retainUnits);
  return { perBatch, units, stabilityUnits, retainUnits, allUnits: units + stabilityUnits + retainUnits, notWorkedOut, hundredPercent, notes };
}
