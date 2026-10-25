import { trdWriteups } from "@gap/content";
import { effectiveWriteupLibrary } from "@gap/engine";
import type { TrdLibraryWriteup } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * The TRD process-description write-ups the user has edited or added. The shipped ones (content/trd-writeups/writeups.yaml) are never
 * changed: an edit of a shipped write-up is stored here as the user's copy of the same id, one version higher, and wins in the list
 * the site offers. Like the other libraries it is not part of a project: static build = this browser's IndexedDB, server build = the
 * server (module "trd"). A TRD keeps its own copy of a write-up and the version it was made from, so editing here never changes a
 * TRD that is already written.
 */

const db = createStore("gap-trd-writeups", "writeups");
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  items: TrdLibraryWriteup[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  save(item: TrdLibraryWriteup): Promise<void>;
  /** Removes the user's copy. For a shipped write-up id this brings the shipped version back. */
  remove(id: string): Promise<void>;
}

export const useTrdWriteups = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = onServer() ? ((await api.listTrdWriteups()) as TrdLibraryWriteup[]) : await values<TrdLibraryWriteup>(db);
      setState({ items, ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The write-ups could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(item) {
    try {
      if (onServer()) await api.putTrdWriteup(item.id, item);
      else await set(item.id, item, db);
      setState({ items: [...getState().items.filter((x) => x.id !== item.id), item], error: null });
    } catch (e) {
      setState({ error: `The write-up could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteTrdWriteup(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The write-up could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useTrdWriteups.setState({ items: [], ready: false, error: null }));

/** The shipped write-ups with the user's edits and additions on top: the list every picker on the site uses. */
export function useTrdWriteupLibrary(): TrdLibraryWriteup[] {
  const items = useTrdWriteups((s) => s.items);
  const load = useTrdWriteups((s) => s.load);
  // Whoever shows the list also reads the user's copies, so an edited write-up is never replaced by the shipped one by mistake.
  useEffect(() => void load(), [load]);
  return useMemo(() => effectiveWriteupLibrary(trdWriteups, items), [items]);
}
