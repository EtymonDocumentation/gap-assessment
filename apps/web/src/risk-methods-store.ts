import type { RiskMethodSnapshot } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * The risk method library. Like the company sampling tables it is not part of a project file: a method is a company document (its
 * scales, bands and matrix as the quality system defines them) reused across projects. Static build: this browser's IndexedDB.
 * Server build: the laptop server (module "risk"). An assessment that applies a method keeps a copy of its configuration and the
 * library entry's name and version, so editing the library later never changes an issued assessment silently.
 */

export interface MethodHistoryEntry {
  at: string;
  action: "created" | "edited";
  /** What the method said before this edit (kept, never overwritten). Absent for "created". */
  before?: RiskMethodSnapshot;
}

export interface StoredMethod extends RiskMethodSnapshot {
  createdAt: string;
  updatedAt: string;
  history: MethodHistoryEntry[];
}

const db = createStore("gap-risk-methods", "methods");
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  items: StoredMethod[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Adds a method (new id when the id is empty or taken) or replaces one, keeping the old content in its history. */
  save(method: RiskMethodSnapshot): Promise<StoredMethod>;
  remove(id: string): Promise<void>;
}

const sorted = (items: StoredMethod[]) => [...items].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

export const newMethodId = (): string => globalThis.crypto?.randomUUID?.() ?? `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

export const useRiskMethods = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = onServer() ? ((await api.listRiskMethods()) as StoredMethod[]) : await values<StoredMethod>(db);
      setState({ items: sorted(items), ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The risk methods could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(method) {
    const now = new Date().toISOString();
    const cur = getState().items.find((x) => x.id === method.id);
    const history: MethodHistoryEntry[] = cur ? [...cur.history, { at: now, action: "edited", before: snapshotOf(cur) }] : [{ at: now, action: "created" }];
    const next: StoredMethod = { ...snapshotOf(method), createdAt: cur?.createdAt ?? now, updatedAt: now, history };
    try {
      let saved = next;
      if (onServer()) {
        if (cur) await api.putRiskMethod(next.id, next);
        else saved = { ...next, id: (await api.createRiskMethod(next)).id };
      } else await set(next.id, next, db);
      setState({ items: sorted([...getState().items.filter((x) => x.id !== cur?.id && x.id !== saved.id), saved]), error: null });
      return saved;
    } catch (e) {
      setState({ error: `The method could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteRiskMethod(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The method could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useRiskMethods.setState({ items: [], ready: false, error: null }));
