import {
  FACILITY_UNITS,
  FACILITY_UNIT_LABEL,
  facilityAreaSchema,
  facilityAreas,
  facilityStateSchema,
  facilityUnitOf,
  stableStringify,
  type Actor,
  type ChangeEvent,
  type FacilityArea,
  type FacilityGrade,
  type FacilityUnit,
  type Project,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { ExampleLayout } from "./interview-map-content";

/**
 * Edits of the facility areas (M14, schema 1.33.0). The areas only help a person find questions by room: they write nothing into the TRD,
 * the plan, the risk assessment or a batch record, and removing one never touches an answer. Every edit returns a new project and adds ONE
 * change-log event with the old content kept (GMP: a reviewer can see what the site layout said before it was changed, and by whom).
 *
 * Nothing here decides a value. A new area has no grade and no steps. An example layout is copied in only by `useFacilityExample`, marked
 * "from the example, please check" until the user edits or confirms each area. Saving the same value again changes nothing and logs
 * nothing. The only refusals are a value that cannot be stored (an empty name, a step that does not exist, a cycle) and a removal without
 * a reason.
 */

export class FacilityError extends Error {}

const pad = (n: number) => String(n).padStart(2, "0");
const text = (v: string | undefined | null) => (v ?? "").trim();

/** The process steps an area can hold: the catalog's unit operations and the project's own custom ones. */
export function facilityStepKeys(content: Pick<ContentBundle, "catalog">, project: Pick<Project, "custom">): string[] {
  return [...content.catalog.unitOperations.map((u) => u.key), ...(project.custom?.unitOperations ?? []).map((u) => u.key)];
}

/**
 * Next area id. Ids are never reused: an id that only survives in the change log still counts as taken, so a removed area's number cannot
 * come back and make an old log entry point at a different room. Change-log path: facility.AR-01
 */
function nextAreaId(project: Project, alsoTaken: readonly string[] = []): string {
  let max = 0;
  const take = (id: string | undefined) => {
    const m = /^AR-(\d+)$/.exec(id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const u of FACILITY_UNITS) facilityAreas(project, u).forEach((a) => take(a.id));
  alsoTaken.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] === "facility") take(parts[1]);
  }
  return `AR-${pad(max + 1)}`;
}

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function listOf(project: Project, unit: FacilityUnit): FacilityArea[] {
  project.facility ??= {};
  project.facility[unit] ??= { areas: [] };
  return project.facility[unit]!.areas;
}

export function facilityAreaOf(project: Project, id: string): FacilityArea {
  for (const u of FACILITY_UNITS) {
    const a = facilityAreas(project, u).find((x) => x.id === id);
    if (a) return a;
  }
  throw new FacilityError(`Area ${id} does not exist`);
}

/** The whole facility part must still satisfy its schema (no cycle, no step twice in one area, a parent in the same unit). */
function assertValid(project: Project): void {
  const r = facilityStateSchema.safeParse(project.facility ?? {});
  if (!r.success) throw new FacilityError(r.error.issues[0]?.message ?? "The facility areas are not valid");
}

function checkSteps(content: Pick<ContentBundle, "catalog">, project: Project, keys: readonly string[]): string[] {
  const known = new Set(facilityStepKeys(content, project));
  const out: string[] = [];
  for (const k of keys) {
    if (!known.has(k)) throw new FacilityError(`${k} is not a process step of this project`);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

const describe = (a: FacilityArea) => `${a.id} “${a.name}”`;

// ------------------------------------------------------------------ add

export interface FacilityAreaInput {
  name: string;
  grade?: FacilityGrade;
  insideAreaId?: string;
  stepKeys?: string[];
  note?: string;
}

/** Adds an area at the end of a unit's list. No grade, no steps and no parent unless the person gave them. */
export function addFacilityArea(content: Pick<ContentBundle, "catalog">, project: Project, unit: FacilityUnit, input: FacilityAreaInput, actor: Actor): { project: Project; areaId: string } {
  const name = text(input.name);
  if (!name) throw new FacilityError("The area needs a name");
  const next = structuredClone(project);
  const stepKeys = checkSteps(content, next, input.stepKeys ?? []);
  const id = nextAreaId(next);
  const a: FacilityArea = { id, name, stepKeys, createdAt: actor.at, updatedAt: actor.at };
  if (input.grade) a.grade = input.grade;
  if (input.insideAreaId) a.insideAreaId = input.insideAreaId;
  if (text(input.note)) a.note = text(input.note);
  facilityAreaSchema.parse(a);
  listOf(next, unit).push(a);
  assertValid(next);
  log(next, actor, { action: "facility_area_add", path: `facility.${id}`, detail: `Added the area ${describe(a)} to the ${FACILITY_UNIT_LABEL[unit].toLowerCase()}`, after: { unit, ...a } });
  return { project: next, areaId: id };
}

// ------------------------------------------------------------------ update

export interface FacilityAreaPatch {
  name?: string;
  /** null clears the grade back to "Not stated". */
  grade?: FacilityGrade | null;
  /** null takes the area out of its parent. */
  insideAreaId?: string | null;
  /** null clears the note. */
  note?: string | null;
}

/**
 * Renames, grades, nests or notes an area. An edit also ends the "from the example, please check" mark (the person has looked at it).
 * An edit that changes nothing is not logged.
 */
export function updateFacilityArea(project: Project, areaId: string, patch: FacilityAreaPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const a = facilityAreaOf(next, areaId);
  const before = structuredClone(a);
  if (patch.name !== undefined) {
    const name = text(patch.name);
    if (!name) throw new FacilityError("The area needs a name");
    a.name = name;
  }
  if (patch.grade !== undefined) {
    if (patch.grade === null) delete a.grade;
    else a.grade = patch.grade;
  }
  if (patch.insideAreaId !== undefined) {
    if (patch.insideAreaId === null) delete a.insideAreaId;
    else {
      if (patch.insideAreaId === a.id) throw new FacilityError("An area cannot sit inside itself");
      if (facilityUnitOf(next, patch.insideAreaId) !== facilityUnitOf(next, a.id)) throw new FacilityError("An area can only sit inside an area of the same unit");
      a.insideAreaId = patch.insideAreaId;
    }
  }
  if (patch.note !== undefined) {
    if (patch.note === null || !text(patch.note)) delete a.note;
    else a.note = text(patch.note);
  }
  const changed = stableStringify({ ...a, updatedAt: "", fromExample: undefined }) !== stableStringify({ ...before, updatedAt: "", fromExample: undefined });
  if (!changed) return project;
  delete a.fromExample;
  a.updatedAt = actor.at;
  assertValid(next);
  log(next, actor, { action: "facility_area_update", path: `facility.${areaId}`, detail: `Edited the area ${describe(a)}`, before, after: structuredClone(a) });
  return next;
}

export const renameFacilityArea = (project: Project, areaId: string, name: string, actor: Actor): Project => updateFacilityArea(project, areaId, { name }, actor);
export const setFacilityAreaGrade = (project: Project, areaId: string, grade: FacilityGrade | null, actor: Actor): Project => updateFacilityArea(project, areaId, { grade }, actor);
/** Puts an area inside another area of the same unit (an isolator in a filling room), or takes it out with null. */
export const nestFacilityArea = (project: Project, areaId: string, insideAreaId: string | null, actor: Actor): Project => updateFacilityArea(project, areaId, { insideAreaId }, actor);

// ------------------------------------------------------------------ place steps

/**
 * Sets the process steps done in an area. A step can be in SEVERAL areas (rooms are often interchangeable for a step), so placing a step
 * here never takes it out of another area. The order the person gave is kept. Questions are counted once however many areas a step is in.
 */
export function setFacilityAreaSteps(content: Pick<ContentBundle, "catalog">, project: Project, areaId: string, stepKeys: readonly string[], actor: Actor): Project {
  const next = structuredClone(project);
  const a = facilityAreaOf(next, areaId);
  const keys = checkSteps(content, next, stepKeys);
  if (stableStringify(keys) === stableStringify(a.stepKeys)) return project;
  const before = { stepKeys: [...a.stepKeys] };
  a.stepKeys = keys;
  delete a.fromExample;
  a.updatedAt = actor.at;
  assertValid(next);
  log(next, actor, { action: "facility_area_steps", path: `facility.${areaId}`, detail: `Set the steps done in the area ${describe(a)} (${keys.length})`, before, after: { stepKeys: [...keys] } });
  return next;
}

// ------------------------------------------------------------------ remove

/**
 * Removes an area, with a reason that is kept in the change log. The steps it held go back to "Not placed in an area yet" (they are still in
 * any other area they were placed in) and an area that sat inside it becomes a top-level area. No answer is touched.
 */
export function removeFacilityArea(project: Project, areaId: string, reason: string | undefined, actor: Actor): Project {
  const why = text(reason);
  if (!why) throw new FacilityError("Say why you are removing the area. The reason is kept in the change log.");
  const next = structuredClone(project);
  const unit = facilityUnitOf(next, areaId);
  if (!unit) throw new FacilityError(`Area ${areaId} does not exist`);
  const list = listOf(next, unit);
  const gone = list.find((x) => x.id === areaId)!;
  const inside = list.filter((x) => x.insideAreaId === areaId);
  for (const c of inside) {
    delete c.insideAreaId;
    c.updatedAt = actor.at;
  }
  list.splice(list.indexOf(gone), 1);
  assertValid(next);
  log(next, actor, {
    action: "facility_area_remove",
    path: `facility.${areaId}`,
    detail: `Removed the area ${describe(gone)} from the ${FACILITY_UNIT_LABEL[unit].toLowerCase()}: ${why}`,
    before: { unit, ...gone, ...(inside.length ? { areasInsideIt: inside.map((c) => c.id) } : {}) },
    after: { reason: why },
  });
  return next;
}

// ------------------------------------------------------------------ example layout

/**
 * Copies the example layout into one unit as the person's own draft. Every area is marked "from the example, please check", has no grade
 * (the example never states one) and keeps the example's steps and nesting. Only offered while the unit has no areas: copying an example
 * on top of a person's own list would mix two layouts.
 */
export function useFacilityExample(content: Pick<ContentBundle, "catalog">, project: Project, unit: FacilityUnit, example: ExampleLayout, actor: Actor): Project {
  const next = structuredClone(project);
  if (facilityAreas(next, unit).length > 0) throw new FacilityError("The example can only be used while this unit has no areas yet.");
  const idByName = new Map<string, string>();
  const made: FacilityArea[] = [];
  for (const ex of example.areas) {
    const id = nextAreaId(next, made.map((m) => m.id));
    idByName.set(ex.name, id);
    made.push({ id, name: ex.name, stepKeys: checkSteps(content, next, ex.steps), fromExample: true, createdAt: actor.at, updatedAt: actor.at });
  }
  example.areas.forEach((ex, n) => {
    if (ex.inside) {
      const parent = idByName.get(ex.inside);
      if (!parent) throw new FacilityError(`The example puts “${ex.name}” inside “${ex.inside}”, which it does not list`);
      made[n]!.insideAreaId = parent;
    }
  });
  listOf(next, unit).push(...made);
  assertValid(next);
  log(next, actor, {
    action: "facility_example_use",
    path: `facility.${made[0]?.id ?? "example"}`,
    detail: `Used the example layout for the ${FACILITY_UNIT_LABEL[unit].toLowerCase()} (${made.length} areas, to be checked)`,
    after: { unit, areas: made.map((m) => ({ id: m.id, name: m.name })) },
  });
  return next;
}

/** The person has checked an area that came from the example. Not logged when the area did not come from the example. */
export function confirmFacilityExampleArea(project: Project, areaId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const a = facilityAreaOf(next, areaId);
  if (!a.fromExample) return project;
  delete a.fromExample;
  a.updatedAt = actor.at;
  log(next, actor, { action: "facility_example_confirm", path: `facility.${areaId}`, detail: `Checked the area ${describe(a)} from the example`, before: { fromExample: true }, after: { fromExample: false } });
  return next;
}
