import {
  riskAssessmentSchema,
  riskConfigSchema,
  type Actor,
  type ChangeEvent,
  type PlanStep,
  type Project,
  type RiskAction,
  type RiskActionStatus,
  type RiskApproval,
  type RiskAssessment,
  type RiskConfig,
  type RiskItem,
  type RiskScore,
} from "@gap/process-model";
import { configProblems, scoreIsEmpty, scoreItem, type RiskResult } from "@gap/risk";
import type { StepDraft } from "./sampling";

/**
 * Edits of the risk assessments in a project (ICH Q9(R1)). Every edit returns a new project and adds one change-log event with the
 * old value kept (GMP: a reviewer must be able to see what a risk decision was before it was changed, and by whom).
 *
 * Nothing here decides a value. A new assessment has no method; a new item has no score; a score is what the person entered. A
 * missing answer makes the item "not scored" and an open item, never a guess. The tool names a band only if the person defined
 * bands, and only in the person's words.
 */

export class RiskError extends Error {}

const pad = (n: number) => String(n).padStart(3, "0");
const padStep = (n: number) => String(n).padStart(2, "0");

/** Next id of a kind. Ids are never reused: an id that only survives in the change log still counts as taken. */
function nextId(project: Project, prefix: "RAS" | "RA" | "AC" | "ST", assessmentId: string | undefined, existing: readonly string[]): string {
  let max = 0;
  const take = (id: string) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  existing.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] !== "risk") continue;
    if (prefix === "RAS") take(parts[1] ?? "");
    else if (parts[1] === assessmentId) take(parts[2] ?? "");
  }
  const n = max + 1;
  return `${prefix}-${prefix === "ST" ? padStep(n) : pad(n)}`;
}

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function assessmentOf(project: Project, id: string): RiskAssessment {
  const a = project.risk.assessments.find((x) => x.id === id);
  if (!a) throw new RiskError(`Risk assessment ${id} does not exist`);
  return a;
}

function itemOf(a: RiskAssessment, id: string): RiskItem {
  const i = a.items.find((x) => x.id === id);
  if (!i) throw new RiskError(`Item ${id} is not in ${a.id}`);
  return i;
}

/** The assessment must still satisfy its schema (unique ids, items on real steps, actions of real items). The first problem is shown. */
function assertValid(a: RiskAssessment): void {
  const r = riskAssessmentSchema.safeParse(a);
  if (!r.success) throw new RiskError(r.error.issues[0]?.message ?? "The risk assessment is not valid");
}

const text = (v: string | undefined) => (v ?? "").trim();

// ------------------------------------------------------------------ assessments

export function createAssessment(project: Project, input: { title: string; scopeNote?: string; context?: string; steps?: StepDraft[] }, actor: Actor): { project: Project; assessmentId: string } {
  const title = text(input.title);
  if (!title) throw new RiskError("The assessment needs a title");
  const next = structuredClone(project);
  const id = nextId(next, "RAS", undefined, next.risk.assessments.map((a) => a.id));
  const a: RiskAssessment = { id, title, status: "draft", steps: [], items: [], actions: [], createdAt: actor.at, updatedAt: actor.at };
  if (text(input.scopeNote)) a.scopeNote = text(input.scopeNote);
  if (text(input.context)) a.context = text(input.context);
  // The one-time copy of the project scope (or whatever the caller passes). After this the assessment's steps are its own.
  for (const d of input.steps ?? []) a.steps.push(newStep(next, a, d));
  assertValid(a);
  next.risk.assessments.push(a);
  log(next, actor, { action: "risk_assessment_add", path: `risk.${id}`, detail: `Risk assessment ${id}: ${title}${a.steps.length ? ` (${a.steps.length} process steps)` : ""}`, after: { id, title, ...(a.steps.length ? { steps: a.steps } : {}) } });
  return { project: next, assessmentId: id };
}

export type AssessmentPatch = { title?: string; scopeNote?: string; context?: string; approvals?: RiskApproval[] };

export function updateAssessment(project: Project, id: string, patch: AssessmentPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of ["title", "scopeNote", "context"] as const) {
    if (!(k in patch)) continue;
    const v = text(patch[k]);
    if (k === "title" && !v) throw new RiskError("The assessment needs a title");
    if (text(a[k]) === v) continue;
    before[k] = a[k] ?? "";
    after[k] = v;
    if (v) a[k] = v;
    else delete a[k];
  }
  if ("approvals" in patch) {
    const list = (patch.approvals ?? []).map((x) => ({ role: text(x.role), ...(text(x.name) ? { name: text(x.name) } : {}), ...(text(x.date) ? { date: text(x.date) } : {}) })).filter((x) => x.role);
    if (JSON.stringify(list) !== JSON.stringify(a.approvals ?? [])) {
      before.approvals = a.approvals ?? [];
      after.approvals = list;
      if (list.length) a.approvals = list;
      else delete a.approvals;
    }
  }
  if (!Object.keys(after).length) return project;
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_assessment_update", path: `risk.${id}`, detail: `Risk assessment ${id} edited`, before, after });
  return next;
}

export function deleteAssessment(project: Project, id: string, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  next.risk.assessments = next.risk.assessments.filter((x) => x.id !== id);
  // The whole assessment is kept in the log, so removing it never loses what it said.
  log(next, actor, { action: "risk_assessment_remove", path: `risk.${id}`, detail: `Risk assessment ${id} removed: ${a.title}`, before: a });
  return next;
}

// ------------------------------------------------------------------ method

/**
 * Chooses or edits the method. ONE METHOD PER ASSESSMENT: switching to a different method would leave every score meaning
 * something else, so it is refused while items carry scores unless the person chooses to clear them (`clearScores`), and then the
 * log keeps the old scores. Editing the SAME method (a scale, a band, a label) keeps the scores: an answer that no longer fits
 * becomes "not scored" and an open item, visibly, instead of being changed silently.
 */
export function setMethod(project: Project, id: string, config: RiskConfig | null, actor: Actor, opts: { clearScores?: boolean; note?: string } = {}): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  let parsed: RiskConfig | undefined;
  if (config) {
    const r = riskConfigSchema.safeParse(config);
    if (!r.success) throw new RiskError(r.error.issues[0]?.message ?? "The method is not valid");
    parsed = r.data;
  }
  if (JSON.stringify(parsed ?? null) === JSON.stringify(a.config ?? null)) return project;
  const changesMethod = (parsed?.method ?? null) !== (a.method ?? null);
  const scored = a.items.filter((i) => !scoreIsEmpty(i.initial) || !scoreIsEmpty(i.residual));
  const before: Record<string, unknown> = { method: a.method ?? null, config: a.config ?? null };
  if (changesMethod && a.method && scored.length) {
    if (!opts.clearScores) throw new RiskError(`${scored.length} item${scored.length === 1 ? " has" : "s have"} scores under the current method. Choose to clear the scores before changing the method.`);
    before.scores = scored.map((i) => ({ id: i.id, initial: i.initial, ...(i.residual ? { residual: i.residual } : {}) }));
    for (const i of a.items) {
      i.initial = { values: {} };
      delete i.residual;
      i.updatedAt = actor.at;
    }
  }
  if (parsed) {
    a.method = parsed.method;
    a.config = parsed;
  } else {
    delete a.method;
    delete a.config;
  }
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, {
    action: "risk_method_set",
    path: `risk.${id}`,
    detail: parsed ? `Method of ${id} ${changesMethod ? "set" : "edited"}: ${parsed.method}${parsed.loadoutId ? ` (from load-out ${parsed.loadoutId})` : ""}${before.scores ? ` (${scored.length} scores cleared)` : ""}${opts.note ? `. ${opts.note}` : ""}` : `Method of ${id} removed`,
    before,
    after: { method: parsed?.method ?? null, config: parsed ?? null },
  });
  return next;
}

/** One score that would read differently under another version of the method. */
export interface RescoreChange {
  itemId: string;
  which: "initial" | "residual";
  before: string;
  after: string;
}

/** A score as the page shows it, in words: "12 Medium", "Not scored". Only used to compare two readings of the same answers. */
function reading(r: RiskResult): string {
  if (!r.scored) return "Not scored";
  return [r.score !== undefined ? String(r.score) : "", r.label ?? "", r.trigger ? `(rule: ${r.trigger.label})` : ""].filter(Boolean).join(" ");
}

/**
 * What would change if the assessment used `next` instead of its present method: every item whose initial or residual score reads
 * differently (a new band label, or a score that no longer fits the scale and becomes "Not scored"). Nothing is changed here; the
 * person sees the list before agreeing to take a newer library version. Only meaningful for the SAME kind of method: a different
 * kind clears the scores instead (see setMethod).
 */
export function rescoreChanges(a: RiskAssessment, next: RiskConfig): RescoreChange[] {
  if (!a.config) return [];
  const out: RescoreChange[] = [];
  for (const i of a.items) {
    for (const which of ["initial", "residual"] as const) {
      const score = i[which];
      if (!score || scoreIsEmpty(score)) continue;
      const before = reading(scoreItem(a.config, score));
      const after = reading(scoreItem(next, score));
      if (before !== after) out.push({ itemId: i.id, which, before, after });
    }
  }
  return out;
}

// ------------------------------------------------------------------ steps

function newStep(project: Project, a: RiskAssessment, d: StepDraft): PlanStep {
  const label = text(d.label);
  if (!label) throw new RiskError("The step needs a name");
  if (d.unitOp && a.steps.some((s) => s.unitOp === d.unitOp)) throw new RiskError(`${label} is already a step of this assessment`);
  const step: PlanStep = { id: nextId(project, "ST", a.id, a.steps.map((s) => s.id)), label };
  if (d.unitOp) step.unitOp = d.unitOp;
  if (text(d.notes)) step.notes = text(d.notes);
  return step;
}

export function addRiskStep(project: Project, id: string, draft: StepDraft, actor: Actor, index?: number): { project: Project; stepId: string } {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const step = newStep(next, a, draft);
  a.steps.splice(index === undefined ? a.steps.length : Math.max(0, Math.min(index, a.steps.length)), 0, step);
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_step_add", path: `risk.${id}.${step.id}`, detail: `Process step ${step.id} added to ${id}: ${step.label}`, after: step });
  return { project: next, stepId: step.id };
}

export function updateRiskStep(project: Project, id: string, stepId: string, patch: { label?: string; notes?: string }, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const step = a.steps.find((s) => s.id === stepId);
  if (!step) throw new RiskError(`Step ${stepId} is not in ${id}`);
  const before = structuredClone(step);
  if (patch.label !== undefined) {
    if (step.unitOp) throw new RiskError("A step from the catalog keeps its catalog name. Use a custom step for a different name.");
    if (!text(patch.label)) throw new RiskError("The step needs a name");
    step.label = text(patch.label);
  }
  if (patch.notes !== undefined) {
    if (text(patch.notes)) step.notes = text(patch.notes);
    else delete step.notes;
  }
  if (JSON.stringify(before) === JSON.stringify(step)) return project;
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_step_update", path: `risk.${id}.${stepId}`, detail: `Process step ${stepId} of ${id} edited`, before, after: structuredClone(step) });
  return next;
}

export function moveRiskStep(project: Project, id: string, stepId: string, direction: "up" | "down", actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const i = a.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new RiskError(`Step ${stepId} is not in ${id}`);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= a.steps.length) return project;
  const before = a.steps.map((s) => s.id);
  [a.steps[i], a.steps[j]] = [a.steps[j]!, a.steps[i]!];
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_step_move", path: `risk.${id}.${stepId}`, detail: `Process step ${stepId} of ${id} moved ${direction}`, before: { order: before }, after: { order: a.steps.map((s) => s.id) } });
  return next;
}

/** Removes a step. Its items are not deleted: they move to "not placed on a step", and the log lists which. */
export function removeRiskStep(project: Project, id: string, stepId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const step = a.steps.find((s) => s.id === stepId);
  if (!step) throw new RiskError(`Step ${stepId} is not in ${id}`);
  const held = a.items.filter((i) => i.stepId === stepId);
  a.steps = a.steps.filter((s) => s.id !== stepId);
  for (const i of held) {
    delete i.stepId;
    i.updatedAt = actor.at;
  }
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_step_remove", path: `risk.${id}.${stepId}`, detail: `Process step ${stepId} removed from ${id}: ${step.label}${held.length ? ` (${held.map((i) => i.id).join(", ")} no longer placed on a step)` : ""}`, before: { step, items: held.map((i) => i.id) } });
  return next;
}

/** Copies the project scope's steps into the assessment, on request. "append" adds the missing ones at the end; "replace" makes the list the scope's (items on removed steps become unplaced). */
export function copyRiskStepsFromScope(project: Project, id: string, scopeSteps: StepDraft[], mode: "replace" | "append", actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const before = structuredClone(a.steps);
  const unplaced: string[] = [];
  if (mode === "append") {
    for (const d of scopeSteps) if (!a.steps.some((s) => s.unitOp === d.unitOp)) a.steps.push(newStep(next, a, d));
  } else {
    const kept = new Map(a.steps.filter((s) => s.unitOp).map((s) => [s.unitOp!, s]));
    const list: PlanStep[] = [];
    for (const d of scopeSteps) list.push(kept.get(d.unitOp ?? "") ?? newStep(next, { ...a, steps: [...a.steps, ...list] }, d));
    const keep = new Set(list.map((s) => s.id));
    for (const i of a.items) {
      if (i.stepId && !keep.has(i.stepId)) {
        unplaced.push(i.id);
        delete i.stepId;
        i.updatedAt = actor.at;
      }
    }
    a.steps = list;
  }
  if (JSON.stringify(before) === JSON.stringify(a.steps)) return project;
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, {
    action: "risk_steps_copy",
    path: `risk.${id}`,
    detail: `Process steps of ${id} ${mode === "append" ? "added from" : "replaced by"} the project scope${unplaced.length ? ` (${unplaced.join(", ")} no longer placed on a step)` : ""}`,
    before: { steps: before },
    after: { steps: structuredClone(a.steps), ...(unplaced.length ? { unplaced } : {}) },
  });
  return next;
}

// ------------------------------------------------------------------ items

export interface ItemDraft {
  stepId?: string;
  failureMode?: string;
  effect?: string;
  causes?: string;
  controlsPrevention?: string;
  controlsDetection?: string;
  gapIds?: string[];
  samplingPointIds?: string[];
  sourceIds?: string[];
  notes?: string;
  origin?: RiskItem["origin"];
}

/** Fields of an item a person can change (the id, the origin and the time stamps cannot). `undefined` clears an optional field. */
export type ItemPatch = Partial<Omit<RiskItem, "id" | "origin" | "createdAt" | "updatedAt">>;

const TEXT_FIELDS = ["effect", "causes", "controlsPrevention", "controlsDetection", "notes"] as const;

function cleanScore(s: RiskScore): RiskScore {
  const out: RiskScore = { values: Object.fromEntries(Object.entries(s.values).filter(([, v]) => v !== undefined)) };
  if (text(s.level)) out.level = text(s.level);
  if (text(s.reason)) out.reason = text(s.reason);
  return out;
}

export function addItem(project: Project, id: string, draft: ItemDraft, actor: Actor): { project: Project; itemId: string } {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const itemId = nextId(next, "RA", id, a.items.map((i) => i.id));
  const item: RiskItem = {
    id: itemId,
    failureMode: text(draft.failureMode),
    initial: { values: {} },
    gapIds: [...new Set(draft.gapIds ?? [])],
    samplingPointIds: [...new Set(draft.samplingPointIds ?? [])],
    sourceIds: [...new Set(draft.sourceIds ?? [])],
    createdAt: actor.at,
    updatedAt: actor.at,
  };
  if (draft.stepId) item.stepId = draft.stepId;
  for (const k of TEXT_FIELDS) if (text(draft[k])) item[k] = text(draft[k]);
  item.origin = draft.origin ?? { kind: "free" };
  a.items.push(item);
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_item_add", path: `risk.${id}.${itemId}`, detail: `Item ${itemId} added to ${id}${item.failureMode ? `: ${item.failureMode}` : ""}${item.origin?.kind === "gap" ? " (from a gap)" : item.origin?.kind === "catalog" ? " (from a suggestion)" : ""}`, after: item });
  return { project: next, itemId };
}

export function updateItem(project: Project, id: string, itemId: string, patch: ItemPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const item = itemOf(a, itemId);
  const before = structuredClone(item);
  if ("failureMode" in patch) item.failureMode = text(patch.failureMode);
  for (const k of TEXT_FIELDS) {
    if (!(k in patch)) continue;
    if (text(patch[k])) item[k] = text(patch[k]);
    else delete item[k];
  }
  if ("stepId" in patch) {
    if (patch.stepId) item.stepId = patch.stepId;
    else delete item.stepId;
  }
  if (patch.initial) item.initial = cleanScore(patch.initial);
  if ("residual" in patch) {
    // Residual risk is OPTIONAL: nothing entered means no residual at all, not a residual of "not scored".
    if (patch.residual && !scoreIsEmpty(patch.residual)) item.residual = cleanScore(patch.residual);
    else delete item.residual;
  }
  for (const k of ["gapIds", "samplingPointIds", "sourceIds"] as const) if (patch[k]) item[k] = [...new Set(patch[k])];
  assertValid(a);
  if (JSON.stringify({ ...before, updatedAt: 0 }) === JSON.stringify({ ...item, updatedAt: 0 })) return project;
  item.updatedAt = actor.at;
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_item_update", path: `risk.${id}.${itemId}`, detail: `Item ${itemId} of ${id} edited`, before, after: structuredClone(item) });
  return next;
}

export function removeItem(project: Project, id: string, itemId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const item = itemOf(a, itemId);
  const actions = a.actions.filter((x) => x.itemId === itemId);
  a.items = a.items.filter((i) => i.id !== itemId);
  a.actions = a.actions.filter((x) => x.itemId !== itemId);
  assertValid(a);
  a.updatedAt = actor.at;
  // The item and its actions are kept whole in the log.
  log(next, actor, { action: "risk_item_remove", path: `risk.${id}.${itemId}`, detail: `Item ${itemId} removed from ${id}${item.failureMode ? `: ${item.failureMode}` : ""}${actions.length ? ` (with ${actions.length} action${actions.length === 1 ? "" : "s"})` : ""}`, before: { item, actions } });
  return next;
}

// ------------------------------------------------------------------ actions

export interface ActionDraft {
  itemId: string;
  text: string;
  owner?: string;
  due?: string;
  status?: RiskActionStatus;
}
export type ActionPatch = Partial<Pick<RiskAction, "text" | "owner" | "due" | "status">>;

export function addAction(project: Project, id: string, draft: ActionDraft, actor: Actor): { project: Project; actionId: string } {
  if (!text(draft.text)) throw new RiskError("The action needs a description");
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  itemOf(a, draft.itemId);
  const actionId = nextId(next, "AC", id, a.actions.map((x) => x.id));
  const action: RiskAction = { id: actionId, itemId: draft.itemId, text: text(draft.text), status: draft.status ?? "open" };
  if (text(draft.owner)) action.owner = text(draft.owner);
  if (text(draft.due)) action.due = text(draft.due);
  a.actions.push(action);
  assertValid(a);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_action_add", path: `risk.${id}.${actionId}`, detail: `Action ${actionId} added to ${draft.itemId} of ${id}`, after: action });
  return { project: next, actionId };
}

export function updateAction(project: Project, id: string, actionId: string, patch: ActionPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const action = a.actions.find((x) => x.id === actionId);
  if (!action) throw new RiskError(`Action ${actionId} is not in ${id}`);
  const before = structuredClone(action);
  if ("text" in patch) {
    if (!text(patch.text)) throw new RiskError("The action needs a description");
    action.text = text(patch.text);
  }
  for (const k of ["owner", "due"] as const) {
    if (!(k in patch)) continue;
    if (text(patch[k])) action[k] = text(patch[k]);
    else delete action[k];
  }
  if (patch.status) action.status = patch.status;
  assertValid(a);
  if (JSON.stringify(before) === JSON.stringify(action)) return project;
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_action_update", path: `risk.${id}.${actionId}`, detail: `Action ${actionId} of ${id} edited`, before, after: structuredClone(action) });
  return next;
}

export function removeAction(project: Project, id: string, actionId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const a = assessmentOf(next, id);
  const action = a.actions.find((x) => x.id === actionId);
  if (!action) throw new RiskError(`Action ${actionId} is not in ${id}`);
  a.actions = a.actions.filter((x) => x.id !== actionId);
  a.updatedAt = actor.at;
  log(next, actor, { action: "risk_action_remove", path: `risk.${id}.${actionId}`, detail: `Action ${actionId} removed from ${id}`, before: action });
  return next;
}

// ------------------------------------------------------------------ reading

export interface ItemEvaluation {
  initial: RiskResult;
  /** Absent when the person entered no residual score (residual risk is optional). */
  residual?: RiskResult;
}

/** Scores an item with the assessment's method. Without a method nothing is scored. */
export function evaluateItem(a: RiskAssessment, item: RiskItem): ItemEvaluation {
  const none: RiskResult = { scored: false, working: [], problems: ["No method chosen yet"] };
  if (!a.config) return { initial: none, ...(item.residual ? { residual: none } : {}) };
  return { initial: scoreItem(a.config, item.initial), ...(item.residual ? { residual: scoreItem(a.config, item.residual) } : {}) };
}

export const openActions = (a: RiskAssessment, itemId?: string): RiskAction[] => a.actions.filter((x) => (itemId === undefined || x.itemId === itemId) && (x.status === "open" || x.status === "in_progress"));

/** True if any item carries a residual score: the output then shows the residual columns. */
export const hasResidual = (a: RiskAssessment): boolean => a.items.some((i) => i.residual !== undefined);

export type RiskOpenKind = "method" | "method-problem" | "not-scored" | "score-problem" | "no-failure-mode" | "dangling-link" | "no-items";
export interface RiskOpenItem {
  kind: RiskOpenKind;
  itemId?: string;
  text: string;
}

/** Qualified id of a sampling point inside the risk data: "SPL-001.SP-003" (point ids are only unique inside a plan). */
export const pointRef = (planId: string, pointId: string): string => `${planId}.${pointId}`;
export function splitPointRef(ref: string): { planId: string; pointId: string } | undefined {
  const m = /^(SPL-\d+)\.(SP-\d+)$/.exec(ref);
  return m ? { planId: m[1]!, pointId: m[2]! } : undefined;
}
/** Does the cited sampling point still exist? */
export function samplingPointExists(project: Project, ref: string): boolean {
  const p = splitPointRef(ref);
  return !!p && project.sampling.plans.some((pl) => pl.id === p.planId && pl.points.some((pt) => pt.id === p.pointId));
}

/**
 * The open items of an assessment: what is missing, said plainly. They are listed in the document as open, not as decided, and
 * counted for the download warning. Each is something the person can fix; none is a judgement about the risk itself.
 */
export function riskOpenItems(project: Project, a: RiskAssessment): RiskOpenItem[] {
  const out: RiskOpenItem[] = [];
  if (!a.config) {
    out.push({ kind: "method", text: "No risk method has been chosen" });
    if (a.items.length) out.push({ kind: "not-scored", text: `${a.items.length} item${a.items.length === 1 ? " is" : "s are"} not scored because there is no method` });
  } else {
    for (const p of configProblems(a.config)) out.push({ kind: "method-problem", text: `Method: ${p}` });
  }
  if (!a.items.length) out.push({ kind: "no-items", text: "No items yet" });
  const sourceIds = new Set(project.sources.map((s) => s.id));
  for (const i of a.items) {
    if (!i.failureMode.trim()) out.push({ kind: "no-failure-mode", itemId: i.id, text: `${i.id}: the failure mode is not described yet` });
    if (a.config) {
      const e = evaluateItem(a, i);
      const who = (r: "initial" | "residual") => (r === "initial" ? `${i.id}` : `${i.id} (residual)`);
      for (const [which, r] of [["initial", e.initial], ["residual", e.residual]] as const) {
        if (!r) continue;
        if (!r.scored) out.push({ kind: "not-scored", itemId: i.id, text: `${who(which)} is not scored: ${r.problems.join("; ")}` });
        else for (const p of r.problems) out.push({ kind: "score-problem", itemId: i.id, text: `${who(which)}: ${p}` });
      }
    }
    for (const ref of i.samplingPointIds) if (!samplingPointExists(project, ref)) out.push({ kind: "dangling-link", itemId: i.id, text: `${i.id} cites sampling point ${ref}, which no longer exists` });
    for (const sid of i.sourceIds) if (!sourceIds.has(sid)) out.push({ kind: "dangling-link", itemId: i.id, text: `${i.id} cites source ${sid}, which is not in the source register` });
  }
  return out;
}

// ------------------------------------------------------------------ traceability

export interface RiskRef {
  assessmentId: string;
  itemId: string;
}

/** The risk items that were raised from, or cite, a gap (by its display id, e.g. G-003). Both directions of the link are read from the items. */
export function risksForGap(project: Project, gapId: string): RiskRef[] {
  return project.risk.assessments.flatMap((a) => a.items.filter((i) => i.gapIds.includes(gapId)).map((i) => ({ assessmentId: a.id, itemId: i.id })));
}

/** The risk items that cite a sampling point as detection or control evidence. */
export function risksForSamplingPoint(project: Project, planId: string, pointId: string): RiskRef[] {
  const ref = pointRef(planId, pointId);
  return project.risk.assessments.flatMap((a) => a.items.filter((i) => i.samplingPointIds.includes(ref)).map((i) => ({ assessmentId: a.id, itemId: i.id })));
}
