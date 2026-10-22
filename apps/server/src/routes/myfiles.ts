/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RateLimiter } from "../auth";
import { HttpError, drainLimitFor, formatBytes, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import {
  LimitError,
  MAX_AUTO_DELETE_DAYS,
  MAX_FILES_PER_ACCOUNT,
  MAX_FOLDER_DEPTH,
  accountDir,
  blobPath,
  ensureFolder,
  expiryFrom,
  findFolder,
  folderLeaf,
  folderNameTaken,
  folderParent,
  freeName,
  incomingDir,
  isInside,
  isPreviewable,
  joinFolder,
  nameTaken,
  parseFolderPath,
  readIndex,
  removeBlob,
  storedContentType,
  summariseAgent,
  updateIndex,
  usedBytes,
  type MyFile,
  type MyFilesIndex,
} from "../myfiles";
import { cleanLabel, isId, safeContentType, safeName } from "../names";
import { idParam, notFound, parseBody } from "./util";

const MB = 1024 * 1024;

/** What the browser sees of a file: no disk name, and a flag for the thumbnail. */
function publicFile(f: MyFile) {
  const { diskName: _disk, ...rest } = f;
  return { ...rest, previewable: isPreviewable(f.contentType) };
}

function throttle(limiter: RateLimiter, ctx: Ctx): void {
  const retryAfterSeconds = limiter.retryAfterSeconds(ctx.user.id);
  if (retryAfterSeconds > 0) throw new HttpError(429, "rate-limited", "Too many requests. Please wait a moment and try again.", { retryAfterSeconds });
  limiter.hit(ctx.user.id);
}

const header = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function quotaBytes(ctx: Ctx): number | null {
  const mb = ctx.user.filesQuotaMB;
  return typeof mb === "number" ? mb * MB : null;
}

const quotaError = (ctx: Ctx, used: number): HttpError =>
  new HttpError(413, "quota-exceeded", `Your My files space is full (${formatBytes(used)} of ${formatBytes(quotaBytes(ctx) ?? 0)} used). Delete some files and try again.`);

const badFolder = () => new HttpError(400, "invalid-folder", `That folder name is not valid (names use letters, digits and spaces; at most ${MAX_FOLDER_DEPTH} levels deep).`);
const folderMissing = () => new HttpError(404, "folder-not-found", "That folder was not found.");
const nameConflict = (what: string) => new HttpError(409, "name-taken", `A ${what} with that name already exists here.`);

function folderOrThrow(index: MyFilesIndex, raw: unknown): string {
  const parsed = parseFolderPath(raw);
  if (parsed === null) throw badFolder();
  const found = findFolder(index, parsed);
  if (found === null) throw folderMissing();
  return found;
}

const depthOf = (path: string): number => (path === "" ? 0 : path.split("/").length);

/** Runs an index change, turning the "too many folders" limit into a plain answer. */
async function change<T>(ctx: Ctx, fn: (index: MyFilesIndex) => T): Promise<T> {
  try {
    return await updateIndex(ctx.app.store, ctx.user.id, fn);
  } catch (err) {
    if (err instanceof LimitError) throw new HttpError(400, "too-many", "There are too many folders in this account.");
    throw err;
  }
}

/* ---------- streaming an upload to disk ---------- */

interface Received {
  size: number;
  sha256: string;
  head: Buffer;
}

/**
 * Writes the request body to `tmp` as it arrives (never holding more than one chunk in memory), hashing on the way. Over
 * `limit` the upload is stopped at once: the request is paused (so the 413 handler can drain the rest, see http.ts), the
 * half file is deleted, and the caller gets `tooBig`. A connection that drops half way also removes the half file.
 */
function receiveToDisk(ctx: Ctx, tmp: string, limit: number, tooBig: () => HttpError): Promise<Received> {
  const { req } = ctx;
  return new Promise((resolve, reject) => {
    const out = createWriteStream(tmp, { flags: "wx", mode: 0o600 });
    const hash = createHash("sha256");
    const head: Buffer[] = [];
    let headLen = 0;
    let size = 0;
    let settled = false;

    const detach = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onAbort);
      req.off("aborted", onAbort);
      req.off("close", onClose);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      detach();
      req.pause();
      // Delete only after the handle is closed: Windows refuses to remove an open file.
      out.once("close", () => void rm(tmp, { force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined).then(() => reject(err)));
      out.destroy();
    };
    const onAbort = () => fail(new HttpError(400, "aborted", "The upload was interrupted."));
    const onClose = () => {
      if (!req.complete) onAbort();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return fail(tooBig());
      hash.update(chunk);
      if (headLen < 16) {
        head.push(chunk.subarray(0, 16 - headLen));
        headLen += Math.min(chunk.length, 16 - headLen);
      }
      // Back-pressure: stop reading while the disk catches up, so memory stays flat for any file size.
      if (!out.write(chunk)) {
        req.pause();
        out.once("drain", () => req.resume());
      }
    };
    const onEnd = () => {
      if (settled) return;
      detach();
      out.end(() => {
        if (settled) return;
        settled = true;
        resolve({ size, sha256: hash.digest("hex"), head: Buffer.concat(head) });
      });
    };
    out.on("error", (e) => fail(e));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onAbort);
    req.on("aborted", onAbort);
    req.on("close", onClose);
  });
}

/* ---------- bodies ---------- */

const folderField = z.string().max(2000).optional();
const days = z.number({ error: "Give a whole number of days." }).int("Give a whole number of days.").min(1, "Give at least 1 day.").max(MAX_AUTO_DELETE_DAYS, `Give at most ${MAX_AUTO_DELETE_DAYS} days.`);

const patchFile = z.object({
  name: z.string().max(1000).optional(),
  folder: folderField,
  autoDeleteDays: days.nullable().optional(),
});
const bulkBody = z.object({
  action: z.enum(["delete", "move"]),
  ids: z.array(z.string()).min(1, "Choose at least one file.").max(500, "Choose at most 500 files at once."),
  folder: folderField,
});
const createFolderBody = z.object({ parent: folderField, name: z.string({ error: "Give the folder a name." }).max(1000) });
const renameFolderBody = z.object({ path: z.string().max(2000), name: z.string({ error: "Give the folder a name." }).max(1000) });
const moveFolderBody = z.object({ path: z.string().max(2000), parent: folderField });
const deleteFolderBody = z.object({ path: z.string().max(2000), confirm: z.boolean().optional() });
const settingsBody = z.object({ autoDeleteDays: days.nullable() });

/** Rewrites every folder path and file folder that starts with `from` so it starts with `to`. */
function renamePrefix(index: MyFilesIndex, from: string, to: string): void {
  const swap = (p: string): string => (p === from ? to : isInside(p, from) ? to + p.slice(from.length) : p);
  index.folders = index.folders.map(swap);
  index.files = index.files.map((f) => ({ ...f, folder: swap(f.folder) }));
}

/** ASCII fallback for Content-Disposition's filename= (browsers prefer filename*= when both are present). */
const asciiName = (name: string): string => name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
const encodeFilename = (name: string): string => encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function sendBlob(ctx: Ctx, mode: "download" | "preview"): Promise<void> {
  throttle(ctx.app.myFilesReads, ctx);
  const id = idParam(ctx);
  // The lookup is inside this account's own index: another account's file id simply is not there (404, same as a wrong id).
  const file = (await readIndex(ctx.app.store, ctx.user.id)).files.find((f) => f.id === id);
  if (!file) throw notFound("file");
  if (mode === "preview" && !isPreviewable(file.contentType)) throw notFound("preview");
  const path = blobPath(ctx.app.store, ctx.user.id, file);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound("file");
  const stream = createReadStream(path);
  // Open before sending headers, so a file deleted a moment ago gives a clean 404 instead of a broken 200.
  await new Promise<void>((ok, bad) => {
    stream.once("open", () => ok());
    stream.once("error", () => bad(notFound("file")));
  });
  const inline = mode === "preview";
  ctx.res.writeHead(200, {
    // A download is always an attachment of an opaque type, never rendered. The one inline case is the image thumbnail, whose
    // type was fixed from the file's own first bytes at upload (png, jpeg, webp only) and which gets a locked-down policy.
    "Content-Type": file.contentType,
    "Content-Length": info.size,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName(file.name)}"; filename*=UTF-8''${encodeFilename(file.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  stream.on("error", () => ctx.res.destroy());
  ctx.res.on("close", () => stream.destroy());
  stream.pipe(ctx.res);
}

export const myFilesRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/myfiles",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesReads, ctx);
      const index = await readIndex(ctx.app.store, ctx.user.id);
      const folder = folderOrThrow(index, ctx.url.searchParams.get("folder") ?? "");
      const count = (path: string) => ({
        files: index.files.filter((f) => isInside(f.folder, path)).length,
        folders: index.folders.filter((f) => f !== path && isInside(f, path)).length,
      });
      sendJson(ctx.res, 200, {
        folder,
        folders: index.folders
          .filter((f) => folderParent(f) === folder)
          .map((path) => ({ path, name: folderLeaf(path), ...count(path) })),
        allFolders: [...index.folders].sort((a, b) => a.localeCompare(b)),
        files: index.files.filter((f) => f.folder === folder).map(publicFile),
        settings: { autoDeleteDays: index.settings.autoDeleteDays ?? null },
        usage: { usedBytes: usedBytes(index), quotaBytes: quotaBytes(ctx), fileCount: index.files.length },
        maxFileBytes: ctx.app.config.maxUploadMB * MB,
      });
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/upload",
    auth: true,
    storage: true,
    async handler(ctx) {
      const { req } = ctx;
      const { store, config } = ctx.app;
      throttle(ctx.app.myFilesUploads, ctx);

      const rawName = header(req.headers["x-file-name"]);
      if (!rawName || rawName.length > 3000) throw new HttpError(400, "invalid", "The file name is missing (X-File-Name).");
      let name: string | null;
      let folderText: string;
      try {
        name = cleanLabel(decodeURIComponent(rawName));
        folderText = decodeURIComponent(header(req.headers["x-folder"]) ?? "");
      } catch {
        throw new HttpError(400, "invalid", "The file or folder name could not be read.");
      }
      if (name === null) throw new HttpError(400, "invalid", "That file name is not usable.");
      const folder = parseFolderPath(folderText);
      if (folder === null) throw badFolder();

      // Limits, checked before a single byte is stored. Over the limit gives a 413 and the rest of the body is drained (http.ts).
      const perFile = config.maxUploadMB * MB;
      const tooBig = () => {
        const err = new HttpError(413, "too-large", `That file is larger than the ${formatBytes(perFile)} allowed for one file.`);
        err.drainLimit = drainLimitFor(perFile);
        return err;
      };
      const declared = Number(req.headers["content-length"]);
      const known = Number.isFinite(declared) && declared >= 0;
      if (known && declared > perFile) throw tooBig();

      const before = await readIndex(store, ctx.user.id);
      if (before.files.length >= MAX_FILES_PER_ACCOUNT) throw new HttpError(400, "too-many", "There are too many files in this account. Delete some first.");
      const quota = quotaBytes(ctx);
      const reservedNow = ctx.app.myFilesReserved.get(ctx.user.id) ?? 0;
      let limit = perFile;
      let overQuota = false;
      if (quota !== null) {
        const room = Math.max(0, quota - usedBytes(before) - reservedNow);
        if (known && declared > room) {
          const err = quotaError(ctx, usedBytes(before));
          err.drainLimit = drainLimitFor(perFile);
          throw err;
        }
        if (room < limit) {
          limit = room;
          overQuota = true;
        }
      }
      const limitError = () => {
        if (!overQuota) return tooBig();
        const err = quotaError(ctx, usedBytes(before));
        err.drainLimit = drainLimitFor(perFile);
        return err;
      };

      // Space for this upload is held while it arrives, so two uploads started together cannot both squeeze into the last bit.
      const reserved = known ? declared : 0;
      ctx.app.myFilesReserved.set(ctx.user.id, reservedNow + reserved);
      const release = () => {
        const left = (ctx.app.myFilesReserved.get(ctx.user.id) ?? 0) - reserved;
        if (left > 0) ctx.app.myFilesReserved.set(ctx.user.id, left);
        else ctx.app.myFilesReserved.delete(ctx.user.id);
      };

      const id = randomUUID();
      const tmp = join(incomingDir(store, ctx.user.id), `${id}.part`);
      let blobDir: string | undefined;
      try {
        await mkdir(incomingDir(store, ctx.user.id), { recursive: true, mode: 0o700 });
        const got = await receiveToDisk(ctx, tmp, limit, limitError);

        const diskName = safeName(name);
        blobDir = join(accountDir(store, ctx.user.id), id);
        await mkdir(blobDir, { mode: 0o700 });
        await rename(tmp, join(blobDir, diskName));

        const claimed = safeContentType(header(req.headers["content-type"]));
        const meta = await change(ctx, (index) => {
          // Checked again on fresh data: the figure read before the upload may be out of date by now.
          if (quota !== null && usedBytes(index) + got.size > quota) throw quotaError(ctx, usedBytes(index));
          if (index.files.length >= MAX_FILES_PER_ACCOUNT) throw new HttpError(400, "too-many", "There are too many files in this account. Delete some first.");
          const where = ensureFolder(index, folder);
          const file: MyFile = {
            id,
            name: freeName(index, where, name as string),
            folder: where,
            size: got.size,
            contentType: storedContentType(claimed, got.head),
            sha256: got.sha256,
            uploadedAt: new Date().toISOString(),
            uploadedFrom: summariseAgent(header(req.headers["user-agent"])),
            diskName,
            ...(index.settings.autoDeleteDays ? { expiresAt: expiryFrom(index.settings.autoDeleteDays) } : {}),
          };
          index.files.push(file);
          return file;
        });
        blobDir = undefined;
        await store.audit("myfiles-upload", { userId: ctx.user.id, fileId: id, size: meta.size, sha256: meta.sha256, ip: ctx.ip });
        sendJson(ctx.res, 201, { file: publicFile(meta) });
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => undefined);
        if (blobDir) await rm(blobDir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      } finally {
        release();
      }
    },
  },

  {
    method: "GET",
    path: "/api/myfiles/files/:id/download",
    auth: true,
    storage: true,
    handler: (ctx) => sendBlob(ctx, "download"),
  },
  {
    method: "GET",
    path: "/api/myfiles/files/:id/preview",
    auth: true,
    storage: true,
    handler: (ctx) => sendBlob(ctx, "preview"),
  },

  {
    method: "PATCH",
    path: "/api/myfiles/files/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const id = idParam(ctx);
      const body = parseBody(patchFile, await ctx.json());
      let newName: string | undefined;
      if (body.name !== undefined) {
        const cleaned = cleanLabel(body.name);
        if (cleaned === null) throw new HttpError(400, "invalid", "Give the file a name.");
        newName = cleaned;
      }
      const file = await change(ctx, (index) => {
        const f = index.files.find((x) => x.id === id);
        if (!f) throw notFound("file");
        const folder = body.folder !== undefined ? folderOrThrow(index, body.folder) : f.folder;
        const name = newName ?? f.name;
        if ((folder !== f.folder || name !== f.name) && nameTaken(index, folder, name, f.id)) throw nameConflict("file");
        f.folder = folder;
        f.name = name;
        // null = never delete this file (even if the account setting would); a number = this many days from now.
        if (body.autoDeleteDays === null) delete f.expiresAt;
        else if (body.autoDeleteDays !== undefined) f.expiresAt = expiryFrom(body.autoDeleteDays);
        return { ...f };
      });
      sendJson(ctx.res, 200, { file: publicFile(file) });
    },
  },

  {
    method: "DELETE",
    path: "/api/myfiles/files/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const id = idParam(ctx);
      // The index entry goes first (the file is gone for the person at once), the bytes right after.
      const file = await change(ctx, (index) => {
        const f = index.files.find((x) => x.id === id);
        if (!f) throw notFound("file");
        index.files = index.files.filter((x) => x !== f);
        return f;
      });
      await removeBlob(ctx.app.store, ctx.user.id, file);
      await ctx.app.store.audit("myfiles-delete", { userId: ctx.user.id, fileId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/bulk",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(bulkBody, await ctx.json());
      if (!body.ids.every(isId)) throw new HttpError(400, "invalid-id", "That id is not valid.");
      const ids = new Set(body.ids);
      const result = await change(ctx, (index) => {
        const picked = index.files.filter((f) => ids.has(f.id));
        if (body.action === "delete") {
          index.files = index.files.filter((f) => !ids.has(f.id));
          return { picked, moved: 0 };
        }
        const folder = folderOrThrow(index, body.folder ?? "");
        // All or nothing: a name clash in the target stops the whole move, so the person never ends up with half a selection moved.
        const clash = picked.find((f) => f.folder !== folder && nameTaken(index, folder, f.name, f.id));
        if (clash) throw new HttpError(409, "name-taken", `A file named "${clash.name}" already exists in that folder. Nothing was moved.`);
        const names = picked.filter((f) => f.folder !== folder).map((f) => f.name.toLowerCase());
        if (new Set(names).size !== names.length) throw new HttpError(409, "name-taken", "Two of the chosen files have the same name. Nothing was moved.");
        for (const f of picked) f.folder = folder;
        return { picked, moved: picked.length };
      });
      if (body.action === "delete") {
        for (const f of result.picked) await removeBlob(ctx.app.store, ctx.user.id, f);
        await ctx.app.store.audit("myfiles-delete", { userId: ctx.user.id, count: result.picked.length, ip: ctx.ip });
      }
      sendJson(ctx.res, 200, { done: result.picked.length, missing: ids.size - result.picked.length });
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/folders",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(createFolderBody, await ctx.json());
      const name = cleanLabel(body.name);
      if (name === null) throw new HttpError(400, "invalid", "Give the folder a name.");
      const path = await change(ctx, (index) => {
        const parent = folderOrThrow(index, body.parent ?? "");
        if (depthOf(parent) + 1 > MAX_FOLDER_DEPTH) throw new HttpError(400, "too-deep", `Folders can be at most ${MAX_FOLDER_DEPTH} levels deep.`);
        if (folderNameTaken(index, parent, name)) throw nameConflict("folder");
        return ensureFolder(index, joinFolder(parent, name));
      });
      sendJson(ctx.res, 201, { path });
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/folders/rename",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(renameFolderBody, await ctx.json());
      const name = cleanLabel(body.name);
      if (name === null) throw new HttpError(400, "invalid", "Give the folder a name.");
      const path = await change(ctx, (index) => {
        const from = folderOrThrow(index, body.path);
        if (from === "") throw badFolder();
        const to = joinFolder(folderParent(from), name);
        if (folderNameTaken(index, folderParent(from), name, from)) throw nameConflict("folder");
        renamePrefix(index, from, to);
        return to;
      });
      sendJson(ctx.res, 200, { path });
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/folders/move",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(moveFolderBody, await ctx.json());
      const path = await change(ctx, (index) => {
        const from = folderOrThrow(index, body.path);
        if (from === "") throw badFolder();
        const parent = folderOrThrow(index, body.parent ?? "");
        if (isInside(parent, from)) throw new HttpError(400, "invalid-folder", "A folder cannot be moved into itself.");
        const deepest = Math.max(...index.folders.filter((f) => isInside(f, from)).map(depthOf)) - depthOf(from);
        if (depthOf(parent) + 1 + deepest > MAX_FOLDER_DEPTH) throw new HttpError(400, "too-deep", `Folders can be at most ${MAX_FOLDER_DEPTH} levels deep.`);
        if (folderNameTaken(index, parent, folderLeaf(from), from)) throw nameConflict("folder");
        const to = joinFolder(parent, folderLeaf(from));
        renamePrefix(index, from, to);
        return to;
      });
      sendJson(ctx.res, 200, { path });
    },
  },

  {
    method: "POST",
    path: "/api/myfiles/folders/delete",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(deleteFolderBody, await ctx.json());
      const gone = await change(ctx, (index) => {
        const path = folderOrThrow(index, body.path);
        if (path === "") throw badFolder();
        const files = index.files.filter((f) => isInside(f.folder, path));
        const folders = index.folders.filter((f) => f !== path && isInside(f, path));
        // A folder with anything in it is deleted only when the request says so on purpose (the app asks the person first).
        if ((files.length > 0 || folders.length > 0) && body.confirm !== true) {
          throw new HttpError(409, "folder-not-empty", "That folder is not empty. Confirm to delete it with everything inside.", { files: files.length, folders: folders.length });
        }
        index.files = index.files.filter((f) => !files.includes(f));
        index.folders = index.folders.filter((f) => !isInside(f, path));
        return files;
      });
      for (const f of gone) await removeBlob(ctx.app.store, ctx.user.id, f);
      await ctx.app.store.audit("myfiles-folder-delete", { userId: ctx.user.id, files: gone.length, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },

  {
    method: "PUT",
    path: "/api/myfiles/settings",
    auth: true,
    storage: true,
    async handler(ctx) {
      throttle(ctx.app.myFilesChanges, ctx);
      const body = parseBody(settingsBody, await ctx.json());
      // Applies to files uploaded from now on. Files already there keep the date they have (a quiet mass delete is never
      // the result of a setting); each file's own date can be changed in the list.
      await change(ctx, (index) => {
        if (body.autoDeleteDays === null) delete index.settings.autoDeleteDays;
        else index.settings.autoDeleteDays = body.autoDeleteDays;
      });
      sendJson(ctx.res, 200, { settings: { autoDeleteDays: body.autoDeleteDays } });
    },
  },
];
