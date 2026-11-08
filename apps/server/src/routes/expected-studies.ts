import { z } from "zod";
import { HttpError, sendJson, type Ctx, type Route } from "../http";
import { MAX_LIBRARY_BODY_BYTES } from "../limits";
import { SAMPLING_MODULE } from "./sampling-tables";
import { parseBody, userPath } from "./util";

// The account's "Expected studies" list (which catalog entries the sampling design review treats as expected) is one document per
// account: its versions with the reason for each change, and a log of removed versions with the reason. It belongs to the sampling
// module, so it is gated like the company sampling tables.
function requireSamplingModule(ctx: Ctx): void {
  if (!ctx.user.plan.modules.includes(SAMPLING_MODULE)) {
    throw new HttpError(403, "module-not-included", "This account does not include the sampling module.");
  }
}

const version = z
  .object({
    id: z.string().min(1).max(100),
    number: z.number().int().min(1),
    at: z.string().max(40),
    reason: z.string().max(2000).optional(),
    keys: z.array(z.string().max(100)).max(2000),
    catalogVersion: z.string().max(40),
    kind: z.enum(["edited", "reset"]),
  })
  .passthrough();
const removal = z.object({ at: z.string().max(40), number: z.number().int().min(1), savedAt: z.string().max(40), reason: z.string().max(2000) }).passthrough();
const bodySchema = z.object({ doc: z.object({ versions: z.array(version).max(1000), removed: z.array(removal).max(5000) }).passthrough() });

const FILE = "expected-studies.json";

export const expectedStudiesRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/expected-studies",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const doc = await ctx.app.store.readJson<unknown>(userPath(ctx, FILE), null).catch(() => null);
      sendJson(ctx.res, 200, { doc });
    },
  },

  {
    method: "PUT",
    path: "/api/expected-studies",
    auth: true,
    storage: true,
    async handler(ctx) {
      requireSamplingModule(ctx);
      const body = parseBody(bodySchema, await ctx.json(MAX_LIBRARY_BODY_BYTES));
      const { store } = ctx.app;
      await store.withLock(`expected-studies:${ctx.user.id}`, async () => {
        await store.writeJson(userPath(ctx, FILE), body.doc);
      });
      await store.audit("expected-studies-save", { userId: ctx.user.id, versions: body.doc.versions.length, removed: body.doc.removed.length, ip: ctx.ip });
      sendJson(ctx.res, 200, { doc: body.doc });
    },
  },
];
