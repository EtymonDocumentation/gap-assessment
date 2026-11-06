import { projectStage } from "./stage";
import {
  newId,
  parseProject,
  stableStringify,
  type Actor,
  type ChangeEvent,
  type Project,
  type VersionEntry,
  type VersionHistory,
  type VersionKind,
  type VersionRemoval,
} from "@gap/process-model";

/*
 * Version history (Cascade 1.30). A version is a frozen, read-only copy of the WHOLE project (answers, documents, change log) with the date,
 * the person, the project stage and a reason. The copies live inside the project record (project.versionHistory), compressed, so they travel
 * with every export, copy and server save and can never drift from the project they describe.
 *
 * Nothing here decides anything for the team: a version is a record, not an approval. The company's own document control approves documents.
 * Words shown to people say "version" and "working copy", never "snapshot", "commit" or "revision" (revision already means something in old
 * export records).
 */

/**
 * The size budget of the history. A gzip-compressed project is expected to take a few hundred KB (the numbers measured at the time this was
 * built are in the S1 report), and the server accepts a project body up to 25 MB, so 12 MB of saved versions leaves room for the project
 * itself. 60 versions is far more than a transfer needs; the point of a cap is that a project never silently grows without bound.
 */
export const VERSION_LIMITS = { maxVersions: 60, maxBytes: 12 * 1024 * 1024, warnShare: 0.8 } as const;

/** A reason for a stage change or a removal is a short sentence, not an essay and not a single letter. */
export const REASON_MIN = 3;
export const REASON_MAX = 300;

/** The text of the start version, so a reader knows why it exists. */
export const START_VERSION_REASON = "Starting version: the project as it was when version history began";

/** A problem the person can fix; the message is shown as it is. */
export class VersionError extends Error {}
/** The budget is used up. The message says so plainly and points to "Remove a version". */
export class VersionLimitError extends VersionError {}

// ------------------------------------------------------------------ compression

/** Runs bytes through a (de)compression stream. CompressionStream exists in every current browser and in Node 18 and later. */
async function pump(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  // In slices: String.fromCharCode(...bytes) on a whole snapshot would overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Text -> gzip -> base64. */
export async function compressText(text: string): Promise<string> {
  return toBase64(await pump(new TextEncoder().encode(text), new CompressionStream("gzip")));
}

/** base64 -> gunzip -> text. */
export async function decompressText(data: string): Promise<string> {
  return new TextDecoder().decode(await pump(fromBase64(data), new DecompressionStream("gzip")));
}

// ------------------------------------------------------------------ fingerprint

/**
 * A 64-bit hash (two independent 32-bit lanes, 16 hex digits) of text. Fast on a multi-megabyte project (no BigInt) and good enough to tell
 * "nothing changed since the last version" from "something did". Not a security control.
 */
function hash64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The project as a version holds it: everything except the history itself (a version never contains the other versions). */
export function withoutHistory(project: Project): Omit<Project, "versionHistory"> {
  const { versionHistory: _history, ...rest } = project; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

/**
 * Fingerprint of the project without its history. Equal fingerprints = the working copy is the same as that version.
 * The download log (document.exports) is left out: downloading a Word file records who downloaded what, but it changes no answer, so it
 * must not make the project show "unsaved changes". The list is emptied rather than removed, so a project that never downloaded anything
 * gets the same fingerprint as before this rule. The frozen snapshot still keeps the log; only the comparison ignores it.
 */
export function projectFingerprint(project: Project | Omit<Project, "versionHistory">): string {
  const body = withoutHistory(project as Project);
  return hash64(stableStringify({ ...body, document: { ...body.document, exports: [] } }));
}

/** The fingerprint as versions saved before the download-log rule stored it (log included). Only used to read those older entries. */
function legacyFingerprint(project: Project): string {
  return hash64(stableStringify(withoutHistory(project)));
}

// ------------------------------------------------------------------ reading the history

export const emptyHistory = (): VersionHistory => ({ entries: [], reviews: [] });

export const historyOf = (project: Project): VersionHistory => project.versionHistory ?? emptyHistory();

/** The newest saved version, or undefined when none was saved yet. */
export function lastVersion(project: Project): VersionEntry | undefined {
  return historyOf(project).entries.at(-1);
}

/** True when the working copy differs from the newest saved version (or nothing was saved). */
export function hasUnsavedChanges(project: Project): boolean {
  const last = lastVersion(project);
  if (!last) return true;
  if (last.fingerprint === projectFingerprint(project)) return false;
  // A version saved before the download log was left out holds the old kind of fingerprint. Matching it still means "nothing changed",
  // so such a project does not flip to "unsaved changes" just because the rule changed. Its next download marks it once, until it is saved.
  return last.fingerprint !== legacyFingerprint(project);
}

/** "v2", "v2.1". */
export function versionLabelOf(major: number, minor: number): string {
  return minor === 0 ? `v${major}` : `v${major}.${minor}`;
}

/**
 * The number the next version gets, chosen from the list being saved INCLUDING the versions that were removed, so a label is never used
 * twice (removing v2.3 does not free "v2.3") and a number kept by another computer or a merge is not repeated.
 *  - a stage change is a MAJOR version: the highest major so far + 1, minor 0 (going back a stage also moves forward in number);
 *  - every other version stays in the current (highest) major and takes the next minor number.
 */
export function nextVersionNumber(history: VersionHistory, kind: VersionKind): { major: number; minor: number } {
  const seen = [...history.entries, ...(history.removed ?? [])];
  if (seen.length === 0) return kind === "stage-change" ? { major: 2, minor: 0 } : kind === "start" ? { major: 1, minor: 0 } : { major: 1, minor: 1 };
  const major = Math.max(...seen.map((v) => v.major));
  if (kind === "stage-change") return { major: major + 1, minor: 0 };
  return { major, minor: Math.max(...seen.filter((v) => v.major === major).map((v) => v.minor)) + 1 };
}

export interface HistoryUsage {
  count: number;
  bytes: number;
  maxVersions: number;
  maxBytes: number;
  /** The larger of the two shares of the budget that are used, 0 to 1 (or more when it was exceeded on another computer). */
  share: number;
  /** At 80 percent the history page says so. */
  nearLimit: boolean;
  atLimit: boolean;
}

export function historyUsage(project: Project): HistoryUsage {
  const h = historyOf(project);
  const bytes = h.entries.reduce((n, e) => n + e.bytes, 0);
  const share = Math.max(h.entries.length / VERSION_LIMITS.maxVersions, bytes / VERSION_LIMITS.maxBytes);
  return {
    count: h.entries.length,
    bytes,
    maxVersions: VERSION_LIMITS.maxVersions,
    maxBytes: VERSION_LIMITS.maxBytes,
    share,
    nearLimit: share >= VERSION_LIMITS.warnShare,
    atLimit: h.entries.length >= VERSION_LIMITS.maxVersions || bytes >= VERSION_LIMITS.maxBytes,
  };
}

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** The plain sentence shown when the budget is used up. It always offers the way out. */
export function limitMessage(project: Project): string {
  const u = historyUsage(project);
  const used = u.count >= u.maxVersions ? `The project already holds ${u.count} saved versions, which is the limit.` : `The saved versions already take up ${mb(u.bytes)} of the ${mb(u.maxBytes)} limit.`;
  return `${used} Remove a version you no longer need, then try again.`;
}

// ------------------------------------------------------------------ saving

const record = (actor: Actor, action: string, path: string, detail: string, before?: unknown, after?: unknown): ChangeEvent => ({
  at: actor.at,
  by: actor.name,
  action,
  path,
  detail,
  ...(before !== undefined ? { before } : {}),
  ...(after !== undefined ? { after } : {}),
});

const KIND_WORD: Record<VersionKind, string> = { start: "starting version", manual: "manual", "before-change": "saved automatically before a stage change", "stage-change": "stage change" };

/**
 * Freezes the project as one new version. The change-log record is written FIRST and is part of the frozen copy: otherwise the record that
 * says "version saved" would make the working copy differ from the version it just saved, and the project would show "unsaved changes"
 * the moment it was saved. Throws VersionLimitError (and changes nothing) when the budget is used up.
 */
async function freeze(
  project: Project,
  actor: Actor,
  kind: VersionKind,
  opts: { reason: string; stage: string | undefined; fromStage?: string | undefined; record: (label: string) => ChangeEvent },
): Promise<{ project: Project; entry: VersionEntry }> {
  const history = historyOf(project);
  if (history.entries.length >= VERSION_LIMITS.maxVersions) throw new VersionLimitError(limitMessage(project));
  const { major, minor } = nextVersionNumber(history, kind);
  const label = versionLabelOf(major, minor);
  const working: Project = { ...project, changeLog: [...project.changeLog, opts.record(label)] };
  const body = withoutHistory(working);
  const data = await compressText(JSON.stringify(body));
  const used = history.entries.reduce((n, e) => n + e.bytes, 0);
  if (used + data.length > VERSION_LIMITS.maxBytes) throw new VersionLimitError(limitMessage(project));
  const entry: VersionEntry = {
    id: newId("ver"),
    major,
    minor,
    label,
    kind,
    at: actor.at,
    by: actor.name,
    ...(opts.stage ? { stage: opts.stage } : {}),
    ...(opts.fromStage ? { fromStage: opts.fromStage } : {}),
    reason: opts.reason,
    fingerprint: projectFingerprint(body),
    bytes: data.length,
    snapshot: { encoding: "gzip-base64", data },
  };
  return { project: { ...working, versionHistory: { ...history, entries: [...history.entries, entry] } }, entry };
}


/**
 * Saves a version of the project as it is ("Save a version"): the current major, the next minor. The optional note says what the version is
 * for.
 */
export async function saveVersion(project: Project, actor: Actor, note = ""): Promise<{ project: Project; entry: VersionEntry }> {
  const text = note.trim();
  if (text.length > REASON_MAX) throw new VersionError(`The note can be at most ${REASON_MAX} characters.`);
  return freeze(project, actor, "manual", {
    reason: text,
    stage: projectStage(project),
    record: (label) => record(actor, "version_save", "version", `${label}, ${KIND_WORD.manual}${text ? `: ${text}` : ""}`, undefined, { label, kind: "manual" }),
  });
}

/**
 * Makes the START version (v1) when the history has never held a version: the project as it was when version history began. The project
 * store calls this the first time it opens a project, because the migration that adds the history cannot compress (it is synchronous).
 * Does nothing (returns the same project) when a version exists, and also when versions existed but were all removed: the person chose to
 * remove them, so opening the project must not bring one back.
 */
export async function ensureStartVersion(project: Project, actor: Actor): Promise<Project> {
  const h = historyOf(project);
  if (h.entries.length > 0 || (h.removed ?? []).length > 0) return project;
  return (
    await freeze(project, actor, "start", {
      reason: START_VERSION_REASON,
      stage: projectStage(project),
      record: (label) => record(actor, "version_save", "version", `${label}, ${KIND_WORD.start}`, undefined, { label, kind: "start" }),
    })
  ).project;
}

// ------------------------------------------------------------------ stage-change building blocks (used by changeProjectStage)

/** Saves the minor "before-change" version when there are edits since the last version (or makes the start version when none exists). */
export async function saveBeforeChange(project: Project, actor: Actor, toStageText: string): Promise<Project> {
  const h = historyOf(project);
  // A history that never held a version starts with the start version. One whose versions were all removed saves a before-change version.
  if (h.entries.length === 0 && (h.removed ?? []).length === 0) return ensureStartVersion(project, actor);
  if (!hasUnsavedChanges(project)) return project;
  const reason = `Saved automatically before the change to ${toStageText}`;
  return (
    await freeze(project, actor, "before-change", {
      reason,
      stage: projectStage(project),
      record: (label) => record(actor, "version_save", "version", `${label}, ${KIND_WORD["before-change"]}: ${reason}`, undefined, { label, kind: "before-change" }),
    })
  ).project;
}

/** Freezes the stage-change version (the project right after the change) with the stage_change record inside it. */
export async function saveStageChangeVersion(
  project: Project,
  actor: Actor,
  opts: { fromStage: string | undefined; reason: string; makeRecord: (label: string) => ChangeEvent },
): Promise<{ project: Project; entry: VersionEntry }> {
  return freeze(project, actor, "stage-change", { reason: opts.reason, stage: projectStage(project), fromStage: opts.fromStage, record: opts.makeRecord });
}

// ------------------------------------------------------------------ opening

/** Opens a saved version as a project (read through parseProject, so a version saved by an older build opens in the current schema). */
export async function readVersion(entry: VersionEntry): Promise<Project> {
  if (entry.snapshot.encoding !== "gzip-base64") throw new VersionError("This version was saved in a form this build cannot read.");
  return parseProject(JSON.parse(await decompressText(entry.snapshot.data)));
}

/** The saved version with this id, or undefined. */
export const versionById = (project: Project, id: string): VersionEntry | undefined => historyOf(project).entries.find((e) => e.id === id);

// ------------------------------------------------------------------ removal

/**
 * Removes a saved version. ANY version can go (start, major or minor): nothing in the history may be undeletable. It needs a reason, is
 * written to the change log and leaves a line in the history, so a number is never used twice and the gap is visible. It never changes the
 * working project or its stage: only the frozen copy is dropped.
 */
export function removeVersion(project: Project, entryId: string, actor: Actor, reason: string): Project {
  const why = reason.trim();
  if (why.length < REASON_MIN) throw new VersionError("Say why this version is removed (at least 3 characters).");
  if (why.length > REASON_MAX) throw new VersionError(`The reason can be at most ${REASON_MAX} characters.`);
  const h = historyOf(project);
  const entry = h.entries.find((e) => e.id === entryId);
  if (!entry) throw new VersionError("That version is not in the history.");
  const gone: VersionRemoval = {
    label: entry.label,
    major: entry.major,
    minor: entry.minor,
    kind: entry.kind,
    ...(entry.stage ? { stage: entry.stage } : {}),
    savedAt: entry.at,
    at: actor.at,
    by: actor.name,
    reason: why,
  };
  return {
    ...project,
    versionHistory: { ...h, entries: h.entries.filter((e) => e.id !== entryId), removed: [...(h.removed ?? []), gone] },
    changeLog: [...project.changeLog, record(actor, "version_remove", "version", `${entry.label} removed: ${why}`, { label: entry.label, savedAt: entry.at }, undefined)],
  };
}

/** "v2.3 removed on 2026-11-04 by <name>: <reason>" (the line the history shows where the version was). */
export function removalLine(r: VersionRemoval): string {
  return `${r.label} removed on ${r.at.slice(0, 10)} by ${r.by}: ${r.reason}`;
}
