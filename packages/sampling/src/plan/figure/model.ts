import type { PlanHold, PlanStep, PlanSubProcess, SamplingPlan, SamplingPoint, TimeEdge } from "@gap/process-model";
import { SLOT_PHRASE } from "../flow.js";
import { timingText, typeText } from "../labels.js";
import { hoursText } from "./draw.js";

/**
 * The data behind one figure, worked out once and read by both styles (time scale and step cards). Everything here comes from the
 * plan's own fields. Nothing is invented: a missing duration stays missing (the drawing says so), a sample with no hour is not
 * pinned, and the tool never says whether a target is adequate.
 */

/** Study types that are routine testing. Everything else (and a point with no type yet) is shown in full, so nothing is hidden by a guess. */
export const ROUTINE_TYPES: readonly string[] = ["ipc", "release"];
export const isRoutinePoint = (p: Pick<SamplingPoint, "type">): boolean => p.type !== undefined && ROUTINE_TYPES.includes(p.type);

export interface SampleView {
  id: string;
  /** The number inside a pin: the SP number without leading zeros. */
  num: string;
  routine: boolean;
  stepId: string;
  holdId?: string;
  /** Hours since time zero; absent = "hour not given". */
  hour?: number;
  /** "SP-001" plus the study type. */
  head: string;
  /** What is tested (the point's own words), or the study type when that is blank. */
  test: string;
  quantity?: string;
  when: string;
  holdStep: boolean;
}

export interface StepTime {
  start: number;
  end: number;
  /** false = no planned duration (a fixed narrow block is drawn and the step is listed under "Hours not given"). */
  given: boolean;
}
export interface HoldTime {
  hold: PlanHold;
  start: number;
  end: number;
  given: boolean;
}

export interface TargetView {
  id: string;
  label: string;
  comparator: ">=" | "<=";
  hours: number;
  /** Hours since time zero of the two ends the target spans. */
  fromHour: number;
  toHour: number;
  /** "end of Static thaw", "start of Filling". */
  fromText: string;
  toText: string;
  fromStepId: string;
  fromEdge: TimeEdge;
  toStepId: string;
  toEdge: TimeEdge;
  note?: string;
}

export interface Scope {
  /** "main", or the sub-process id. */
  id: string;
  label: string;
  isSub: boolean;
  steps: PlanStep[];
  steps_time: Map<string, StepTime>;
  holds: HoldTime[];
  targets: TargetView[];
  samples: SampleView[];
  /** The caption words for time zero ("Hours since the end of Static thaw"). */
  zeroText: string;
  /** Sub-process only: the main-process step it feeds. */
  feeds?: PlanStep;
  subProcess?: PlanSubProcess;
  /** Plain-language lists for the notes under the figure. */
  hoursNotGiven: string[];
  notDrawn: string[];
  noHourSamples: string[];
}

export const cmpText = (c: ">=" | "<="): string => (c === ">=" ? "≥" : "≤");
export const targetText = (t: Pick<TargetView, "label" | "comparator" | "hours">): string => `${t.label} ${cmpText(t.comparator)}\u00a0${hoursText(t.hours)}`;

/** The number of an SP id without leading zeros ("SP-007" -> "7"). */
export const spNumber = (id: string): string => String(Number(id.replace(/^SP-/, "")) || id);

function sampleView(plan: SamplingPlan, p: SamplingPoint): SampleView {
  const hold = p.flow?.holdId ? (plan.holds ?? []).find((h) => h.id === p.flow!.holdId) : undefined;
  const test = p.attribute.trim() || typeText(p);
  const qParts: string[] = [];
  if (p.quantity) qParts.push(`${p.quantity.value} ${p.quantity.unit}`);
  if (p.locationsCount) qParts.push(`${p.locationsCount} ${p.locationsCount === 1 ? "location" : "locations"}`);
  const hour = p.takenAtHour;
  const where = hold ? `during ${hold.label}` : p.flow?.at ? SLOT_PHRASE[p.flow.at] : "";
  const timing = timingText(p);
  const when = [hour !== undefined ? `hour ${Math.round(hour * 100) / 100}` : "hour not given", where, timing].filter(Boolean).join("; ");
  return {
    id: p.id,
    num: spNumber(p.id),
    routine: isRoutinePoint(p),
    stepId: p.flow!.stepId,
    ...(p.flow!.holdId ? { holdId: p.flow!.holdId } : {}),
    ...(hour !== undefined ? { hour } : {}),
    head: `${p.id} ${typeText(p)}`,
    test,
    ...(qParts.length ? { quantity: qParts.join(", ") } : {}),
    when,
    holdStep: !!hold,
  };
}

/**
 * Splits a plan into the figures it needs: one per sub-process (drawn first), then the main process. A plan with no steps has none.
 * A step that names a sub-process leaves the main figure; the sub-process figure shows it and says which step it feeds.
 */
export function buildScopes(plan: SamplingPlan): Scope[] {
  if (!plan.steps.length) return [];
  const subs = plan.subProcesses ?? [];
  const out: Scope[] = [];
  for (const sub of subs) {
    const steps = plan.steps.filter((s) => s.subProcess === sub.id);
    if (steps.length) out.push(scopeOf(plan, sub.id, sub.label, true, steps, sub));
  }
  const main = plan.steps.filter((s) => !s.subProcess || !subs.some((b) => b.id === s.subProcess));
  if (main.length) out.push(scopeOf(plan, "main", "Main process", false, main));
  return out;
}

function scopeOf(plan: SamplingPlan, id: string, label: string, isSub: boolean, steps: PlanStep[], sub?: PlanSubProcess): Scope {
  const stepIds = new Set(steps.map((s) => s.id));
  // Walk the steps in process order. A hold after a step comes before the next step; a missing duration adds no time.
  const raw = new Map<string, StepTime>();
  const holdRaw: HoldTime[] = [];
  let t = 0;
  for (const s of steps) {
    const given = s.durationHours !== undefined;
    raw.set(s.id, { start: t, end: t + (s.durationHours ?? 0), given });
    t += s.durationHours ?? 0;
    for (const h of (plan.holds ?? []).filter((x) => x.afterStepId === s.id)) {
      const hg = h.durationHours !== undefined;
      holdRaw.push({ hold: h, start: t, end: t + (h.durationHours ?? 0), given: hg });
      t += h.durationHours ?? 0;
    }
  }
  // Time zero: the person's choice if it is a step of this figure, otherwise the end of the first main step (the start of a sub-process).
  const first = steps[0]!;
  let zero = isSub ? raw.get(first.id)!.start : raw.get(first.id)!.end;
  let zeroText = isSub ? `Hours since the start of ${first.label}` : `Hours since the end of ${first.label}`;
  if (!isSub && plan.timeZero && stepIds.has(plan.timeZero.stepId)) {
    const z = plan.timeZero;
    const zs = steps.find((s) => s.id === z.stepId)!;
    zero = z.edge === "start" ? raw.get(z.stepId)!.start : raw.get(z.stepId)!.end;
    zeroText = `Hours since the ${z.edge} of ${zs.label}`;
  }
  const stepsTime = new Map<string, StepTime>();
  for (const [k, v] of raw) stepsTime.set(k, { ...v, start: v.start - zero, end: v.end - zero });
  const holds = holdRaw.map((h) => ({ ...h, start: h.start - zero, end: h.end - zero }));

  const edgeHour = (stepId: string, edge: TimeEdge) => (edge === "start" ? stepsTime.get(stepId)!.start : stepsTime.get(stepId)!.end);
  const stepLabel = (stepId: string) => steps.find((s) => s.id === stepId)!.label;
  const targets: TargetView[] = [];
  const notDrawn: string[] = [];
  for (const tt of plan.timeTargets ?? []) {
    const inFrom = stepIds.has(tt.fromStepId);
    const inTo = stepIds.has(tt.toStepId);
    if (inFrom && inTo) {
      targets.push({
        id: tt.id,
        label: tt.label,
        comparator: tt.comparator,
        hours: tt.hours,
        fromHour: edgeHour(tt.fromStepId, tt.fromEdge),
        toHour: edgeHour(tt.toStepId, tt.toEdge),
        fromStepId: tt.fromStepId,
        fromEdge: tt.fromEdge,
        toStepId: tt.toStepId,
        toEdge: tt.toEdge,
        fromText: `${tt.fromEdge} of ${stepLabel(tt.fromStepId)}`,
        toText: `${tt.toEdge} of ${stepLabel(tt.toStepId)}`,
        ...(tt.note?.trim() ? { note: tt.note.trim() } : {}),
      });
    } else if (inFrom !== inTo && !isSub) {
      // Spans a sub-process and the main process: it cannot be placed on one scale, so it is listed, not drawn.
      notDrawn.push(`${tt.label} ${cmpText(tt.comparator)} ${hoursText(tt.hours)} (it spans a sub-process and the main process)`);
    }
  }
  if (isSub && sub?.processingTarget) {
    const last = steps[steps.length - 1]!;
    targets.push({
      id: `${sub.id}-target`,
      label: "Processing time",
      comparator: sub.processingTarget.comparator,
      hours: sub.processingTarget.hours,
      fromHour: stepsTime.get(first.id)!.start,
      toHour: stepsTime.get(last.id)!.end,
      fromStepId: first.id,
      fromEdge: "start",
      toStepId: last.id,
      toEdge: "end",
      fromText: `start of ${first.label}`,
      toText: `end of ${last.label}`,
    });
  }

  const pts = plan.points.filter((p) => p.flow && stepIds.has(p.flow.stepId));
  const samples = pts.map((p) => sampleView(plan, p));
  const hoursNotGiven: string[] = [];
  for (const s of steps) if (!stepsTime.get(s.id)!.given) hoursNotGiven.push(s.label);
  for (const h of holds) if (!h.given) hoursNotGiven.push(h.hold.label);
  return {
    id,
    label,
    isSub,
    steps,
    steps_time: stepsTime,
    holds,
    targets,
    samples,
    zeroText,
    ...(isSub ? { subProcess: sub, ...(sub?.feedsStepId ? { feeds: plan.steps.find((s) => s.id === sub.feedsStepId) } : {}) } : {}),
    hoursNotGiven,
    notDrawn,
    noHourSamples: samples.filter((s) => s.hour === undefined).map((s) => s.id),
  };
}

/** Points that sit on no step of any figure of the plan (not on the diagram). They are listed in the sample table only. */
export function samplesNotOnFigure(plan: SamplingPlan): string[] {
  const ids = new Set(plan.steps.map((s) => s.id));
  return plan.points.filter((p) => !p.flow || !ids.has(p.flow.stepId)).map((p) => p.id);
}

/** Routine samples of a step as one short line: "Routine: bioburden, endotoxin (SP-003)". */
export function routineLine(samples: SampleView[]): { lead: string; rest: string } | undefined {
  const r = samples.filter((s) => s.routine);
  if (!r.length) return undefined;
  const tests: string[] = [];
  for (const s of r) if (!tests.includes(s.test)) tests.push(s.test);
  return { lead: "Routine: ", rest: `${tests.join(", ")} (${r.map((s) => s.id).join(", ")})` };
}
