/// <reference types="node" />
import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import {
  PRODUCTION_SCRYPT,
  RateLimiter,
  findSession,
  hashPassword,
  purgeExpiredSessions,
  readCookie,
  SESSION_COOKIE,
  type ScryptParams,
} from "./auth";
import { ConfigError, loadConfig, type ServerConfig } from "./config";
import {
  HttpError,
  MAX_JSON_BYTES,
  SECURITY_HEADERS,
  clientIp,
  csrfOk,
  matchRoute,
  readBody,
  readJsonBody,
  sendError,
  type Ctx,
  type Route,
} from "./http";
import { authRoutes } from "./routes/auth";
import { fileRoutes } from "./routes/files";
import { myFilesRoutes } from "./routes/myfiles";
import { projectRoutes } from "./routes/projects";
import { mbrBlockRoutes } from "./routes/mbr-blocks";
import { trdWriteupRoutes } from "./routes/trd-writeups";
import { riskMethodRoutes } from "./routes/risk-methods";
import { savedAnswerRoutes } from "./routes/saved-answers";
import { samplingTableRoutes } from "./routes/sampling-tables";
import { subsectionRoutes } from "./routes/subsections";
import { templateRoutes } from "./routes/templates";
import { sweepExpired } from "./myfiles";
import { serveStatic } from "./static";
import { Store } from "./store";

export interface ServerOptions {
  dataDir: string;
  /** Folder of the web build to serve; without it only /api answers. */
  webDir?: string;
  port: number;
  /** Test-only: cheaper scrypt so the tests stay fast. Leave unset in real use (production parameters). */
  scrypt?: ScryptParams;
}

/** Everything the route handlers share. */
export interface App {
  store: Store;
  config: ServerConfig;
  scrypt: ScryptParams;
  /** A real hash of a random password: unknown user names are checked against it so the timing looks the same. */
  dummyHash: string;
  loginByUser: RateLimiter;
  loginByIp: RateLimiter;
  signupByIp: RateLimiter;
  /** "My files" limits, counted per account: uploads per hour, other changes and reads per minute. */
  myFilesUploads: RateLimiter;
  myFilesChanges: RateLimiter;
  myFilesReads: RateLimiter;
  /** Bytes of uploads that are arriving right now, per account, so the quota holds when uploads overlap. */
  myFilesReserved: Map<string, number>;
}

export interface RunningServer {
  server: Server;
  port: number;
  app: App;
  close(): Promise<void>;
}

const routes: Route[] = [...authRoutes, ...projectRoutes, ...templateRoutes, ...samplingTableRoutes, ...riskMethodRoutes, ...savedAnswerRoutes, ...mbrBlockRoutes, ...trdWriteupRoutes, ...subsectionRoutes, ...fileRoutes, ...myFilesRoutes];
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const WINDOW_15_MIN = 15 * 60 * 1000;

async function openApp(options: ServerOptions): Promise<App> {
  const dir = resolve(options.dataDir);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new ConfigError(`The data folder does not exist: ${dir}`);
  const config = await loadConfig(dir);
  const scrypt = options.scrypt ?? PRODUCTION_SCRYPT;
  await mkdir(resolve(dir, "users"), { recursive: true });
  return {
    store: new Store(dir),
    config,
    scrypt,
    dummyHash: await hashPassword(randomBytes(24).toString("base64"), scrypt),
    loginByUser: new RateLimiter(5, WINDOW_15_MIN),
    loginByIp: new RateLimiter(20, WINDOW_15_MIN),
    signupByIp: new RateLimiter(10, HOUR_MS),
    myFilesUploads: new RateLimiter(2000, HOUR_MS),
    myFilesChanges: new RateLimiter(300, MINUTE_MS),
    myFilesReads: new RateLimiter(1500, MINUTE_MS),
    myFilesReserved: new Map(),
  };
}

async function handle(app: App, webDir: string | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  let url: URL;
  try {
    // Prefixing the host ourselves keeps "//name" from being read as a host name; only origin-form paths are accepted.
    if (!req.url?.startsWith("/")) throw new Error("not a path");
    url = new URL(`http://localhost${req.url}`);
  } catch {
    throw new HttpError(400, "invalid", "That address is not valid.");
  }
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  if (pathname !== "/api" && !pathname.startsWith("/api/")) {
    if (webDir && (await serveStatic(webDir, req, res, pathname))) return;
    throw new HttpError(404, "not-found", "Not found.");
  }

  res.setHeader("Cache-Control", "no-store");
  if (method !== "GET" && method !== "HEAD" && !csrfOk(req)) {
    throw new HttpError(403, "csrf", "This request was blocked because it did not come from the app.");
  }

  const matched = matchRoute(routes, method, pathname);
  if (matched === null) throw new HttpError(404, "not-found", "Not found.");
  if (matched === "method-mismatch") throw new HttpError(405, "method-not-allowed", "That method is not allowed here.");
  const { route, params } = matched;

  const ctx = {
    req,
    res,
    url,
    params,
    app,
    ip: clientIp(req.socket.remoteAddress, headerValue(req.headers["x-forwarded-for"])),
    json: (limit = MAX_JSON_BYTES) => readJsonBody(req, limit),
    raw: (limit: number) => readBody(req, limit),
  } as Ctx;

  if (route.auth) {
    const found = await findSession(app.store, readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!found) throw new HttpError(401, "signed-out", "You are signed out. Please sign in.");
    ctx.user = found.user;
    ctx.sessionHash = found.session.tokenHash;
  }
  if (route.storage && app.config.storage === "client") {
    throw new HttpError(403, "client-storage", "This server keeps only accounts. Projects and documents stay in your browser.");
  }
  await route.handler(ctx);
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Starts the HTTP server on 127.0.0.1 only. Rejects with ConfigError when the data folder is not ready. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  let webDir: string | undefined;
  if (options.webDir) {
    webDir = resolve(options.webDir);
    if (!(await stat(webDir).catch(() => null))?.isDirectory()) throw new ConfigError(`The web folder does not exist: ${webDir}`);
  }
  const app = await openApp(options);
  await purgeExpiredSessions(app.store);
  const purgeTimer = setInterval(() => void purgeExpiredSessions(app.store).catch(() => undefined), HOUR_MS);
  purgeTimer.unref();

  // "My files" auto-delete: once at start (files that expired while the server was off) and then every hour.
  const sweep = async () => {
    const { deleted } = await sweepExpired(app.store);
    if (deleted > 0) console.log(`My files: deleted ${deleted} expired file${deleted === 1 ? "" : "s"}.`);
  };
  await sweep().catch(() => console.error("My files sweep failed"));
  const sweepTimer = setInterval(() => void sweep().catch(() => console.error("My files sweep failed")), HOUR_MS);
  sweepTimer.unref();

  const server = createServer((req, res) => {
    handle(app, webDir, req, res).catch((err) => sendError(res, err));
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 10 * 60_000;
  server.keepAliveTimeout = 5_000;

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    // 127.0.0.1 only: the public side is Tailscale serve/funnel, which proxies to this port.
    server.listen(options.port, "127.0.0.1", () => resolveListen());
  });
  return {
    server,
    app,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(purgeTimer);
        clearInterval(sweepTimer);
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
