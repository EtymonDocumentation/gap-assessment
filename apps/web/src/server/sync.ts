import { parseProject, type Project } from "@gap/process-model";
import { del, get, set } from "idb-keyval";
import { create } from "zustand";
import * as api from "./api";
import type { ProjectSummary } from "./api";
import { afterSessionEnds, beforeSessionEnds, currentUserId } from "./session-store";

/**
 * Keeps the open project in step with the server: autosave with a revision number, conflict detection, the list of
 * the user's projects, and an offline copy in this browser's IndexedDB (a cache of the open project only).
 * Used only in server mode with `storage: "server"`.
 */

const CACHE_KEY = "gap-assessment:server-cache";
const DEBOUNCE_MS = 1000;
const RETRY_MS = 5000;

interface Cache {
  projectId: string | null;
  /** The server revision this copy was based on. */
  revision: number;
  /** True when this copy has changes the server does not have. */
  dirty: boolean;
  project: Project;
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

const cacheKey = () => `${CACHE_KEY}:${currentUserId() ?? "none"}`;

async function writeCache(project: Project, dirty: boolean): Promise<void> {
  const s = useSync.getState();
  const c: Cache = { projectId: s.projectId, revision: s.revision, dirty, project };
  await set(cacheKey(), c);
}
async function clearCache(): Promise<void> {
  await del(cacheKey()).catch(() => undefined);
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

async function settle(): Promise<void> {
  await flush();
  const s = useSync.getState();
  if (s.phase === "conflict") throw new Error("This project was changed on another computer. Choose which version to keep first.");
  if (s.phase === "error") throw new Error(`The open project could not be saved yet, so it cannot be closed. ${s.error ?? ""} Download it from the Project page if you need a copy.`.trim());
}

export async function openProject(id: string): Promise<void> {
  if (H().getProject()) await settle();
  const r = await api.getProject(id);
  const project = parseProject(r.project);
  reset();
  patch({ projectId: r.id, revision: r.revision, phase: "saved" });
  H().replace(project, "Project opened");
  await writeCache(project, false);
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
  }
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
  clearTimer();
  patch({ revision: r.revision, phase: "saved", error: null, conflict: null });
  H().replace(project, "The newer version was loaded");
  await writeCache(project, false);
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
  let cache: Cache | undefined;
  try {
    cache = await get<Cache>(cacheKey());
  } catch {
    cache = undefined;
  }
  if (!cache) {
    H().replace(null, "");
    return;
  }
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
    patch({ projectId: remote.id, revision: remote.revision, phase: "saved" });
    H().replace(parseProject(remote.project), "");
    await writeCache(parseProject(remote.project), false).catch(() => undefined);
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
