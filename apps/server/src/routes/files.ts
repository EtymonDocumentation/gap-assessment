/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, drainLimitFor, formatBytes, sendJson, sendNoContent, type Route } from "../http";
import { MAX_ATTACHED_FILES, attachedUsage, quotaBytesOf, storageFullMessage } from "../limits";
import { incomingDir, readIndex, usedBytes } from "../myfiles";
import { displayName, isId, isSourceId, safeContentType, safeName } from "../names";
import type { FileMeta } from "../types";
import { receiveToDisk, throttle } from "./myfiles";
import { idParam, notFound, userPath } from "./util";

const MB = 1024 * 1024;

/** RFC 5987 encoding for the filename* parameter (encodeURIComponent leaves a few characters that need escaping). */
function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const fileRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/files",
    auth: true,
    storage: true,
    async handler(ctx) {
      const projectId = ctx.url.searchParams.get("projectId") ?? undefined;
      const sourceId = ctx.url.searchParams.get("sourceId") ?? undefined;
      if (projectId !== undefined && !isId(projectId)) throw new HttpError(400, "invalid-id", "That project id is not valid.");
      if (sourceId !== undefined && !isSourceId(sourceId)) throw new HttpError(400, "invalid-id", "That source id is not valid.");

      const { store } = ctx.app;
      const files: FileMeta[] = [];
      for (const name of await store.list(userPath(ctx, "files"))) {
        if (!isId(name)) continue;
        const meta = await store.readJson<FileMeta | null>(userPath(ctx, "files", name, "meta.json"), null).catch(() => null);
        if (!meta) continue;
        if (projectId !== undefined && meta.projectId !== projectId) continue;
        if (sourceId !== undefined && meta.sourceId !== sourceId) continue;
        files.push(meta);
      }
      files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      sendJson(ctx.res, 200, { files });
    },
  },

  {
    method: "POST",
    path: "/api/files",
    auth: true,
    storage: true,
    upload: true,
    async handler(ctx) {
      const { req } = ctx;
      const { store, config } = ctx.app;
      // Same hourly limit as "My files" uploads.
      throttle(ctx.app.myFilesUploads, ctx);

      const rawName = header(req.headers["x-file-name"]);
      if (!rawName || rawName.length > 1500) throw new HttpError(400, "invalid", "The file name is missing (X-File-Name).");
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawName);
      } catch {
        throw new HttpError(400, "invalid", "The file name could not be read (X-File-Name).");
      }
      const projectId = header(req.headers["x-project-id"]);
      const sourceId = header(req.headers["x-source-id"]);
      if (projectId !== undefined && !isId(projectId)) throw new HttpError(400, "invalid-id", "That project id is not valid.");
      if (sourceId !== undefined && !isSourceId(sourceId)) throw new HttpError(400, "invalid-id", "That source id is not valid.");

      // The same limits as "My files": one file at most maxUploadMB, and one account at most its storage limit for both kinds of
      // file together. The body goes to disk as it arrives instead of being held in memory, so a big upload costs no memory.
      const perFile = config.maxUploadMB * MB;
      const quota = quotaBytesOf(ctx.user.filesQuotaMB);
      const tooBig = () => {
        const err = new HttpError(413, "too-large", `That file is larger than the ${formatBytes(perFile)} allowed for one file.`);
        err.drainLimit = drainLimitFor(perFile);
        return err;
      };
      const declared = Number(req.headers["content-length"]);
      const known = Number.isFinite(declared) && declared >= 0;
      if (known && declared > perFile) throw tooBig();

      const attached = await attachedUsage(store, ctx.user.id);
      if (attached.count >= MAX_ATTACHED_FILES) throw new HttpError(400, "too-many", "There are too many attached files in this account. Delete some first.");
      const usedBefore = usedBytes(await readIndex(store, ctx.user.id)) + attached.bytes;
      const reservedNow = ctx.app.myFilesReserved.get(ctx.user.id) ?? 0;
      const room = Math.max(0, quota - usedBefore - reservedNow);
      const quotaError = () => {
        const err = new HttpError(413, "quota-exceeded", storageFullMessage(usedBefore, quota));
        err.drainLimit = drainLimitFor(perFile);
        return err;
      };
      if (known && declared > room) throw quotaError();
      const overQuota = room < perFile;
      const limit = overQuota ? room : perFile;

      // Space for this upload is held while it arrives, so uploads started together cannot both squeeze into the last bit.
      const reserved = known ? declared : 0;
      ctx.app.myFilesReserved.set(ctx.user.id, reservedNow + reserved);

      const id = randomUUID();
      const name = safeName(decoded);
      const tmp = join(incomingDir(store, ctx.user.id), `${id}.part`);
      try {
        await mkdir(incomingDir(store, ctx.user.id), { recursive: true, mode: 0o700 });
        const got = await receiveToDisk(ctx, tmp, limit, overQuota ? quotaError : tooBig);
        if (got.size === 0) throw new HttpError(400, "invalid", "The file is empty.");
        await mkdir(userPath(ctx, "files", id), { recursive: true, mode: 0o700 });
        await rename(tmp, userPath(ctx, "files", id, name));
        const meta: FileMeta = {
          id,
          fileName: displayName(decoded),
          safeName: name,
          size: got.size,
          sha256: got.sha256,
          contentType: safeContentType(header(req.headers["content-type"])),
          uploadedAt: new Date().toISOString(),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(sourceId !== undefined ? { sourceId } : {}),
        };
        await store.writeJson(userPath(ctx, "files", id, "meta.json"), meta);
        await store.audit("file-upload", { userId: ctx.user.id, fileId: id, size: meta.size, sha256: meta.sha256, ip: ctx.ip });
        sendJson(ctx.res, 201, { file: meta });
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => undefined);
        await rm(userPath(ctx, "files", id), { recursive: true, force: true }).catch(() => undefined);
        throw err;
      } finally {
        const left = (ctx.app.myFilesReserved.get(ctx.user.id) ?? 0) - reserved;
        if (left > 0) ctx.app.myFilesReserved.set(ctx.user.id, left);
        else ctx.app.myFilesReserved.delete(ctx.user.id);
      }
    },
  },

  {
    method: "GET",
    path: "/api/files/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const meta = await ctx.app.store.readJson<FileMeta | null>(userPath(ctx, "files", id, "meta.json"), null);
      if (!meta) throw notFound("file");
      const name = safeName(meta.safeName);
      const path = userPath(ctx, "files", id, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw notFound("file");
      ctx.res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeFilename(name)}`,
        "X-Content-Type-Options": "nosniff",
      });
      const stream = createReadStream(path);
      stream.on("error", () => ctx.res.destroy());
      stream.pipe(ctx.res);
    },
  },

  {
    method: "DELETE",
    path: "/api/files/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "files", id);
      await store.withLock(folder, async () => {
        if (!(await store.exists(join(folder, "meta.json")))) throw notFound("file");
        await store.toTrash(ctx.user.id, "files", folder, id);
      });
      await store.audit("file-delete", { userId: ctx.user.id, fileId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
