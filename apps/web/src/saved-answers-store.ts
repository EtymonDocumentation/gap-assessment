import { parseSavedAnswerSet, type SavedAnswerSet } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * Saved answer sets. Like the risk methods and company sampling tables they are not part of a project file: they are the author's own
 * answers, kept to offer to another project. Static build: this browser's IndexedDB. Server build: the author's account on the
 * server. Either way the author can also export a set as a file and import one (to move sets between browsers or people).
 */

const db = createStore("gap-saved-answers", "sets");
const onServer = () => SERVER_MODE && remoteStorage();

export const newSetId = (): string => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface State {
  items: SavedAnswerSet[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Adds a set (a new id when the id is empty or taken) or replaces the one with that id. */
  save(set: SavedAnswerSet): Promise<SavedAnswerSet>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Reads a file's text. Returns the saved set, or a plain-language reason it was refused. */
  importText(text: string): Promise<{ set: SavedAnswerSet } | { error: string }>;
}

/** Newest first: the set the author just saved is the one they most likely want. */
const sorted = (items: SavedAnswerSet[]) => [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name));

export const useSavedAnswers = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const raw = onServer() ? await api.listSavedAnswers() : await values<unknown>(db);
      // A stored set that no longer reads (damaged, or from a newer tool) is left out of the list rather than breaking the page.
      const items = raw.flatMap((r) => {
        const p = parseSavedAnswerSet(r);
        return p.ok && p.set.id ? [p.set as SavedAnswerSet] : [];
      });
      setState({ items: sorted(items), ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The saved answers could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(next) {
    const cur = getState().items.find((x) => x.id === next.id);
    try {
      let saved = next;
      if (onServer()) {
        if (cur) await api.putSavedAnswers(next.id, next);
        else saved = { ...next, id: (await api.createSavedAnswers(next)).id };
      } else await set(next.id, next, db);
      setState({ items: sorted([...getState().items.filter((x) => x.id !== cur?.id && x.id !== saved.id), saved]), error: null });
      return saved;
    } catch (e) {
      setState({ error: `The set could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}` });
      throw e;
    }
  },

  async rename(id, name) {
    const cur = getState().items.find((x) => x.id === id);
    if (!cur) return;
    await getState().save({ ...cur, name: name.trim() });
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteSavedAnswers(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The set could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },

  async importText(text) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { error: "This file is not a saved answer set. It could not be read as a tool file." };
    }
    const p = parseSavedAnswerSet(raw);
    if (!p.ok) return { error: p.message };
    // A new id every time: importing a file twice (or a file from another browser) must never overwrite a set already here.
    const saved = await getState().save({ ...p.set, id: newSetId() });
    return { set: saved };
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useSavedAnswers.setState({ items: [], ready: false, error: null }));
