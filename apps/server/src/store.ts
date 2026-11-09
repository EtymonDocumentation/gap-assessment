/// <reference types="node" />
import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Windows can briefly refuse a rename while antivirus or a reader holds the target; retry a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

/** Name of the last good copy kept beside a JSON data file. */
export const BACKUP_SUFFIX = ".bak";

/**
 * Writes to a temp file in the same folder, flushes it to the disk, then renames, so a reader never sees half a file
 * and a power cut cannot leave an empty one (a rename alone can reach the disk before the file's content does).
 * For JSON files the previous content is first kept as "<file>.bak", but only when it still parses: a damaged file
 * must never overwrite the last good copy.
 */
async function atomicWrite(file: string, data: string | Uint8Array, keepBackup = false): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: DIR_MODE });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "w", FILE_MODE);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (keepBackup) await backUpIfValid(file);
    await renameWithRetry(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function backUpIfValid(file: string): Promise<void> {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch {
    return; // nothing there yet, or already damaged: keep the older .bak
  }
  // A failed backup must not fail the save itself.
  await copyFile(file, file + BACKUP_SUFFIX).catch(() => undefined);
}

/** Files that both the server and the admin tool change. Every change to them happens under the cross-process lock. */
const SHARED_FILES = new Set(["users.json", "invites.json", "sessions.json"]);

export const LOCK_FILE = ".lock";
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Holds `<data>/.lock` (created exclusively) while `fn` runs, so the server and the admin tool never change the same
 * file at the same moment. Waits up to ~5 s; a lock file older than 30 s is left over from a crashed process and is taken over.
 */
export async function withFileLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, LOCK_FILE);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lockPath, "wx", FILE_MODE);
      try {
        await handle.writeFile(token);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        await mkdir(dir, { recursive: true, mode: DIR_MODE });
        continue;
      }
      // EEXIST is the normal "someone else has it"; Windows reports EPERM/EACCES while the file is being deleted.
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw err;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        // Take over a lock whose owner is gone (check again right before removing it).
        const again = await stat(lockPath).catch(() => null);
        if (again && again.mtimeMs === info.mtimeMs) await rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) throw new Error("The data folder is busy (another process holds its lock). Please try again.");
      await sleep(Math.min(100, 5 + attempt * 5) + Math.random() * 10);
    }
  }
  try {
    return await fn();
  } finally {
    // Remove it only if it is still ours (it could have been taken over after 30 s).
    const current = await readFile(lockPath, "utf8").catch(() => null);
    if (current === token) await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

/** How long deleted items stay in the trash before the server removes them for good. */
export const TRASH_DAYS = 30;

/** When a trash entry was made, from the date `toTrash` puts at the start of its name ("2026-11-08T12-30-00-123Z-..."), or undefined. */
export function trashedAt(entry: string): number | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(entry);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(t) ? t : undefined;
}

/** The data folder: every disk access of the server goes through here. */
export class Store {
  readonly dir: string;
  private tails = new Map<string, Promise<unknown>>();
  private shared = new Map<string, { key: string; value: unknown }>();

  constructor(dataDir: string) {
    this.dir = resolve(dataDir);
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  /** Runs `fn` after everything queued earlier under the same key (a simple promise queue). */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }

  /**
   * Reads a JSON file. A file that fails to parse (for example cut short by a crash) falls back to the last good
   * copy "<file>.bak" with a logged warning; only when that is unusable too does the original error surface.
   */
  async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (err) {
      if (isMissing(err)) return fallback;
      if (!(err instanceof SyntaxError)) throw err;
      try {
        const good = JSON.parse(await readFile(file + BACKUP_SUFFIX, "utf8")) as T;
        console.warn(`${basename(file)} could not be read; using its last good copy (${basename(file)}${BACKUP_SUFFIX}).`);
        return good;
      } catch {
        throw err;
      }
    }
  }

  /**
   * Like readJson, for files that every request reads (accounts and sessions). The parsed copy is kept in memory and used again
   * as long as the file on disk is the same one (same size, change time and file number; every save replaces the file, so a
   * change always shows). The admin tool changes these files from another process, which this check also notices. The result
   * is shared: callers must only read it.
   */
  async readJsonShared<T>(file: string, fallback: T): Promise<T> {
    const info = await stat(file).catch(() => null);
    if (!info) return this.readJson(file, fallback);
    const key = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
    const hit = this.shared.get(file);
    if (hit && hit.key === key) return hit.value as T;
    // The file is read after it was measured, so the copy is never older than its key; a change in between only costs a re-read.
    const value = await this.readJson(file, fallback);
    this.shared.set(file, { key, value });
    return value;
  }

  async readBytes(file: string): Promise<Buffer | null> {
    try {
      return await readFile(file);
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  writeJson(file: string, value: unknown): Promise<void> {
    return this.withLock(file, () => atomicWrite(file, JSON.stringify(value, null, 2), true));
  }

  writeBytes(file: string, bytes: Uint8Array): Promise<void> {
    return this.withLock(file, () => atomicWrite(file, bytes));
  }

  /**
   * Read, change and write one JSON file as a single step, so two requests cannot overwrite each other. The file is
   * read again from disk inside the step (never from an earlier copy). For users.json, invites.json and sessions.json
   * the step also holds the cross-process lock, because the admin tool changes those files while the server runs.
   */
  update<T>(file: string, fallback: T, fn: (current: T) => T | Promise<T>): Promise<T> {
    const step = async () => {
      const next = await fn(await this.readJson(file, fallback));
      await atomicWrite(file, JSON.stringify(next, null, 2), true);
      this.shared.delete(file); // our own change is seen at once (the disk check alone would also notice it)
      return next;
    };
    const shared = dirname(resolve(file)) === this.dir && SHARED_FILES.has(basename(file));
    // The in-process queue comes first, so requests in this process do not fight each other over the lock file.
    return this.withLock(file, shared ? () => withFileLock(this.dir, step) : step);
  }

  /** File names in a folder (empty when the folder does not exist yet). */
  async list(folder: string): Promise<string[]> {
    try {
      return await readdir(folder);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async exists(file: string): Promise<boolean> {
    return (await this.readBytes(file)) !== null;
  }

  /** Deleted items are moved to <data>/trash/<userId>/..., never erased. */
  async toTrash(userId: string, kind: "projects" | "templates" | "files" | "sampling-tables" | "subsections" | "risk-methods" | "mbr-blocks" | "trd-writeups" | "excipient-library" | "saved-answers", from: string, name: string): Promise<void> {
    const dest = this.path("trash", userId, kind, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}-${name}`);
    await mkdir(dirname(dest), { recursive: true, mode: DIR_MODE });
    await renameWithRetry(from, dest);
  }

  /**
   * Empties the trash of everything older than `days` days (default 30): deleted items stay recoverable for a month, then the
   * disk gets the space back. Without this the trash only grows, and so does the disk use of anyone who deletes and re-creates
   * things. Each removal is written to the audit log. The age is read from the date in the entry's own name; an entry whose name
   * has no date falls back to the file's change time.
   */
  async sweepTrash(now = new Date(), days = TRASH_DAYS): Promise<number> {
    const root = this.path("trash");
    const limit = days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const user of await this.list(root)) {
      for (const kind of await this.list(join(root, user))) {
        const dir = join(root, user, kind);
        for (const entry of await this.list(dir)) {
          const path = join(dir, entry);
          const when = trashedAt(entry) ?? (await stat(path).catch(() => null))?.mtimeMs;
          if (when === undefined || now.getTime() - when <= limit) continue;
          try {
            await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          } catch {
            continue; // in use right now; the next hourly sweep tries again
          }
          await this.audit("trash-expired", { userId: user, kind, item: entry, days });
          removed++;
        }
      }
    }
    return removed;
  }

  /** One JSON line per event. Callers must never pass passwords, tokens or invite codes. */
  audit(event: string, fields: Record<string, string | number | undefined> = {}): Promise<void> {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + "\n";
    const file = this.path("audit.log");
    // A full disk must not turn an already finished action into an error for the user.
    return this.withLock(file, () => appendFile(file, line, { mode: FILE_MODE })).catch(() => {
      console.error("Could not write to audit.log");
    });
  }
}
