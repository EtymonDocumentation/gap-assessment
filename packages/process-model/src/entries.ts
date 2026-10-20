import { allEntries, getEntry, parseRef } from "./paths";
import type { Actor, Entry, EntryStatus, EntryValue, Project, Source } from "./types";

export const SCHEMA_VERSION = "1.1.0";

let counter = 0;
/** Short unique id. Uses crypto.randomUUID where available. */
export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const rnd = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${rnd}${counter.toString(36)}`;
}

export function emptyProject(args: {
  title: string;
  actor: Actor;
  contentRefs: Project["contentRefs"];
  entrySequence?: "paired" | "sequential";
}): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { id: newId("prj"), title: args.title, createdAt: args.actor.at, createdBy: args.actor.name },
    contentRefs: args.contentRefs,
    settings: { entrySequence: args.entrySequence ?? "paired" },
    interview: { confirmations: [] },
    scope: {},
    processes: {
      source: { side: "source", site: { fields: {} }, unitOperations: {} },
      target: { side: "target", site: { fields: {} }, unitOperations: {} },
    },
    custom: { unitOperations: [], items: [] },
    sources: [],
    answers: [],
    gapOverlays: [],
    changeLog: [],
  };
}

/** The value of an entry after following "same as source". */
export interface Resolved {
  ref: string;
  status: EntryStatus;
  value?: EntryValue;
  /** Entry ids that contributed (target entry and, for same-as-source, the source entry). */
  entryIds: string[];
  sameAsSource: boolean;
  justification?: string;
}

export function resolveEntry(project: Project, ref: string): Resolved {
  const e = getEntry(project, ref);
  if (!e) return { ref, status: "not_established", entryIds: [], sameAsSource: false };
  if (e.sameAsSource && e.status === "established") {
    const p = parseRef(ref);
    if (p.side !== "target") throw new Error(`sameAsSource on non-target entry ${ref}`);
    const srcRef = "source" + ref.slice("target".length);
    const src = getEntry(project, srcRef);
    if (!src || src.sameAsSource) return { ref, status: "not_established", entryIds: [e.id], sameAsSource: true };
    const out: Resolved = { ref, status: src.status, entryIds: [e.id, src.id], sameAsSource: true };
    if (src.value !== undefined) out.value = src.value;
    if (src.justification) out.justification = src.justification;
    return out;
  }
  const out: Resolved = { ref, status: e.status, entryIds: [e.id], sameAsSource: false };
  if (e.value !== undefined) out.value = e.value;
  if (e.justification) out.justification = e.justification;
  return out;
}

/** Deterministic JSON with sorted object keys. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** FNV-1a 32-bit hash, hex. Adequate for change detection in a PoC; not a security control. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintResolved(r: Resolved): string {
  return fnv1a(stableStringify({ status: r.status, value: r.value ?? null, justification: r.justification ?? null }));
}

export type VerificationState =
  | { state: "unverified" }
  | { state: "verified"; by: string; at: string }
  /** The value changed after it was verified; the verification no longer applies. */
  | { state: "withdrawn"; by: string; at: string };

export function verificationState(project: Project, ref: string): VerificationState {
  const e = getEntry(project, ref);
  if (!e?.verification) return { state: "unverified" };
  const current = fingerprintResolved(resolveEntry(project, ref));
  const { by, at } = e.verification;
  return current === e.verification.fingerprint ? { state: "verified", by, at } : { state: "withdrawn", by, at };
}

/** Records verification of the current resolved value. Returns a new project. */
export function verifyEntry(project: Project, ref: string, actor: Actor): Project {
  const next = structuredClone(project);
  const e = getEntry(next, ref);
  if (!e) throw new Error(`No entry at ${ref}`);
  if (e.status === "not_established") throw new Error("An entry that is not established cannot be verified");
  e.verification = { by: actor.name, at: actor.at, fingerprint: fingerprintResolved(resolveEntry(next, ref)) };
  next.changeLog.push({ at: actor.at, by: actor.name, action: "verify", path: ref });
  return next;
}

/**
 * Removes a source and cascades: every entry loses that source id; an entry
 * left without sources reverts to "not_established" and its value is dropped
 * from the model (the prior value is kept in the change log only).
 * Returns the new project and the references that reverted.
 */
export function removeSource(project: Project, sourceId: string, actor: Actor): { project: Project; reverted: string[] } {
  const next = structuredClone(project);
  const src = next.sources.find((s) => s.id === sourceId);
  if (!src) throw new Error(`Unknown source ${sourceId}`);
  next.sources = next.sources.filter((s) => s.id !== sourceId);
  const reverted: string[] = [];
  for (const e of allEntries(next)) {
    if (!e.sourceIds.includes(sourceId)) continue;
    e.sourceIds = e.sourceIds.filter((id) => id !== sourceId);
    if (e.sourceIds.length === 0 && e.status !== "not_established") {
      next.changeLog.push({
        at: actor.at,
        by: actor.name,
        action: "revert_on_source_removal",
        path: e.path,
        before: { status: e.status, value: e.value, sameAsSource: e.sameAsSource },
        after: { status: "not_established" },
      });
      e.status = "not_established";
      delete e.value;
      delete e.sameAsSource;
      delete e.justification;
      e.revision += 1;
      reverted.push(e.path);
    }
  }
  next.answers = next.answers.filter((a) => a.sourceId !== sourceId);
  next.changeLog.push({ at: actor.at, by: actor.name, action: "remove_source", detail: `${src.type}: ${src.label}` });
  return { project: next, reverted };
}

export function sourceById(project: Project, id: string): Source | undefined {
  return project.sources.find((s) => s.id === id);
}

export function isEntry(v: unknown): v is Entry {
  return typeof v === "object" && v !== null && "status" in v && "path" in v && "sourceIds" in v;
}
