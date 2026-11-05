import {
  assess,
  changeProjectStage,
  demoSamplingTables,
  demoSubsectionLibrary,
  demoTitle,
  effectiveContent,
  ensureStartVersion,
  importedTitle,
  programStage,
  projectStage,
  readVersion,
  removeVersion,
  renameProject,
  saveVersion,
  sourceValidated,
  stagedContent,
  stageShort,
  stageWordingFor,
  versionById,
  type Assessment,
  type ContentBundle,
  type ProgramStage,
  type StageChangeResult,
  type StageWording,
} from "@gap/engine";
import { emptyProject, parseProject, type Actor, type Project, type VersionEntry } from "@gap/process-model";
import { del, get, set } from "idb-keyval";
import { useMemo } from "react";
import { create } from "zustand";
import { content, demos } from "@gap/content";
import { DEMO_NAMES, type DemoId } from "./demo-build";
import { buildDemoAway, nextPaint } from "./demo-run";
import { useSamplingTables } from "./sampling-tables-store";
import { useSubsectionLibrary } from "./subsections-library-store";
import { resetFiles } from "./server/files";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage, useSession } from "./server/session-store";
import * as sync from "./server/sync";

const STORAGE_KEY = "gap-assessment:project";

/** True from the click on a demo button until that demo is open (see openDemo). */
let demoInFlight = false;

/** What an import did: the name it ended up with, and the name in the file (they differ when the file's name was already listed). */
export type ImportResult = { error: string } | { error: null; title: string; fileTitle: string };

/** A saved version that is open for looking at (read-only). The frozen project itself is `State.project` while this is set. */
export interface Viewing {
  entryId: string;
  label: string;
  kind: VersionEntry["kind"];
  at: string;
  by: string;
  stage?: string;
  fromStage?: string;
}

/** What every refused write says while a saved version is open. */
export const READ_ONLY_MESSAGE = "This is a saved version and cannot be changed. Go back to the working copy to make changes.";

interface State {
  /**
   * The project the pages show. While a saved version is open (`viewing`) this is the frozen copy, so every page renders it unchanged and
   * nothing can be edited; the real project waits in `working`. Autosave and the server sync read the real one (see realProject).
   */
  project: Project | null;
  working: Project | null;
  viewing: Viewing | null;
  ready: boolean;
  /** Last persistence or validation problem, shown to the user. */
  error: string | null;
  /** Polite status message for screen readers ("Saved", "Imported"). */
  status: string;
  /** Name and role last typed in a revision or comment dialog. Kept for this session only; used to prefill the next dialog. */
  init(): Promise<void>;
  /**
   * Replaces the project (or clears it) and persists. In server mode with server storage, `fresh` marks a different
   * project (new, demo, import) rather than an edit of the open one; it is saved as a new project on the server.
   */
  setProject(p: Project | null, status?: string, fresh?: boolean): void;
  /** Applies an engine function. Returns an error message instead of throwing. */
  update(fn: (p: Project, actor: Actor) => Project, status?: string): string | null;
  /**
   * Changes the project stage with its reason, major version and stage review (changeProjectStage). Async because a version is compressed.
   * The result is applied in ONE setProject so autosave sees one change. If the project changed while the version was being made, the work
   * is redone on the newer project instead of saving over it.
   */
  changeStage(to: ProgramStage, reason: string): Promise<{ error: string } | { error: null; result: StageChangeResult }>;
  /** "Save a version": a minor version of the project as it is, with an optional note. */
  saveVersionNow(note: string): Promise<{ error: string } | { error: null; label: string }>;
  /** Removes a saved version (any), with the reason; written to the change log. Returns an error message, or null. */
  removeVersionNow(entryId: string, reason: string): string | null;
  /** Opens a saved version read-only. Returns an error message, or null. */
  openVersion(entryId: string): Promise<string | null>;
  /** Leaves the read-only version and shows the working copy again. */
  closeVersion(): void;
  /** Name of the demo being built, or null. The Home page shows "Building the demo" from it and keeps every demo button off until it is open. */
  demoBuilding: string | null;
  /** The line Home shows once a demo is open ("Demo opened: <name>"). The app clears it when the user leaves Home. */
  homeFlash: string;
  /**
   * What the last Copy, Rename or Import in My projects said, and (for a copy or an import) the server id of the project it made, so the list can mark
   * that row. The app clears it when the user leaves Home.
   */
  listNote: { text: string; newId?: string } | null;
  /**
   * Opens a fictional demo project; the id picks the script from content/demo. The build takes seconds, so it runs off the page (demo-run.ts) after
   * the "Building the demo" line has painted. A second call while one demo is being built is ignored, so a double click makes ONE project.
   * `listedTitles` are the names already in My projects: a demo opened again is numbered "(2)" so the list never shows two rows with one name.
   * Resolves true once the demo is open.
   */
  openDemo(id: DemoId, listedTitles?: readonly string[]): Promise<boolean>;
  newProject(title: string, responder: { name: string; role?: string }): void;
  /**
   * Opens a project from an exported JSON file as a new project. `listedTitles` are the names already in My projects: when one is the file's name,
   * the project is called "<name> (imported)" (the change log says so), so the list never shows two projects with one name.
   */
  importJson(text: string, listedTitles?: readonly string[]): ImportResult;
  clearError(): void;
}

export function actorOf(p: Project): Actor {
  const r = p.interview.responder;
  return { name: r?.name ?? "Unnamed user", ...(r?.role ? { role: r.role } : {}), at: new Date().toISOString() };
}

/**
 * Makes the START version (v1) of the open project when its version history is empty: the project as it was when history began. The
 * schema migration that adds the history cannot do it (it must be synchronous and a version is compressed), so every way a project
 * arrives here ends with this call: first open, a new project, a demo, an import. The page is never held up: the project is shown first
 * and the version follows a moment later. If the person edited in between, the version is made from the newer state instead, so no edit
 * is lost and none is saved over.
 */
async function addStartVersion(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = useStore.getState().project;
    if (!p || useStore.getState().viewing) return;
    let next: Project;
    try {
      next = await ensureStartVersion(p, actorOf(p));
    } catch {
      return; // a browser that cannot compress: the project works without it and the version is made on a later open
    }
    if (useStore.getState().project !== p) continue;
    if (next !== p) useStore.getState().setProject(next, useStore.getState().status);
    return;
  }
}

/** The real project: the working copy while a saved version is open, otherwise the project shown. Autosave and the sync read this one. */
export function realProject(s: Pick<State, "project" | "working">): Project | null {
  return s.working ?? s.project;
}

function persist(p: Project | null): Promise<void> {
  // Server mode with server storage: the server holds the project; this browser keeps an offline copy (see server/sync.ts).
  if (SERVER_MODE && remoteStorage()) return sync.onLocalChange(p);
  return p ? set(STORAGE_KEY, p) : del(STORAGE_KEY);
}

export const useStore = create<State>((setState, getState) => ({
  project: null,
  working: null,
  viewing: null,
  ready: false,
  error: null,
  status: "",
  demoBuilding: null,
  homeFlash: "",
  listNote: null,

  async init() {
    if (SERVER_MODE && remoteStorage()) {
      try {
        await sync.restore();
        setState({ ready: true });
      } catch (e) {
        setState({ ready: true, error: `The open project could not be loaded: ${(e as Error).message}` });
      }
      return;
    }
    try {
      const raw = await get(STORAGE_KEY);
      const project = raw ? parseProject(raw) : null;
      setState({ project, ready: true });
      await addStartVersion();
      // An older project was migrated on load (for example "Unknown" became TBD, with change-log records). Save the converted copy so those records
      // keep the time they were written instead of being made again, with a new time, on every start.
      if (project && (raw as { schemaVersion?: unknown }).schemaVersion !== project.schemaVersion) await persist(useStore.getState().project ?? project).catch(() => undefined);
    } catch (e) {
      setState({ ready: true, error: `The saved project could not be loaded: ${(e as Error).message}` });
    }
  },

  setProject(p, status = "Saved", fresh = false) {
    if (getState().viewing) {
      // A saved version cannot be changed. Replacing the whole project (a new one, a demo, an import, closing or deleting it) is a different
      // thing from editing: it leaves the version first. Anything else is refused and said so.
      if (!fresh && p !== null) {
        setState({ error: READ_ONLY_MESSAGE });
        return;
      }
      setState({ working: null, viewing: null });
    }
    if (SERVER_MODE && fresh && remoteStorage()) sync.beginNew();
    setState({ project: p, status });
    persist(p).catch((e: Error) => setState({ error: `Browser storage failed: ${e.message}. Export your project as JSON to keep it.` }));
  },

  update(fn, status) {
    if (getState().viewing) return READ_ONLY_MESSAGE;
    const p = getState().project;
    if (!p) return "No project is open";
    try {
      getState().setProject(fn(p, actorOf(p)), status);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  },

  async changeStage(to, reason) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = getState().project;
      if (getState().viewing) return { error: READ_ONLY_MESSAGE };
      if (!p) return { error: "No project is open" };
      let result: StageChangeResult;
      try {
        result = await changeProjectStage(p, effectiveContent(content, p), to, actorOf(p), reason);
      } catch (e) {
        return { error: (e as Error).message };
      }
      // Edits made while the version was being compressed would be lost by saving over them: do it again on the newer project.
      if (getState().project !== p || getState().viewing) continue;
      if (result.project !== p) getState().setProject(result.project, `Project stage: ${stageShort(to)}`);
      return { error: null, result };
    }
    return { error: "The project changed while the version was being saved. Please try again." };
  },

  async saveVersionNow(note) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = getState().project;
      if (getState().viewing) return { error: READ_ONLY_MESSAGE };
      if (!p) return { error: "No project is open" };
      let saved: Awaited<ReturnType<typeof saveVersion>>;
      try {
        saved = await saveVersion(p, actorOf(p), note);
      } catch (e) {
        return { error: (e as Error).message };
      }
      if (getState().project !== p || getState().viewing) continue;
      getState().setProject(saved.project, `Version ${saved.entry.label} saved`);
      return { error: null, label: saved.entry.label };
    }
    return { error: "The project changed while the version was being saved. Please try again." };
  },

  removeVersionNow(entryId, reason) {
    return getState().update((p, actor) => removeVersion(p, entryId, actor, reason), "Version removed");
  },

  async openVersion(entryId) {
    const real = realProject(getState());
    const entry = real ? versionById(real, entryId) : undefined;
    if (!real || !entry) return "That version is not in the history.";
    let frozen: Project;
    try {
      frozen = await readVersion(entry);
    } catch (e) {
      return `${entry.label} could not be opened: ${(e as Error).message}`;
    }
    const now = realProject(getState());
    if (!now) return "No project is open";
    setState({
      working: now,
      project: frozen,
      viewing: { entryId, label: entry.label, kind: entry.kind, at: entry.at, by: entry.by, ...(entry.stage ? { stage: entry.stage } : {}), ...(entry.fromStage ? { fromStage: entry.fromStage } : {}) },
      status: `${entry.label} is open to look at. Nothing can be changed here.`,
    });
    return null;
  },

  closeVersion() {
    const { working } = getState();
    if (!working) return;
    setState({ project: working, working: null, viewing: null, status: "Back to the working copy" });
  },

  async openDemo(id, listedTitles = []) {
    // The guard is a plain variable set before the first await: two clicks in the same frame both run this function before React has
    // re-rendered the buttons as disabled, and the second must find the first already in flight.
    if (demoInFlight) return false;
    demoInFlight = true;
    const name = DEMO_NAMES[id];
    setState({ demoBuilding: name, homeFlash: "" });
    try {
      await nextPaint();
      const demo = await buildDemoAway(id);
      // The demo carries a TRD. An account without the TRD module could not save it (the server refuses a project holding TRD
      // documents), so the demo opens without it there; the rest of the demo is unchanged.
      const trdOn = !SERVER_MODE || !!useSession.getState().user?.plan.modules.includes("trd");
      const mbrOn = !SERVER_MODE || !!useSession.getState().user?.plan.modules.includes("mbr");
      // The batch record is built from the TRD, so it goes with the TRD; an account without the batch record module gets the demo without it.
      let shown = trdOn ? demo : { ...demo, trd: { documents: [] }, changeLog: demo.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
      if (!trdOn || !mbrOn) shown = { ...shown, mbr: { records: [] }, changeLog: shown.changeLog.filter((e) => !(e.path ?? "").startsWith("mbr.")) };
      const title = demoTitle(shown.meta.title, listedTitles);
      if (title !== shown.meta.title) shown = renameProject(shown, title, actorOf(shown), { detail: "Renamed on opening: a project with this name was already listed" });
      getState().setProject(shown, `Demo opened: ${name}`, true);
      setState({ homeFlash: `Demo opened: ${name}` });
      await addStartVersion();
      // The demo plan uses a fictional company table. Offer it in the library too, so the plan does not say its table has gone.
      void useSamplingTables.getState().ensure(demoSamplingTables(demos[id]));
      void useSubsectionLibrary.getState().ensure(demoSubsectionLibrary(demos[id]));
      return true;
    } catch (e) {
      setState({ error: `The demo could not be built: ${(e as Error).message}` });
      return false;
    } finally {
      demoInFlight = false;
      setState({ demoBuilding: null });
    }
  },

  newProject(title, responder) {
    const at = new Date().toISOString();
    const p = emptyProject({ title, actor: { name: responder.name, at }, contentRefs: content.versions });
    p.interview.responder = responder;
    getState().setProject(p, "New project created", true);
    void addStartVersion();
  },

  importJson(text, listedTitles = []) {
    try {
      const parsed = parseProject(JSON.parse(text));
      const fileTitle = parsed.meta.title;
      const title = importedTitle(fileTitle, listedTitles);
      const p = title === fileTitle ? parsed : renameProject(parsed, title, actorOf(parsed), { detail: "Renamed on import: a project with this name was already listed" });
      getState().setProject(p, `Imported: ${fileTitle}`, true);
      void addStartVersion();
      return { error: null, title, fileTitle };
    } catch (e) {
      return { error: e instanceof SyntaxError ? "The file is not valid JSON." : (e as Error).message };
    }
  },

  clearError() {
    setState({ error: null });
  },
}));

if (SERVER_MODE) {
  sync.connect({
    // Autosave must never write the frozen copy of a saved version over the real project.
    getProject: () => realProject(useStore.getState()),
    replace: (project, status) => useStore.setState({ project, working: null, viewing: null, ...(status ? { status } : {}) }),
    fail: (error) => useStore.setState({ error }),
  });
  // Signed out (or the session ended): nothing of the account stays in memory. The browser's offline copy is kept.
  afterSessionEnds(() => {
    useStore.setState({ project: null, working: null, viewing: null, ready: false, error: null, status: "" });
    resetFiles();
  });
}

/** The content bundle with the project's custom unit operations and items added. Use this everywhere instead of the base `content`. */
export function useContent(): ContentBundle {
  const custom = useStore((s) => s.project?.custom);
  const validated = useStore((s) => (s.project ? sourceValidated(s.project) : false));
  const stage = useStore((s) => (s.project ? projectStage(s.project) : undefined));
  const project = useStore.getState().project;
  // The bundle is staged for the sending site's state (validated or not) and the project stage, so every text and label in the app uses the right wording.
  return useMemo(() => stagedContent(project ? effectiveContent(content, project) : content, validated, stage), [custom, validated, stage]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The stage-aware wording of the open project: both stage labels, the source column header and the category labels. */
export function useStageWording(): StageWording {
  const source = useStore((s) => (s.project ? programStage(s.project, "source") : undefined));
  const target = useStore((s) => (s.project ? programStage(s.project, "target") : undefined));
  return useMemo(() => stageWordingFor(source, target), [source, target]);
}

/** Recomputed gap assessment for the open project (memoized on project identity). */
export function useAssessment(): Assessment | null {
  const project = useStore((s) => s.project);
  const eff = useContent();
  return useMemo(() => (project ? assess(eff, project) : null), [project, eff]);
}

export { content };
