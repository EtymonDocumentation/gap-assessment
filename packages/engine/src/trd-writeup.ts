import {
  BLANK_PATTERN,
  blanksOf,
  resolveEntry,
  trdDocumentSchema,
  type Actor,
  type ChangeEvent,
  type Project,
  type TrdDocument,
  type TrdLibraryPart,
  type TrdLibraryWriteup,
  type TrdPart,
  type TrdPartKind,
  type TrdStep,
  type TrdWriteup,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import { formatResolved } from "./format";
import { resolveTrdValue } from "./mbr-values";
import { effectiveField } from "./trd";

/*
 * TRD write-ups: the record side. Copying a write-up from the library, editing its parts, switching optional parts, typing a value for
 * a blank, and updating from a newer library version. Every edit returns a new project and adds one change-log event with the old
 * content kept (GMP: a reviewer must be able to see what a description said before it was changed, and by whom).
 *
 * Rules kept here:
 *  - NO DEFAULTS. A blank with no known value stays an open placeholder showing its label. Nothing is filled in that the TRD, the
 *    project or the author did not state.
 *  - A value found for a blank is shown with where it came from. A value typed by the author wins over a found value.
 *  - Nothing blocks saving or exporting: no part is required and no blank must be filled.
 *  - The text never states a regulatory filing category.
 */

export class TrdWriteupError extends Error {}

const text = (v: string | undefined) => (v ?? "").trim();
const pad = (n: number) => String(n).padStart(2, "0");

function log(project: Project, actor: Actor, ev: Omit<ChangeEvent, "at" | "by">): void {
  project.changeLog.push({ at: actor.at, by: actor.name, ...ev });
}

function docOf(project: Project, id: string): TrdDocument {
  const d = project.trd.documents.find((x) => x.id === id);
  if (!d) throw new TrdWriteupError(`TRD ${id} does not exist`);
  return d;
}

function writeupOf(d: TrdDocument, id: string): TrdWriteup {
  const w = (d.writeups ?? []).find((x) => x.id === id);
  if (!w) throw new TrdWriteupError(`Write-up ${id} does not exist in ${d.id}`);
  return w;
}

function assertValid(d: TrdDocument): void {
  const r = trdDocumentSchema.safeParse(d);
  if (!r.success) throw new TrdWriteupError(r.error.issues[0]?.message ?? "The TRD is not valid");
}

/** Next WU id. Ids are never reused: an id that survives only in the change log still counts as taken. */
function nextWriteupId(project: Project, d: TrdDocument, taken: readonly string[] = []): string {
  let max = 0;
  const take = (id: string) => {
    const m = /^WU-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  (d.writeups ?? []).forEach((w) => take(w.id));
  taken.forEach(take);
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] === "trd" && parts[1] === d.id) take(parts[2] ?? "");
  }
  return `WU-${pad(max + 1)}`;
}

const wuPath = (d: TrdDocument, w: TrdWriteup) => `trd.${d.id}.${w.id}`;

// ------------------------------------------------------------------ copying from the library

/** A TRD's copy of a library write-up: the parts as they are, optional parts switched off, the library id and version kept. */
export function writeupFromLibrary(lib: TrdLibraryWriteup, id: string, stepId?: string): TrdWriteup {
  return {
    id,
    kind: lib.kind,
    key: lib.key,
    ...(stepId ? { stepId } : {}),
    title: lib.title,
    libraryId: lib.id,
    libraryVersion: lib.version,
    ...(lib.placement ? { placement: structuredClone(lib.placement) } : {}),
    ...(lib.appliesWhen ? { appliesWhen: lib.appliesWhen } : {}),
    parts: structuredClone(lib.parts) as TrdPart[],
    ...(lib.notApplicable ? { notApplicable: { ...structuredClone(lib.notApplicable), on: false } } : {}),
  };
}

/**
 * The write-ups a new TRD starts with: every library section marked to be added, then, per step in process order, the unit-operation
 * write-ups for the step's unit operation. A write-up marked `autoAdd: false` is only offered in the picker.
 */
export function seedWriteups(project: Project, d: TrdDocument, library: readonly TrdLibraryWriteup[]): TrdWriteup[] {
  const out: TrdWriteup[] = [];
  const take = (lib: TrdLibraryWriteup, stepId?: string) => out.push(writeupFromLibrary(lib, nextWriteupId(project, d, out.map((w) => w.id)), stepId));
  for (const lib of library) if (lib.kind === "section" && lib.autoAdd !== false) take(lib);
  for (const s of d.steps) {
    if (!s.key) continue;
    for (const lib of library) if (lib.kind === "unitOp" && lib.key === s.key && lib.autoAdd !== false) take(lib, s.id);
  }
  return out;
}

/** Library write-ups the TRD does not hold yet, for the "Add from library" picker (a unit-op write-up per step it fits). */
export function writeupsAvailable(d: TrdDocument, library: readonly TrdLibraryWriteup[]): { lib: TrdLibraryWriteup; step?: TrdStep }[] {
  const have = d.writeups ?? [];
  const out: { lib: TrdLibraryWriteup; step?: TrdStep }[] = [];
  for (const lib of library) {
    if (lib.kind === "section") {
      if (!have.some((w) => w.libraryId === lib.id)) out.push({ lib });
      continue;
    }
    for (const s of d.steps) if (s.key === lib.key && !have.some((w) => w.libraryId === lib.id && w.stepId === s.id)) out.push({ lib, step: s });
  }
  return out;
}

export function addWriteupFromLibrary(project: Project, trdId: string, lib: TrdLibraryWriteup, stepId: string | undefined, actor: Actor): { project: Project; writeupId: string } {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  if (lib.kind === "unitOp") {
    if (!stepId || !d.steps.some((s) => s.id === stepId)) throw new TrdWriteupError("Choose the step this process description belongs to");
  }
  const w = writeupFromLibrary(lib, nextWriteupId(next, d), lib.kind === "unitOp" ? stepId : undefined);
  d.writeups = [...(d.writeups ?? []), w];
  assertValid(d);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_add", path: wuPath(d, w), detail: `${w.id} "${w.title}" added to ${d.id} from the library (version ${lib.version})`, after: { id: w.id, libraryId: lib.id, libraryVersion: lib.version, stepId: w.stepId ?? null } });
  return { project: next, writeupId: w.id };
}

export function removeWriteup(project: Project, trdId: string, writeupId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  d.writeups = (d.writeups ?? []).filter((x) => x.id !== writeupId);
  if (!d.writeups.length) delete d.writeups;
  d.updatedAt = actor.at;
  // The whole write-up is kept in the log, so removing it never loses what it said.
  log(next, actor, { action: "trd_writeup_remove", path: wuPath(d, w), detail: `${w.id} "${w.title}" removed from ${d.id}`, before: w });
  return next;
}

// ------------------------------------------------------------------ editing parts

function partOf(w: TrdWriteup, partId: string): TrdPart {
  const p = w.parts.find((x) => x.id === partId);
  if (!p) throw new TrdWriteupError(`Part ${partId} does not exist in ${w.id}`);
  return p;
}

const partLabel = (p: TrdPart) => p.title || p.text.slice(0, 60) || p.id;

/** Changes the text (and, for a heading, the title) of a part. */
export function setPartText(project: Project, trdId: string, writeupId: string, partId: string, patch: { text?: string; title?: string }, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  const before = { text: p.text, ...(p.title !== undefined ? { title: p.title } : {}) };
  if (patch.text !== undefined) p.text = patch.text.replace(/\r\n/g, "\n");
  if (patch.title !== undefined) {
    if ((p.kind === "subsection" || p.kind === "heading") && !text(patch.title)) throw new TrdWriteupError("A heading needs its words");
    p.title = patch.title;
  }
  if (p.text === before.text && p.title === before.title) return project;
  p.edited = true;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_edit", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": text of "${partLabel(p)}" edited`, before, after: { text: p.text, ...(p.title !== undefined ? { title: p.title } : {}) } });
  assertValid(d);
  return next;
}

/** Sets the rows of a table part (the author's cells). The column heads stay as the library has them. */
export function setTableRows(project: Project, trdId: string, writeupId: string, partId: string, rows: string[][], actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  if (p.kind !== "table") throw new TrdWriteupError("Only a table part has rows");
  const width = p.columns?.length ?? 0;
  const clean = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  if (JSON.stringify(clean) === JSON.stringify(p.rows ?? [])) return project;
  const before = p.rows ?? [];
  if (clean.length) p.rows = clean;
  else delete p.rows;
  p.edited = true;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_edit", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": rows of the table "${partLabel(p)}" edited`, before: { rows: before }, after: { rows: clean } });
  assertValid(d);
  return next;
}

/** Switches an optional part on or off. A part that is not optional is always in. */
export function setPartIncluded(project: Project, trdId: string, writeupId: string, partId: string, included: boolean, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  if (!p.optional) throw new TrdWriteupError("Only an optional part can be switched on or off");
  if (Boolean(p.included) === included) return project;
  if (included) p.included = true;
  else delete p.included;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_toggle", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": optional part "${partLabel(p)}" switched ${included ? "on" : "off"} (${p.optional.condition})`, before: { included: !included }, after: { included } });
  assertValid(d);
  return next;
}

/** Marks a whole write-up not applicable (or applicable again), where the library entry allows it. */
export function setNotApplicable(project: Project, trdId: string, writeupId: string, on: boolean, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  if (!w.notApplicable) throw new TrdWriteupError("This write-up cannot be marked not applicable");
  if (w.notApplicable.on === on) return project;
  w.notApplicable.on = on;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_toggle", path: wuPath(d, w), detail: `${w.id} "${w.title}" marked ${on ? "not applicable" : "applicable"} (${w.notApplicable.condition})`, before: { notApplicable: !on }, after: { notApplicable: on } });
  assertValid(d);
  return next;
}

/** Removes one paragraph (part). The library id is remembered so an update from the library does not bring it back as new. */
export function removePart(project: Project, trdId: string, writeupId: string, partId: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  w.parts = w.parts.filter((x) => x.id !== partId);
  if (!isAuthorPart(p.id)) w.removed = [...new Set([...(w.removed ?? []), p.id])];
  d.updatedAt = actor.at;
  // The whole part is kept in the log.
  log(next, actor, { action: "trd_writeup_part_remove", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": "${partLabel(p)}" removed`, before: p });
  assertValid(d);
  return next;
}

/** Author-added parts get ids starting with "x_" so they are never mistaken for library parts. */
const isAuthorPart = (id: string) => id.startsWith("x_");

export interface NewPart {
  kind: TrdPartKind;
  text: string;
  title?: string;
  columns?: string[];
}

/** Adds a part the author wrote (after another part, or at the end). */
export function addPart(project: Project, trdId: string, writeupId: string, input: NewPart, actor: Actor, afterPartId?: string): { project: Project; partId: string } {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  if ((input.kind === "subsection" || input.kind === "heading") && !text(input.title)) throw new TrdWriteupError("A heading needs its words");
  if (input.kind === "table" && !(input.columns ?? []).length) throw new TrdWriteupError("A table needs at least one column head");
  let n = 1;
  while (w.parts.some((p) => p.id === `x_${n}`)) n++;
  const part: TrdPart = {
    id: `x_${n}`,
    kind: input.kind,
    text: input.kind === "subsection" || input.kind === "heading" || input.kind === "table" ? "" : input.text.replace(/\r\n/g, "\n"),
    ...(text(input.title) ? { title: text(input.title) } : {}),
    ...(input.kind === "table" ? { columns: input.columns!.map((c) => c.trim()).filter(Boolean) } : {}),
  };
  const at = afterPartId ? w.parts.findIndex((p) => p.id === afterPartId) : -1;
  if (at >= 0) w.parts.splice(at + 1, 0, part);
  else w.parts.push(part);
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_edit", path: `${wuPath(d, w)}.${part.id}`, detail: `${w.id} "${w.title}": ${input.kind} added`, after: part });
  assertValid(d);
  return { project: next, partId: part.id };
}

/** Types (or clears, with an empty value) the value of a blank. The value is the author's own and wins over a value found elsewhere. */
export function setBlankValue(project: Project, trdId: string, writeupId: string, key: string, value: string, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const v = text(value);
  const before = w.values?.[key]?.value;
  if ((before ?? "") === v) return project;
  if (v) w.values = { ...(w.values ?? {}), [key]: { value: v, by: actor.name, at: actor.at } };
  else if (w.values) {
    delete w.values[key];
    if (!Object.keys(w.values).length) delete w.values;
  }
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_value", path: `${wuPath(d, w)}.${key}`, detail: `${w.id} "${w.title}": ${v ? "value entered for" : "value cleared for"} ${key}`, ...(before !== undefined ? { before: { value: before } } : {}), ...(v ? { after: { value: v } } : {}) });
  assertValid(d);
  return next;
}

// ------------------------------------------------------------------ update from the library

const sameContent = (a: TrdLibraryPart, b: TrdLibraryPart) =>
  a.kind === b.kind && a.text === b.text && (a.title ?? "") === (b.title ?? "") && JSON.stringify(a.columns ?? []) === JSON.stringify(b.columns ?? []) && (a.optional?.condition ?? "") === (b.optional?.condition ?? "");

export interface WriteupDifference {
  titleChanged: boolean;
  /** Library parts the TRD does not hold (new in the library, and not removed by the author). */
  added: TrdLibraryPart[];
  /** Parts whose library text differs and which the author did not edit: they would be replaced. */
  changed: { part: TrdPart; library: TrdLibraryPart }[];
  /** Parts the library no longer has and the author did not edit: they would be dropped. */
  dropped: TrdPart[];
  /** Parts the author edited: kept as they are, whatever the library says. */
  keptEdited: TrdPart[];
  /** New library parts the author had removed earlier: not brought back. */
  skippedRemoved: TrdLibraryPart[];
}

/** What an update from the library would do, part by part. This is the note shown before the author chooses. */
export function writeupDifference(w: TrdWriteup, lib: TrdLibraryWriteup): WriteupDifference {
  const removed = new Set(w.removed ?? []);
  const local = new Map(w.parts.map((p) => [p.id, p]));
  const libIds = new Set(lib.parts.map((p) => p.id));
  const added: TrdLibraryPart[] = [];
  const changed: { part: TrdPart; library: TrdLibraryPart }[] = [];
  const keptEdited: TrdPart[] = [];
  const skippedRemoved: TrdLibraryPart[] = [];
  for (const lp of lib.parts) {
    const p = local.get(lp.id);
    if (!p) {
      if (removed.has(lp.id)) skippedRemoved.push(lp);
      else added.push(lp);
    } else if (!sameContent(p, lp)) {
      if (p.edited) keptEdited.push(p);
      else changed.push({ part: p, library: lp });
    }
  }
  const dropped: TrdPart[] = [];
  for (const p of w.parts) {
    if (isAuthorPart(p.id) || libIds.has(p.id)) continue;
    if (p.edited) keptEdited.push(p);
    else dropped.push(p);
  }
  return { titleChanged: w.title !== lib.title, added, changed, dropped, keptEdited, skippedRemoved };
}

export const differenceIsEmpty = (x: WriteupDifference): boolean => !x.titleChanged && !x.added.length && !x.changed.length && !x.dropped.length;

/** One line saying what the update does, for the note and the change log. */
export function differenceText(x: WriteupDifference): string {
  const bits = [
    x.titleChanged ? "new title" : "",
    x.added.length ? `${x.added.length} new part${x.added.length === 1 ? "" : "s"}` : "",
    x.changed.length ? `${x.changed.length} changed part${x.changed.length === 1 ? "" : "s"}` : "",
    x.dropped.length ? `${x.dropped.length} part${x.dropped.length === 1 ? "" : "s"} no longer in the library` : "",
  ].filter(Boolean);
  const kept = x.keptEdited.length ? `${x.keptEdited.length} part${x.keptEdited.length === 1 ? "" : "s"} you edited stay${x.keptEdited.length === 1 ? "s" : ""} as you wrote ${x.keptEdited.length === 1 ? "it" : "them"}` : "";
  const skipped = x.skippedRemoved.length ? `${x.skippedRemoved.length} new part${x.skippedRemoved.length === 1 ? "" : "s"} you had removed earlier ${x.skippedRemoved.length === 1 ? "is" : "are"} not brought back` : "";
  return [bits.join(", ") || "no change to the parts", kept, skipped].filter(Boolean).join("; ");
}

/**
 * Brings a write-up up to the library version. The author chose to do this, having seen the difference. Parts the author edited are
 * kept; parts the author removed stay removed; optional parts keep their on/off choice; values typed for blanks are kept.
 */
export function updateWriteupFromLibrary(project: Project, trdId: string, writeupId: string, lib: TrdLibraryWriteup, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  if (w.libraryId !== lib.id) throw new TrdWriteupError("This write-up was not made from that library entry");
  const diff = writeupDifference(w, lib);
  const before = structuredClone(w);
  const local = new Map(w.parts.map((p) => [p.id, p]));
  const removed = new Set(w.removed ?? []);
  const merged: TrdPart[] = [];
  for (const lp of lib.parts) {
    const p = local.get(lp.id);
    if (p) {
      if (p.edited) merged.push(p);
      else merged.push({ ...structuredClone(lp), ...(p.included ? { included: true } : {}) } as TrdPart);
    } else if (!removed.has(lp.id)) merged.push(structuredClone(lp) as TrdPart);
  }
  // Parts the author wrote, and library parts they edited that the library dropped, stay after the part that preceded them.
  const libIds = new Set(lib.parts.map((p) => p.id));
  w.parts.forEach((p, i) => {
    if (libIds.has(p.id) || !(isAuthorPart(p.id) || p.edited)) return;
    let at = merged.length;
    for (let j = i - 1; j >= 0; j--) {
      const k = merged.findIndex((m) => m.id === w.parts[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    if (at === merged.length && i === 0) at = 0;
    merged.splice(at, 0, p);
  });
  w.parts = merged;
  w.title = lib.title;
  w.libraryVersion = lib.version;
  if (lib.appliesWhen) w.appliesWhen = lib.appliesWhen;
  else delete w.appliesWhen;
  if (lib.placement) w.placement = structuredClone(lib.placement);
  else delete w.placement;
  if (lib.notApplicable) w.notApplicable = { ...structuredClone(lib.notApplicable), on: w.notApplicable?.on ?? false };
  else delete w.notApplicable;
  d.updatedAt = actor.at;
  log(next, actor, {
    action: "trd_writeup_update",
    path: wuPath(d, w),
    detail: `${w.id} "${w.title}" updated from the library, version ${before.libraryVersion ?? "?"} to ${lib.version}: ${differenceText(diff)}`,
    before,
    after: { libraryVersion: lib.version, added: diff.added.map((p) => p.id), changed: diff.changed.map((c) => c.part.id), dropped: diff.dropped.map((p) => p.id), keptEdited: diff.keptEdited.map((p) => p.id) },
  });
  assertValid(d);
  return next;
}

// ------------------------------------------------------------------ blanks

export type BlankOrigin = "entered" | "trd" | "details" | "project";

/** A blank after lookup. `filled` false: it stays a visible placeholder showing `label`. */
export interface ResolvedBlank {
  key: string;
  label: string;
  filled: boolean;
  value?: string;
  origin?: BlankOrigin;
  /** Where the value came from, in words ("TRD, Sterile filtration", "entered here by ..."). */
  where?: string;
  /** Documents behind a TRD value (ids of the project's source register) and where in each. */
  sourceIds?: string[];
  locations?: Record<string, { section?: string; page?: string }>;
  /** Why an unfilled blank is open when something was found ("To be determined (TBD)"). */
  note?: string;
}

export interface BlankContext {
  project: Project;
  doc: TrdDocument;
  /** Needed to read project answers (labels of choices). Without it only TRD values and typed values fill a blank. */
  content?: ContentBundle;
}

/** The TRD details the scope and site keys read first (the TRD owns them: the author may have overridden the project's answer). */
const DETAIL_OF_KEY: Record<string, string> = {
  "scope.program": "program",
  "scope.modality": "modality",
  "scope.dosage_form": "dosageForm",
  "scope.presentation": "presentation",
  "site.name": "site",
  "site.line": "line",
  "site.programStage": "programStage",
};

/** Keys that name the sending side: read from the project's source answers, since the TRD holds the receiving unit only. */
const SOURCE_SIDE_KEYS: Record<string, string> = { "site.sendingName": "site.name", "trd.sendingSiteName": "site.name" };

const UO_KEY = /^uo\.([a-z0-9_]+)\.(param|equip|mat|ipc|doc|study)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/;

function projectAnswer(ctx: BlankContext, path: string, side: "target" | "source"): string | undefined {
  const content = ctx.content;
  if (!content) return undefined;
  const q = content.questions.find((x) => x.binds === path && !x.parent);
  if (!q) return undefined;
  const ref = q.sides === "shared" ? path : `${side}.${path}`;
  const r = resolveEntry(ctx.project, ref);
  if (r.status !== "established" || r.value === undefined) return undefined;
  return formatResolved(content, q, r);
}

/** The value of a blank from the TRD record and the project, ignoring anything typed into a write-up. */
export function lookupBlank(ctx: BlankContext, key: string, label: string): ResolvedBlank {
  const open = (note?: string): ResolvedBlank => ({ key, label, filled: false, ...(note ? { note } : {}) });
  const detailKey = DETAIL_OF_KEY[key];
  if (detailKey) {
    const f = ctx.doc.details.find((x) => x.key === detailKey);
    if (f) {
      const v = effectiveField(f);
      if (v.status === "established") return { key, label, filled: true, value: v.text, origin: "details", where: `TRD, ${f.label}` };
      if (v.status === "not_applicable") return { key, label, filled: true, value: v.text, origin: "details", where: `TRD, ${f.label}` };
      if (v.status === "tbd") return open("To be determined (TBD)");
    }
  }
  const m = UO_KEY.exec(key);
  if (m) {
    const t = resolveTrdValue(ctx.doc, m[1]!, m[2] as Parameters<typeof resolveTrdValue>[2], m[3]!, m[4]!, ctx.doc.updatedAt);
    if (t.status === "established" && (t.text ?? "").trim()) {
      return {
        key,
        label,
        filled: true,
        value: [t.text, t.unit].filter(Boolean).join(" "),
        origin: "trd",
        where: `TRD, ${t.section || "process step"}`,
        ...(t.sourceIds.length ? { sourceIds: [...t.sourceIds] } : {}),
        ...(t.locations ? { locations: structuredClone(t.locations) } : {}),
      };
    }
    if (t.status === "not_applicable") return { key, label, filled: true, value: t.text ?? "Not applicable", origin: "trd", where: `TRD, ${t.section || "process step"}` };
    return open(t.status === "tbd" ? "To be determined (TBD)" : undefined);
  }
  const sourcePath = SOURCE_SIDE_KEYS[key];
  if (sourcePath) {
    const v = projectAnswer(ctx, sourcePath, "source");
    return v !== undefined ? { key, label, filled: true, value: v, origin: "project", where: "Project answer (sending unit)" } : open();
  }
  if ((key.startsWith("scope.") || key.startsWith("site.")) && !detailKey) {
    const v = projectAnswer(ctx, key, "target");
    if (v !== undefined) return { key, label, filled: true, value: v, origin: "project", where: "Project answer (receiving unit)" };
  }
  return open();
}

/**
 * Resolves a blank of one write-up. Order: a value typed in this write-up; a value typed in another write-up of the same TRD (the
 * team typed it once, for example the total time out of refrigeration); then the TRD record and the project.
 */
export function resolveBlank(ctx: BlankContext, w: TrdWriteup, key: string, label: string): ResolvedBlank {
  const own = w.values?.[key];
  if (own && text(own.value)) return { key, label, filled: true, value: own.value, origin: "entered", where: `Entered in ${w.id} by ${own.by}` };
  for (const o of ctx.doc.writeups ?? []) {
    const v = o.values?.[key];
    if (o.id !== w.id && v && text(v.value)) return { key, label, filled: true, value: v.value, origin: "entered", where: `Entered in ${o.id} by ${v.by}` };
  }
  return lookupBlank(ctx, key, label);
}

/** Text with its blanks resolved: plain runs, bold runs and blanks, in order. */
export type TextSeg = { text: string; bold?: boolean } | { blank: ResolvedBlank; bold?: boolean };

/**
 * True when a blank starts inside a sentence: the text before it (this piece, or earlier segments when the piece starts with the
 * blank) has words and does not end with a full stop, colon, question or exclamation mark.
 */
function midSentence(before: string, earlier: readonly TextSeg[]): boolean {
  const prev = before || earlier.map((s) => ("blank" in s ? (s.blank.filled ? s.blank.value! : s.blank.label) : s.text)).join("");
  const t = prev.trimEnd();
  return t.length > 0 && !/[.:?!]$/.test(t);
}

/**
 * Catalog choice labels are written in sentence case to stand alone in a picker ("Received as ready-to-use liquid"); dropped into
 * a sentence they read as a stray capital ("The buffer is Received as ..."). Lower the first letter of a project or TRD value only,
 * never a typed value or a site name (both may be proper names), and never an acronym (second letter also upper case: "PES").
 */
function lowerChoiceLabel(b: ResolvedBlank): ResolvedBlank {
  if (!b.filled || !b.value || (b.origin !== "project" && b.origin !== "trd") || b.key.startsWith("site.") || b.key.startsWith("trd.sending")) return b;
  if (!/^[A-Z][a-z]/.test(b.value)) return b;
  return { ...b, value: b.value[0]!.toLowerCase() + b.value.slice(1) };
}

/** Splits text into **bold** pieces, then into blanks. Bold marks cannot nest; a stray ** stays as typed. */
export function segmentsOf(src: string, resolve: (key: string, label: string) => ResolvedBlank): TextSeg[] {
  const out: TextSeg[] = [];
  const pieces = src.split(/(\*\*[^*\n]+?\*\*)/);
  for (const piece of pieces) {
    if (!piece) continue;
    const bold = /^\*\*[^*\n]+?\*\*$/.test(piece);
    const body = bold ? piece.slice(2, -2) : piece;
    let last = 0;
    for (const m of body.matchAll(new RegExp(BLANK_PATTERN.source, "g"))) {
      if (m.index! > last) out.push({ text: body.slice(last, m.index), ...(bold ? { bold } : {}) });
      const resolved = resolve(m[1]!, (m[2] ?? "").trim() || m[1]!);
      const blank = midSentence(body.slice(0, m.index), out) ? lowerChoiceLabel(resolved) : resolved;
      out.push({ blank, ...(bold ? { bold } : {}) });
      last = m.index! + m[0].length;
    }
    if (last < body.length) out.push({ text: body.slice(last), ...(bold ? { bold } : {}) });
  }
  return out;
}

/** The text of a segment list as a reader sees it in plain text: an open blank shows its label in brackets. */
export function plainOfSegments(segs: readonly TextSeg[]): string {
  return segs.map((s) => ("blank" in s ? (s.blank.filled ? s.blank.value! : `[${s.blank.label}]`) : s.text)).join("");
}

/** The parts that are in the document: not optional, or optional and switched on. */
export const activeParts = (w: TrdWriteup): TrdPart[] => w.parts.filter((p) => !p.optional || p.included);

/** Every blank of the write-up's active parts, resolved, each key once. */
export function writeupBlanks(ctx: BlankContext, w: TrdWriteup): ResolvedBlank[] {
  if (w.notApplicable?.on) return blanksOf(w.notApplicable.text).map((b) => resolveBlank(ctx, w, b.key, b.label));
  const seen = new Set<string>();
  const out: ResolvedBlank[] = [];
  for (const p of activeParts(w)) {
    for (const b of [...blanksOf(p.text)]) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      out.push(resolveBlank(ctx, w, b.key, b.label));
    }
  }
  return out;
}

/** How many blanks of the write-up are still open (for the tab and the export note). */
export const openBlankCount = (ctx: BlankContext, w: TrdWriteup): number => writeupBlanks(ctx, w).filter((b) => !b.filled).length;
