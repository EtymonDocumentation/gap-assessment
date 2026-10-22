import {
  samplingPlanSchema,
  type Actor,
  type ChangeEvent,
  type Project,
  type SamplingBatch,
  type SamplingCategory,
  type SamplingPlan,
  type SamplingPoint,
} from "@gap/process-model";
import { snapshotResult } from "@gap/sampling";
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

/** What a person types for a new point. Only the unit operation and the category are needed to start; the rest can follow. */
export interface PointDraft {
  unitOp: string;
  category: SamplingCategory;
  attribute?: string;
  categoryLabel?: string;
  materialType?: string;
  origin?: SamplingPoint["origin"];
}

/** Fields of a point a person can change (the id, the origin and the time stamps cannot). */
export type PointPatch = Partial<Omit<SamplingPoint, "id" | "origin" | "createdAt" | "updatedAt">>;
export type PlanPatch = Partial<Pick<SamplingPlan, "title" | "notes" | "batchRationale">>;
export type BatchPatch = Partial<Omit<SamplingBatch, "id">>;

const pad = (n: number) => String(n).padStart(3, "0");

/** Next id of a kind inside a plan. Ids are never reused: an id that only survives in the change log still counts as taken. */
function nextId(project: Project, prefix: "SPL" | "B" | "SP", planId: string | undefined, existing: readonly string[]): string {
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

export function createPlan(project: Project, input: { title: string; notes?: string }, actor: Actor): { project: Project; planId: string } {
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
    batches: [],
    batchRationale: "",
    points: [],
    createdAt: actor.at,
    updatedAt: actor.at,
  } as SamplingPlan);
  next.sampling.plans.push(plan);
  log(next, actor, { action: "sampling_plan_add", path: `sampling.${id}`, detail: `Sampling plan ${id}: ${title}`, after: { id, title } });
  return { project: next, planId: id };
}

export function updatePlan(project: Project, planId: string, patch: PlanPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
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
    category: draft.category,
    categoryLabel: draft.categoryLabel?.trim() || undefined,
    unitOp: draft.unitOp,
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
  if (!draft.unitOp) throw new SamplingError("Choose the process step the point belongs to");
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const id = nextId(next, "SP", planId, plan.points.map((p) => p.id));
  const point = newPoint(id, draft, actor.at);
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
  return addPoint(
    project,
    planId,
    {
      unitOp: s.uo,
      category: s.category,
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

export function removePoint(project: Project, planId: string, pointId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const plan = planOf(next, planId);
  const point = plan.points.find((p) => p.id === pointId);
  if (!point) throw new SamplingError(`Point ${pointId} is not in plan ${planId}`);
  plan.points = plan.points.filter((p) => p.id !== pointId);
  plan.updatedAt = actor.at;
  log(next, actor, { action: "sampling_point_remove", path: `sampling.${planId}.${pointId}`, detail: `Point ${pointId} removed from ${planId}${point.attribute ? `: ${point.attribute}` : ""}`, before: point });
  return next;
}

export function planById(project: Project, planId: string): SamplingPlan | undefined {
  return project.sampling.plans.find((p) => p.id === planId);
}
