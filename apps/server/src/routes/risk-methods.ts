/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { riskMethodSnapshotSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { isId } from "../names";
import { idParam, notFound, parseBody, userPath } from "./util";

type Stored = Record<string, unknown> & { id: string };

/** The module key an account needs to keep risk methods (the method library) on the server. */
export const RISK_MODULE = "risk";

/**
 * The risk module is a paid add-on: an account without it gets a plain refusal. (Hiding the menu in the web app is only a
 * convenience; this is the check that counts.)
 */
function requireRiskModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(RISK_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the risk module.");
  }
}

// A method is the shared snapshot shape (name, version, document reference, owner, configuration) plus the library's own
// bookkeeping (when it was made, and its edit history). Unknown extra fields are kept as given so a newer web app does not lose
// data on an older server.
const methodSchema = riskMethodSnapshotSchema
  .extend({
    id: z.unknown().optional(),
    name: z.string({ error: "The method needs a name." }).min(1, "The method needs a name.").max(200),
    version: z.string({ error: "The method needs a version." }).min(1, "The method needs a version.").max(100),
    createdAt: z.string().max(40).optional(),
    updatedAt: z.string().max(40).optional(),
    history: z.array(z.record(z.string(), z.unknown())).max(2000).optional(),
  })
  .passthrough();
const bodySchema = z.object({ method: methodSchema });

export const riskMethodRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/risk-methods",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireRiskModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "risk-methods");
      const methods: Stored[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const m = await store.readJson<Stored | null>(join(folder, name), null).catch(() => null);
        if (m) methods.push(m);
      }
      sendJson(ctx.res, 200, { methods });
    },
  },

  {
    method: "POST",
    path: "/api/risk-methods",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireRiskModule(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const id = await store.withLock(`risk-methods:${ctx.user.id}`, async () => {
        // Keep the id the browser used when it is a valid, unused one; otherwise hand out a new one.
        const wanted = body.method.id;
        const chosen = isId(wanted) && !(await store.exists(userPath(ctx, "risk-methods", `${wanted}.json`))) ? wanted : randomUUID();
        await store.writeJson(userPath(ctx, "risk-methods", `${chosen}.json`), { ...body.method, id: chosen });
        return chosen;
      });
      await store.audit("risk-method-create", { userId: ctx.user.id, methodId: id, ip: ctx.ip });
      sendJson(ctx.res, 201, { id });
    },
  },

  {
    method: "PUT",
    path: "/api/risk-methods/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireRiskModule(ctx);
      const id = idParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const saved = await store.update<Stored | null>(userPath(ctx, "risk-methods", `${id}.json`), null, (current) => {
        if (!current) throw notFound("risk method");
        return { ...body.method, id };
      });
      await store.audit("risk-method-update", { userId: ctx.user.id, methodId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { method: saved });
    },
  },

  {
    method: "DELETE",
    path: "/api/risk-methods/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireRiskModule(ctx);
      const id = idParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`risk-methods:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "risk-methods", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("risk method");
        await store.toTrash(ctx.user.id, "risk-methods", file, `${id}.json`);
      });
      await store.audit("risk-method-delete", { userId: ctx.user.id, methodId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
