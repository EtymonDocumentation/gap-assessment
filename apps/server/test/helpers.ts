/// <reference types="node" />
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProject, type Project } from "@gap/process-model";
import { vi } from "vitest";
import { startServer, type RunningServer } from "../src/app";
import { runAdmin } from "../src/admin-commands";

// Real disk and real sockets: on a busy machine (all test files run in parallel) 5 s is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Cheap scrypt for tests only; one test checks that the default is the production setting. */
export const FAST_SCRYPT = { N: 1024, r: 8, p: 1 };
export const GOOD_PASSWORD = "correct horse battery";

export interface TestEnv {
  root: string;
  dataDir: string;
  webDir: string;
  server: RunningServer;
  port: number;
  cleanup(): Promise<void>;
}

export async function admin(dataDir: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAdmin([...args, "--data", dataDir], { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

export async function initData(dataDir: string, storage: "server" | "client" = "server", maxUploadMB = 1): Promise<void> {
  const res = await admin(dataDir, "init", "--storage", storage, "--max-upload-mb", String(maxUploadMB));
  if (res.code !== 0) throw new Error(`init failed: ${res.err}`);
}

/** A temp folder with <root>/data (initialised), <root>/web (a tiny site) and a running server on a free port. */
export async function startEnv(opts: { storage?: "server" | "client"; maxUploadMB?: number; productionScrypt?: boolean } = {}): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "gap-server-test-"));
  const dataDir = join(root, "data");
  const webDir = join(root, "web");
  await mkdir(join(webDir, "assets"), { recursive: true });
  await writeFile(join(webDir, "index.html"), "<!doctype html><title>test</title>");
  await writeFile(join(webDir, "assets", "app.js"), "console.log(1)");
  await writeFile(join(root, "secret.txt"), "outside the web folder");
  await initData(dataDir, opts.storage ?? "server", opts.maxUploadMB ?? 1);
  const server = await startServer({
    dataDir,
    webDir,
    port: 0,
    ...(opts.productionScrypt ? {} : { scrypt: FAST_SCRYPT }),
  });
  return {
    root,
    dataDir,
    webDir,
    server,
    port: server.port,
    cleanup: async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
  json: any;
}

export interface RequestOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: Buffer | string | Uint8Array;
}

/** Plain node:http request, so headers such as Origin, Host and X-Forwarded-For can be set freely. */
export function rawRequest(port: number, opts: RequestOptions): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const text = body.toString("utf8");
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text, json });
      });
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

let ipCounter = 0;

/** A browser stand-in: keeps its cookie and calls itself from its own made-up address (X-Forwarded-For). */
export class Client {
  cookie = "";
  readonly ip = `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.7`;

  constructor(readonly port: number) {}

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, raw?: Buffer): Promise<Reply> {
    const headers: Record<string, string> = { "X-Forwarded-For": this.ip, ...extra };
    if (method !== "GET" && !("X-Gap-Request" in extra) && !("x-gap-request" in extra)) headers["X-Gap-Request"] = "1";
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: Buffer | undefined = raw;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }
    const reply = await rawRequest(this.port, { method, path, headers, ...(payload ? { body: payload } : {}) });
    const set = reply.headers["set-cookie"];
    const line = Array.isArray(set) ? set.find((c) => c.startsWith("gap_session=")) : undefined;
    if (line) {
      const value = line.split(";")[0] ?? "";
      this.cookie = value === "gap_session=" ? "" : value;
    }
    return reply;
  }

  get(path: string, extra?: Record<string, string>) {
    return this.call("GET", path, undefined, extra);
  }
  post(path: string, body?: unknown, extra?: Record<string, string>) {
    return this.call("POST", path, body, extra);
  }
  put(path: string, body?: unknown) {
    return this.call("PUT", path, body);
  }
  patch(path: string, body?: unknown) {
    return this.call("PATCH", path, body);
  }
  del(path: string) {
    return this.call("DELETE", path);
  }

  /** Raw upload to /api/files. */
  upload(name: string, bytes: Buffer, extra: Record<string, string> = {}) {
    return this.call(
      "POST",
      "/api/files",
      undefined,
      { "X-File-Name": encodeURIComponent(name), "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), ...extra },
      bytes,
    );
  }

  /** Raw upload to "My files" (one file per request; the folder is the path the file should land in). */
  uploadMy(name: string, bytes: Buffer, opts: { folder?: string; type?: string; headers?: Record<string, string> } = {}) {
    return this.call(
      "POST",
      "/api/myfiles/upload",
      undefined,
      {
        "X-File-Name": encodeURIComponent(name),
        ...(opts.folder !== undefined ? { "X-Folder": encodeURIComponent(opts.folder) } : {}),
        "Content-Type": opts.type ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        ...opts.headers,
      },
      bytes,
    );
  }
}

export async function newInvite(dataDir: string, ...extra: string[]): Promise<string> {
  const res = await admin(dataDir, "invite", ...extra);
  const code = /: ([A-Z0-9]{5}(?:-[A-Z0-9]{5}){3})/.exec(res.out)?.[1];
  if (res.code !== 0 || !code) throw new Error(`invite failed: ${res.err} ${res.out}`);
  return code;
}

let userCounter = 0;

/** Creates an account through the real signup route and returns a signed-in client. */
export async function signedInClient(env: TestEnv, name = `user${++userCounter}x${Date.now() % 100000}`): Promise<Client & { username: string; userId: string }> {
  const client = new Client(env.port) as Client & { username: string; userId: string };
  const reply = await client.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir),
    username: name,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  if (reply.status !== 201) throw new Error(`signup failed: ${reply.text}`);
  client.username = name.toLowerCase();
  client.userId = reply.json.user.id;
  return client;
}

export function sampleProject(title = "Test project"): Project {
  return emptyProject({
    title,
    actor: { name: "Test Person", at: "2026-01-01T00:00:00.000Z" },
    contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" },
  });
}
