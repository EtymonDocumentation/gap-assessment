import { ensureStartVersion } from "@gap/engine";
import { parseProject, type Project } from "@gap/process-model";
import { del, get, keys as listKeys, set } from "idb-keyval";
import { create } from "zustand";
import * as api from "./api";
import type { ProjectSummary } from "./api";
import { afterSessionEnds, beforeSessionEnds, currentUserId } from "./session-store";

/**
 * Keeps the open project in step with the server: autosave with a revision number, conflict detection, the list of
 * the user's projects, and an offline copy in this browser's IndexedDB (a cache of the projects open in this browser's tabs, one slot each).
 * Used only in server mode with `storage: "server"`.
 */

const CACHE_KEY = "gap-assessment:server-cache";
const DEBOUNCE_MS = 1000;
const RETRY_MS = 5000;
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface Cache {
  projectId: string | null;
  /** The server revision this copy was based on. */
  revision: number;
  /** True when this copy has changes the server does not have. */
  dirty: boolean;
  project: Project;
  /** When this copy was written (milliseconds). Copies from before this field have none. */
  at?: number;
}

export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

interface SyncState {
  /** Server id of the open project (null until it has been saved once). */
  projectId: string | null;
  /** The server revision the next save is based on. */
  revision: number;
  phase: SavePhase;
  error: string | null;
  /** Set when the server holds a newer version than the one this save was based on. */
  conflict: { revision: number; updatedAt: string } | null;
  list: ProjectSummary[];
  listState: "idle" | "loading" | "ready" | "error";
  listError: string;
}

const INITIAL: SyncState = { projectId: null, revision: 0, phase: "idle", error: null, conflict: null, list: [], listState: "idle", listError: "" };

export const useSync = /* @__PURE__ */ create<SyncState>(() => ({ ...INITIAL }));
const patch = (p: Partial<SyncState>) => useSync.setState(p);

/** What this layer needs from the project store (set once by the store, so the two files do not import each other). */
export interface Host {
  getProject(): Project | null;
  /** Puts a project into the store without saving it again. */
  replace(p: Project | null, status: string): void;
  fail(message: string): void;
}
let host: Host | null = null;
let connected = false;
/** Connects the save layer to the project store. Called once, in server mode only. */
export function connect(h: Host): void {
  host = h;
  if (connected) return;
  connected = true;
  beforeSessionEnds(async () => {
    if (host?.getProject()) await flush();
  });
  afterSessionEnds(() => {
    reset();
    // The browser copy of this account stays for its next sign-in; this tab just stops pointing at it.
    setActiveSlot(null);
    patch({ list: [], listState: "idle", listError: "" });
  });
}
const H = (): Host => {
  if (!host) throw new Error("The save layer is not connected.");
  return host;
};

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let chain: Promise<void> | undefined;
let lifecycleStarted = false;

// The offline copy. One browser, one account, several tabs: each project has its own slot, so two tabs with two different projects do not
// overwrite each other's copy (CR-09). A project that has not been saved yet has a slot of its own per tab. Two small pointers say which slot
// to reopen: one per tab (sessionStorage, so a reload of a tab finds its own project) and one for the whole browser (the project last worked
// on, for a tab that is opened fresh). The old single slot (`<base>`) is still read once and then replaced by the new ones.
const cacheBase = () => `${CACHE_KEY}:${currentUserId() ?? "none"}`;
const lastKey = () => `${cacheBase()}:last`;
const tabKey = () => `${cacheBase()}:tab`;
const slotKey = (projectId: string | null) => (projectId === null ? `${cacheBase()}:new:${tabToken()}` : `${cacheBase()}:p:${projectId}`);

let token: string | undefined;
/** A name for this tab's slot of an unsaved project. Only has to differ from the other tabs'. */
function tabToken(): string {
  token ??= typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return token;
}
/** The slot this tab writes to now. Kept here (not worked out from the project id) because reset() clears the id before the slot is cleared. */
let activeSlot: string | null = null;
/** Changes the slot this tab works in, and tells the other tabs (see claimSlot). */
function setActiveSlot(key: string | null): void {
  activeSlot = key;
  claimSlot(key);
}

// Which slots are in use right now. The browser-wide pointer cannot tell a copy that another open tab is still working in from one left behind
// by a tab that was closed, so a tab that was opened fresh used to take over the other tab's project, find its unsaved changes and save them
// under the other tab's revision: that tab then got a false "changed on another computer". Each tab therefore holds a Web Lock named after its
// slot for as long as it is open (the browser lets go of it when the tab closes or reloads). A fresh tab leaves a slot alone while it is held,
// and no tab removes a slot that another tab holds. Without the Web Locks API (an old browser, or a page not served over https) there is no
// way to tell, and the tab behaves as before.
const LOCK_PREFIX = "gap-assessment:slot:";
const locksApi = (): LockManager | undefined => (typeof navigator === "undefined" ? undefined : navigator.locks);
let held: { key: string; letGo: () => void } | null = null;
function claimSlot(key: string | null): void {
  const locks = locksApi();
  if (!locks || held?.key === key) return;
  held?.letGo();
  held = null;
  if (!key) return;
  let release = () => {};
  const open = new Promise<void>((resolve) => (release = resolve));
  const waiting = new AbortController();
  // Letting go also cancels a request that is still waiting, so a slot this tab only asked for and never got does not look taken.
  held = {
    key,
    letGo: () => {
      waiting.abort();
      release();
    },
  };
  // Not awaited: when this tab was just reloaded, the page it replaces may still have the lock for a moment, and this request waits its turn.
  try {
    locks.request(LOCK_PREFIX + key, { signal: waiting.signal }, () => open).catch(() => undefined);
  } catch {
    /* a browser that refuses locks behaves as one without them */
  }
}
/** True when another tab has this slot open now. */
async function slotInUseElsewhere(key: string): Promise<boolean> {
  const locks = locksApi();
  if (!locks || held?.key === key) return false;
  try {
    return await locks.request(LOCK_PREFIX + key, { ifAvailable: true }, (lock) => lock === null);
  } catch {
    return false;
  }
}

// sessionStorage can be missing or refuse (private windows, blocked site data): the copy then simply has no tab pointer.
function readTabPointer(): string | null {
  try {
    return sessionStorage.getItem(tabKey());
  } catch {
    return null;
  }
}
function writeTabPointer(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(tabKey(), key);
    else sessionStorage.removeItem(tabKey());
  } catch {
    /* the browser cache still works without it */
  }
}

async function writeCache(project: Project, dirty: boolean): Promise<void> {
  const s = useSync.getState();
  const c: Cache = { projectId: s.projectId, revision: s.revision, dirty, project, at: Date.now() };
  const key = slotKey(s.projectId);
  const previous = activeSlot;
  setActiveSlot(key);
  writeTabPointer(key);
  await set(key, c);
  await set(lastKey(), key).catch(() => undefined);
  // The slot changed: the project was saved for the first time (its unsaved slot is no longer needed), another project was opened, or the old
  // single slot was replaced. The old slot's content is in the new one, or was saved before this tab left it. If another tab has the old slot
  // open (the same project open in two tabs), that tab's copy stays.
  if (previous && previous !== key && !(await slotInUseElsewhere(previous))) await del(previous).catch(() => undefined);
}
async function clearCache(): Promise<void> {
  const key = activeSlot;
  setActiveSlot(null);
  writeTabPointer(null);
  if (!key) return;
  await del(key).catch(() => undefined);
  // The browser-wide pointer must not point at a slot that is gone.
  if ((await get<string>(lastKey()).catch(() => undefined)) === key) await del(lastKey()).catch(() => undefined);
}

/**
 * Finds the copy to reopen: this tab's own project, else the one last worked on in the browser (unless another tab has it open: that tab is
 * working in it, and a second tab picking up and saving its changes would give that tab a false conflict), else the old single slot.
 */
async function readCache(): Promise<{ key: string; cache: Cache } | undefined> {
  const keys: string[] = [];
  const mine = readTabPointer();
  if (mine) keys.push(mine);
  const last = await get<string>(lastKey()).catch(() => undefined);
  if (last && !keys.includes(last) && !(await slotInUseElsewhere(last))) keys.push(last);
  keys.push(cacheBase());
  for (const key of keys) {
    const cache = await get<Cache>(key).catch(() => undefined);
    if (cache) return { key, cache };
  }
  return undefined;
}

/**
 * Removes copies that are clean (the server has the same) and have not been touched for a week. A copy with unsaved changes is never removed,
 * and a copy another tab may be using is too young to go. Best effort.
 */
async function pruneCache(keep: string | null): Promise<void> {
  try {
    const prefix = `${cacheBase()}:`;
    for (const k of await listKeys()) {
      if (typeof k !== "string" || !(k === cacheBase() || k.startsWith(prefix)) || k === keep || k === lastKey()) continue;
      const c = await get<Cache>(k);
      if (c && !c.dirty && Date.now() - (c.at ?? 0) > PRUNE_AFTER_MS) await del(k);
    }
  } catch {
    /* housekeeping only */
  }
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function schedule(ms: number) {
  clearTimer();
  timer = setTimeout(() => void flush(), ms);
}

/** Forgets the open project's server state (the list of projects is kept). */
function reset() {
  generation++;
  clearTimer();
  patch({ projectId: null, revision: 0, phase: "idle", error: null, conflict: null });
}

// ------------------------------------------------------------------ saving

/** Saves the open project now if it has unsaved changes. Resolves when the attempt is over (it never throws). */
export function flush(opts: { keepalive?: boolean } = {}): Promise<void> {
  clearTimer();
  const next = (chain ?? Promise.resolve()).then(() => saveOnce(!!opts.keepalive)).catch(() => undefined);
  chain = next;
  return next;
}

async function saveOnce(keepalive: boolean): Promise<void> {
  const project = H().getProject();
  const st = useSync.getState();
  if (!project) return;
  const needs = st.projectId === null || st.phase === "dirty" || st.phase === "error";
  if (!needs) return;
  const gen = generation;
  patch({ phase: "saving", error: null });
  try {
    let id = st.projectId;
    let revision: number;
    let updatedAt: string;
    if (id === null) {
      const r = await api.createProject(project, keepalive);
      id = r.id;
      revision = r.revision;
      updatedAt = r.updatedAt;
    } else {
      const r = await api.putProject(id, project, st.revision, keepalive);
      revision = r.revision;
      updatedAt = r.updatedAt;
    }
    if (gen !== generation) return;
    const changedMeanwhile = H().getProject() !== project;
    patch({ projectId: id, revision, phase: changedMeanwhile ? "dirty" : "saved", error: null, conflict: null });
    upsertListEntry({ id, title: project.meta.title, updatedAt, revision, schemaVersion: project.schemaVersion });
    await writeCache(H().getProject() ?? project, changedMeanwhile).catch(() => undefined);
    if (changedMeanwhile) schedule(DEBOUNCE_MS);
  } catch (e) {
    if (gen !== generation) return;
    const err = e as api.ApiError;
    if (err.status === 409 && err.code === "conflict") {
      const rev = typeof err.body.revision === "number" ? err.body.revision : st.revision + 1;
      const at = typeof err.body.updatedAt === "string" ? err.body.updatedAt : "";
      patch({ phase: "conflict", error: null, conflict: { revision: rev, updatedAt: at } });
      return;
    }
    if (err.status === 401) return; // the session ended; the unsaved project stays in the browser cache
    if (err.status === 404 && st.projectId !== null) {
      // The project was deleted from the server (on another computer) while it was open here. restore() answers the same case by saving the
      // person's copy as a new project; do the same, and say so, instead of showing a bare "could not be saved" that never goes away.
      // The copy is not lost: it is in this browser until the new project is saved.
      patch({ projectId: null, revision: 0, phase: "dirty", error: null, conflict: null, list: useSync.getState().list.filter((x) => x.id !== st.projectId) });
      H().fail("This project was removed from the server, probably on another computer. Your copy is kept here and is being saved again as a new project.");
      await writeCache(H().getProject() ?? project, true).catch(() => undefined);
      schedule(0);
      return;
    }
    const text =
      err.status === 0
        ? "The project could not be saved because the server cannot be reached. It is kept in this browser and will be saved when the connection returns."
        : err.status === 400
          ? `The server did not accept this project: ${err.message}`
          : err.status === 413
            ? `The project is too large to save: ${err.message}`
            : `The project could not be saved: ${err.message}`;
    patch({ phase: "error", error: text });
    if (err.status === 0) schedule(RETRY_MS);
  }
}

function upsertListEntry(entry: ProjectSummary) {
  const list = useSync.getState().list;
  const next = list.some((x) => x.id === entry.id) ? list.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...list];
  patch({ list: [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
}

/** Called by the store on every change to the open project (or when it is closed: null). */
export async function onLocalChange(p: Project | null): Promise<void> {
  if (!p) {
    reset();
    await clearCache();
    return;
  }
  const s = useSync.getState();
  if (s.phase !== "conflict") {
    patch({ phase: "dirty", error: null });
    schedule(s.projectId === null ? 0 : DEBOUNCE_MS);
  }
  await writeCache(p, true);
}

/** Called before a different project replaces the open one (new, demo, import). Unsaved changes of the old one are saved in the background. */
export function beginNew(): void {
  const old = H().getProject();
  const s = useSync.getState();
  if (old && (s.projectId === null || s.phase === "dirty" || s.phase === "error")) {
    const snapshot = { project: old, id: s.projectId, revision: s.revision };
    void (async () => {
      try {
        if (snapshot.id === null) await api.createProject(snapshot.project);
        else await api.putProject(snapshot.id, snapshot.project, snapshot.revision);
      } catch (e) {
        H().fail(`The project you just left could not be saved: ${(e as Error).message}`);
      }
    })();
  }
  reset();
}

/** Makes sure the open project exists on the server and returns its id (files are attached to it). */
export async function ensureSaved(): Promise<string> {
  if (!H().getProject()) throw new Error("Open a project first.");
  if (useSync.getState().projectId === null || useSync.getState().phase === "dirty") await flush();
  const s = useSync.getState();
  if (s.projectId === null) throw new Error(s.error ?? "The project has not been saved to the server yet. Try again in a moment.");
  return s.projectId;
}

// ------------------------------------------------------------------ list, open, close, delete

export async function loadList(): Promise<void> {
  patch({ listState: "loading", listError: "" });
  try {
    const list = await api.listProjects();
    patch({ list: [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), listState: "ready" });
  } catch (e) {
    patch({ listState: "error", listError: (e as Error).message });
  }
}

/**
 * Makes the start version (v1) for a project that arrives with an empty history (see addStartVersion in the project store). Returns the same
 * project when nothing was needed, so the caller can tell by identity whether it must save the result.
 */
async function withStartVersion(p: Project): Promise<Project> {
  const r = p.interview.responder;
  try {
    return await ensureStartVersion(p, { name: r?.name ?? "Unnamed user", ...(r?.role ? { role: r.role } : {}), at: new Date().toISOString() });
  } catch {
    // A browser that cannot compress still opens the project; the version is made on a later open.
    return p;
  }
}

/**
 * Saves the open project and throws while that is not possible (a conflict, or a save that failed). `what` finishes the sentence "..., so it
 * cannot be ...": closing the project (opening another one closes it) or leaving it for a new one.
 */
async function settle(what = "it cannot be closed"): Promise<void> {
  await flush();
  // Edits made while that save was running leave the project dirty again: save them too, a few times at most.
  for (let i = 0; i < 3 && useSync.getState().phase === "dirty"; i++) await flush();
  const s = useSync.getState();
  if (s.phase === "conflict") throw new Error("This project was changed on another computer. Choose which version to keep first.");
  if (s.phase === "error") throw new Error(`The open project could not be saved yet, so ${what}. ${s.error ?? ""} Download it from the Project page if you need a copy.`.trim());
}

/**
 * Called before a new project, a demo or an import takes the place of the open project. Returns why it cannot go on yet (the open project has
 * a save that failed, or a conflict), or null when the open project is saved and the new one may be started. Same rule, same words as opening
 * or closing a project, so the person's edits are never dropped by starting something new.
 */
export async function refuseNew(): Promise<string | null> {
  if (!H().getProject()) return null;
  try {
    await settle("no other project can be started yet");
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * True when reading a stored project changed its schema version, i.e. an older file was migrated on load. The converted
 * copy (with the change-log records the migration wrote) is then saved back to the server, so the stored project, the
 * browser copy and every other computer show the same record instead of each re-converting the old file with its own time.
 */
const wasMigrated = (raw: unknown, parsed: Project): boolean => (raw as { schemaVersion?: unknown } | null)?.schemaVersion !== parsed.schemaVersion;

export async function openProject(id: string): Promise<void> {
  if (H().getProject()) await settle();
  const r = await api.getProject(id);
  const parsed = parseProject(r.project);
  const project = await withStartVersion(parsed);
  const migrated = wasMigrated(r.project, parsed) || project !== parsed;
  reset();
  patch({ projectId: r.id, revision: r.revision, phase: migrated ? "dirty" : "saved" });
  H().replace(project, "Project opened");
  await writeCache(project, migrated);
  if (migrated) schedule(0);
}

export async function closeProject(): Promise<void> {
  if (H().getProject()) await settle();
  reset();
  H().replace(null, "Project closed");
  await clearCache();
}

export async function deleteProjectById(id: string): Promise<void> {
  await api.deleteProject(id);
  patch({ list: useSync.getState().list.filter((x) => x.id !== id) });
  if (useSync.getState().projectId === id) {
    reset();
    H().replace(null, "Project deleted");
    await clearCache();
  } else {
    // A browser copy of a project that is gone from the server would only be offered again by mistake.
    await del(slotKey(id)).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ rename and copy a saved project

/**
 * Changes a saved project that is not the open one: reads it from the server, applies `change`, and saves it on top of the revision it read.
 * The open project is changed through the store instead, because its unsaved edits live there. A change that returns the project as it was
 * (a name that did not change) is not saved.
 */
export async function editStoredProject(id: string, change: (p: Project) => Project): Promise<void> {
  const r = await api.getProject(id);
  const stored = parseProject(r.project);
  const next = change(stored);
  if (next === stored) return;
  const saved = await api.putProject(id, next, r.revision);
  upsertListEntry({ id, title: next.meta.title, updatedAt: saved.updatedAt, revision: saved.revision, schemaVersion: next.schemaVersion });
}

/**
 * Saves a copy of a project as a new project and returns its id and name. A copy of the open project starts from what is on screen, unsaved
 * changes included. The copy is not opened: the person stays where they are and opens it from the list when they want to.
 */
export async function copyStoredProject(id: string, make: (source: Project) => Project): Promise<{ id: string; title: string }> {
  const open = H().getProject();
  const source = id === useSync.getState().projectId && open ? open : parseProject((await api.getProject(id)).project);
  const copy = make(source);
  const r = await api.createProject(copy);
  upsertListEntry({ id: r.id, title: copy.meta.title, updatedAt: r.updatedAt, revision: r.revision, schemaVersion: copy.schemaVersion });
  return { id: r.id, title: copy.meta.title };
}

/**
 * Saves a ready-made project as a new project on the server and returns its id and name; it is not opened. Used for "Copy this version as a
 * new project": the copy is made from the frozen version, which is not the open project, so copyStoredProject cannot be used.
 */
export async function saveNewProject(copy: Project): Promise<{ id: string; title: string }> {
  const r = await api.createProject(copy);
  upsertListEntry({ id: r.id, title: copy.meta.title, updatedAt: r.updatedAt, revision: r.revision, schemaVersion: copy.schemaVersion });
  return { id: r.id, title: copy.meta.title };
}

// ------------------------------------------------------------------ conflict

/** Takes the server's newer version. `saveBackup` is given the local, unsaved project first (the app downloads it as a JSON file). */
export async function loadNewerVersion(saveBackup: (mine: Project) => void): Promise<void> {
  const mine = H().getProject();
  const id = useSync.getState().projectId;
  if (!mine || !id) return;
  saveBackup(mine);
  const r = await api.getProject(id);
  const project = parseProject(r.project);
  const migrated = wasMigrated(r.project, project);
  clearTimer();
  patch({ revision: r.revision, phase: migrated ? "dirty" : "saved", error: null, conflict: null });
  H().replace(project, "The newer version was loaded");
  await writeCache(project, migrated);
  if (migrated) schedule(0);
}

/** Overwrites the server's newer version with this computer's version. */
export async function keepMine(): Promise<void> {
  const c = useSync.getState().conflict;
  if (!c) return;
  patch({ revision: c.revision, phase: "dirty", conflict: null, error: null });
  await flush();
}

// ------------------------------------------------------------------ start and end

/** Reopens the project this browser had open, using the offline copy and the server. Called once after sign-in. */
export async function restore(): Promise<void> {
  startLifecycle();
  const found = await readCache();
  if (!found) {
    H().replace(null, "");
    return;
  }
  const cache = found.cache;
  // From here this tab writes to the slot it reopened (until the project is saved under another one, or another project is opened).
  setActiveSlot(found.key);
  writeTabPointer(found.key);
  void pruneCache(found.key);
  let local: Project;
  try {
    local = parseProject(cache.project);
  } catch {
    await clearCache();
    H().replace(null, "");
    return;
  }
  reset();
  if (cache.projectId === null) {
    // Never saved to the server, so it is dirty anyway: give it its start version before it is first saved.
    local = await withStartVersion(local);
    patch({ phase: "dirty" });
    H().replace(local, "Unsaved project restored from this browser");
    schedule(0);
    return;
  }
  let remote: Awaited<ReturnType<typeof api.getProject>>;
  try {
    remote = await api.getProject(cache.projectId);
  } catch (e) {
    const err = e as api.ApiError;
    if (err.status === 401) return;
    if (err.status === 404) {
      if (cache.dirty) {
        patch({ phase: "dirty" });
        H().replace(local, "This project was removed from the server; your copy will be saved as a new project");
        schedule(0);
      } else {
        await clearCache();
        H().replace(null, "");
      }
      return;
    }
    patch({ projectId: cache.projectId, revision: cache.revision, phase: "error", error: `${err.message} You are working from this browser's copy; it will be saved when the server answers.` });
    H().replace(local, "Working from this browser's copy");
    schedule(RETRY_MS);
    return;
  }
  if (!cache.dirty) {
    const parsed = parseProject(remote.project);
    const fresh = await withStartVersion(parsed);
    const migrated = wasMigrated(remote.project, parsed) || fresh !== parsed;
    patch({ projectId: remote.id, revision: remote.revision, phase: migrated ? "dirty" : "saved" });
    H().replace(fresh, "");
    await writeCache(fresh, migrated).catch(() => undefined);
    if (migrated) schedule(0);
  } else if (remote.revision === cache.revision) {
    patch({ projectId: remote.id, revision: remote.revision, phase: "dirty" });
    H().replace(local, "Unsaved changes restored from this browser");
    schedule(0);
  } else {
    patch({ projectId: remote.id, revision: cache.revision, phase: "conflict", conflict: { revision: remote.revision, updatedAt: remote.updatedAt } });
    H().replace(local, "");
  }
}

/** Saves when the page is hidden or closed. The offline copy already has every change, so this is a bonus. */
function startLifecycle() {
  if (lifecycleStarted || typeof document === "undefined") return;
  lifecycleStarted = true;
  const save = () => {
    const s = useSync.getState();
    if (s.phase === "dirty" || s.phase === "error") void flush({ keepalive: true });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", save);
}
