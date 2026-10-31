/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { savedAnswerSetSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { isId } from "../names";
import { idParam, notFound, parseBody, userPath } from "./util";

type Stored = Record<string, unknown> & { id: string };

/** The module key an account needs to keep saved answer sets: the gap assessment itself, which every account has. */
export const SAVED_ANSWERS_MODULE = "gap";

function requireModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(SAVED_ANSWERS_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the gap assessment.");
  }
}

// The shared set shape (name, sides, answers ...). The id is the server's to hand out. Unknown extra fields are kept as given so a
// newer web app does not lose data on an older server.
const bodySchema = z.object({ set: savedAnswerSetSchema });

/**
 * Saved answer sets of one account: interview answers kept outside any project and offered to another project after the author's
 * review. Like the other per-account libraries they are plain JSON files in the account's folder; deleting moves the file to the trash.
 */
export const savedAnswerRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/saved-answers",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "saved-answers");
      const sets: Stored[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !isId(name.slice(0, -5))) continue;
        const s = await store.readJson<Stored | null>(join(folder, name), null).catch(() => null);
        if (s) sets.push(s);
      }
      sendJson(ctx.res, 200, { sets });
    },
  },

  {
    method: "POST",
    path: "/api/saved-answers",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireModule(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const id = await store.withLock(`saved-answers:${ctx.user.id}`, async () => {
        // Keep the id the browser used when it is a valid, unused one; otherwise hand out a new one.
        const wanted = body.set.id;
        const chosen = isId(wanted) && !(await store.exists(userPath(ctx, "saved-answers", `${wanted}.json`))) ? wanted : randomUUID();
        await store.writeJson(userPath(ctx, "saved-answers", `${chosen}.json`), { ...body.set, id: chosen });
        return chosen;
      });
      await store.audit("saved-answers-create", { userId: ctx.user.id, setId: id, ip: ctx.ip });
      sendJson(ctx.res, 201, { id });
    },
  },

  {
    method: "PUT",
    path: "/api/saved-answers/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireModule(ctx);
      const id = idParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      const { store } = ctx.app;
      const saved = await store.update<Stored | null>(userPath(ctx, "saved-answers", `${id}.json`), null, (current) => {
        if (!current) throw notFound("saved answer set");
        return { ...body.set, id };
      });
      await store.audit("saved-answers-update", { userId: ctx.user.id, setId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { set: saved });
    },
  },

  {
    method: "DELETE",
    path: "/api/saved-answers/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireModule(ctx);
      const id = idParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`saved-answers:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "saved-answers", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("saved answer set");
        await store.toTrash(ctx.user.id, "saved-answers", file, `${id}.json`);
      });
      await store.audit("saved-answers-delete", { userId: ctx.user.id, setId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
