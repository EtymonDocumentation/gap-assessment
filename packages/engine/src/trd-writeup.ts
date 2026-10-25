import {
  BLANK_PATTERN,
  blanksOf,
  printableUnit,
  resolveEntry,
  TRD_IMAGES_MAX_TOTAL_BYTES,
  trdDocumentSchema,
  trdImageMeta,
  trdImageSchema,
  type TrdImage,
  type TrdPlacement,
  type Actor,
  type ChangeEvent,
  type Project,
  type TrdDocument,
  type TrdField,
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
import { planMove } from "./trd-writeup-order";

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

/**
 * A copy for the change log with every picture reduced to its facts (type, size, pixels, name, SHA-256). The log keeps what a
 * description said before a change, but a 2 MB picture copied into each log line would swell the project file without limit; the
 * hash lets a reviewer tell which picture it was.
 */
export function forChangeLog<T>(value: T): T {
  const copy = structuredClone(value);
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const img = rec.image as Partial<TrdImage> | undefined;
    if (img && typeof img.data === "string") rec.image = trdImageMeta(img as TrdImage);
    for (const k of Object.keys(rec)) walk(rec[k]);
  };
  walk(copy);
  return copy;
}

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
  log(next, actor, { action: "trd_writeup_remove", path: wuPath(d, w), detail: `${w.id} "${w.title}" removed from ${d.id}`, before: forChangeLog(w) });
  return next;
}

// ------------------------------------------------------------------ editing parts

function partOf(w: TrdWriteup, partId: string): TrdPart {
  const p = w.parts.find((x) => x.id === partId);
  if (!p) throw new TrdWriteupError(`Part ${partId} does not exist in ${w.id}`);
  return p;
}

const partLabel = (p: TrdPart) => p.title || p.caption || p.text.slice(0, 60) || (p.kind === "table" ? (p.columns ?? []).join(", ") : "") || p.id;

/** Changes the text (and, for a heading, the title) of a part. */
export function setPartText(project: Project, trdId: string, writeupId: string, partId: string, patch: { text?: string; title?: string; caption?: string; alt?: string }, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  const snap = () => ({ text: p.text, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.caption !== undefined ? { caption: p.caption } : {}), ...(p.alt !== undefined ? { alt: p.alt } : {}) });
  const before = snap();
  if (patch.text !== undefined) p.text = patch.text.replace(/\r\n/g, "\n");
  if (patch.title !== undefined) {
    if ((p.kind === "subsection" || p.kind === "heading") && !text(patch.title)) throw new TrdWriteupError("A heading needs its words");
    p.title = patch.title;
  }
  // A caption and alternative text belong to a figure; an emptied one is removed rather than kept as an empty string.
  if (patch.caption !== undefined || patch.alt !== undefined) {
    if (p.kind !== "figure") throw new TrdWriteupError("Only a figure has a caption and alternative text");
    if (patch.caption !== undefined) {
      if (text(patch.caption)) p.caption = patch.caption.trim();
      else delete p.caption;
    }
    if (patch.alt !== undefined) {
      if (text(patch.alt)) p.alt = patch.alt.trim();
      else delete p.alt;
    }
  }
  if (JSON.stringify(snap()) === JSON.stringify(before)) return project;
  p.edited = true;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_edit", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": text of "${partLabel(p)}" edited`, before, after: snap() });
  assertValid(d);
  return next;
}

/** How a table changed, in words for the change log ("1 row added, 1 row moved, 2 cells changed"). */
export function describeRowChange(before: readonly (readonly string[])[], after: readonly (readonly string[])[]): string {
  const key = (r: readonly string[]) => JSON.stringify(r);
  const bits: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (after.length > before.length) bits.push(`${plural(after.length - before.length, "row")} added`);
  if (after.length < before.length) bits.push(`${plural(before.length - after.length, "row")} removed`);
  // Same rows in another order: moved. Same length: compare cell by cell.
  const sameSet = after.length === before.length && [...before].map(key).sort().join("|") === [...after].map(key).sort().join("|");
  if (sameSet) bits.push("rows moved");
  else if (after.length === before.length) {
    let cells = 0;
    after.forEach((r, i) => r.forEach((c, j) => (c !== (before[i]?.[j] ?? "") ? cells++ : 0)));
    if (cells) bits.push(`${plural(cells, "cell")} changed`);
  } else bits.push("cells changed");
  return bits.join(", ") || "rows changed";
}

/**
 * Sets the rows of a table part (the author's cells: add, remove, move a row, edit a cell). The column heads stay as the library has
 * them. A cell is text like any other, so it may hold a blank {{key|Label}}; an empty cell stays empty (nothing is filled in).
 * One change-log event per save, with the rows before and after.
 */
export function setTableRows(project: Project, trdId: string, writeupId: string, partId: string, rows: string[][], actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  if (p.kind !== "table") throw new TrdWriteupError("Only a table part has rows");
  const width = p.columns?.length ?? 0;
  const clean = rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").replace(/\r?\n/g, " ")));
  if (JSON.stringify(clean) === JSON.stringify(p.rows ?? [])) return project;
  const before = p.rows ?? [];
  if (clean.length) p.rows = clean;
  else delete p.rows;
  p.edited = true;
  d.updatedAt = actor.at;
  log(next, actor, { action: "trd_writeup_edit", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": rows of the table "${partLabel(p)}" edited (${describeRowChange(before, clean)})`, before: { rows: before }, after: { rows: clean } });
  assertValid(d);
  return next;
}

// ------------------------------------------------------------------ pictures

/** Bytes of all pictures in a TRD, optionally leaving one part out (the one being replaced). */
function imageBytesIn(d: TrdDocument, except?: { writeupId: string; partId: string }): number {
  let total = 0;
  for (const w of d.writeups ?? []) for (const p of w.parts) if (p.image && !(except && except.writeupId === w.id && except.partId === p.id)) total += p.image.bytes;
  return total;
}

/**
 * Attaches a picture to a figure part, replaces it, or removes it (image null). The caller has read the file with `readTrdImage` (type,
 * size and pixels). The picture lives inside the project, so the totals are limited (see TRD_IMAGES_MAX_TOTAL_BYTES). The change
 * log names the picture by its facts and SHA-256, not its bytes.
 */
export function setPartImage(project: Project, trdId: string, writeupId: string, partId: string, image: TrdImage | null, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const p = partOf(w, partId);
  if (p.kind !== "figure") throw new TrdWriteupError("Only a figure can hold a picture");
  if (image) {
    const ok = trdImageSchema.safeParse(image);
    if (!ok.success) throw new TrdWriteupError(ok.error.issues[0]?.message ?? "That picture cannot be used");
    if (imageBytesIn(d, { writeupId, partId }) + image.bytes > TRD_IMAGES_MAX_TOTAL_BYTES) {
      throw new TrdWriteupError("This TRD already holds as many pictures as a project file should carry (10 MB in all). Remove or shrink a picture first.");
    }
  }
  if (!image && !p.image) return project;
  const before = p.image ? trdImageMeta(p.image) : null;
  if (image) p.image = structuredClone(image);
  else delete p.image;
  p.edited = true;
  d.updatedAt = actor.at;
  log(next, actor, {
    action: "trd_writeup_image",
    path: `${wuPath(d, w)}.${p.id}`,
    detail: `${w.id} "${w.title}": picture of "${partLabel(p)}" ${image ? (before ? "replaced" : "attached") : "removed"}`,
    ...(before ? { before } : {}),
    ...(image ? { after: trdImageMeta(image) } : {}),
  });
  assertValid(d);
  return next;
}

// ------------------------------------------------------------------ place in the document

/**
 * Moves a write-up one place up (-1) or down (+1) in the document. A top-level section swaps with its neighbour; a section inside the
 * process overview swaps with a neighbour of the same place or takes the place of the neighbour it passes (the placement the author
 * chose is kept on later library updates); a process description swaps only with another description of the same step, because the
 * step order sets where it sits. The export follows `writeupOrder`, so what the tab shows is what the document prints.
 */
export function moveWriteup(project: Project, trdId: string, writeupId: string, dir: -1 | 1, actor: Actor): Project {
  const next = structuredClone(project);
  const d = docOf(next, trdId);
  const w = writeupOf(d, writeupId);
  const plan = planMove(d, writeupId, dir);
  if (plan.blocked) throw new TrdWriteupError(plan.blocked);
  const list = d.writeups ?? [];
  const at = list.findIndex((x) => x.id === writeupId);
  const beforePlace: TrdPlacement | null = w.placement ? { ...w.placement } : null;
  if (plan.swapWith) {
    const to = list.findIndex((x) => x.id === plan.swapWith);
    [list[at], list[to]] = [list[to]!, list[at]!];
  } else if (plan.placeBy) {
    list.splice(at, 1);
    const near = list.findIndex((x) => x.id === plan.placeBy!.nextTo);
    list.splice(plan.placeBy.side === "before" ? near : near + 1, 0, w);
    w.placement = plan.placeBy.placement;
    w.placementEdited = true;
  }
  d.writeups = list;
  d.updatedAt = actor.at;
  const neighbour = list.find((x) => x.id === (plan.swapWith ?? plan.placeBy?.nextTo));
  log(next, actor, {
    action: "trd_writeup_move",
    path: wuPath(d, w),
    detail: `${w.id} "${w.title}" moved ${dir === -1 ? "up" : "down"} past ${neighbour ? `${neighbour.id} "${neighbour.title}"` : "its neighbour"}${plan.placeBy ? ` (now placed ${describePlacement(plan.placeBy.placement)})` : ""}`,
    ...(plan.placeBy ? { before: { placement: beforePlace }, after: { placement: plan.placeBy.placement } } : {}),
  });
  assertValid(d);
  return next;
}

/** A placement in words, for the change log: "before step ds_receipt_thaw". The web app shows labels instead of keys. */
export function describePlacement(p: TrdPlacement | undefined): string {
  if (!p) return "as a section of its own";
  if (p.where === "last") return "at the end of the process overview";
  return `${p.where} the step ${p.unitOp ?? "?"}`;
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
  log(next, actor, { action: "trd_writeup_part_remove", path: `${wuPath(d, w)}.${p.id}`, detail: `${w.id} "${w.title}": "${partLabel(p)}" removed`, before: forChangeLog(p) });
  assertValid(d);
  return next;
}

/** Author-added parts get ids starting with "x_" so they are never mistaken for library parts. */
const isAuthorPart = (id: string) => id.startsWith("x_");

export interface NewPart {
  kind: TrdPartKind;
  text: string;
  title?: string;
  /** A table's column heads. */
  columns?: string[];
  /** A figure's caption and alternative text. */
  caption?: string;
  alt?: string;
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
    ...(input.kind === "figure" && text(input.caption) ? { caption: text(input.caption) } : {}),
    ...(input.kind === "figure" && text(input.alt) ? { alt: text(input.alt) } : {}),
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
  a.kind === b.kind &&
  a.text === b.text &&
  (a.title ?? "") === (b.title ?? "") &&
  (a.caption ?? "") === (b.caption ?? "") &&
  (a.alt ?? "") === (b.alt ?? "") &&
  JSON.stringify(a.columns ?? []) === JSON.stringify(b.columns ?? []) &&
  JSON.stringify(a.rows ?? []) === JSON.stringify(b.rows ?? []) &&
  (a.optional?.condition ?? "") === (b.optional?.condition ?? "");

export interface WriteupDifference {
  titleChanged: boolean;
  /** The library's place for the write-up differs from the TRD's and the author did not choose the TRD's. */
  placementChanged: boolean;
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
  const placementChanged = !w.placementEdited && JSON.stringify(w.placement ?? null) !== JSON.stringify(lib.placement ?? null);
  return { titleChanged: w.title !== lib.title, placementChanged, added, changed, dropped, keptEdited, skippedRemoved };
}

export const differenceIsEmpty = (x: WriteupDifference): boolean => !x.titleChanged && !x.placementChanged && !x.added.length && !x.changed.length && !x.dropped.length;

/** One line saying what the update does, for the note and the change log. Table and figure changes are named, since rows are easy to miss. */
export function differenceText(x: WriteupDifference): string {
  const tables = x.added.filter((p) => p.kind === "table").length + x.changed.filter((c) => c.library.kind === "table" || c.part.kind === "table").length + x.dropped.filter((p) => p.kind === "table").length;
  const figures = x.added.filter((p) => p.kind === "figure").length + x.changed.filter((c) => c.library.kind === "figure").length + x.dropped.filter((p) => p.kind === "figure").length;
  const tableNote = tables ? `${tables} table${tables === 1 ? "" : "s"} with other column heads or rows` : "";
  const figureNote = figures ? `${figures} figure${figures === 1 ? "" : "s"} with another caption or text` : "";
  const bits = [
    x.titleChanged ? "new title" : "",
    x.placementChanged ? "another place in the document" : "",
    x.added.length ? `${x.added.length} new part${x.added.length === 1 ? "" : "s"}` : "",
    x.changed.length ? `${x.changed.length} changed part${x.changed.length === 1 ? "" : "s"}` : "",
    x.dropped.length ? `${x.dropped.length} part${x.dropped.length === 1 ? "" : "s"} no longer in the library` : "",
    tableNote,
    figureNote,
  ].filter(Boolean);
  const kept = x.keptEdited.length ? `${x.keptEdited.length} part${x.keptEdited.length === 1 ? "" : "s"} you edited stay${x.keptEdited.length === 1 ? "s" : ""} as you wrote ${x.keptEdited.length === 1 ? "it" : "them"}${x.keptEdited.some((p) => p.kind === "table") ? " (including a table)" : ""}` : "";
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
  const before = forChangeLog(w);
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
  // A place the author chose in this TRD is kept; otherwise the library's place is taken.
  if (!w.placementEdited) {
    if (lib.placement) w.placement = structuredClone(lib.placement);
    else delete w.placement;
  }
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
  /**
   * True when the value is the label of a catalog choice ("Received as ready-to-use liquid"). Only such a value is lowered inside a
   * sentence. A typed value, a site, a company or a person's name, a lane or a supplier is free text and keeps its capitals.
   */
  choice?: true;
  /**
   * The separate choices of a multi-choice answer, as catalog labels. `value` keeps them joined with "; " (the record's own form, shown in
   * the evidence appendix); a sentence reads them as an English list ("a, b and c"), see `listText`.
   */
  items?: string[];
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

/** True when the question that holds this path is answered from a catalog option list (its value is an option label). */
function isChoicePath(content: ContentBundle | undefined, path: string): boolean {
  const q = content?.questions.find((x) => x.binds === path);
  return q?.input.type === "choice" || q?.input.type === "multi_choice" || q?.input.type === "yes_no";
}

function projectAnswer(ctx: BlankContext, path: string, side: "target" | "source"): { value: string; choice: boolean } | undefined {
  const content = ctx.content;
  if (!content) return undefined;
  const q = content.questions.find((x) => x.binds === path && !x.parent);
  if (!q) return undefined;
  const ref = q.sides === "shared" ? path : `${side}.${path}`;
  const r = resolveEntry(ctx.project, ref);
  if (r.status !== "established" || r.value === undefined) return undefined;
  return { value: formatResolved(content, q, r), choice: isChoicePath(content, path) };
}

/**
 * The choices of a multi-choice answer, one label each, or undefined when the field holds one answer. The record keeps the joined
 * display ("A; B; C") next to the list of values, so the labels are read back from it; when the two disagree (an old record whose label
 * itself held a semicolon) the joined text is kept whole rather than cut in the wrong place.
 */
function choiceItems(f: TrdField | undefined): string[] | undefined {
  const p = f && !f.override ? f.pulled : undefined;
  const v = p?.value as unknown;
  if (!p || !Array.isArray(v) || v.length < 2 || typeof p.display !== "string") return undefined;
  const parts = p.display.split("; ").map((x) => x.trim());
  return parts.length === v.length && parts.every(Boolean) ? parts : undefined;
}

/** The TRD detail keys whose values are catalog option labels (unless the team typed over them). */
const CHOICE_DETAILS = new Set(["modality", "dosageForm", "presentation"]);

/** The value of a blank from the TRD record and the project, ignoring anything typed into a write-up. */
export function lookupBlank(ctx: BlankContext, key: string, label: string): ResolvedBlank {
  const open = (note?: string): ResolvedBlank => ({ key, label, filled: false, ...(note ? { note } : {}) });
  const detailKey = DETAIL_OF_KEY[key];
  if (detailKey) {
    const f = ctx.doc.details.find((x) => x.key === detailKey);
    if (f) {
      const v = effectiveField(f);
      if (v.status === "established") return { key, label, filled: true, value: v.text, origin: "details", where: `TRD, ${f.label}`, ...(CHOICE_DETAILS.has(detailKey) && !v.overridden ? { choice: true as const } : {}) };
      if (v.status === "not_applicable") return { key, label, filled: true, value: v.text, origin: "details", where: `TRD, ${f.label}` };
      if (v.status === "tbd") return open("To be determined (TBD)");
    }
  }
  const m = UO_KEY.exec(key);
  if (m) {
    const t = resolveTrdValue(ctx.doc, m[1]!, m[2] as Parameters<typeof resolveTrdValue>[2], m[3]!, m[4]!, ctx.doc.updatedAt);
    if (t.status === "established" && (t.text ?? "").trim()) {
      const field = ctx.doc.steps.find((s) => s.key === m[1])?.items.find((i) => i.collection === m[2] && i.key === m[3])?.fields.find((x) => x.key === m[4]);
      return {
        key,
        label,
        filled: true,
        // "count" is a unit for the data model only; it is never printed (printableUnit).
        value: [t.text, printableUnit(t.unit)].filter(Boolean).join(" "),
        origin: "trd",
        ...(!field?.override && isChoicePath(ctx.content, key) ? { choice: true as const } : {}),
        ...(choiceItems(field) ? { items: choiceItems(field)! } : {}),
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
    return v !== undefined ? { key, label, filled: true, value: v.value, origin: "project", where: "Project answer (sending unit)", ...(v.choice ? { choice: true as const } : {}) } : open();
  }
  if ((key.startsWith("scope.") || key.startsWith("site.")) && !detailKey) {
    const v = projectAnswer(ctx, key, "target");
    if (v !== undefined) return { key, label, filled: true, value: v.value, origin: "project", where: "Project answer (receiving unit)", ...(v.choice ? { choice: true as const } : {}) };
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
 * a sentence they read as a stray capital ("The buffer is Received as ..."). Lower the first letter of a catalog choice label ONLY
 * (the blank says so with `choice`). Free text is never touched: a typed value, a lane, a supplier, a site, a company or a person's
 * name may begin with a proper noun. An acronym keeps its capitals (second letter also upper case: "PES").
 */
const lowerFirst = (v: string): string => (/^[A-Z][a-z]/.test(v) ? v[0]!.toLowerCase() + v.slice(1) : v);

function lowerChoiceLabel(b: ResolvedBlank): ResolvedBlank {
  if (!b.filled || !b.value || !b.choice) return b;
  const lowered = lowerFirst(b.value);
  return lowered === b.value ? b : { ...b, value: lowered };
}

/**
 * Several choices read as an English list. "a and b", "a, b and c"; when a choice itself holds a comma the commas could not tell the
 * items apart, so semicolons separate them ("a, b; c; and d"). Every item after the first is mid-sentence, so each is lowered by the same
 * safe rule as a single choice (a catalog label only; "pH", "USP" and "2D code" keep their capitals).
 */
export function listText(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  const semi = items.some((i) => i.includes(","));
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return semi ? `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}` : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * A blank's label may carry modifiers after "~": "Label ~a" (an article goes in front of the value), "Label ~qualified" or "Label ~by"
 * (the value is a catalog choice that is turned into a clause, see below), "Label ~the" or "Label ~text if yes ~text if no".
 */
function splitBlankLabel(raw: string): { label: string; article: boolean; clause?: "qualified" | "by" | "the"; yes?: string; no?: string } {
  const [label = "", ...mods] = raw.split("~").map((x) => x.trim());
  if (mods.length === 1 && mods[0] === "a") return { label, article: true };
  if (mods.length === 1 && (mods[0] === "qualified" || mods[0] === "by" || mods[0] === "the")) return { label, article: false, clause: mods[0] };
  if (mods.length === 2) return { label, article: false, yes: mods[0]!, no: mods[1]! };
  return { label, article: false };
}

/**
 * "a" or "an" in front of a value, chosen by the sound of its first letter, or of its first number ("a 1 mL syringe", "an 8 mL vial",
 * "an 11 mm needle"). Left alone when the value already begins with an article, or does not start with a letter or a digit. The few words
 * that start with a vowel letter but a consonant sound are listed.
 */
function withArticle(v: string): string {
  if (/^\d/.test(v)) return `${/^(8|11|18)(?!\d)|^8\d*(?!\d)/.test(v) ? "an" : "a"} ${v}`;
  if (!/^[A-Za-z]/.test(v) || /^(a|an|the|one|some|any|no)\s/i.test(v)) return v;
  const an = /^[aeiou]/i.test(v) && !/^(uni|use|usu|uti|eu|one|ubi)/i.test(v);
  return `${an ? "an" : "a"} ${v}`;
}

/**
 * A qualification status read as a clause: "The shipper is {{status ~qualified}}." A status that is only partly complete does not
 * say "qualified", so a reader cannot take a half-finished qualification for a finished one. The wording follows the catalog's labels;
 * a label it does not know is lowered and left as it is.
 */
function qualifiedClause(label: string): string {
  const m = /^(Installation|Operational|Performance) qualification \((IQ|OQ|PQ)\) complete$/i.exec(label.trim());
  if (m) {
    const done = `${m[1]!.toLowerCase()} qualification complete`;
    return m[2]!.toUpperCase() === "PQ" ? `qualified (${done})` : `not yet fully qualified (${done})`;
  }
  if (/^Qualified; requalification due$/i.test(label.trim())) return "qualified; requalification is due";
  if (/^Qualification planned$/i.test(label.trim())) return "not yet qualified (qualification planned)";
  return lowerFirst(label);
}

/** "the" in front of a plan or method named by its label ("uses the standard plan"), unless the value already starts with an article. */
function withThe(v: string): string {
  const t = lowerFirst(v.trim());
  return /^(a|an|the)\s/i.test(t) ? t : `the ${t}`;
}

/** A handling approach read as "handled by ...": "by a documented assessment ...", "by rejecting any shipment ...". */
function byClause(label: string): string {
  const v = lowerFirst(label.trim());
  const reject = /^reject\s+(.*)$/i.exec(v);
  return reject ? `by rejecting ${reject[1]}` : `by ${withArticle(v)}`;
}

// A count of exactly one takes the singular noun. Only nouns that follow a number in the shipped wording are listed; "1 hours" and
// "1 business days" are the cases the product owner met.
const PLURAL_UNIT = /^(\s+(?:business\s+)?)(hours|days|minutes|weeks|months|runs|samples|bottles|units|syringes|filters|vials|lots|batches|times)\b/;
const SINGULAR_OF: Record<string, string> = { hours: "hour", days: "day", minutes: "minute", weeks: "week", months: "month", runs: "run", samples: "sample", bottles: "bottle", units: "unit", syringes: "syringe", filters: "filter", vials: "vial", lots: "lot", batches: "batch", times: "time" };
const ENDS_IN_ONE = /(^|[^\d.,])1(\.0+)?$/;

/** "1 hours" becomes "1 hour": the noun after a value that is exactly one (in the value itself or in the text that follows). */
function singularAfterOne(out: TextSeg[]): void {
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    if ("blank" in s) {
      const v = s.blank.filled ? s.blank.value ?? "" : "";
      const own = /^(1(?:\.0+)?)(\s+(?:business\s+)?)(hours|days|minutes|weeks|months)$/.exec(v);
      if (own) out[i] = { ...s, blank: { ...s.blank, value: `${own[1]}${own[2]}${SINGULAR_OF[own[3]!]}` } };
      const next = out[i + 1];
      if (v && ENDS_IN_ONE.test(v) && next && !("blank" in next)) {
        const m = PLURAL_UNIT.exec(next.text);
        if (m) out[i + 1] = { ...next, text: `${m[1]}${SINGULAR_OF[m[2]!]}${next.text.slice(m[0].length)}` };
      }
    } else if (/(^|[^\d.,])1(\.0+)?\s+(hours|days|minutes|weeks|months)\b/.test(s.text)) {
      out[i] = { ...s, text: s.text.replace(/(^|[^\d.,])(1(?:\.0+)?)(\s+)(hours|days|minutes|weeks|months)\b/g, (_m, a, n, sp, u) => `${a}${n}${sp}${SINGULAR_OF[u as string]}`) };
    }
  }
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
      const mod = splitBlankLabel((m[2] ?? "").trim());
      const resolved = resolve(m[1]!, mod.label || m[1]!);
      const mid = midSentence(body.slice(0, m.index), out);
      let blank = resolved;
      const yesNo = resolved.filled && mod.yes !== undefined ? /^(yes|no)$/i.exec(resolved.value!.trim()) : null;
      if (yesNo) {
        // A Yes/No answer read as a sentence: the author's wording for each answer replaces the bare word ("...is used: Yes" never prints).
        const { choice: _c, items: _i, ...rest } = resolved;
        blank = { ...rest, value: yesNo[1]!.toLowerCase() === "yes" ? mod.yes! : mod.no! };
      } else if (resolved.filled && resolved.items?.length) {
        const items = mid ? resolved.items.map(lowerFirst) : [resolved.items[0]!, ...resolved.items.slice(1).map(lowerFirst)];
        blank = { ...resolved, value: listText(items) };
      } else if (mid) blank = lowerChoiceLabel(resolved);
      if (mod.article && blank.filled && blank.value) blank = { ...blank, value: withArticle(blank.value) };
      if (mod.clause && blank.filled && blank.value) blank = { ...blank, value: mod.clause === "qualified" ? qualifiedClause(blank.value) : mod.clause === "by" ? byClause(blank.value) : withThe(blank.value) };
      out.push({ blank, ...(bold ? { bold } : {}) });
      last = m.index! + m[0].length;
    }
    if (last < body.length) out.push({ text: body.slice(last), ...(bold ? { bold } : {}) });
  }
  singularAfterOne(out);
  return out;
}

/** The text of a segment list as a reader sees it in plain text: an open blank shows its label in brackets. */
export function plainOfSegments(segs: readonly TextSeg[]): string {
  return segs.map((s) => ("blank" in s ? (s.blank.filled ? s.blank.value! : `[${s.blank.label}]`) : s.text)).join("");
}

/** The parts that are in the document: not optional, or optional and switched on. */
export const activeParts = (w: TrdWriteup): TrdPart[] => w.parts.filter((p) => !p.optional || p.included);

/** The blanks a part holds: in its text, and in the cells of a table (a cell resolves like a paragraph's blank). */
function partBlankRefs(p: TrdPart) {
  return [...blanksOf(p.text), ...(p.kind === "table" ? (p.rows ?? []).flatMap((r) => r.flatMap((c) => blanksOf(c))) : [])];
}

/** Active figure parts that still have no picture: open items of the description, like an open blank. */
export const openFigures = (w: TrdWriteup): TrdPart[] => (w.notApplicable?.on ? [] : activeParts(w).filter((p) => p.kind === "figure" && !p.image && !p.drawing));

/** Every blank of the write-up's active parts, resolved, each key once. */
export function writeupBlanks(ctx: BlankContext, w: TrdWriteup): ResolvedBlank[] {
  if (w.notApplicable?.on) return blanksOf(w.notApplicable.text).map((b) => resolveBlank(ctx, w, b.key, b.label));
  const seen = new Set<string>();
  const out: ResolvedBlank[] = [];
  for (const p of activeParts(w)) {
    for (const b of partBlankRefs(p)) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      out.push(resolveBlank(ctx, w, b.key, b.label));
    }
  }
  return out;
}

/** How many blanks of the write-up are still open (for the tab and the export note). */
export const openBlankCount = (ctx: BlankContext, w: TrdWriteup): number => writeupBlanks(ctx, w).filter((b) => !b.filled).length;
