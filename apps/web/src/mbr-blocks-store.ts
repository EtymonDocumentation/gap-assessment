import { mbrLibrary } from "@gap/content";
import { effectiveLibrary } from "@gap/engine";
import type { MbrLibraryBlock } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { useMemo } from "react";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * The batch-record step blocks the user has edited or added. The shipped blocks (content/mbr/blocks.yaml) are never changed: an edit
 * of a shipped block is stored here as the user's copy of the same id, one version higher, and wins in the list the site offers.
 * Like the other libraries it is not part of a project: static build = this browser's IndexedDB, server build = the server (module "mbr").
 * A batch record keeps its own copy of a block and the version it was made from, so editing here never changes an issued record.
 */

const db = createStore("gap-mbr-blocks", "blocks");
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  items: MbrLibraryBlock[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  save(block: MbrLibraryBlock): Promise<void>;
  /** Removes the user's copy. For a shipped block id this brings the shipped version back. */
  remove(id: string): Promise<void>;
}

export const useMbrBlocks = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = onServer() ? ((await api.listMbrBlocks()) as MbrLibraryBlock[]) : await values<MbrLibraryBlock>(db);
      setState({ items, ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The step blocks could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(block) {
    try {
      if (onServer()) await api.putMbrBlock(block.id, block);
      else await set(block.id, block, db);
      setState({ items: [...getState().items.filter((x) => x.id !== block.id), block], error: null });
    } catch (e) {
      setState({ error: `The block could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteMbrBlock(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The block could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useMbrBlocks.setState({ items: [], ready: false, error: null }));

/** The shipped blocks with the user's edits and additions on top: the list every picker on the site uses. */
export function useMbrLibrary(): MbrLibraryBlock[] {
  const items = useMbrBlocks((s) => s.items);
  return useMemo(() => effectiveLibrary(mbrLibrary, items), [items]);
}
