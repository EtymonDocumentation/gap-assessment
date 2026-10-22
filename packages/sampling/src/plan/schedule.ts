import type { SamplingPlan } from "@gap/process-model";
import { stabilityDerivation } from "./derive.js";
import { timingText, typeText } from "./labels.js";
import { unitsPerBatch, type UnitsKind } from "./totals.js";

/** One line of the pull schedule: what is taken from which batch. */
export interface PullRow {
  batchId: string;
  batchLabel: string;
  pointId: string;
  unitOp: string;
  /** The study type in words. */
  studyType: string;
  /** "process" for ordinary samples, "stability" for one condition at one time point, "retain" for the kept units. */
  kind: UnitsKind;
  attribute: string;
  timing: string;
  /** Stability rows: the storage condition and the time point of this pull. */
  condition?: string;
  timePoint?: string;
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
 * The pull schedule: one row per batch and point the point applies to, in batch then point order. A stability point gives one
 * row per storage condition and time point (the pulls), a retain point one row per batch. The plan page and the document use it
 * now; a later CSV download and sample labels read the same rows, so nothing is worked out twice.
 */
export function buildPullSchedule(plan: SamplingPlan): PullRow[] {
  const rows: PullRow[] = [];
  const perPoint = new Map(plan.points.map((p) => [p.id, unitsPerBatch(plan, p)]));
  for (const b of plan.batches) {
    for (const p of plan.points) {
      const u = perPoint.get(p.id)!.find((x) => x.batchId === b.id);
      if (!u?.applies) continue;
      const common = {
        batchId: b.id,
        batchLabel: b.label,
        pointId: p.id,
        unitOp: p.unitOp,
        studyType: typeText(p),
        kind: u.kind,
        attribute: p.attribute,
        ...(p.quantity ? { quantity: `${p.quantity.value} ${p.quantity.unit}` } : {}),
        ...(p.containerUnitsPerSample !== undefined ? { containerUnitsPerSample: p.containerUnitsPerSample } : {}),
        ...(p.testMethodRef ? { testMethodRef: p.testMethodRef } : {}),
        ...(p.materialType ? { materialType: p.materialType } : {}),
        ...(p.storageCondition ? { storageCondition: p.storageCondition } : {}),
        ...(p.destinationLab ? { destinationLab: p.destinationLab } : {}),
      };
      if (u.kind === "stability") {
        const s = p.detail?.stability;
        const d = stabilityDerivation(p);
        const conditions = s?.conditions ?? [];
        const timePoints = s?.timePoints ?? [];
        if (!conditions.length || !timePoints.length) {
          rows.push({ ...common, timing: "Stability pulls", hundredPercent: false, unitsText: "Not worked out" });
          continue;
        }
        for (const c of conditions) {
          for (const t of timePoints) {
            rows.push({
              ...common,
              timing: `Stability: ${c.label}, ${t.label}`,
              condition: c.label,
              timePoint: t.label,
              hundredPercent: false,
              ...(d.unitsPerPull !== undefined ? { units: d.unitsPerPull, unitsText: String(d.unitsPerPull) } : { unitsText: "Not worked out" }),
            });
          }
        }
        continue;
      }
      if (u.kind === "retain") {
        rows.push({ ...common, timing: p.detail?.retain?.purpose === "reserve" ? "Reserve" : p.detail?.retain?.purpose === "both" ? "Retain and reserve" : "Retain", hundredPercent: false, ...(u.units !== undefined ? { units: u.units } : {}), unitsText: u.text });
        continue;
      }
      rows.push({
        ...common,
        timing: timingText(p),
        ...(p.locationsCount !== undefined ? { locationsCount: p.locationsCount } : {}),
        ...(u.sampleSize !== undefined ? { sampleSize: u.sampleSize } : {}),
        hundredPercent: u.hundredPercent,
        ...(u.units !== undefined ? { units: u.units } : {}),
        unitsText: u.text,
      });
    }
  }
  return rows;
}
