import type { SubsectionLibraryItem } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage, useSession } from "./server/session-store";

/**
 * The Plan subsections library: reusable text blocks (a sample-handling paragraph, a deviation note) that a plan can copy in.
 * Like the sampling tables library it is not part of a project file. Static build: this browser's IndexedDB. Server build: the
 * laptop server (module "sampling"). A plan that copies an item keeps its own text and the item's version, so editing the library
 * later never changes an issued plan silently; the plan shows a note when the library item has moved on.
 */

export interface LibraryHistoryEntry {
  at: string;
  action: "created" | "edited";
  /** What the item said before this edit (kept, never overwritten). Absent for "created". */
  before?: SubsectionLibraryItem;
}

export interface StoredSubsection extends SubsectionLibraryItem {
  createdAt: string;
  updatedAt: string;
  history: LibraryHistoryEntry[];
}

const db = createStore("gap-plan-subsections", "items");
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  items: StoredSubsection[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Adds an item (new id when the id is empty or taken) or replaces one, keeping the old content in its history. */
  save(item: SubsectionLibraryItem): Promise<StoredSubsection>;
  remove(id: string): Promise<void>;
  /** Adds the given items that are not in the library yet (the demo does this). Never overwrites, never raises an error to the page. */
  ensure(items: SubsectionLibraryItem[]): Promise<void>;
}

const sorted = (items: StoredSubsection[]) => [...items].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

export const newLibraryId = (): string => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** An item without the library's bookkeeping, the form a plan copies from. */
export function itemOf(t: SubsectionLibraryItem): SubsectionLibraryItem {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    ...(t.owner ? { owner: t.owner } : {}),
    blocks: structuredClone(t.blocks),
    ...(t.suggestedPlacement ? { suggestedPlacement: t.suggestedPlacement } : {}),
    ...(t.note ? { note: t.note } : {}),
  };
}

export const useSubsectionLibrary = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = onServer() ? ((await api.listSubsections()) as StoredSubsection[]) : await values<StoredSubsection>(db);
      setState({ items: sorted(items), ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The subsection library could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(item) {
    const now = new Date().toISOString();
    const cur = getState().items.find((x) => x.id === item.id);
    const history: LibraryHistoryEntry[] = cur ? [...cur.history, { at: now, action: "edited", before: itemOf(cur) }] : [{ at: now, action: "created" }];
    const next: StoredSubsection = { ...itemOf(item), createdAt: cur?.createdAt ?? now, updatedAt: now, history };
    try {
      let saved = next;
      if (onServer()) {
        if (cur) await api.putSubsection(next.id, next);
        else saved = { ...next, id: (await api.createSubsection(next)).id };
      } else await set(next.id, next, db);
      setState({ items: sorted([...getState().items.filter((x) => x.id !== cur?.id && x.id !== saved.id), saved]), error: null });
      return saved;
    } catch (e) {
      setState({ error: `The subsection could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}.` });
      throw e;
    }
  },

  async ensure(items) {
    if (SERVER_MODE && !(remoteStorage() && useSession.getState().user?.plan.modules.includes("sampling"))) return;
    try {
      await getState().load();
      for (const t of items) if (!getState().items.some((x) => x.id === t.id)) await getState().save(t);
    } catch {
      /* the library stays as it was; the Plan subsections page shows any storage problem */
    }
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteSubsection(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The subsection could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useSubsectionLibrary.setState({ items: [], ready: false, error: null }));
