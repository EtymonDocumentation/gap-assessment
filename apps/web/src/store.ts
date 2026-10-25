import {
  assess,
  buildDemoProject,
  demoSamplingTables,
  demoSubsectionLibrary,
  effectiveContent,
  programStage,
  sourceValidated,
  stagedContent,
  stageWordingFor,
  type Assessment,
  type ContentBundle,
  type StageWording,
} from "@gap/engine";
import { emptyProject, parseProject, type Actor, type Project } from "@gap/process-model";
import { del, get, set } from "idb-keyval";
import { useMemo } from "react";
import { create } from "zustand";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "@gap/content";
import { useSamplingTables } from "./sampling-tables-store";
import { useSubsectionLibrary } from "./subsections-library-store";
import { resetFiles } from "./server/files";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage, useSession } from "./server/session-store";
import * as sync from "./server/sync";

const STORAGE_KEY = "gap-assessment:project";

interface State {
  project: Project | null;
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
  /** Opens a fictional demo project; the id picks the script from content/demo (default: the ARX-217 vial demo). */
  loadDemo(id?: keyof typeof demos): void;
  newProject(title: string, responder: { name: string; role?: string }): void;
  importJson(text: string): string | null;
  clearError(): void;
}

export function actorOf(p: Project): Actor {
  const r = p.interview.responder;
  return { name: r?.name ?? "Unnamed user", ...(r?.role ? { role: r.role } : {}), at: new Date().toISOString() };
}

function persist(p: Project | null): Promise<void> {
  // Server mode with server storage: the server holds the project; this browser keeps an offline copy (see server/sync.ts).
  if (SERVER_MODE && remoteStorage()) return sync.onLocalChange(p);
  return p ? set(STORAGE_KEY, p) : del(STORAGE_KEY);
}

export const useStore = create<State>((setState, getState) => ({
  project: null,
  ready: false,
  error: null,
  status: "",

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
      // An older project was migrated on load (for example "Unknown" became TBD, with change-log records). Save the converted copy so those records
      // keep the time they were written instead of being made again, with a new time, on every start.
      if (project && (raw as { schemaVersion?: unknown }).schemaVersion !== project.schemaVersion) await persist(project).catch(() => undefined);
    } catch (e) {
      setState({ ready: true, error: `The saved project could not be loaded: ${(e as Error).message}` });
    }
  },

  setProject(p, status = "Saved", fresh = false) {
    if (SERVER_MODE && fresh && remoteStorage()) sync.beginNew();
    setState({ project: p, status });
    persist(p).catch((e: Error) => setState({ error: `Browser storage failed: ${e.message}. Export your project as JSON to keep it.` }));
  },

  update(fn, status) {
    const p = getState().project;
    if (!p) return "No project is open";
    try {
      getState().setProject(fn(p, actorOf(p)), status);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  },

  loadDemo(id = "arx-217") {
    const demo = buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
    // The demo carries a TRD. An account without the TRD module could not save it (the server refuses a project holding TRD
    // documents), so the demo opens without it there; the rest of the demo is unchanged.
    const trdOn = !SERVER_MODE || !!useSession.getState().user?.plan.modules.includes("trd");
    const mbrOn = !SERVER_MODE || !!useSession.getState().user?.plan.modules.includes("mbr");
    // The batch record is built from the TRD, so it goes with the TRD; an account without the batch record module gets the demo without it.
    let shown = trdOn ? demo : { ...demo, trd: { documents: [] }, changeLog: demo.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
    if (!trdOn || !mbrOn) shown = { ...shown, mbr: { records: [] }, changeLog: shown.changeLog.filter((e) => !(e.path ?? "").startsWith("mbr.")) };
    getState().setProject(shown, "Demo project loaded", true);
    // The demo plan uses a fictional company table. Offer it in the library too, so the plan does not say its table has gone.
    void useSamplingTables.getState().ensure(demoSamplingTables(demos[id]));
    void useSubsectionLibrary.getState().ensure(demoSubsectionLibrary(demos[id]));
  },

  newProject(title, responder) {
    const at = new Date().toISOString();
    const p = emptyProject({ title, actor: { name: responder.name, at }, contentRefs: content.versions });
    p.interview.responder = responder;
    getState().setProject(p, "New project created", true);
  },

  importJson(text) {
    try {
      const p = parseProject(JSON.parse(text));
      getState().setProject(p, "Project imported", true);
      return null;
    } catch (e) {
      return e instanceof SyntaxError ? "The file is not valid JSON." : (e as Error).message;
    }
  },

  clearError() {
    setState({ error: null });
  },
}));

if (SERVER_MODE) {
  sync.connect({
    getProject: () => useStore.getState().project,
    replace: (project, status) => useStore.setState({ project, ...(status ? { status } : {}) }),
    fail: (error) => useStore.setState({ error }),
  });
  // Signed out (or the session ended): nothing of the account stays in memory. The browser's offline copy is kept.
  afterSessionEnds(() => {
    useStore.setState({ project: null, ready: false, error: null, status: "" });
    resetFiles();
  });
}

/** The content bundle with the project's custom unit operations and items added. Use this everywhere instead of the base `content`. */
export function useContent(): ContentBundle {
  const custom = useStore((s) => s.project?.custom);
  const validated = useStore((s) => (s.project ? sourceValidated(s.project) : false));
  const project = useStore.getState().project;
  // The bundle is staged for the source program stage, so every text and label in the app uses the right wording.
  return useMemo(() => stagedContent(project ? effectiveContent(content, project) : content, validated), [custom, validated]); // eslint-disable-line react-hooks/exhaustive-deps
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
