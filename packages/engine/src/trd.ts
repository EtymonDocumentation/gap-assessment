import {
  pulledFromAnswer,
  stableStringify,
  trdDocumentSchema,
  trdLimitsSchema,
  TRD_DETAIL_KEYS,
  type Actor,
  type ChangeEvent,
  type Project,
  type SeedCollection,
  type SeedField,
  type SeedItem,
  type SeedStatus,
  type SeedUnitOperation,
  type TrdSeed,
  type TrdApproval,
  type TrdDocument,
  type TrdField,
  type TrdItem,
  type TrdLimits,
  type TrdOverride,
  type TrdPulled,
  type TrdRange,
  type TrdSetPoint,
  type TrdStep,
} from "@gap/process-model";
import { checkLimits, rangeText, setPointText, type LimitFinding } from "./trd-check";
import { seedValueText } from "./trd-outline";
import { trdSeedContentFingerprint } from "./trd-seed";
import type { StepDraft } from "./sampling";

/**
 * The editable TRD (technology transfer document) record. Every edit returns a new project and adds one change-log event with the
 * old value kept (GMP: a reviewer must be able to see what a TRD said before it was changed, and by whom).
 *
 * Rules these functions keep (see process-model trd.ts for the shapes):
 *  - NO DEFAULTS. Nothing is filled in that the project, the seed or the user did not state. A field with no value stays visible
 *    as "not established" and is an open item.
 *  - An override never destroys the project value: both are kept, and every override change is logged with before and after.
 *  - An update from the project (or a newer seed) never replaces an overridden field on its own; the user chooses per row.
 *  - The RU value and the SU reference stay apart. This module never reads `reference.su` as the TRD value.
 *  - No regulatory filing category is stated anywhere.
 */

export class TrdError extends Error {}

export const NO_REASON_RECORDED = "No reason recorded";

const pad = (n: number, w = 3) => String(n).padStart(w, "0");
const text = (v: string | undefined) => (v ?? "").trim();

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

/** Next id of a kind. Ids are never reused: an id that survives only in the change log still counts as taken. */
function nextId(project: Project, prefix: "TRD" | "TS", docId: string | undefined, existing: readonly string[]): string {
  let max = 0;
  const take = (id: string) => {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  existing.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] !== "trd") continue;
    if (prefix === "TRD") take(parts[1] ?? "");
    else if (parts[1] === docId) take(parts[2] ?? "");
  }
  return `${prefix}-${pad(max + 1, prefix === "TS" ? 2 : 3)}`;
}

function docOf(project: Project, id: string): TrdDocument {
  const d = project.trd.documents.find((x) => x.id === id);
  if (!d) throw new TrdError(`TRD ${id} does not exist`);
  return d;
}

function stepOf(d: TrdDocument, id: string): TrdStep {
  const s = d.steps.find((x) => x.id === id);
  if (!s) throw new TrdError(`Step ${id} is not in ${d.id}`);
  return s;
}

export interface ItemRef {
  stepId: string;
  collection: SeedCollection;
  key: string;
}

function itemOf(d: TrdDocument, ref: ItemRef): { step: TrdStep; item: TrdItem } {
  const step = stepOf(d, ref.stepId);
  const item = step.items.find((i) => i.collection === ref.collection && i.key === ref.key);
  if (!item) throw new TrdError(`${ref.collection}.${ref.key} is not in ${ref.stepId} of ${d.id}`);
  return { step, item };
}

function assertValid(d: TrdDocument): void {
  const r = trdDocumentSchema.safeParse(d);
  if (!r.success) throw new TrdError(r.error.issues[0]?.message ?? "The TRD is not valid");
}

const itemPath = (docId: string, ref: ItemRef) => `trd.${docId}.${ref.stepId}.${ref.collection}.${ref.key}`;

// ------------------------------------------------------------------ values

export interface EffectiveValue {
  status: SeedStatus;
  /** The TRD value as a reader sees it: unknown stays visible, a guess is labelled. */
  text: string;
  provisional: boolean;
  overridden: boolean;
  /** The project value (pulled) as text, when there is one. */
  pulledText?: string;
  reason?: string;
  by?: string;
  at?: string;
}

/** What the override says, as a seed answer, so the same wording rules apply to typed and pulled values. */
function overrideAnswer(o: TrdOverride) {
  const shown = [text(o.display), text(o.unit)].filter(Boolean).join(" ");
  return {
    status: o.status,
    ...(shown ? { display: shown } : {}),
    ...(o.status === "tbd" && shown ? { provisional: true as const } : {}),
  };
}

/** The TRD value of a field: the override if there is one, else the value that came in, else "not established". */
export function effectiveField(f: TrdField): EffectiveValue {
  const pulledText = f.pulled ? seedValueText(f.pulled) : undefined;
  if (f.override) {
    const a = overrideAnswer(f.override);
    return { status: a.status, text: seedValueText(a), provisional: Boolean("provisional" in a && a.provisional), overridden: true, ...(pulledText !== undefined ? { pulledText } : {}), reason: f.override.reason?.trim() || NO_REASON_RECORDED, by: f.override.by, at: f.override.at };
  }
  if (f.pulled) return { status: f.pulled.status, text: pulledText!, provisional: Boolean(f.pulled.provisional), overridden: false, pulledText };
  return { status: "not_established", text: seedValueText({ status: "not_established" }), provisional: false, overridden: false };
}

/** A field counts as open while it is unknown or still to be determined. "Not applicable" is an answer. */
export const isOpenStatus = (s: SeedStatus) => s === "not_established" || s === "tbd";

/** Source ids behind a field: those that came in with it. An override has no source of its own (the reason says why). */
export function fieldSourceIds(f: TrdField): string[] {
  return f.pulled?.sourceIds ?? [];
}

// ------------------------------------------------------------------ building from a seed

const CLASS_TEXT: Record<string, string> = { CPP: "CPP", KPP: "KPP", non_critical: "Non-critical" };

function pulledField(f: SeedField): TrdField {
  const { field, label, ...rest } = f;
  return { key: field, label, pulled: rest as TrdPulled };
}

function classificationField(item: SeedItem): TrdField | undefined {
  if (!item.classification && !item.reference?.suClassification) return undefined;
  const su = item.reference?.suClassification;
  const pulled: TrdPulled = item.classification
    ? { status: "established", value: item.classification, display: CLASS_TEXT[item.classification] ?? item.classification, sourceIds: [] }
    : { status: "not_established", sourceIds: [] };
  if (su) pulled.reference = { su: { status: "established", value: su, display: CLASS_TEXT[su] ?? su }, gapIds: [] };
  return { key: "classification", label: "Classification", pulled };
}

function pulledItem(item: SeedItem): TrdItem {
  const fields: TrdField[] = [];
  if (item.collection === "param") {
    const c = classificationField(item);
    if (c) fields.push(c);
  }
  for (const f of item.fields) fields.push(pulledField(f));
  return { collection: item.collection, key: item.key, label: item.label, custom: item.custom, fields };
}

function pulledStep(id: string, uo: SeedUnitOperation | undefined, inc: TrdSeed["scope"]["included"][number]): TrdStep {
  return {
    id,
    key: inc.key,
    label: inc.label,
    custom: inc.custom,
    sequence: inc.sequence,
    ...(inc.stageGroup ? { stageGroup: inc.stageGroup } : {}),
    fields: (uo?.fields ?? []).map(pulledField),
    items: (uo?.items ?? []).map(pulledItem),
  };
}

function detailFields(seed: TrdSeed | undefined): TrdField[] {
  const m = seed?.meta;
  const answers: Record<string, TrdPulled | undefined> = m
    ? {
        program: pulledFromAnswer(m.product.program),
        modality: pulledFromAnswer(m.product.modality),
        dosageForm: pulledFromAnswer(m.product.dosageForm),
        presentation: pulledFromAnswer(m.product.presentation),
        site: pulledFromAnswer(m.receivingSite.name),
        line: pulledFromAnswer(m.receivingSite.line),
        programStage: pulledFromAnswer(m.receivingSite.programStage),
      }
    : {};
  return TRD_DETAIL_KEYS.map(([key, label]) => ({ key, label, ...(answers[key] ? { pulled: answers[key] } : {}) }));
}

/**
 * The TRD parts a seed gives: details and steps (with a placeholder id, the caller assigns real ones). Used to start a TRD and to
 * compare with a newer seed, so both read the seed the same way.
 */
export function seedToTrdParts(seed: TrdSeed): { details: TrdField[]; steps: TrdStep[] } {
  return {
    details: detailFields(seed),
    steps: [...seed.scope.included].sort((a, b) => a.sequence - b.sequence).map((inc) => pulledStep("TS-00", seed.unitOperations.find((u) => u.key === inc.key), inc)),
  };
}

function originSeed(seed: TrdSeed) {
  return {
    formatVersion: seed.meta.formatVersion,
    exportedAt: seed.meta.exportedAt,
    projectId: seed.meta.project.id,
    projectName: seed.meta.project.name,
    gapFingerprint: seed.meta.gapAssessment.documentFingerprint,
    fingerprint: trdSeedContentFingerprint(seed),
  };
}

export type TrdStart = { kind: "project"; seed: TrdSeed } | { kind: "seed-import"; seed: TrdSeed } | { kind: "blank"; steps?: StepDraft[] };

export function createTrd(project: Project, input: { title: string; docRef?: string; start: TrdStart }, actor: Actor): { project: Project; trdId: string } {
  const title = text(input.title);
  if (!title) throw new TrdError("The TRD needs a title");
  const next = structuredClone(project);
  const id = nextId(next, "TRD", undefined, next.trd.documents.map((d) => d.id));
  const start = input.start;
  const taken: string[] = [];
  const stepId = () => {
    const sid = nextId(next, "TS", id, taken);
    taken.push(sid);
    return sid;
  };
  const doc: TrdDocument = {
    id,
    title,
    status: "draft",
    origin: { kind: start.kind, importedAt: actor.at },
    details: detailFields(start.kind === "blank" ? undefined : start.seed),
    steps: [],
    createdAt: actor.at,
    updatedAt: actor.at,
  };
  if (text(input.docRef)) doc.docRef = text(input.docRef);
  if (start.kind === "blank") {
    for (const d of start.steps ?? []) doc.steps.push(enteredStep(stepId(), d));
  } else {
    const seed = start.seed;
    doc.origin.seed = originSeed(seed);
    doc.origin.seedSources = seed.sources;
    for (const s of seedToTrdParts(seed).steps) doc.steps.push({ ...s, id: stepId() });
  }
  assertValid(doc);
  next.trd.documents.push(doc);
  const from = start.kind === "project" ? "this project" : start.kind === "seed-import" ? `a TRD seed (${start.seed.meta.project.name})` : "blank";
  log(next, actor, { action: "trd_add", path: `trd.${id}`, detail: `TRD ${id}: ${title}, started from ${from} (${doc.steps.length} process steps)`, after: { id, title, origin: doc.origin.kind, steps: doc.steps.map((s) => s.label) } });
  return { project: next, trdId: id };
}

function enteredStep(id: string, d: StepDraft): TrdStep {
  const label = text(d.label);
  if (!label) throw new TrdError("The step needs a name");
  return { id, ...(d.unitOp ? { key: d.unitOp } : {}), label, custom: !d.unitOp, entered: true, ...(text(d.notes) ? { description: text(d.notes) } : {}), fields: [], items: [] };
}

// ------------------------------------------------------------------ the document

export type TrdPatch = { title?: string; docRef?: string; version?: string; purpose?: string; scopeNote?: string; approvals?: TrdApproval[] };

export function updateTrd(project: Project, id: string, patch: TrdPatch, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of ["title", "docRef", "version", "purpose", "scopeNote"] as const) {
    if (!(k in patch)) continue;
    const v = text(patch[k]);
    if (k === "title" && !v) throw new TrdError("The TRD needs a title");
    if (text(d[k]) === v) continue;
    before[k] = d[k] ?? "";
    after[k] = v;
    if (v) d[k] = v;
    else delete d[k];
  }
  if ("approvals" in patch) {
    const list = (patch.approvals ?? []).map((x) => ({ role: text(x.role), ...(text(x.name) ? { name: text(x.name) } : {}), ...(text(x.date) ? { date: text(x.date) } : {}) })).filter((x) => x.role);
    if (JSON.stringify(list) !== JSON.stringify(d.approvals ?? [])) {
      before.approvals = d.approvals ?? [];
      after.approvals = list;
      if (list.length) d.approvals = list;
      else delete d.approvals;
    }
  }
  if (!Object.keys(after).length) return project;
  assertValid(d);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_update", path: `trd.${id}`, detail: `TRD ${id} edited`, before, after });
  return next;
}

export function deleteTrd(project: Project, id: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  next.trd.documents = next.trd.documents.filter((x) => x.id !== id);
  // The whole TRD is kept in the log, so removing it never loses what it said.
  log(next, actor, { action: "trd_remove", path: `trd.${id}`, detail: `TRD ${id} removed: ${d.title}`, before: d });
  return next;
}

// ------------------------------------------------------------------ details

/** Sets or clears the override of a product or site detail (or of any field, see setOverride). */
export type FieldAddr = { part: "details"; field: string } | { part: "step"; stepId: string; field: string } | ({ part: "item"; field: string } & ItemRef);

function fieldList(d: TrdDocument, addr: FieldAddr): { list: TrdField[]; path: string; where: string } {
  if (addr.part === "details") return { list: d.details, path: `trd.${d.id}.details.${addr.field}`, where: "details" };
  if (addr.part === "step") {
    const s = stepOf(d, addr.stepId);
    return { list: s.fields, path: `trd.${d.id}.${s.id}.${addr.field}`, where: s.label };
  }
  const { step, item } = itemOf(d, addr);
  return { list: item.fields, path: `${itemPath(d.id, addr)}.${addr.field}`, where: `${step.label}, ${item.label}` };
}

export interface OverrideInput {
  status: SeedStatus;
  display?: string;
  unit?: string;
  reason?: string;
}

/**
 * Enters a value over a field. The project value stays (as `pulled`) next to it. The reason is optional: without one the TRD
 * shows "No reason recorded", the same pattern as the scope step. Entering the same thing again changes nothing.
 */
export function setOverride(project: Project, id: string, addr: FieldAddr, input: OverrideInput, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const { list, path, where } = fieldList(d, addr);
  const f = list.find((x) => x.key === addr.field);
  if (!f) throw new TrdError(`Field ${addr.field} is not in ${where}`);
  const o: TrdOverride = {
    status: input.status,
    ...(text(input.display) ? { display: text(input.display) } : {}),
    ...(text(input.unit) ? { unit: text(input.unit) } : {}),
    ...(text(input.reason) ? { reason: text(input.reason) } : {}),
    by: actor.name,
    at: actor.at,
  };
  const same = (a?: TrdOverride) => a && stableStringify({ ...a, by: "", at: "" }) === stableStringify({ ...o, by: "", at: "" });
  if (same(f.override)) return project;
  const before = f.override ?? null;
  f.override = o;
  assertValid(d);
  d.updatedAt = actor.at;
  const was = effectiveFieldWithout(f);
  log(next, actor, {
    action: "trd_override_set",
    path,
    detail: `${where}, ${f.label}: ${f.pulled ? `overridden (project: ${was})` : "value entered"} -> ${effectiveField(f).text}${o.reason ? ` (reason: ${o.reason})` : `. ${NO_REASON_RECORDED}`}`,
    before,
    after: o,
  });
  return next;
}

/** The value the field would have without its override (for the log and the "project" side). */
function effectiveFieldWithout(f: TrdField): string {
  return effectiveField({ ...f, override: undefined }).text;
}

/** Removes the override: the project value is the TRD value again. The removed override is kept in the log. */
export function clearOverride(project: Project, id: string, addr: FieldAddr, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const { list, path, where } = fieldList(d, addr);
  const f = list.find((x) => x.key === addr.field);
  if (!f?.override) return project;
  const before = f.override;
  delete f.override;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_override_clear", path, detail: `${where}, ${f.label}: override removed; the TRD value is ${effectiveField(f).text}`, before, after: null });
  return next;
}

// ------------------------------------------------------------------ steps and items

export function addTrdStep(project: Project, id: string, draft: StepDraft, actor: Actor, index?: number): { project: Project; stepId: string } {
  const next = structuredClone(project);
  const d = docOf(next, id);
  if (draft.unitOp && d.steps.some((s) => s.key === draft.unitOp)) throw new TrdError(`${text(draft.label)} is already a step of this TRD`);
  const step = enteredStep(nextId(next, "TS", id, d.steps.map((s) => s.id)), draft);
  d.steps.splice(index === undefined ? d.steps.length : Math.max(0, Math.min(index, d.steps.length)), 0, step);
  assertValid(d);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_step_add", path: `trd.${id}.${step.id}`, detail: `Process step ${step.id} added to ${id}: ${step.label}`, after: step });
  return { project: next, stepId: step.id };
}

export function updateTrdStep(project: Project, id: string, stepId: string, patch: { label?: string; description?: string }, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const s = stepOf(d, stepId);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if ("label" in patch) {
    const v = text(patch.label);
    if (!v) throw new TrdError("The step needs a name");
    // A step that came from the project keeps the project's name: the name is the project's wording, not the user's.
    if (v !== s.label) {
      if (!s.entered && !s.custom) throw new TrdError("A step that came from the project keeps its name. Add the wording to the description.");
      before.label = s.label;
      after.label = v;
      s.label = v;
    }
  }
  if ("description" in patch) {
    const v = text(patch.description);
    if (v !== text(s.description)) {
      before.description = s.description ?? "";
      after.description = v;
      if (v) s.description = v;
      else delete s.description;
    }
  }
  if (!Object.keys(after).length) return project;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_step_update", path: `trd.${id}.${stepId}`, detail: `Step ${stepId} (${s.label}) edited`, before, after });
  return next;
}

export function removeTrdStep(project: Project, id: string, stepId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const s = stepOf(d, stepId);
  d.steps = d.steps.filter((x) => x.id !== stepId);
  d.updatedAt = actor.at;
  // The whole step with its items, overrides and limits is kept in the log.
  log(next, actor, { action: "trd_step_remove", path: `trd.${id}.${stepId}`, detail: `Step ${stepId} removed from ${id}: ${s.label}`, before: s });
  return next;
}

export function moveTrdStep(project: Project, id: string, stepId: string, delta: -1 | 1, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const i = d.steps.findIndex((s) => s.id === stepId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= d.steps.length) return project;
  const [s] = d.steps.splice(i, 1);
  d.steps.splice(j, 0, s!);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_step_move", path: `trd.${id}.${stepId}`, detail: `Step ${stepId} (${s!.label}) moved ${delta < 0 ? "up" : "down"}`, before: { position: i + 1 }, after: { position: j + 1 } });
  return next;
}

/** The fields a typed item starts with: a value (equipment, materials ...) or a classification (parameters). No value is entered. */
function enteredFields(collection: SeedCollection): TrdField[] {
  return collection === "param" ? [{ key: "classification", label: "Classification" }] : collection === "ipc" ? [] : [{ key: "value", label: "Description" }];
}

export function addTrdItem(project: Project, id: string, stepId: string, input: { collection: SeedCollection; label: string }, actor: Actor): { project: Project; ref: ItemRef } {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const s = stepOf(d, stepId);
  const label = text(input.label);
  if (!label) throw new TrdError("The item needs a name");
  let n = 1;
  while (s.items.some((i) => i.collection === input.collection && i.key === `x_trd_${n}`)) n += 1;
  const item: TrdItem = { collection: input.collection, key: `x_trd_${n}`, label, custom: true, entered: true, fields: enteredFields(input.collection) };
  s.items.push(item);
  assertValid(d);
  d.updatedAt = actor.at;
  const ref = { stepId, collection: input.collection, key: item.key };
  log(next, actor, { action: "trd_item_add", path: itemPath(id, ref), detail: `${s.label}: ${label} added to ${id}`, after: item });
  return { project: next, ref };
}

export function renameTrdItem(project: Project, id: string, ref: ItemRef, label: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const { item } = itemOf(d, ref);
  const v = text(label);
  if (!v) throw new TrdError("The item needs a name");
  if (!item.entered) throw new TrdError("An item that came from the project keeps its name.");
  if (v === item.label) return project;
  const before = item.label;
  item.label = v;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_item_update", path: itemPath(id, ref), detail: `Item renamed: ${before} -> ${v}`, before: { label: before }, after: { label: v } });
  return next;
}

export function removeTrdItem(project: Project, id: string, ref: ItemRef, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const { step, item } = itemOf(d, ref);
  step.items = step.items.filter((i) => i !== item);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_item_remove", path: itemPath(id, ref), detail: `${step.label}: ${item.label} removed from ${id}`, before: item });
  return next;
}

// ------------------------------------------------------------------ PAR / NOR / set point

const cleanRange = (r: TrdRange): TrdRange => {
  const out: TrdRange = { sourceIds: [...r.sourceIds] };
  if (r.min !== undefined) out.min = r.min;
  if (r.max !== undefined) out.max = r.max;
  if (text(r.unit)) out.unit = text(r.unit);
  if (r.locations && Object.keys(r.locations).length) out.locations = r.locations;
  if (text(r.basis)) out.basis = text(r.basis);
  if (r.provisional) out.provisional = true;
  if (text(r.note)) out.note = text(r.note);
  return out;
};

/** Sets the set point / NOR / PAR of a parameter (or IPC). Pass `undefined` for a part to remove it. The old limits stay in the log. */
export function setLimits(project: Project, id: string, ref: ItemRef, limits: TrdLimits, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, id);
  const { step, item } = itemOf(d, ref);
  if (item.collection !== "param" && item.collection !== "ipc") throw new TrdError("Set point, NOR and PAR belong to parameters and in-process controls");
  const clean: TrdLimits = {};
  if (limits.setPoint) {
    clean.setPoint = { value: limits.setPoint.value, sourceIds: [...limits.setPoint.sourceIds] };
    if (text(limits.setPoint.unit)) clean.setPoint.unit = text(limits.setPoint.unit);
    if (limits.setPoint.locations && Object.keys(limits.setPoint.locations).length) clean.setPoint.locations = limits.setPoint.locations;
    if (limits.setPoint.provisional) clean.setPoint.provisional = true;
  }
  if (limits.nor) clean.nor = cleanRange(limits.nor);
  if (limits.par) clean.par = cleanRange(limits.par);
  const parsed = trdLimitsSchema.safeParse(clean);
  if (!parsed.success) throw new TrdError(parsed.error.issues[0]?.message ?? "The limits are not valid");
  const before = item.limits ?? null;
  const nothing = !clean.setPoint && !clean.nor && !clean.par;
  if (stableStringify(before) === stableStringify(nothing ? null : clean)) return project;
  if (nothing) delete item.limits;
  else item.limits = clean;
  d.updatedAt = actor.at;
  const parts = [clean.setPoint ? `set point ${setPointText(clean.setPoint)}` : "", clean.nor ? `NOR ${rangeText(clean.nor)}` : "", clean.par ? `PAR ${rangeText(clean.par)}` : ""].filter(Boolean);
  log(next, actor, { action: "trd_limits_update", path: `${itemPath(id, ref)}.limits`, detail: `${step.label}, ${item.label}: ${parts.length ? parts.join("; ") : "set point, NOR and PAR removed"}`, before, after: nothing ? null : clean });
  return next;
}

/**
 * Builds a set point, NOR or PAR from the project value of one field, for the "Copy project value into ..." buttons. The user
 * decides what a project value means: nothing is copied unasked, and a copied range carries the field's sources and locations.
 * Returns undefined when the project value cannot be read that way (no number, or a single quantity for a range).
 *  - set point: a single quantity.
 *  - NOR / PAR: a range value, or a single quantity of a field named "min" or "max" (an open-ended range).
 */
export function copyPulledValue(field: TrdField, target: "setPoint" | "nor" | "par"): TrdSetPoint | TrdRange | undefined {
  const p = field.pulled;
  if (!p || p.value === undefined || typeof p.value !== "object" || Array.isArray(p.value)) return undefined;
  const v = p.value as { value?: number; unit?: string; min?: { value: number; unit: string }; max?: { value: number; unit: string } };
  const cite = { sourceIds: [...p.sourceIds], ...(p.locations ? { locations: p.locations } : {}), ...(p.provisional ? { provisional: true as const } : {}) };
  if (target === "setPoint") {
    return typeof v.value === "number" ? { value: v.value, ...(v.unit ? { unit: v.unit } : {}), ...cite } : undefined;
  }
  if (v.min || v.max) {
    const unit = v.min?.unit ?? v.max?.unit;
    return { ...(v.min ? { min: v.min.value } : {}), ...(v.max ? { max: v.max.value } : {}), ...(unit ? { unit } : {}), ...cite };
  }
  if (typeof v.value === "number" && (field.key === "min" || field.key === "max")) {
    return { [field.key]: v.value, ...(v.unit ? { unit: v.unit } : {}), ...cite };
  }
  return undefined;
}

// ------------------------------------------------------------------ open items and the check

export interface TrdOpenItem {
  /** Where: step, item and field in words. */
  where: string;
  kind: "not_established" | "tbd" | "provisional" | "limit_problem" | "limit_open" | "limit_note";
  text: string;
  stepId?: string;
  itemRef?: ItemRef;
}

export interface TrdItemCheck {
  step: TrdStep;
  item: TrdItem;
  findings: LimitFinding[];
  working: string[];
}

/** The PAR/NOR check of every parameter and IPC that has anything entered. */
export function trdLimitChecks(d: TrdDocument): TrdItemCheck[] {
  const out: TrdItemCheck[] = [];
  for (const step of d.steps) {
    for (const item of step.items) {
      if (!item.limits) continue;
      const c = checkLimits(item.limits);
      out.push({ step, item, findings: c.findings, working: c.working });
    }
  }
  return out;
}

/**
 * Everything the TRD still leaves open, in document order: values not established or TBD, provisional values, and the
 * findings of the PAR/NOR check. A TBD / provisional value is labelled as such wherever it is used.
 */
export function trdOpenItems(d: TrdDocument): TrdOpenItem[] {
  const out: TrdOpenItem[] = [];
  const field = (f: TrdField, where: string, ref?: ItemRef, stepId?: string) => {
    const v = effectiveField(f);
    const base = { where: `${where}, ${f.label}`, ...(stepId ? { stepId } : {}), ...(ref ? { itemRef: ref } : {}) };
    if (v.status === "not_established") out.push({ ...base, kind: "not_established", text: "Not established" });
    else if (v.status === "tbd") out.push({ ...base, kind: v.provisional ? "provisional" : "tbd", text: v.provisional ? `${v.text}` : "To be determined (TBD)" });
  };
  for (const f of d.details) field(f, "Details");
  for (const s of d.steps) {
    for (const f of s.fields) field(f, s.label, undefined, s.id);
    for (const i of s.items) {
      const ref: ItemRef = { stepId: s.id, collection: i.collection, key: i.key };
      for (const f of i.fields) field(f, `${s.label}, ${i.label}`, ref, s.id);
      if (i.limits) {
        for (const fd of checkLimits(i.limits).findings) {
          out.push({ where: `${s.label}, ${i.label}`, kind: fd.level === "problem" ? "limit_problem" : fd.level === "open" ? "limit_open" : "limit_note", text: fd.text, stepId: s.id, itemRef: ref });
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ overrides listing

export interface TrdOverrideRow {
  where: string;
  field: string;
  projectValue: string;
  trdValue: string;
  reason: string;
  by: string;
  at: string;
  /** True when the project had a value (an entry over an empty field is a value entered, not an override). */
  overridesProject: boolean;
}

/** Every override in the TRD, for the overrides appendix and the overridden filter. Values entered over nothing are listed as entered. */
export function trdOverrides(d: TrdDocument): TrdOverrideRow[] {
  const rows: TrdOverrideRow[] = [];
  const row = (f: TrdField, where: string) => {
    if (!f.override) return;
    const v = effectiveField(f);
    rows.push({ where, field: f.label, projectValue: f.pulled ? effectiveFieldWithout(f) : "", trdValue: v.text, reason: v.reason ?? NO_REASON_RECORDED, by: f.override.by, at: f.override.at, overridesProject: Boolean(f.pulled) });
  };
  for (const f of d.details) row(f, "Details");
  for (const s of d.steps) {
    for (const f of s.fields) row(f, s.label);
    for (const i of s.items) for (const f of i.fields) row(f, `${s.label}, ${i.label}`);
  }
  return rows;
}

/** Whether the project (or the seed that was imported) has changed since the TRD was last brought up to date. */
export function trdSourceChanged(d: TrdDocument, currentSeed: TrdSeed): boolean {
  if (!d.origin.seed) return false;
  return d.origin.seed.fingerprint !== trdSeedContentFingerprint(currentSeed);
}
