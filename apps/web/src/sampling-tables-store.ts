import type { CompanyTableSnapshot } from "@gap/process-model";
import { validateCompanyTable } from "@gap/sampling";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage, useSession } from "./server/session-store";

/**
 * The company sampling tables library. Like the template library it is not part of a project file: a table is a company document
 * reused across projects. Static build: this browser's IndexedDB. Server build: the laptop server (module "sampling").
 * A point that uses a table keeps a copy of the whole table, so editing the library later never changes an issued plan silently.
 */

export interface TableHistoryEntry {
  at: string;
  action: "created" | "edited" | "imported";
  /** What the table said before this edit (kept, never overwritten). Absent for "created". */
  before?: CompanyTableSnapshot;
}

export interface StoredTable extends CompanyTableSnapshot {
  createdAt: string;
  updatedAt: string;
  history: TableHistoryEntry[];
}

const db = createStore("gap-sampling-tables", "tables");
const onServer = () => SERVER_MODE && remoteStorage();

interface State {
  items: StoredTable[];
  ready: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Adds a table (new id when the id is empty or taken) or replaces one, keeping the old content in its history. */
  save(table: CompanyTableSnapshot, action?: "created" | "edited" | "imported"): Promise<StoredTable>;
  remove(id: string): Promise<void>;
  /** Adds the given tables that are not in the library yet (the demo does this). Never overwrites, never raises an error to the page. */
  ensure(tables: CompanyTableSnapshot[]): Promise<void>;
}

const sorted = (items: StoredTable[]) => [...items].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

export const newTableId = (): string => globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A table without the library's bookkeeping, the form a point stores. */
export function snapshotOf(t: CompanyTableSnapshot): CompanyTableSnapshot {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    ...(t.documentRef ? { documentRef: t.documentRef } : {}),
    ...(t.owner ? { owner: t.owner } : {}),
    rows: t.rows.map((r) => ({ ...r })),
    ...(t.note ? { note: t.note } : {}),
  };
}

/** A table can be picked for a point only when it has no problems. The editor lets problems be saved so work is not lost. */
export const tableProblems = (t: CompanyTableSnapshot): string[] => validateCompanyTable(snapshotOf(t));

export const useSamplingTables = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = onServer() ? ((await api.listSamplingTables()) as StoredTable[]) : await values<StoredTable>(db);
      setState({ items: sorted(items), ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The sampling tables could not be read ${onServer() ? "from the server" : "from this browser"}: ${(e as Error).message}` });
    }
  },

  async save(table, action = "edited") {
    const now = new Date().toISOString();
    const cur = getState().items.find((x) => x.id === table.id);
    const history: TableHistoryEntry[] = cur ? [...cur.history, { at: now, action: action === "created" ? "edited" : action, before: snapshotOf(cur) }] : [{ at: now, action: action === "edited" ? "created" : action }];
    const next: StoredTable = { ...snapshotOf(table), createdAt: cur?.createdAt ?? now, updatedAt: now, history };
    try {
      let saved = next;
      if (onServer()) {
        if (cur) await api.putSamplingTable(next.id, next);
        else saved = { ...next, id: (await api.createSamplingTable(next)).id };
      } else await set(next.id, next, db);
      setState({ items: sorted([...getState().items.filter((x) => x.id !== cur?.id && x.id !== saved.id), saved]), error: null });
      return saved;
    } catch (e) {
      setState({ error: `The table could not be saved ${onServer() ? "on the server" : "in this browser"}: ${(e as Error).message}. Export it as a file to keep it.` });
      throw e;
    }
  },

  async ensure(tables) {
    // On the server the library needs the sampling module; without it there is nothing to add to.
    if (SERVER_MODE && !(remoteStorage() && useSession.getState().user?.plan.modules.includes("sampling"))) return;
    try {
      await getState().load();
      for (const t of tables) if (!getState().items.some((x) => x.id === t.id)) await getState().save(t, "created");
    } catch {
      /* the library stays as it was; the Sampling tables page shows any storage problem */
    }
  },

  async remove(id) {
    try {
      if (onServer()) await api.deleteSamplingTable(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The table could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) afterSessionEnds(() => useSamplingTables.setState({ items: [], ready: false, error: null }));

// ------------------------------------------------------------------ file export / import (.gap-sampling-table.json)

export function tableFileJson(t: CompanyTableSnapshot): string {
  return JSON.stringify({ format: "gap-sampling-table", formatVersion: 1, table: snapshotOf(t) }, null, 2);
}

/** Reads an exported table file. Throws a readable message when it is not one. The imported table gets a fresh id. */
export function parseTableFile(text: string): CompanyTableSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not a sampling table file (it is not valid JSON).");
  }
  const o = raw as { format?: unknown; table?: CompanyTableSnapshot };
  if (o?.format !== "gap-sampling-table" || !o.table || !Array.isArray(o.table.rows) || typeof o.table.name !== "string") {
    throw new Error("The file is not a sampling table file made by this tool.");
  }
  return { ...snapshotOf(o.table), id: newTableId() };
}
