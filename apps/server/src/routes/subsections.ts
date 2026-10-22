/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { subsectionLibraryItemSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { isId } from "../names";
import { SAMPLING_MODULE } from "./sampling-tables";
import { idParam, notFound, parseBody, userPath } from "./util";

type Stored = Record<string, unknown> & { id: string };

// The Plan subsections library is part of the sampling module, so it is gated exactly like the company sampling tables.
function requireSamplingModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(SAMPLING_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the sampling module.");
  }
}

// A library item is the shared shape plus the library's bookkeeping (when it was made, and its edit history, which keeps what
// each earlier version said). Unknown extra fields are kept so a newer web app does not lose data on an older server.
const itemSchema = subsectionLibraryItemSchema
  .extend({
    id: z.unknown().optional(),
    name: z.string({ error: "The subsection needs a name." }).min(1, "The subsection needs a name.").max(200),
    version: z.string({ error: "The subsection needs a version." }).max(100),
    blocks: subsectionLibraryItemSchema.shape.blocks.max(500, "The subsection is too long."),
    createdAt: z.string().max(40).optional(),
    updatedAt: z.string().max(40).optional(),
    history: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
  })
  .passthrough();
const bodySchema = z.object({ item: itemSchema });

export const subsectionRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/subsections",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "subsections");
      const items: Stored[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const t = await store.readJson<Stored | null>(join(folder, name), null).catch(() => null);
        if (t) items.push(t);
      }
      sendJson(ctx.res, 200, { items });
    },
  },

  {
    method: "POST",
    path: "/api/subsections",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const id = await store.withLock(`subsections:${ctx.user.id}`, async () => {
        // Keep the id the browser used when it is a valid, unused one; otherwise hand out a new one.
        const wanted = body.item.id;
        const chosen = isId(wanted) && !(await store.exists(userPath(ctx, "subsections", `${wanted}.json`))) ? wanted : randomUUID();
        await store.writeJson(userPath(ctx, "subsections", `${chosen}.json`), { ...body.item, id: chosen });
        return chosen;
      });
      await store.audit("subsection-create", { userId: ctx.user.id, itemId: id, ip: ctx.ip });
      sendJson(ctx.res, 201, { id });
    },
  },

  {
    method: "PUT",
    path: "/api/subsections/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const id = idParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const saved = await store.update<Stored | null>(userPath(ctx, "subsections", `${id}.json`), null, (current) => {
        if (!current) throw notFound("subsection");
        return { ...body.item, id };
      });
      await store.audit("subsection-update", { userId: ctx.user.id, itemId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { item: saved });
    },
  },

  {
    method: "DELETE",
    path: "/api/subsections/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const id = idParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`subsections:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "subsections", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("subsection");
        await store.toTrash(ctx.user.id, "subsections", file, `${id}.json`);
      });
      await store.audit("subsection-delete", { userId: ctx.user.id, itemId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
