/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { companyTableSnapshotSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { isId } from "../names";
import { idParam, notFound, parseBody, userPath } from "./util";

type Stored = Record<string, unknown> & { id: string };

/** The module key an account needs to keep company sampling tables on the server. */
export const SAMPLING_MODULE = "sampling";

/**
 * The sampling module is a paid add-on: an account without it gets a plain refusal. (Hiding the menu in the web app is only a
 * convenience; this is the check that counts.)
 */
function requireSamplingModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(SAMPLING_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the sampling module.");
  }
}

// A table is the shared company-table shape plus the library's own bookkeeping (when it was made, and its edit history). Unknown
// extra fields are kept as given so a newer web app does not lose data on an older server.
const tableSchema = companyTableSnapshotSchema
  .extend({
    id: z.unknown().optional(),
    name: z.string({ error: "The table needs a name." }).min(1, "The table needs a name.").max(200),
    version: z.string({ error: "The table needs a version." }).max(100),
    rows: z.array(companyTableSnapshotSchema.shape.rows.element).max(1000, "The table has too many rows."),
    createdAt: z.string().max(40).optional(),
    updatedAt: z.string().max(40).optional(),
    history: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
  })
  .passthrough();
const bodySchema = z.object({ table: tableSchema });

export const samplingTableRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/sampling-tables",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "sampling-tables");
      const tables: Stored[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const t = await store.readJson<Stored | null>(join(folder, name), null).catch(() => null);
        if (t) tables.push(t);
      }
      sendJson(ctx.res, 200, { tables });
    },
  },

  {
    method: "POST",
    path: "/api/sampling-tables",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const id = await store.withLock(`sampling-tables:${ctx.user.id}`, async () => {
        // Keep the id the browser used when it is a valid, unused one; otherwise hand out a new one.
        const wanted = body.table.id;
        const chosen = isId(wanted) && !(await store.exists(userPath(ctx, "sampling-tables", `${wanted}.json`))) ? wanted : randomUUID();
        await store.writeJson(userPath(ctx, "sampling-tables", `${chosen}.json`), { ...body.table, id: chosen });
        return chosen;
      });
      await store.audit("sampling-table-create", { userId: ctx.user.id, tableId: id, ip: ctx.ip });
      sendJson(ctx.res, 201, { id });
    },
  },

  {
    method: "PUT",
    path: "/api/sampling-tables/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const id = idParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const saved = await store.update<Stored | null>(userPath(ctx, "sampling-tables", `${id}.json`), null, (current) => {
        if (!current) throw notFound("sampling table");
        return { ...body.table, id };
      });
      await store.audit("sampling-table-update", { userId: ctx.user.id, tableId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { table: saved });
    },
  },

  {
    method: "DELETE",
    path: "/api/sampling-tables/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const id = idParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`sampling-tables:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "sampling-tables", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("sampling table");
        await store.toTrash(ctx.user.id, "sampling-tables", file, `${id}.json`);
      });
      await store.audit("sampling-table-delete", { userId: ctx.user.id, tableId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
