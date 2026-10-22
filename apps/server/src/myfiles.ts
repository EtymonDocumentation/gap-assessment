/// <reference types="node" />
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { cleanLabel, isId, safeName } from "./names";
import type { Store } from "./store";

/**
 * "My files": private file transfer between a person's own computers.
 *
 * On disk (relative to the data folder):
 *   files/<accountId>/index.json            what the account has: folders, files, settings
 *   files/<accountId>/<fileId>/<name>       the bytes, a real file the laptop can open
 *   files/<accountId>/.incoming/<uuid>.part an upload that is still arriving (renamed into place when complete)
 *
 * The folder names and the file names the person sees are only labels in index.json. The place on disk is built from the
 * account id and a server-made file id, and the leaf name goes through safeName(), so nothing the browser sends can steer a
 * path. Folders are therefore not real folders on disk: renaming or moving one rewrites labels, never moves bytes.
 */

export const MAX_FOLDER_DEPTH = 8;
export const MAX_FILES_PER_ACCOUNT = 20_000;
export const MAX_FOLDERS_PER_ACCOUNT = 2_000;
export const MAX_AUTO_DELETE_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A blob folder nobody lists, or a half-sent upload, is only removed once it is this old (an upload takes minutes at most). */
const ORPHAN_AGE_MS = 60 * 60 * 1000;

export interface MyFile {
  id: string;
  /** The name shown to the person. Can be renamed; the name on disk stays as it was when the file arrived. */
  name: string;
  /** Folder path such as "Reports/2026"; "" is the top level. Names inside are separated by "/". */
  folder: string;
  size: number;
  contentType: string;
  sha256: string;
  uploadedAt: string;
  /** Short browser/OS summary of where the upload came from, e.g. "Chrome on Windows". */
  uploadedFrom: string;
  /** The leaf name under files/<account>/<id>/ (already passed through safeName). */
  diskName: string;
  /** When the sweep deletes the file. Absent means never. */
  expiresAt?: string;
}

export interface MyFilesIndex {
  version: 1;
  /** Every folder that exists, as full paths, so empty folders survive. Parents are always listed too. */
  folders: string[];
  files: MyFile[];
  settings: { autoDeleteDays?: number };
}

export const emptyIndex = (): MyFilesIndex => ({ version: 1, folders: [], files: [], settings: {} });

export const accountDir = (store: Store, accountId: string): string => {
  if (!isId(accountId)) throw new Error("Not an account id.");
  return store.path("files", accountId);
};
export const indexPath = (store: Store, accountId: string): string => join(accountDir(store, accountId), "index.json");
export const incomingDir = (store: Store, accountId: string): string => join(accountDir(store, accountId), ".incoming");

export async function readIndex(store: Store, accountId: string): Promise<MyFilesIndex> {
  const raw = await store.readJson<Partial<MyFilesIndex>>(indexPath(store, accountId), {});
  return { version: 1, folders: raw.folders ?? [], files: raw.files ?? [], settings: raw.settings ?? {} };
}

/** Read, change and write the index as one step (queued per file, like every other JSON file the server owns). */
export function updateIndex<T>(store: Store, accountId: string, fn: (index: MyFilesIndex) => T): Promise<T> {
  let result!: T;
  return store
    .update<MyFilesIndex>(indexPath(store, accountId), emptyIndex(), (current) => {
      const index: MyFilesIndex = { version: 1, folders: [...(current.folders ?? [])], files: [...(current.files ?? [])], settings: { ...(current.settings ?? {}) } };
      result = fn(index);
      return index;
    })
    .then(() => result);
}

export const usedBytes = (index: MyFilesIndex): number => index.files.reduce((sum, f) => sum + f.size, 0);

/* ---------- where the bytes live ---------- */

/** The path of a file's bytes. Refuses anything that would leave the account's folder (defence in depth: ids and names are also checked). */
export function blobPath(store: Store, accountId: string, file: Pick<MyFile, "id" | "diskName">): string {
  if (!isId(file.id)) throw new Error("Not a file id.");
  const root = resolve(accountDir(store, accountId));
  const path = resolve(root, file.id, safeName(file.diskName));
  if (!path.startsWith(root + sep)) throw new Error("Path outside the account folder.");
  return path;
}

export async function removeBlob(store: Store, accountId: string, file: Pick<MyFile, "id">): Promise<void> {
  if (!isId(file.id)) return;
  // Windows refuses to delete a file that a download is still reading; a few retries, and the hourly sweep clears what is left.
  await rm(join(accountDir(store, accountId), file.id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}

/* ---------- folders ---------- */

export const folderParent = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const folderLeaf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export const joinFolder = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Turns text from the browser into a folder path ("" for the top level), or null when it is not usable (too deep, bad segment). */
export function parseFolderPath(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string" || raw.length > 2000) return null;
  const parts = raw.split(/[\\/]+/).filter((p) => p !== "");
  if (parts.length > MAX_FOLDER_DEPTH) return null;
  const cleaned: string[] = [];
  for (const p of parts) {
    const c = cleanLabel(p);
    if (c === null) return null;
    cleaned.push(c);
  }
  return cleaned.join("/");
}

/** The stored spelling of a folder path (names are matched without regard to case), or null when no such folder exists. */
export function findFolder(index: MyFilesIndex, path: string): string | null {
  if (path === "") return "";
  return index.folders.find((f) => same(f, path)) ?? null;
}

/** Creates the folder and every parent that is missing; returns the stored path. Throws LimitError when the account already has the most folders allowed. */
export function ensureFolder(index: MyFilesIndex, path: string): string {
  if (path === "") return "";
  let current = "";
  for (const part of path.split("/")) {
    const wanted = joinFolder(current, part);
    const found = index.folders.find((f) => same(f, wanted));
    if (found) current = found;
    else {
      if (index.folders.length >= MAX_FOLDERS_PER_ACCOUNT) throw new LimitError("folders");
      index.folders.push(wanted);
      current = wanted;
    }
  }
  return current;
}

export class LimitError extends Error {
  constructor(readonly what: "folders" | "files") {
    super(`limit:${what}`);
  }
}

export const isInside = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** A name that is free in a folder: "photo.png" becomes "photo (2).png" when "photo.png" is taken. */
export function freeName(index: MyFilesIndex, folder: string, name: string): string {
  const taken = new Set(index.files.filter((f) => f.folder === folder).map((f) => f.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export const nameTaken = (index: MyFilesIndex, folder: string, name: string, exceptId?: string): boolean =>
  index.files.some((f) => f.folder === folder && f.id !== exceptId && same(f.name, name));

export const folderNameTaken = (index: MyFilesIndex, parent: string, name: string, exceptPath?: string): boolean =>
  index.folders.some((f) => folderParent(f) === parent && same(folderLeaf(f), name) && !(exceptPath !== undefined && same(f, exceptPath)));

/* ---------- what a file is ---------- */

const PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const isPreviewable = (contentType: string): boolean => PREVIEW_TYPES.has(contentType);

/** The image type from the first bytes (never from the name or the type the browser claimed), or null. */
export function sniffImage(head: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// Types a browser would run or render if they were ever opened rather than saved.
const ACTIVE_TYPE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript|text\/css)$/;

/**
 * The media type stored for an upload. An image type is kept only when the bytes really are that image; anything that could
 * be active content (HTML, SVG, XML, scripts) is stored as application/octet-stream. Downloads are attachments anyway; this
 * is a second lock.
 */
export function storedContentType(claimed: string, head: Buffer): string {
  const sniffed = sniffImage(head);
  if (sniffed) return sniffed;
  if (claimed.startsWith("image/") || ACTIVE_TYPE.test(claimed)) return "application/octet-stream";
  return claimed;
}

/** "Chrome on Windows": a short summary of a User-Agent header. Never the raw header (it can be long and is free text). */
export function summariseAgent(ua: string | undefined): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\/|CriOS\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iPod/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "";
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown browser";
}

/* ---------- the auto-delete sweep ---------- */

export interface SweepResult {
  deleted: number;
  accounts: number;
}

/**
 * Deletes every file whose expiresAt has passed, in every account (disk and index), then clears leftovers (blob folders
 * nobody lists and half-sent uploads, but only old ones, so an upload in progress is never touched).
 *
 * Race safety: the expiry check runs inside the index update, on a fresh read, so a person who just cleared or moved the
 * deadline in another request is respected. The index is written first and the bytes removed after: a crash in between
 * leaves an unlisted blob (cleared on a later sweep), never a listed file with no bytes.
 */
export async function sweepExpired(store: Store, now = new Date()): Promise<SweepResult> {
  const root = store.path("files");
  let deleted = 0;
  let accounts = 0;
  for (const accountId of await store.list(root)) {
    if (!isId(accountId)) continue;
    accounts++;
    const gone: MyFile[] = [];
    if (await store.exists(indexPath(store, accountId))) {
      await updateIndex(store, accountId, (index) => {
        const keep: MyFile[] = [];
        for (const f of index.files) (f.expiresAt && Date.parse(f.expiresAt) <= now.getTime() ? gone : keep).push(f);
        index.files = keep;
      });
    }
    for (const f of gone) await removeBlob(store, accountId, f);
    deleted += gone.length;
    for (const f of gone) await store.audit("myfiles-expired", { userId: accountId, fileId: f.id, size: f.size });
    await clearLeftovers(store, accountId, now);
  }
  return { deleted, accounts };
}

async function clearLeftovers(store: Store, accountId: string, now: Date): Promise<void> {
  const dir = accountDir(store, accountId);
  const listed = new Set((await readIndex(store, accountId)).files.map((f) => f.id));
  for (const name of await store.list(dir)) {
    const path = join(dir, name);
    if (name === ".incoming") {
      for (const part of await store.list(path)) await removeIfOld(join(path, part), now);
    } else if (isId(name) && !listed.has(name)) {
      await removeIfOld(path, now);
    }
  }
}

async function removeIfOld(path: string, now: Date): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (info && now.getTime() - info.mtimeMs > ORPHAN_AGE_MS) await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined);
}

export const expiryFrom = (days: number, now = Date.now()): string => new Date(now + days * DAY_MS).toISOString();

/** Per-account totals for the admin tool: how many files and how many bytes, without reading any folder content. */
export async function usageOf(store: Store, accountId: string): Promise<{ count: number; bytes: number }> {
  const index = await readIndex(store, accountId);
  return { count: index.files.length, bytes: usedBytes(index) };
}

export async function ensureAccountDirs(store: Store, accountId: string): Promise<void> {
  await mkdir(incomingDir(store, accountId), { recursive: true, mode: 0o700 });
}

export async function listAccountIds(store: Store): Promise<string[]> {
  return (await readdir(store.path("files")).catch(() => [] as string[])).filter(isId);
}
