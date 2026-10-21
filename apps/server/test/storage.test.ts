/// <reference types="node" />
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { parseProject } from "@gap/process-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, sampleProject, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ maxUploadMB: 2 });
});
afterAll(() => env.cleanup());

type User = Awaited<ReturnType<typeof signedInClient>>;

/** Every file below a folder, as paths relative to it. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

describe("projects", () => {
  it("creates, lists (newest first), reads, updates and deletes to the trash", async () => {
    const c = await signedInClient(env);
    const firstProject = sampleProject("First");
    const first = await c.post("/api/projects", { project: firstProject });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), revision: 1, updatedAt: expect.any(String) });
    await new Promise((r) => setTimeout(r, 5));
    const second = await c.post("/api/projects", { project: sampleProject("Second") });

    const list = await c.get("/api/projects");
    expect(list.status).toBe(200);
    expect(list.json.projects.map((p: { title: string }) => p.title)).toEqual(["Second", "First"]);
    expect(list.json.projects[0]).toEqual({ id: second.json.id, title: "Second", updatedAt: second.json.updatedAt, revision: 1, schemaVersion: "1.5.0" });

    const got = await c.get(`/api/projects/${first.json.id}`);
    expect(got.json).toEqual({
      id: first.json.id,
      revision: 1,
      updatedAt: first.json.updatedAt,
      project: parseProject(firstProject),
    });

    const edited = sampleProject("First, edited");
    const put = await c.put(`/api/projects/${first.json.id}`, { project: edited, baseRevision: 1 });
    expect(put.status).toBe(200);
    expect(put.json.revision).toBe(2);
    expect((await c.get(`/api/projects/${first.json.id}`)).json.project.meta.title).toBe("First, edited");

    const del = await c.del(`/api/projects/${first.json.id}`);
    expect(del.status).toBe(204);
    expect((await c.get(`/api/projects/${first.json.id}`)).status).toBe(404);
    expect((await c.del(`/api/projects/${first.json.id}`)).status).toBe(404);
    expect((await c.get("/api/projects")).json.projects).toHaveLength(1);

    // moved, not erased
    const trashed = await walk(join(env.dataDir, "trash", c.userId));
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toContain(`${first.json.id}.json`);
    const saved = JSON.parse(await readFile(join(env.dataDir, "trash", c.userId, trashed[0]!), "utf8"));
    expect(saved.project.meta.title).toBe("First, edited");
    expect(await readFile(join(env.dataDir, "audit.log"), "utf8")).toContain('"event":"project-delete"');
  });

  it("answers 409 conflict with the current revision when baseRevision is old, and keeps the stored copy", async () => {
    const c = await signedInClient(env);
    const { id } = (await c.post("/api/projects", { project: sampleProject("Shared") })).json;
    const ok = await c.put(`/api/projects/${id}`, { project: sampleProject("From computer A"), baseRevision: 1 });
    const stale = await c.put(`/api/projects/${id}`, { project: sampleProject("From computer B"), baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: "conflict", revision: 2, updatedAt: ok.json.updatedAt });
    const ahead = await c.put(`/api/projects/${id}`, { project: sampleProject("Future"), baseRevision: 9 });
    expect(ahead.status).toBe(409);
    expect((await c.get(`/api/projects/${id}`)).json.project.meta.title).toBe("From computer A");
  });

  it("lets only one of two simultaneous saves with the same base revision win", async () => {
    const c = await signedInClient(env);
    const { id } = (await c.post("/api/projects", { project: sampleProject("Race") })).json;
    const results = await Promise.all([
      c.put(`/api/projects/${id}`, { project: sampleProject("one"), baseRevision: 1 }),
      c.put(`/api/projects/${id}`, { project: sampleProject("two"), baseRevision: 1 }),
      c.put(`/api/projects/${id}`, { project: sampleProject("three"), baseRevision: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await c.get(`/api/projects/${id}`)).json.revision).toBe(2);
  });

  it("rejects a project that parseProject refuses, with its message, and stores nothing", async () => {
    const c = await signedInClient(env);
    const cases: unknown[] = [{}, { schemaVersion: "9.9.9" }, { ...sampleProject(), processes: "nope" }, "text", null];
    for (const project of cases) {
      const res = await c.post("/api/projects", { project });
      expect(res.status, JSON.stringify(project)).toBe(400);
      expect(res.json.error).toBe("invalid-project");
      expect(res.json.message.length).toBeGreaterThan(10);
    }
    expect((await c.post("/api/projects", { project: { schemaVersion: "9.9.9" } })).json.message).toContain("Unsupported schema version 9.9.9");
    expect((await c.get("/api/projects")).json.projects).toEqual([]);
    expect((await c.post("/api/projects", {})).status).toBe(400);

    const { id } = (await c.post("/api/projects", { project: sampleProject() })).json;
    expect((await c.put(`/api/projects/${id}`, { project: {}, baseRevision: 1 })).json.error).toBe("invalid-project");
    for (const baseRevision of [0, -1, 1.5, "1", undefined]) {
      expect((await c.put(`/api/projects/${id}`, { project: sampleProject(), baseRevision })).status).toBe(400);
    }
    expect((await c.put(`/api/projects/00000000-0000-0000-0000-000000000000`, { project: sampleProject(), baseRevision: 1 })).status).toBe(404);
  });

  it("needs a session on every route", async () => {
    const anon = new Client(env.port);
    for (const [method, path] of [
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["GET", "/api/projects/00000000-0000-0000-0000-000000000000"],
      ["GET", "/api/templates"],
      ["GET", "/api/files"],
      ["POST", "/api/files"],
      ["GET", "/api/auth/me"],
    ] as const) {
      const res = await anon.call(method, path, method === "POST" ? {} : undefined);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.json.error).toBe("signed-out");
    }
  });
});

describe("templates", () => {
  const meta = (extra: Record<string, unknown> = {}) => ({
    name: "Company template",
    version: "2",
    fileName: "company.docx",
    sourceFormat: "docx",
    sha256: "abc",
    storedSha256: "def",
    addedAt: "2026-01-01T00:00:00.000Z",
    analysis: { headings: ["Purpose", "Scope"], nested: { ok: true } },
    ...extra,
  });

  it("round-trips the bytes exactly and lists meta without them", async () => {
    const c = await signedInClient(env);
    const bytes = Buffer.concat([Buffer.from([...Array(256).keys()]), randomBytes(300_000)]);
    const clientId = "11111111-2222-3333-4444-555555555555";
    const created = await c.post("/api/templates", { meta: meta({ id: clientId, bytes: [1, 2, 3] }), bytesBase64: bytes.toString("base64") });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ id: clientId }); // a valid unused client id is kept

    const file = await c.get(`/api/templates/${clientId}/file`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/octet-stream");
    expect(Buffer.compare(file.body, bytes)).toBe(0);
    // stored as real files
    expect(Buffer.compare(await readFile(join(env.dataDir, "users", c.userId, "templates", `${clientId}.docx`)), bytes)).toBe(0);

    const list = await c.get("/api/templates");
    expect(list.json.templates).toHaveLength(1);
    expect(list.json.templates[0]).toMatchObject({ id: clientId, name: "Company template", version: "2", analysis: { nested: { ok: true } } });
    expect(list.json.templates[0].bytes).toBeUndefined();
    expect(list.json.templates[0].bytesBase64).toBeUndefined();
  });

  it("assigns a new id when the client id is used already, invalid, or missing", async () => {
    const c = await signedInClient(env);
    const b64 = Buffer.from("docx bytes").toString("base64");
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect((await c.post("/api/templates", { meta: meta({ id }), bytesBase64: b64 })).json.id).toBe(id);
    for (const bad of [id, "../../x", "not-a-uuid", 42, undefined]) {
      const res = await c.post("/api/templates", { meta: meta({ id: bad }), bytesBase64: b64 });
      expect(res.status).toBe(201);
      expect(res.json.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.json.id).not.toBe(id);
    }
    expect((await c.get("/api/templates")).json.templates).toHaveLength(6);
  });

  it("patches name, version and mapping, and deletes both files to the trash", async () => {
    const c = await signedInClient(env);
    const { id } = (await c.post("/api/templates", { meta: meta(), bytesBase64: Buffer.from("x").toString("base64") })).json;
    const patched = await c.patch(`/api/templates/${id}`, { name: "Renamed", version: "3", mapping: { rows: [1, 2] } });
    expect(patched.status).toBe(200);
    expect(patched.json.meta).toMatchObject({ id, name: "Renamed", version: "3", mapping: { rows: [1, 2] }, fileName: "company.docx" });
    const cleared = await c.patch(`/api/templates/${id}`, { mapping: null });
    expect(cleared.json.meta.mapping).toBeUndefined();
    expect(cleared.json.meta.name).toBe("Renamed");
    expect((await c.patch(`/api/templates/${id}`, { name: "" })).status).toBe(400);
    expect((await c.patch(`/api/templates/${id}`, { id: "other", name: "Keep id" })).json.meta.id).toBe(id);
    expect((await c.patch(`/api/templates/00000000-0000-0000-0000-000000000000`, { name: "x" })).status).toBe(404);

    expect((await c.del(`/api/templates/${id}`)).status).toBe(204);
    expect((await c.get(`/api/templates/${id}/file`)).status).toBe(404);
    expect((await c.get("/api/templates")).json.templates).toEqual([]);
    const trashed = (await walk(join(env.dataDir, "trash", c.userId))).join("|");
    expect(trashed).toContain(`${id}.docx`);
    expect(trashed).toContain(`${id}.json`);
  });

  it("rejects bad input", async () => {
    const c = await signedInClient(env);
    expect((await c.post("/api/templates", { meta: meta(), bytesBase64: "not base64 !!" })).status).toBe(400);
    expect((await c.post("/api/templates", { meta: meta(), bytesBase64: "" })).status).toBe(400);
    expect((await c.post("/api/templates", { meta: meta({ name: "" }), bytesBase64: "AAAA" })).status).toBe(400);
    expect((await c.post("/api/templates", { bytesBase64: "AAAA" })).status).toBe(400);
    expect((await c.get("/api/templates")).json.templates).toEqual([]);
  });
});

describe("files", () => {
  it("stores the real bytes on disk, computes sha256, and downloads them with safe headers", async () => {
    const c = await signedInClient(env);
    const bytes = randomBytes(150_000);
    const res = await c.upload("Batch record v2.pdf", bytes, { "Content-Type": "application/pdf", "X-Project-Id": "11111111-2222-3333-4444-555555555555", "X-Source-Id": "doc:BR-001" });
    expect(res.status).toBe(201);
    const file = res.json.file;
    expect(file).toMatchObject({
      fileName: "Batch record v2.pdf",
      safeName: "Batch record v2.pdf",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: "application/pdf",
      projectId: "11111111-2222-3333-4444-555555555555",
      sourceId: "doc:BR-001",
    });
    expect(file.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(file.uploadedAt)).not.toBeNaN();

    const folder = join(env.dataDir, "users", c.userId, "files", file.id);
    expect((await readdir(folder)).sort()).toEqual(["Batch record v2.pdf", "meta.json"]);
    expect(Buffer.compare(await readFile(join(folder, "Batch record v2.pdf")), bytes)).toBe(0);
    expect(JSON.parse(await readFile(join(folder, "meta.json"), "utf8"))).toEqual(file);

    const dl = await c.get(`/api/files/${file.id}`);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body, bytes)).toBe(0);
    expect(dl.headers["content-type"]).toBe("application/octet-stream");
    expect(dl.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''Batch%20record%20v2.pdf");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(dl.headers["content-length"]).toBe(String(bytes.length));
  });

  it("never lets a client name decide the path", async () => {
    const c = await signedInClient(env);
    const cases: [string, string][] = [
      ["..\\..\\x.exe", "x.exe"],
      ["../../etc/passwd", "passwd"],
      ["/abs/olute/name.txt", "name.txt"],
      ["C:\\Windows\\system32\\evil.dll", "evil.dll"],
      ["a/../../b.docx", "b.docx"],
      ["con.txt", "_con.txt"],
      ["NUL", "_NUL"],
      ["Aux.tar.gz", "_Aux.tar.gz"],
      ["lpt1.pdf", "_lpt1.pdf"],
      ["report.docx   ", "report.docx"],
      ["report.docx.", "report.docx"],
      ["...hidden", "hidden"],
      ["..", "file"],
      [".", "file"],
      ["   ", "file"],
      ["a<b>c:d\"e|f?g*h.txt", "a_b_c_d_e_f_g_h.txt"],
      ["tab\there\u0007bell.txt", "tab_here_bell.txt"],
      ["Prüfbericht ✓ 日本語.pdf", "Prüfbericht ✓ 日本語.pdf"],
      ["meta.json", "_meta.json"],
      ["Meta.JSON", "_Meta.JSON"],
      ["noextension", "noextension"],
      ["archive.tar.gz", "archive.tar.gz"],
    ];
    for (const [given, expected] of cases) {
      const res = await c.upload(given, Buffer.from("data"));
      expect(res.status, given).toBe(201);
      expect(res.json.file.safeName, given).toBe(expected);
      const folder = join(env.dataDir, "users", c.userId, "files", res.json.file.id);
      expect((await readdir(folder)).sort(), given).toEqual([expected, "meta.json"].sort());
      expect(res.json.file.fileName).not.toMatch(/[\u0000-\u001f]/);
    }
    // nothing escaped: every upload sits exactly at users/<id>/files/<fileId>/<name>, and nothing new appeared outside data/
    const inData = await walk(env.dataDir);
    for (const p of inData.filter((x) => x.startsWith("users") && x.split(sep)[2] === "files")) expect(p.split(sep)).toHaveLength(5);
    const outside = (await walk(env.root)).filter((p) => !p.startsWith(`data${sep}`));
    expect(outside.sort()).toEqual([join("secret.txt"), join("web", "assets", "app.js"), join("web", "index.html")].sort());
  });

  it("caps long names at 120 characters and keeps the extension", async () => {
    const c = await signedInClient(env);
    const res = await c.upload(`${"x".repeat(300)}.pdf`, Buffer.from("data"));
    expect(res.json.file.safeName).toHaveLength(120);
    expect(res.json.file.safeName.endsWith("x.pdf")).toBe(true);
    expect(res.json.file.fileName.length).toBeLessThanOrEqual(255);
  });

  it("sanitises the content type and filters the list", async () => {
    const c = await signedInClient(env);
    const p1 = "aaaaaaaa-0000-0000-0000-000000000001";
    const p2 = "aaaaaaaa-0000-0000-0000-000000000002";
    const a = (await c.upload("a.txt", Buffer.from("a"), { "Content-Type": "text/html; charset=utf-8", "X-Project-Id": p1, "X-Source-Id": "s1" })).json.file;
    const b = (await c.upload("b.txt", Buffer.from("b"), { "Content-Type": "<script>", "X-Project-Id": p1, "X-Source-Id": "s2" })).json.file;
    const d = (await c.upload("c.txt", Buffer.from("c"), { "X-Project-Id": p2 })).json.file;
    expect(a.contentType).toBe("text/html");
    expect(b.contentType).toBe("application/octet-stream");
    const ids = async (q: string) => (await c.get(`/api/files${q}`)).json.files.map((f: { id: string }) => f.id).sort();
    expect(await ids("")).toEqual([a.id, b.id, d.id].sort());
    expect(await ids(`?projectId=${p1}`)).toEqual([a.id, b.id].sort());
    expect(await ids(`?projectId=${p1}&sourceId=s2`)).toEqual([b.id]);
    expect(await ids(`?sourceId=s1`)).toEqual([a.id]);
    expect(await ids(`?projectId=${p2}&sourceId=s1`)).toEqual([]);
    // an HTML file is never served as HTML
    const dl = await c.get(`/api/files/${a.id}`);
    expect(dl.headers["content-type"]).toBe("application/octet-stream");
  });

  it("encodes unicode download names, deletes to the trash, and refuses empty uploads", async () => {
    const c = await signedInClient(env);
    const { file } = (await c.upload("Prüfbericht (1) 'v2'.pdf", Buffer.from("pdf"))).json;
    const dl = await c.get(`/api/files/${file.id}`);
    expect(dl.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''Pr%C3%BCfbericht%20%281%29%20%27v2%27.pdf");

    expect((await c.upload("empty.txt", Buffer.alloc(0))).status).toBe(400);

    expect((await c.del(`/api/files/${file.id}`)).status).toBe(204);
    expect((await c.get(`/api/files/${file.id}`)).status).toBe(404);
    expect((await c.get("/api/files")).json.files).toEqual([]);
    expect((await c.del(`/api/files/${file.id}`)).status).toBe(404);
    const trashed = await walk(join(env.dataDir, "trash", c.userId));
    expect(trashed.some((p) => p.endsWith("meta.json"))).toBe(true);
    expect(trashed.some((p) => p.includes("Pr"))).toBe(true);
    const log = await readFile(join(env.dataDir, "audit.log"), "utf8");
    expect(log).toContain('"event":"file-upload"');
    expect(log).toContain('"event":"file-delete"');
  });
});

describe("user isolation", () => {
  it("never shows, changes or deletes another user's projects, templates or files", async () => {
    const alice: User = await signedInClient(env);
    const bob: User = await signedInClient(env);
    const project = (await alice.post("/api/projects", { project: sampleProject("Alice only") })).json;
    const template = (await alice.post("/api/templates", { meta: { name: "T", version: "1" }, bytesBase64: Buffer.from("secret template").toString("base64") })).json;
    const file = (await alice.upload("secret.pdf", Buffer.from("secret file"), { "X-Source-Id": "s1" })).json.file;

    expect((await bob.get("/api/projects")).json.projects).toEqual([]);
    expect((await bob.get("/api/templates")).json.templates).toEqual([]);
    expect((await bob.get("/api/files")).json.files).toEqual([]);
    expect((await bob.get("/api/files?sourceId=s1")).json.files).toEqual([]);

    const attempts = [
      await bob.get(`/api/projects/${project.id}`),
      await bob.put(`/api/projects/${project.id}`, { project: sampleProject("Bob wrote this"), baseRevision: 1 }),
      await bob.del(`/api/projects/${project.id}`),
      await bob.get(`/api/templates/${template.id}/file`),
      await bob.patch(`/api/templates/${template.id}`, { name: "Bob's" }),
      await bob.del(`/api/templates/${template.id}`),
      await bob.get(`/api/files/${file.id}`),
      await bob.del(`/api/files/${file.id}`),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("secret");
      expect(res.text).not.toContain("Alice");
    }

    // Bob reusing Alice's template id gets a copy in his own space, not hers
    const mine = await bob.post("/api/templates", { meta: { id: template.id, name: "Bob T", version: "1" }, bytesBase64: Buffer.from("bob bytes").toString("base64") });
    expect(mine.status).toBe(201);
    expect((await bob.get(`/api/templates/${mine.json.id}/file`)).text).toBe("bob bytes");
    expect((await alice.get(`/api/templates/${template.id}/file`)).text).toBe("secret template");

    // everything of Alice's is intact
    expect((await alice.get(`/api/projects/${project.id}`)).json.project.meta.title).toBe("Alice only");
    expect((await alice.get(`/api/files/${file.id}`)).text).toBe("secret file");
    expect((await alice.get("/api/templates")).json.templates).toHaveLength(1);
    expect((await alice.get("/api/templates")).json.templates[0].name).toBe("T");
    expect((await alice.get("/api/projects")).json.projects).toHaveLength(1);

    // a signed-out visitor sees nothing, and a stolen id in another user's cookie scope changes nothing
    expect((await new Client(env.port).get(`/api/projects/${project.id}`)).status).toBe(401);
  });
});

describe("storage mode client", () => {
  it("keeps only accounts: projects, templates and files answer 403 client-storage", async () => {
    const client = await startEnv({ storage: "client" });
    try {
      expect((await new Client(client.port).get("/api/health")).json).toMatchObject({ ok: true, storage: "client" });
      const c = await signedInClient(client);
      expect((await c.get("/api/auth/me")).status).toBe(200);
      const id = "00000000-0000-0000-0000-000000000000";
      for (const [method, path] of [
        ["GET", "/api/projects"],
        ["POST", "/api/projects"],
        ["GET", `/api/projects/${id}`],
        ["PUT", `/api/projects/${id}`],
        ["DELETE", `/api/projects/${id}`],
        ["GET", "/api/templates"],
        ["POST", "/api/templates"],
        ["GET", `/api/templates/${id}/file`],
        ["PATCH", `/api/templates/${id}`],
        ["DELETE", `/api/templates/${id}`],
        ["GET", "/api/files"],
        ["POST", "/api/files"],
        ["GET", `/api/files/${id}`],
        ["DELETE", `/api/files/${id}`],
      ] as const) {
        const res = await c.call(method, path, method === "GET" || method === "DELETE" ? undefined : { project: sampleProject() });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.json.error).toBe("client-storage");
      }
      // a signed-out caller still gets 401 first
      expect((await new Client(client.port).get("/api/projects")).status).toBe(401);
      // nothing but account data was written
      const files = await walk(client.dataDir);
      expect(files.filter((p) => p.startsWith(`users${sep}`) || p.startsWith(`trash${sep}`))).toEqual([]);
    } finally {
      await client.cleanup();
    }
  });
});
