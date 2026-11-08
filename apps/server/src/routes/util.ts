import { z } from "zod";
import { HttpError, type Ctx } from "../http";
import { isId } from "../names";

/** Checks a request body against a schema; the answer names the first problem in plain words. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const res = schema.safeParse(body);
  if (res.success) return res.data;
  const issue = res.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  throw new HttpError(400, "invalid", `${issue?.message ?? "The request is not valid."}${where}`);
}

/** The id from the URL, checked before it is used in any path. */
export function idParam(ctx: Ctx, name = "id"): string {
  const value = ctx.params[name];
  if (!isId(value)) throw new HttpError(400, "invalid-id", "That id is not valid.");
  return value;
}

/** This user's folder inside the data folder. The id came from users.json, but is checked anyway. */
export function userPath(ctx: Ctx, ...parts: string[]): string {
  if (!isId(ctx.user.id)) throw new HttpError(500, "server-error", "Something went wrong on the server. Please try again.");
  return ctx.app.store.path("users", ctx.user.id, ...parts);
}

/**
 * The "I last saw this one" stamp a browser sends with a save of a library item (saved answer set, company table, subsection, risk method).
 * It is the item's own `updatedAt` as the browser last read or saved it. Optional, so an older web app still works.
 */
export const baseUpdatedAtSchema = z.string().max(60).optional();

/**
 * Refuses a save of a library item that was changed since the browser read it (another tab or computer saved first), so the later save cannot
 * silently replace the earlier one (CR-10). The answer is 409 `conflict`, like a project. Projects use a revision number; these items already
 * carry an `updatedAt` that changes on every save, so that is what is compared and no new stored field is needed. A save without a stamp is
 * accepted as before. Call it inside `store.update`, where the read, the compare and the write are one step.
 */
export function assertNotChanged(current: Record<string, unknown>, base: string | undefined, what: string): void {
  if (base === undefined) return;
  const stored = typeof current.updatedAt === "string" ? current.updatedAt : undefined;
  if (stored === base) return;
  throw new HttpError(409, "conflict", `This ${what} was changed somewhere else, so your change was not saved.`, stored ? { updatedAt: stored } : {});
}

export function notFound(what: string): HttpError {
  return new HttpError(404, "not-found", `That ${what} was not found.`);
}
