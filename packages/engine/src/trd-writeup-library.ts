import { trdLibraryFileSchema, trdLibraryWriteupSchema, type TrdLibraryFile, type TrdLibraryVersion, type TrdLibraryWriteup } from "@gap/process-model";

/*
 * The TRD write-up library: pure rules (no storage, so they are tested on their own). Same rules as the step-blocks library of the
 * batch record and the risk method library.
 *
 *  - A write-up is versioned. Saving an edit makes version + 1 and keeps the WHOLE earlier content in `history`, so a TRD made from
 *    version 1 can still be compared after version 2 exists, and nothing is overwritten without a copy.
 *  - A TRD keeps its own copy of a write-up (libraryId and libraryVersion say where it came from). A library edit never reaches a TRD
 *    by itself; the TRD shows "Update from library" and the author chooses.
 *  - The shipped library is content (own neutral wording). A site edit of a shipped write-up is stored as the user's copy of the same
 *    id and wins over the shipped one in the list the site offers; the shipped file is never changed.
 */

export class TrdWriteupLibraryError extends Error {}

/** The content of a write-up version (no history, no bookkeeping). */
export function writeupVersionOf(w: TrdLibraryWriteup | TrdLibraryVersion): TrdLibraryVersion {
  return {
    version: w.version,
    title: w.title,
    ...(w.appliesWhen ? { appliesWhen: w.appliesWhen } : {}),
    parts: structuredClone(w.parts),
    ...(w.notApplicable ? { notApplicable: structuredClone(w.notApplicable) } : {}),
    ...(w.at ? { at: w.at } : {}),
    ...(w.by ? { by: w.by } : {}),
  };
}

export type WriteupLibraryEdit = Partial<Pick<TrdLibraryWriteup, "title" | "appliesWhen" | "parts" | "notApplicable" | "placement">>;

const clean = (w: TrdLibraryWriteup): TrdLibraryWriteup => trdLibraryWriteupSchema.parse(w);

/** A new library write-up (version 1) made on the site. */
export function newLibraryWriteup(
  id: string,
  kind: "unitOp" | "section",
  key: string,
  edit: Required<Pick<WriteupLibraryEdit, "title">> & WriteupLibraryEdit,
  now: string,
  by: string,
): TrdLibraryWriteup {
  return clean({
    id,
    version: 1,
    kind,
    key,
    title: edit.title.trim(),
    ...(edit.appliesWhen?.trim() ? { appliesWhen: edit.appliesWhen.trim() } : {}),
    parts: edit.parts ?? [],
    ...(edit.notApplicable ? { notApplicable: edit.notApplicable } : {}),
    ...(edit.placement ? { placement: edit.placement } : {}),
    custom: true,
    at: now,
    by,
  });
}

const drop = (k: string, v: unknown) => (k === "at" || k === "by" || k === "version" ? undefined : v);

/** True when an edit changes anything. An unchanged save does not create a version. */
export function editChangesWriteup(cur: TrdLibraryWriteup, edit: WriteupLibraryEdit): boolean {
  const a = JSON.stringify(writeupVersionOf(cur), drop) + JSON.stringify(cur.placement ?? null);
  const merged = { ...cur, ...edit } as TrdLibraryWriteup;
  const b = JSON.stringify(writeupVersionOf(merged), drop) + JSON.stringify(merged.placement ?? null);
  return a !== b;
}

/** The write-up after an edit: the next version, with the whole earlier content kept in the history. */
export function editLibraryWriteup(cur: TrdLibraryWriteup, edit: WriteupLibraryEdit, now: string, by: string): TrdLibraryWriteup {
  if (!editChangesWriteup(cur, edit)) return cur;
  const { history: _h, ...rest } = cur;
  void _h;
  const next: TrdLibraryWriteup = { ...rest, ...edit, ...(edit.title !== undefined ? { title: edit.title.trim() } : {}), version: cur.version + 1, at: now, by, history: [...(cur.history ?? []), writeupVersionOf(cur)] };
  // An emptied optional field is removed rather than kept as an empty string.
  if (!next.appliesWhen?.trim()) delete next.appliesWhen;
  // "placement: undefined" in an edit means the author cleared the place (the write-up becomes a section of its own).
  if (!next.placement) delete next.placement;
  return clean(next);
}

/** A copy of a shipped or user write-up as a new one (a duplicate starts again at version 1 with no history). */
export function duplicateLibraryWriteup(cur: TrdLibraryWriteup, id: string, title: string, now: string, by: string): TrdLibraryWriteup {
  return clean({
    id,
    version: 1,
    kind: cur.kind,
    key: cur.key,
    title: title.trim(),
    ...(cur.appliesWhen ? { appliesWhen: cur.appliesWhen } : {}),
    parts: structuredClone(cur.parts),
    ...(cur.notApplicable ? { notApplicable: structuredClone(cur.notApplicable) } : {}),
    ...(cur.placement ? { placement: cur.placement } : {}),
    // A duplicate is an extra choice for the author, never copied into a new TRD by itself.
    autoAdd: false,
    custom: true,
    at: now,
    by,
  });
}

/** A previous version of a write-up, or the current one. */
export function writeupVersion(w: TrdLibraryWriteup, version: number): TrdLibraryVersion | undefined {
  if (w.version === version) return writeupVersionOf(w);
  return w.history?.find((h) => h.version === version);
}

/**
 * The write-ups the site offers: the shipped ones in their order (the order a new TRD gets them in), the user's copy replacing a
 * shipped write-up of the same id, then the user's own write-ups.
 */
export function effectiveWriteupLibrary(shipped: readonly TrdLibraryWriteup[], user: readonly TrdLibraryWriteup[]): TrdLibraryWriteup[] {
  const mine = new Map(user.map((w) => [w.id, w]));
  const out = shipped.map((w) => mine.get(w.id) ?? w);
  for (const w of user) if (!shipped.some((s) => s.id === w.id)) out.push(w);
  return out;
}

export type WriteupLibraryStatus =
  /** Written by the author, or no link to the library. Nothing to say. */
  | { kind: "none" }
  | { kind: "current" }
  /** The library has a newer version: "Update from library". */
  | { kind: "newer"; libraryVersion: number; usedVersion: number }
  /** The library no longer holds the write-up: the TRD keeps its own copy. */
  | { kind: "missing" };

export function writeupLibraryStatus(w: { libraryId?: string; libraryVersion?: number }, lib: readonly TrdLibraryWriteup[]): WriteupLibraryStatus {
  if (!w.libraryId || w.libraryVersion === undefined) return { kind: "none" };
  const entry = lib.find((x) => x.id === w.libraryId);
  if (!entry) return { kind: "missing" };
  return entry.version > w.libraryVersion ? { kind: "newer", libraryVersion: entry.version, usedVersion: w.libraryVersion } : { kind: "current" };
}

/** Reads and checks a shipped library file (a bad write-up stops the build, by file). */
export function parseTrdWriteupLibrary(raw: unknown, unitOpKeys?: readonly string[]): TrdLibraryFile {
  const r = trdLibraryFileSchema.safeParse(raw);
  if (!r.success) throw new TrdWriteupLibraryError(`trd-writeups/writeups.yaml: ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`);
  if (unitOpKeys) {
    const keys = new Set(unitOpKeys);
    for (const w of r.data.writeups) {
      if (w.kind === "unitOp" && !keys.has(w.key)) throw new TrdWriteupLibraryError(`trd-writeups/writeups.yaml: write-up "${w.id}" names unknown unit operation "${w.key}"`);
      if (w.placement?.unitOp && !keys.has(w.placement.unitOp)) throw new TrdWriteupLibraryError(`trd-writeups/writeups.yaml: write-up "${w.id}" is placed by unknown unit operation "${w.placement.unitOp}"`);
    }
  }
  return r.data;
}
