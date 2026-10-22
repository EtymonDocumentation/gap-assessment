/// <reference types="node" />
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepExpired } from "../src/myfiles";
import { cleanLabel, safeName } from "../src/names";
import { sniffImage, storedContentType, summariseAgent, parseFolderPath } from "../src/myfiles";
import { admin, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ maxUploadMB: 20 });
});
afterAll(() => env.cleanup());

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

/** Every file under a folder, as relative paths with forward slashes. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1).replace(/\\/g, "/"));
  }
  return out;
}

describe("names and types (unit)", () => {
  it("cleans labels: no separators, no control or direction characters, never . or ..", () => {
    expect(cleanLabel("../../evil.txt")).toBe(".._.._evil.txt");
    expect(cleanLabel("a\\b/c")).toBe("a_b_c");
    expect(cleanLabel("evil‮fdp.exe")).toBe("evil_fdp.exe");
    expect(cleanLabel("tab\there\u0000")).toBe("tab_here_");
    expect(cleanLabel("..")).toBeNull();
    expect(cleanLabel(".")).toBeNull();
    expect(cleanLabel("   ")).toBeNull();
    expect(cleanLabel(42)).toBeNull();
    const long = cleanLabel(`${"x".repeat(500)}.png`) as string;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(".png")).toBe(true);
  });

  it("makes disk names safe on Windows: reserved names, trailing dots and spaces, length", () => {
    expect(safeName("CON.txt")).toBe("_CON.txt");
    expect(safeName("nul")).toBe("_nul");
    expect(safeName("report.pdf. . ")).toBe("report.pdf");
    expect(safeName("a:b*c?.txt")).toBe("a_b_c_.txt");
    expect(safeName("x".repeat(400) + ".bin").length).toBeLessThanOrEqual(120);
  });

  it("parses folder paths: strict depth, no dot segments", () => {
    expect(parseFolderPath("")).toBe("");
    expect(parseFolderPath("a/b/c")).toBe("a/b/c");
    expect(parseFolderPath("a\\b")).toBe("a/b");
    expect(parseFolderPath("a/../b")).toBeNull();
    expect(parseFolderPath("a/b/c/d/e/f/g/h/i")).toBeNull();
    expect(parseFolderPath("a/b/c/d/e/f/g/h")).toBe("a/b/c/d/e/f/g/h");
  });

  it("trusts the first bytes, not the claimed type, for images", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(storedContentType("image/png", Buffer.from("<html>"))).toBe("application/octet-stream");
    expect(storedContentType("image/svg+xml", Buffer.from("<svg>"))).toBe("application/octet-stream");
    expect(storedContentType("text/html", Buffer.from("<html>"))).toBe("application/octet-stream");
    expect(storedContentType("application/pdf", Buffer.from("%PDF"))).toBe("application/pdf");
    expect(storedContentType("application/octet-stream", PNG)).toBe("image/png");
  });

  it("summarises a user agent in a few words", () => {
    expect(summariseAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("Chrome on Windows");
    expect(summariseAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/121.0")).toBe("Firefox on macOS");
    expect(summariseAgent(undefined)).toBe("Unknown browser");
  });
});

describe("upload, list, download", () => {
  it("stores a real file under files/<account>/<id>/ and gives the same bytes back as an attachment", async () => {
    const c = await signedInClient(env);
    const bytes = randomBytes(5000);
    const up = await c.uploadMy("My report (final).pdf", bytes, { type: "application/pdf", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537" } });
    expect(up.status).toBe(201);
    const f = up.json.file;
    expect(f).toMatchObject({ name: "My report (final).pdf", folder: "", size: 5000, sha256: sha(bytes), contentType: "application/pdf", uploadedFrom: "Chrome on Windows", previewable: false });
    expect(f.diskName).toBeUndefined();
    expect(f.expiresAt).toBeUndefined();

    // a real, openable file on disk, named by id, with its own name under it
    expect(await walk(join(env.dataDir, "files", c.userId))).toContain(`${f.id}/My report (final).pdf`);
    expect(await readFile(join(env.dataDir, "files", c.userId, f.id, "My report (final).pdf"))).toEqual(bytes);

    const dl = await c.get(`/api/myfiles/files/${f.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body).toEqual(bytes);
    expect(String(dl.headers["content-disposition"])).toMatch(/^attachment; filename="My report \(final\)\.pdf"; filename\*=UTF-8''My%20report%20%28final%29\.pdf$/);
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers["content-length"]).toBe("5000");

    const list = await c.get("/api/myfiles");
    expect(list.json.files.map((x: { id: string }) => x.id)).toEqual([f.id]);
    expect(list.json.usage).toEqual({ usedBytes: 5000, quotaBytes: null, fileCount: 1 });
    expect(list.json.settings).toEqual({ autoDeleteDays: null });
    expect(list.json.maxFileBytes).toBe(20 * 1024 * 1024);
  });

  it("never serves uploaded HTML or SVG as a page: attachment, opaque type, nosniff", async () => {
    const c = await signedInClient(env);
    const html = await c.uploadMy("page.html", Buffer.from("<script>alert(1)</script>"), { type: "text/html" });
    const svg = await c.uploadMy("pic.svg", Buffer.from("<svg onload=alert(1)/>"), { type: "image/svg+xml" });
    for (const r of [html, svg]) {
      expect(r.json.file.contentType).toBe("application/octet-stream");
      expect(r.json.file.previewable).toBe(false);
      const dl = await c.get(`/api/myfiles/files/${r.json.file.id}/download`);
      expect(String(dl.headers["content-disposition"])).toMatch(/^attachment;/);
      expect(dl.headers["content-type"]).toBe("application/octet-stream");
      expect(dl.headers["x-content-type-options"]).toBe("nosniff");
      expect((await c.get(`/api/myfiles/files/${r.json.file.id}/preview`)).status).toBe(404);
    }
  });

  it("previews only real png, jpeg and webp, inline, locked down", async () => {
    const c = await signedInClient(env);
    const good = await c.uploadMy("shot.png", PNG, { type: "image/png" });
    expect(good.json.file).toMatchObject({ contentType: "image/png", previewable: true });
    const prev = await c.get(`/api/myfiles/files/${good.json.file.id}/preview`);
    expect(prev.status).toBe(200);
    expect(prev.headers["content-type"]).toBe("image/png");
    expect(String(prev.headers["content-disposition"])).toMatch(/^inline;/);
    expect(prev.headers["x-content-type-options"]).toBe("nosniff");
    expect(prev.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    // claims to be a png but is not: no preview, stored as opaque
    const fake = await c.uploadMy("fake.png", Buffer.from("<html>not an image</html>"), { type: "image/png" });
    expect(fake.json.file).toMatchObject({ contentType: "application/octet-stream", previewable: false });
    expect((await c.get(`/api/myfiles/files/${fake.json.file.id}/preview`)).status).toBe(404);
  });

  it("gives a second file with the same name a numbered name", async () => {
    const c = await signedInClient(env);
    await c.uploadMy("photo.png", PNG);
    const again = await c.uploadMy("photo.png", PNG);
    expect(again.json.file.name).toBe("photo (2).png");
    expect((await c.uploadMy("photo.png", PNG)).json.file.name).toBe("photo (3).png");
  });

  it("accepts an empty file and a file name with non-ASCII letters", async () => {
    const c = await signedInClient(env);
    const empty = await c.uploadMy("leer.txt", Buffer.alloc(0));
    expect(empty.status).toBe(201);
    expect(empty.json.file.size).toBe(0);
    const u = await c.uploadMy("Übersicht €.txt", Buffer.from("x"));
    const dl = await c.get(`/api/myfiles/files/${u.json.file.id}/download`);
    expect(String(dl.headers["content-disposition"])).toContain("filename*=UTF-8''%C3%9Cbersicht%20%E2%82%AC.txt");
    expect(String(dl.headers["content-disposition"])).toContain('filename="_bersicht _.txt"');
  });
});

describe("path traversal and name sanitising", () => {
  it("keeps hostile file names inside the account folder", async () => {
    const c = await signedInClient(env);
    const names = ["../../../escape.txt", "..\\..\\escape2.txt", "CON.txt", "nul", "a:b*c?.txt", "trailing.dots...", "  spaced  ", "x".repeat(600) + ".bin", "meta.json", "..", "."];
    for (const n of names) {
      const r = await c.uploadMy(n, Buffer.from("x"));
      if (n === ".." || n === ".") expect(r.status).toBe(400);
      else expect(r.status, n).toBe(201);
    }
    const files = await walk(env.dataDir);
    const mine = files.filter((f) => f.startsWith(`files/${c.userId}/`));
    for (const f of mine.filter((x) => !x.endsWith("index.json"))) {
      const parts = f.split("/");
      expect(parts).toHaveLength(4); // files / account / id / name: never deeper, never shallower
      expect(parts[3]).not.toMatch(/[<>:"|?*\\]/);
      expect(parts[3]!.length).toBeLessThanOrEqual(120);
    }
    // the separators became underscores: the name stays one path part, inside the blob folder
    expect(mine).toContainEqual(expect.stringMatching(/^files\/[^/]+\/[^/]+\/[^/]*escape\.txt$/));
    expect(files.filter((f) => !f.startsWith("files/"))).not.toContainEqual(expect.stringContaining("escape"));
    expect((await stat(join(env.root, "escape.txt")).catch(() => null))).toBeNull();
  });

  it("refuses folder paths with dot segments or too many levels, and a bad file name header", async () => {
    const c = await signedInClient(env);
    expect((await c.uploadMy("a.txt", Buffer.from("x"), { folder: "a/../b" })).status).toBe(400);
    expect((await c.uploadMy("a.txt", Buffer.from("x"), { folder: "1/2/3/4/5/6/7/8/9" })).status).toBe(400);
    expect((await c.uploadMy("a.txt", Buffer.from("x"), { folder: "1/2/3/4/5/6/7/8" })).status).toBe(201);
    expect((await c.call("POST", "/api/myfiles/upload", undefined, { "X-File-Name": "%E0%A4%A", "Content-Length": "1" }, Buffer.from("x"))).status).toBe(400);
    expect((await c.call("POST", "/api/myfiles/upload", undefined, { "Content-Length": "1" }, Buffer.from("x"))).status).toBe(400);
    expect((await c.post("/api/myfiles/folders", { name: ".." })).status).toBe(400);
    expect((await c.post("/api/myfiles/folders", { parent: "../..", name: "x" })).status).toBe(400);
    expect((await c.get("/api/myfiles?folder=..%2F..")).status).toBe(400);
  });

  it("rejects ids that are not ids before touching the disk", async () => {
    const c = await signedInClient(env);
    for (const bad of ["..", "..%2F..%2Fusers.json", "x", "12345678-1234-1234-1234-12345678901g"]) {
      expect((await c.get(`/api/myfiles/files/${bad}/download`)).status).toBe(bad === ".." ? 404 : 400);
      expect((await c.del(`/api/myfiles/files/${bad}`)).status).toBe(bad === ".." ? 404 : 400);
    }
    expect((await c.post("/api/myfiles/bulk", { action: "delete", ids: ["../x"] })).status).toBe(400);
  });
});

describe("limits", () => {
  it("answers 413 for a file over the per-file limit, with the body drained and nothing stored", async () => {
    const small = await startEnv({ maxUploadMB: 1 });
    try {
      const c = await signedInClient(small);
      const big = randomBytes(3 * 1024 * 1024);
      const r = await c.uploadMy("big.bin", big);
      expect(r.status).toBe(413);
      expect(r.json.error).toBe("too-large");
      expect(r.json.message).toContain("1 MB");
      expect((await c.get("/api/myfiles")).json.files).toEqual([]);
      expect(await walk(join(small.dataDir, "files", c.userId))).toEqual([]);
    } finally {
      await small.cleanup();
    }
  });

  it("stops a chunked upload (no Content-Length) at the limit while it streams, and removes the part file", async () => {
    const small = await startEnv({ maxUploadMB: 1 });
    try {
      const c = await signedInClient(small);
      const r = await c.call("POST", "/api/myfiles/upload", undefined, { "X-File-Name": "chunked.bin", "Content-Type": "application/octet-stream" }, randomBytes(2 * 1024 * 1024));
      expect(r.status).toBe(413);
      expect(await walk(join(small.dataDir, "files", c.userId))).toEqual([]);
    } finally {
      await small.cleanup();
    }
  });

  it("streams a file of several MB to disk and verifies its checksum", async () => {
    const c = await signedInClient(env);
    const bytes = randomBytes(12 * 1024 * 1024);
    const r = await c.uploadMy("large.bin", bytes);
    expect(r.status).toBe(201);
    expect(r.json.file.size).toBe(bytes.length);
    expect(r.json.file.sha256).toBe(sha(bytes));
    const back = await c.get(`/api/myfiles/files/${r.json.file.id}/download`);
    expect(sha(back.body)).toBe(sha(bytes));
    expect(await readdir(join(env.dataDir, "files", c.userId, ".incoming"))).toEqual([]);
  });

  it("removes the half-written file when the connection drops mid-upload", async () => {
    const c = await signedInClient(env);
    await new Promise<void>((done, fail) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: env.port,
          method: "POST",
          path: "/api/myfiles/upload",
          headers: { "X-Gap-Request": "1", "X-File-Name": "abort.bin", "Content-Length": String(5 * 1024 * 1024), Cookie: c.cookie },
        },
        () => undefined,
      );
      req.on("error", () => done());
      req.write(randomBytes(512 * 1024), () => setTimeout(() => req.destroy(), 100));
      setTimeout(() => fail(new Error("not closed")), 5000).unref();
    });
    // wait for the server to notice
    for (let i = 0; i < 50; i++) {
      if ((await readdir(join(env.dataDir, "files", c.userId, ".incoming")).catch(() => ["x"])).length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await readdir(join(env.dataDir, "files", c.userId, ".incoming"))).toEqual([]);
    expect((await c.get("/api/myfiles")).json.files).toEqual([]);
  });

  it("enforces the account quota on the server, shows it, and has no default", async () => {
    const c = await signedInClient(env);
    // no quota set: no limit but the per-file one
    expect((await c.get("/api/myfiles")).json.usage.quotaBytes).toBeNull();
    const usage = await admin(env.dataDir, "files-usage");
    expect(usage.out).toContain(`${c.username}  0 files  0.0 MB  (no quota set)`);

    expect((await admin(env.dataDir, "set-files-quota", c.username, "1")).code).toBe(0);
    expect((await c.get("/api/myfiles")).json.usage.quotaBytes).toBe(1024 * 1024);
    const first = await c.uploadMy("a.bin", randomBytes(700 * 1024));
    expect(first.status).toBe(201);
    const second = await c.uploadMy("b.bin", randomBytes(700 * 1024));
    expect(second.status).toBe(413);
    expect(second.json.error).toBe("quota-exceeded");
    expect((await c.get("/api/myfiles")).json.files).toHaveLength(1);
    // chunked (size unknown up front) is stopped while streaming
    const chunked = await c.call("POST", "/api/myfiles/upload", undefined, { "X-File-Name": "c.bin" }, randomBytes(700 * 1024));
    expect(chunked.status).toBe(413);
    expect(chunked.json.error).toBe("quota-exceeded");
    expect((await admin(env.dataDir, "files-usage")).out).toContain(`${c.username}  1 file  0.7 MB  (quota 1 MB)`);

    // deleting frees room
    await c.del(`/api/myfiles/files/${first.json.file.id}`);
    expect((await c.uploadMy("b.bin", randomBytes(700 * 1024))).status).toBe(201);

    expect((await admin(env.dataDir, "set-files-quota", c.username, "none")).code).toBe(0);
    expect((await c.get("/api/myfiles")).json.usage.quotaBytes).toBeNull();
    expect((await admin(env.dataDir, "set-files-quota", c.username, "0")).code).toBe(1);
    expect((await admin(env.dataDir, "set-files-quota", c.username, "abc")).code).toBe(1);
    expect((await admin(env.dataDir, "set-files-quota", "nobody", "5")).code).toBe(1);
  });

  it("does not let two uploads started together squeeze past the quota", async () => {
    const c = await signedInClient(env);
    await admin(env.dataDir, "set-files-quota", c.username, "1");
    const results = await Promise.all([c.uploadMy("p.bin", randomBytes(600 * 1024)), c.uploadMy("q.bin", randomBytes(600 * 1024))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 413]);
  });
});

describe("who can see what", () => {
  it("keeps accounts apart: list, download, preview, rename, delete, bulk, folders and settings", async () => {
    const a = await signedInClient(env);
    const b = await signedInClient(env);
    const secret = Buffer.from("account A only");
    const up = await a.uploadMy("secret.txt", secret, { folder: "Private" });
    const id = up.json.file.id;

    expect((await b.get("/api/myfiles")).json.files).toEqual([]);
    expect((await b.get("/api/myfiles")).json.allFolders).toEqual([]);
    expect((await b.get("/api/myfiles?folder=Private")).status).toBe(404);
    expect((await b.get(`/api/myfiles/files/${id}/download`)).status).toBe(404);
    expect((await b.get(`/api/myfiles/files/${id}/preview`)).status).toBe(404);
    expect((await b.patch(`/api/myfiles/files/${id}`, { name: "mine.txt" })).status).toBe(404);
    expect((await b.del(`/api/myfiles/files/${id}`)).status).toBe(404);
    const bulk = await b.post("/api/myfiles/bulk", { action: "delete", ids: [id] });
    expect(bulk.json).toEqual({ done: 0, missing: 1 });
    expect((await b.post("/api/myfiles/folders/delete", { path: "Private", confirm: true })).status).toBe(404);

    // still intact for A, and B's own namespace is separate (same names are fine)
    const dl = await a.get(`/api/myfiles/files/${id}/download`);
    expect(dl.body).toEqual(secret);
    expect((await b.uploadMy("secret.txt", Buffer.from("B"), { folder: "Private" })).json.file.name).toBe("secret.txt");
    expect((await b.put("/api/myfiles/settings", { autoDeleteDays: 5 })).status).toBe(200);
    expect((await a.get("/api/myfiles")).json.settings.autoDeleteDays).toBeNull();
  });

  it("needs a signed-in account, the app header and storage mode server", async () => {
    const anon = await signedInClient(env);
    const out = new (await import("./helpers")).Client(env.port);
    expect((await out.get("/api/myfiles")).status).toBe(401);
    expect((await out.uploadMy("a.txt", Buffer.from("x"))).status).toBe(401);
    expect((await out.get("/api/myfiles/files/12345678-1234-1234-1234-123456789012/download")).status).toBe(401);
    // a cross-site request: no custom header
    const noHeader = await anon.call("POST", "/api/myfiles/folders", { name: "x" }, { "X-Gap-Request": "0" });
    expect(noHeader.status).toBe(403);
    const wrongOrigin = await anon.call("POST", "/api/myfiles/upload", undefined, { "X-File-Name": "a.txt", Origin: "https://evil.example", "Content-Length": "1" }, Buffer.from("x"));
    expect(wrongOrigin.status).toBe(403);

    const clientMode = await startEnv({ storage: "client" });
    try {
      const c = await signedInClient(clientMode);
      expect((await c.get("/api/myfiles")).json.error).toBe("client-storage");
      expect((await c.uploadMy("a.txt", Buffer.from("x"))).status).toBe(403);
    } finally {
      await clientMode.cleanup();
    }
  });

  it("limits how fast changes can be made", async () => {
    const c = await signedInClient(env);
    const up = await c.uploadMy("r.txt", Buffer.from("x"));
    let limited: { status: number; headers: Record<string, unknown> } | undefined;
    for (let i = 0; i < 320 && !limited; i++) {
      const r = await c.patch(`/api/myfiles/files/${up.json.file.id}`, { name: `r${i}.txt` });
      if (r.status === 429) limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers["retry-after"]).toBeDefined();
  });
});

describe("folders", () => {
  it("creates, nests, renames, moves files and folders, and lists folders first", async () => {
    const c = await signedInClient(env);
    expect((await c.post("/api/myfiles/folders", { name: "Reports" })).json.path).toBe("Reports");
    expect((await c.post("/api/myfiles/folders", { parent: "Reports", name: "2026" })).json.path).toBe("Reports/2026");
    expect((await c.post("/api/myfiles/folders", { name: "reports" })).status).toBe(409); // names ignore case
    expect((await c.post("/api/myfiles/folders", { parent: "Nope", name: "x" })).status).toBe(404);

    const up = await c.uploadMy("a.txt", Buffer.from("a"));
    const moved = await c.patch(`/api/myfiles/files/${up.json.file.id}`, { folder: "Reports/2026" });
    expect(moved.json.file.folder).toBe("Reports/2026");
    expect((await c.patch(`/api/myfiles/files/${up.json.file.id}`, { folder: "Missing" })).status).toBe(404);

    const root = (await c.get("/api/myfiles")).json;
    expect(root.folders).toEqual([{ path: "Reports", name: "Reports", files: 1, folders: 1 }]);
    expect(root.files).toEqual([]);
    expect((await c.get("/api/myfiles?folder=Reports%2F2026")).json.files.map((f: { name: string }) => f.name)).toEqual(["a.txt"]);

    expect((await c.post("/api/myfiles/folders/rename", { path: "Reports", name: "Archive" })).json.path).toBe("Archive");
    const inside = (await c.get("/api/myfiles?folder=Archive%2F2026")).json;
    expect(inside.files[0].folder).toBe("Archive/2026");
    expect((await c.post("/api/myfiles/folders", { name: "Other" })).status).toBe(201);
    expect((await c.post("/api/myfiles/folders/move", { path: "Archive/2026", parent: "Other" })).json.path).toBe("Other/2026");
    expect((await c.post("/api/myfiles/folders/move", { path: "Other", parent: "Other/2026" })).status).toBe(400); // into itself
    expect((await c.get("/api/myfiles")).json.allFolders).toEqual(["Archive", "Other", "Other/2026"]);
  });

  it("creates the folders of a dropped folder tree implicitly", async () => {
    const c = await signedInClient(env);
    await c.uploadMy("deep.txt", Buffer.from("d"), { folder: "Drop/Sub/Deeper" });
    expect((await c.get("/api/myfiles")).json.allFolders).toEqual(["Drop", "Drop/Sub", "Drop/Sub/Deeper"]);
  });

  it("refuses a name that is taken in the target and keeps a move all-or-nothing", async () => {
    const c = await signedInClient(env);
    await c.post("/api/myfiles/folders", { name: "T" });
    const one = await c.uploadMy("same.txt", Buffer.from("1"));
    await c.uploadMy("same.txt", Buffer.from("2"), { folder: "T" });
    const other = await c.uploadMy("other.txt", Buffer.from("3"));
    expect((await c.patch(`/api/myfiles/files/${one.json.file.id}`, { folder: "T" })).status).toBe(409);
    const bulk = await c.post("/api/myfiles/bulk", { action: "move", ids: [other.json.file.id, one.json.file.id], folder: "T" });
    expect(bulk.status).toBe(409);
    expect((await c.get("/api/myfiles")).json.files).toHaveLength(2); // nothing moved
    expect((await c.patch(`/api/myfiles/files/${other.json.file.id}`, { name: "other2.txt" })).status).toBe(200);
    const ok = await c.post("/api/myfiles/bulk", { action: "move", ids: [other.json.file.id], folder: "T" });
    expect(ok.json).toEqual({ done: 1, missing: 0 });
  });

  it("deletes a non-empty folder only with the confirm flag, and removes the bytes from disk", async () => {
    const c = await signedInClient(env);
    const up = await c.uploadMy("keep.txt", Buffer.from("k"), { folder: "Gone/Inner" });
    const blob = join(env.dataDir, "files", c.userId, up.json.file.id);
    expect((await stat(blob)).isDirectory()).toBe(true);

    const refused = await c.post("/api/myfiles/folders/delete", { path: "Gone" });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: "folder-not-empty", files: 1, folders: 1 });
    expect((await c.post("/api/myfiles/folders/delete", { path: "Gone", confirm: "yes" })).status).toBe(400);
    expect((await c.get("/api/myfiles")).json.allFolders).toEqual(["Gone", "Gone/Inner"]);

    expect((await c.post("/api/myfiles/folders/delete", { path: "Gone", confirm: true })).status).toBe(204);
    expect((await c.get("/api/myfiles")).json.allFolders).toEqual([]);
    expect(await stat(blob).catch(() => null)).toBeNull();
    // an empty folder needs no confirm
    await c.post("/api/myfiles/folders", { name: "Empty" });
    expect((await c.post("/api/myfiles/folders/delete", { path: "Empty" })).status).toBe(204);
  });

  it("limits folder depth when creating and moving", async () => {
    const c = await signedInClient(env);
    let parent = "";
    for (let i = 1; i <= 8; i++) parent = (await c.post("/api/myfiles/folders", { parent, name: `L${i}` })).json.path;
    expect((await c.post("/api/myfiles/folders", { parent, name: "L9" })).status).toBe(400);
    await c.post("/api/myfiles/folders", { name: "Wide" });
    await c.post("/api/myfiles/folders", { parent: "Wide", name: "Kid" });
    expect((await c.post("/api/myfiles/folders/move", { path: "Wide", parent: "L1/L2/L3/L4/L5/L6/L7" })).status).toBe(400);
  });
});

describe("rename, delete, bulk", () => {
  it("renames a file (the bytes keep their disk name), deletes it from disk, and bulk-deletes", async () => {
    const c = await signedInClient(env);
    const a = await c.uploadMy("old.txt", Buffer.from("a"));
    const b = await c.uploadMy("two.txt", Buffer.from("b"));
    const d = await c.uploadMy("three.txt", Buffer.from("c"));
    const ren = await c.patch(`/api/myfiles/files/${a.json.file.id}`, { name: "new name.txt" });
    expect(ren.json.file.name).toBe("new name.txt");
    expect((await c.patch(`/api/myfiles/files/${a.json.file.id}`, { name: "../x" })).json.file.name).toBe(".._x");
    expect((await c.patch(`/api/myfiles/files/${a.json.file.id}`, { name: "two.txt" })).status).toBe(409);
    expect((await c.patch(`/api/myfiles/files/${a.json.file.id}`, { name: "  " })).status).toBe(400);
    expect((await c.get(`/api/myfiles/files/${a.json.file.id}/download`)).body).toEqual(Buffer.from("a"));

    expect((await c.del(`/api/myfiles/files/${a.json.file.id}`)).status).toBe(204);
    expect(await stat(join(env.dataDir, "files", c.userId, a.json.file.id)).catch(() => null)).toBeNull();
    expect((await c.del(`/api/myfiles/files/${a.json.file.id}`)).status).toBe(404);

    const bulk = await c.post("/api/myfiles/bulk", { action: "delete", ids: [b.json.file.id, d.json.file.id, "12345678-1234-1234-1234-123456789012"] });
    expect(bulk.json).toEqual({ done: 2, missing: 1 });
    expect((await c.get("/api/myfiles")).json.files).toEqual([]);
    expect(await readdir(join(env.dataDir, "files", c.userId))).toEqual([".incoming", "index.json"]);
  });
});

describe("auto-delete", () => {
  it("is off by default, follows the account setting for new uploads, and can be set or cleared per file", async () => {
    const c = await signedInClient(env);
    expect((await c.uploadMy("none.txt", Buffer.from("x"))).json.file.expiresAt).toBeUndefined();

    expect((await c.put("/api/myfiles/settings", { autoDeleteDays: 0 })).status).toBe(400);
    expect((await c.put("/api/myfiles/settings", { autoDeleteDays: 1.5 })).status).toBe(400);
    expect((await c.put("/api/myfiles/settings", { autoDeleteDays: 99999 })).status).toBe(400);
    expect((await c.put("/api/myfiles/settings", {})).status).toBe(400);
    expect((await c.put("/api/myfiles/settings", { autoDeleteDays: 7 })).status).toBe(200);
    const up = await c.uploadMy("week.txt", Buffer.from("x"));
    const days = (Date.parse(up.json.file.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    // files that were there before keep their own (no) date
    expect((await c.get("/api/myfiles")).json.files.find((f: { name: string }) => f.name === "none.txt").expiresAt).toBeUndefined();

    const set = await c.patch(`/api/myfiles/files/${up.json.file.id}`, { autoDeleteDays: 2 });
    expect((Date.parse(set.json.file.expiresAt) - Date.now()) / 86_400_000).toBeLessThan(2.01);
    const cleared = await c.patch(`/api/myfiles/files/${up.json.file.id}`, { autoDeleteDays: null });
    expect(cleared.json.file.expiresAt).toBeUndefined();
    expect((await c.put("/api/myfiles/settings", { autoDeleteDays: null })).status).toBe(200);
    expect((await c.uploadMy("off.txt", Buffer.from("x"))).json.file.expiresAt).toBeUndefined();
  });

  it("the sweep removes expired files from disk and index, spares the rest, and respects a cleared date", async () => {
    const c = await signedInClient(env);
    await c.put("/api/myfiles/settings", { autoDeleteDays: 1 });
    const gone = await c.uploadMy("gone.txt", Buffer.from("g"));
    const spared = await c.uploadMy("spared.txt", Buffer.from("s"));
    await c.patch(`/api/myfiles/files/${spared.json.file.id}`, { autoDeleteDays: null });
    await c.put("/api/myfiles/settings", { autoDeleteDays: null });
    const never = await c.uploadMy("never.txt", Buffer.from("n"));

    // nothing expires yet
    expect((await sweepExpired(env.server.app.store, new Date())).deleted).toBe(0);
    expect((await c.get("/api/myfiles")).json.files).toHaveLength(3);

    const later = new Date(Date.now() + 2 * 86_400_000);
    const result = await sweepExpired(env.server.app.store, later);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const names = (await c.get("/api/myfiles")).json.files.map((f: { name: string }) => f.name).sort();
    expect(names).toEqual(["never.txt", "spared.txt"]);
    expect(await stat(join(env.dataDir, "files", c.userId, gone.json.file.id)).catch(() => null)).toBeNull();
    expect((await stat(join(env.dataDir, "files", c.userId, never.json.file.id))).isDirectory()).toBe(true);
    expect((await readFile(join(env.dataDir, "audit.log"), "utf8")).includes(`"event":"myfiles-expired"`)).toBe(true);
    // running it again is harmless
    expect((await sweepExpired(env.server.app.store, later)).deleted).toBe(0);
  });

  it("the sweep reads the date fresh: a file whose date was cleared a moment ago is kept", async () => {
    const c = await signedInClient(env);
    await c.put("/api/myfiles/settings", { autoDeleteDays: 1 });
    const f = await c.uploadMy("race.txt", Buffer.from("r"));
    const later = new Date(Date.now() + 2 * 86_400_000);
    // both run at the same time; whichever is queued first, the outcome is one of the two consistent ones
    const [, sweep] = await Promise.all([c.patch(`/api/myfiles/files/${f.json.file.id}`, { autoDeleteDays: null }), sweepExpired(env.server.app.store, later)]);
    const left = (await c.get("/api/myfiles")).json.files.length;
    const onDisk = await stat(join(env.dataDir, "files", c.userId, f.json.file.id)).then(() => true, () => false);
    expect(left === 1).toBe(onDisk); // listed if and only if the bytes exist: never a listed file without bytes
    expect(sweep.deleted + left).toBeGreaterThanOrEqual(1);
  });

  it("the sweep clears old leftovers (unlisted blob folders, part files) but not fresh ones", async () => {
    const c = await signedInClient(env);
    await c.uploadMy("x.txt", Buffer.from("x"));
    const dir = join(env.dataDir, "files", c.userId);
    const oldBlob = join(dir, "11111111-1111-1111-1111-111111111111");
    const freshBlob = join(dir, "22222222-2222-2222-2222-222222222222");
    await mkdir(oldBlob);
    await writeFile(join(oldBlob, "x"), "x");
    await mkdir(freshBlob);
    await writeFile(join(dir, ".incoming", "old.part"), "x");
    await writeFile(join(dir, ".incoming", "fresh.part"), "x");
    const past = new Date(Date.now() - 3 * 3_600_000);
    await utimes(oldBlob, past, past);
    await utimes(join(dir, ".incoming", "old.part"), past, past);
    await sweepExpired(env.server.app.store);
    expect(await stat(oldBlob).catch(() => null)).toBeNull();
    expect((await stat(freshBlob)).isDirectory()).toBe(true);
    expect(await readdir(join(dir, ".incoming"))).toEqual(["fresh.part"]);
  });
});
