/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "../auth";
import { HttpError, sendJson, sendNoContent, type Route } from "../http";
import { displayName, isId, isSourceId, safeContentType, safeName } from "../names";
import type { FileMeta } from "../types";
import { idParam, notFound, userPath } from "./util";

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
    async handler(ctx) {
      const { req } = ctx;
      const { store, config } = ctx.app;

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

      const bytes = await ctx.raw(config.maxUploadMB * 1024 * 1024);
      if (bytes.length === 0) throw new HttpError(400, "invalid", "The file is empty.");

      const id = randomUUID();
      const name = safeName(decoded);
      const meta: FileMeta = {
        id,
        fileName: displayName(decoded),
        safeName: name,
        size: bytes.length,
        sha256: sha256Hex(bytes),
        contentType: safeContentType(header(req.headers["content-type"])),
        uploadedAt: new Date().toISOString(),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(sourceId !== undefined ? { sourceId } : {}),
      };
      try {
        await store.writeBytes(userPath(ctx, "files", id, name), bytes);
        await store.writeJson(userPath(ctx, "files", id, "meta.json"), meta);
      } catch (err) {
        await rm(userPath(ctx, "files", id), { recursive: true, force: true }).catch(() => undefined);
        throw err;
      }
      await store.audit("file-upload", { userId: ctx.user.id, fileId: id, size: meta.size, sha256: meta.sha256, ip: ctx.ip });
      sendJson(ctx.res, 201, { file: meta });
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
