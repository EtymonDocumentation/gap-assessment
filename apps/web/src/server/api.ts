import type { StoredTemplate } from "../templates-store";

/** Client for the same-origin API of the laptop server. Never talks to any other address. */

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
    /** The server's error code ("conflict", "login-failed", ...), or "network". */
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface PlanInfo {
  id: string;
  status: string;
  since: string;
  /** Module ids the account may use, e.g. "gap". */
  modules: string[];
}
export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  plan: PlanInfo;
}
export interface Health {
  ok: boolean;
  storage: "server" | "client";
  version: string;
}
export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  revision: number;
  schemaVersion: string;
}
export interface FileMeta {
  id: string;
  fileName: string;
  safeName: string;
  size: number;
  sha256: string;
  contentType: string;
  uploadedAt: string;
  projectId?: string;
  sourceId?: string;
}
export type TemplateMeta = Omit<StoredTemplate, "bytes">;

let unauthorized: (() => void) | null = null;
/** Called whenever a signed-in request is answered with 401 (the session ended). */
export function onUnauthorized(fn: (() => void) | null): void {
  unauthorized = fn;
}

const NETWORK_MESSAGE = "The server could not be reached. Check your connection and try again.";

async function errorOf(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  const code = typeof body.error === "string" ? body.error : `http-${res.status}`;
  const message = typeof body.message === "string" && body.message ? body.message : fallbackMessage(res.status, code);
  return new ApiError(res.status, code, message, body);
}

function fallbackMessage(status: number, code: string): string {
  if (status === 401) return "You are signed out. Sign in again to continue.";
  if (status === 413) return "That is too large for the server.";
  if (status === 403 && code === "client-storage") return "This server keeps your projects in your browser, not on the server.";
  if (status === 404) return "That item was not found on the server.";
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return `The server answered with an error (${status}).`;
}

interface CallOptions {
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Auth endpoints answer 401 as a normal result; do not treat it as "session ended". */
  plain401?: boolean;
  keepalive?: boolean;
}

async function call(method: string, path: string, o: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { "X-Gap-Request": "1", ...o.headers };
  let body: BodyInit | undefined = o.body;
  if (o.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.json);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      credentials: "same-origin",
      cache: "no-store",
      // Browsers refuse a keep-alive request with a body over 64 KiB; larger saves go out normally.
      ...(o.keepalive && typeof body === "string" && body.length < 60_000 ? { keepalive: true } : {}),
    });
  } catch {
    throw new ApiError(0, "network", NETWORK_MESSAGE);
  }
  if (res.ok) return res;
  const err = await errorOf(res);
  if (res.status === 401 && !o.plain401) unauthorized?.();
  throw err;
}

async function json<T>(method: string, path: string, o?: CallOptions): Promise<T> {
  const res = await call(method, path, o);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

// ------------------------------------------------------------------ session
export const health = () => json<Health>("GET", "/api/health", { plain401: true });
export const me = () => json<{ user: UserInfo }>("GET", "/api/auth/me", { plain401: true });
export const login = (username: string, password: string) =>
  json<{ user: UserInfo }>("POST", "/api/auth/login", { json: { username, password }, plain401: true });
export const signup = (v: { inviteCode: string; username: string; displayName: string; password: string }) =>
  json<{ user: UserInfo }>("POST", "/api/auth/signup", { json: v, plain401: true });
export const logout = () => call("POST", "/api/auth/logout", { plain401: true }).then(() => undefined);
export const changePassword = (currentPassword: string, newPassword: string) =>
  call("POST", "/api/auth/password", { json: { currentPassword, newPassword }, plain401: true }).then(() => undefined);

// ------------------------------------------------------------------ projects
export const listProjects = () => json<{ projects: ProjectSummary[] }>("GET", "/api/projects").then((r) => r.projects);
export const createProject = (project: unknown, keepalive?: boolean) =>
  json<{ id: string; revision: number; updatedAt: string }>("POST", "/api/projects", { json: { project }, ...(keepalive ? { keepalive } : {}) });
export const getProject = (id: string) => json<{ id: string; revision: number; updatedAt: string; project: unknown }>("GET", `/api/projects/${enc(id)}`);
export const putProject = (id: string, project: unknown, baseRevision: number, keepalive?: boolean) =>
  json<{ revision: number; updatedAt: string }>("PUT", `/api/projects/${enc(id)}`, { json: { project, baseRevision }, ...(keepalive ? { keepalive } : {}) });
export const deleteProject = (id: string) => call("DELETE", `/api/projects/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ templates
export const listTemplates = () => json<{ templates: TemplateMeta[] }>("GET", "/api/templates").then((r) => r.templates);
export const createTemplate = (meta: TemplateMeta, bytesBase64: string) => json<{ id: string }>("POST", "/api/templates", { json: { meta, bytesBase64 } });
export async function getTemplateFile(id: string): Promise<Uint8Array> {
  return new Uint8Array(await (await call("GET", `/api/templates/${enc(id)}/file`)).arrayBuffer());
}
export const patchTemplate = (id: string, patch: { name?: string; version?: string; mapping?: unknown }) =>
  json<{ meta: TemplateMeta }>("PATCH", `/api/templates/${enc(id)}`, { json: patch }).then((r) => r.meta);
export const deleteTemplate = (id: string) => call("DELETE", `/api/templates/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ files
export const listFiles = (filter: { projectId?: string; sourceId?: string } = {}) => {
  const q = new URLSearchParams();
  if (filter.projectId) q.set("projectId", filter.projectId);
  if (filter.sourceId) q.set("sourceId", filter.sourceId);
  const s = q.toString();
  return json<{ files: FileMeta[] }>("GET", `/api/files${s ? `?${s}` : ""}`).then((r) => r.files);
};

/** Uploads the raw bytes of a file. Reports progress (0 to 1) while it is sent. */
export function uploadFile(file: File, opts: { projectId?: string; sourceId?: string; onProgress?: (fraction: number) => void } = {}): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("X-Gap-Request", "1");
    xhr.setRequestHeader("X-File-Name", enc(file.name));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    if (opts.projectId) xhr.setRequestHeader("X-Project-Id", opts.projectId);
    if (opts.sourceId) xhr.setRequestHeader("X-Source-Id", opts.sourceId);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    // A file far over the server's limit gets the connection closed before the answer can be read, so the cause may also be the size.
    xhr.onerror = () => reject(new ApiError(0, "network", `${NETWORK_MESSAGE} If the file is very large, it may be bigger than the server allows.`));
    xhr.onabort = () => reject(new ApiError(0, "network", "The upload was cancelled."));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) return resolve(body.file as FileMeta);
      const code = typeof body.error === "string" ? body.error : `http-${xhr.status}`;
      const message = typeof body.message === "string" && body.message ? body.message : fallbackMessage(xhr.status, code);
      if (xhr.status === 401) unauthorized?.();
      reject(new ApiError(xhr.status, code, message, body));
    };
    xhr.send(file);
  });
}

/** Downloads a stored file as bytes (the caller saves it under the original name). */
export async function downloadFile(id: string): Promise<Uint8Array> {
  return new Uint8Array(await (await call("GET", `/api/files/${enc(id)}`)).arrayBuffer());
}
export const deleteFile = (id: string) => call("DELETE", `/api/files/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ company sampling tables (module "sampling")
export const listSamplingTables = () => json<{ tables: unknown[] }>("GET", "/api/sampling-tables").then((r) => r.tables);
export const createSamplingTable = (table: unknown) => json<{ id: string }>("POST", "/api/sampling-tables", { json: { table } });
export const putSamplingTable = (id: string, table: unknown) => json<{ table: unknown }>("PUT", `/api/sampling-tables/${enc(id)}`, { json: { table } });
export const deleteSamplingTable = (id: string) => call("DELETE", `/api/sampling-tables/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ Plan subsections library (module "sampling")
export const listSubsections = () => json<{ items: unknown[] }>("GET", "/api/subsections").then((r) => r.items);
export const createSubsection = (item: unknown) => json<{ id: string }>("POST", "/api/subsections", { json: { item } });
export const putSubsection = (id: string, item: unknown) => json<{ item: unknown }>("PUT", `/api/subsections/${enc(id)}`, { json: { item } });
export const deleteSubsection = (id: string) => call("DELETE", `/api/subsections/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ Risk method library (module "risk")
export const listRiskMethods = () => json<{ methods: unknown[] }>("GET", "/api/risk-methods").then((r) => r.methods);
export const createRiskMethod = (method: unknown) => json<{ id: string }>("POST", "/api/risk-methods", { json: { method } });
export const putRiskMethod = (id: string, method: unknown) => json<{ method: unknown }>("PUT", `/api/risk-methods/${enc(id)}`, { json: { method } });
export const deleteRiskMethod = (id: string) => call("DELETE", `/api/risk-methods/${enc(id)}`).then(() => undefined);

// ------------------------------------------------------------------ My files (private file transfer between the person's computers)
export interface MyFile {
  id: string;
  name: string;
  /** Folder path such as "Reports/2026"; "" is the top level. */
  folder: string;
  size: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
  uploadedFrom: string;
  /** When the server deletes the file; absent means never. */
  expiresAt?: string;
  /** True for png, jpeg and webp, which have a thumbnail. */
  previewable: boolean;
}
export interface MyFolder {
  path: string;
  name: string;
  files: number;
  folders: number;
}
export interface MyListing {
  folder: string;
  folders: MyFolder[];
  allFolders: string[];
  files: MyFile[];
  settings: { autoDeleteDays: number | null };
  usage: { usedBytes: number; quotaBytes: number | null; fileCount: number };
  maxFileBytes: number;
}

export const listMyFiles = (folder: string) => json<MyListing>("GET", `/api/myfiles${folder ? `?folder=${enc(folder)}` : ""}`);
export const myDownloadUrl = (id: string) => `/api/myfiles/files/${enc(id)}/download`;
export const myPreviewUrl = (id: string) => `/api/myfiles/files/${enc(id)}/preview`;
export const patchMyFile = (id: string, patch: { name?: string; folder?: string; autoDeleteDays?: number | null }) =>
  json<{ file: MyFile }>("PATCH", `/api/myfiles/files/${enc(id)}`, { json: patch }).then((r) => r.file);
export const deleteMyFile = (id: string) => call("DELETE", `/api/myfiles/files/${enc(id)}`).then(() => undefined);
export const bulkMyFiles = (v: { action: "delete" | "move"; ids: string[]; folder?: string }) => json<{ done: number; missing: number }>("POST", "/api/myfiles/bulk", { json: v });
export const createMyFolder = (parent: string, name: string) => json<{ path: string }>("POST", "/api/myfiles/folders", { json: { parent, name } }).then((r) => r.path);
export const renameMyFolder = (path: string, name: string) => json<{ path: string }>("POST", "/api/myfiles/folders/rename", { json: { path, name } }).then((r) => r.path);
export const moveMyFolder = (path: string, parent: string) => json<{ path: string }>("POST", "/api/myfiles/folders/move", { json: { path, parent } }).then((r) => r.path);
/** `confirm` must be true to delete a folder that has anything inside; the server answers 409 "folder-not-empty" otherwise. */
export const deleteMyFolder = (path: string, confirm: boolean) => call("POST", "/api/myfiles/folders/delete", { json: { path, confirm } }).then(() => undefined);
export const saveMyFilesSettings = (autoDeleteDays: number | null) => json<{ settings: { autoDeleteDays: number | null } }>("PUT", "/api/myfiles/settings", { json: { autoDeleteDays } });

/** A running upload: wait for `done`, or call `cancel` to stop it. */
export interface MyUpload {
  done: Promise<MyFile>;
  cancel(): void;
}

/**
 * Sends one file's bytes to My files (streamed by the browser, one request per file so each has its own progress, error
 * and cancel). `folder` is where it should land; folders that do not exist yet are created by the server.
 */
export function uploadMyFile(file: File, folder: string, onProgress: (fraction: number) => void): MyUpload {
  const xhr = new XMLHttpRequest();
  const done = new Promise<MyFile>((resolve, reject) => {
    xhr.open("POST", "/api/myfiles/upload");
    xhr.setRequestHeader("X-Gap-Request", "1");
    xhr.setRequestHeader("X-File-Name", enc(file.name));
    if (folder) xhr.setRequestHeader("X-Folder", enc(folder));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "network", NETWORK_MESSAGE));
    xhr.onabort = () => reject(new ApiError(0, "cancelled", "The upload was cancelled."));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) return resolve(body.file as MyFile);
      const code = typeof body.error === "string" ? body.error : `http-${xhr.status}`;
      const message = typeof body.message === "string" && body.message ? body.message : fallbackMessage(xhr.status, code);
      if (xhr.status === 401) unauthorized?.();
      reject(new ApiError(xhr.status, code, message, body));
    };
    xhr.send(file);
  });
  return { done, cancel: () => xhr.abort() };
}
