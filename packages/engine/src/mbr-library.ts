import { mbrLibraryBlockSchema, mbrLibraryFileSchema, type MbrLibraryBlock, type MbrLibraryFile, type MbrLibraryVersion } from "@gap/process-model";

/*
 * The step-blocks library: pure rules (no storage, so they are tested on their own).
 *
 *  - A block is versioned. Saving an edit makes version + 1 and keeps the WHOLE earlier content in `history`, so a record made from
 *    version 1 can still be read after version 2 exists, and nothing is overwritten without a copy.
 *  - A record keeps its own copy of a block (libraryId and libraryVersion say where it came from). A library edit never reaches a record
 *    by itself; the record shows "Update from library" and the author chooses.
 *  - The shipped library is content (own neutral wording). A site edit of a shipped block is stored as the user's copy of the same id and
 *    wins over the shipped one in the list the site offers; the shipped file is never changed.
 */

export class MbrLibraryError extends Error {}

/** The content of a block version (no history, no bookkeeping). */
export function versionOf(b: MbrLibraryBlock | MbrLibraryVersion): MbrLibraryVersion {
  return {
    version: b.version,
    title: b.title,
    unitOps: [...b.unitOps],
    steps: [...b.steps],
    params: structuredClone(b.params),
    timeLimits: structuredClone(b.timeLimits),
    sampleTypes: [...b.sampleTypes],
    cmoFields: [...b.cmoFields],
    ...(b.sampleSlots ? { sampleSlots: structuredClone(b.sampleSlots) } : {}),
    ...(b.note ? { note: b.note } : {}),
    ...(b.at ? { at: b.at } : {}),
    ...(b.by ? { by: b.by } : {}),
  };
}

export type LibraryEdit = Partial<Pick<MbrLibraryBlock, "title" | "unitOps" | "steps" | "params" | "timeLimits" | "sampleTypes" | "cmoFields" | "note" | "sampleSlots">>;

const clean = (b: MbrLibraryBlock): MbrLibraryBlock => mbrLibraryBlockSchema.parse(b);

/** A new library block (version 1) made on the site. */
export function newLibraryBlock(id: string, edit: Required<Pick<LibraryEdit, "title">> & LibraryEdit, now: string, by: string): MbrLibraryBlock {
  return clean({
    id,
    version: 1,
    title: edit.title.trim(),
    unitOps: edit.unitOps ?? [],
    steps: edit.steps ?? [],
    params: edit.params ?? [],
    timeLimits: edit.timeLimits ?? [],
    sampleTypes: edit.sampleTypes ?? [],
    cmoFields: edit.cmoFields ?? [],
    ...(edit.note?.trim() ? { note: edit.note.trim() } : {}),
    custom: true,
    at: now,
    by,
  });
}

/** True when an edit changes anything. An unchanged save does not create a version. */
export function editChangesBlock(cur: MbrLibraryBlock, edit: LibraryEdit): boolean {
  const a = JSON.stringify(versionOf(cur), (k, v) => (k === "at" || k === "by" || k === "version" ? undefined : v));
  const next = { ...versionOf(cur), ...edit };
  const b = JSON.stringify(versionOf({ ...cur, ...next } as MbrLibraryBlock), (k, v) => (k === "at" || k === "by" || k === "version" ? undefined : v));
  return a !== b;
}

/** The block after an edit: the next version, with the whole earlier content kept in the history. */
export function editLibraryBlock(cur: MbrLibraryBlock, edit: LibraryEdit, now: string, by: string): MbrLibraryBlock {
  if (!editChangesBlock(cur, edit)) return cur;
  const { history: _h, ...rest } = cur;
  void _h;
  return clean({
    ...rest,
    ...edit,
    ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
    version: cur.version + 1,
    at: now,
    by,
    history: [...(cur.history ?? []), versionOf(cur)],
  });
}

/** A previous version of a block, or the current one. */
export function blockVersion(b: MbrLibraryBlock, version: number): MbrLibraryVersion | undefined {
  if (b.version === version) return versionOf(b);
  return b.history?.find((h) => h.version === version);
}

/**
 * The blocks the site offers: the shipped ones, with the user's copy replacing a shipped block of the same id, then the user's own blocks.
 * Sorted by title so the picker reads in a steady order.
 */
export function effectiveLibrary(shipped: readonly MbrLibraryBlock[], user: readonly MbrLibraryBlock[]): MbrLibraryBlock[] {
  const mine = new Map(user.map((b) => [b.id, b]));
  const out = shipped.map((b) => mine.get(b.id) ?? b);
  for (const b of user) if (!shipped.some((s) => s.id === b.id)) out.push(b);
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Blocks offered for a unit operation: those that name it and those that name none (offered everywhere). */
export const blocksForUnitOp = (lib: readonly MbrLibraryBlock[], unitOp: string | undefined): MbrLibraryBlock[] =>
  lib.filter((b) => b.unitOps.length === 0 || (unitOp !== undefined && b.unitOps.includes(unitOp)));

export type BlockLibraryStatus =
  /** The block was written by the author, or it is current. Nothing to say. */
  | { kind: "none" }
  | { kind: "current" }
  /** The library has a newer version of the block: "Update from library". */
  | { kind: "newer"; libraryVersion: number; usedVersion: number }
  /** The library no longer holds the block (a user copy was deleted, for example): the record keeps its own copy. */
  | { kind: "missing" };

export function blockLibraryStatus(block: { libraryId?: string; libraryVersion?: number }, lib: readonly MbrLibraryBlock[]): BlockLibraryStatus {
  if (!block.libraryId || block.libraryVersion === undefined) return { kind: "none" };
  const entry = lib.find((b) => b.id === block.libraryId);
  if (!entry) return { kind: "missing" };
  return entry.version > block.libraryVersion ? { kind: "newer", libraryVersion: entry.version, usedVersion: block.libraryVersion } : { kind: "current" };
}

/** Reads and checks a shipped library file (a bad block stops the build, by file). */
export function parseMbrLibrary(raw: unknown): MbrLibraryFile {
  const r = mbrLibraryFileSchema.safeParse(raw);
  if (!r.success) throw new MbrLibraryError(`mbr/blocks.yaml: ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`);
  return r.data;
}
