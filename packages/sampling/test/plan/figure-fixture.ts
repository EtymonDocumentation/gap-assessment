import { samplingPlanSchema, type PlanStep, type SamplingPlan, type SamplingPoint } from "@gap/process-model";

/**
 * A fictional plan used by the figure tests and by the sample generators: ten steps, three holds, time targets, a buffer
 * sub-process and as many samples as the caller asks for. Nothing here is a real product, company or document.
 */
const at = "2026-10-01T00:00:00.000Z";

export function fpoint(n: number, over: Partial<SamplingPoint> = {}): SamplingPoint {
  return {
    id: `SP-${String(n).padStart(3, "0")}`,
    origin: { kind: "manual" },
    type: "ppq_enhanced",
    unitOp: "custom_step",
    attribute: `Attribute ${n} (fictional)`,
    timing: { options: ["middle"] },
    locationsCount: 2,
    quantity: { value: 10, unit: "mL" },
    sampleSize: { inputs: {} },
    rationale: "Fictional rationale.",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

export const STEP_NAMES = ["Thaw", "Pooling", "Dilution and mixing", "Bioburden reduction filtration", "Sterile filtration", "Filling", "Cold storage", "Visual inspection", "Bulk packaging", "Final labelling and packaging"];
const HOURS = [30, 2, 1, 2, 3, 48, 40, 10, 40, 90];

export interface FixtureOptions {
  /** How many samples to add (spread over the steps, hours increasing). */
  samples?: number;
  /** Leave the hours out of every step and hold. */
  noHours?: boolean;
  /** Add the buffer sub-process. */
  buffer?: boolean;
  steps?: number;
}

export function fixturePlan(o: FixtureOptions = {}): SamplingPlan {
  const nSteps = o.steps ?? 10;
  const steps: PlanStep[] = STEP_NAMES.slice(0, nSteps).map((label, i) => ({
    id: `ST-${String(i + 1).padStart(2, "0")}`,
    label,
    ...(o.noHours ? {} : { durationHours: HOURS[i]! }),
    ...(i % 3 === 0 ? { figureText: [`Setting A${i} (fictional)`, `Setting B${i}`] } : {}),
  }));
  const points: SamplingPoint[] = [];
  const count = o.samples ?? 12;
  let hour = 0;
  for (let k = 1; k <= count; k++) {
    const step = steps[(k - 1) % Math.max(1, Math.min(steps.length, 8))]!;
    hour += (k % 4) * 5;
    points.push(
      fpoint(k, {
        type: k % 5 === 0 ? "ipc" : k % 7 === 0 ? "release" : k % 3 === 0 ? "hold_time" : "ppq_enhanced",
        flow: { stepId: step.id, at: k % 2 ? "after" : "during", ...(k === 2 && nSteps > 2 ? {} : {}) },
        ...(o.noHours ? {} : { takenAtHour: hour }),
      }),
    );
  }
  const plan: SamplingPlan = {
    id: "SPL-001",
    title: "Line 1 PPQ plan (fictional)",
    runType: "ppq",
    status: "draft",
    steps,
    batches: [{ id: "B-001", label: "PPQ batch 1" }],
    batchRationale: "Fictional.",
    parties: [],
    agencyRequests: [],
    noAgencyRequests: true,
    points,
    subsections: [],
    createdAt: at,
    updatedAt: at,
  };
  if (nSteps >= 5) {
    const hrs = (h: number) => (o.noHours ? {} : { durationHours: h });
    plan.holds = [
      { id: "HD-01", afterStepId: "ST-01", label: "Post-thaw hold", durationText: "36-48 h", condition: "CRT", ...hrs(48) },
      { id: "HD-02", afterStepId: "ST-03", label: "Mixed bulk hold", durationText: "22-24 h", condition: "CRT", ...hrs(24) },
      { id: "HD-03", afterStepId: "ST-04", label: "Post-filtration hold", durationText: "at least 68 h", condition: "CRT", ...hrs(68) },
    ];
    plan.timeTargets = [
      { id: "TT-01", label: "Bulk target", fromStepId: "ST-01", fromEdge: "end", toStepId: nSteps >= 7 ? "ST-07" : "ST-05", toEdge: "end", comparator: ">=", hours: 200 },
      { id: "TT-02", label: "Interim target", fromStepId: "ST-04", fromEdge: "end", toStepId: "ST-05", toEdge: "start", comparator: ">=", hours: 140, note: "Filtration to filling." },
    ];
    if (plan.points[1]) plan.points[1] = { ...plan.points[1], flow: { stepId: "ST-01", holdId: "HD-01" } } as SamplingPoint;
  }
  if (o.buffer) {
    plan.steps.unshift(
      { id: "ST-11", label: "Buffer preparation", durationHours: 4, subProcess: "SB-01" },
      { id: "ST-12", label: "Buffer filtration", durationHours: 3, subProcess: "SB-01" },
    );
    plan.subProcesses = [{ id: "SB-01", label: "Buffer", feedsStepId: "ST-03", processingTarget: { comparator: "<=", hours: 12 } }];
    plan.points.push(fpoint(90, { type: "ipc", attribute: "Buffer pH (fictional)", flow: { stepId: "ST-11", at: "after" }, takenAtHour: 3 }), fpoint(91, { attribute: "Buffer conductivity (fictional)", flow: { stepId: "ST-12", at: "after" }, takenAtHour: 6 }));
  }
  const r = samplingPlanSchema.safeParse(plan);
  if (!r.success) throw new Error(`fixture invalid: ${r.error.issues[0]?.message}`);
  return plan;
}
