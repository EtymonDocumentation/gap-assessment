/// <reference types="node" />
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "../src/app";
import { UsageError, serverOptionsFromArgs } from "../src/args";
import { ConfigError } from "../src/config";
import { hashInviteCode } from "../src/auth";
import { safeName } from "../src/names";
import { Client, FAST_SCRYPT, GOOD_PASSWORD, admin, initData, newInvite } from "./helpers";

let root: string;
let dataDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gap-admin-test-"));
  dataDir = join(root, "data");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const json = async (file: string) => JSON.parse(await readFile(join(dataDir, file), "utf8"));

describe("admin init", () => {
  it("creates config.json and empty account files, and says what to do next", async () => {
    const res = await admin(dataDir, "init", "--storage", "client", "--max-upload-mb", "25");
    expect(res.code).toBe(0);
    expect(res.out).toContain("admin invite");
    expect(await json("config.json")).toEqual({ storage: "client", maxUploadMB: 25 });
    for (const f of ["users.json", "invites.json", "sessions.json"]) expect(await json(f)).toEqual([]);
  });

  it("needs explicit settings and refuses to overwrite unless --force (accounts are kept)", async () => {
    expect((await admin(dataDir, "init", "--max-upload-mb", "5")).code).toBe(1);
    expect((await admin(dataDir, "init", "--storage", "everywhere", "--max-upload-mb", "5")).err).toContain("server");
    expect((await admin(dataDir, "init", "--storage", "server")).code).toBe(1);
    expect((await admin(dataDir, "init", "--storage", "server", "--max-upload-mb", "0")).code).toBe(1);
    expect((await admin(dataDir, "init", "--storage", "server", "--max-upload-mb", "5000")).code).toBe(1);
    await expect(readFile(join(dataDir, "config.json"), "utf8")).rejects.toThrow(); // failed commands wrote nothing

    await initData(dataDir, "server", 5);
    await admin(dataDir, "invite");
    const again = await admin(dataDir, "init", "--storage", "client", "--max-upload-mb", "9");
    expect(again.code).toBe(1);
    expect(again.err).toContain("--force");
    expect(await json("config.json")).toEqual({ storage: "server", maxUploadMB: 5 });

    const forced = await admin(dataDir, "init", "--storage", "client", "--max-upload-mb", "9", "--force");
    expect(forced.code).toBe(0);
    expect(await json("config.json")).toEqual({ storage: "client", maxUploadMB: 9 });
    expect(await json("invites.json")).toHaveLength(1);
  });
});

describe("admin invite", () => {
  beforeEach(() => initData(dataDir));

  it("prints the code once in 4 groups of 5 and stores only its hash", async () => {
    const res = await admin(dataDir, "invite", "--role", "admin", "--days", "3");
    expect(res.code).toBe(0);
    const code = /([A-Z0-9]{5}(?:-[A-Z0-9]{5}){3})/.exec(res.out)?.[1];
    expect(code).toBeDefined();
    const stored = await json("invites.json");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ codeHash: hashInviteCode(code!), role: "admin" });
    expect(JSON.stringify(stored)).not.toContain(code!);
    const days = (Date.parse(stored[0].expiresAt) - Date.parse(stored[0].createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(3, 3);

    const listing = await admin(dataDir, "invites");
    expect(listing.out).not.toContain(code!);
    expect(listing.out).toContain(stored[0].codeHash.slice(0, 8));
    expect(listing.out).toContain("unused");
    expect(await readFile(join(dataDir, "audit.log"), "utf8")).not.toContain(code!);
  });

  it("defaults to a member invite for 7 days and checks its options", async () => {
    await admin(dataDir, "invite");
    const [invite] = await json("invites.json");
    expect(invite.role).toBe("member");
    expect((Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)) / 86_400_000).toBeCloseTo(7, 3);
    for (const bad of [["--role", "owner"], ["--days", "0"], ["--days", "400"], ["--days", "soon"]]) {
      expect((await admin(dataDir, "invite", ...bad)).code, bad.join(" ")).toBe(1);
    }
    expect(await json("invites.json")).toHaveLength(1);
  });

  it("revokes by list number or by hash start, and shows used and revoked invites", async () => {
    const used = await newInvite(dataDir);
    await newInvite(dataDir);
    await newInvite(dataDir);
    const [, second, third] = await json("invites.json");

    expect((await admin(dataDir, "revoke-invite", "2")).out).toContain(second.codeHash.slice(0, 8));
    expect((await admin(dataDir, "revoke-invite", third.codeHash.slice(0, 6))).code).toBe(0);
    expect((await admin(dataDir, "revoke-invite", "2")).err).toContain("already revoked");
    expect((await admin(dataDir, "revoke-invite", "9")).code).toBe(1);
    expect((await admin(dataDir, "revoke-invite", "zzzz")).code).toBe(1);
    expect((await admin(dataDir, "revoke-invite")).code).toBe(1);
    expect((await json("invites.json")).map((i: { revoked?: boolean }) => !!i.revoked)).toEqual([false, true, true]);

    // an invite that was used cannot be revoked
    const server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    try {
      const signup = await new Client(server.port).post("/api/auth/signup", { inviteCode: used, username: "invited.one", displayName: "Invited", password: GOOD_PASSWORD });
      expect(signup.status).toBe(201);
    } finally {
      await server.close();
    }
    expect((await admin(dataDir, "revoke-invite", "1")).err).toContain("already been used");
    const listing = (await admin(dataDir, "invites")).out.split("\n");
    expect(listing[0]).toContain("used by invited.one");
    expect(listing[1]).toContain("revoked");
  });
});

describe("admin users", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeEach(async () => {
    await initData(dataDir);
    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
  });
  afterEach(() => server.close());

  const signup = async (username: string, role?: string) => {
    const c = new Client(server.port);
    const code = await newInvite(dataDir, ...(role ? ["--role", role] : []));
    const res = await c.post("/api/auth/signup", { inviteCode: code, username, displayName: `Name of ${username}`, password: GOOD_PASSWORD });
    expect(res.status).toBe(201);
    return c;
  };

  it("lists users without hashes", async () => {
    expect((await admin(dataDir, "users")).out).toContain("no accounts");
    await signup("ann.admin", "admin");
    await signup("ben.member");
    const res = await admin(dataDir, "users");
    expect(res.code).toBe(0);
    expect(res.out).toContain("ann.admin");
    expect(res.out).toContain("admin");
    expect(res.out).toContain("ben.member");
    expect(res.out).toContain("trial-free");
    expect(res.out).not.toContain("scrypt");
  });

  it("disables and enables an account, signing it out at once", async () => {
    const c = await signup("dana.user");
    const off = await admin(dataDir, "disable", "Dana.User");
    expect(off.code).toBe(0);
    expect((await c.get("/api/auth/me")).status).toBe(401);
    expect((await new Client(server.port).post("/api/auth/login", { username: "dana.user", password: GOOD_PASSWORD })).status).toBe(401);
    expect((await admin(dataDir, "users")).out).toContain("DISABLED");
    const [danaRecord] = await json("users.json");
    expect((await json("sessions.json")).filter((s: { userId: string }) => s.userId === danaRecord.id)).toEqual([]);

    expect((await admin(dataDir, "enable", "dana.user")).code).toBe(0);
    expect((await new Client(server.port).post("/api/auth/login", { username: "dana.user", password: GOOD_PASSWORD })).status).toBe(200);
    expect((await json("users.json"))[0].disabled).toBeUndefined();
    const log = await readFile(join(dataDir, "audit.log"), "utf8");
    expect(log).toContain('"event":"user-disabled"');
    expect(log).toContain('"event":"user-enabled"');
  });

  it("revokes sessions and sets the plan", async () => {
    const c = await signup("eli.user");
    const other = new Client(server.port);
    await other.post("/api/auth/login", { username: "eli.user", password: GOOD_PASSWORD });
    const res = await admin(dataDir, "sessions-revoke", "eli.user");
    expect(res.out).toContain("2 sessions");
    expect((await c.get("/api/auth/me")).status).toBe(401);
    expect((await other.get("/api/auth/me")).status).toBe(401);

    expect((await admin(dataDir, "set-plan", "eli.user", "pro-monthly")).code).toBe(0);
    const [user] = await json("users.json");
    expect(user.plan).toMatchObject({ id: "pro-monthly", status: "active" });
    expect(Date.parse(user.plan.since)).not.toBeNaN();
    expect((await new Client(server.port).post("/api/auth/login", { username: "eli.user", password: GOOD_PASSWORD })).json.user.plan.id).toBe("pro-monthly");
    expect((await admin(dataDir, "set-plan", "eli.user", "Not Valid!")).code).toBe(1);
    expect((await admin(dataDir, "set-plan", "eli.user")).code).toBe(1);
  });

  it("fails with a non-zero code and a plain message for an unknown user", async () => {
    for (const cmd of [["disable", "ghost"], ["enable", "ghost"], ["sessions-revoke", "ghost"], ["set-plan", "ghost", "x-plan"]]) {
      const res = await admin(dataDir, ...cmd);
      expect(res.code, cmd.join(" ")).toBe(1);
      expect(res.err).toContain('no user named "ghost"');
    }
    expect((await admin(dataDir, "disable")).code).toBe(1);
  });
});

describe("admin errors", () => {
  it("needs --data, a known command, and an initialised folder", async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const { runAdmin } = await import("../src/admin-commands");
    expect(await runAdmin(["users"], io)).toBe(1);
    expect(lines.join("\n")).toContain("--data");
    expect(await runAdmin([], io)).toBe(1);
    expect(await runAdmin(["dance", "--data", dataDir], io)).toBe(1);
    const res = await admin(dataDir, "users"); // folder does not exist yet
    expect(res.code).toBe(1);
    expect(res.err).toContain("admin init");
    expect((await admin(dataDir, "invite")).code).toBe(1);
  });
});

describe("server start-up", () => {
  it("refuses to start without --data, without a data folder, or without config.json", async () => {
    expect(() => serverOptionsFromArgs([])).toThrow(UsageError);
    expect(() => serverOptionsFromArgs(["--port", "8787"])).toThrow(/--data/);
    expect(() => serverOptionsFromArgs(["--data", dataDir, "--port", "70000"])).toThrow(/--port/);
    expect(() => serverOptionsFromArgs(["--data"])).toThrow(/needs a value/);
    expect(serverOptionsFromArgs(["--data", "d", "--web", "w", "--port", "8788"])).toEqual({ dataDir: "d", webDir: "w", port: 8788 });
    expect(serverOptionsFromArgs(["--data", "d"])).toEqual({ dataDir: "d", port: 8787 });

    await expect(startServer({ dataDir, port: 0 })).rejects.toThrow(ConfigError); // folder missing
    await mkdir(dataDir, { recursive: true });
    await expect(startServer({ dataDir, port: 0 })).rejects.toThrow(/admin init/); // no config.json
    await writeFile(join(dataDir, "config.json"), "{not json");
    await expect(startServer({ dataDir, port: 0 })).rejects.toThrow(/not valid JSON/);
    await writeFile(join(dataDir, "config.json"), JSON.stringify({ storage: "everywhere", maxUploadMB: 5 }));
    await expect(startServer({ dataDir, port: 0 })).rejects.toThrow(/not valid/);
    await writeFile(join(dataDir, "config.json"), JSON.stringify({ storage: "server" }));
    await expect(startServer({ dataDir, port: 0 })).rejects.toThrow(/maxUploadMB/);
  });

  it("refuses a web folder that does not exist", async () => {
    await initData(dataDir);
    await expect(startServer({ dataDir, port: 0, webDir: join(root, "nope") })).rejects.toThrow(/web folder/);
  });
});

describe("safeName", () => {
  it("is stable on its own output and never returns a path or an empty name", () => {
    const nasty = ["..\\..\\x.exe", "a/b/c.txt", "con", "", "....", "x".repeat(500), "a\u0000b", "name.‮txt", "COM1", "file . "];
    for (const input of nasty) {
      const out = safeName(input);
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(120);
      expect(out).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
      expect(out).not.toMatch(/^[. ]|[. ]$/);
      expect(safeName(out)).toBe(out);
    }
  });
});
