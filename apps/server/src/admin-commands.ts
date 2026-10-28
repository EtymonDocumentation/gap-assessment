/// <reference types="node" />
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { UsageError, parseArgs, type ParsedArgs } from "./args";
import { deleteSessions, hashInviteCode, hashPassword, invitesFile, loadUsers, newInviteCode, sessionsFile, usersFile } from "./auth";
import { ConfigError, configPath, loadConfig, type ServerConfig } from "./config";
import { usageOf } from "./myfiles";
import { Store } from "./store";
import { DEFAULT_MODULES, parseModuleList, type InviteRecord, type UserRecord } from "./types";

export const USAGE = `Gap Assessment admin. Usage: admin <command> --data <dir> [options]

  init --storage server|client --max-upload-mb <n> [--force]   create the data folder's settings
  invite [--role admin|member] [--days 7] [--modules gap[,x]]  make an invite code (shown once); modules default to gap
  invites                                                      list invites (never the codes)
  revoke-invite <number-or-hash-prefix>                        cancel an unused invite
  users                                                        list accounts
  disable <username> | enable <username>                       block or allow an account
  sessions-revoke <username>                                   sign an account out everywhere
  reset-password <username>                                    give an account a new random password (shown once)
  set-plan <username> <planId>                                 change the plan (e.g. trial-free)
  set-modules <username> <comma list>                          change the modules an account may use (e.g. gap)
  files-usage                                                  My files: files and megabytes per account (and each quota)
  set-files-quota <username> <MB|none>                         the most My files may hold for an account (none = no quota)`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A problem to show the operator; the command exits with a non-zero code. */
class AdminError extends Error {}

export interface AdminIo {
  out(line: string): void;
  err(line: string): void;
}

async function openStore(args: ParsedArgs): Promise<{ store: Store; config: ServerConfig }> {
  const data = args.options.get("data");
  if (!data) throw new UsageError("--data <dir> is required.");
  const dir = resolve(data);
  const config = await loadConfig(dir);
  return { store: new Store(dir), config };
}

async function findUser(store: Store, name: string | undefined): Promise<UserRecord> {
  if (!name) throw new UsageError("Give the user name.");
  const user = (await loadUsers(store)).find((u) => u.username === name.toLowerCase());
  if (!user) throw new AdminError(`There is no user named "${name}".`);
  return user;
}

function inviteStatus(i: InviteRecord, users: UserRecord[]): string {
  if (i.revoked) return "revoked";
  if (i.usedBy) return `used by ${users.find((u) => u.id === i.usedBy)?.username ?? "a removed account"}`;
  return Date.parse(i.expiresAt) <= Date.now() ? "expired" : "unused";
}

const day = (iso: string) => iso.slice(0, 10);

async function init(args: ParsedArgs, io: AdminIo): Promise<void> {
  const data = args.options.get("data");
  if (!data) throw new UsageError("--data <dir> is required.");
  const storage = args.options.get("storage");
  if (storage !== "server" && storage !== "client") throw new UsageError('--storage must be "server" or "client".');
  const mb = Number(args.options.get("max-upload-mb"));
  if (!Number.isInteger(mb) || mb < 1 || mb > 1024) throw new UsageError("--max-upload-mb must be a whole number from 1 to 1024.");

  const dir = resolve(data);
  if ((await stat(configPath(dir)).catch(() => null)) && !args.flags.has("force")) {
    throw new AdminError("This data folder already has a config.json. Use --force to replace the settings (accounts are kept).");
  }
  await mkdir(dir, { recursive: true });
  const store = new Store(dir);
  await store.writeJson(configPath(dir), { storage, maxUploadMB: mb });
  // Existing accounts survive a --force re-init; only missing files are created.
  for (const file of [usersFile(store), invitesFile(store), sessionsFile(store)]) {
    await store.update<unknown[]>(file, [], (current) => current);
  }
  await mkdir(store.path("users"), { recursive: true });
  await store.audit("init", { storage, actor: "admin-cli" });
  io.out(`Ready. Data folder: ${dir}`);
  io.out(`Storage mode: ${storage}. Largest upload: ${mb} MB.`);
  io.out("Next: create the first invite with  admin invite --role admin --data <dir>");
}

async function invite(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const role = args.options.get("role") ?? "member";
  if (role !== "admin" && role !== "member") throw new UsageError('--role must be "admin" or "member".');
  const days = Number(args.options.get("days") ?? "7");
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new UsageError("--days must be a whole number from 1 to 365.");

  const modulesOption = args.options.get("modules");
  const modules = modulesOption === undefined ? [...DEFAULT_MODULES] : parseModuleList(modulesOption);
  if (!modules) throw new UsageError("--modules must be a comma list of lower-case letters, digits and dashes, e.g. gap.");

  const code = newInviteCode();
  const now = Date.now();
  const record: InviteRecord = {
    codeHash: hashInviteCode(code),
    role,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    modules,
  };
  await store.update<InviteRecord[]>(invitesFile(store), [], (all) => [...all, record]);
  await store.audit("invite-created", { role, invite: record.codeHash.slice(0, 8), modules: modules.join(","), actor: "admin-cli" });
  io.out(`Invite code (shown only this once, copy it now): ${code}`);
  io.out(`Role: ${role}. Valid until ${day(record.expiresAt)} (${days} days).`);
  io.out(`Modules: ${modules.join(", ")}${modulesOption === undefined ? " (the default; use --modules to change)" : ""}.`);
}

async function invites(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const all = await store.readJson<InviteRecord[]>(invitesFile(store), []);
  const users = await loadUsers(store);
  if (all.length === 0) return io.out("There are no invites yet.");
  all.forEach((i, n) => {
    io.out(
      `${n + 1}. ${i.codeHash.slice(0, 8)}  ${i.role}  modules ${(i.modules ?? DEFAULT_MODULES).join(",")}  made ${day(i.createdAt)}  expires ${day(i.expiresAt)}  ${inviteStatus(i, users)}`,
    );
  });
}

async function revokeInvite(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const ref = args.positional[1];
  if (!ref) throw new UsageError("Give the invite number (from `invites`) or the start of its hash (4 or more characters).");
  let revokedHash = "";
  await store.update<InviteRecord[]>(invitesFile(store), [], (all) => {
    // 1 to 3 digits is a list number; anything longer is the start of the hash.
    const matches = /^\d{1,3}$/.test(ref)
      ? all.filter((_, n) => n + 1 === Number(ref))
      : /^[0-9a-f]{4,64}$/i.test(ref)
        ? all.filter((i) => i.codeHash.startsWith(ref.toLowerCase()))
        : [];
    if (matches.length === 0) throw new AdminError("No invite matches that number or hash start.");
    if (matches.length > 1) throw new AdminError("More than one invite matches. Type more of the hash.");
    const target = matches[0] as InviteRecord;
    if (target.usedBy) throw new AdminError("That invite has already been used.");
    if (target.revoked) throw new AdminError("That invite is already revoked.");
    revokedHash = target.codeHash;
    return all.map((i) => (i === target ? { ...i, revoked: true as const } : i));
  });
  await store.audit("invite-revoked", { invite: revokedHash.slice(0, 8), actor: "admin-cli" });
  io.out(`Invite ${revokedHash.slice(0, 8)} is revoked.`);
}

async function users(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const all = await loadUsers(store);
  if (all.length === 0) return io.out("There are no accounts yet.");
  for (const u of all) {
    io.out(
      `${u.username}  (${u.displayName})  ${u.role}  plan ${u.plan.id}  modules ${u.plan.modules.join(",")}  created ${day(u.createdAt)}${u.disabled ? "  DISABLED" : ""}`,
    );
  }
}

async function setDisabled(args: ParsedArgs, io: AdminIo, disabled: boolean): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  await store.update<UserRecord[]>(usersFile(store), [], (all) =>
    all.map((u) => {
      if (u.id !== user.id) return u;
      const { disabled: _old, ...rest } = u;
      return disabled ? { ...rest, disabled: true as const } : rest;
    }),
  );
  if (disabled) await deleteSessions(store, (s) => s.userId !== user.id);
  await store.audit(disabled ? "user-disabled" : "user-enabled", { userId: user.id, username: user.username, actor: "admin-cli" });
  io.out(disabled ? `${user.username} is disabled and signed out everywhere.` : `${user.username} can sign in again.`);
}

async function sessionsRevoke(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  const removed = await deleteSessions(store, (s) => s.userId !== user.id);
  await store.audit("sessions-revoked", { userId: user.id, username: user.username, count: removed, actor: "admin-cli" });
  io.out(`${user.username} was signed out of ${removed} session${removed === 1 ? "" : "s"}.`);
}

async function resetPassword(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  // The new password is made here, never typed on the command line, so it does not end up in the shell history.
  // It reuses the invite-code shape (4 groups of 5 easy-to-read characters), well above the minimum length.
  const temporary = newInviteCode();
  const passwordHash = await hashPassword(temporary);
  await store.update<UserRecord[]>(usersFile(store), [], (all) => all.map((u) => (u.id === user.id ? { ...u, passwordHash } : u)));
  // Whoever had the old password may still hold a session; a reset must close those too.
  const removed = await deleteSessions(store, (s) => s.userId !== user.id);
  await store.audit("password-reset", { userId: user.id, username: user.username, sessionsClosed: removed, actor: "admin-cli" });
  io.out(`New password for ${user.username} (shown only this once, copy it now): ${temporary}`);
  io.out(`${user.username} was signed out of ${removed} session${removed === 1 ? "" : "s"}. After signing in, choose your own with "Change password" in the account menu.`);
}

async function setPlan(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  const planId = args.positional[2];
  if (!planId || !/^[a-z0-9-]{1,40}$/.test(planId)) throw new UsageError("Give a plan id of lower-case letters, digits and dashes, e.g. trial-free.");
  const since = new Date().toISOString();
  await store.update<UserRecord[]>(usersFile(store), [], (all) =>
    all.map((u) => (u.id === user.id ? { ...u, plan: { ...u.plan, id: planId, status: "active" as const, since } } : u)),
  );
  await store.audit("plan-set", { userId: user.id, username: user.username, plan: planId, actor: "admin-cli" });
  io.out(`${user.username} is now on plan ${planId}.`);
}

async function setModules(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  const modules = parseModuleList(args.positional[2] ?? "");
  if (!modules) throw new UsageError("Give the modules as a comma list of lower-case letters, digits and dashes, e.g. gap.");
  await store.update<UserRecord[]>(usersFile(store), [], (all) =>
    all.map((u) => (u.id === user.id ? { ...u, plan: { ...u.plan, modules } } : u)),
  );
  await store.audit("modules-set", { userId: user.id, username: user.username, modules: modules.join(","), actor: "admin-cli" });
  io.out(`${user.username} can now use these modules: ${modules.join(", ")}.`);
}

const mbText = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function filesUsage(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const all = await loadUsers(store);
  if (all.length === 0) return io.out("There are no accounts yet.");
  let totalFiles = 0;
  let totalBytes = 0;
  for (const u of all) {
    const { count, bytes } = await usageOf(store, u.id);
    totalFiles += count;
    totalBytes += bytes;
    // No silent default: an account without a quota says so, and only the per-file limit applies to it.
    const quota = u.filesQuotaMB === undefined ? "no quota set" : `quota ${u.filesQuotaMB} MB`;
    io.out(`${u.username}  ${count} file${count === 1 ? "" : "s"}  ${mbText(bytes)}  (${quota})`);
  }
  io.out(`Total  ${totalFiles} file${totalFiles === 1 ? "" : "s"}  ${mbText(totalBytes)}`);
}

async function setFilesQuota(args: ParsedArgs, io: AdminIo): Promise<void> {
  const { store } = await openStore(args);
  const user = await findUser(store, args.positional[1]);
  const value = args.positional[2];
  if (value === undefined) throw new UsageError("Give the quota in whole megabytes (1 to 1048576), or none.");
  let mb: number | undefined;
  if (value.toLowerCase() !== "none") {
    mb = Number(value);
    if (!/^\d{1,7}$/.test(value) || mb < 1 || mb > 1_048_576) throw new UsageError("Give the quota as a whole number of megabytes from 1 to 1048576, or none.");
  }
  await store.update<UserRecord[]>(usersFile(store), [], (all) =>
    all.map((u) => {
      if (u.id !== user.id) return u;
      const { filesQuotaMB: _old, ...rest } = u;
      return mb === undefined ? rest : { ...rest, filesQuotaMB: mb };
    }),
  );
  await store.audit("files-quota-set", { userId: user.id, username: user.username, quotaMB: mb ?? "none", actor: "admin-cli" });
  io.out(mb === undefined ? `${user.username} has no My files quota now (only the per-file limit applies).` : `${user.username} may keep up to ${mb} MB in My files.`);
}

/** Runs one admin command and returns the exit code (0 = fine). Output goes through `io`. */
export async function runAdmin(argv: string[], io: AdminIo): Promise<number> {
  try {
    const args = parseArgs(argv, ["force"]);
    const command = args.positional[0];
    switch (command) {
      case "init":
        await init(args, io);
        break;
      case "invite":
        await invite(args, io);
        break;
      case "invites":
        await invites(args, io);
        break;
      case "revoke-invite":
        await revokeInvite(args, io);
        break;
      case "users":
        await users(args, io);
        break;
      case "disable":
        await setDisabled(args, io, true);
        break;
      case "enable":
        await setDisabled(args, io, false);
        break;
      case "sessions-revoke":
        await sessionsRevoke(args, io);
        break;
      case "reset-password":
        await resetPassword(args, io);
        break;
      case "set-plan":
        await setPlan(args, io);
        break;
      case "set-modules":
        await setModules(args, io);
        break;
      case "files-usage":
        await filesUsage(args, io);
        break;
      case "set-files-quota":
        await setFilesQuota(args, io);
        break;
      default:
        io.err(command ? `Unknown command "${command}".` : "No command given.");
        io.err(USAGE);
        return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof AdminError || err instanceof ConfigError) io.err(`Error: ${err.message}`);
    else io.err(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
