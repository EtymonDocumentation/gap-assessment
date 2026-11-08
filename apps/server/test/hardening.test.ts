/// <reference types="node" />
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/app";
import { MAX_SESSIONS_PER_USER, hashPassword, passwordProblem, usersFile, MIN_PASSWORD } from "../src/auth";
import { SECURITY_HEADERS, UPLOAD_BODY_MS, bodyTimeMs, limitBodyTime } from "../src/http";
import {
  DEFAULT_FILES_QUOTA_MB,
  MAX_ATTACHED_FILES,
  MAX_LIBRARY_BODY_BYTES,
  MAX_LIBRARY_ITEMS,
  MAX_PROJECTS,
  MAX_TEMPLATES,
  MIN_FREE_DISK_BYTES,
  forgetDiskReading,
  requireRoomForItem,
} from "../src/limits";
import { safeName } from "../src/names";
import { Store, TRASH_DAYS, trashedAt } from "../src/store";
import type { UserRecord } from "../src/types";
import { Client, FAST_SCRYPT, GOOD_PASSWORD, admin, newInvite, rawRequest, sampleProject, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

const MB = 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- what the server says about itself ---------- */

describe("what the public side shows", () => {
  it("answers the health check with whether it is up and where projects are kept, and nothing else", async () => {
    const res = await rawRequest(env.port, { path: "/api/health" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, storage: "server" });
  });

  it("sends the browser-side protections on every answer", async () => {
    const res = await rawRequest(env.port, { path: "/api/health" });
    expect(res.headers["permissions-policy"]).toBe(SECURITY_HEADERS["Permissions-Policy"]);
    expect(String(res.headers["permissions-policy"])).toContain("camera=()");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("font-src 'self' data:");
    // the pages of the site get them too, not only the data routes
    const page = await rawRequest(env.port, { path: "/" });
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toBe(res.headers["content-security-policy"]);
    expect(page.headers["permissions-policy"]).toBe(res.headers["permissions-policy"]);
  });
});

/* ---------- sessions ---------- */

describe("sessions", () => {
  it("keeps at most ten open per person, ending the oldest first", async () => {
    expect(MAX_SESSIONS_PER_USER).toBe(10);
    const first = await signedInClient(env, "many.sessions");
    const others: Client[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER - 1; i++) {
      const c = new Client(env.port);
      expect((await c.post("/api/auth/login", { username: "many.sessions", password: GOOD_PASSWORD })).status).toBe(200);
      others.push(c);
    }
    // ten sessions now: all of them work
    expect((await first.get("/api/auth/me")).status).toBe(200);
    for (const c of others) expect((await c.get("/api/auth/me")).status).toBe(200);
    // an eleventh ends the oldest and nobody else
    const eleventh = new Client(env.port);
    expect((await eleventh.post("/api/auth/login", { username: "many.sessions", password: GOOD_PASSWORD })).status).toBe(200);
    expect((await first.get("/api/auth/me")).status).toBe(401);
    for (const c of [...others, eleventh]) expect((await c.get("/api/auth/me")).status).toBe(200);
    const sessions = JSON.parse(await readFile(join(env.dataDir, "sessions.json"), "utf8")) as { userId: string }[];
    expect(sessions.filter((s) => s.userId === first.userId)).toHaveLength(MAX_SESSIONS_PER_USER);
  });

  it("does not end another person's sessions when one person passes the cap", async () => {
    const bystander = await signedInClient(env, "quiet.bystander");
    const busy = await signedInClient(env, "busy.person");
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 2; i++) {
      await new Client(env.port).post("/api/auth/login", { username: "busy.person", password: GOOD_PASSWORD });
    }
    expect((await busy.get("/api/auth/me")).status).toBe(401);
    expect((await bystander.get("/api/auth/me")).status).toBe(200);
  });

  it("notices a sign-out, a password change and a change by the admin tool at once, although accounts and sessions are cached", async () => {
    const a = await signedInClient(env, "cache.check");
    const b = new Client(env.port);
    await b.post("/api/auth/login", { username: "cache.check", password: GOOD_PASSWORD });
    expect((await a.get("/api/auth/me")).status).toBe(200);
    expect((await b.get("/api/auth/me")).status).toBe(200);

    await b.post("/api/auth/logout");
    expect((await b.get("/api/auth/me")).status).toBe(401);
    expect((await a.get("/api/auth/me")).status).toBe(200);

    // The admin tool runs as another program and writes the same files.
    await admin(env.dataDir, "sessions-revoke", "cache.check");
    expect((await a.get("/api/auth/me")).status).toBe(401);

    const c = new Client(env.port);
    expect((await c.post("/api/auth/login", { username: "cache.check", password: GOOD_PASSWORD })).status).toBe(200);
    await admin(env.dataDir, "disable", "cache.check");
    expect((await c.get("/api/auth/me")).status).toBe(401);
    await admin(env.dataDir, "enable", "cache.check");
    expect((await new Client(env.port).post("/api/auth/login", { username: "cache.check", password: GOOD_PASSWORD })).status).toBe(200);
  });
});

/* ---------- passwords ---------- */

describe("choosing a password", () => {
  it("asks for at least 12 characters, with no rule about capitals, digits or symbols", () => {
    expect(MIN_PASSWORD).toBe(12);
    expect(passwordProblem("a".repeat(11), "someone")).toMatch(/at least 12 characters/);
    expect(passwordProblem("twelve chars", "someone")).toBeNull(); // exactly 12 characters, all lower case, no digit
    expect(passwordProblem("short one", "someone")).toMatch(/at least 12 characters/);
    expect(passwordProblem("correct horse battery", "someone")).toBeNull();
    expect(passwordProblem("lantern.maple.river.cloud", "someone")).toBeNull();
    expect(passwordProblem(undefined, "someone")).toMatch(/choose a password/);
  });

  it("refuses the user name inside the password, in any letter case", () => {
    expect(passwordProblem("my-name-is-Sam.Test-ok", "sam.test")).toMatch(/user name out of your password/);
    expect(passwordProblem("SAM.TEST plus more words", "sam.test")).toMatch(/user name out of your password/);
    expect(passwordProblem("my name is somebody else", "sam.test")).toBeNull();
  });

  it("refuses a password that is on the short list of very common ones, however it is spaced or numbered", () => {
    for (const common of ["password1234", "Password 12345", "passwordpassword", "qwertyuiopasdf", "123456789012", "aaaaaaaaaaaa", "letmein!!!!!!!"]) {
      expect(passwordProblem(common, "someone"), common).toMatch(/very common/);
    }
    expect(passwordProblem("my dog likes password pie", "someone")).toBeNull();
  });

  it("speaks in plain words", () => {
    const messages = [passwordProblem("x", "u"), passwordProblem("password1234", "u"), passwordProblem("hello-u-hello-there", "u"), passwordProblem(undefined)];
    for (const m of messages) {
      expect(m).toBeTruthy();
      expect(m).not.toMatch(/\b(error|invalid|validate|validation|required|must)\b/i);
    }
  });

  it("is checked at sign-up and when a password is changed", async () => {
    for (const [password, expected] of [
      ["too short", /at least 12 characters/],
      ["password1234", /very common/],
      ["rule.check.person.pw", /user name out of your password/],
    ] as const) {
      const res = await new Client(env.port).post("/api/auth/signup", {
        inviteCode: await newInvite(env.dataDir),
        username: "rule.check.person",
        displayName: "Test Person",
        password,
      });
      expect(res.status, password).toBe(400);
      expect(res.json.message, password).toMatch(expected);
    }
    const c = await signedInClient(env, "change.rules");
    for (const [newPassword, expected] of [
      ["too short", /at least 12 characters/],
      ["passwordpassword", /very common/],
      ["xx change.rules xx", /user name out of your password/],
    ] as const) {
      const res = await c.post("/api/auth/password", { currentPassword: GOOD_PASSWORD, newPassword });
      expect(res.status, newPassword).toBe(400);
      expect(res.json.message, newPassword).toMatch(expected);
    }
    expect((await c.post("/api/auth/password", { currentPassword: GOOD_PASSWORD, newPassword: "three plain words here" })).status).toBe(204);
  });

  it("lets a password made under the older rules sign in, and asks for the new rules only when it is changed", async () => {
    await signedInClient(env, "old.password");
    const store = new Store(env.dataDir);
    const oldHash = await hashPassword("short1", FAST_SCRYPT);
    await store.update<UserRecord[]>(usersFile(store), [], (all) => all.map((u) => (u.username === "old.password" ? { ...u, passwordHash: oldHash } : u)));
    const again = new Client(env.port);
    expect((await again.post("/api/auth/login", { username: "old.password", password: "short1" })).status).toBe(200);
    expect((await again.post("/api/auth/password", { currentPassword: "short1", newPassword: "short2" })).status).toBe(400);
    expect((await again.post("/api/auth/password", { currentPassword: "short1", newPassword: "a better password now" })).status).toBe(204);
  });
});

/* ---------- file names ---------- */

describe("file names", () => {
  const devices = ["con", "prn", "aux", "nul", "conin$", "conout$", "clock$", ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`]), "com¹", "com²", "com³", "lpt¹", "lpt²", "lpt³"];

  it("never gives back a name Windows treats as a device, in any letter case, with or without an extension", () => {
    for (const device of devices) {
      for (const spelled of [device, device.toUpperCase(), device[0]!.toUpperCase() + device.slice(1)]) {
        for (const suffix of ["", ".txt", ".tar.gz", ".", " ", ". .", " .pdf"]) {
          const out = safeName(spelled + suffix);
          const base = (out.split(".")[0] ?? "").replace(/[. ]+$/, "");
          expect(base.toLowerCase(), `${spelled + suffix} -> ${out}`).not.toBe(device);
          expect(out, spelled + suffix).toMatch(/^_/);
        }
      }
    }
  });

  it("drops dots and spaces at the end, which Windows would drop anyway and which could hide a device name", () => {
    expect(safeName("report.pdf.")).toBe("report.pdf");
    expect(safeName("report.pdf ")).toBe("report.pdf");
    expect(safeName("report . . ")).toBe("report");
    expect(safeName("con .txt")).toMatch(/^_/);
    expect(safeName("nul. ")).toBe("_nul");
    expect(safeName("...")).toBe("file");
    expect(safeName("   ")).toBe("file");
  });

  it("keeps ordinary names that only look similar", () => {
    for (const name of ["console.txt", "connect.pdf", "auxiliary.docx", "null.json", "com10.txt", "lpt10.txt", "communication.pdf", "printer.pdf", "my con.txt", "a.con"]) {
      expect(safeName(name), name).toBe(name);
    }
    expect(safeName("Sampling plan (v2).docx")).toBe("Sampling plan (v2).docx");
    expect(safeName("meta.json")).toBe("_meta.json");
  });
});

/* ---------- storage space ---------- */

describe("storage space", () => {
  it("gives every account 2 GB unless the administrator sets another number, and shows it", async () => {
    expect(DEFAULT_FILES_QUOTA_MB).toBe(2048);
    const c = await signedInClient(env);
    const list = await c.get("/api/myfiles");
    expect(list.json.usage).toEqual({ usedBytes: 0, quotaBytes: 2048 * MB, fileCount: 0 });
    expect((await admin(env.dataDir, "set-files-quota", c.username, "5")).code).toBe(0);
    expect((await c.get("/api/myfiles")).json.usage.quotaBytes).toBe(5 * MB);
    expect((await admin(env.dataDir, "set-files-quota", c.username, "default")).code).toBe(0);
    expect((await c.get("/api/myfiles")).json.usage.quotaBytes).toBe(2048 * MB);
  });

  it("counts files attached to projects together with My files, for one limit", async () => {
    const c = await signedInClient(env);
    await admin(env.dataDir, "set-files-quota", c.username, "1");
    const attached = await c.upload("attached.bin", randomBytes(700 * 1024));
    expect(attached.status).toBe(201);
    expect(attached.json.file.size).toBe(700 * 1024);
    // the listing of My files already includes the attached file in the space used
    expect((await c.get("/api/myfiles")).json.usage.usedBytes).toBe(700 * 1024);
    // a second one of either kind is turned away with a message in plain words
    const my = await c.uploadMy("mine.bin", randomBytes(700 * 1024));
    expect(my.status).toBe(413);
    expect(my.json.error).toBe("quota-exceeded");
    expect(my.json.message).toMatch(/^Your file space is full \(.* of 1 MB used\)\. Delete some files and try again\.$/);
    const second = await c.upload("attached2.bin", randomBytes(700 * 1024));
    expect(second.status).toBe(413);
    expect(second.json.error).toBe("quota-exceeded");
    // chunked (no declared size) is stopped while it arrives
    const chunked = await c.call("POST", "/api/files", undefined, { "X-File-Name": "chunked.bin" }, randomBytes(700 * 1024));
    expect(chunked.status).toBe(413);
    expect(await readdir(join(env.dataDir, "users", c.userId, "files"))).toHaveLength(1);
    expect(await readdir(join(env.dataDir, "files", c.userId, ".incoming")).catch(() => [])).toEqual([]);
    // deleting the attached file gives the room back
    expect((await c.del(`/api/files/${attached.json.file.id}`)).status).toBe(204);
    expect((await c.uploadMy("mine.bin", randomBytes(700 * 1024))).status).toBe(201);
    expect((await admin(env.dataDir, "files-usage")).out).toContain(`${c.username}  1 file  0.7 MB  (limit 1 MB)`);
  });

  it("stores an attached file as it arrives, under a safe name, and refuses an empty one", async () => {
    const c = await signedInClient(env);
    const bytes = randomBytes(3000);
    const up = await c.upload("CON.txt", bytes);
    expect(up.status).toBe(201);
    expect(up.json.file.safeName).toBe("_CON.txt");
    const stored = await readFile(join(env.dataDir, "users", c.userId, "files", up.json.file.id, "_CON.txt"));
    expect(stored.equals(bytes)).toBe(true);
    const meta = JSON.parse(await readFile(join(env.dataDir, "users", c.userId, "files", up.json.file.id, "meta.json"), "utf8"));
    expect(meta.size).toBe(3000);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const empty = await c.upload("empty.bin", Buffer.alloc(0));
    expect(empty.status).toBe(400);
    expect(empty.json.message).toBe("The file is empty.");
    expect(await readdir(join(env.dataDir, "users", c.userId, "files"))).toHaveLength(1);
  });

  it("applies the same hourly upload limit to both kinds of upload", async () => {
    expect(MAX_ATTACHED_FILES).toBe(5000);
    const c = await signedInClient(env);
    // the account has used up its uploads for the hour (the limit is shared by My files and attached files)
    for (let i = 0; i < 2000; i++) env.server.app.myFilesUploads.hit(c.userId);
    const attached = await c.upload("a.bin", Buffer.from("x"));
    expect(attached.status).toBe(429);
    expect(attached.json.retryAfterSeconds).toBeGreaterThan(0);
    expect((await c.uploadMy("m.bin", Buffer.from("x"))).status).toBe(429);
    expect((await (await signedInClient(env)).upload("a.bin", Buffer.from("x"))).status).toBe(201);
  });
});

describe("a nearly full disk", () => {
  it("turns away new uploads and saves with a plain message, but still lets people delete and free space", async () => {
    expect(MIN_FREE_DISK_BYTES).toBe(5 * 1024 * MB);
    const c = await signedInClient(env);
    const project = await c.post("/api/projects", { project: sampleProject("Before the disk filled up") });
    expect(project.status).toBe(201);
    const file = await c.uploadMy("keep.bin", randomBytes(2000));
    const second = await c.uploadMy("keep-too.bin", randomBytes(2000));
    expect(file.status).toBe(201);
    expect(second.status).toBe(201);

    forgetDiskReading();
    const tight = await startServer({ dataDir: env.dataDir, webDir: env.webDir, port: 0, scrypt: FAST_SCRYPT, minFreeDiskBytes: Number.MAX_SAFE_INTEGER });
    try {
      const t = new Client(tight.port);
      t.cookie = c.cookie;
      for (const res of [
        await t.post("/api/projects", { project: sampleProject("Too late") }),
        await t.put(`/api/projects/${project.json.id}`, { project: sampleProject("Edited"), baseRevision: 1 }),
        await t.uploadMy("new.bin", randomBytes(100)),
        await t.upload("new-attached.bin", randomBytes(100)),
      ]) {
        expect(res.status).toBe(507);
        expect(res.json.error).toBe("disk-full");
        expect(res.json.message).toBe("The server's disk is almost full, so nothing new can be saved for now. Please tell the person who runs the server.");
      }
      // reading, signing in and out, and freeing space all still work
      expect((await t.get("/api/projects")).status).toBe(200);
      expect((await t.get("/api/myfiles")).status).toBe(200);
      expect((await t.del(`/api/myfiles/files/${file.json.file.id}`)).status).toBe(204);
      expect((await t.post("/api/myfiles/bulk", { action: "delete", ids: [second.json.file.id] })).json).toEqual({ done: 1, missing: 0 });
      expect((await t.del(`/api/projects/${project.json.id}`)).status).toBe(204);
      expect((await new Client(tight.port).post("/api/auth/login", { username: c.username, password: GOOD_PASSWORD })).status).toBe(200);
    } finally {
      await tight.close();
      forgetDiskReading();
    }
    // with the normal floor the same account can save again
    expect((await c.post("/api/projects", { project: sampleProject("After") })).status).toBe(201);
  });
});

/* ---------- how much one account can keep ---------- */

describe("how much one account can keep", () => {
  const fill = async (userId: string, collection: string, count: number, extension = ".json") => {
    const dir = join(env.dataDir, "users", userId, collection);
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < count; i++) await writeFile(join(dir, `${randomUUID()}${extension}`), "{}");
  };

  it("keeps at most 200 projects, with a plain message, and leaves other accounts alone", async () => {
    expect(MAX_PROJECTS).toBe(200);
    const c = await signedInClient(env);
    await fill(c.userId, "projects", MAX_PROJECTS);
    const refused = await c.post("/api/projects", { project: sampleProject("One too many") });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe("too-many");
    expect(refused.json.message).toBe("You already have 200 projects, which is the most this server keeps for one account. Delete some you no longer need, then try again.");
    const other = await signedInClient(env);
    expect((await other.post("/api/projects", { project: sampleProject("Fine") })).status).toBe(201);
  });

  it("keeps at most 100 templates", async () => {
    expect(MAX_TEMPLATES).toBe(100);
    const c = await signedInClient(env);
    await fill(c.userId, "templates", MAX_TEMPLATES);
    const refused = await c.post("/api/templates", { meta: { name: "One too many", version: "1" }, bytesBase64: Buffer.from("fictional").toString("base64") });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe("too-many");
    expect(refused.json.message).toContain("You already have 100 templates");
    const other = await signedInClient(env);
    expect((await other.post("/api/templates", { meta: { name: "Fine", version: "1" }, bytesBase64: Buffer.from("fictional").toString("base64") })).status).toBe(201);
  });

  it("keeps at most 300 items in each library", async () => {
    expect(MAX_LIBRARY_ITEMS).toBe(300);
    const c = await signedInClient(env);
    await fill(c.userId, "saved-answers", MAX_LIBRARY_ITEMS);
    const body = {
      set: { format: "gap-saved-answers", formatVersion: 1, name: "One too many (fictional)", savedAt: "2026-10-31T09:00:00.000Z", sourceProject: "Demo (fictional)", sides: "source", answers: [] },
    };
    const refused = await c.post("/api/saved-answers", body);
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe("too-many");
    expect(refused.json.message).toContain("You already have 300 saved answer sets");
    expect((await (await signedInClient(env)).post("/api/saved-answers", body)).status).toBe(201);
  });

  it("lets a full account keep saving over an item it already has", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gap-limits-"));
    try {
      const store = new Store(dir);
      const ctx = { app: { store }, user: { id: "u1" } } as never;
      for (const name of ["a.json", "b.json", "c.json"]) await store.writeJson(store.path("users", "u1", "things", name), {});
      await expect(requireRoomForItem(ctx, "things", null, 3, "things")).rejects.toMatchObject({ status: 400, code: "too-many" });
      await expect(requireRoomForItem(ctx, "things", "d.json", 3, "things")).rejects.toMatchObject({ code: "too-many" });
      await expect(requireRoomForItem(ctx, "things", "b.json", 3, "things")).resolves.toBeUndefined();
      await expect(requireRoomForItem(ctx, "things", null, 4, "things")).resolves.toBeUndefined();
      await expect(requireRoomForItem(ctx, "nothing-yet", null, 1, "things")).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers 413 to a library item or a small change that is bigger than its limit, and keeps working", async () => {
    expect(MAX_LIBRARY_BODY_BYTES).toBe(4 * MB);
    const c = await signedInClient(env);
    const bigItem = await c.call("POST", "/api/saved-answers", undefined, { "Content-Type": "application/json" }, Buffer.alloc(5 * MB, 32));
    expect(bigItem.status).toBe(413);
    expect(bigItem.json.error).toBe("too-large");
    const bigChange = await c.call("PATCH", `/api/templates/${randomUUID()}`, undefined, { "Content-Type": "application/json" }, Buffer.alloc(11 * MB, 32));
    expect(bigChange.status).toBe(413);
    expect((await c.get("/api/auth/me")).status).toBe(200);
  });

  it("slows an account that saves faster than a person could type, and tells it how long to wait", async () => {
    const c = await signedInClient(env);
    const nothing = randomUUID();
    let waited: { retryAfterSeconds: number; message: string } | undefined;
    for (let i = 0; i < 650 && !waited; i++) {
      const res = await c.put(`/api/saved-answers/${nothing}`, { set: {} });
      if (res.status === 429) waited = res.json;
    }
    expect(waited).toBeDefined();
    expect(waited!.message).toBe("You are saving very quickly. Please wait a moment and try again.");
    expect(waited!.retryAfterSeconds).toBeGreaterThan(0);
    expect(waited!.retryAfterSeconds).toBeLessThanOrEqual(60);
    // another account is not held up, and neither are reads
    expect((await (await signedInClient(env)).put(`/api/saved-answers/${nothing}`, { set: {} })).status).not.toBe(429);
    expect((await c.get("/api/saved-answers")).status).toBe(200);
  }, 60_000);
});

/* ---------- the trash ---------- */

describe("the trash", () => {
  it("removes entries older than 30 days, keeps newer ones, and writes each removal to the audit log", async () => {
    expect(TRASH_DAYS).toBe(30);
    const dir = await mkdtemp(join(tmpdir(), "gap-trash-"));
    try {
      const store = new Store(dir);
      const now = new Date("2026-11-08T12:00:00.000Z");
      const trash = (kind: string, name: string) => store.path("trash", "u1", kind, name);
      await mkdir(trash("projects", "x"), { recursive: true }).catch(() => undefined);
      const old = "2026-10-01T09-00-00-000Z-aaaaaaaa-old-project.json";
      const justOver = "2026-10-09T11-59-59-000Z-bbbbbbbb-just-over.json";
      const justUnder = "2026-10-09T12-00-01-000Z-cccccccc-just-under.json";
      const recent = "2026-11-07T08-00-00-000Z-dddddddd-recent.json";
      await writeFile(trash("projects", old), "{}");
      await writeFile(trash("projects", justOver), "{}");
      await writeFile(trash("projects", justUnder), "{}");
      await writeFile(trash("projects", recent), "{}");
      // a file folder (a deleted attached file) is removed whole
      const folder = "2026-09-15T10-00-00-000Z-eeeeeeee-fid";
      await mkdir(trash("files", folder), { recursive: true });
      await writeFile(join(trash("files", folder), "report.pdf"), "fictional");
      // an entry with no date in its name falls back to its change time
      await writeFile(trash("projects", "no-date-old.json"), "{}");
      await writeFile(trash("projects", "no-date-new.json"), "{}");
      const longAgo = new Date("2026-08-01T00:00:00Z");
      await utimes(trash("projects", "no-date-old.json"), longAgo, longAgo);
      await utimes(trash("projects", "no-date-new.json"), new Date("2026-11-08T11:00:00Z"), new Date("2026-11-08T11:00:00Z"));

      const removed = await store.sweepTrash(now);
      expect(removed).toBe(4);
      expect((await readdir(store.path("trash", "u1", "projects"))).sort()).toEqual([justUnder, "no-date-new.json", recent, "x"].sort());
      expect(await readdir(store.path("trash", "u1", "files"))).toEqual([]);

      const log = (await readFile(store.path("audit.log"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      const expired = log.filter((l) => l.event === "trash-expired");
      expect(expired).toHaveLength(4);
      expect(expired.map((l) => l.item).sort()).toEqual([folder, justOver, old, "no-date-old.json"].sort());
      for (const line of expired) expect(line).toMatchObject({ userId: "u1", days: 30 });
      // nothing left to remove the second time, and an empty or missing trash is fine
      expect(await store.sweepTrash(now)).toBe(0);
      expect(await new Store(join(dir, "nowhere")).sweepTrash(now)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads the date from the name that moving to the trash gives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gap-trash-"));
    try {
      const store = new Store(dir);
      await writeFile(join(dir, "gone.json"), "{}");
      await store.toTrash("u1", "projects", join(dir, "gone.json"), "gone.json");
      const [entry] = await readdir(store.path("trash", "u1", "projects"));
      const when = trashedAt(entry!);
      expect(when).toBeDefined();
      expect(Math.abs(Date.now() - when!)).toBeLessThan(60_000);
      expect(trashedAt("not-a-date.json")).toBeUndefined();
      expect(await store.sweepTrash()).toBe(0); // made just now
      expect(await store.sweepTrash(new Date(Date.now() + 31 * 24 * 3600 * 1000))).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/* ---------- slow and many connections ---------- */

describe("slow and many connections", () => {
  it("gives a normal request seconds to arrive and only an upload minutes", () => {
    expect(bodyTimeMs(false, 0)).toBe(20_000);
    expect(bodyTimeMs(false, 1_000)).toBe(20_010);
    expect(bodyTimeMs(false, 1_000_000)).toBe(30_000);
    expect(bodyTimeMs(false, 25 * MB)).toBeGreaterThan(200_000);
    expect(bodyTimeMs(false, 25 * MB)).toBeLessThanOrEqual(300_000);
    expect(bodyTimeMs(false, 10 * 1024 * MB)).toBe(300_000);
    expect(bodyTimeMs(false, undefined)).toBe(60_000);
    expect(bodyTimeMs(false, Number.NaN)).toBe(60_000);
    expect(bodyTimeMs(true, 1_000)).toBe(UPLOAD_BODY_MS);
    expect(bodyTimeMs(true, undefined)).toBe(UPLOAD_BODY_MS);
    expect(UPLOAD_BODY_MS).toBeGreaterThan(5 * 60_000);
  });

  it("answers 408 and closes the connection when a body stops arriving", async () => {
    let held: Server | undefined;
    const port = await new Promise<number>((resolve) => {
      held = createServer((req, res) => {
        limitBodyTime(req, res, 150);
        req.resume();
      }).listen(0, "127.0.0.1", () => resolve((held!.address() as { port: number }).port));
    });
    try {
      const outcome = await new Promise<{ reply: string; closed: boolean }>((resolve) => {
        const socket = connect(port, "127.0.0.1");
        let reply = "";
        socket.on("data", (d) => (reply += d.toString("utf8")));
        socket.on("close", () => resolve({ reply, closed: true }));
        socket.on("error", () => undefined);
        socket.write("POST /x HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\nonly a little");
        setTimeout(() => socket.destroy(), 5_000).unref();
      });
      expect(outcome.reply).toMatch(/^HTTP\/1\.1 408 /);
      expect(outcome.reply).toContain('"too-slow"');
      expect(outcome.reply).toContain("That took too long to send, so the connection was closed. Please try again.");
      expect(outcome.closed).toBe(true);
    } finally {
      held!.close();
      held!.closeAllConnections();
    }
  });

  it("does not interrupt a body that arrives in time", async () => {
    const c = await signedInClient(env);
    const res = await c.post("/api/auth/login", { username: c.username, password: GOOD_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("sets short header and request times and a ceiling on open connections", () => {
    expect(env.server.server.headersTimeout).toBe(15_000);
    expect(env.server.server.requestTimeout).toBe(10 * 60_000);
    expect(env.server.server.maxConnections).toBe(256);
  });

  it("turns away connections beyond the ceiling and takes them again when others close", async () => {
    const small = await startEnv({ serverOptions: { maxConnections: 3 } });
    const held: Socket[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const socket = connect(small.port, "127.0.0.1");
        socket.on("error", () => undefined);
        await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
        held.push(socket);
      }
      await sleep(150);
      await expect(rawRequest(small.port, { path: "/api/health", headers: { Connection: "close" } })).rejects.toThrow();
      for (const socket of held) socket.destroy();
      await sleep(150);
      const ok = await rawRequest(small.port, { path: "/api/health", headers: { Connection: "close" } });
      expect(ok.status).toBe(200);
    } finally {
      for (const socket of held) socket.destroy();
      await small.cleanup();
    }
  });
});

/* ---------- the data folder after a restore ---------- */

describe("a data folder restored without sessions and invites", () => {
  it("starts, asks everyone to sign in again, and signs in with the same password", async () => {
    const a = await startEnv();
    try {
      const c = await signedInClient(a, "restored.person");
      expect((await c.get("/api/auth/me")).status).toBe(200);
      // what a restore from the nightly copy gives: accounts, but no sessions.json and no invites.json
      await a.server.close();
      await rm(join(a.dataDir, "sessions.json"), { force: true });
      await rm(join(a.dataDir, "sessions.json.bak"), { force: true });
      await rm(join(a.dataDir, "invites.json"), { force: true });
      await rm(join(a.dataDir, "invites.json.bak"), { force: true });
      const again = await startServer({ dataDir: a.dataDir, webDir: a.webDir, port: 0, scrypt: FAST_SCRYPT, minFreeDiskBytes: 0 });
      try {
        expect((await rawRequest(again.port, { path: "/api/health" })).json).toEqual({ ok: true, storage: "server" });
        const old = new Client(again.port);
        old.cookie = c.cookie;
        expect((await old.get("/api/auth/me")).status).toBe(401);
        const fresh = new Client(again.port);
        expect((await fresh.post("/api/auth/login", { username: "restored.person", password: GOOD_PASSWORD })).status).toBe(200);
        expect((await fresh.get("/api/auth/me")).status).toBe(200);
        // new invites can be made again
        expect(await newInvite(a.dataDir)).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
      } finally {
        await again.close();
      }
    } finally {
      await rm(a.root, { recursive: true, force: true });
    }
  });
});
