/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from "node:http";
import type { App } from "./app";
import type { UserRecord } from "./types";

/** An error whose text is safe to show to the user. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** For a 413: how much more of the upload may be read and thrown away before the connection is cut. */
  drainLimit?: number;
}

export const MAX_JSON_BYTES = 25 * 1024 * 1024;
/** Sign-in, sign-up and password bodies are tiny; a small cap stops anonymous callers from sending big ones. */
export const MAX_AUTH_BODY_BYTES = 16 * 1024;

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
};

/* ---------- who is calling ---------- */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

/**
 * The caller's address for rate limits. The X-Forwarded-For header is believed only when the TCP peer is this
 * machine (Tailscale serve); from anywhere else a caller could forge it.
 */
export function clientIp(peer: string | undefined, forwardedFor: string | undefined): string {
  if (isLoopback(peer) && forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim() ?? "";
    if (first && first.length <= 64 && /^[0-9a-fA-F:.]+$/.test(first)) return first;
  }
  return peer ?? "unknown";
}

/** The origin the browser used to reach us, for the CSRF check. */
export function ownOrigin(req: IncomingMessage): string {
  let proto = "encrypted" in req.socket ? "https" : "http";
  if (isLoopback(req.socket.remoteAddress)) {
    const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim().toLowerCase();
    if (forwarded === "http" || forwarded === "https") proto = forwarded;
  }
  return `${proto}://${String(req.headers.host ?? "").toLowerCase()}`;
}

/** Every change through /api needs the custom header (a cross-site form cannot send it) and a matching Origin. */
export function csrfOk(req: IncomingMessage): boolean {
  if (req.headers["x-gap-request"] !== "1") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return typeof origin === "string" && origin.toLowerCase() === ownOrigin(req);
}

/* ---------- responses ---------- */

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendNoContent(res: ServerResponse, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(204, headers);
  res.end();
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (err.status === 429 && typeof err.extra.retryAfterSeconds === "number") headers["Retry-After"] = String(err.extra.retryAfterSeconds);
    sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, headers);
    if (err.status === 413) endUpload(res, err.drainLimit ?? MIN_DRAIN_LIMIT);
    return;
  }
  // Only the kind of failure goes to the log; the browser gets nothing but a generic message.
  console.error("Unexpected error:", err instanceof Error ? err.name : typeof err);
  sendJson(res, 500, { error: "server-error", message: "Something went wrong on the server. Please try again." });
}

const MIN_DRAIN_LIMIT = 64 * 1024 * 1024;
const DRAIN_IDLE_MS = 30_000;

/** How much of an over-limit body is read and discarded: four times the limit, but never less than 64 MB. */
export function drainLimitFor(limit: number): number {
  return Math.max(4 * limit, MIN_DRAIN_LIMIT);
}

/**
 * After a 413 the rest of the upload is thrown away (never stored). It is read and discarded so the browser is not
 * reset before it can read the answer. A sender that stops sending for 30 seconds, or that keeps going past
 * `drainLimit` bytes, is cut off.
 */
function endUpload(res: ServerResponse, drainLimit: number): void {
  const req = res.req;
  let drained = 0;
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => req.socket.destroy(), DRAIN_IDLE_MS);
    timer.unref();
  };
  req.on("data", (chunk: Buffer) => {
    drained += chunk.length;
    if (drained > drainLimit) req.socket.destroy();
    else arm();
  });
  req.on("close", () => {
    if (timer) clearTimeout(timer);
  });
  req.on("error", () => undefined);
  arm();
  req.resume();
}

/* ---------- reading bodies ---------- */

/** Reads the body, giving up as soon as it goes over `limit` (never holds more than limit + one chunk). */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const tooBig = () => {
    const err = new HttpError(413, "too-large", `That is larger than the ${formatBytes(limit)} allowed.`);
    err.drainLimit = drainLimitFor(limit);
    return err;
  };
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooBig());

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      fn();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        req.pause();
        finish(() => reject(tooBig()));
      } else chunks.push(chunk);
    };
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks, size)));
    const onError = () => finish(() => reject(new HttpError(400, "invalid", "The request could not be read.")));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const bytes = await readBody(req, limit);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid", "The request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${Math.round((n / 1024 / 1024) * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ---------- routing ---------- */

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  app: App;
  /** Set on routes with `auth: true`. */
  user: UserRecord;
  /** Hash of the caller's session token (to tell this session from the user's other ones). */
  sessionHash: string;
  json(limit?: number): Promise<Record<string, unknown>>;
  raw(limit: number): Promise<Buffer>;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Needs a signed-in user. */
  auth?: boolean;
  /** Answers 403 `client-storage` when the server is configured with storage "client". */
  storage?: boolean;
  handler(ctx: Ctx): Promise<void>;
}

export interface Matched {
  route: Route;
  params: Record<string, string>;
}

/** Finds the route for a method and path; `methodMismatch` tells the caller to answer 405 instead of 404. */
export function matchRoute(routes: Route[], method: string, pathname: string): Matched | "method-mismatch" | null {
  const segments = pathname.split("/");
  let pathMatched = false;
  for (const route of routes) {
    const pattern = route.path.split("/");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i] ?? "";
      const s = segments[i] ?? "";
      if (p.startsWith(":")) {
        if (!s) ok = false;
        else {
          try {
            params[p.slice(1)] = decodeURIComponent(s);
          } catch {
            ok = false;
          }
        }
      } else if (p !== s) ok = false;
      if (!ok) break;
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method || (method === "HEAD" && route.method === "GET")) return { route, params };
  }
  return pathMatched ? "method-mismatch" : null;
}
