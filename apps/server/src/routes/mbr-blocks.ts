/// <reference types="node" />
import { join } from "node:path";
import { mbrLibraryBlockSchema } from "@gap/process-model";
import { z } from "zod";
import { HttpError, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { notFound, parseBody, userPath } from "./util";

/** The module key an account needs to keep batch-record step blocks (the MBR library) on the server. */
export const MBR_MODULE = "mbr";

/**
 * The batch-record module is a paid add-on: an account without it gets a plain refusal. (Hiding the menu in the web app is only a
 * convenience; this is the check that counts.)
 */
export function requireMbrModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(MBR_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the batch record module.");
  }
}

// A block id is the readable id of the library ("filling_run"). The check keeps anything but letters, digits and underscores out of
// the file name, so the id can be used as the file name directly.
const BLOCK_ID = /^[a-z][a-z0-9_]{0,59}$/;

function blockIdParam(ctx: Ctx): string {
  const v = ctx.params.id;
  if (typeof v !== "string" || !BLOCK_ID.test(v)) throw new HttpError(400, "invalid-id", "That block id is not valid.");
  return v;
}

const bodySchema = z.object({ block: mbrLibraryBlockSchema });

export const mbrBlockRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/mbr-blocks",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireMbrModule(ctx);
      const { store } = ctx.app;
      const folder = userPath(ctx, "mbr-blocks");
      const blocks: unknown[] = [];
      for (const name of await store.list(folder)) {
        if (!name.endsWith(".json") || !BLOCK_ID.test(name.slice(0, -5))) continue;
        const b = await store.readJson<unknown>(join(folder, name), null).catch(() => null);
        const ok = mbrLibraryBlockSchema.safeParse(b);
        if (ok.success) blocks.push(ok.data);
      }
      sendJson(ctx.res, 200, { blocks });
    },
  },

  {
    // Add or replace this account's copy of a block. The web app makes the new version (and keeps the earlier content in the block's
    // history); the server stores what it is given after checking the shape.
    method: "PUT",
    path: "/api/mbr-blocks/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireMbrModule(ctx);
      const id = blockIdParam(ctx);
      const body = parseBody(bodySchema, await ctx.json());
      if (body.block.id !== id) throw new HttpError(400, "invalid", "The block id in the address and in the block differ.");
      const { store } = ctx.app;
      await store.withLock(`mbr-blocks:${ctx.user.id}`, async () => {
        await store.writeJson(userPath(ctx, "mbr-blocks", `${id}.json`), body.block);
      });
      await store.audit("mbr-block-save", { userId: ctx.user.id, blockId: id, ip: ctx.ip });
      sendJson(ctx.res, 200, { block: body.block });
    },
  },

  {
    method: "DELETE",
    path: "/api/mbr-blocks/:id",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireMbrModule(ctx);
      const id = blockIdParam(ctx);
      const { store } = ctx.app;
      await store.withLock(`mbr-blocks:${ctx.user.id}`, async () => {
        const file = userPath(ctx, "mbr-blocks", `${id}.json`);
        if (!(await store.exists(file))) throw notFound("block");
        await store.toTrash(ctx.user.id, "mbr-blocks", file, `${id}.json`);
      });
      await store.audit("mbr-block-delete", { userId: ctx.user.id, blockId: id, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
