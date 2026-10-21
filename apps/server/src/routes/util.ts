import type { z } from "zod";
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

export function notFound(what: string): HttpError {
  return new HttpError(404, "not-found", `That ${what} was not found.`);
}
