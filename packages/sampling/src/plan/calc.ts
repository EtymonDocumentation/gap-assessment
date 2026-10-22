import type { BatchResult, SamplingBatch, SamplingPlan, SamplingPoint } from "@gap/process-model";
import {
  aqlPlan,
  companyTablePlan,
  confRelPlan,
  fixedCountPlan,
  SAMPLING_STATS_VERSION,
  variablesPlan,
  type SampleSizeResult,
} from "../stats/index.js";

/**
 * Runs the method a point chose for one batch and returns what it worked out. Nothing is guessed: no method, or a missing input,
 * gives a result with problems and no sample size (the point is then incomplete and listed as an open item).
 *
 * The batch matters because three of the five methods read the lot size, and a plan's batches can have different planned lot
 * sizes. A lot size is the batch's `plannedLotSizeUnits`; it is never filled in.
 */
export function calculateForBatch(point: SamplingPoint, batch: SamplingBatch): BatchResult {
  const { method, inputs } = point.sampleSize;
  const lotSize = batch.plannedLotSizeUnits;
  if (!method) {
    return { batchId: batch.id, ...(lotSize !== undefined ? { lotSize } : {}), ok: false, problems: ["No sample-size method chosen."], working: [], citation: "" };
  }
  let r: SampleSizeResult;
  switch (method) {
    case "company-table":
      r = inputs.table
        ? companyTablePlan({ table: inputs.table, ...(lotSize !== undefined ? { lotSize } : {}), ...(inputs.testKey ? { testKey: inputs.testKey } : {}) })
        : failed(method, "No company sampling table chosen.");
      break;
    case "fixed":
      r = fixedCountPlan({ ...(inputs.count !== undefined ? { count: inputs.count } : {}), ...(inputs.basis !== undefined ? { basis: inputs.basis } : {}) });
      break;
    case "conf-rel":
      r = confRelPlan({
        ...(inputs.confidence !== undefined ? { confidence: inputs.confidence } : {}),
        ...(inputs.reliability !== undefined ? { reliability: inputs.reliability } : {}),
        ...(inputs.allowedFailures !== undefined ? { allowedFailures: inputs.allowedFailures } : {}),
        ...(lotSize !== undefined ? { lotSize } : {}),
      });
      break;
    case "aql-105e":
      r = aqlPlan({
        ...(lotSize !== undefined ? { lotSize } : {}),
        ...(inputs.level !== undefined ? { level: inputs.level as never } : {}),
        ...(inputs.aql !== undefined ? { aql: inputs.aql } : {}),
        ...(inputs.inspection !== undefined ? { inspection: inputs.inspection } : {}),
      });
      break;
    case "var-414":
      r = variablesPlan({
        ...(lotSize !== undefined ? { lotSize } : {}),
        ...(inputs.level !== undefined ? { level: inputs.level as never } : {}),
        ...(inputs.aql !== undefined ? { aql: inputs.aql } : {}),
        ...(inputs.inspection !== undefined ? { inspection: inputs.inspection } : {}),
        ...(inputs.limits !== undefined ? { limits: inputs.limits } : {}),
      });
      break;
  }
  return {
    batchId: batch.id,
    ...(lotSize !== undefined ? { lotSize } : {}),
    ok: r.ok,
    problems: [...r.problems],
    ...(r.ok && r.sampleSize !== undefined ? { sampleSize: r.sampleSize } : {}),
    ...(r.hundredPercent ? { hundredPercent: true } : {}),
    ...(r.accept !== undefined ? { accept: r.accept } : {}),
    ...(r.reject !== undefined ? { reject: r.reject } : {}),
    ...(r.k !== undefined ? { k: r.k } : {}),
    ...(r.maxPercentNonconforming !== undefined ? { maxPercentNonconforming: r.maxPercentNonconforming } : {}),
    ...(r.codeLetter ? { codeLetter: r.codeLetter } : {}),
    working: r.working.map((w) => ({ label: w.label, value: w.value })),
    citation: r.citation,
  };
}

function failed(method: SampleSizeResult["method"], problem: string): SampleSizeResult {
  return { method, ok: false, problems: [problem], working: [], citation: "" };
}

/** The batches a point applies to, in plan order. A listed batch that no longer exists is skipped (the schema refuses such a plan). */
export function appliedBatches(plan: SamplingPlan, point: SamplingPoint): SamplingBatch[] {
  if (point.appliesTo === "all") return plan.batches;
  const wanted = new Set(point.appliesTo);
  return plan.batches.filter((b) => wanted.has(b.id));
}

/** Fresh calculation for every batch the point applies to. */
export function calculatePoint(plan: SamplingPlan, point: SamplingPoint): BatchResult[] {
  return appliedBatches(plan, point).map((b) => calculateForBatch(point, b));
}

/**
 * The record kept in the point when it is saved: the arithmetic and the version of the statistics that did it. Opening and
 * printing always recalculate; this record shows what the point said when it was last edited.
 */
export function snapshotResult(plan: SamplingPlan, point: SamplingPoint, at: string): NonNullable<SamplingPoint["sampleSize"]["result"]> {
  return { statsVersion: SAMPLING_STATS_VERSION, at, perBatch: calculatePoint(plan, point) };
}
