/// <reference types="node" />
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { DEFAULT_MODULES, type Plan, type PublicUser, type SessionRecord, type UserRecord } from "./types";
import type { Store } from "./store";

/* ---------- passwords ---------- */

export const SCRYPT_N = 2 ** 15;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
export const MIN_PASSWORD = 7;
export const MAX_PASSWORD = 256;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const PRODUCTION_SCRYPT: ScryptParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // Node's default memory cap (32 MiB) is exactly what N=2^15, r=8 needs, so raise it with headroom.
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r + 16 * 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N$r$p$salt$hash` (salt and hash in base64). */
export async function hashPassword(password: string, params: ScryptParams = PRODUCTION_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Compares in constant time. A malformed or unsupported stored hash simply fails. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const valid = Number.isInteger(N) && N >= 2 && N <= 2 ** 20 && (N & (N - 1)) === 0 && r >= 1 && r <= 16 && p >= 1 && p <= 4;
  if (!valid) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;
  const actual = await derive(password, salt, { N, r, p });
  return timingSafeEqual(actual, expected);
}

/** Checks a new password against the written rules; returns the problem or null. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "The password must be text.";
  if (password.length < MIN_PASSWORD) return `The password must be at least ${MIN_PASSWORD} characters long.`;
  if (password.length > MAX_PASSWORD) return `The password must be at most ${MAX_PASSWORD} characters long.`;
  return null;
}

/* ---------- sessions ---------- */

export const SESSION_COOKIE = "gap_session";
export const SESSION_SECONDS = 14 * 24 * 60 * 60;
const TOUCH_AFTER_MS = 10 * 60 * 1000;

export const sha256Hex = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export const usersFile = (s: Store) => s.path("users.json");
export const invitesFile = (s: Store) => s.path("invites.json");
export const sessionsFile = (s: Store) => s.path("sessions.json");

type StoredUser = Omit<UserRecord, "plan"> & { plan: Omit<Plan, "modules"> & { modules?: string[] } };

const hasModules = (u: StoredUser): boolean => Array.isArray(u.plan?.modules);
const withModules = (u: StoredUser): UserRecord =>
  hasModules(u) ? (u as UserRecord) : { ...u, plan: { ...u.plan, modules: [...DEFAULT_MODULES] } };

/**
 * All accounts. Accounts made before plans carried modules read as ["gap"]; the file is rewritten with them
 * the first time such an account is seen (under the lock, from a fresh read).
 */
export async function loadUsers(store: Store): Promise<UserRecord[]> {
  const raw = await store.readJson<StoredUser[]>(usersFile(store), []);
  if (raw.every(hasModules)) return raw as UserRecord[];
  await store.update<StoredUser[]>(usersFile(store), [], (all) => all.map(withModules)).catch(() => undefined);
  return raw.map(withModules);
}

/** Creates a session and returns the token. Only its hash is stored. */
export async function createSession(store: Store, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const record: SessionRecord = {
    tokenHash: sha256Hex(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_SECONDS * 1000).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
  };
  await store.update<SessionRecord[]>(sessionsFile(store), [], (all) => [...all.filter((s) => Date.parse(s.expiresAt) > now), record]);
  return token;
}

export async function deleteSessions(store: Store, keep: (s: SessionRecord) => boolean): Promise<number> {
  let removed = 0;
  await store.update<SessionRecord[]>(sessionsFile(store), [], (all) => {
    const kept = all.filter(keep);
    removed = all.length - kept.length;
    return kept;
  });
  return removed;
}

export async function purgeExpiredSessions(store: Store): Promise<void> {
  const now = Date.now();
  await deleteSessions(store, (s) => Date.parse(s.expiresAt) > now);
}

/** The signed-in user for a session token, or null (unknown, expired, user gone or disabled). */
export async function findSession(
  store: Store,
  token: string | undefined,
): Promise<{ user: UserRecord; session: SessionRecord } | null> {
  if (!token || token.length > 128) return null;
  const hash = sha256Hex(token);
  const session = (await store.readJson<SessionRecord[]>(sessionsFile(store), [])).find((s) => s.tokenHash === hash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = (await loadUsers(store)).find((u) => u.id === session.userId);
  if (!user || user.disabled) return null;
  // lastSeenAt is only written now and then, so reading a page does not rewrite the file every time.
  if (Date.now() - Date.parse(session.lastSeenAt) > TOUCH_AFTER_MS) {
    await store
      .update<SessionRecord[]>(sessionsFile(store), [], (all) =>
        all.map((s) => (s.tokenHash === hash ? { ...s, lastSeenAt: new Date().toISOString() } : s)),
      )
      .catch(() => undefined);
  }
  return { user, session };
}

export function publicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    plan: { ...u.plan, modules: [...u.plan.modules] },
  };
}

/* ---------- invite codes ---------- */

// No 0/O, 1/I/L: easy to read out loud or copy by hand. 31 characters x 20 places is about 99 bits.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 5; i++) group += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

/** Hash of a code as typed: case, spaces and dashes do not matter. */
export function hashInviteCode(code: string): string {
  return sha256Hex(code.toUpperCase().replace(/[\s-]/g, ""));
}

/* ---------- rate limits (in memory) ---------- */

/** Counts events per key inside a sliding window. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds to wait before the next attempt is allowed, or 0 when under the limit. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil(((list[0] ?? now) + this.windowMs - now) / 1000));
  }

  hit(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
    // Bound memory when someone sprays many different keys: drop the oldest entries first.
    if (this.hits.size > this.maxKeys) {
      for (const k of this.hits.keys()) {
        this.hits.delete(k);
        if (this.hits.size <= this.maxKeys * 0.9) break;
      }
    }
  }
}
