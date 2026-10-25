/// <reference types="node" />
import { join } from "node:path";
import { trdLibraryWriteupSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { notFound, parseBody, userPath } from "./util";

/** The module key an account needs to keep TRD process-description write-ups (the write-up library) on the server. */
export const TRD_MODULE = "trd";

/**
 * The TRD module is a paid add-on: an account without it gets a plain refusal. (Hiding the menu in the web app is only a
 * convenience; this is the check that counts.)
 */
export function requireTrdModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(TRD_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the technology transfer document module.");
  }
}

// A write-up id is the readable id of the library ("wu_compounding"). The check keeps anything but letters, digits and underscores out of
// the file name, so the id can be used as the file name directly.
const WRITEUP_ID = /^[a-z][a-z0-9_]{0,59}$/;

function writeupIdParam(ctx: Ctx): string {
  const v = ctx.params.id;
  if (typeof v !== "string" || !WRITEUP_ID.test(v)) throw new HttpError(400, "invalid-id", "That write-up id is not valid.");
  return v;
}

const bodySchema = z.object({ writeup: trdLibraryWriteupSchema });

export const trdWriteupRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/trd-writeups",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireTrdModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "trd-writeups");
      const writeups: unknown[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !WRITEUP_ID.test(name.slice(0, -5))) continue;
        const w = await store.readJson<unknown>(join(folder, name), null).catch(() => null);
        const ok = trdLibraryWriteupSchema.safeParse(w);
        if (ok.success) writeups.push(ok.data);
      }
      sendJson(ctx.res, 200, { writeups });
    },
  },

  {
    // Add or replace this account's copy of a write-up. The web app makes the new version (and keeps the earlier content in the write-up's
    // history); the server stores what it is given after checking the shape.
    method: "PUT",
    path: "/api/trd-writeups/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireTrdModule(ctx);
      const id = writeupIdParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      if (body.writeup.id !== id) throw new HttpError(400, "invalid", "The write-up id in the address and in the write-up differ.");
      const { store } = ctx.app;
      await store.withLock(`trd-writeups:${ctx.user.id}`, async () => {
        await store.writeJson(userPath(ctx, "trd-writeups", `${id}.json`), body.writeup);
      });
      await store.audit("trd-writeup-save", { userId: ctx.user.id, writeupId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { writeup: body.writeup });
    },
  },

  {
    method: "DELETE",
    path: "/api/trd-writeups/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireTrdModule(ctx);
      const id = writeupIdParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`trd-writeups:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "trd-writeups", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("write-up");
        await store.toTrash(ctx.user.id, "trd-writeups", file, `${id}.json`);
      });
      await store.audit("trd-writeup-delete", { userId: ctx.user.id, writeupId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
