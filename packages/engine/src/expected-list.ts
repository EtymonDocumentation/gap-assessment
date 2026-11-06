import type { SamplingSuggestions } from "./sampling-seed";

/**
 * The account's own "Expected studies" list: which suggestion-catalog entries the design review (check D2) treats as expected for a
 * unit operation. GMP reason: what a typical fill/finish PPQ must cover is the company's own judgement (its products, its filters, its
 * quality system), so the shipped marks are only a starting load-out. A company keeps its list under version control with a reason for
 * each change, the same as any other controlled list, and nothing about it is ever hidden or deleted without a logged reason.
 *
 * The list is library data (not part of a project file). A project's review reads the list through `withExpectedList`, so the check,
 * the Overview count, the chain status, the Word/HTML appendix and the Process view's Coverage group all see the same entries.
 */

export interface ExpectedListVersion {
  id: string;
  /** 1, 2, 3 ... in the order the account saved them (not reused after a removal). */
  number: number;
  at: string;
  /** The person's short reason for the change. Optional: nothing blocks saving. */
  reason?: string;
  /** Catalog keys that count as expected. May hold a key a newer catalog no longer has (kept, shown, left out of the check). */
  keys: string[];
  /** The catalog version the list was made from. */
  catalogVersion: string;
  /** "edited" = the person changed the ticks; "reset" = the shipped list was loaded back. */
  kind: "edited" | "reset";
}

export interface ExpectedListRemoval {
  at: string;
  /** The removed version's number and when it was saved, so the log still says which one went. */
  number: number;
  savedAt: string;
  reason: string;
}

export interface ExpectedListDoc {
  versions: ExpectedListVersion[];
  /** Removed versions are logged, never silently gone. */
  removed: ExpectedListRemoval[];
}

export const emptyExpectedListDoc = (): ExpectedListDoc => ({ versions: [], removed: [] });

/** The catalog keys marked `expected: true` in the shipped catalog. */
export const shippedExpectedKeys = (s: SamplingSuggestions): string[] => s.candidates.filter((c) => c.expected).map((c) => c.key);

/** The newest saved version, or undefined while the account still uses the shipped marks. */
export const currentExpectedVersion = (doc: ExpectedListDoc | undefined): ExpectedListVersion | undefined => doc?.versions[doc.versions.length - 1];

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** The keys in force: the newest version's, else the shipped marks. */
export const expectedKeysInForce = (s: SamplingSuggestions, doc: ExpectedListDoc | undefined): string[] => currentExpectedVersion(doc)?.keys ?? shippedExpectedKeys(s);

/** Suggestions with an optional marker that says the account's list differs from the shipped marks (read by the design review's D2). */
export type EffectiveSuggestions = SamplingSuggestions & { expectedListId?: string };

/**
 * The catalog with the `expected` marks replaced by the account's list. An entry is expected only if it is in the list AND in the
 * catalog: a listed key the catalog no longer has is left out of the check (the library page shows it as "no longer in the catalog").
 * `expectedListId` is set only when the list differs from the shipped marks, so an account that never changed the list keeps its answers'
 * fingerprints as they were; a changed list makes answered D2 questions say "look again".
 */
export function withExpectedList(s: SamplingSuggestions, doc: ExpectedListDoc | undefined): EffectiveSuggestions {
  const cur = currentExpectedVersion(doc);
  if (!cur) return s;
  const keys = new Set(cur.keys);
  const candidates = s.candidates.map((c) => {
    const { expected: _drop, ...rest } = c;
    return keys.has(c.key) ? { ...rest, expected: true } : rest;
  });
  const out: EffectiveSuggestions = { ...s, candidates };
  if (!sameKeys(cur.keys.filter((k) => s.candidates.some((c) => c.key === k)), shippedExpectedKeys(s))) out.expectedListId = [...cur.keys].sort().join(",");
  return out;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The document with one more version on the end. Earlier versions stay as they were. */
export function addExpectedVersion(doc: ExpectedListDoc, s: SamplingSuggestions, keys: string[], kind: "edited" | "reset", reason: string | undefined, at = new Date().toISOString()): ExpectedListDoc {
  const next = Math.max(0, ...doc.versions.map((v) => v.number), ...doc.removed.map((r) => r.number)) + 1;
  const v: ExpectedListVersion = { id: newId(), number: next, at, keys: [...new Set(keys)], catalogVersion: s.catalog.version, kind, ...(reason?.trim() ? { reason: reason.trim() } : {}) };
  return { ...doc, versions: [...doc.versions, v] };
}

/** Removes a version and logs it with the reason. Removing the newest one returns to the one before it (or to the shipped marks). */
export function removeExpectedVersion(doc: ExpectedListDoc, id: string, reason: string, at = new Date().toISOString()): ExpectedListDoc {
  const v = doc.versions.find((x) => x.id === id);
  if (!v) return doc;
  return { versions: doc.versions.filter((x) => x.id !== id), removed: [...doc.removed, { at, number: v.number, savedAt: v.at, reason: reason.trim() || "No reason given." }] };
}
