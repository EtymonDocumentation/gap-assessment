/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clearedCookie,
  createSession,
  deleteSessions,
  hashInviteCode,
  hashPassword,
  invitesFile,
  loadUsers,
  passwordProblem,
  publicUser,
  sessionCookie,
  usersFile,
  verifyPassword,
} from "../auth";
import { HttpError, MAX_AUTH_BODY_BYTES, sendJson, sendNoContent, type Ctx, type Route } from "../http";
import { DEFAULT_MODULES, DEFAULT_PLAN_ID, type InviteRecord, type UserRecord } from "../types";
import { VERSION } from "../version";
import { parseBody } from "./util";

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/i;
const INVALID_LOGIN = new HttpError(401, "login-failed", "The user name or password is not right.");

const signupSchema = z.object({
  inviteCode: z.string({ error: "Enter your invite code." }).min(1, "Enter your invite code.").max(64, "That invite code is not valid."),
  username: z
    .string({ error: "Choose a user name." })
    .regex(USERNAME_RE, "The user name must be 3 to 40 letters, digits, dots, dashes or underscores."),
  displayName: z
    .string({ error: "Enter your name." })
    .trim()
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]{1,80}$/, "Your name must be 1 to 80 characters."),
  password: z.string({ error: "Choose a password." }),
});

const loginSchema = z.object({
  username: z.string({ error: "Enter your user name." }).max(200, "The user name is too long."),
  password: z.string({ error: "Enter your password." }).max(1024, "The password is too long."),
});

const passwordSchema = z.object({
  currentPassword: z.string({ error: "Enter your current password." }).max(1024),
  newPassword: z.string({ error: "Choose a new password." }),
});

function throttle(retryAfterSeconds: number): never {
  throw new HttpError(429, "rate-limited", "Too many attempts. Please wait and try again.", { retryAfterSeconds });
}

/** Failed attempts are counted per user name (even unknown ones) and per caller address. */
function loginKey(username: string): string {
  return username.trim().toLowerCase().slice(0, 80);
}

/** A tried user name goes to the audit log only if it looks like one; people sometimes type a password there. */
function loggableName(username: string): string {
  const name = username.trim().toLowerCase();
  return USERNAME_RE.test(name) ? name : "(not a valid user name)";
}

async function startSession(ctx: Ctx, user: UserRecord, status: number): Promise<void> {
  const token = await createSession(ctx.app.store, user.id);
  sendJson(ctx.res, status, { user: publicUser(user) }, { "Set-Cookie": sessionCookie(token) });
}

export const authRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/health",
    async handler({ res, app }) {
      sendJson(res, 200, { ok: true, storage: app.config.storage, version: VERSION });
    },
  },

  {
    method: "POST",
    path: "/api/auth/signup",
    async handler(ctx) {
      const { app } = ctx;
      const retry = app.signupByIp.retryAfterSeconds(ctx.ip);
      if (retry > 0) throttle(retry);
      app.signupByIp.hit(ctx.ip);

      const body = parseBody(signupSchema, await ctx.json(MAX_AUTH_BODY_BYTES));
      const problem = passwordProblem(body.password);
      if (problem) throw new HttpError(400, "invalid", problem);

      const codeHash = hashInviteCode(body.inviteCode);
      const usable = (i: InviteRecord | undefined): i is InviteRecord =>
        !!i && !i.usedBy && !i.revoked && Date.parse(i.expiresAt) > Date.now();
      const noInvite = new HttpError(403, "invite-invalid", "That invite code cannot be used.");

      // Check the code before the slow password hash, so a wrong code costs us almost nothing.
      const early = (await app.store.readJson<InviteRecord[]>(invitesFile(app.store), [])).find((i) => i.codeHash === codeHash);
      if (!usable(early)) {
        await app.store.audit("signup-failed", { ip: ctx.ip, reason: "invite" });
        throw noInvite;
      }
      const passwordHash = await hashPassword(body.password, app.scrypt);

      // One signup at a time, so two people cannot use the same code.
      const user = await app.store.withLock("signup", async () => {
        const username = body.username.toLowerCase();
        const taken = new HttpError(409, "username-taken", "That user name is already taken.");
        if ((await loadUsers(app.store)).some((u) => u.username === username)) throw taken;
        const now = new Date().toISOString();
        const id = randomUUID();
        // The invite is checked and marked used in one locked step (the admin tool may be revoking it right now).
        let invite: InviteRecord | undefined;
        await app.store.update<InviteRecord[]>(invitesFile(app.store), [], (all) => {
          invite = all.find((i) => i.codeHash === codeHash);
          if (!usable(invite)) throw noInvite;
          return all.map((i) => (i.codeHash === codeHash ? { ...i, usedBy: id, usedAt: now } : i));
        });
        const role = (invite as InviteRecord | undefined)?.role ?? "member";
        const modules = (invite as InviteRecord | undefined)?.modules ?? [...DEFAULT_MODULES];
        const created: UserRecord = {
          id,
          username,
          displayName: body.displayName,
          role,
          passwordHash,
          createdAt: now,
          plan: { id: DEFAULT_PLAN_ID, status: "active", since: now, modules: [...modules] },
        };
        await app.store.update<UserRecord[]>(usersFile(app.store), [], (users) => {
          if (users.some((u) => u.username === created.username)) throw taken;
          return [...users, created];
        });
        return created;
      });
      await app.store.audit("signup", { userId: user.id, username: user.username, ip: ctx.ip });
      await startSession(ctx, user, 201);
    },
  },

  {
    method: "POST",
    path: "/api/auth/login",
    async handler(ctx) {
      const { app } = ctx;
      const body = parseBody(loginSchema, await ctx.json(MAX_AUTH_BODY_BYTES));
      const key = loginKey(body.username);
      const retry = Math.max(app.loginByUser.retryAfterSeconds(key), app.loginByIp.retryAfterSeconds(ctx.ip));
      if (retry > 0) throttle(retry);

      const user = (await loadUsers(app.store)).find((u) => u.username === key);
      // An unknown user is checked against a dummy hash, so the answer takes as long as for a real one.
      const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? app.dummyHash);
      if (!user || user.disabled || !passwordOk) {
        app.loginByUser.hit(key);
        app.loginByIp.hit(ctx.ip);
        await app.store.audit("login-failed", { username: loggableName(body.username), ip: ctx.ip });
        throw INVALID_LOGIN;
      }
      await app.store.audit("login", { userId: user.id, username: user.username, ip: ctx.ip });
      await startSession(ctx, user, 200);
    },
  },

  {
    method: "POST",
    path: "/api/auth/logout",
    auth: true,
    async handler({ res, app, user, sessionHash, ip }) {
      await deleteSessions(app.store, (s) => s.tokenHash !== sessionHash);
      await app.store.audit("logout", { userId: user.id, username: user.username, ip });
      sendNoContent(res, { "Set-Cookie": clearedCookie() });
    },
  },

  {
    method: "GET",
    path: "/api/auth/me",
    auth: true,
    async handler({ res, user }) {
      sendJson(res, 200, { user: publicUser(user) });
    },
  },

  {
    method: "POST",
    path: "/api/auth/password",
    auth: true,
    async handler(ctx) {
      const { app, user } = ctx;
      const body = parseBody(passwordSchema, await ctx.json(MAX_AUTH_BODY_BYTES));
      // A stolen session must not be a free way to guess the password, so wrong guesses count like failed logins.
      const retry = app.loginByUser.retryAfterSeconds(user.username);
      if (retry > 0) throttle(retry);
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        app.loginByUser.hit(user.username);
        throw new HttpError(403, "wrong-password", "The current password is not right.");
      }
      const problem = passwordProblem(body.newPassword);
      if (problem) throw new HttpError(400, "invalid", problem);

      const passwordHash = await hashPassword(body.newPassword, app.scrypt);
      await app.store.update<UserRecord[]>(usersFile(app.store), [], (users) =>
        users.map((u) => (u.id === user.id ? { ...u, passwordHash } : u)),
      );
      // Anyone else who is signed in as this user (maybe the reason for the change) is signed out.
      await deleteSessions(app.store, (s) => s.userId !== user.id || s.tokenHash === ctx.sessionHash);
      await app.store.audit("password-change", { userId: user.id, username: user.username, ip: ctx.ip });
      sendNoContent(ctx.res);
    },
  },
];
