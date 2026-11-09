import { excipientLibraryRecordSchema, type ExcipientLibraryRecord } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { useEffect } from "react";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * The account's saved excipients (the excipient library). Like the other libraries it is not part of a project: static build = this
 * browser's IndexedDB, server build = the server (module "excipient"). A project keeps its own copy of everything it takes from here, so
 * editing or removing a saved excipient never changes a project.
 *
 * Removing one needs a reason. On the server the reason goes to the audit log; in the browser it is kept in a small list of removals in
 * the same browser, so a removal never leaves without a trace.
 */

const db = createStore("gap-excipient-library", "records");
const logDb = createStore("gap-excipient-library-log", "removed");
const onServer = () => SERVER_MODE && remoteStorage();

export interface RemovedRecord {
  id: string;
  name: string;
  version: number;
  reason: string;
  at: string;
}

interface State {
  items: ExcipientLibraryRecord[];
  removed: RemovedRecord[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  save(item: ExcipientLibraryRecord): Promise<void>;
  /** Removes the record; the reason is kept. */
  remove(item: ExcipientLibraryRecord, reason: string): Promise<void>;
}

const byName = (a: ExcipientLibraryRecord, b: ExcipientLibraryRecord) => a.name.localeCompare(b.name);

export const useExcipientLibrary = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  removed: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const raw = onServer() ? await api.listExcipientLibrary() : await values<unknown>(db);
      // A record that does not read back (an older or damaged copy) is left out of the list rather than stopping the page.
      const items = raw.flatMap((r) => {
        const ok = excipientLibraryRecordSchema.safeParse(r);
        return ok.success ? [ok.data] : [];
      });
      const removed = onServer() ? [] : (await values<RemovedRecord>(logDb)).sort((a, b) => b.at.localeCompare(a.at));
      setState({ items: items.sort(byName), removed, ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The saved excipients could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(item) {
    try {
      if (onServer()) await api.putExcipientRecord(item.id, item);
      else await set(item.id, item, db);
      setState({ items: [...getState().items.filter((x) => x.id !== item.id), item].sort(byName), error: null });
    } catch (e) {
      setState({ error: `The saved excipient could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(item, reason) {
    try {
      if (onServer()) await api.deleteExcipientRecord(item.id, reason);
      else {
        const entry: RemovedRecord = { id: item.id, name: item.name, version: item.version, reason, at: new Date().toISOString() };
        await set(`${entry.at}|${item.id}`, entry, logDb);
        await del(item.id, db);
        setState({ removed: [entry, ...getState().removed] });
      }
      setState({ items: getState().items.filter((x) => x.id !== item.id), error: null });
    } catch (e) {
      setState({ error: `The saved excipient could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useExcipientLibrary.setState({ items: [], removed: [], ready: false, error: null }));

/** The saved excipients, loaded when a page first asks. */
export function useExcipientRecords(): { items: ExcipientLibraryRecord[]; ready: boolean } {
  const items = useExcipientLibrary((s) => s.items);
  const ready = useExcipientLibrary((s) => s.ready);
  const load = useExcipientLibrary((s) => s.load);
  useEffect(() => void load(), [load]);
  return { items, ready };
}

