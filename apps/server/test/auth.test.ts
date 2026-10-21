/// <reference types="node" />
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_PASSWORD, PRODUCTION_SCRYPT, RateLimiter, hashInviteCode, hashPassword, newInviteCode, sha256Hex, verifyPassword } from "../src/auth";
import { clientIp } from "../src/http";
import { Client, GOOD_PASSWORD, admin, newInvite, rawRequest, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

const signupBody = (inviteCode: string, username: string, extra: Record<string, unknown> = {}) => ({
  inviteCode,
  username,
  displayName: "Test Person",
  password: GOOD_PASSWORD,
  ...extra,
});

describe("signup", () => {
  it("creates an account with a valid invite, sets a session and marks the invite used", async () => {
    const c = new Client(env.port);
    const code = await newInvite(env.dataDir);
    const res = await c.post("/api/auth/signup", signupBody(code, "Alice.Test"));
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({ username: "alice.test", displayName: "Test Person", role: "member", plan: { id: "trial-free", status: "active" } });
    expect(res.json.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.json)).not.toContain("scrypt$");
    expect((await c.get("/api/auth/me")).json.user.username).toBe("alice.test");

    const invites = JSON.parse(await readFile(join(env.dataDir, "invites.json"), "utf8"));
    const mine = invites.find((i: { codeHash: string }) => i.codeHash === hashInviteCode(code));
    expect(mine.usedBy).toBe(res.json.user.id);
    expect(JSON.stringify(invites)).not.toContain(code);
  });

  it("gives an admin invite the admin role", async () => {
    const c = new Client(env.port);
    const res = await c.post("/api/auth/signup", signupBody(await newInvite(env.dataDir, "--role", "admin"), "boss.person"));
    expect(res.json.user.role).toBe("admin");
  });

  it("accepts the code in lower case and without dashes", async () => {
    const code = await newInvite(env.dataDir);
    const res = await new Client(env.port).post("/api/auth/signup", signupBody(code.toLowerCase().replaceAll("-", " "), "casey.test"));
    expect(res.status).toBe(201);
  });

  it("refuses a used invite with the same message as every other invite failure", async () => {
    const code = await newInvite(env.dataDir);
    expect((await new Client(env.port).post("/api/auth/signup", signupBody(code, "first.user"))).status).toBe(201);
    const used = await new Client(env.port).post("/api/auth/signup", signupBody(code, "second.user"));
    const unknown = await new Client(env.port).post("/api/auth/signup", signupBody("AAAAA-AAAAA-AAAAA-AAAAA", "third.user"));
    expect(used.status).toBe(403);
    expect(used.json.error).toBe("invite-invalid");
    expect(unknown.json).toEqual(used.json);
  });

  it("refuses an expired invite and a revoked invite", async () => {
    const expired = await newInvite(env.dataDir);
    const path = join(env.dataDir, "invites.json");
    const all = JSON.parse(await readFile(path, "utf8"));
    for (const i of all) if (i.codeHash === hashInviteCode(expired)) i.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(path, JSON.stringify(all));
    const a = await new Client(env.port).post("/api/auth/signup", signupBody(expired, "late.user"));
    expect(a.status).toBe(403);
    expect(a.json.error).toBe("invite-invalid");

    const revoked = await newInvite(env.dataDir);
    const list = await admin(env.dataDir, "invites");
    const index = list.out.split("\n").length; // the newest invite is the last line
    expect((await admin(env.dataDir, "revoke-invite", String(index))).code).toBe(0);
    const b = await new Client(env.port).post("/api/auth/signup", signupBody(revoked, "revoked.user"));
    expect(b.status).toBe(403);
    expect(b.json.error).toBe("invite-invalid");
  });

  it("refuses a taken user name (case-insensitive) and keeps the invite for another try", async () => {
    await signedInClient(env, "taken.name");
    const code = await newInvite(env.dataDir);
    const res = await new Client(env.port).post("/api/auth/signup", signupBody(code, "TAKEN.name"));
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("username-taken");
    expect((await new Client(env.port).post("/api/auth/signup", signupBody(code, "free.name"))).status).toBe(201);
  });

  it("validates the input", async () => {
    const code = await newInvite(env.dataDir);
    const c = new Client(env.port);
    for (const bad of [
      { username: "ab" },
      { username: "has space" },
      { username: "x".repeat(41) },
      { displayName: "" },
      { password: "short" },
      { password: "a".repeat(MIN_PASSWORD - 1) },
      { password: 12345678901234 },
    ]) {
      const res = await c.post("/api/auth/signup", signupBody(code, "valid.name", bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.json.error).toBe("invalid");
      expect(res.json.message).toEqual(expect.any(String));
    }
    // none of those used the invite
    expect((await c.post("/api/auth/signup", signupBody(code, "valid.name"))).status).toBe(201);
  });

  it("lets only one of two simultaneous signups use the same invite", async () => {
    const code = await newInvite(env.dataDir);
    const results = await Promise.all([
      new Client(env.port).post("/api/auth/signup", signupBody(code, "race.one")),
      new Client(env.port).post("/api/auth/signup", signupBody(code, "race.two")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
  });

  it("limits signup attempts to 10 per address per hour", async () => {
    const c = new Client(env.port);
    for (let i = 0; i < 10; i++) expect((await c.post("/api/auth/signup", signupBody("BBBBB-BBBBB-BBBBB-BBBBB", "nobody.here"))).status).toBe(403);
    const res = await c.post("/api/auth/signup", signupBody("BBBBB-BBBBB-BBBBB-BBBBB", "nobody.here"));
    expect(res.status).toBe(429);
    expect(res.json.error).toBe("rate-limited");
    expect(res.json.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

describe("login, session and cookie", () => {
  it("signs in, sets a session cookie with all the safety flags, and signs out", async () => {
    const user = await signedInClient(env, "login.ok");
    const c = new Client(env.port);
    const res = await c.post("/api/auth/login", { username: "LOGIN.ok", password: GOOD_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json.user.username).toBe("login.ok");
    const cookie = [res.headers["set-cookie"]].flat().find((x) => x?.startsWith("gap_session=")) ?? "";
    expect(cookie).toMatch(/^gap_session=[A-Za-z0-9_-]{43};/);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=1209600"]) expect(cookie).toContain(flag);

    // only the hash of the token is stored
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const stored = await readFile(join(env.dataDir, "sessions.json"), "utf8");
    expect(stored).not.toContain(token);
    expect(stored).toContain(sha256Hex(token));

    expect((await c.get("/api/auth/me")).status).toBe(200);
    const out = await c.post("/api/auth/logout");
    expect(out.status).toBe(204);
    expect([out.headers["set-cookie"]].flat().join()).toContain("Max-Age=0");
    expect((await c.get("/api/auth/me")).status).toBe(401);
    // the old token is dead on the server too
    const replay = await rawGet(env.port, "/api/auth/me", `gap_session=${token}`);
    expect(replay.status).toBe(401);
    expect(replay.json.error).toBe("signed-out");
    expect((await user.get("/api/auth/me")).status).toBe(200); // the other session is untouched
  });

  it("gives the same answer for an unknown user, a wrong password and a disabled account", async () => {
    await signedInClient(env, "same.msg");
    await signedInClient(env, "off.user");
    expect((await admin(env.dataDir, "disable", "off.user")).code).toBe(0);
    const c = new Client(env.port);
    const unknown = await c.post("/api/auth/login", { username: "no.such.user", password: GOOD_PASSWORD });
    const wrong = await c.post("/api/auth/login", { username: "same.msg", password: "not the password!" });
    const disabled = await c.post("/api/auth/login", { username: "off.user", password: GOOD_PASSWORD });
    for (const r of [unknown, wrong, disabled]) {
      expect(r.status).toBe(401);
      expect(r.json.error).toBe("login-failed");
    }
    expect(wrong.json).toEqual(unknown.json);
    expect(disabled.json).toEqual(unknown.json);
  });

  it("locks a user name after 5 failures in 15 minutes (429 with retryAfterSeconds), even for the right password", async () => {
    await signedInClient(env, "locked.user");
    const attacker = new Client(env.port);
    for (let i = 0; i < 5; i++) expect((await attacker.post("/api/auth/login", { username: "locked.user", password: "wrong wrong wrong" })).status).toBe(401);
    const blocked = await new Client(env.port).post("/api/auth/login", { username: "locked.user", password: GOOD_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ error: "rate-limited" });
    expect(blocked.json.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.json.retryAfterSeconds).toBeLessThanOrEqual(900);
    // unknown names are counted too, so the lock does not reveal which names exist
    for (let i = 0; i < 5; i++) await attacker.post("/api/auth/login", { username: "ghost.user", password: "wrong wrong wrong" });
    expect((await attacker.post("/api/auth/login", { username: "ghost.user", password: "x" })).status).toBe(429);
  });

  it("limits failures to 20 per client address, using X-Forwarded-For because the peer is this machine", async () => {
    const same = "203.0.113.50";
    for (let i = 0; i < 20; i++) {
      const res = await new Client(env.port).post("/api/auth/login", { username: `spray.${i}`, password: "wrong wrong wrong" }, { "X-Forwarded-For": same });
      expect(res.status).toBe(401);
    }
    const blocked = await new Client(env.port).post("/api/auth/login", { username: "spray.new", password: "x" }, { "X-Forwarded-For": same });
    expect(blocked.status).toBe(429);
    const other = await new Client(env.port).post("/api/auth/login", { username: "spray.new", password: "x" }, { "X-Forwarded-For": "203.0.113.51" });
    expect(other.status).toBe(401);
  });

  it("uses only the first X-Forwarded-For entry, and only when the peer is this machine", () => {
    expect(clientIp("127.0.0.1", "198.51.100.1, 10.0.0.2")).toBe("198.51.100.1");
    expect(clientIp("::1", "198.51.100.1")).toBe("198.51.100.1");
    expect(clientIp("::ffff:127.0.0.1", "2001:db8::1")).toBe("2001:db8::1");
    expect(clientIp("192.0.2.9", "198.51.100.1")).toBe("192.0.2.9");
    expect(clientIp("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(clientIp("127.0.0.1", "not an address <script>")).toBe("127.0.0.1");
  });

  it("signs out a disabled user at once, and lets them back after enable", async () => {
    const c = await signedInClient(env, "toggle.user");
    expect((await c.get("/api/auth/me")).status).toBe(200);
    await admin(env.dataDir, "disable", "toggle.user");
    expect((await c.get("/api/auth/me")).status).toBe(401);
    await admin(env.dataDir, "enable", "toggle.user");
    expect((await new Client(env.port).post("/api/auth/login", { username: "toggle.user", password: GOOD_PASSWORD })).status).toBe(200);
  });

  it("refuses an expired session", async () => {
    const c = await signedInClient(env, "expiring.user");
    const path = join(env.dataDir, "sessions.json");
    const all = JSON.parse(await readFile(path, "utf8"));
    const mine = all.filter((s: { userId: string }) => s.userId === c.userId);
    for (const s of mine) s.expiresAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(path, JSON.stringify(all));
    const res = await c.get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("signed-out");
  });
});

describe("password change", () => {
  it("changes the password, keeps this session and revokes the other ones", async () => {
    const first = await signedInClient(env, "pw.change");
    const second = new Client(env.port);
    expect((await second.post("/api/auth/login", { username: "pw.change", password: GOOD_PASSWORD })).status).toBe(200);

    const bad = await first.post("/api/auth/password", { currentPassword: "wrong wrong wrong", newPassword: "a brand new password" });
    expect(bad.status).toBe(403);
    expect((await first.post("/api/auth/password", { currentPassword: GOOD_PASSWORD, newPassword: "short" })).status).toBe(400);
    expect((await first.post("/api/auth/password", { currentPassword: GOOD_PASSWORD, newPassword: "a brand new password" })).status).toBe(204);

    expect((await first.get("/api/auth/me")).status).toBe(200);
    expect((await second.get("/api/auth/me")).status).toBe(401);
    const c = new Client(env.port);
    expect((await c.post("/api/auth/login", { username: "pw.change", password: GOOD_PASSWORD })).status).toBe(401);
    expect((await c.post("/api/auth/login", { username: "pw.change", password: "a brand new password" })).status).toBe(200);
  });

  it("needs a session", async () => {
    const res = await new Client(env.port).post("/api/auth/password", { currentPassword: "x", newPassword: "y" });
    expect(res.status).toBe(401);
  });
});

describe("audit log", () => {
  it("records the events and never a password, token or invite code", async () => {
    const code = await newInvite(env.dataDir);
    const c = new Client(env.port);
    await c.post("/api/auth/signup", signupBody(code, "audit.user", { password: "very secret audit pw" }));
    await c.post("/api/auth/logout");
    await c.post("/api/auth/login", { username: "audit.user", password: "wrong wrong wrong" });
    await c.post("/api/auth/login", { username: "a password typed into the name box", password: "x" });
    const log = await readFile(join(env.dataDir, "audit.log"), "utf8");
    const lines = log.trim().split("\n").map((l) => JSON.parse(l));
    const events = lines.map((l) => l.event);
    for (const e of ["init", "invite-created", "signup", "logout", "login-failed"]) expect(events).toContain(e);
    expect(log).not.toContain("very secret audit pw");
    expect(log).not.toContain("wrong wrong wrong");
    expect(log).not.toContain(code);
    expect(log).not.toContain("a password typed into the name box");
    expect(log).not.toMatch(/gap_session|passwordHash|scrypt\$/);
  });
});

describe("passwords and codes", () => {
  it("uses the production scrypt settings by default and stores salt and hash in base64", async () => {
    expect(PRODUCTION_SCRYPT).toEqual({ N: 2 ** 15, r: 8, p: 1 });
    const stored = await hashPassword("a long enough password");
    const [tag, n, r, p, salt, hash] = stored.split("$");
    expect([tag, n, r, p]).toEqual(["scrypt", "32768", "8", "1"]);
    expect(Buffer.from(salt!, "base64")).toHaveLength(16);
    expect(Buffer.from(hash!, "base64")).toHaveLength(64);
    expect(await verifyPassword("a long enough password", stored)).toBe(true);
    expect(await verifyPassword("a long enough passworD", stored)).toBe(false);
    expect(await hashPassword("a long enough password")).not.toBe(stored); // new salt each time
  });

  it("rejects malformed stored hashes instead of crashing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2$3$4", "scrypt$3$8$1$AAAA$AAAA", "bcrypt$32768$8$1$AAAA$AAAA", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("whatever", bad)).toBe(false);
    }
  });

  it("makes invite codes of 4 groups of 5 unambiguous characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });

  it("counts events in a sliding window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.retryAfterSeconds("k", 0)).toBe(0);
    limiter.hit("k", 0);
    limiter.hit("k", 100);
    expect(limiter.retryAfterSeconds("k", 200)).toBe(1);
    expect(limiter.retryAfterSeconds("other", 200)).toBe(0);
    expect(limiter.retryAfterSeconds("k", 1001)).toBe(0); // the first hit has left the window
  });
});

describe("production scrypt in the running server", () => {
  it("hashes with N=2^15 when no test option is given", async () => {
    const prod = await startEnv({ productionScrypt: true });
    try {
      const c = await signedInClient(prod, "prod.params");
      const users = JSON.parse(await readFile(join(prod.dataDir, "users.json"), "utf8"));
      expect(users[0].passwordHash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      expect(prod.server.app.dummyHash).toMatch(/^scrypt\$32768\$8\$1\$/);
      expect((await new Client(prod.port).post("/api/auth/login", { username: "prod.params", password: GOOD_PASSWORD })).status).toBe(200);
      expect(c.userId).toBe(users[0].id);
    } finally {
      await prod.cleanup();
    }
  });
});

function rawGet(port: number, path: string, cookie: string) {
  return rawRequest(port, { path, headers: { Cookie: cookie } });
}
