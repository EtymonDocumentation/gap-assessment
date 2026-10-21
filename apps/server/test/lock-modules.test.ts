/// <reference types="node" />
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/app";
import { withFileLock } from "../src/store";
import { Client, FAST_SCRYPT, GOOD_PASSWORD, admin, initData, newInvite } from "./helpers";

let root: string;
let dataDir: string;
let server: RunningServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gap-lock-test-"));
  dataDir = join(root, "data");
  await initData(dataDir);
  server = undefined;
});
afterEach(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

const json = async (file: string) => JSON.parse(await readFile(join(dataDir, file), "utf8"));
const exists = (file: string) => stat(join(dataDir, file)).then(() => true, () => false);

describe("cross-process lock", () => {
  it("loses no write when the admin tool and the running server change the account files at the same time", async () => {
    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    const { port } = server;

    // Existing accounts to sign in as, and invites for the signups that will run during the storm.
    const existing: Client[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new Client(port);
      const res = await c.post("/api/auth/signup", {
        inviteCode: await newInvite(dataDir),
        username: `old.user${i}`,
        displayName: `Old ${i}`,
        password: GOOD_PASSWORD,
      });
      expect(res.status).toBe(201);
      existing.push(c);
    }
    const signupCodes: string[] = [];
    for (let i = 0; i < 6; i++) signupCodes.push(await newInvite(dataDir));

    // Each admin() call opens its own Store, exactly like a separate command-line process: only the lock file keeps them apart.
    const adminInvites = Array.from({ length: 12 }, () => admin(dataDir, "invite", "--modules", "gap"));
    const signups = signupCodes.map((code, i) =>
      new Client(port).post("/api/auth/signup", { inviteCode: code, username: `new.user${i}`, displayName: `New ${i}`, password: GOOD_PASSWORD }),
    );
    const logins = existing.flatMap((_, i) => [0, 1].map(() => new Client(port).post("/api/auth/login", { username: `old.user${i}`, password: GOOD_PASSWORD })));
    const adminDisables = [admin(dataDir, "disable", "old.user2"), admin(dataDir, "set-modules", "old.user0", "gap,extra")];
    const [invitesDone, signupsDone, loginsDone, adminDone] = await Promise.all([
      Promise.all(adminInvites),
      Promise.all(signups),
      Promise.all(logins),
      Promise.all(adminDisables),
    ]);

    expect(invitesDone.map((r) => r.code)).toEqual(Array(12).fill(0));
    expect(signupsDone.map((r) => r.status)).toEqual(Array(6).fill(201));
    for (const r of loginsDone) expect([200, 401]).toContain(r.status); // old.user2 may already be disabled
    expect(adminDone.map((r) => r.code)).toEqual([0, 0]);

    const invites = await json("invites.json");
    expect(invites).toHaveLength(3 + 6 + 12);
    expect(invites.filter((i: { usedBy?: string }) => i.usedBy)).toHaveLength(3 + 6); // every signup marked its invite
    const users = await json("users.json");
    expect(users.map((u: { username: string }) => u.username).sort()).toEqual(
      [...existing.map((_, i) => `old.user${i}`), ...signupCodes.map((_, i) => `new.user${i}`)].sort(),
    );
    expect(users.find((u: { username: string }) => u.username === "old.user2").disabled).toBe(true);
    expect(users.find((u: { username: string }) => u.username === "old.user0").plan.modules).toEqual(["gap", "extra"]);

    // No session was lost: old.user0 and old.user1 have their sign-up session plus two logins, every new account has its
    // sign-up session. (A disabled account's sessions are not checked: they are useless either way.)
    const sessions = (await json("sessions.json")) as { userId: string }[];
    const countFor = (name: string) => sessions.filter((s) => s.userId === users.find((u: { username: string }) => u.username === name).id).length;
    expect(countFor("old.user0")).toBe(3);
    expect(countFor("old.user1")).toBe(3);
    for (let i = 0; i < 6; i++) expect(countFor(`new.user${i}`), `new.user${i}`).toBe(1);
    expect(await exists(".lock")).toBe(false);
  });

  it("waits for a lock that is held, then goes ahead", async () => {
    await writeFile(join(dataDir, ".lock"), "someone-else");
    setTimeout(() => void rm(join(dataDir, ".lock"), { force: true }), 300);
    const started = Date.now();
    expect((await admin(dataDir, "invite")).code).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(await json("invites.json")).toHaveLength(1);
    expect(await exists(".lock")).toBe(false);
  });

  it("takes over a lock that is older than 30 seconds", async () => {
    const lock = join(dataDir, ".lock");
    await writeFile(lock, "crashed-process");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect((await admin(dataDir, "invite")).code).toBe(0);
    expect(await json("invites.json")).toHaveLength(1);
    expect(await exists(".lock")).toBe(false);
  });

  it("is released when the locked work fails, and never runs two at once", async () => {
    await expect(
      withFileLock(dataDir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await exists(".lock")).toBe(false);

    let running = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withFileLock(dataDir, async () => {
          most = Math.max(most, ++running);
          await new Promise((r) => setTimeout(r, 15));
          running--;
        }),
      ),
    );
    expect(most).toBe(1);
    expect(await exists(".lock")).toBe(false);
  });
});

describe("modules", () => {
  it("defaults an invite to the gap module, says so, and gives it to the new account", async () => {
    const res = await admin(dataDir, "invite");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Modules: gap");
    expect(res.out).toContain("default");
    expect((await json("invites.json"))[0].modules).toEqual(["gap"]);

    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    const code = /([A-Z0-9]{5}(?:-[A-Z0-9]{5}){3})/.exec(res.out)![1]!;
    const c = new Client(server.port);
    const signup = await c.post("/api/auth/signup", { inviteCode: code, username: "mod.one", displayName: "Mod One", password: GOOD_PASSWORD });
    expect(signup.status).toBe(201);
    expect(signup.json.user.plan).toMatchObject({ id: "trial-free", status: "active", modules: ["gap"] });
    expect((await c.get("/api/auth/me")).json.user.plan.modules).toEqual(["gap"]);
  });

  it("takes --modules on the invite, validates it, and lists it", async () => {
    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    const res = await admin(dataDir, "invite", "--modules", "Gap, Reports ,gap");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Modules: gap, reports.");
    expect(res.out).not.toContain("default");
    const code = /([A-Z0-9]{5}(?:-[A-Z0-9]{5}){3})/.exec(res.out)![1]!;
    for (const bad of ["", "a b", "gap,,x", "UP/PER", "x".repeat(41)]) {
      expect((await admin(dataDir, "invite", "--modules", bad)).code, `"${bad}"`).toBe(1);
    }
    expect(await json("invites.json")).toHaveLength(1);
    expect((await admin(dataDir, "invites")).out).toContain("modules gap,reports");

    const signup = await new Client(server.port).post("/api/auth/signup", { inviteCode: code, username: "mod.two", displayName: "Mod Two", password: GOOD_PASSWORD });
    expect(signup.json.user.plan.modules).toEqual(["gap", "reports"]);
  });

  it("changes an account's modules with set-modules, keeps them across set-plan, and shows them in users", async () => {
    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    const c = new Client(server.port);
    await c.post("/api/auth/signup", { inviteCode: await newInvite(dataDir), username: "mod.three", displayName: "Mod Three", password: GOOD_PASSWORD });

    const set = await admin(dataDir, "set-modules", "Mod.Three", "gap,extra");
    expect(set.code).toBe(0);
    expect((await c.get("/api/auth/me")).json.user.plan.modules).toEqual(["gap", "extra"]);
    expect((await admin(dataDir, "users")).out).toContain("modules gap,extra");

    expect((await admin(dataDir, "set-plan", "mod.three", "pro-monthly")).code).toBe(0);
    const me = (await c.get("/api/auth/me")).json.user.plan;
    expect(me).toMatchObject({ id: "pro-monthly", modules: ["gap", "extra"] });

    expect((await admin(dataDir, "set-modules", "mod.three", "Not Valid!")).code).toBe(1);
    expect((await admin(dataDir, "set-modules", "mod.three")).code).toBe(1);
    expect((await admin(dataDir, "set-modules", "ghost", "gap")).err).toContain('no user named "ghost"');
    expect((await c.get("/api/auth/me")).json.user.plan.modules).toEqual(["gap", "extra"]);
    expect(await readFile(join(dataDir, "audit.log"), "utf8")).toContain('"event":"modules-set"');
  });

  it("reads an account made before modules existed as [gap] and writes that back", async () => {
    server = await startServer({ dataDir, port: 0, scrypt: FAST_SCRYPT });
    const c = new Client(server.port);
    await c.post("/api/auth/signup", { inviteCode: await newInvite(dataDir), username: "old.timer", displayName: "Old Timer", password: GOOD_PASSWORD });
    const users = await json("users.json");
    delete users[0].plan.modules;
    await writeFile(join(dataDir, "users.json"), JSON.stringify(users));
    expect((await json("users.json"))[0].plan.modules).toBeUndefined();

    const me = await c.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.json.user.plan.modules).toEqual(["gap"]);
    expect((await json("users.json"))[0].plan.modules).toEqual(["gap"]);
    expect((await admin(dataDir, "users")).out).toContain("modules gap");
  });
});
