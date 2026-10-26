import {
  mbrRecordSchema,
  MBR_CHOICE_LABEL,
  type Actor,
  type ChangeEvent,
  type MbrBlock,
  type MbrChoice,
  type MbrLibraryBlock,
  type MbrParamRow,
  type MbrRecord,
  type MbrSampleRow,
  type MbrSection,
  type MbrTimeLimit,
  type MbrTrdRef,
  type Project,
  type SamplingPlan,
  type SamplingPoint,
  type TrdDocument,
  type TrdItem,
} from "@gap/process-model";
import { effectiveField } from "./trd";
import { resolveTrdValue, trdValueDiffers } from "./mbr-values";
import { blockVersion } from "./mbr-library";

/*
 * The editable master batch record. Every edit returns a new project and adds one change-log event with the old value kept (GMP: a
 * reviewer must be able to see what a batch record draft said before it was changed, and by whom).
 *
 * Rules these functions keep (see process-model mbr.ts for the shapes):
 *  - NO DEFAULTS. A parameter row's choice is never preselected; an absent choice reads "not decided". A TRD value that the site does not
 *    hold is shown as "value not held by the site" and is never filled in.
 *  - NOTHING BLOCKS. Comparisons and open items are information. No function here refuses an edit because of a comparison.
 *  - The TRD value and the sampling plan stay the records of truth. A row keeps a copy; a changed source shows a notice and an Update
 *    button, and only that click (one logged edit) changes the copy.
 *  - Step numbers are computed from the order (numberSteps); a cross-reference is the id of a step inside the step text.
 */

export class MbrError extends Error {}

type Ev = Omit<ChangeEvent, "at" | "by">;
type Prefix = "SC" | "BL" | "ST" | "R";
const WIDTH: Record<Prefix, number> = { SC: 2, BL: 3, ST: 4, R: 4 };

const text = (v: string | undefined | null) => (v ?? "").trim();
const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
};

function log(project: Project, actor: Actor, ev: Ev): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function recOf(project: Project, id: string): MbrRecord {
  const r = project.mbr.records.find((x) => x.id === id);
  if (!r) throw new MbrError(`Batch record ${id} does not exist`);
  return r;
}

function assertValid(r: MbrRecord): void {
  const res = mbrRecordSchema.safeParse(r);
  if (!res.success) throw new MbrError(res.error.issues[0]?.message ?? "The batch record is not valid");
}

// ------------------------------------------------------------------ ids

/**
 * Hands out ids that were never used in the record. An id that survives only in the change log (a removed block, step or row) still
 * counts as taken, so a cross-reference to a removed step can never point at a new, different step later.
 */
export type IdIssuer = (p: Prefix) => string;

function issuerFor(project: Project, rec: MbrRecord | undefined, recordId: string): IdIssuer {
  const max: Record<Prefix, number> = { SC: 0, BL: 0, ST: 0, R: 0 };
  const take = (id: string) => {
    const m = /^(SC|BL|ST|R)-(\d+)$/.exec(id);
    if (m) max[m[1] as Prefix] = Math.max(max[m[1] as Prefix], Number(m[2]));
  };
  if (rec) {
    for (const s of rec.sections) {
      take(s.id);
      for (const b of s.blocks) {
        take(b.id);
        b.steps.forEach((x) => take(x.id));
        b.params.forEach((x) => take(x.id));
        b.samples.forEach((x) => take(x.id));
        for (const t of b.timeLimits) {
          take(t.id);
          t.targets.forEach((g) => take(g.id));
        }
      }
    }
  }
  for (const ev of project.changeLog) {
    if (!ev.action.startsWith("mbr_")) continue;
    const parts = (ev.path ?? "").split(".");
    if (parts[0] !== "mbr" || parts[1] !== recordId) continue;
    parts.slice(2).forEach(take);
    for (const side of [ev.before, ev.after]) {
      if (side === undefined) continue;
      for (const m of JSON.stringify(side).matchAll(/"((?:SC|BL|ST|R)-\d+)"/g)) take(m[1]!);
    }
  }
  return (p) => {
    max[p] += 1;
    return `${p}-${String(max[p]).padStart(WIDTH[p], "0")}`;
  };
}

function nextRecordId(project: Project): string {
  let max = 0;
  const take = (id: string) => {
    const m = /^MBR-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  project.mbr.records.forEach((r) => take(r.id));
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] === "mbr") take(parts[1] ?? "");
  }
  return `MBR-${String(max + 1).padStart(3, "0")}`;
}

/** Runs one edit on a copy of the project; an edit that returns nothing leaves the project as it was. */
function mutate(project: Project, recordId: string, actor: Actor, fn: (rec: MbrRecord, ids: IdIssuer) => Ev | undefined): Project {
  const next = structuredClone(project);
  const rec = recOf(next, recordId);
  const ev = fn(rec, issuerFor(next, rec, recordId));
  if (!ev) return project;
  rec.updatedAt = actor.at;
  assertValid(rec);
  log(next, actor, ev);
  return next;
}

// ------------------------------------------------------------------ lookups

function sectionOf(rec: MbrRecord, id: string): MbrSection {
  const s = rec.sections.find((x) => x.id === id);
  if (!s) throw new MbrError(`Section ${id} is not in ${rec.id}`);
  return s;
}

function blockLoc(rec: MbrRecord, blockId: string): { section: MbrSection; block: MbrBlock; index: number } {
  for (const section of rec.sections) {
    const index = section.blocks.findIndex((b) => b.id === blockId);
    if (index >= 0) return { section, block: section.blocks[index]!, index };
  }
  throw new MbrError(`Block ${blockId} is not in ${rec.id}`);
}

const rowPath = (rec: MbrRecord, section: MbrSection, block: MbrBlock, rowId?: string) => ["mbr", rec.id, section.id, block.id, ...(rowId ? [rowId] : [])].join(".");

const trdOf = (project: Project, rec: MbrRecord): TrdDocument | undefined => (rec.trdId ? project.trd.documents.find((d) => d.id === rec.trdId) : undefined);
const planOf = (project: Project, rec: MbrRecord): SamplingPlan | undefined => (rec.planId ? project.sampling.plans.find((p) => p.id === rec.planId) : undefined);

// ------------------------------------------------------------------ numbering and cross-references

const REF = /\[\[step:(ST-\d+)\]\]/g;

/** Step numbers of a record ("9.14": section 9, fourteenth step of that section). Computed from the order, never stored. */
export function numberSteps(rec: MbrRecord): Map<string, string> {
  const out = new Map<string, string>();
  rec.sections.forEach((s, si) => {
    let n = 0;
    for (const b of s.blocks) for (const st of b.steps) out.set(st.id, `${si + 1}.${++n}`);
  });
  return out;
}

/** The number of a section (1-based position). */
export const sectionNumber = (rec: MbrRecord, sectionId: string): number => rec.sections.findIndex((s) => s.id === sectionId) + 1;

export const REMOVED_STEP = "(Step reference removed)";

/** Step text with its cross-references written as "(Step 9.14)". A reference to a step that is gone reads "(Step reference removed)". */
export function renderStepText(t: string, numbers: ReadonlyMap<string, string>): string {
  return t.replace(REF, (_m, id: string) => (numbers.has(id) ? `(Step ${numbers.get(id)})` : REMOVED_STEP));
}

/** Ids of the steps a text refers to. */
export const stepRefsIn = (t: string): string[] => [...t.matchAll(REF)].map((m) => m[1]!);

export const stepRefToken = (stepId: string) => `[[step:${stepId}]]`;

/** The number of a step as text, or a note that the step is gone (for step ranges of time-limit targets). */
export const stepNumberText = (numbers: ReadonlyMap<string, string>, id: string | undefined): string => (id ? (numbers.get(id) ? `Step ${numbers.get(id)}` : "step removed") : "");

/** References whose target step no longer exists (information for the open-items panel). */
export function brokenReferences(rec: MbrRecord): { sectionId: string; blockId: string; stepId: string; text: string }[] {
  const all = new Set(rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => x.id))));
  const out: { sectionId: string; blockId: string; stepId: string; text: string }[] = [];
  for (const s of rec.sections) for (const b of s.blocks) for (const st of b.steps) if (stepRefsIn(st.text).some((id) => !all.has(id))) out.push({ sectionId: s.id, blockId: b.id, stepId: st.id, text: st.text });
  return out;
}

// ------------------------------------------------------------------ sample rows from the sampling plan

/** The live shape of a sample row, as the sampling plan says it now. `hour` holds the moment in process words (see sampleMomentOf). */
export type SampleFields = Pick<MbrSampleRow, "test" | "step" | "quantity" | "container" | "storage" | "hour" | "hold">;

/**
 * The moment in the process a sample is taken, in process words ("Beginning of aseptic filling", "After 30 h hold"). A batch record is
 * read at the bench, where nobody knows what "116 h" on the plan's flow figure means, so the hour on the figure is NOT printed here.
 * The author's own timing note wins (it can name the exact moment); otherwise the words come from the timing choice and the step.
 * Nothing is guessed: no timing choice and no note leaves the cell empty.
 */
export function sampleMomentOf(p: SamplingPoint, step: string | undefined, hold: string | undefined): string | undefined {
  const note = text(p.timing.note);
  if (note) return note;
  const o = p.timing.options[0];
  if (!o) return undefined;
  const at = step ? step.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()) : undefined;
  if (hold) {
    if (o === "beginning") return `Start of hold (${hold})`;
    if (o === "end") return `End of hold (${hold})`;
    return `During hold (${hold})`;
  }
  const where = at ? ` ${at}` : "";
  switch (o) {
    case "beginning": return `Beginning of${where || " the run"}`;
    case "middle": return `Middle of${where || " the run"}`;
    case "end": return `End of${where || " the run"}`;
    case "after_stoppage": return `After a line stop${at ? ` in ${at}` : ""}`;
    case "after_intervention": return `After an intervention${at ? ` in ${at}` : ""}`;
    case "interval": return `At defined intervals${at ? ` during ${at}` : ""}`;
    case "other": return text(p.timing.other) || undefined;
    default: return undefined;
  }
}

export function sampleFieldsOf(plan: SamplingPlan, p: SamplingPoint): SampleFields {
  const step = p.flow ? plan.steps.find((s) => s.id === p.flow!.stepId)?.label : undefined;
  const hold = p.flow?.holdId ? (plan.holds ?? []).find((h) => h.id === p.flow!.holdId)?.label : undefined;
  // "2 x 10 mL": a sample is often a set of identical containers (the sample and its backup), and the batch record must tell the
  // sampler how many to fill, not only how much one holds.
  const per = p.quantity ? `${p.quantity.value} ${p.quantity.unit}` : undefined;
  const q = per && (p.containerUnitsPerSample ?? 1) > 1 ? `${p.containerUnitsPerSample} × ${per}` : per;
  return clean({
    test: text(p.attribute) || text(p.typeLabel) || p.type || p.id,
    step,
    quantity: q,
    container: text(p.container) || undefined,
    storage: text(p.storageCondition) || undefined,
    hour: sampleMomentOf(p, step, hold),
    hold,
  });
}

const SAMPLE_KEYS = ["test", "step", "quantity", "container", "storage", "hour", "hold"] as const;

/** What differs between a sample row and the plan point it came from. Empty list: the row says what the plan says. */
export function sampleDiff(row: MbrSampleRow, plan: SamplingPlan | undefined): { missing: boolean; keys: (typeof SAMPLE_KEYS)[number][] } {
  const point = plan?.points.find((p) => p.id === row.pointId);
  if (!plan || !point) return { missing: true, keys: [] };
  const live = sampleFieldsOf(plan, point);
  return { missing: false, keys: SAMPLE_KEYS.filter((k) => (row[k] ?? "") !== (live[k] ?? "")) };
}

/** Plan points that fit a block: those on the section's unit operation, narrowed by the block's sample types ("*" = all of them). */
export function candidateSamplePoints(plan: SamplingPlan | undefined, unitOp: string | undefined, sampleTypes: readonly string[]): SamplingPoint[] {
  if (!plan || !unitOp || sampleTypes.length === 0) return [];
  const all = sampleTypes.includes("*");
  const words = sampleTypes.map((w) => w.toLowerCase());
  return plan.points.filter((p) => p.unitOp === unitOp && (all || words.some((w) => `${p.attribute} ${p.typeLabel ?? ""} ${p.type ?? ""}`.toLowerCase().includes(w))));
}

function sampleRow(plan: SamplingPlan, p: SamplingPoint, id: string): MbrSampleRow {
  return { id, planId: plan.id, pointId: p.id, ...sampleFieldsOf(plan, p) };
}

// ------------------------------------------------------------------ building blocks from the library

export interface BlockContext {
  unitOp?: string;
  trd?: TrdDocument;
  plan?: SamplingPlan;
  at: string;
}

function trdRowFor(ctx: BlockContext, collection: MbrTrdRef["collection"], itemKey: string, field: string): MbrTrdRef | undefined {
  if (!ctx.trd || !ctx.unitOp) return undefined;
  return resolveTrdValue(ctx.trd, ctx.unitOp, collection, itemKey, field, ctx.at);
}

/** A block instance from a library block: its own copy of the text, rows for the parameters it pulls, sample rows from the plan. */
export function instantiateBlock(lib: MbrLibraryBlock, ids: IdIssuer, ctx: BlockContext): MbrBlock {
  return clean({
    id: ids("BL"),
    libraryId: lib.id,
    libraryVersion: lib.version,
    title: lib.title,
    steps: lib.steps.map((t) => ({ id: ids("ST"), text: t })),
    params: lib.params.map((p) => clean({ id: ids("R"), key: p.key, label: p.label, trd: trdRowFor(ctx, p.collection, p.itemKey, p.field) })),
    samples: candidateSamplePoints(ctx.plan, ctx.unitOp, lib.sampleTypes).map((pt) => sampleRow(ctx.plan!, pt, ids("R"))),
    timeLimits: lib.timeLimits.map((t) => {
      const trd = trdRowFor(ctx, t.collection, t.itemKey, t.field);
      return clean({ id: ids("R"), key: t.key, label: t.label, trd, value: trd && trd.status === "established" ? trd.text : undefined, unit: trd && trd.status === "established" ? trd.unit : undefined, targets: [] });
    }),
    cmoFields: [...lib.cmoFields],
    note: lib.note,
  });
}

export interface BlockProposal {
  block: MbrLibraryBlock;
  /** Why it is offered, in words. */
  reason: string;
  /** Ticked in the start form. Only an offer: the author confirms. */
  ticked: boolean;
}

/**
 * The blocks offered for one unit operation. A block is ticked only when a source the author chose backs it: the TRD record holds a
 * parameter the block pulls, or the sampling plan has sample points for it. With a blank start nothing is ticked.
 */
export function proposeBlocks(library: readonly MbrLibraryBlock[], unitOp: string | undefined, trd: TrdDocument | undefined, plan: SamplingPlan | undefined): BlockProposal[] {
  const here = library.filter((b) => b.unitOps.length === 0 || (unitOp !== undefined && b.unitOps.includes(unitOp)));
  const step = trd?.steps.find((s) => s.key === unitOp);
  return here.map((block) => {
    const trdHits = step ? [...block.params, ...block.timeLimits].filter((p) => step.items.some((i) => i.collection === p.collection && i.key === p.itemKey)).length : 0;
    const sampleHits = candidateSamplePoints(plan, unitOp, block.sampleTypes).length;
    const parts = [trdHits ? `the TRD holds ${trdHits} of its values` : "", sampleHits ? `the sampling plan has ${sampleHits} sample point${sampleHits === 1 ? "" : "s"} here` : ""].filter(Boolean);
    return { block, reason: parts.length ? `Offered because ${parts.join(" and ")}.` : "Library block for this unit operation.", ticked: parts.length > 0 };
  });
}

// ------------------------------------------------------------------ records

export interface NewSectionSpec {
  unitOp?: string;
  title: string;
  /** Library blocks to place in the section, in order. */
  blocks: MbrLibraryBlock[];
}

export interface NewMbrInput {
  title: string;
  docRef?: string;
  trdId?: string;
  planId?: string;
  sections: NewSectionSpec[];
}

export function createMbr(project: Project, input: NewMbrInput, actor: Actor): { project: Project; recordId: string } {
  const title = text(input.title);
  if (!title) throw new MbrError("The batch record needs a title");
  const next = structuredClone(project);
  const trd = input.trdId ? next.trd.documents.find((d) => d.id === input.trdId) : undefined;
  if (input.trdId && !trd) throw new MbrError(`TRD ${input.trdId} does not exist`);
  const plan = input.planId ? next.sampling.plans.find((p) => p.id === input.planId) : undefined;
  if (input.planId && !plan) throw new MbrError(`Sampling plan ${input.planId} does not exist`);
  const id = nextRecordId(next);
  const rec: MbrRecord = clean({ id, title, status: "draft" as const, docRef: text(input.docRef) || undefined, trdId: input.trdId, planId: input.planId, sections: [], createdAt: actor.at, updatedAt: actor.at });
  const ids = issuerFor(next, rec, id);
  for (const sp of input.sections) {
    rec.sections.push(
      clean({
        id: ids("SC"),
        unitOp: sp.unitOp,
        title: text(sp.title) || "Section",
        blocks: sp.blocks.map((lib) => instantiateBlock(lib, ids, { unitOp: sp.unitOp, trd, plan, at: actor.at })),
      }),
    );
  }
  assertValid(rec);
  next.mbr.records.push(rec);
  const blocks = rec.sections.reduce((n, s) => n + s.blocks.length, 0);
  log(next, actor, { action: "mbr_add", path: `mbr.${id}`, detail: `Batch record ${id} added: ${title} (${rec.sections.length} sections, ${blocks} blocks)`, after: clean({ title, docRef: rec.docRef }) });
  return { project: next, recordId: id };
}

export interface MbrPatch {
  title?: string;
  docRef?: string;
  version?: string;
  purpose?: string;
}

export function updateMbr(project: Project, id: string, patch: MbrPatch, actor: Actor): Project {
  return mutate(project, id, actor, (rec) => {
    const before: Record<string, string | undefined> = {};
    const after: Record<string, string | undefined> = {};
    for (const k of ["title", "docRef", "version", "purpose"] as const) {
      if (patch[k] === undefined) continue;
      const v = text(patch[k]) || undefined;
      if (k === "title" && !v) throw new MbrError("The batch record needs a title");
      if ((rec[k] ?? undefined) === v) continue;
      before[k] = rec[k];
      after[k] = v;
      if (v === undefined) delete rec[k];
      else rec[k] = v;
    }
    if (Object.keys(after).length === 0) return undefined;
    return { action: "mbr_update", path: `mbr.${rec.id}`, detail: `Batch record ${rec.id} edited`, before, after };
  });
}

export function deleteMbr(project: Project, id: string, actor: Actor): Project {
  const next = structuredClone(project);
  const rec = recOf(next, id);
  next.mbr.records = next.mbr.records.filter((r) => r.id !== id);
  log(next, actor, { action: "mbr_remove", path: `mbr.${id}`, detail: `Batch record ${id} removed: ${rec.title}`, before: { title: rec.title, docRef: rec.docRef } });
  return next;
}

// ------------------------------------------------------------------ sections

export function addSection(project: Project, recordId: string, input: { unitOp?: string; title: string }, actor: Actor, index?: number): { project: Project; sectionId: string } {
  let sectionId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const title = text(input.title);
    if (!title) throw new MbrError("The section needs a title");
    sectionId = ids("SC");
    const at = index === undefined ? rec.sections.length : Math.max(0, Math.min(index, rec.sections.length));
    rec.sections.splice(at, 0, clean({ id: sectionId, unitOp: input.unitOp, title, blocks: [] }));
    return { action: "mbr_section_add", path: `mbr.${rec.id}.${sectionId}`, detail: `Section "${title}" added to ${rec.id}`, after: { title } };
  });
  return { project: out, sectionId };
}

export function updateSection(project: Project, recordId: string, sectionId: string, patch: { title?: string }, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const s = sectionOf(rec, sectionId);
    const title = text(patch.title);
    if (!title || title === s.title) return undefined;
    const before = s.title;
    s.title = title;
    return { action: "mbr_section_update", path: `mbr.${rec.id}.${s.id}`, detail: `Section renamed in ${rec.id}`, before: { title: before }, after: { title } };
  });
}

export function moveSection(project: Project, recordId: string, sectionId: string, delta: -1 | 1, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const i = rec.sections.findIndex((s) => s.id === sectionId);
    if (i < 0) throw new MbrError(`Section ${sectionId} is not in ${rec.id}`);
    const j = i + delta;
    if (j < 0 || j >= rec.sections.length) return undefined;
    const [s] = rec.sections.splice(i, 1);
    rec.sections.splice(j, 0, s!);
    return { action: "mbr_section_move", path: `mbr.${rec.id}.${s!.id}`, detail: `Section "${s!.title}" moved ${delta < 0 ? "up" : "down"} in ${rec.id}` };
  });
}

export function removeSection(project: Project, recordId: string, sectionId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const s = sectionOf(rec, sectionId);
    rec.sections = rec.sections.filter((x) => x.id !== sectionId);
    return { action: "mbr_section_remove", path: `mbr.${rec.id}.${s.id}`, detail: `Section "${s.title}" removed from ${rec.id} (with ${s.blocks.length} blocks)`, before: { title: s.title, blocks: s.blocks } };
  });
}

// ------------------------------------------------------------------ blocks

export function addBlockFromLibrary(project: Project, recordId: string, sectionId: string, lib: MbrLibraryBlock, actor: Actor, index?: number): { project: Project; blockId: string } {
  let blockId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const s = sectionOf(rec, sectionId);
    const block = instantiateBlock(lib, ids, { unitOp: s.unitOp, trd: trdOf(project, rec), plan: planOf(project, rec), at: actor.at });
    blockId = block.id;
    const at = index === undefined ? s.blocks.length : Math.max(0, Math.min(index, s.blocks.length));
    s.blocks.splice(at, 0, block);
    return { action: "mbr_block_add", path: rowPath(rec, s, block), detail: `Block "${block.title}" (library version ${lib.version}) added to "${s.title}" in ${rec.id}`, after: { title: block.title } };
  });
  return { project: out, blockId };
}

export function addCustomBlock(project: Project, recordId: string, sectionId: string, input: { title: string }, actor: Actor): { project: Project; blockId: string } {
  let blockId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const s = sectionOf(rec, sectionId);
    const title = text(input.title);
    if (!title) throw new MbrError("The block needs a title");
    blockId = ids("BL");
    s.blocks.push({ id: blockId, title, steps: [], params: [], samples: [], timeLimits: [], cmoFields: [] });
    return { action: "mbr_block_add", path: `mbr.${rec.id}.${s.id}.${blockId}`, detail: `Block "${title}" (written here, not from the library) added to "${s.title}" in ${rec.id}`, after: { title } };
  });
  return { project: out, blockId };
}

export interface BlockPatch {
  title?: string;
  note?: string;
  cmoFields?: string[];
}

export function updateBlock(project: Project, recordId: string, blockId: string, patch: BlockPatch, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block } = blockLoc(rec, blockId);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const t = text(patch.title);
      if (!t) throw new MbrError("The block needs a title");
      if (t !== block.title) {
        before.title = block.title;
        after.title = t;
        block.title = t;
      }
    }
    if (patch.note !== undefined) {
      const n = text(patch.note) || undefined;
      if (n !== block.note) {
        before.notes = block.note;
        after.notes = n;
        if (n === undefined) delete block.note;
        else block.note = n;
      }
    }
    if (patch.cmoFields !== undefined) {
      const f = patch.cmoFields.map(text).filter(Boolean);
      if (JSON.stringify(f) !== JSON.stringify(block.cmoFields)) {
        before.cmoFields = block.cmoFields.join("; ") || undefined;
        after.cmoFields = f.join("; ") || undefined;
        block.cmoFields = f;
      }
    }
    if (Object.keys(after).length === 0) return undefined;
    return { action: "mbr_block_update", path: rowPath(rec, section, block), detail: `Block "${block.title}" edited in ${rec.id}`, before, after };
  });
}

/** Moves a block one place. At the edge of a section it moves into the neighbouring section (to its end or start). */
export function moveBlock(project: Project, recordId: string, blockId: string, delta: -1 | 1, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, index } = blockLoc(rec, blockId);
    const j = index + delta;
    let where = "";
    if (j >= 0 && j < section.blocks.length) {
      section.blocks.splice(index, 1);
      section.blocks.splice(j, 0, block);
      where = `in "${section.title}"`;
    } else {
      const si = rec.sections.indexOf(section) + delta;
      const target = rec.sections[si];
      if (!target) return undefined;
      section.blocks.splice(index, 1);
      if (delta < 0) target.blocks.push(block);
      else target.blocks.unshift(block);
      where = `to "${target.title}"`;
    }
    return { action: "mbr_block_move", path: `mbr.${rec.id}.${block.id}`, detail: `Block "${block.title}" moved ${delta < 0 ? "up" : "down"} ${where} in ${rec.id}` };
  });
}

export function removeBlock(project: Project, recordId: string, blockId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block } = blockLoc(rec, blockId);
    section.blocks = section.blocks.filter((b) => b.id !== blockId);
    return { action: "mbr_block_remove", path: rowPath(rec, section, block), detail: `Block "${block.title}" removed from "${section.title}" in ${rec.id}`, before: { title: block.title, steps: block.steps.map((s) => s.text).join(" | ") || undefined, blocks: block } };
  });
}

/**
 * Brings a block up to the library version. The step text, title, note and CMO list become the library's (the earlier text is kept in
 * the change log); steps keep their ids by position, so cross-references to them survive. Parameter and time-limit rows are matched by
 * key: existing rows keep everything the author entered, rows the library gained are added, rows it dropped stay (removing a row is
 * the author's decision). Sample rows are untouched: the sampling plan owns them.
 */
export function updateBlockFromLibrary(project: Project, recordId: string, blockId: string, lib: MbrLibraryBlock, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec, ids) => {
    const { section, block } = blockLoc(rec, blockId);
    if (block.libraryId !== lib.id) throw new MbrError(`Block ${blockId} was not made from library block ${lib.id}`);
    if (block.libraryVersion === lib.version) return undefined;
    const before = { title: block.title, steps: block.steps.map((s) => s.text).join(" | ") || undefined, cmoFields: block.cmoFields.join("; ") || undefined, notes: block.note };
    const ctx: BlockContext = { unitOp: section.unitOp, trd: trdOf(project, rec), plan: planOf(project, rec), at: actor.at };
    block.title = lib.title;
    block.steps = lib.steps.map((t, i) => ({ id: block.steps[i]?.id ?? ids("ST"), text: t }));
    block.cmoFields = [...lib.cmoFields];
    if (lib.note) block.note = lib.note;
    else delete block.note;
    for (const p of lib.params) {
      if (block.params.some((r) => r.key === p.key)) continue;
      block.params.push(clean({ id: ids("R"), key: p.key, label: p.label, trd: trdRowFor(ctx, p.collection, p.itemKey, p.field) }));
    }
    for (const t of lib.timeLimits) {
      if (block.timeLimits.some((r) => r.key === t.key)) continue;
      const trd = trdRowFor(ctx, t.collection, t.itemKey, t.field);
      block.timeLimits.push(clean({ id: ids("R"), key: t.key, label: t.label, trd, value: trd && trd.status === "established" ? trd.text : undefined, unit: trd && trd.status === "established" ? trd.unit : undefined, targets: [] }));
    }
    const used = block.libraryVersion;
    block.libraryVersion = lib.version;
    const after = { title: block.title, steps: block.steps.map((s) => s.text).join(" | ") || undefined, cmoFields: block.cmoFields.join("; ") || undefined, notes: block.note };
    return { action: "mbr_block_library_update", path: rowPath(rec, section, block), detail: `Block "${block.title}" updated from library version ${used ?? "?"} to ${lib.version} in ${rec.id}`, before, after };
  });
}

/** What changed between the version a block was made from and the library's current one (for the review before updating). */
export function libraryDifference(block: MbrBlock, lib: MbrLibraryBlock): { titleChanged: boolean; stepsAdded: number; stepsRemoved: number; stepsChanged: number; paramsAdded: string[] } {
  const old = block.libraryVersion !== undefined ? blockVersion(lib, block.libraryVersion) : undefined;
  const mine = block.steps.map((s) => s.text);
  const n = Math.min(mine.length, lib.steps.length);
  let changed = 0;
  for (let i = 0; i < n; i++) if (mine[i] !== lib.steps[i]) changed++;
  return {
    titleChanged: Boolean(old && old.title !== lib.title) || block.title !== lib.title,
    stepsAdded: Math.max(0, lib.steps.length - mine.length),
    stepsRemoved: Math.max(0, mine.length - lib.steps.length),
    stepsChanged: changed,
    paramsAdded: lib.params.filter((p) => !block.params.some((r) => r.key === p.key)).map((p) => p.label),
  };
}

// ------------------------------------------------------------------ steps

function stepLoc(rec: MbrRecord, stepId: string) {
  for (const section of rec.sections) for (const block of section.blocks) {
    const index = block.steps.findIndex((s) => s.id === stepId);
    if (index >= 0) return { section, block, index };
  }
  throw new MbrError(`Step ${stepId} is not in ${rec.id}`);
}

export function addMbrStep(project: Project, recordId: string, blockId: string, stepText: string, actor: Actor, index?: number): { project: Project; stepId: string } {
  let stepId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const { section, block } = blockLoc(rec, blockId);
    stepId = ids("ST");
    const at = index === undefined ? block.steps.length : Math.max(0, Math.min(index, block.steps.length));
    block.steps.splice(at, 0, { id: stepId, text: stepText });
    return { action: "mbr_step_add", path: rowPath(rec, section, block, stepId), detail: `Step added to block "${block.title}" in ${rec.id}`, after: { text: stepText } };
  });
  return { project: out, stepId };
}

export function updateMbrStep(project: Project, recordId: string, stepId: string, stepText: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, index } = stepLoc(rec, stepId);
    const step = block.steps[index]!;
    if (step.text === stepText) return undefined;
    const before = step.text;
    step.text = stepText;
    return { action: "mbr_step_update", path: rowPath(rec, section, block, stepId), detail: `Step text edited in block "${block.title}" in ${rec.id}`, before: { text: before }, after: { text: stepText } };
  });
}

export function moveMbrStep(project: Project, recordId: string, stepId: string, delta: -1 | 1, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, index } = stepLoc(rec, stepId);
    const j = index + delta;
    if (j < 0 || j >= block.steps.length) return undefined;
    const [s] = block.steps.splice(index, 1);
    block.steps.splice(j, 0, s!);
    return { action: "mbr_step_move", path: rowPath(rec, section, block, stepId), detail: `Step moved ${delta < 0 ? "up" : "down"} in block "${block.title}" in ${rec.id}` };
  });
}

export function removeMbrStep(project: Project, recordId: string, stepId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, index } = stepLoc(rec, stepId);
    const [s] = block.steps.splice(index, 1);
    return { action: "mbr_step_remove", path: rowPath(rec, section, block, stepId), detail: `Step removed from block "${block.title}" in ${rec.id}`, before: { text: s!.text } };
  });
}

// ------------------------------------------------------------------ parameter rows

export interface TrdRowRef {
  collection: MbrTrdRef["collection"];
  itemKey: string;
  field: string;
}

export function addParamRow(project: Project, recordId: string, blockId: string, input: { label: string; ref?: TrdRowRef }, actor: Actor): { project: Project; rowId: string } {
  let rowId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const { section, block } = blockLoc(rec, blockId);
    const label = text(input.label);
    if (!label) throw new MbrError("The row needs a label");
    rowId = ids("R");
    const trd = input.ref ? trdRowFor({ unitOp: section.unitOp, trd: trdOf(project, rec), at: actor.at }, input.ref.collection, input.ref.itemKey, input.ref.field) : undefined;
    block.params.push(clean({ id: rowId, label, trd }));
    return { action: "mbr_row_add", path: rowPath(rec, section, block, rowId), detail: `Parameter row "${label}" added to block "${block.title}" in ${rec.id}`, after: clean({ label, trdValue: trd ? (trd.text ? [trd.text, trd.unit].filter(Boolean).join(" ") : "value not held by the site") : undefined }) };
  });
  return { project: out, rowId };
}

export interface ParamPatch {
  label?: string;
  mbrValue?: string | null;
  mbrUnit?: string | null;
  /** null clears the choice (the row reads "not decided" again). */
  choice?: MbrChoice | null;
  reason?: string | null;
  studyPoint?: boolean;
}

const choiceWords = (c: MbrChoice | undefined) => (c ? MBR_CHOICE_LABEL[c] : "Not decided");

function paramSnapshot(r: MbrParamRow) {
  return { label: r.label, mbrValue: r.mbrValue, mbrUnit: r.mbrUnit, choice: choiceWords(r.choice), reason: r.reason, studyPoint: r.studyPoint ? "Yes" : "No" };
}

function paramLoc(rec: MbrRecord, rowId: string) {
  for (const section of rec.sections) for (const block of section.blocks) {
    const row = block.params.find((p) => p.id === rowId);
    if (row) return { section, block, row };
  }
  throw new MbrError(`Row ${rowId} is not in ${rec.id}`);
}

export function setParam(project: Project, recordId: string, rowId: string, patch: ParamPatch, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, row } = paramLoc(rec, rowId);
    const before = paramSnapshot(row);
    if (patch.label !== undefined) {
      const l = text(patch.label);
      if (!l) throw new MbrError("The row needs a label");
      row.label = l;
    }
    if (patch.choice !== undefined) {
      if (patch.choice === null) delete row.choice;
      else row.choice = patch.choice;
      if (patch.choice === "same_as_trd") {
        // "Same as TRD" makes the MBR value the TRD value (the unit too, copied as the TRD states it). A TRD that holds no value leaves
        // the MBR value blank: the row then reads "value not held by the site", never a made-up number.
        if (patch.mbrValue !== undefined || patch.mbrUnit !== undefined) throw new MbrError("While the choice is 'same as TRD' the MBR value follows the TRD value. Choose 'tightened by the CMO' to enter a different value.");
        const t = row.trd && row.trd.status === "established" ? row.trd : undefined;
        if (t?.text) row.mbrValue = t.text;
        else delete row.mbrValue;
        if (t?.unit) row.mbrUnit = t.unit;
        else delete row.mbrUnit;
      }
    }
    if (patch.mbrValue !== undefined || patch.mbrUnit !== undefined) {
      if (row.choice === "same_as_trd") throw new MbrError("While the choice is 'same as TRD' the MBR value follows the TRD value. Choose 'tightened by the CMO' to enter a different value.");
      if (patch.mbrValue !== undefined) {
        const v = text(patch.mbrValue);
        if (v) row.mbrValue = v;
        else delete row.mbrValue;
      }
      if (patch.mbrUnit !== undefined) {
        const u = text(patch.mbrUnit);
        if (u) row.mbrUnit = u;
        else delete row.mbrUnit;
      }
    }
    if (patch.reason !== undefined) {
      const r = text(patch.reason);
      if (r) row.reason = r;
      else delete row.reason;
    }
    if (patch.studyPoint !== undefined) {
      if (patch.studyPoint) row.studyPoint = true;
      else delete row.studyPoint;
    }
    const after = paramSnapshot(row);
    if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
    return { action: "mbr_row_update", path: rowPath(rec, section, block, rowId), detail: `Parameter row "${row.label}" edited in block "${block.title}" in ${rec.id}`, before, after };
  });
}

export function removeParamRow(project: Project, recordId: string, rowId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, row } = paramLoc(rec, rowId);
    block.params = block.params.filter((p) => p.id !== rowId);
    return { action: "mbr_row_remove", path: rowPath(rec, section, block, rowId), detail: `Parameter row "${row.label}" removed from block "${block.title}" in ${rec.id}`, before: paramSnapshot(row) };
  });
}

// ------------------------------------------------------------------ TRD changes

/** The TRD value as the TRD says it now, for a row's reference. Undefined when the TRD record is gone. */
export function liveTrdValue(project: Project, rec: MbrRecord, ref: MbrTrdRef, at = ref.copiedAt): MbrTrdRef | undefined {
  const doc = project.trd.documents.find((d) => d.id === ref.trdId);
  const unitOp = ref.path.split(".")[1];
  if (!doc || !unitOp) return undefined;
  void rec;
  return resolveTrdValue(doc, unitOp, ref.collection, ref.itemKey, ref.field, at);
}

export interface TrdNotice {
  blockId: string;
  rowId: string;
  kind: "param" | "time_limit";
  label: string;
  /** The TRD record the value was copied from is gone: there is nothing to update from. */
  trdGone: boolean;
}

/** Rows whose TRD value changed since it was copied ("TRD value changed since this was set"). */
export function trdNotices(project: Project, rec: MbrRecord): TrdNotice[] {
  const out: TrdNotice[] = [];
  const check = (blockId: string, rowId: string, kind: TrdNotice["kind"], label: string, ref: MbrTrdRef | undefined) => {
    if (!ref) return;
    const live = liveTrdValue(project, rec, ref);
    if (!live) out.push({ blockId, rowId, kind, label, trdGone: true });
    else if (trdValueDiffers(ref, live)) out.push({ blockId, rowId, kind, label, trdGone: false });
  };
  for (const s of rec.sections) for (const b of s.blocks) {
    b.params.forEach((p) => check(b.id, p.id, "param", p.label, p.trd));
    b.timeLimits.forEach((t) => check(b.id, t.id, "time_limit", t.label, t.trd));
  }
  return out;
}

/**
 * Brings one row up to the TRD value as it is now. The copy of the TRD value is replaced; where the row says "same as TRD" the MBR
 * value follows it; where the author tightened the value, the MBR value is left alone. A time limit's critical limit is the TRD value,
 * so it follows. Only this click does it: a changed TRD never rewrites the batch record by itself.
 */
export function updateRowFromTrd(project: Project, recordId: string, rowId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    for (const section of rec.sections) for (const block of section.blocks) {
      const row = block.params.find((p) => p.id === rowId);
      const limit = block.timeLimits.find((t) => t.id === rowId);
      const target = row ?? limit;
      if (!target) continue;
      if (!target.trd) throw new MbrError("This row has no TRD value to update from");
      const live = liveTrdValue(project, rec, target.trd, actor.at);
      if (!live) throw new MbrError("The TRD record is no longer in the project");
      if (!trdValueDiffers(target.trd, live)) return undefined;
      const beforeText = [target.trd.text, target.trd.unit].filter(Boolean).join(" ") || "value not held by the site";
      const afterText = [live.text, live.unit].filter(Boolean).join(" ") || "value not held by the site";
      target.trd = live;
      if (row && row.choice === "same_as_trd") {
        if (live.status === "established" && live.text) row.mbrValue = live.text;
        else delete row.mbrValue;
        if (live.status === "established" && live.unit) row.mbrUnit = live.unit;
        else delete row.mbrUnit;
      }
      if (limit) {
        if (live.status === "established" && live.text) limit.value = live.text;
        else delete limit.value;
        if (live.status === "established" && live.unit) limit.unit = live.unit;
        else delete limit.unit;
      }
      return { action: "mbr_trd_refresh", path: rowPath(rec, section, block, rowId), detail: `TRD value brought up to date for "${target.label}" in block "${block.title}" in ${rec.id}`, before: { trdValue: beforeText }, after: { trdValue: afterText } };
    }
    throw new MbrError(`Row ${rowId} is not in ${rec.id}`);
  });
}

// ------------------------------------------------------------------ time limits

function limitLoc(rec: MbrRecord, limitId: string) {
  for (const section of rec.sections) for (const block of section.blocks) {
    const limit = block.timeLimits.find((t) => t.id === limitId);
    if (limit) return { section, block, limit };
  }
  throw new MbrError(`Time limit ${limitId} is not in ${rec.id}`);
}

const limitSnapshot = (t: MbrTimeLimit) => ({ label: t.label, value: t.value, unit: t.unit });

export function addTimeLimit(project: Project, recordId: string, blockId: string, input: { label: string; ref?: TrdRowRef }, actor: Actor): { project: Project; limitId: string } {
  let limitId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const { section, block } = blockLoc(rec, blockId);
    const label = text(input.label);
    if (!label) throw new MbrError("The time limit needs a label");
    limitId = ids("R");
    const trd = input.ref ? trdRowFor({ unitOp: section.unitOp, trd: trdOf(project, rec), at: actor.at }, input.ref.collection, input.ref.itemKey, input.ref.field) : undefined;
    const ok = trd && trd.status === "established";
    block.timeLimits.push(clean({ id: limitId, label, trd, value: ok ? trd.text : undefined, unit: ok ? trd.unit : undefined, targets: [] }));
    return { action: "mbr_time_limit_add", path: rowPath(rec, section, block, limitId), detail: `Time limit "${label}" added to block "${block.title}" in ${rec.id}`, after: { label } };
  });
  return { project: out, limitId };
}

export function setTimeLimit(project: Project, recordId: string, limitId: string, patch: { label?: string; value?: string | null; unit?: string | null }, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, limit } = limitLoc(rec, limitId);
    const before = limitSnapshot(limit);
    if (patch.label !== undefined) {
      const l = text(patch.label);
      if (!l) throw new MbrError("The time limit needs a label");
      limit.label = l;
    }
    if (patch.value !== undefined) {
      const v = text(patch.value);
      if (v) limit.value = v;
      else delete limit.value;
    }
    if (patch.unit !== undefined) {
      const u = text(patch.unit);
      if (u) limit.unit = u;
      else delete limit.unit;
    }
    const after = limitSnapshot(limit);
    if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
    return { action: "mbr_time_limit_update", path: rowPath(rec, section, block, limitId), detail: `Time limit "${limit.label}" edited in block "${block.title}" in ${rec.id}`, before, after };
  });
}

export function removeTimeLimit(project: Project, recordId: string, limitId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    const { section, block, limit } = limitLoc(rec, limitId);
    block.timeLimits = block.timeLimits.filter((t) => t.id !== limitId);
    return { action: "mbr_time_limit_remove", path: rowPath(rec, section, block, limitId), detail: `Time limit "${limit.label}" removed from block "${block.title}" in ${rec.id}`, before: { ...limitSnapshot(limit), targets: limit.targets } };
  });
}

export interface TargetInput {
  label: string;
  value?: string;
  unit?: string;
  fromStepId?: string;
  toStepId?: string;
}

export function addTarget(project: Project, recordId: string, limitId: string, input: TargetInput, actor: Actor): { project: Project; targetId: string } {
  let targetId = "";
  const out = mutate(project, recordId, actor, (rec, ids) => {
    const { section, block, limit } = limitLoc(rec, limitId);
    const label = text(input.label);
    if (!label) throw new MbrError("The target needs a label");
    targetId = ids("R");
    limit.targets.push(clean({ id: targetId, label, value: text(input.value) || undefined, unit: text(input.unit) || undefined, fromStepId: input.fromStepId || undefined, toStepId: input.toStepId || undefined }));
    return { action: "mbr_target_add", path: rowPath(rec, section, block, targetId), detail: `Target "${label}" added under time limit "${limit.label}" in ${rec.id}`, after: clean({ label, value: text(input.value) || undefined, unit: text(input.unit) || undefined }) };
  });
  return { project: out, targetId };
}

export function updateTarget(project: Project, recordId: string, targetId: string, patch: Partial<Record<keyof TargetInput, string | null>>, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    for (const section of rec.sections) for (const block of section.blocks) for (const limit of block.timeLimits) {
      const t = limit.targets.find((x) => x.id === targetId);
      if (!t) continue;
      const snap = () => ({ label: t.label, value: t.value, unit: t.unit, fromStep: t.fromStepId, toStep: t.toStepId });
      const before = snap();
      for (const k of ["label", "value", "unit", "fromStepId", "toStepId"] as const) {
        if (patch[k] === undefined) continue;
        const v = text(patch[k]);
        if (k === "label" && !v) throw new MbrError("The target needs a label");
        if (v) t[k] = v;
        else delete t[k];
      }
      const after = snap();
      if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
      return { action: "mbr_target_update", path: rowPath(rec, section, block, targetId), detail: `Target "${t.label}" edited under time limit "${limit.label}" in ${rec.id}`, before, after };
    }
    throw new MbrError(`Target ${targetId} is not in ${rec.id}`);
  });
}

export function removeTarget(project: Project, recordId: string, targetId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    for (const section of rec.sections) for (const block of section.blocks) for (const limit of block.timeLimits) {
      const t = limit.targets.find((x) => x.id === targetId);
      if (!t) continue;
      limit.targets = limit.targets.filter((x) => x.id !== targetId);
      return { action: "mbr_target_remove", path: rowPath(rec, section, block, targetId), detail: `Target "${t.label}" removed from time limit "${limit.label}" in ${rec.id}`, before: { label: t.label, value: t.value, unit: t.unit } };
    }
    throw new MbrError(`Target ${targetId} is not in ${rec.id}`);
  });
}

// ------------------------------------------------------------------ sample rows

export function addSampleRows(project: Project, recordId: string, blockId: string, pointIds: string[], actor: Actor): Project {
  return mutate(project, recordId, actor, (rec, ids) => {
    const { section, block } = blockLoc(rec, blockId);
    const plan = planOf(project, rec);
    if (!plan) throw new MbrError("This batch record has no sampling plan to take sample rows from");
    const have = new Set(block.samples.map((s) => s.pointId));
    const added: string[] = [];
    for (const pid of pointIds) {
      const p = plan.points.find((x) => x.id === pid);
      if (!p) throw new MbrError(`Sample point ${pid} is not in ${plan.id}`);
      if (have.has(pid)) continue;
      block.samples.push(sampleRow(plan, p, ids("R")));
      added.push(pid);
    }
    if (added.length === 0) return undefined;
    return { action: "mbr_sample_add", path: rowPath(rec, section, block), detail: `${added.length} sample row${added.length === 1 ? "" : "s"} (${added.join(", ")}) added to block "${block.title}" in ${rec.id}`, after: { samplingPointIds: added.join(", ") } };
  });
}

export function removeSampleRow(project: Project, recordId: string, rowId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    for (const section of rec.sections) for (const block of section.blocks) {
      const row = block.samples.find((s) => s.id === rowId);
      if (!row) continue;
      block.samples = block.samples.filter((s) => s.id !== rowId);
      return { action: "mbr_sample_remove", path: rowPath(rec, section, block, rowId), detail: `Sample row ${row.pointId} removed from block "${block.title}" in ${rec.id}`, before: { samplingPointIds: row.pointId, test: row.test } };
    }
    throw new MbrError(`Sample row ${rowId} is not in ${rec.id}`);
  });
}

/** Brings a sample row up to what the sampling plan says now. */
export function updateSampleRowFromPlan(project: Project, recordId: string, rowId: string, actor: Actor): Project {
  return mutate(project, recordId, actor, (rec) => {
    for (const section of rec.sections) for (const block of section.blocks) {
      const row = block.samples.find((s) => s.id === rowId);
      if (!row) continue;
      const plan = project.sampling.plans.find((p) => p.id === row.planId);
      const point = plan?.points.find((p) => p.id === row.pointId);
      if (!plan || !point) throw new MbrError(`Sample point ${row.pointId} is no longer in the sampling plan`);
      const d = sampleDiff(row, plan);
      if (d.keys.length === 0) return undefined;
      const live = sampleFieldsOf(plan, point);
      const before: Record<string, string | undefined> = {};
      const after: Record<string, string | undefined> = {};
      for (const k of d.keys) {
        before[k] = row[k];
        after[k] = live[k];
        if (live[k] === undefined) delete row[k];
        else row[k] = live[k] as string;
      }
      return { action: "mbr_sample_refresh", path: rowPath(rec, section, block, rowId), detail: `Sample row ${row.pointId} brought up to date with the sampling plan in block "${block.title}" in ${rec.id}`, before, after };
    }
    throw new MbrError(`Sample row ${rowId} is not in ${rec.id}`);
  });
}

export interface SampleNotice {
  blockId: string;
  rowId: string;
  pointId: string;
  missing: boolean;
  keys: string[];
}

/** Sample rows that no longer say what the sampling plan says ("changed in the sampling plan"). */
export function sampleNotices(project: Project, rec: MbrRecord): SampleNotice[] {
  const out: SampleNotice[] = [];
  for (const s of rec.sections) for (const b of s.blocks) for (const r of b.samples) {
    const plan = project.sampling.plans.find((p) => p.id === r.planId);
    const d = sampleDiff(r, plan);
    if (d.missing || d.keys.length) out.push({ blockId: b.id, rowId: r.id, pointId: r.pointId, missing: d.missing, keys: d.keys });
  }
  return out;
}

// ------------------------------------------------------------------ open items and TRD requirements

export interface TrdRequirement {
  stepId: string;
  unitOp: string;
  stepLabel: string;
  collection: TrdItem["collection"] & MbrTrdRef["collection"];
  itemKey: string;
  label: string;
  /** The field a new row would pull (set point, PAR, NOR or the first field that holds a value). */
  field: string;
  /** Library blocks that pull this item. */
  suggestedBlockIds: string[];
}

/** The field of a TRD item that carries its value, in the order a batch record needs it: set point, then PAR, then NOR, then a field. */
export function requirementField(item: TrdItem): string | undefined {
  const lim = item.limits;
  if (lim?.setPoint) return "setPoint";
  const established = (key: string) => {
    const f = item.fields.find((x) => x.key === key);
    return f ? effectiveField(f).status === "established" : false;
  };
  if (established("setPoint")) return "setPoint";
  if (lim?.par) return "par";
  if (lim?.nor) return "nor";
  const other = item.fields.find((f) => f.key !== "classification" && effectiveField(f).status === "established");
  return other?.key;
}

/** TRD parameters and in-process controls with a value that no row of the record carries ("TRD requirement without an MBR step"). */
export function trdRequirementsWithoutStep(rec: MbrRecord, trd: TrdDocument | undefined, library: readonly MbrLibraryBlock[] = []): TrdRequirement[] {
  if (!trd) return [];
  const covered = new Set<string>();
  const cover = (ref: MbrTrdRef | undefined) => {
    if (ref) covered.add(ref.path.split(".").slice(0, 4).join("."));
  };
  for (const s of rec.sections) for (const b of s.blocks) {
    b.params.forEach((p) => cover(p.trd));
    b.timeLimits.forEach((t) => cover(t.trd));
  }
  const out: TrdRequirement[] = [];
  for (const step of trd.steps) {
    if (!step.key) continue;
    for (const item of step.items) {
      if (item.collection !== "param" && item.collection !== "ipc") continue;
      const field = requirementField(item);
      if (!field) continue;
      if (covered.has(`uo.${step.key}.${item.collection}.${item.key}`)) continue;
      out.push({
        stepId: step.id,
        unitOp: step.key,
        stepLabel: step.label,
        collection: item.collection,
        itemKey: item.key,
        label: item.label,
        field,
        suggestedBlockIds: library.filter((b) => (b.unitOps.length === 0 || b.unitOps.includes(step.key!)) && [...b.params, ...b.timeLimits].some((p) => p.collection === item.collection && p.itemKey === item.key)).map((b) => b.id),
      });
    }
  }
  return out;
}

/**
 * Adds a block for a TRD requirement that has no step yet. With a library block, that block is placed (its rows pull the item); without
 * one, a block of the author's is made with a row for the item. The section for the unit operation is created when the record has none.
 */
export function addBlockForRequirement(
  project: Project,
  recordId: string,
  req: TrdRequirement,
  library: MbrLibraryBlock | undefined,
  actor: Actor,
  sectionIndex?: number,
  sectionTitle?: string,
): { project: Project; blockId: string } {
  let p = project;
  const rec = recOf(p, recordId);
  let section = rec.sections.find((s) => s.unitOp === req.unitOp);
  if (!section) {
    const r = addSection(p, recordId, { unitOp: req.unitOp, title: sectionTitle ?? req.stepLabel }, actor, sectionIndex);
    p = r.project;
    section = recOf(p, recordId).sections.find((s) => s.id === r.sectionId)!;
  }
  if (library) return addBlockFromLibrary(p, recordId, section.id, library, actor);
  const b = addCustomBlock(p, recordId, section.id, { title: req.label }, actor);
  const row = addParamRow(b.project, recordId, b.blockId, { label: req.label, ref: { collection: req.collection, itemKey: req.itemKey, field: req.field } }, actor);
  return { project: row.project, blockId: b.blockId };
}

export interface MbrOpenItem {
  kind: "not_decided" | "no_step" | "broken_reference" | "no_trd_value";
  where: string;
  text: string;
  blockId?: string;
  rowId?: string;
}

/** Everything the record still leaves open, in document order. Information only. */
export function mbrOpenItems(project: Project, rec: MbrRecord, library: readonly MbrLibraryBlock[] = []): MbrOpenItem[] {
  const out: MbrOpenItem[] = [];
  for (const s of rec.sections) for (const b of s.blocks) {
    for (const r of b.params) {
      const where = `${s.title}, ${b.title}, ${r.label}`;
      if (r.studyPoint) continue;
      if (!r.choice || r.choice === "not_decided") out.push({ kind: "not_decided", where, text: "Not decided", blockId: b.id, rowId: r.id });
      else if (r.choice === "same_as_trd" && !r.mbrValue) out.push({ kind: "no_trd_value", where, text: "Same as TRD, but the TRD value is not held by the site", blockId: b.id, rowId: r.id });
    }
  }
  for (const q of trdRequirementsWithoutStep(rec, trdOf(project, rec), library)) out.push({ kind: "no_step", where: `${q.stepLabel}, ${q.label}`, text: "TRD requirement without an MBR step" });
  for (const x of brokenReferences(rec)) {
    const s = rec.sections.find((sec) => sec.id === x.sectionId)!;
    out.push({ kind: "broken_reference", where: s.title, text: "A step reference points to a step that was removed", blockId: x.blockId });
  }
  return out;
}
