import { allEntries, getEntry, parseRef } from "./paths";
import type { Actor, Entry, EntryStatus, EntryValue, Project, Source, SourceLocation, TbdInfo } from "./types";

export const SCHEMA_VERSION = "1.12.0";

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
    tailoring: { excluded: [] },
    stepScope: { excluded: [] },
    sampling: { plans: [] },
    document: { exports: [] },
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
  /**
   * True when the value is a TBD best guess. The resolved status is then "established" so that comparison, validation and
   * conditions can run on it (the product owner's choice), but everything built from it must be labelled provisional.
   */
  provisional?: boolean;
  /** Set for every TBD entry, with or without a best guess, so verification and displays can still tell it from a fact. */
  tbd?: TbdInfo;
}

/** What one entry says by itself, before following "same as source". */
function ownView(e: Entry): { status: EntryStatus; value?: EntryValue; justification?: string; provisional?: boolean; tbd?: TbdInfo } {
  if (e.status === "tbd") {
    const info = e.tbd ?? {};
    // A best guess is read as if established, but it is never stored as a value and never counts as verified.
    if (info.bestGuess !== undefined) return { status: "established", value: info.bestGuess, provisional: true, tbd: info };
    return { status: "tbd", tbd: info };
  }
  const out: { status: EntryStatus; value?: EntryValue; justification?: string } = { status: e.status };
  if (e.value !== undefined) out.value = e.value;
  if (e.justification) out.justification = e.justification;
  return out;
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
    const v = ownView(src);
    const out: Resolved = { ref, status: v.status, entryIds: [e.id, src.id], sameAsSource: true };
    if (v.value !== undefined) out.value = v.value;
    if (v.justification) out.justification = v.justification;
    if (v.provisional) out.provisional = true;
    if (v.tbd) out.tbd = v.tbd;
    return out;
  }
  const v = ownView(e);
  const out: Resolved = { ref, status: v.status, entryIds: [e.id], sameAsSource: false };
  if (v.value !== undefined) out.value = v.value;
  if (v.justification) out.justification = v.justification;
  if (v.provisional) out.provisional = true;
  if (v.tbd) out.tbd = v.tbd;
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
  // "provisional" is added only when true, so every fingerprint made before TBD existed stays exactly the same.
  return fnv1a(stableStringify({ status: r.status, value: r.value ?? null, justification: r.justification ?? null, provisional: r.provisional ? true : undefined }));
}

// ------------------------------------------------------------------ verification

export type WithdrawnReason = "value_changed" | "status_changed" | "source_changed" | "changed";

export type VerificationState =
  | { state: "unverified" }
  | { state: "verified"; by: string; role?: string; at: string; selfVerification?: true }
  /** The value or status changed after it was verified; the verification no longer applies. */
  | { state: "withdrawn"; by: string; role?: string; at: string; reason: WithdrawnReason; selfVerification?: true };

export class VerificationError extends Error {}

export function verificationState(project: Project, ref: string): VerificationState {
  const e = getEntry(project, ref);
  if (!e?.verification) return { state: "unverified" };
  const r = resolveEntry(project, ref);
  const v = e.verification;
  const who = { by: v.by, ...(v.role ? { role: v.role } : {}), at: v.at, ...(v.selfVerification ? { selfVerification: true as const } : {}) };
  if (fingerprintResolved(r) === v.fingerprint) return { state: "verified", ...who };
  let reason: WithdrawnReason = "changed";
  if (v.status !== undefined) {
    if (r.status !== v.status || r.tbd) reason = "status_changed";
    else if (v.sameAsSource && r.sameAsSource) reason = "source_changed";
    else reason = "value_changed";
  }
  return { state: "withdrawn", ...who, reason };
}

const WITHDRAWN_TEXT: Record<WithdrawnReason, string> = {
  value_changed: "value changed after verification",
  status_changed: "status changed after verification",
  source_changed: "the source value changed after verification",
  changed: "value or status changed after verification",
};

/** One-line wording of a verification state, used by the document, the Builder and the change log. */
export function describeVerification(s: VerificationState): string {
  if (s.state === "unverified") return "Unverified";
  const who = `${s.by}${s.role ? ` (${s.role})` : ""}`;
  const same = s.selfVerification ? " (same person as recorder)" : "";
  if (s.state === "verified") return `Verified by ${who} on ${s.at.slice(0, 10)}${same}`;
  return `Verification withdrawn (${WITHDRAWN_TEXT[s.reason]}); was verified by ${who} on ${s.at.slice(0, 10)}${same}`;
}

/** Names compare case- and space-insensitively. */
export function sameName(a: string, b: string): boolean {
  const n = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  return n(a) !== "" && n(a) === n(b);
}

/** Who recorded the value behind a reference (for "same as source" this includes the source entry's recorder). */
export function recordersOf(project: Project, ref: string): string[] {
  const e = getEntry(project, ref);
  if (!e) return [];
  const out = [e.recordedBy];
  if (e.sameAsSource && e.status === "established" && ref.startsWith("target.")) {
    const src = getEntry(project, "source" + ref.slice("target".length));
    if (src) out.push(src.recordedBy);
  }
  return out;
}

/**
 * Why an entry cannot be verified, or undefined when it can.
 * Decision: established and not-applicable entries are verifiable. An entry that is not established has no
 * value to confirm, and a TBD entry is an open information item, so both are refused.
 */
export function verificationProblem(project: Project, ref: string): string | undefined {
  const e = getEntry(project, ref);
  if (!e) return `No entry at ${ref}`;
  const r = resolveEntry(project, ref);
  // Checked before the status: a TBD with a best guess resolves as "established" for the comparison, but a guess is not a fact.
  if (r.tbd) return "An entry marked TBD (to be determined) cannot be verified";
  if (r.status === "not_established") return "An entry that is not established cannot be verified";
  return undefined;
}

export interface VerifyOptions {
  /** Required when the verifier is the same person as the recorder of the entry. */
  selfVerification?: boolean;
}

/** True when the named person recorded the entry (four-eyes check). */
export function isSelfVerification(project: Project, ref: string, name: string): boolean {
  return recordersOf(project, ref).some((r) => sameName(r, name));
}

function snapshot(r: Resolved) {
  return {
    status: r.status,
    ...(r.value !== undefined ? { value: r.value } : {}),
    ...(r.justification ? { justification: r.justification } : {}),
    ...(r.sameAsSource ? { sameAsSource: true } : {}),
  };
}

/**
 * Records verification of the current resolved value. Returns a new project.
 * Four-eyes: when the verifier's name matches the recorder, the call is refused unless
 * `selfVerification: true`; the record then carries the flag and every display says so.
 */
export function verifyEntry(project: Project, ref: string, actor: Actor, opts: VerifyOptions = {}): Project {
  const problem = verificationProblem(project, ref);
  if (problem) throw new VerificationError(problem);
  if (!actor.name.trim()) throw new VerificationError("Enter the name of the person verifying");
  const self = isSelfVerification(project, ref, actor.name);
  if (self && !opts.selfVerification) {
    throw new VerificationError("The verifier recorded this entry. Another person should verify it, or confirm that you are verifying your own entry");
  }
  const next = structuredClone(project);
  const e = getEntry(next, ref)!;
  const prior = verificationState(project, ref);
  const r = resolveEntry(next, ref);
  e.verification = {
    by: actor.name.trim(),
    ...(actor.role?.trim() ? { role: actor.role.trim() } : {}),
    at: actor.at,
    fingerprint: fingerprintResolved(r),
    status: r.status,
    ...(r.sameAsSource ? { sameAsSource: true } : {}),
    ...(self ? { selfVerification: true } : {}),
  };
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "verify",
    path: ref,
    ...(self ? { detail: "Self-verification: the verifier is the same person as the recorder" } : {}),
    before: { verification: describeVerification(prior) },
    after: { ...snapshot(r), verification: describeVerification(verificationState(next, ref)) },
  });
  return next;
}

/** Withdraws a verification (verified or already withdrawn). A reason is required and is logged. */
export function unverifyEntry(project: Project, ref: string, actor: Actor, reason: string): Project {
  const why = reason.trim();
  if (!why) throw new VerificationError("A reason is required to withdraw a verification");
  const e = getEntry(project, ref);
  if (!e) throw new VerificationError(`No entry at ${ref}`);
  if (!e.verification) throw new VerificationError("This entry has no verification to withdraw");
  const prior = verificationState(project, ref);
  const next = structuredClone(project);
  delete getEntry(next, ref)!.verification;
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "unverify",
    path: ref,
    detail: why,
    before: { verification: describeVerification(prior), ...snapshot(resolveEntry(project, ref)) },
    after: { verification: describeVerification({ state: "unverified" }) },
  });
  return next;
}

export interface BulkVerifyResult {
  project: Project;
  verified: string[];
  skipped: { ref: string; reason: string }[];
}

/** Splits references into those that would be verified and those that would be skipped (with the reason). */
export function planVerification(project: Project, refs: string[], verifier: string, opts: VerifyOptions = {}): { verify: string[]; skip: { ref: string; reason: string }[] } {
  const verify: string[] = [];
  const skip: { ref: string; reason: string }[] = [];
  for (const ref of [...new Set(refs)]) {
    const problem = verificationProblem(project, ref);
    if (problem) skip.push({ ref, reason: problem });
    else if (verificationState(project, ref).state === "verified") skip.push({ ref, reason: "Already verified" });
    else if (!opts.selfVerification && isSelfVerification(project, ref, verifier)) {
      skip.push({ ref, reason: "Recorded by the verifier; verify it on its own to confirm self-verification" });
    } else verify.push(ref);
  }
  return { verify, skip };
}

/**
 * Verifies every entry in `refs` that can be verified. Entries that cannot are skipped and reported:
 * not established, TBD, already verified, or recorded by the verifier (unless `selfVerification` is set).
 * Each verification is logged as its own event, followed by one summary event.
 */
export function verifyEntries(project: Project, refs: string[], actor: Actor, opts: VerifyOptions = {}, label = "selection"): BulkVerifyResult {
  const plan = planVerification(project, refs, actor.name, opts);
  let cur = project;
  for (const ref of plan.verify) cur = verifyEntry(cur, ref, actor, opts);
  cur = structuredClone(cur);
  cur.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "verify_many",
    detail: `${label}: ${plan.verify.length} verified, ${plan.skip.length} skipped`,
    after: { verified: plan.verify.length, skipped: plan.skip.length },
  });
  return { project: cur, verified: plan.verify, skipped: plan.skip };
}

// ------------------------------------------------------------------ sources: cascade, attach, detach, usage

/** Reverts an entry to not_established (its value is kept only in the change log). Mutates the draft. */
function revertEntry(next: Project, e: Entry, actor: Actor, action: string): void {
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action,
    path: e.path,
    before: { status: e.status, value: e.value, sameAsSource: e.sameAsSource, ...(e.justification ? { justification: e.justification } : {}), ...(e.tbd ? { tbd: structuredClone(e.tbd) } : {}) },
    after: { status: "not_established" },
  });
  e.status = "not_established";
  delete e.tbd;
  delete e.sourceLocations;
  delete e.value;
  delete e.sameAsSource;
  delete e.justification;
  e.revision += 1;
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
  let detached = 0;
  for (const e of allEntries(next)) {
    if (!e.sourceIds.includes(sourceId)) continue;
    e.sourceIds = e.sourceIds.filter((id) => id !== sourceId);
    dropLocation(e, sourceId);
    detached++;
    if (e.sourceIds.length === 0 && e.status !== "not_established") {
      revertEntry(next, e, actor, "revert_on_source_removal");
      reverted.push(e.path);
    }
  }
  next.answers = next.answers.filter((a) => a.sourceId !== sourceId);
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "remove_source",
    detail: `${src.type}: ${src.label}`,
    before: structuredClone(src),
    after: { citingEntries: detached, reverted: reverted.length },
  });
  return { project: next, reverted };
}

/**
 * Clears recorded answers on purpose (the user withdrew them, as opposed to a source going away). Each entry that holds
 * anything (a value, TBD, not applicable, same as source) reverts to "not_established", its source links are removed
 * the same way a revert does it, and the old value is kept only in the change log. The source records themselves stay
 * in the register. Verification is not deleted: its fingerprint no longer matches, so it shows as withdrawn.
 * Entries that are missing or already "not_established" are skipped, so clearing twice logs nothing.
 */
export function clearEntries(project: Project, refs: string[], actor: Actor): { project: Project; cleared: string[] } {
  const todo = [...new Set(refs)].filter((r) => {
    const e = getEntry(project, r);
    return !!e && e.status !== "not_established";
  });
  if (!todo.length) return { project, cleared: [] };
  const next = structuredClone(project);
  for (const ref of todo) {
    const e = getEntry(next, ref)!;
    revertEntry(next, e, actor, "answer_cleared");
    next.changeLog[next.changeLog.length - 1]!.detail = "Answer cleared. The value is kept only in this log.";
    e.sourceIds = [];
  }
  return { project: next, cleared: todo };
}

/** Forgets the place in a document when the citation of that document goes away. Mutates the draft. */
function dropLocation(e: Entry, sourceId: string): void {
  if (!e.sourceLocations) return;
  delete e.sourceLocations[sourceId];
  if (!Object.keys(e.sourceLocations).length) delete e.sourceLocations;
}

/** Keeps only the parts that were really typed; returns undefined when nothing was. Nothing is ever invented. */
export function cleanLocation(loc?: SourceLocation): SourceLocation | undefined {
  const section = loc?.section?.trim();
  const page = loc?.page?.trim();
  if (!section && !page) return undefined;
  return { ...(section ? { section } : {}), ...(page ? { page } : {}) };
}

/** Detaches one source from one entry. Detaching the last source reverts the entry exactly like removing the source does. */
export function detachSource(project: Project, ref: string, sourceId: string, actor: Actor): { project: Project; reverted: boolean } {
  const e0 = getEntry(project, ref);
  if (!e0) throw new Error(`No entry at ${ref}`);
  const src = project.sources.find((s) => s.id === sourceId);
  if (!src) throw new Error(`Unknown source ${sourceId}`);
  if (!e0.sourceIds.includes(sourceId)) throw new Error("This entry does not cite that source");
  const next = structuredClone(project);
  const e = getEntry(next, ref)!;
  e.sourceIds = e.sourceIds.filter((id) => id !== sourceId);
  dropLocation(e, sourceId);
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "detach_source",
    path: ref,
    detail: `${src.type}: ${src.label}`,
    before: { sourceIds: [...e0.sourceIds], ...(e0.sourceLocations?.[sourceId] ? { location: { ...e0.sourceLocations[sourceId] } } : {}) },
    after: { sourceIds: [...e.sourceIds] },
  });
  let reverted = false;
  if (e.sourceIds.length === 0 && e.status !== "not_established") {
    revertEntry(next, e, actor, "revert_on_source_detach");
    reverted = true;
  }
  return { project: next, reverted };
}

/** Attaches an existing source to an entry that has a recorded status. Does not touch the value or its verification. */
export function attachSource(project: Project, ref: string, sourceId: string, actor: Actor, location?: SourceLocation): Project {
  const e0 = getEntry(project, ref);
  if (!e0) throw new Error(`No entry at ${ref}`);
  if (e0.status === "not_established") throw new Error("Nothing is recorded for this entry, so there is nothing to cite a source for");
  const src = project.sources.find((s) => s.id === sourceId);
  if (!src) throw new Error(`Unknown source ${sourceId}`);
  if (src.supersededBy) throw new Error("That source was superseded by a later answer and cannot be attached");
  if (e0.sourceIds.includes(sourceId)) throw new Error("This entry already cites that source");
  const next = structuredClone(project);
  attachInPlace(next, getEntry(next, ref)!, src, actor, location);
  return next;
}

/** Adds the source to one entry of the draft and logs it. One log record per entry, with the location when there is one. */
function attachInPlace(next: Project, e: Entry, src: Source, actor: Actor, location?: SourceLocation): void {
  const before = [...e.sourceIds];
  e.sourceIds = [...e.sourceIds, src.id];
  const loc = cleanLocation(location);
  if (loc) e.sourceLocations = { ...e.sourceLocations, [src.id]: loc };
  next.changeLog.push({
    at: actor.at,
    by: actor.name,
    action: "attach_source",
    path: e.path,
    detail: `${src.type}: ${src.label}`,
    before: { sourceIds: before },
    after: { sourceIds: [...e.sourceIds], ...(loc ? { location: loc } : {}) },
  });
}

/**
 * Attaches one source to many entries in one pass (the project is copied once, not once per entry). Each entry gets its own
 * change-log record. Entries that already cite the source are left exactly as they are and reported, so repeating the
 * call changes nothing. An entry with nothing recorded is an error: a citation must back a recorded status.
 */
export function attachSourceMany(project: Project, refs: string[], sourceId: string, actor: Actor, location?: SourceLocation): { project: Project; attached: string[]; alreadyCited: string[] } {
  const src = project.sources.find((s) => s.id === sourceId);
  if (!src) throw new Error(`Unknown source ${sourceId}`);
  if (src.supersededBy) throw new Error("That source was superseded by a later answer and cannot be attached");
  const next = structuredClone(project);
  const attached: string[] = [];
  const alreadyCited: string[] = [];
  for (const ref of [...new Set(refs)]) {
    const e = getEntry(next, ref);
    if (!e) throw new Error(`No entry at ${ref}`);
    if (e.status === "not_established") throw new Error("Nothing is recorded for this entry, so there is nothing to cite a source for");
    if (e.sourceIds.includes(sourceId)) alreadyCited.push(ref);
    else {
      attachInPlace(next, e, src, actor, location);
      attached.push(ref);
    }
  }
  return { project: attached.length ? next : project, attached, alreadyCited };
}

/** One source with the entries that cite it (every entry, including inactive ones). Sources nobody cites are flagged unused. */
export interface SourceUse {
  source: Source;
  refs: string[];
  unused: boolean;
}

export function sourceUsage(project: Project): SourceUse[] {
  const byId = new Map<string, string[]>(project.sources.map((s) => [s.id, []]));
  for (const e of allEntries(project)) for (const id of e.sourceIds) byId.get(id)?.push(e.path);
  return project.sources.map((source) => {
    const refs = byId.get(source.id) ?? [];
    return { source, refs, unused: refs.length === 0 };
  });
}

export function sourceById(project: Project, id: string): Source | undefined {
  return project.sources.find((s) => s.id === id);
}

export function isEntry(v: unknown): v is Entry {
  return typeof v === "object" && v !== null && "status" in v && "path" in v && "sourceIds" in v;
}
