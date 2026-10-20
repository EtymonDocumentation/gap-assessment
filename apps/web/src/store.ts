import { assess, buildDemoProject, effectiveContent, type Assessment, type ContentBundle } from "@gap/engine";
import { emptyProject, parseProject, type Actor, type Project } from "@gap/process-model";
import { del, get, set } from "idb-keyval";
import { useMemo } from "react";
import { create } from "zustand";
import { content, demos } from "@gap/content";

const STORAGE_KEY = "gap-assessment:project";

interface State {
  project: Project | null;
  ready: boolean;
  /** Last persistence or validation problem, shown to the user. */
  error: string | null;
  /** Polite status message for screen readers ("Saved", "Imported"). */
  status: string;
  init(): Promise<void>;
  /** Replaces the project (or clears it) and persists. */
  setProject(p: Project | null, status?: string): void;
  /** Applies an engine function. Returns an error message instead of throwing. */
  update(fn: (p: Project, actor: Actor) => Project, status?: string): string | null;
  loadDemo(): void;
  newProject(title: string, responder: { name: string; role?: string }): void;
  importJson(text: string): string | null;
  clearError(): void;
}

export function actorOf(p: Project): Actor {
  const r = p.interview.responder;
  return { name: r?.name ?? "Unnamed user", ...(r?.role ? { role: r.role } : {}), at: new Date().toISOString() };
}

function persist(p: Project | null): Promise<void> {
  return p ? set(STORAGE_KEY, p) : del(STORAGE_KEY);
}

export const useStore = create<State>((setState, getState) => ({
  project: null,
  ready: false,
  error: null,
  status: "",

  async init() {
    try {
      const raw = await get(STORAGE_KEY);
      setState({ project: raw ? parseProject(raw) : null, ready: true });
    } catch (e) {
      setState({ ready: true, error: `The saved project could not be loaded: ${(e as Error).message}` });
    }
  },

  setProject(p, status = "Saved") {
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

  loadDemo() {
    getState().setProject(buildDemoProject(content, demos["arx-217"]), "Demo project loaded");
  },

  newProject(title, responder) {
    const at = new Date().toISOString();
    const p = emptyProject({ title, actor: { name: responder.name, at }, contentRefs: content.versions });
    p.interview.responder = responder;
    getState().setProject(p, "New project created");
  },

  importJson(text) {
    try {
      const p = parseProject(JSON.parse(text));
      getState().setProject(p, "Project imported");
      return null;
    } catch (e) {
      return e instanceof SyntaxError ? "The file is not valid JSON." : (e as Error).message;
    }
  },

  clearError() {
    setState({ error: null });
  },
}));

/** The content bundle with the project's custom unit operations and items added. Use this everywhere instead of the base `content`. */
export function useContent(): ContentBundle {
  const custom = useStore((s) => s.project?.custom);
  const project = useStore.getState().project;
  return useMemo(() => (project ? effectiveContent(content, project) : content), [custom]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Recomputed gap assessment for the open project (memoized on project identity). */
export function useAssessment(): Assessment | null {
  const project = useStore((s) => s.project);
  const eff = useContent();
  return useMemo(() => (project ? assess(eff, project) : null), [project, eff]);
}

export { content };
