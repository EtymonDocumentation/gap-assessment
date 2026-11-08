/// <reference types="node" />
import { statfs } from "node:fs/promises";
import { HttpError, formatBytes, type Ctx } from "./http";
import { accountDir, readIndex, usedBytes } from "./myfiles";
import { isId } from "./names";
import type { Store } from "./store";

/**
 * Limits that keep one account (or one runaway program) from using up the laptop's disk or its attention. They are set well above
 * what a person doing real work reaches, so nobody should ever meet them; each one answers in plain words that say what to do.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** What an account may keep in "My files" and in files attached to projects, together, unless the administrator sets another number. */
export const DEFAULT_FILES_QUOTA_MB = 2048;

/** The server refuses new uploads and saves while the disk it stores on has less than this free. Deleting still works. */
export const MIN_FREE_DISK_BYTES = 5 * GB;

/** The most items one account keeps, per kind. */
export const MAX_PROJECTS = 200;
export const MAX_TEMPLATES = 100;
export const MAX_LIBRARY_ITEMS = 300;
/** The largest single library item (a table, method, block, write-up or answer set) the server stores. Real ones are well under 1 MB. */
export const MAX_LIBRARY_BODY_BYTES = 4 * MB;

/** Most files attached to projects (the older upload route) that one account keeps. */
export const MAX_ATTACHED_FILES = 5_000;

/* ---------- the account's storage ---------- */

/** The account's storage limit in bytes: the administrator's number if one was set, otherwise the default. */
export const quotaBytesOf = (filesQuotaMB: number | undefined): number => (typeof filesQuotaMB === "number" ? filesQuotaMB : DEFAULT_FILES_QUOTA_MB) * MB;

/** Where the files attached to a project are kept (one folder per file, each with a meta.json that records the size). */
const attachedDir = (store: Store, accountId: string): string => store.path("users", accountId, "files");

/** Bytes and count of the files attached to projects. Reads only the small meta.json of each file, never the file itself. */
export async function attachedUsage(store: Store, accountId: string): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  for (const name of await store.list(attachedDir(store, accountId))) {
    if (!isId(name)) continue;
    const meta = await store.readJson<{ size?: unknown } | null>(store.path("users", accountId, "files", name, "meta.json"), null).catch(() => null);
    if (!meta) continue;
    count++;
    if (typeof meta.size === "number") bytes += meta.size;
  }
  return { bytes, count };
}

/** Everything the account stores as files: My files and the files attached to projects. This is the number the limit is checked against. */
export async function accountUsage(store: Store, accountId: string): Promise<{ bytes: number; files: number }> {
  const [index, attached] = await Promise.all([readIndex(store, accountId), attachedUsage(store, accountId)]);
  return { bytes: usedBytes(index) + attached.bytes, files: index.files.length + attached.count };
}

export const storageFullMessage = (used: number, quota: number): string =>
  `Your file space is full (${formatBytes(used)} of ${formatBytes(quota)} used). Delete some files and try again.`;

/* ---------- the disk ---------- */

/** Free bytes on the disk that holds `dir`, or null when the system does not say (then nothing is refused). */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

const DISK_CHECK_MS = 5_000;
let lastCheck: { dir: string; at: number; free: number | null } | undefined;

/** Refuses with a plain message while the data disk is nearly full. The answer is reused for a few seconds, so this is cheap on every save. */
export async function requireDiskRoom(dir: string, minFree: number, now = Date.now()): Promise<void> {
  if (!lastCheck || lastCheck.dir !== dir || now - lastCheck.at > DISK_CHECK_MS) lastCheck = { dir, at: now, free: await freeDiskBytes(dir) };
  if (lastCheck.free !== null && lastCheck.free < minFree) {
    throw new HttpError(507, "disk-full", "The server's disk is almost full, so nothing new can be saved for now. Please tell the person who runs the server.");
  }
}

/** Forgets the last disk reading (tests change the limit between requests). */
export function forgetDiskReading(): void {
  lastCheck = undefined;
}

/* ---------- counts of items ---------- */

/** How many items an account has in one folder of its own data (files named <id>.json, or any .json for the libraries with their own names). */
export async function countItems(ctx: Ctx, collection: string): Promise<number> {
  const names = await ctx.app.store.list(ctx.app.store.path("users", ctx.user.id, collection));
  return names.filter((n) => n.endsWith(".json")).length;
}

/**
 * Refuses a new item when the account already has the most it may keep. Saving over an item that exists is always fine, so
 * pass the file the request is about to write as `target`.
 */
export async function requireRoomForItem(ctx: Ctx, collection: string, target: string | null, max: number, noun: string): Promise<void> {
  const { store } = ctx.app;
  if (target !== null && (await store.exists(store.path("users", ctx.user.id, collection, target)))) return;
  if ((await countItems(ctx, collection)) < max) return;
  throw new HttpError(
    400,
    "too-many",
    `You already have ${max} ${noun}, which is the most this server keeps for one account. Delete some you no longer need, then try again.`,
  );
}

export { accountDir };
