/// <reference types="node" />
import { connect } from "node:net";
import { readdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientIp, csrfOk, drainLimitFor, ownOrigin } from "../src/http";
import { Client, GOOD_PASSWORD, rawRequest, sampleProject, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ maxUploadMB: 1 });
});
afterAll(() => env.cleanup());

const CSP_PARTS = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

describe("security headers", () => {
  const expectHeaders = (headers: Record<string, string | string[] | undefined>) => {
    const csp = String(headers["content-security-policy"]);
    for (const part of CSP_PARTS) expect(csp).toContain(part);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  };

  it("are on API answers (with no-store), errors, and static files", async () => {
    const health = await rawRequest(env.port, { path: "/api/health" });
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true, storage: "server", version: expect.any(String) });
    expectHeaders(health.headers);
    expect(health.headers["cache-control"]).toBe("no-store");

    for (const path of ["/api/auth/me", "/api/nothing-here"]) {
      const res = await rawRequest(env.port, { path });
      expect(res.status).toBe(path === "/api/auth/me" ? 401 : 404);
      expectHeaders(res.headers);
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    const csrf = await rawRequest(env.port, { method: "POST", path: "/api/auth/login" });
    expect(csrf.status).toBe(403);
    expectHeaders(csrf.headers);

    for (const path of ["/", "/assets/app.js", "/missing.js"]) expectHeaders((await rawRequest(env.port, { path })).headers);
  });
});

describe("CSRF", () => {
  it("needs X-Gap-Request: 1 on every change, even with a valid session", async () => {
    const c = await signedInClient(env);
    const created = await c.post("/api/projects", { project: sampleProject() });
    const id = created.json.id;
    for (const [method, path] of [
      ["POST", "/api/projects"],
      ["PUT", `/api/projects/${id}`],
      ["DELETE", `/api/projects/${id}`],
      ["POST", "/api/auth/logout"],
      ["POST", "/api/auth/password"],
      ["PATCH", "/api/templates/00000000-0000-0000-0000-000000000000"],
    ] as const) {
      const res = await c.call(method, path, {}, { "X-Gap-Request": "0" });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json).toMatchObject({ error: "csrf" });
    }
    expect((await c.get(`/api/projects/${id}`)).status).toBe(200); // still there, still signed in
    expect((await c.get("/api/projects")).status).toBe(200); // GET needs no header
  });

  it("checks Origin against the request's own origin, with the scheme from X-Forwarded-Proto", async () => {
    const host = `127.0.0.1:${env.port}`;
    const login = (headers: Record<string, string>) =>
      new Client(env.port).post("/api/auth/login", { username: "nobody", password: GOOD_PASSWORD }, headers);

    expect((await login({})).status).toBe(401); // no Origin header: allowed (not a browser)
    expect((await login({ Origin: `http://${host}` })).status).toBe(401);
    expect((await login({ Origin: `HTTP://${host.toUpperCase()}` })).status).toBe(401);
    for (const origin of ["http://evil.example", "https://127.0.0.1:" + env.port, `http://${host}.evil.example`, "null", ""]) {
      const res = await login({ Origin: origin });
      expect(res.status, origin).toBe(403);
      expect(res.json.error).toBe("csrf");
    }
    // behind Tailscale serve the browser sees https while we see plain http
    expect((await login({ Origin: `https://${host}`, "X-Forwarded-Proto": "https" })).status).toBe(401);
    expect((await login({ Origin: `http://${host}`, "X-Forwarded-Proto": "https" })).status).toBe(403);
    expect((await login({ Origin: `https://${host}`, "X-Forwarded-Proto": "javascript" })).status).toBe(403);
  });

  it("does not let GET requests with a foreign Origin change anything or be blocked", async () => {
    const res = await rawRequest(env.port, { path: "/api/health", headers: { Origin: "http://evil.example" } });
    expect(res.status).toBe(200);
  });

  it("ignores X-Forwarded-Proto and X-Forwarded-For from a peer that is not this machine", () => {
    const fake = (peer: string, headers: Record<string, string>) => ({ socket: { remoteAddress: peer }, headers }) as never;
    expect(ownOrigin(fake("192.0.2.5", { host: "app.example", "x-forwarded-proto": "https" }))).toBe("http://app.example");
    expect(ownOrigin(fake("127.0.0.1", { host: "app.example", "x-forwarded-proto": "https" }))).toBe("https://app.example");
    expect(csrfOk(fake("192.0.2.5", { "x-gap-request": "1", host: "app.example", origin: "https://app.example", "x-forwarded-proto": "https" }))).toBe(false);
    expect(clientIp("192.0.2.5", "198.51.100.9")).toBe("192.0.2.5");
  });
});

describe("network binding", () => {
  it("listens on 127.0.0.1 only", async () => {
    const address = env.server.server.address();
    expect(address).toMatchObject({ address: "127.0.0.1", family: "IPv4" });

    // Not reachable through any other address of this computer.
    const others = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i!.address);
    for (const host of [...others.slice(0, 2), "::1"]) {
      const reachable = await new Promise<boolean>((resolve) => {
        const socket = connect({ host, port: env.port, timeout: 1500 });
        socket.on("connect", () => (socket.destroy(), resolve(true)));
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => (socket.destroy(), resolve(false)));
      });
      expect(reachable, host).toBe(false);
    }
  });
});

describe("body limits", () => {
  it("answers 413 for a big body on sign-in (16 KB) and for JSON over 25 MB", async () => {
    const c = await signedInClient(env);
    const small = await new Client(env.port).post("/api/auth/login", { username: "x", password: "y".repeat(20_000) });
    expect(small.status).toBe(413);
    expect(small.json.error).toBe("too-large");

    const big = await c.call("POST", "/api/projects", undefined, { "Content-Type": "application/json" }, Buffer.alloc(26 * 1024 * 1024, 32));
    expect(big.status).toBe(413);
    expect(big.json.error).toBe("too-large");
    expect((await c.get("/api/auth/me")).status).toBe(200); // the server is fine afterwards
  }, 60_000);

  it("answers 413 for an upload over maxUploadMB but accepts one exactly at the limit", async () => {
    const c = await signedInClient(env);
    const tooBig = await c.upload("big.bin", Buffer.alloc(1024 * 1024 + 1, 1));
    expect(tooBig.status).toBe(413);
    expect(tooBig.json.error).toBe("too-large");
    const ok = await c.upload("exact.bin", Buffer.alloc(1024 * 1024, 2));
    expect(ok.status).toBe(201);
  });

  it("lets a browser finish a far-too-big upload and read the 413 (the rest is read and thrown away, nothing is stored)", async () => {
    const c = await signedInClient(env);
    const total = 40 * 1024 * 1024; // 40x the 1 MB limit, and more than the old 32 MB cut-off
    const chunk = Buffer.alloc(1024 * 1024, 5);
    // A raw socket, like a browser: it keeps sending the whole body even after the answer has started to arrive.
    const outcome = await new Promise<{ reply: string; wroteAll: boolean; socketError?: string }>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: env.port });
      let reply = "";
      let wroteAll = false;
      let socketError: string | undefined;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ reply, wroteAll, ...(socketError ? { socketError } : {}) });
      };
      socket.on("data", (d: Buffer) => {
        reply += d.toString("latin1");
        if (wroteAll && /\r\n\r\n[\s\S]*\}$/.test(reply)) finish();
      });
      socket.on("error", (err) => {
        socketError = (err as NodeJS.ErrnoException).code ?? err.message;
        finish();
      });
      socket.on("close", finish);
      socket.write(
        `POST /api/files HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${total}\r\nX-Gap-Request: 1\r\nX-File-Name: huge.bin\r\nCookie: ${c.cookie}\r\n\r\n`,
      );
      void (async () => {
        for (let sent = 0; sent < total && !settled; sent += chunk.length) {
          if (!socket.write(chunk)) await new Promise((r) => socket.once("drain", r));
        }
        socket.write("", () => {
          wroteAll = true;
          if (/\r\n\r\n[\s\S]*\}$/.test(reply)) finish();
        });
      })();
    });
    expect(outcome.socketError).toBeUndefined();
    expect(outcome.wroteAll).toBe(true);
    expect(outcome.reply).toMatch(/^HTTP\/1\.1 413 /);
    const body = JSON.parse(outcome.reply.slice(outcome.reply.indexOf("\r\n\r\n") + 4));
    expect(body).toMatchObject({ error: "too-large", message: expect.stringContaining("larger than the 1 MB allowed") });
    expect((await c.get("/api/files")).json.files).toEqual([]);
    expect(await readdir(join(env.dataDir, "users", c.userId, "files")).catch(() => [])).toEqual([]);
  }, 60_000);
  it("reads and discards at least four times the limit, and never less than 64 MB", () => {
    expect(drainLimitFor(1024 * 1024)).toBe(64 * 1024 * 1024);
    expect(drainLimitFor(50 * 1024 * 1024)).toBe(200 * 1024 * 1024);
    expect(drainLimitFor(25 * 1024 * 1024)).toBe(100 * 1024 * 1024);
  });

  it("stops reading a body with no declared length as soon as it passes the limit", async () => {
    const c = await signedInClient(env);
    const chunk = Buffer.alloc(64 * 1024, 7);
    let sent = 0;
    let finished = false;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: env.port,
          method: "POST",
          path: "/api/files",
          headers: { "Transfer-Encoding": "chunked", "X-Gap-Request": "1", "X-File-Name": "endless.bin", Cookie: c.cookie },
        },
        (res) => {
          res.resume();
          finished = true;
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", (err) => (finished ? undefined : reject(err)));
      void (async () => {
        // Keep sending until the server answers; a server that buffered everything would only answer at the end.
        while (!finished && sent < 200 * 1024 * 1024) {
          sent += chunk.length;
          if (!req.write(chunk)) await new Promise((r) => req.once("drain", r));
          await new Promise((r) => setImmediate(r));
        }
        req.destroy();
      })();
    });
    expect(status).toBe(413);
    expect(sent).toBeLessThan(40 * 1024 * 1024);
  }, 60_000);
});

describe("ids", () => {
  it("are checked before the disk is touched", async () => {
    const c = await signedInClient(env);
    const bad = ["abc", "%2e%2e%2f%2e%2e%2fconfig.json", "..%5c..%5cconfig.json", "ABCDEF01-2345-6789-ABCD-EF0123456789", "0".repeat(37), "0".repeat(35), "00000000-0000-0000-0000-00000000000g"];
    for (const id of bad) {
      for (const [method, path] of [
        ["GET", `/api/projects/${id}`],
        ["PUT", `/api/projects/${id}`],
        ["DELETE", `/api/projects/${id}`],
        ["GET", `/api/templates/${id}/file`],
        ["PATCH", `/api/templates/${id}`],
        ["DELETE", `/api/templates/${id}`],
        ["GET", `/api/files/${id}`],
        ["DELETE", `/api/files/${id}`],
      ] as const) {
        const res = await c.call(method, path, {});
        expect(res.status, `${method} ${path}`).toBe(400);
        expect(res.json.error).toBe("invalid-id");
      }
    }
    // a well-formed id that does not exist is a plain 404
    const nothing = "00000000-0000-0000-0000-000000000000";
    for (const path of [`/api/projects/${nothing}`, `/api/files/${nothing}`, `/api/templates/${nothing}/file`]) {
      expect((await c.get(path)).status).toBe(404);
    }
  });

  it("are checked in filters and in the file headers too", async () => {
    const c = await signedInClient(env);
    expect((await c.get("/api/files?projectId=../x")).status).toBe(400);
    expect((await c.get("/api/files?sourceId=a/b")).status).toBe(400);
    expect((await c.upload("a.txt", Buffer.from("x"), { "X-Project-Id": "../../x" })).status).toBe(400);
    expect((await c.upload("a.txt", Buffer.from("x"), { "X-Source-Id": "has space" })).status).toBe(400);
    expect((await c.upload("a.txt", Buffer.from("x"), { "X-Source-Id": "s".repeat(81) })).status).toBe(400);
    expect((await c.upload("a.txt", Buffer.from("x"), { "X-Source-Id": "doc:SOP-001.v2_a" })).status).toBe(201);
    const noName = await c.call("POST", "/api/files", undefined, { "Content-Length": "1" }, Buffer.from("x"));
    expect(noName.status).toBe(400);
    const badName = await c.upload("a.txt", Buffer.from("x"), { "X-File-Name": "%E0%A4%A" });
    expect(badName.status).toBe(400);
  });
});

describe("static files", () => {
  it("serves index.html at / and assets, and 404s everything else", async () => {
    const index = await rawRequest(env.port, { path: "/" });
    expect(index.status).toBe(200);
    expect(index.headers["content-type"]).toContain("text/html");
    expect(index.text).toContain("<title>test</title>");
    expect((await rawRequest(env.port, { path: "/index.html" })).status).toBe(200);
    expect((await rawRequest(env.port, { method: "HEAD", path: "/" })).status).toBe(200);
    const js = await rawRequest(env.port, { path: "/assets/app.js" });
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.headers["cache-control"]).toContain("immutable");

    for (const path of ["/nope", "/assets", "/assets/", "/nope/deeper.js", "/%00", "/.hidden"]) {
      const res = await rawRequest(env.port, { path });
      expect(res.status, path).toBe(404);
      expect(res.text).not.toContain("<title>test</title>"); // no fallback to index.html
    }
    expect((await rawRequest(env.port, { method: "POST", path: "/", headers: { "X-Gap-Request": "1" } })).status).toBe(404);
  });

  it("never leaves the web folder (traversal, encoded slashes, backslashes, config.json)", async () => {
    await writeFile(join(env.webDir, "..", "data", "marker.txt"), "data marker");
    const attempts = [
      "/..%2f..%2fsecret.txt",
      "/..%2F..%2Fdata%2Fconfig.json",
      "/%2e%2e/secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/../secret.txt",
      "/../data/config.json",
      "/assets/../../secret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/..%5c..%5csecret.txt",
      "/assets\\..\\..\\secret.txt",
      "/%2e%2e%5csecret.txt",
      "//secret.txt",
      "/C:/Windows/win.ini",
      "/%c0%ae%c0%ae/secret.txt",
      "/..%00/secret.txt",
    ];
    for (const path of attempts) {
      const res = await rawRequest(env.port, { path });
      expect(res.text, path).not.toContain("outside the web folder");
      expect(res.text, path).not.toContain("maxUploadMB");
      expect(res.text, path).not.toContain("data marker");
      expect(res.status, path).not.toBe(200);
    }
  });

  it("is not served by /api paths and POST to a file is refused", async () => {
    expect((await rawRequest(env.port, { path: "/api/../index.html" })).status).toBe(200); // normalised to /index.html: still inside the web folder
    expect((await rawRequest(env.port, { path: "/api/index.html" })).status).toBe(404);
  });
});

describe("errors", () => {
  it("answers JSON errors without stack traces or paths", async () => {
    const c = await signedInClient(env);
    const bad = await c.call("POST", "/api/projects", undefined, { "Content-Type": "application/json" }, Buffer.from("{not json"));
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: "invalid", message: expect.any(String) });
    const array = await c.call("POST", "/api/projects", undefined, { "Content-Type": "application/json" }, Buffer.from("[]"));
    expect(array.status).toBe(400);

    expect((await c.call("DELETE", "/api/health")).status).toBe(405);
    expect((await c.get("/api/nope")).json.error).toBe("not-found");

    // a damaged file on disk gives a generic 500, not an exception text
    const created = await c.post("/api/projects", { project: sampleProject("Damaged") });
    const file = join(env.dataDir, "users", c.userId, "projects", `${created.json.id}.json`);
    await writeFile(file, "{ this is not json");
    const broken = await c.get(`/api/projects/${created.json.id}`);
    expect(broken.status).toBe(500);
    expect(broken.json).toEqual({ error: "server-error", message: expect.any(String) });
    expect(broken.text).not.toMatch(/\bat \w|node_modules|\.ts|\.mjs|JSON\.parse|Unexpected token|[A-Z]:\\|\/tmp\//);
    expect((await c.get("/api/auth/me")).status).toBe(200); // the server carries on
  });

  it("has no leftover temp files after writes", async () => {
    const c = await signedInClient(env);
    await c.post("/api/projects", { project: sampleProject() });
    const names = await readdir(join(env.dataDir, "users", c.userId, "projects"));
    expect(names.every((n) => n.endsWith(".json"))).toBe(true);
    expect((await readdir(env.dataDir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
