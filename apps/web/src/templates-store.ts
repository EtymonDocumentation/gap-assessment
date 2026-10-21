import type { TemplateAnalysis, TemplateMapping, TemplateMode } from "@gap/docx";
import type { TemplateRecord } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";
import * as api from "./server/api";
import { SERVER_MODE } from "./server/mode";
import { afterSessionEnds, remoteStorage } from "./server/session-store";

/**
 * The template library. It lives in this browser's IndexedDB, in its own database, and is NOT part of the project
 * file: a template can be reused across projects. Only the sanitised copy of a Word template is kept (macros are gone).
 */
export interface StoredTemplate {
  id: string;
  name: string;
  version: string;
  /** Name of the file as uploaded. */
  fileName: string;
  sourceFormat: TemplateAnalysis["sourceFormat"];
  /** SHA-256 of the file as uploaded. This is the hash recorded with every export. */
  sha256: string;
  /** SHA-256 of the copy kept in the library (differs from `sha256` when something was stripped). */
  storedSha256: string;
  addedAt: string;
  bytes: Uint8Array;
  analysis: TemplateAnalysis;
  mapping?: TemplateMapping;
}

const db = createStore("gap-templates", "templates");

interface State {
  items: StoredTemplate[];
  ready: boolean;
  /** Last storage problem, shown on the Templates page. */
  error: string | null;
  load(): Promise<void>;
  add(t: StoredTemplate): Promise<void>;
  patch(id: string, patch: Partial<Pick<StoredTemplate, "name" | "version" | "mapping">>): Promise<void>;
  remove(id: string): Promise<void>;
}

function sorted(items: StoredTemplate[]): StoredTemplate[] {
  return [...items].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ the library kept on the server (server mode only)

function metaOf(t: StoredTemplate): api.TemplateMeta {
  const { bytes: _bytes, ...meta } = t;
  return meta;
}

/** The server sends the details of each template; the Word file of each is fetched too, so a template is ready to use as soon as it is listed. */
async function loadFromServer(): Promise<StoredTemplate[]> {
  const metas = await api.listTemplates();
  return Promise.all(metas.map(async (m) => ({ ...m, bytes: await api.getTemplateFile(m.id) })));
}

/** The templates this browser holds in its own library (from before the server, or from the static demo). Server mode only. */
export function readBrowserLibrary(): Promise<StoredTemplate[]> {
  return values<StoredTemplate>(db).then(sorted);
}

/** Removes the given templates from this browser's own library. Never called without the user asking. */
export async function removeFromBrowserLibrary(ids: string[]): Promise<void> {
  for (const id of ids) await del(id, db);
}

export const useTemplates = /* @__PURE__ */ create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      const items = SERVER_MODE && remoteStorage() ? await loadFromServer() : await values<StoredTemplate>(db);
      setState({ items: sorted(items), ready: true, error: null });
    } catch (e) {
      const where = SERVER_MODE && remoteStorage() ? "from the server" : "from this browser";
      setState({ ready: true, error: `The template library could not be read ${where}: ${(e as Error).message}` });
    }
  },

  async add(t) {
    try {
      let saved = t;
      if (SERVER_MODE && remoteStorage()) {
        const r = await api.createTemplate(metaOf(t), toBase64(t.bytes));
        saved = { ...t, id: r.id };
      } else {
        await set(t.id, t, db);
      }
      setState({ items: sorted([...getState().items.filter((x) => x.id !== saved.id), saved]), error: null });
    } catch (e) {
      const where = SERVER_MODE && remoteStorage() ? "on the server" : "in this browser";
      setState({ error: `The template could not be saved ${where}: ${(e as Error).message}. Export it as a file to keep it.` });
      throw e;
    }
  },

  async patch(id, patch) {
    const cur = getState().items.find((x) => x.id === id);
    if (!cur) return;
    let next: StoredTemplate = { ...cur, ...patch };
    try {
      if (SERVER_MODE && remoteStorage()) {
        const meta = await api.patchTemplate(id, patch);
        next = { ...cur, ...meta, bytes: cur.bytes };
      } else {
        await set(id, next, db);
      }
      setState({ items: getState().items.map((x) => (x.id === id ? next : x)), error: null });
    } catch (e) {
      const where = SERVER_MODE && remoteStorage() ? "on the server" : "in this browser";
      setState({ error: `The change could not be saved ${where}: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(id) {
    try {
      if (SERVER_MODE && remoteStorage()) await api.deleteTemplate(id);
      else await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The template could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

if (SERVER_MODE) {
  // Signed out: the account's library leaves memory. The next sign-in loads it again.
  afterSessionEnds(() => useTemplates.setState({ items: [], ready: false, error: null }));
}

export function newTemplateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "Brightwater template.docx" -> "Brightwater template". */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || fileName;
}

/** What an export records about the template it used. */
export function recordOf(mode: Exclude<TemplateMode, "builtin">, t: StoredTemplate): TemplateRecord {
  return { mode, name: t.name, version: t.version, sha256: t.sha256, fileName: t.fileName };
}

// ------------------------------------------------------------------ template files (.gap-template.json)

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The text of a `<name>.gap-template.json` file. */
export function templateFileJson(t: StoredTemplate): string {
  return JSON.stringify(
    {
      format: "gap-template",
      formatVersion: 1,
      name: t.name,
      version: t.version,
      fileName: t.fileName,
      sha256: t.sha256,
      storedSha256: t.storedSha256,
      sourceFormat: t.sourceFormat,
      stripped: t.analysis.stripped,
      mapping: t.mapping ?? null,
      bytesBase64: toBase64(t.bytes),
    },
    null,
    2,
  );
}

export interface TemplateFile {
  name: string;
  version: string;
  fileName: string;
  sha256: string;
  storedSha256?: string;
  stripped: string[];
  mapping?: TemplateMapping;
  bytes: Uint8Array;
}

/** Hex SHA-256 of some bytes (the browser's own crypto; needs https or localhost, which this app always uses). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function userError(message: string): Error {
  const e = new Error(message);
  e.name = "TemplateError";
  return e;
}

/** Reads a `.gap-template.json` file. Throws an error (named TemplateError) whose message is shown as-is. */
export function parseTemplateFile(text: string): TemplateFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw userError("This is not a template file: it is not valid JSON.");
  }
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.format !== "gap-template") throw userError('This is not a template file. Expected a file saved with "Export template file" on this page.');
  if (o.formatVersion !== 1) throw userError(`This template file has format version ${String(o.formatVersion)}, which this version of the tool cannot read.`);
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || !v.trim()) throw userError(`The template file is incomplete: "${k}" is missing.`);
    return v;
  };
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(str("bytesBase64"));
  } catch (e) {
    if (e instanceof Error && e.name === "TemplateError") throw e;
    throw userError("The template file is damaged: its document data could not be decoded.");
  }
  const mapping = o.mapping && typeof o.mapping === "object" ? (o.mapping as TemplateMapping) : undefined;
  return {
    name: str("name"),
    version: str("version"),
    fileName: str("fileName"),
    sha256: str("sha256"),
    ...(typeof o.storedSha256 === "string" ? { storedSha256: o.storedSha256 } : {}),
    stripped: Array.isArray(o.stripped) ? o.stripped.filter((x): x is string => typeof x === "string") : [],
    ...(mapping && Array.isArray(mapping.headings) ? { mapping } : {}),
    bytes,
  };
}
