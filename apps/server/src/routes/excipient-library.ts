/// <reference types="node" />
import { join } from "node:path";
import { EXCIPIENT_LIBRARY_ID, excipientLibraryRecordSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { MAX_LIBRARY_BODY_BYTES, MAX_LIBRARY_ITEMS, requireRoomForItem } from "../limits";
import { notFound, parseBody, userPath } from "./util";

/** The module key an account needs to keep saved excipients (the excipient library) on the server. */
export const EXCIPIENT_MODULE = "excipient";

/**
 * The excipient assessment is a paid add-on: an account without it gets a plain refusal. (Hiding the menu in the web app is only a
 * convenience; this is the check that counts.)
 */
export function requireExcipientModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(EXCIPIENT_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the excipient assessment module.");
  }
}

// The record id is the file name, so it is checked against the same pattern the record schema uses before it is used in a path.
function recordIdParam(ctx: Ctx): string {
  const v = ctx.params.id;
  if (typeof v !== "string" || !EXCIPIENT_LIBRARY_ID.test(v)) throw new HttpError(400, "invalid-id", "That saved excipient id is not valid.");
  return v;
}

const bodySchema = z.object({ record: excipientLibraryRecordSchema });
// Removing a saved excipient needs a reason; it is kept in the server's audit log with the id.
const removeSchema = z.object({ reason: z.string().trim().min(1, "Write a short reason for removing it.").max(500) });

export const excipientLibraryRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/excipient-library",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireExcipientModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "excipient-library");
      const records: unknown[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !EXCIPIENT_LIBRARY_ID.test(name.slice(0, -5))) continue;
        const r = await store.readJson<unknown>(join(folder, name), null).catch(() => null);
        const ok = excipientLibraryRecordSchema.safeParse(r);
        if (ok.success) records.push(ok.data);
      }
      sendJson(ctx.res, 200, { records });
    },
  },

  {
    // Add or replace this account's saved excipient. The web app makes the new version (and keeps the earlier content in the record's
    // history); the server stores what it is given after checking the shape.
    method: "PUT",
    path: "/api/excipient-library/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireExcipientModule(ctx);
      const id = recordIdParam(ctx);
      const body = parseBody(bodySchema, await ctx.json(MAX_LIBRARY_BODY_BYTES));
      if (body.record.id !== id) throw new HttpError(400, "invalid", "The id in the address and in the saved excipient differ.");
      const { store } = ctx.app;
      await store.withLock(`excipient-library:${ctx.user.id}`, async () => {
        await requireRoomForItem(ctx, "excipient-library", `${id}.json`, MAX_LIBRARY_ITEMS, "saved excipients");
        await store.writeJson(userPath(ctx, "excipient-library", `${id}.json`), body.record);
      });
      await store.audit("excipient-library-save", { userId: ctx.user.id, recordId: id, version: body.record.version, ip: ctx.ip });
      sendJson(ctx.res, 200, { record: body.record });
    },
  },

  {
    method: "DELETE",
    path: "/api/excipient-library/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireExcipientModule(ctx);
      const id = recordIdParam(ctx);
      const { reason } = parseBody(removeSchema, await ctx.json(4096));
      const { store } = ctx.app;
      await store.withLock(`excipient-library:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "excipient-library", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("saved excipient");
        await store.toTrash(ctx.user.id, "excipient-library", file, `${id}.json`);
      });
      await store.audit("excipient-library-delete", { userId: ctx.user.id, recordId: id, reason, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
