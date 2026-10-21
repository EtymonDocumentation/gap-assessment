/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Route } from "../http";
import { isId } from "../names";
import { idParam, notFound, parseBody, userPath } from "./util";

type Meta = Record<string, unknown> & { id: string };

// The server does not know the template analysis or mapping formats (they belong to the web app); it keeps
// them as given and checks only the few plain fields it relies on.
const metaSchema = z
  .object({
    id: z.unknown().optional(),
    name: z.string({ error: "The template needs a name." }).min(1, "The template needs a name.").max(200),
    version: z.string({ error: "The template needs a version." }).max(100),
    fileName: z.string().max(260).optional(),
  })
  .passthrough();

const createSchema = z.object({
  meta: metaSchema,
  bytesBase64: z.string({ error: "The template file is missing." }).regex(/^[A-Za-z0-9+/]*={0,2}$/, "The template file is not valid base64."),
});

const patchSchema = z.object({
  name: z.string().min(1, "The template needs a name.").max(200).optional(),
  version: z.string().max(100).optional(),
  mapping: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
});

export const templateRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/templates",
    auth: true,
    storage: true,
    async handler(ctx) {
      const { store } = ctx.app;
      const folder = userPath(ctx, "templates");
      const templates: Meta[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const meta = await store.readJson<Meta | null>(join(folder, name), null).catch(() => null);
        if (meta) templates.push(meta);
      }
      sendJson(ctx.res, 200, { templates });
    },
  },

  {
    method: "POST",
    path: "/api/templates",
    auth: true,
    storage: true,
    async handler(ctx) {
      const body = parseBody(createSchema, await ctx.json());
      const bytes = Buffer.from(body.bytesBase64, "base64");
      if (bytes.length === 0) throw new HttpError(400, "invalid", "The template file is empty.");
      const { store } = ctx.app;
      const id = await store.withLock(`templates:${ctx.user.id}`, async () => {
        // Keep the id the browser used when it is a valid, unused one; otherwise hand out a new one.
        const wanted = body.meta.id;
        const chosen = isId(wanted) && !(await store.exists(userPath(ctx, "templates", `${wanted}.json`))) ? wanted : randomUUID();
        const { bytes: _drop, ...rest } = body.meta as Record<string, unknown>;
        // The file first, the meta last: a template is listed only once its bytes are safely on disk.
        await store.writeBytes(userPath(ctx, "templates", `${chosen}.docx`), bytes);
        await store.writeJson(userPath(ctx, "templates", `${chosen}.json`), { ...rest, id: chosen });
        return chosen;
      });
      await store.audit("template-upload", { userId: ctx.user.id, templateId: id, ip: ctx.ip });
      sendJson(ctx.res, 201, { id });
    },
  },

  {
    method: "GET",
    path: "/api/templates/:id/file",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const bytes = await ctx.app.store.readBytes(userPath(ctx, "templates", `${id}.docx`));
      if (!bytes) throw notFound("template");
      ctx.res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      ctx.res.end(bytes);
    },
  },

  {
    method: "PATCH",
    path: "/api/templates/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const body = parseBody(patchSchema, await ctx.json());
      const next = await ctx.app.store.update<Meta | null>(userPath(ctx, "templates", `${id}.json`), null, (current) => {
        if (!current) throw notFound("template");
        const meta: Meta = { ...current, id };
        if (body.name !== undefined) meta.name = body.name;
        if (body.version !== undefined) meta.version = body.version;
        if (body.mapping === null) delete meta.mapping;
        else if (body.mapping !== undefined) meta.mapping = body.mapping;
        return meta;
      });
      sendJson(ctx.res, 200, { meta: next });
    },
  },

  {
    method: "DELETE",
    path: "/api/templates/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      const id = idParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`templates:${ctx.user.id}`, async () => {
        const meta = userPath(ctx, "templates", `${id}.json`);
        if (!(await store.exists(meta))) throw notFound("template");
        await store.toTrash(ctx.user.id, "templates", meta, `${id}.json`);
        if (await store.exists(userPath(ctx, "templates", `${id}.docx`))) {
          await store.toTrash(ctx.user.id, "templates", userPath(ctx, "templates", `${id}.docx`), `${id}.docx`);
        }
      });
      await store.audit("template-delete", { userId: ctx.user.id, templateId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
