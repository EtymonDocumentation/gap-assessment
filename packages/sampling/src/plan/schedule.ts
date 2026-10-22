import type { SamplingPlan } from "@gap/process-model";
import { categoryText, timingText } from "./labels.js";
import { unitsPerBatch } from "./totals.js";

/** One line of the pull schedule: what is taken from which batch. */
export interface PullRow {
  batchId: string;
  batchLabel: string;
  pointId: string;
  unitOp: string;
  category: string;
  attribute: string;
  timing: string;
  locationsCount?: number;
  sampleSize?: number;
  hundredPercent: boolean;
  /** Units for this batch ("3 x 5 = 15" style text is in `unitsText`). */
  units?: number;
  unitsText: string;
  quantity?: string;
  containerUnitsPerSample?: number;
  testMethodRef?: string;
  materialType?: string;
  storageCondition?: string;
  destinationLab?: string;
}

/**
 * The pull schedule: one row per batch and point the point applies to, in batch then point order. The plan page and the
 * document use it now; a later CSV download and sample labels read the same rows, so nothing is worked out twice.
 */
export function buildPullSchedule(plan: SamplingPlan): PullRow[] {
  const rows: PullRow[] = [];
  const perPoint = new Map(plan.points.map((p) => [p.id, unitsPerBatch(plan, p)]));
  for (const b of plan.batches) {
    for (const p of plan.points) {
      const u = perPoint.get(p.id)!.find((x) => x.batchId === b.id);
      if (!u?.applies) continue;
      rows.push({
        batchId: b.id,
        batchLabel: b.label,
        pointId: p.id,
        unitOp: p.unitOp,
        category: categoryText(p),
        attribute: p.attribute,
        timing: timingText(p),
        ...(p.locationsCount !== undefined ? { locationsCount: p.locationsCount } : {}),
        ...(u.sampleSize !== undefined ? { sampleSize: u.sampleSize } : {}),
        hundredPercent: u.hundredPercent,
        ...(u.units !== undefined ? { units: u.units } : {}),
        unitsText: u.text,
        ...(p.quantity ? { quantity: `${p.quantity.value} ${p.quantity.unit}` } : {}),
        ...(p.containerUnitsPerSample !== undefined ? { containerUnitsPerSample: p.containerUnitsPerSample } : {}),
        ...(p.testMethodRef ? { testMethodRef: p.testMethodRef } : {}),
        ...(p.materialType ? { materialType: p.materialType } : {}),
        ...(p.storageCondition ? { storageCondition: p.storageCondition } : {}),
        ...(p.destinationLab ? { destinationLab: p.destinationLab } : {}),
      });
    }
  }
  return rows;
}
