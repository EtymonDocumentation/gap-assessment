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
export const MIN_PASSWORD = 12;
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

/**
 * Passwords people reach for first. Compared after lower-casing and dropping everything but letters and digits, and again with
 * trailing digits removed ("welcome12345" is "welcome"). With a 12-character minimum most of these are the base words that
 * get a number stuck on the end; the full strings are the ones that already reach 12 on their own.
 */
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "letmein", "welcome", "qwerty", "qwertyuiop", "iloveyou", "administrator", "changeme", "trustno1",
  "football", "baseball", "dragon", "monkey", "sunshine", "princess", "master", "abc", "admin", "login", "starwars", "whatever",
  "freedom", "shadow", "superman", "secret", "cascade", "gapassessment", "gmp", "temp", "default", "guest", "test", "testing",
  "qwertyuiopasdf", "qwertyuiopas", "asdfghjklzxc", "zxcvbnmasdfg", "asdfghjkl", "zxcvbnm", "abcdefghijkl", "abcdefghijklmnop",
  "passwordpassword", "correcthorsebatterystaple", "1q2w3e4r5t6y", "1qaz2wsx3edc", "qazwsxedcrfv",
  "123456789012", "1234567890123", "12345678901234", "111111111111", "000000000000", "123123123123", "121212121212",
]);

const lettersAndDigits = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Checks a new password against the written rules; returns the problem in plain words, or null. The rules are about length and
 * guessability only: no demand for capitals, digits or symbols, because a few unrelated words are stronger than "Summer#2026".
 * Passwords made before these rules keep working (sign-in does not check them); the rules apply when one is chosen or changed.
 */
export function passwordProblem(password: unknown, username?: string): string | null {
  if (typeof password !== "string") return "Please choose a password.";
  if (password.length < MIN_PASSWORD) return `Please use at least ${MIN_PASSWORD} characters. A few unrelated words in a row make a good password.`;
  if (password.length > MAX_PASSWORD) return `That password is too long. Please use ${MAX_PASSWORD} characters or fewer.`;
  const name = (username ?? "").trim().toLowerCase();
  if (name && password.toLowerCase().includes(name)) return "Please leave your user name out of your password.";
  const plain = lettersAndDigits(password);
  if (COMMON_PASSWORDS.has(plain) || COMMON_PASSWORDS.has(plain.replace(/\d+$/, "")) || /^(.)\1+$/u.test(plain)) {
    return "That password is very common, so it is easy to guess. Please choose a few unrelated words instead.";
  }
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
  // The result is shared between requests: read it, never change it (changes go through store.update).
  const raw = await store.readJsonShared<StoredUser[]>(usersFile(store), []);
  if (raw.every(hasModules)) return raw as UserRecord[];
  await store.update<StoredUser[]>(usersFile(store), [], (all) => all.map(withModules)).catch(() => undefined);
  return raw.map(withModules);
}

/**
 * Most sessions one person can have open at once (a laptop, a phone, a few browsers). Signing in on an eleventh ends the oldest.
 * Without a cap the session list, which every request reads, could grow by one entry per sign-in for two weeks.
 */
export const MAX_SESSIONS_PER_USER = 10;

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
  await store.update<SessionRecord[]>(sessionsFile(store), [], (all) => {
    const live = all.filter((s) => Date.parse(s.expiresAt) > now);
    // Oldest first among this person's sessions; the newest MAX-1 stay, so with the new one there are MAX.
    const mine = live.filter((s) => s.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ended = new Set(mine.slice(0, Math.max(0, mine.length - (MAX_SESSIONS_PER_USER - 1))).map((s) => s.tokenHash));
    return [...live.filter((s) => !ended.has(s.tokenHash)), record];
  });
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
  // Every request comes through here, so the two files are parsed again only when they changed on disk (see Store.readJsonShared).
  const session = (await store.readJsonShared<SessionRecord[]>(sessionsFile(store), [])).find((s) => s.tokenHash === hash);
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

/**
 * Slows down repeated wrong passwords instead of locking anyone out. Failures are counted per user name AND caller address
 * together, so a stranger guessing at someone's user name only slows down their own address; the person who owns the account,
 * signing in from elsewhere, is not held up. The first few wrong tries cost nothing; after that each further wrong try doubles
 * the wait, up to a ceiling. A pair that stops failing for a while is forgotten, and a right password clears it.
 */
export class LoginSlowdown {
  private pairs = new Map<string, { failures: number; last: number }>();

  constructor(
    /** Wrong tries that cost nothing (typing slips). */
    private readonly freeTries = 3,
    private readonly firstWaitSeconds = 2,
    private readonly ceilingSeconds = 5 * 60,
    /** After this long without a new wrong try the count starts over. */
    private readonly forgetAfterMs = 30 * 60 * 1000,
    private readonly maxKeys = 10_000,
  ) {}

  private waitFor(failures: number): number {
    if (failures <= this.freeTries) return 0;
    return Math.min(this.ceilingSeconds, this.firstWaitSeconds * 2 ** (failures - this.freeTries - 1));
  }

  private current(key: string, now: number): { failures: number; last: number } | undefined {
    const entry = this.pairs.get(key);
    if (entry && now - entry.last > this.forgetAfterMs) {
      this.pairs.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Seconds to wait before this pair may try again, or 0. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.current(key, now);
    if (!entry) return 0;
    const left = entry.last + this.waitFor(entry.failures) * 1000 - now;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Records a wrong try and returns how many in a row this pair now has. */
  failed(key: string, now = Date.now()): number {
    const failures = (this.current(key, now)?.failures ?? 0) + 1;
    this.pairs.set(key, { failures, last: now });
    // Bound memory when someone sprays many different pairs: drop the oldest entries first.
    if (this.pairs.size > this.maxKeys) {
      for (const k of this.pairs.keys()) {
        this.pairs.delete(k);
        if (this.pairs.size <= this.maxKeys * 0.9) break;
      }
    }
    return failures;
  }

  /** The first wrong try that is no longer free: the moment worth telling the admin about. */
  isFirstSlowedTry(failures: number): boolean {
    return failures === this.freeTries + 1;
  }

  succeeded(key: string): void {
    this.pairs.delete(key);
  }
}
