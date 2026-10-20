import type { TemplateAnalysis, TemplateMapping, TemplateMode } from "@gap/docx";
import type { TemplateRecord } from "@gap/process-model";
import { createStore, del, set, values } from "idb-keyval";
import { create } from "zustand";

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

export const useTemplates = create<State>((setState, getState) => ({
  items: [],
  ready: false,
  error: null,

  async load() {
    if (getState().ready) return;
    try {
      setState({ items: sorted(await values<StoredTemplate>(db)), ready: true, error: null });
    } catch (e) {
      setState({ ready: true, error: `The template library could not be read from this browser: ${(e as Error).message}` });
    }
  },

  async add(t) {
    try {
      await set(t.id, t, db);
      setState({ items: sorted([...getState().items.filter((x) => x.id !== t.id), t]), error: null });
    } catch (e) {
      setState({ error: `The template could not be saved in this browser: ${(e as Error).message}. Export it as a file to keep it.` });
      throw e;
    }
  },

  async patch(id, patch) {
    const cur = getState().items.find((x) => x.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    try {
      await set(id, next, db);
      setState({ items: getState().items.map((x) => (x.id === id ? next : x)), error: null });
    } catch (e) {
      setState({ error: `The change could not be saved in this browser: ${(e as Error).message}` });
      throw e;
    }
  },

  async remove(id) {
    try {
      await del(id, db);
      setState({ items: getState().items.filter((x) => x.id !== id), error: null });
    } catch (e) {
      setState({ error: `The template could not be removed: ${(e as Error).message}` });
      throw e;
    }
  },
}));

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
