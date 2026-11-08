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

/** The most a project or a Word template may weigh when saved (pictures are the only thing that makes a project big). */
export const MAX_JSON_BYTES = 25 * 1024 * 1024;
/** Every other JSON body (library items, settings, folders...) is plain text and far smaller. */
export const MAX_SMALL_JSON_BYTES = 10 * 1024 * 1024;
/** Sign-in, sign-up and password bodies are tiny; a small cap stops anonymous callers from sending big ones. */
export const MAX_AUTH_BODY_BYTES = 16 * 1024;

// The page rules below match the meta tag of the built site (apps/web/vite.config.ts, PAGE_CSP); this header adds
// frame-ancestors, which a meta tag cannot carry. Keep the two in step.
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; " +
    "connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  // The app uses none of these browser features, so no page (or anything injected into one) can ask for them.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/* ---------- who is calling ---------- */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

/**
 * The caller's address for rate limits and the audit log. The X-Forwarded-For header is believed only when the TCP peer is this
 * machine (Tailscale serve), and then only its LAST entry: the proxy adds the address it saw at the right-hand end, while anything
 * to the left of it was sent by the caller and can be made up. From any other peer the header is ignored and the socket address is used.
 */
export function clientIp(peer: string | undefined, forwardedFor: string | undefined): string {
  if (isLoopback(peer) && forwardedFor) {
    const last = forwardedFor.split(",").pop()?.trim() ?? "";
    if (last && last.length <= 64 && /^[0-9a-fA-F:.]+$/.test(last)) return last;
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

/* ---------- how long a body may take to arrive ---------- */

const BODY_BASE_MS = 20_000;
const BODY_UNKNOWN_LENGTH_MS = 60_000;
const BODY_MAX_MS = 5 * 60_000;
/** Slowest sending speed that is still accepted for a normal request: 100 KB per second (about 0.8 Mbit/s). */
const BODY_BYTES_PER_MS = 100;
/** A file upload may take as long as the server's own ceiling (server.requestTimeout). */
export const UPLOAD_BODY_MS = 10 * 60_000;

/**
 * How long a request body may take to arrive before the connection is dropped. Sign-in, a saved project and a library item are
 * a few KB to a few MB, so they get seconds, plus time for a big body at a modest speed. Only a file upload gets minutes. Without
 * this, a caller could open many connections and send a byte now and then, holding each one for ten minutes.
 */
export function bodyTimeMs(upload: boolean, contentLength: number | undefined): number {
  if (upload) return UPLOAD_BODY_MS;
  if (contentLength === undefined || !Number.isFinite(contentLength)) return BODY_UNKNOWN_LENGTH_MS;
  return Math.min(BODY_MAX_MS, BODY_BASE_MS + Math.ceil(contentLength / BODY_BYTES_PER_MS));
}

/** Answers 408 and closes the connection if the request body has not fully arrived after `ms`. Does nothing for a request without a body. */
export function limitBodyTime(req: IncomingMessage, res: ServerResponse, ms: number): void {
  if (req.complete) return;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      sendJson(res, 408, { error: "too-slow", message: "That took too long to send, so the connection was closed. Please try again." }, { Connection: "close" });
    }
    setTimeout(() => req.socket.destroy(), 1_000).unref();
  }, ms);
  timer.unref();
  const stop = () => clearTimeout(timer);
  req.once("end", stop);
  req.once("close", stop);
  res.once("close", stop);
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
  /**
   * Whether the route stores new content on the disk. Left out, every change on a storage route (anything but a read or a
   * delete) counts. Set false on the changes that only free space (delete several, delete a folder), so a full disk can
   * always be emptied.
   */
  saves?: boolean;
  /** A file upload: the one kind of request allowed to take minutes to arrive. */
  upload?: boolean;
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
