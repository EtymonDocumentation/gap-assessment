import {
  samplingPlanSchema,
  PPQ_READINESS_ITEMS,
  type Actor,
  type AgencyRequest,
  type ChangeEvent,
  type CustomSubsection,
  type DesignLoadout,
  type PlanDesign,
  type PlanHold,
  type PlanParty,
  type PlanStep,
  type PlanSubProcess,
  type PlanTimeTarget,
  type PlanTimeZero,
  type PointFlow,
  type ReadinessEntry,
  type Project,
  type SamplingBatch,
  type SamplingPlan,
  type SamplingPoint,
  type SamplingType,
  type SubsectionBlock,
  type SubsectionOrigin,
} from "@gap/process-model";
import { applyLoadout, cleanText, isPlacement, snapshotResult, unitOpForStep, type LoadoutMode } from "@gap/sampling";
import type { ContentBundle } from "./content";
import { stepGroups } from "./scope";
import type { PointSuggestion } from "./sampling-seed";

/**
 * Edits of the PPQ sampling plans in a project. Every edit returns a new project and adds one change-log event with the old
 * value kept (GMP: a reviewer must be able to see what a sampling decision was before it was changed, and by whom).
 *
 * Nothing here decides a value. A new point has only what the person (or the accepted suggestion) supplied; everything else
 * stays empty and the point is incomplete, shown as an open item. The saved sample-size record is a note of the arithmetic at
 * the time of saving; pages and documents always recalculate.
 */

export class SamplingError extends Error {}

/** What a person types for a new point. Only the unit operation is needed to start (the study type is chosen next); the rest can follow. */
export interface PointDraft {
  unitOp: string;
  type?: SamplingType;
  attribute?: string;
  typeLabel?: string;
  materialType?: string;
  origin?: SamplingPoint["origin"];
  /** Place the new point on a step of the plan (the unit operation then follows the step). Without it the point is "Not on the diagram". */
  flow?: PointFlow;
}

/** Fields of a point a person can change (the id, the origin and the time stamps cannot). */
export type PointPatch = Partial<Omit<SamplingPoint, "id" | "origin" | "createdAt" | "updatedAt">>;
export type PlanPatch = Partial<Pick<SamplingPlan, "title" | "notes" | "batchRationale" | "noAgencyRequests">>;
export type AgencyRequestInput = Omit<AgencyRequest, "id" | "createdAt" | "updatedAt">;
export type AgencyRequestPatch = Partial<AgencyRequestInput>;
export interface SubsectionInput {
  title: string;
  blocks: SubsectionBlock[];
  placement: string;
  includeInCmo?: boolean;
  origin?: SubsectionOrigin;
}
export type SubsectionPatch = Partial<Pick<SubsectionInput, "title" | "blocks" | "placement" | "includeInCmo">>;
export type BatchPatch = Partial<Omit<SamplingBatch, "id">>;

const pad = (n: number) => String(n).padStart(3, "0");

/** Next id of a kind inside a plan. Ids are never reused: an id that only survives in the change log still counts as taken. */
function nextId(project: Project, prefix: "SPL" | "B" | "SP" | "AR" | "CS" | "ST" | "HD" | "TT" | "SB", planId: string | undefined, existing: readonly string[]): string {
  let max = 0;
  const take = (id: string) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  existing.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] !== "sampling") continue;
    if (prefix === "SPL") take(parts[1] ?? "");
    else if (parts[1] === planId) take(parts[2] ?? "");
  }
  return `${prefix}-${pad(max + 1)}`;
}

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function planOf(project: Project, planId: string): SamplingPlan {
  const plan = project.sampling.plans.find((p) => p.id === planId);
  if (!plan) throw new SamplingError(`Sampling plan ${planId} does not exist`);
  return plan;
}

/** The plan must still satisfy its schema (report-only rule, unique ids, points on real batches). The first problem is shown. */
function assertValid(plan: SamplingPlan): void {
  const r = samplingPlanSchema.safeParse(plan);
  if (!r.success) throw new SamplingError(r.error.issues[0]?.message ?? "The plan is not valid");
}

/** Re-records the arithmetic note of every point that uses a method (lot sizes or the batch list changed). */
function refreshResults(plan: SamplingPlan, at: string): void {
  for (const p of plan.points) {
    if (p.sampleSize.method) p.sampleSize.result = snapshotResult(plan, p, at);
    else delete p.sampleSize.result;
  }
}

const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
};

// ------------------------------------------------------------------ plans

/** A step to put on a plan: a catalog unit operation (key and its label) or a custom step (label only). */
export interface StepDraft {
  unitOp?: string;
  label: string;
  notes?: string;
}

export function createPlan(project: Project, input: { title: string; notes?: string; steps?: StepDraft[] }, actor: Actor): { project: Project; planId: string } {
  const title = (input.title ?? "").trim();
  if (!title) throw new SamplingError("The plan needs a title");
  const next = structuredClone(project);
  const id = nextId(next, "SPL", undefined, next.sampling.plans.map((p) => p.id));
  const plan: SamplingPlan = clean({
    id,
    title,
    runType: "ppq",
    status: "draft",
    notes: input.notes?.trim() || undefined,
    steps: [],
    batches: [],
    batchRationale: "",
    parties: [],
    agencyRequests: [],
    points: [],
    subsections: [],
    createdAt: actor.at,
    updatedAt: actor.at,
  } as SamplingPlan);
  // The one-time copy of the project scope (or whatever the caller passes). After this the plan's steps are its own.
  for (const d of input.steps ?? []) plan.steps.push(newStep(next, plan, d));
  assertValid(plan);
  next.sampling.plans.push(plan);
  log(next, actor, { action: "sampling_plan_add", path: `sampling.${id}`, detail: `Sampling plan ${id}: ${title}${plan.steps.length ? ` (${plan.steps.length} process steps)` : ""}`, after: { id, title, ...(plan.steps.length ? { steps: plan.steps } : {}) } });
  return { project: next, planId: id };
}

export function updatePlan(project: Project, planId: string, patch: PlanPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if ("noAgencyRequests" in patch) {
    if (patch.noAgencyRequests && plan.agencyRequests.length) throw new SamplingError("Remove the agency requests before saying there are none.");
    const v = patch.noAgencyRequests ? true : undefined;
    if (plan.noAgencyRequests !== v) {
      before.noAgencyRequests = plan.noAgencyRequests ?? false;
      after.noAgencyRequests = v ?? false;
      if (v) plan.noAgencyRequests = true;
      else delete plan.noAgencyRequests;
    }
  }
  for (const k of ["title", "notes", "batchRationale"] as const) {
    if (!(k in patch)) continue;
    const v = typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k];
    if (k === "title" && !v) throw new SamplingError("The plan needs a title");
    if ((plan[k] ?? "") === (v ?? "")) continue;
    before[k] = plan[k] ?? "";
    after[k] = v ?? "";
    if (k === "notes" && !v) delete plan.notes;
    else (plan as unknown as Record<string, unknown>)[k] = v;
  }
  if (!Object.keys(after).length) return project;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_plan_update", path: `sampling.${planId}`, detail: `Sampling plan ${planId} edited`, before, after });
  return next;
}

/**
 * The PPQ design decisions of the approval memo (bracketing, rework, engineering batch, freeze rule, sampling after PPQ). Text is
 * trimmed and an emptied field is removed, so "not stated" stays visible in the document. No answer is ever filled in by the tool.
 */
export function updatePlanDesign(project: Project, planId: string, patch: PlanDesign, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const cur: PlanDesign = plan.design ?? {};
  const merged: PlanDesign = { ...cur };
  for (const k of ["bracketing", "rework", "freezeRule", "postPpq"] as const) {
    if (!(k in patch)) continue;
    const v = patch[k]?.trim();
    if (v) merged[k] = v;
    else delete merged[k];
  }
  if ("engineeringBatch" in patch) {
    const d = patch.engineeringBatch?.decision;
    const n = patch.engineeringBatch?.note?.trim();
    if (d || n) merged.engineeringBatch = { ...(d ? { decision: d } : {}), ...(n ? { note: n } : {}) };
    else delete merged.engineeringBatch;
  }
  if (JSON.stringify(merged) === JSON.stringify(cur)) return project;
  if (Object.keys(merged).length) plan.design = merged;
  else delete plan.design;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_plan_update", path: `sampling.${planId}.design`, detail: `PPQ design decisions of ${planId} edited`, before: { design: cur }, after: { design: merged } });
  return next;
}

/** One line of the readiness checklist before PPQ. No status = unknown; the tool never marks anything complete by itself. */
export function setReadiness(project: Project, planId: string, key: string, patch: Pick<ReadinessEntry, "status" | "note">, actor: Actor): Project {
  if (!PPQ_READINESS_ITEMS.some((i) => i.key === key)) throw new SamplingError(`Unknown readiness item ${key}`);
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const list = plan.readiness ?? [];
  const cur = list.find((e) => e.key === key);
  const note = patch.note?.trim();
  const entry: ReadinessEntry = { key, ...(patch.status ? { status: patch.status } : {}), ...(note ? { note } : {}) };
  const empty = !entry.status && !entry.note;
  if (JSON.stringify(cur ?? { key }) === JSON.stringify(empty ? { key } : entry)) return project;
  const rest = list.filter((e) => e.key !== key);
  const label = PPQ_READINESS_ITEMS.find((i) => i.key === key)!.label;
  plan.readiness = empty ? rest : [...rest, entry].sort((a, b) => PPQ_READINESS_ITEMS.findIndex((i) => i.key === a.key) - PPQ_READINESS_ITEMS.findIndex((i) => i.key === b.key));
  if (!plan.readiness.length) delete plan.readiness;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_plan_update", path: `sampling.${planId}.readiness.${key}`, detail: `Readiness item "${label}" of ${planId} edited`, before: { readiness: cur?.status ?? "" }, after: { readiness: entry.status ?? "" } });
  return next;
}

export function deletePlan(project: Project, planId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  next.sampling.plans = next.sampling.plans.filter((p) => p.id !== planId);
  // The whole plan is kept in the log, so removing it never loses what it said.
  log(next, actor, { action: "sampling_plan_remove", path: `sampling.${planId}`, detail: `Sampling plan ${planId} removed: ${plan.title}`, before: plan });
  return next;
}

// ------------------------------------------------------------------ batches

export function addBatch(project: Project, planId: string, input: BatchPatch & { label: string }, actor: Actor): { project: Project; batchId: string } {
  const label = (input.label ?? "").trim();
  if (!label) throw new SamplingError("The batch needs a label");
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const id = nextId(next, "B", planId, plan.batches.map((b) => b.id));
  const batch: SamplingBatch = clean({ id, label, plannedLotSizeUnits: input.plannedLotSizeUnits, batchSize: input.batchSize, batchSizeUnit: input.batchSizeUnit?.trim() || undefined, notes: input.notes?.trim() || undefined });
  plan.batches.push(batch);
  assertValid(plan);
  refreshResults(plan, actor.at);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_batch_add", path: `sampling.${planId}.${id}`, detail: `Batch ${id} added to ${planId}: ${label}`, after: batch });
  return { project: next, batchId: id };
}

export function updateBatch(project: Project, planId: string, batchId: string, patch: BatchPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const batch = plan.batches.find((b) => b.id === batchId);
  if (!batch) throw new SamplingError(`Batch ${batchId} is not in plan ${planId}`);
  const before = structuredClone(batch);
  if ("label" in patch) {
    const label = (patch.label ?? "").trim();
    if (!label) throw new SamplingError("The batch needs a label");
    batch.label = label;
  }
  for (const k of ["plannedLotSizeUnits", "batchSize"] as const) if (k in patch) (patch[k] === undefined ? delete batch[k] : (batch[k] = patch[k] as never));
  for (const k of ["batchSizeUnit", "notes"] as const) if (k in patch) (patch[k]?.trim() ? (batch[k] = patch[k]!.trim()) : delete batch[k]);
  assertValid(plan);
  if (JSON.stringify(before) === JSON.stringify(batch)) return project;
  refreshResults(plan, actor.at);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_batch_update", path: `sampling.${planId}.${batchId}`, detail: `Batch ${batchId} of ${planId} edited`, before, after: structuredClone(batch) });
  return next;
}

export function removeBatch(project: Project, planId: string, batchId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const batch = plan.batches.find((b) => b.id === batchId);
  if (!batch) throw new SamplingError(`Batch ${batchId} is not in plan ${planId}`);
  // A point that names this batch alone would silently apply to nothing (or, worse, to all), so the person must move it first.
  const only = plan.points.filter((p) => p.appliesTo !== "all" && p.appliesTo.length === 1 && p.appliesTo[0] === batchId);
  if (only.length) throw new SamplingError(`Point ${only.map((p) => p.id).join(", ")} applies only to ${batch.label}. Change it before removing the batch.`);
  plan.batches = plan.batches.filter((b) => b.id !== batchId);
  for (const p of plan.points) if (p.appliesTo !== "all") p.appliesTo = p.appliesTo.filter((id) => id !== batchId);
  refreshResults(plan, actor.at);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_batch_remove", path: `sampling.${planId}.${batchId}`, detail: `Batch ${batchId} removed from ${planId}: ${batch.label}`, before: batch });
  return next;
}

// ------------------------------------------------------------------ points

function newPoint(id: string, draft: PointDraft, at: string): SamplingPoint {
  return clean({
    id,
    origin: draft.origin ?? { kind: "manual" },
    type: draft.type,
    typeLabel: draft.typeLabel?.trim() || undefined,
    unitOp: draft.unitOp,
    flow: draft.flow ? clean({ stepId: draft.flow.stepId, at: draft.flow.at }) : undefined,
    attribute: (draft.attribute ?? "").trim(),
    materialType: draft.materialType?.trim() || undefined,
    timing: { options: [] },
    sampleSize: { inputs: {} },
    rationale: "",
    // Every batch is the starting scope of a point; narrowing it is a choice the person makes in the editor.
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
  } as SamplingPoint);
}

export function addPoint(project: Project, planId: string, draft: PointDraft, actor: Actor): { project: Project; pointId: string } {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  // A point placed on a step takes the step's unit operation, so everything that reads `unitOp` agrees with the diagram.
  const step = draft.flow ? plan.steps.find((s) => s.id === draft.flow!.stepId) : undefined;
  if (draft.flow && !step) throw new SamplingError(`Step ${draft.flow.stepId} is not in plan ${planId}`);
  const unitOp = step ? unitOpForStep(step) : draft.unitOp;
  if (!unitOp) throw new SamplingError("Choose the process step the point belongs to");
  const id = nextId(next, "SP", planId, plan.points.map((p) => p.id));
  const point = newPoint(id, { ...draft, unitOp }, actor.at);
  plan.points.push(point);
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, {
    action: "sampling_point_add",
    path: `sampling.${planId}.${id}`,
    detail: `Point ${id} added to ${planId}${point.attribute ? `: ${point.attribute}` : ""}${point.origin.kind === "seeded" ? " (from a suggestion)" : ""}`,
    after: point,
  });
  return { project: next, pointId: id };
}

/** Accepting a suggestion adds an incomplete point that remembers where it came from (item path, gap ids, validation activity). */
export function acceptSuggestion(project: Project, planId: string, s: PointSuggestion, actor: Actor): { project: Project; pointId: string } {
  const existing = planOf(project, planId).points.find((p) => p.origin.kind === "seeded" && p.origin.suggestionKey === s.id);
  if (existing) throw new SamplingError(`Point ${existing.id} was already added from this suggestion`);
  // A suggestion belongs to one catalog step. When the plan has that step, the point starts on it with the position NOT set
  // (the suggestion says nothing about before / during / after); otherwise it starts under "Not on the diagram".
  const onStep = planOf(project, planId).steps.find((st) => st.unitOp === s.uo);
  return addPoint(
    project,
    planId,
    {
      unitOp: s.uo,
      ...(onStep ? { flow: { stepId: onStep.id } } : {}),
      ...(s.type ? { type: s.type } : {}),
      attribute: s.attribute,
      ...(s.materialType ? { materialType: s.materialType } : {}),
      origin: clean({ kind: "seeded" as const, suggestionKey: s.id, itemPath: s.itemPath, gapIds: [...s.gapIds], validationActivity: s.validationActivity }),
    },
    actor,
  );
}

export function updatePoint(project: Project, planId: string, pointId: string, patch: PointPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const i = plan.points.findIndex((p) => p.id === pointId);
  if (i < 0) throw new SamplingError(`Point ${pointId} is not in plan ${planId}`);
  const before = plan.points[i]!;
  const merged = clean({ ...structuredClone(before), ...structuredClone(patch) } as SamplingPoint);
  // Optional fields given as undefined are removed, so "clear the locations" really clears it (no stored default).
  for (const k of Object.keys(patch) as (keyof PointPatch)[]) if (patch[k] === undefined) delete (merged as unknown as Record<string, unknown>)[k];
  // Keep `unitOp` in step with the diagram: a point on a step carries that step's unit operation (custom steps: UNIT_OP_CUSTOM_STEP).
  const onStep = merged.flow ? plan.steps.find((s) => s.id === merged.flow!.stepId) : undefined;
  if (onStep) merged.unitOp = unitOpForStep(onStep);
  plan.points[i] = merged;
  assertValid(plan);
  // The arithmetic note is taken after validation, from the point as it will be stored.
  const stored = plan.points[i]!;
  if (stored.sampleSize.method) stored.sampleSize.result = snapshotResult(plan, stored, actor.at);
  else delete stored.sampleSize.result;
  const keep = (p: SamplingPoint) => JSON.stringify({ ...p, updatedAt: undefined, sampleSize: { ...p.sampleSize, result: undefined } });
  if (keep(before) === keep(stored)) return project;
  stored.updatedAt = actor.at;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_point_update", path: `sampling.${planId}.${pointId}`, detail: `Point ${pointId} of ${planId} edited`, before, after: structuredClone(stored) });
  return next;
}

/**
 * Applies a study-design load-out to a mixing point. "replace" swaps the design (the change log keeps the old one); "append" adds the
 * load-out's runs after the existing ones. The load-out only fills a shape; the person edits or ignores it afterwards.
 */
export function applyDesignLoadout(project: Project, planId: string, pointId: string, loadout: DesignLoadout, mode: LoadoutMode, actor: Actor): Project {
  const plan = planOf(project, planId);
  const point = plan.points.find((p) => p.id === pointId);
  if (!point) throw new SamplingError(`Point ${pointId} is not in plan ${planId}`);
  if (point.type !== "mixing_homogeneity") throw new SamplingError("A study design applies to mixing / homogeneity points only");
  const design = applyLoadout(point.detail?.mixing?.design, loadout, mode);
  return updatePoint(project, planId, pointId, { detail: { ...point.detail, mixing: { ...point.detail?.mixing, design } } }, actor);
}

export function removePoint(project: Project, planId: string, pointId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const point = plan.points.find((p) => p.id === pointId);
  if (!point) throw new SamplingError(`Point ${pointId} is not in plan ${planId}`);
  // A subsection placed inside the point would lose its place (and a silent move would change what a reader sees), so the person moves it first.
  const inside = plan.subsections.filter((s) => s.placement === `in_point:${pointId}`);
  if (inside.length) throw new SamplingError(`Subsection ${inside.map((s) => s.id).join(", ")} is placed inside point ${pointId}. Move it before removing the point.`);
  plan.points = plan.points.filter((p) => p.id !== pointId);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_point_remove", path: `sampling.${planId}.${pointId}`, detail: `Point ${pointId} removed from ${planId}${point.attribute ? `: ${point.attribute}` : ""}`, before: point });
  return next;
}

// ------------------------------------------------------------------ process steps and the flow

/**
 * Where a point sits is changed with one function so the diagram, the table and the keyboard all go the same way and every move is
 * change-logged. `null` means "Not on the diagram" (the flow is removed; the point keeps its other fields and its unit operation).
 * A step without a position is a normal state, so `at` may be left out.
 */
export function setPointFlow(project: Project, planId: string, pointId: string, flow: PointFlow | null, actor: Actor): Project {
  return updatePoint(project, planId, pointId, { flow: flow ? clean({ stepId: flow.stepId, at: flow.at, holdId: flow.holdId }) : undefined }, actor);
}

function newStep(project: Project, plan: SamplingPlan, d: StepDraft): PlanStep {
  const label = (d.label ?? "").trim();
  if (!label) throw new SamplingError("The step needs a name");
  if (d.unitOp && plan.steps.some((s) => s.unitOp === d.unitOp)) throw new SamplingError(`${label} is already a step of this plan`);
  const taken = [...plan.steps.map((s) => s.id)];
  return clean({ id: nextId(project, "ST", plan.id, taken), unitOp: d.unitOp || undefined, label, notes: d.notes?.trim() || undefined }) as PlanStep;
}

/** Adds a step at the end (or at `index`). A catalog step names its unit operation and label; a custom step has only a label. */
export function addStep(project: Project, planId: string, draft: StepDraft, actor: Actor, index?: number): { project: Project; stepId: string } {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const step = newStep(next, plan, draft);
  plan.steps.splice(index === undefined ? plan.steps.length : Math.max(0, Math.min(index, plan.steps.length)), 0, step);
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_step_add", path: `sampling.${planId}.${step.id}`, detail: `Process step ${step.id} added to ${planId}: ${step.label}`, after: step });
  return { project: next, stepId: step.id };
}

/**
 * Where a ticked catalog step goes in the plan's list: in catalog process order relative to the catalog steps already there, so
 * ticking "Sterile filtration" after "Aseptic filling" still puts it before filling. It goes just before the first catalog step that
 * comes later in the process; if none does, just after the last one that comes earlier. Custom steps are never reordered (they have
 * no catalog position), and with no catalog step in the list yet the new one goes at the end.
 */
export function catalogInsertIndex(content: ContentBundle, steps: readonly Pick<PlanStep, "unitOp">[], unitOp: string): number {
  const seq = (uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.sequence;
  const mine = seq(unitOp);
  if (mine === undefined) return steps.length;
  let lastEarlier = -1;
  for (let i = 0; i < steps.length; i++) {
    const other = steps[i]!.unitOp ? seq(steps[i]!.unitOp!) : undefined;
    if (other === undefined) continue;
    if (other > mine) return i;
    lastEarlier = i;
  }
  return lastEarlier < 0 ? steps.length : lastEarlier + 1;
}

/** Renames a custom step or edits the notes of any step. A catalog step keeps its catalog name. */
export interface StepPatch {
  label?: string;
  notes?: string;
  /** The lines of the step box in the flow figure (empty lines are dropped; an empty list clears the field). */
  figureText?: string[];
  /** Planned duration in hours; null clears it. */
  durationHours?: number | null;
  /** A sub-process id; null takes the step back into the main process. */
  subProcess?: string | null;
}

export function updateStep(project: Project, planId: string, stepId: string, patch: StepPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new SamplingError(`Step ${stepId} is not in plan ${planId}`);
  const before = structuredClone(step);
  if (patch.label !== undefined) {
    if (step.unitOp) throw new SamplingError("A step from the catalog keeps its catalog name. Use a custom step for a different name.");
    const label = patch.label.trim();
    if (!label) throw new SamplingError("The step needs a name");
    step.label = label;
  }
  if (patch.notes !== undefined) {
    if (patch.notes.trim()) step.notes = patch.notes.trim();
    else delete step.notes;
  }
  if (patch.figureText !== undefined) {
    const lines = patch.figureText.map((l) => l.trim()).filter(Boolean);
    if (lines.length) step.figureText = lines;
    else delete step.figureText;
  }
  if (patch.durationHours !== undefined) {
    if (patch.durationHours === null) delete step.durationHours;
    else if (Number.isFinite(patch.durationHours) && patch.durationHours >= 0) step.durationHours = patch.durationHours;
    else throw new SamplingError("The duration is a number of hours, zero or more");
  }
  if (patch.subProcess !== undefined) {
    if (patch.subProcess === null) delete step.subProcess;
    else step.subProcess = patch.subProcess;
  }
  if (JSON.stringify(before) === JSON.stringify(step)) return project;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_step_update", path: `sampling.${planId}.${stepId}`, detail: `Process step ${stepId} of ${planId} edited`, before, after: structuredClone(step) });
  return next;
}

/** Moves a step one place earlier or later. The diagram and the points table follow the new order at once. */
export function moveStep(project: Project, planId: string, stepId: string, direction: "up" | "down", actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const i = plan.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new SamplingError(`Step ${stepId} is not in plan ${planId}`);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= plan.steps.length) return project;
  const before = plan.steps.map((s) => s.id);
  [plan.steps[i], plan.steps[j]] = [plan.steps[j]!, plan.steps[i]!];
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_step_move", path: `sampling.${planId}.${stepId}`, detail: `Process step ${stepId} of ${planId} moved ${direction}`, before: { order: before }, after: { order: plan.steps.map((s) => s.id) } });
  return next;
}

/**
 * Removes a step. A step that still holds samples is removed only when the person has chosen what happens to them: they move to
 * "Not on the diagram" (nothing is deleted, and the log lists which points moved). Without that choice the call is refused.
 */
export function removeStep(project: Project, planId: string, stepId: string, actor: Actor, opts: { movePointsToTray?: boolean } = {}): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new SamplingError(`Step ${stepId} is not in plan ${planId}`);
  const held = plan.points.filter((p) => p.flow?.stepId === stepId);
  if (held.length && !opts.movePointsToTray) throw new SamplingError(`${held.length} sample${held.length === 1 ? "" : "s"} sit on ${step.label}. Choose to move them to "Not on the diagram" first.`);
  const beforeFigure = figureDataOf(plan);
  plan.steps = plan.steps.filter((s) => s.id !== stepId);
  for (const p of held) {
    delete p.flow;
    p.updatedAt = actor.at;
  }
  const pruned = pruneFigureData(plan, new Set([stepId]), actor.at);
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, {
    action: "sampling_step_remove",
    path: `sampling.${planId}.${stepId}`,
    detail: `Process step ${stepId} removed from ${planId}: ${step.label}${held.length ? ` (${held.map((p) => p.id).join(", ")} moved to Not on the diagram)` : ""}${pruned.length ? `; figure data removed with it: ${pruned.join("; ")}` : ""}`,
    before: { step, points: held.map((p) => p.id), ...(pruned.length ? { figure: beforeFigure } : {}) },
  });
  return next;
}

/** The steps the project scope has in scope now, in process order: the source of the one-time copy and of "Copy steps from the project scope". */
export function projectScopeSteps(content: ContentBundle, project: Project): StepDraft[] {
  const seq = (uo: string) => content.catalog.unitOperations.find((u) => u.key === uo)?.sequence ?? 999;
  return stepGroups(content, project)
    .flatMap((g) => g.steps)
    .filter((s) => s.state === "included")
    .sort((a, b) => seq(a.uo) - seq(b.uo))
    .map((s) => ({ unitOp: s.uo, label: s.label }));
}

/**
 * Copies the project scope's steps into the plan, on request. The plan's steps stay its own: nothing written here changes the gap
 * Scope, and later Scope changes do not touch the plan.
 *  - "append" adds the scope steps the plan does not have yet, at the end (steps already present are skipped, so nothing doubles).
 *  - "replace" makes the plan's list the scope list. A plan step that matches keeps its id and its samples; a step that is not in the
 *    scope (including a custom step) is removed and its samples move to "Not on the diagram", which the log records.
 */
export function copyStepsFromScope(project: Project, planId: string, scopeSteps: StepDraft[], mode: "replace" | "append", actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const before = structuredClone(plan.steps);
  const moved: string[] = [];
  const pruned: string[] = [];
  if (mode === "append") {
    for (const d of scopeSteps) if (!plan.steps.some((s) => s.unitOp === d.unitOp)) plan.steps.push(newStep(next, plan, d));
  } else {
    const kept = new Map(plan.steps.filter((s) => s.unitOp).map((s) => [s.unitOp!, s]));
    const list: PlanStep[] = [];
    for (const d of scopeSteps) list.push(kept.get(d.unitOp ?? "") ?? newStep(next, { ...plan, steps: [...plan.steps, ...list] }, d));
    const keepIds = new Set(list.map((s) => s.id));
    for (const p of plan.points) {
      if (p.flow && !keepIds.has(p.flow.stepId)) {
        moved.push(p.id);
        delete p.flow;
        p.updatedAt = actor.at;
      }
    }
    const gone = new Set(plan.steps.filter((s) => !keepIds.has(s.id)).map((s) => s.id));
    plan.steps = list;
    pruned.push(...pruneFigureData(plan, gone, actor.at));
  }
  if (JSON.stringify(before) === JSON.stringify(plan.steps) && !pruned.length) return project;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, {
    action: "sampling_steps_copy",
    path: `sampling.${planId}`,
    detail: `Process steps of ${planId} ${mode === "append" ? "added from" : "replaced by"} the project scope${moved.length ? ` (${moved.join(", ")} moved to Not on the diagram)` : ""}${pruned.length ? `; figure data removed with the steps: ${pruned.join("; ")}` : ""}`,
    before: { steps: before },
    after: { steps: structuredClone(plan.steps), ...(moved.length ? { movedToTray: moved } : {}) },
  });
  return next;
}

// ------------------------------------------------------------------ plan parties

/** Replaces the list of responsible parties named at plan level. The old list is kept in the change log. */
export function setParties(project: Project, planId: string, parties: PlanParty[], actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const cleaned = parties.map((p) => clean({ party: p.party, name: p.name.trim(), role: p.role?.trim() || undefined, department: p.department?.trim() || undefined, memoLine: p.memoLine }));
  if (cleaned.some((p) => !p.name)) throw new SamplingError("Every responsible party needs a name");
  if (JSON.stringify(cleaned) === JSON.stringify(plan.parties)) return project;
  const before = structuredClone(plan.parties);
  plan.parties = cleaned;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_parties_update", path: `sampling.${planId}`, detail: `Responsible parties of ${planId} edited`, before, after: structuredClone(cleaned) });
  return next;
}

// ------------------------------------------------------------------ agency requests

const requestFields = (i: AgencyRequestPatch): AgencyRequestPatch => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i)) o[k] = typeof v === "string" ? v.trim() : v;
  return o as AgencyRequestPatch;
};

export function addAgencyRequest(project: Project, planId: string, input: AgencyRequestInput, actor: Actor): { project: Project; requestId: string } {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const id = nextId(next, "AR", planId, plan.agencyRequests.map((r) => r.id));
  const request = clean({ ...requestFields(input), id, sourceIds: input.sourceIds ?? [], createdAt: actor.at, updatedAt: actor.at } as AgencyRequest);
  plan.agencyRequests.push(request);
  // A register with a request in it cannot also say "there are none".
  const hadNone = plan.noAgencyRequests;
  delete plan.noAgencyRequests;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_agency_add", path: `sampling.${planId}.${id}`, detail: `Agency request ${id} added to ${planId}`, ...(hadNone ? { before: { noAgencyRequests: true } } : {}), after: request });
  return { project: next, requestId: id };
}

export function updateAgencyRequest(project: Project, planId: string, requestId: string, patch: AgencyRequestPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const i = plan.agencyRequests.findIndex((r) => r.id === requestId);
  if (i < 0) throw new SamplingError(`Agency request ${requestId} is not in plan ${planId}`);
  const before = plan.agencyRequests[i]!;
  const merged = clean({ ...structuredClone(before), ...structuredClone(requestFields(patch)) } as AgencyRequest);
  for (const k of Object.keys(patch) as (keyof AgencyRequestPatch)[]) if (patch[k] === undefined || patch[k] === "") delete (merged as unknown as Record<string, unknown>)[k];
  // The question and the agency are required text: clearing them is kept as an empty string, which is an open item.
  const mm = merged as { question?: string; agency?: string };
  if (!("question" in mm)) mm.question = "";
  if (!("agency" in mm)) mm.agency = "";
  plan.agencyRequests[i] = merged;
  assertValid(plan);
  const keep = (r: AgencyRequest) => JSON.stringify({ ...r, updatedAt: undefined });
  if (keep(before) === keep(merged)) return project;
  merged.updatedAt = actor.at;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_agency_update", path: `sampling.${planId}.${requestId}`, detail: `Agency request ${requestId} of ${planId} edited`, before, after: structuredClone(merged) });
  return next;
}

export function removeAgencyRequest(project: Project, planId: string, requestId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const request = plan.agencyRequests.find((r) => r.id === requestId);
  if (!request) throw new SamplingError(`Agency request ${requestId} is not in plan ${planId}`);
  const linked = plan.points.filter((p) => p.agencyRequestIds?.includes(requestId));
  if (linked.length) throw new SamplingError(`Point ${linked.map((p) => p.id).join(", ")} is linked to ${requestId}. Unlink it before removing the request.`);
  plan.agencyRequests = plan.agencyRequests.filter((r) => r.id !== requestId);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_agency_remove", path: `sampling.${planId}.${requestId}`, detail: `Agency request ${requestId} removed from ${planId}`, before: request });
  return next;
}

// ------------------------------------------------------------------ custom subsections

const cleanBlocks = (blocks: SubsectionBlock[]): SubsectionBlock[] =>
  blocks.map((b): SubsectionBlock => {
    switch (b.type) {
      case "paragraph":
        return { type: "paragraph", text: cleanText(b.text) };
      case "list":
        return { type: "list", items: b.items.map(cleanText) };
      case "table":
        return { type: "table", columns: b.columns.map(cleanText), rows: b.rows.map((r) => r.map(cleanText)) };
    }
  });

const nextOrder = (plan: SamplingPlan, placement: string, except?: string): number =>
  plan.subsections.filter((s) => s.placement === placement && s.id !== except).reduce((m, s) => Math.max(m, s.order + 1), 0);

export function addSubsection(project: Project, planId: string, input: SubsectionInput, actor: Actor): { project: Project; subsectionId: string } {
  if (!isPlacement(input.placement)) throw new SamplingError("Choose where the subsection goes");
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const id = nextId(next, "CS", planId, plan.subsections.map((s) => s.id));
  const sub: CustomSubsection = {
    id,
    title: cleanText(input.title).trim(),
    blocks: cleanBlocks(input.blocks),
    placement: input.placement,
    order: nextOrder(plan, input.placement),
    includeInCmo: input.includeInCmo ?? false,
    origin: input.origin ?? { kind: "manual" },
    createdAt: actor.at,
    updatedAt: actor.at,
  };
  plan.subsections.push(sub);
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, {
    action: "sampling_subsection_add",
    path: `sampling.${planId}.${id}`,
    detail: `Subsection ${id} added to ${planId}${sub.title ? `: ${sub.title}` : ""}${sub.origin.kind === "library" ? ` (from library item ${sub.origin.name} ${sub.origin.version})` : ""}`,
    after: sub,
  });
  return { project: next, subsectionId: id };
}

export function updateSubsection(project: Project, planId: string, subsectionId: string, patch: SubsectionPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const sub = plan.subsections.find((s) => s.id === subsectionId);
  if (!sub) throw new SamplingError(`Subsection ${subsectionId} is not in plan ${planId}`);
  const before = structuredClone(sub);
  if (patch.title !== undefined) sub.title = cleanText(patch.title).trim();
  if (patch.blocks !== undefined) sub.blocks = cleanBlocks(patch.blocks);
  if (patch.includeInCmo !== undefined) sub.includeInCmo = patch.includeInCmo;
  if (patch.placement !== undefined && patch.placement !== sub.placement) {
    if (!isPlacement(patch.placement)) throw new SamplingError("Choose where the subsection goes");
    sub.placement = patch.placement;
    sub.order = nextOrder(plan, patch.placement, sub.id);
  }
  assertValid(plan);
  if (JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...sub, updatedAt: 0 })) return project;
  sub.updatedAt = actor.at;
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_subsection_update", path: `sampling.${planId}.${subsectionId}`, detail: `Subsection ${subsectionId} of ${planId} edited`, before, after: structuredClone(sub) });
  return next;
}

/** Moves a subsection one place earlier or later among those with the same placement. */
export function moveSubsection(project: Project, planId: string, subsectionId: string, direction: "up" | "down", actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const sub = plan.subsections.find((s) => s.id === subsectionId);
  if (!sub) throw new SamplingError(`Subsection ${subsectionId} is not in plan ${planId}`);
  const siblings = plan.subsections.filter((s) => s.placement === sub.placement).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const i = siblings.findIndex((s) => s.id === subsectionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return project;
  const before = siblings.map((s) => s.id);
  [siblings[i], siblings[j]] = [siblings[j]!, siblings[i]!];
  siblings.forEach((s, n) => {
    s.order = n;
  });
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_subsection_move", path: `sampling.${planId}.${subsectionId}`, detail: `Subsection ${subsectionId} of ${planId} moved ${direction}`, before: { order: before }, after: { order: siblings.map((s) => s.id) } });
  return next;
}

export function removeSubsection(project: Project, planId: string, subsectionId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const sub = plan.subsections.find((s) => s.id === subsectionId);
  if (!sub) throw new SamplingError(`Subsection ${subsectionId} is not in plan ${planId}`);
  plan.subsections = plan.subsections.filter((s) => s.id !== subsectionId);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_subsection_remove", path: `sampling.${planId}.${subsectionId}`, detail: `Subsection ${subsectionId} removed from ${planId}${sub.title ? `: ${sub.title}` : ""}`, before: sub });
  return next;
}

export function planById(project: Project, planId: string): SamplingPlan | undefined {
  return project.sampling.plans.find((p) => p.id === planId);
}


// ------------------------------------------------------------------ flow-figure data (plan format 1.4.0)

/*
 * Holds, time targets, sub-processes and time zero are OPTIONAL plan data for the PPQ flow figures. Nothing here is required,
 * defaulted or checked for completeness; the only rule is reference integrity (an id must exist), which the schema keeps. Every edit
 * goes through the same clone / validate / change-log path as the rest of the plan, with the old value kept.
 */

/** The figure data of a plan as one object, for the "before" of a change-log event. */
function figureDataOf(plan: SamplingPlan) {
  return structuredClone({ holds: plan.holds ?? [], timeTargets: plan.timeTargets ?? [], subProcesses: plan.subProcesses ?? [], timeZero: plan.timeZero ?? null });
}

/**
 * Removes the figure data that depended on steps that are gone, and says what was removed (the sentence goes into the change log).
 * A hold after a removed step goes with it, and samples that sat on that hold stay on their step but lose the hold; a time target
 * that starts or ends on a removed step cannot be drawn and goes; a sub-process that fed a removed step is kept but no longer feeds
 * anything (its steps and its own target are still the person's work); time zero on a removed step goes back to "not chosen".
 */
function pruneFigureData(plan: SamplingPlan, goneSteps: ReadonlySet<string>, at: string): string[] {
  const out: string[] = [];
  if (!goneSteps.size) return out;
  const goneHolds = new Set((plan.holds ?? []).filter((h) => goneSteps.has(h.afterStepId)).map((h) => h.id));
  if (goneHolds.size) {
    out.push(`hold ${[...goneHolds].join(", ")}`);
    plan.holds = (plan.holds ?? []).filter((h) => !goneHolds.has(h.id));
    if (!plan.holds.length) delete plan.holds;
    for (const p of plan.points) {
      if (p.flow?.holdId && goneHolds.has(p.flow.holdId)) {
        delete p.flow.holdId;
        p.updatedAt = at;
      }
    }
  }
  const goneTargets = (plan.timeTargets ?? []).filter((t) => goneSteps.has(t.fromStepId) || goneSteps.has(t.toStepId));
  if (goneTargets.length) {
    out.push(`time target ${goneTargets.map((t) => t.id).join(", ")}`);
    plan.timeTargets = (plan.timeTargets ?? []).filter((t) => !goneTargets.includes(t));
    if (!plan.timeTargets.length) delete plan.timeTargets;
  }
  for (const b of plan.subProcesses ?? []) {
    if (b.feedsStepId && goneSteps.has(b.feedsStepId)) {
      delete b.feedsStepId;
      out.push(`${b.id} no longer feeds a step`);
    }
  }
  if (plan.timeZero && goneSteps.has(plan.timeZero.stepId)) {
    delete plan.timeZero;
    out.push("time zero");
  }
  return out;
}

type FigureList = "holds" | "timeTargets" | "subProcesses";
const FIGURE_KIND: Record<FigureList, { prefix: "HD" | "TT" | "SB"; noun: string }> = {
  holds: { prefix: "HD", noun: "hold" },
  timeTargets: { prefix: "TT", noun: "time target" },
  subProcesses: { prefix: "SB", noun: "sub-process" },
};

type Item<K extends FigureList> = K extends "holds" ? PlanHold : K extends "timeTargets" ? PlanTimeTarget : PlanSubProcess;

/** Trims the free text of a figure item and drops empty optional text, so "cleared" really is absent. */
function tidy<K extends FigureList>(kind: K, item: Item<K>): Item<K> {
  const o = { ...item } as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t) o[k] = t;
      else delete o[k];
    } else if (v === undefined || v === null) delete o[k];
  }
  if (!o.label) throw new SamplingError(`The ${FIGURE_KIND[kind].noun} needs a name`);
  for (const k of ["durationHours", "hours"]) if (k in o && !(typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= 0)) throw new SamplingError("Hours are a number, zero or more");
  return o as unknown as Item<K>;
}

export function addFigureItem<K extends FigureList>(project: Project, planId: string, kind: K, input: Omit<Item<K>, "id">, actor: Actor): { project: Project; itemId: string } {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const list = (plan[kind] ??= []) as Item<K>[];
  const { prefix, noun } = FIGURE_KIND[kind];
  const id = nextId(next, prefix, plan.id, list.map((x) => x.id));
  const item = tidy(kind, { ...input, id } as Item<K>);
  list.push(item);
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: `sampling_${noun.replace(/\W/g, "_")}_add`, path: `sampling.${planId}.${id}`, detail: `${noun[0]!.toUpperCase()}${noun.slice(1)} ${id} added to ${planId}: ${item.label}`, after: structuredClone(item) });
  return { project: next, itemId: id };
}

export function updateFigureItem<K extends FigureList>(project: Project, planId: string, kind: K, itemId: string, patch: Partial<Omit<Item<K>, "id">>, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const list = (plan[kind] ?? []) as Item<K>[];
  const i = list.findIndex((x) => x.id === itemId);
  const { noun } = FIGURE_KIND[kind];
  if (i < 0) throw new SamplingError(`${noun[0]!.toUpperCase()}${noun.slice(1)} ${itemId} is not in plan ${planId}`);
  const before = structuredClone(list[i]!);
  const merged = { ...before, ...patch } as Item<K>;
  list[i] = tidy(kind, merged);
  if (JSON.stringify(before) === JSON.stringify(list[i])) return project;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: `sampling_${noun.replace(/\W/g, "_")}_update`, path: `sampling.${planId}.${itemId}`, detail: `${noun[0]!.toUpperCase()}${noun.slice(1)} ${itemId} of ${planId} edited`, before, after: structuredClone(list[i]) });
  return next;
}

export function removeFigureItem(project: Project, planId: string, kind: FigureList, itemId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const list = (plan[kind] ?? []) as { id: string }[];
  const before = list.find((x) => x.id === itemId);
  const { noun } = FIGURE_KIND[kind];
  if (!before) throw new SamplingError(`${noun[0]!.toUpperCase()}${noun.slice(1)} ${itemId} is not in plan ${planId}`);
  const freed: string[] = [];
  if (kind === "holds") {
    // Samples that sat on the hold stay on their step; only the hold position goes.
    for (const p of plan.points) {
      if (p.flow?.holdId === itemId) {
        delete p.flow.holdId;
        p.updatedAt = actor.at;
        freed.push(p.id);
      }
    }
  }
  if (kind === "subProcesses") {
    for (const s of plan.steps) {
      if (s.subProcess === itemId) {
        delete s.subProcess;
        freed.push(s.id);
      }
    }
  }
  const rest = list.filter((x) => x.id !== itemId);
  if (rest.length) (plan[kind] as unknown) = rest;
  else delete plan[kind];
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, {
    action: `sampling_${noun.replace(/\W/g, "_")}_remove`,
    path: `sampling.${planId}.${itemId}`,
    detail: `${noun[0]!.toUpperCase()}${noun.slice(1)} ${itemId} removed from ${planId}${freed.length ? ` (${freed.join(", ")} kept, no longer linked to it)` : ""}`,
    before: structuredClone(before),
  });
  return next;
}

/** Chooses (or with null clears) time zero of the time-scale figure. Without it the figure starts at the end of the first main step. */
export function setTimeZero(project: Project, planId: string, timeZero: PlanTimeZero | null, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const before = plan.timeZero ? structuredClone(plan.timeZero) : null;
  if (timeZero) plan.timeZero = { stepId: timeZero.stepId, edge: timeZero.edge };
  else delete plan.timeZero;
  if (JSON.stringify(before) === JSON.stringify(plan.timeZero ?? null)) return project;
  assertValid(plan);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_time_zero_update", path: `sampling.${planId}`, detail: `Time zero of the flow figure in ${planId} ${timeZero ? "set" : "cleared"}`, before: { timeZero: before }, after: { timeZero: plan.timeZero ?? null } });
  return next;
}

// ------------------------------------------------------------------ prefill suggestions for the figure

export interface HoldSuggestion {
  afterStepId: string;
  label: string;
  durationText: string;
  durationHours?: number;
  condition?: string;
  /** The hold-time point the values come from. */
  fromPoint: string;
}

const HOURS_PER: Record<string, number> = { minutes: 1 / 60, hours: 1, days: 24 };

/**
 * Holds the plan's own hold-time points describe (type "hold time", the step after which material is held, the durations being
 * studied, the condition) that are not yet holds of the figure. A SUGGESTION only: the caller shows it and the person accepts or edits
 * it; the figure reads the plan's `holds`, never these. The longest studied duration is offered as the hours because a hold-time
 * study is run up to the proposed maximum; the text keeps every studied duration so nothing is hidden.
 */
export function holdSuggestions(plan: SamplingPlan): HoldSuggestion[] {
  const out: HoldSuggestion[] = [];
  for (const p of plan.points) {
    const h = p.detail?.hold;
    if (p.type !== "hold_time" || !h?.holdStep) continue;
    const step = plan.steps.find((s) => s.unitOp === h.holdStep);
    if (!step) continue;
    if ((plan.holds ?? []).some((x) => x.afterStepId === step.id) || out.some((x) => x.afterStepId === step.id)) continue;
    const durations = h.durations ?? [];
    const hours = durations.length ? Math.max(...durations.map((d) => d.value * (HOURS_PER[d.unit] ?? 1))) : undefined;
    out.push({
      afterStepId: step.id,
      label: `Hold after ${step.label}`,
      durationText: durations.map((d) => `${d.value} ${d.unit === "minutes" ? "min" : d.unit === "hours" ? "h" : "days"}`).join(" / "),
      ...(hours !== undefined ? { durationHours: Math.round(hours * 100) / 100 } : {}),
      ...(h.condition?.trim() ? { condition: h.condition.trim() } : {}),
      fromPoint: p.id,
    });
  }
  return out;
}

/** The text of a step box ("S2") the project or the TRD can supply, one line per parameter. Keyed by plan step id. */
export type FigureTextSuggestions = Record<string, string[]>;
