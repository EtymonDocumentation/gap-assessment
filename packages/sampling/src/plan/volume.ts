import type { SamplingPlan, SamplingPoint } from "@gap/process-model";
import { appliedBatches } from "./calc.js";
import { sampleMethodView } from "./method.js";
import { unitsKindOf, unitsPerBatch } from "./totals.js";

/**
 * The volume arithmetic shared by the sampling plan's design review (check C1) and the batch record's Process view (its volume tracker).
 * Both read a quantity like "2 x 10 mL", turn it into mL the same way and count a flush the same way, so a plan and a record that say the
 * same thing never show two different numbers. Only liquid in mL or L is counted: samples in grams are not turned into a volume (no
 * density is stated) and samples counted in syringes or units are counted apart.
 */

export interface Quantity {
  count: number;
  each: number;
  unit: string;
  kind: "volume" | "units" | "mass";
}

/** "2 x 10 mL", "20 mL", "300 syringes", "2 x 4 syringes". Anything else is not read (the sample then has no stated quantity). */
export function parseQuantity(q: string | undefined): Quantity | undefined {
  const m = /^\s*(?:(\d+(?:[.,]\d+)?)\s*[×x]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|mg|syringes?|units?|vials?)\b/i.exec(q ?? "");
  if (!m) return undefined;
  const unit = m[3]!.toLowerCase();
  const kind = unit === "ml" || unit === "l" ? "volume" : unit === "g" || unit === "kg" || unit === "mg" ? "mass" : "units";
  return { count: m[1] ? Number(m[1].replace(",", ".")) : 1, each: Number(m[2]!.replace(",", ".")), unit, kind };
}

/** Litres from a number and a unit; undefined unless the unit is L or mL. */
export const toLitres = (n: number, unit: string | undefined): number | undefined => {
  const u = (unit ?? "").trim().toLowerCase();
  return u === "l" ? n : u === "ml" ? n / 1000 : undefined;
};

/** Millilitres drawn by `count` containers of `each` (in `unit`, "l" or "ml"). */
export const volumeMlOf = (count: number, each: number, unit: string): number => count * each * (unit.trim().toLowerCase() === "l" ? 1000 : 1);

/** A written volume ("1.5 L", "30 mL") for a number of mL. */
export const mlText = (ml: number): string => {
  const r = (n: number) => String(Math.round(n * 100) / 100);
  return ml >= 1000 ? `${r(ml / 1000)} L` : `${r(ml)} mL`;
};

/** What one batch of the plan loses to sampling. */
export interface BatchVolume {
  batchId: string;
  label: string;
  /** The batch size in mL, only when the plan states it in L or mL. */
  batchSizeMl?: number;
  /** The batch size as the plan wrote it ("50 L", "120 kg"), for words. Absent when none is stated. */
  batchSizeText?: string;
  /** Sample volume drawn from this batch (quantity x containers x locations). */
  sampleMl: number;
  /** Flushed or discarded to waste before the draws: only a flush volume stated in mL or L. Its own number, never part of a sample. */
  flushMl: number;
  /** sampleMl + flushMl as a share of the batch size, when both are in volume units. */
  percent?: number;
  /** Sample ids that add to the total. */
  pointIds: string[];
  /** What could not be counted, in words ("the quantity of SP-004"). The totals are then a lower bound. */
  missing: string[];
}

/**
 * Per batch, the volume the plan takes: for every point that applies to it, the stated quantity x the containers per sample x the
 * locations per batch, plus the stated flush volume x the locations (one flush before every draw). Smallest batch first, because the PPQ
 * sizes are bracketed and the smallest one has the least to spare; a batch with no size stated follows in plan order.
 * Nothing is guessed: a missing quantity, missing locations, a count or mass quantity and an unreadable flush volume are named in `missing`.
 */
export function volumeTakenPerBatch(plan: SamplingPlan): BatchVolume[] {
  const rows = plan.batches.map((b): BatchVolume => {
    const ml = b.batchSize !== undefined ? toLitres(b.batchSize, b.batchSizeUnit) : undefined;
    return {
      batchId: b.id,
      label: b.label,
      ...(ml !== undefined ? { batchSizeMl: ml * 1000 } : {}),
      ...(b.batchSize !== undefined ? { batchSizeText: `${b.batchSize}${b.batchSizeUnit ? ` ${b.batchSizeUnit}` : ""}` } : {}),
      sampleMl: 0,
      flushMl: 0,
      pointIds: [],
      missing: [],
    };
  });
  const byId = new Map(rows.map((r) => [r.batchId, r]));
  for (const p of plan.points) {
    for (const b of appliedBatches(plan, p)) {
      const row = byId.get(b.id)!;
      const draws = drawsOf(plan, p, b.id);
      const flushMl = sampleMethodView(p)?.flush?.volumeMl;
      if (!p.quantity) {
        row.missing.push(`the quantity of ${p.id}`);
        continue;
      }
      const unit = p.quantity.unit.trim().toLowerCase();
      if (unit !== "ml" && unit !== "l") continue; // a count or a mass: not a volume, counted apart
      if (draws === undefined) {
        row.missing.push(`how many locations ${p.id} is taken at`);
        continue;
      }
      row.sampleMl += volumeMlOf(draws * (p.containerUnitsPerSample ?? 1), p.quantity.value, unit);
      if (flushMl !== undefined) row.flushMl += flushMl * draws;
      row.pointIds.push(p.id);
    }
  }
  for (const r of rows) {
    if (r.batchSizeMl !== undefined) r.percent = ((r.sampleMl + r.flushMl) / r.batchSizeMl) * 100;
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.batchSizeMl ?? Infinity) - (b.r.batchSizeMl ?? Infinity) || a.i - b.i)
    .map((x) => x.r);
}

/** Draws of a point from one batch: locations (process samples), or the derived units of a stability or retain point. Undefined when not stated. */
function drawsOf(plan: SamplingPlan, p: SamplingPoint, batchId: string): number | undefined {
  if (unitsKindOf(p) === "process") return p.locationsCount;
  return unitsPerBatch(plan, p).find((u) => u.batchId === batchId)?.units;
}
