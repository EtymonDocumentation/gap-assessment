import type { SamplingPoint } from "@gap/process-model";

/**
 * Quantities that are worked out from what the person typed, not from a sampling method: stability pulls and units, and retain
 * units. Both show their working so a reader can check the arithmetic. Nothing is assumed: a missing condition, time point or unit
 * count leaves the result absent and says what to enter.
 */

export interface WorkingLine {
  label: string;
  value: string;
}

export interface StabilityDerivation {
  conditionCount: number;
  timePointCount: number;
  /** conditions x time points. Absent until both lists are entered. */
  pulls?: number;
  unitsPerPull?: number;
  /** pulls x units per pull, per batch. Absent until all three are entered. */
  units?: number;
  working: WorkingLine[];
  problems: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function stabilityDerivation(point: Pick<SamplingPoint, "detail">): StabilityDerivation {
  const s = point.detail?.stability;
  const conditions = s?.conditions ?? [];
  const timePoints = s?.timePoints ?? [];
  const working: WorkingLine[] = [];
  const problems: string[] = [];
  if (!conditions.length) problems.push("Add at least one storage condition.");
  else working.push({ label: "Storage conditions", value: `${plural(conditions.length, "condition", "conditions")}: ${conditions.map((c) => c.label).join("; ")}` });
  if (!timePoints.length) problems.push("Add at least one time point.");
  else working.push({ label: "Time points", value: `${plural(timePoints.length, "time point", "time points")}: ${timePoints.map((t) => t.label).join("; ")}` });
  if (s?.unitsPerPull === undefined) problems.push("Give the number of units per pull.");
  else working.push({ label: "Units per pull", value: String(s.unitsPerPull) });
  const pulls = conditions.length && timePoints.length ? conditions.length * timePoints.length : undefined;
  if (pulls !== undefined) working.push({ label: "Pulls per batch", value: `${conditions.length} x ${timePoints.length} = ${pulls}` });
  const units = pulls !== undefined && s?.unitsPerPull !== undefined ? pulls * s.unitsPerPull : undefined;
  if (units !== undefined) working.push({ label: "Units per batch", value: `${pulls} x ${s!.unitsPerPull} = ${units}` });
  return {
    conditionCount: conditions.length,
    timePointCount: timePoints.length,
    ...(pulls !== undefined ? { pulls } : {}),
    ...(s?.unitsPerPull !== undefined ? { unitsPerPull: s.unitsPerPull } : {}),
    ...(units !== undefined ? { units } : {}),
    working,
    problems,
  };
}

export interface RetainDerivation {
  units?: number;
  working: WorkingLine[];
  problems: string[];
}

/** Retain / reserve units per batch are the number the person typed; the tool carries no regulation text and works nothing out. */
export function retainDerivation(point: Pick<SamplingPoint, "detail">): RetainDerivation {
  const r = point.detail?.retain;
  if (r?.unitsPerBatch === undefined) return { working: [], problems: ["Give the number of units kept per batch."] };
  return { units: r.unitsPerBatch, working: [{ label: "Units kept per batch", value: String(r.unitsPerBatch) }], problems: [] };
}

/** Stability and retain points take their quantity from the derivations above, not from a sample-size method. */
export const usesSampleSizeMethod = (point: Pick<SamplingPoint, "type">): boolean => point.type !== "stability" && point.type !== "retain_reserve";
