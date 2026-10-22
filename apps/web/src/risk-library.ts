import type { RiskConfig, RiskMethodSnapshot } from "@gap/process-model";

/*
 * Pure rules of the risk method library (no storage, so they are unit-tested on their own).
 *
 *  - History: the same model as the company lot-size tables. Saving an existing entry appends an "edited" event that keeps the
 *    WHOLE earlier content; a new entry starts with "created". Nothing is ever overwritten without a copy of it in the history.
 *  - The assessment keeps its own copy of a method (libraryRef carries only the name and version it came from), so a library change
 *    never reaches an issued assessment silently. `libraryStatus` tells the assessment page when the library has moved on.
 */

export interface MethodHistoryEntry {
  at: string;
  action: "created" | "edited";
  /** What the method said before this edit (kept, never overwritten). Absent for "created". */
  before?: RiskMethodSnapshot;
}

/** A method without the library's bookkeeping, the form an assessment compares against. */
export function snapshotOf(m: RiskMethodSnapshot): RiskMethodSnapshot {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    ...(m.docRef ? { docRef: m.docRef } : {}),
    ...(m.owner ? { owner: m.owner } : {}),
    config: structuredClone(m.config),
  };
}

/** The history after a save: `cur` is the entry as it was (undefined for a new one). */
export function nextHistory(cur: { history: MethodHistoryEntry[] } & RiskMethodSnapshot | undefined, now: string): MethodHistoryEntry[] {
  return cur ? [...cur.history, { at: now, action: "edited", before: snapshotOf(cur) }] : [{ at: now, action: "created" }];
}

/** JSON with sorted keys, so two configs with the same content compare equal whatever order their fields were written in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The content of a method that matters for scoring: the config without the informational links (load-out, library entry). */
export function contentKey(config: RiskConfig): string {
  const { libraryRef: _l, loadoutId: _o, ...rest } = config;
  void _l;
  void _o;
  return stable(rest);
}

export type LibraryStatus =
  /** The assessment's method is its own (not from the library), or the entry is gone. Nothing to say. */
  | { kind: "none" }
  | { kind: "current" }
  /** The library entry has another version than the copy: show "Library has v<x>; this assessment uses v<y>". */
  | { kind: "newer"; libraryVersion: string; usedVersion: string }
  /** Same version label but different content: the entry was edited without a new version, so the copy differs. */
  | { kind: "changed-same-version"; version: string };

/** How an assessment's method copy compares with the library entry it came from. */
export function libraryStatus(config: RiskConfig | undefined, entry: RiskMethodSnapshot | undefined): LibraryStatus {
  const ref = config?.libraryRef;
  if (!config || !ref || !entry || entry.id !== ref.id) return { kind: "none" };
  if (entry.version !== ref.version) return { kind: "newer", libraryVersion: entry.version, usedVersion: ref.version };
  // Same version label: only a difference of content (an edit saved without a new version) is worth a note.
  return contentKey(entry.config) === contentKey(config) ? { kind: "current" } : { kind: "changed-same-version", version: entry.version };
}

/** The config a library entry hands to an assessment: a copy, linked to the entry by id, name and version. */
export function configFromEntry(entry: RiskMethodSnapshot): RiskConfig {
  return { ...structuredClone(entry.config), libraryRef: { id: entry.id, name: entry.name, version: entry.version } };
}
