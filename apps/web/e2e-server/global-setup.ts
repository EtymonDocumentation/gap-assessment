import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SERVER_DIST = join(WEB, "..", "server", "dist");

export const SERVER_PORT = 8788;
export const CLIENT_PORT = 8789;
/** How many invite codes are made up front. Each test worker takes its own block of INVITES_PER_WORKER. */
export const INVITES_PER_WORKER = 16;
export const SAMPLING_INVITES_PER_WORKER = 3;
const INVITES_SERVER =INVITES_PER_WORKER * 12;
const INVITES_CLIENT = INVITES_PER_WORKER * 12;

async function waitForHealth(port: number, child: ChildProcess, log: () => string): Promise<void> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`The server on port ${port} stopped at start-up:\n${log()}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`The server on port ${port} did not answer in time:\n${log()}`);
}

/** Makes a data folder with the admin tool and starts the real server on it. */
async function start(storage: "server" | "client", port: number, children: ChildProcess[], dirs: string[]): Promise<string> {
  const data = await mkdtemp(join(tmpdir(), `gap-web53-${storage}-`));
  dirs.push(data);
  const admin = join(SERVER_DIST, "admin.mjs");
  execFileSync(process.execPath, [admin, "init", "--data", data, "--storage", storage, "--max-upload-mb", "50"], { stdio: "pipe" });
  // The invite codes are made up front so every test worker can take its own block of them. (The admin tool and the server
  // now lock the account files against each other, so making codes while the server runs would also be safe.)
  const codes: string[] = [];
  for (let i = 0; i < (storage === "server" ? INVITES_SERVER : INVITES_CLIENT); i++) {
    const out = execFileSync(process.execPath, [admin, "invite", "--data", data], { encoding: "utf8" });
    const code = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\b/.exec(out)?.[0];
    if (!code) throw new Error(`No invite code in the admin tool's output:\n${out}`);
    codes.push(code);
  }
  process.env[storage === "server" ? "GAP_E2E_INVITES_SERVER" : "GAP_E2E_INVITES_CLIENT"] = JSON.stringify(codes);
  if (storage === "server") {
    // A few accounts that include the paid sampling module (the default invite carries only "gap"); see makeSamplingInvite().
    const withSampling: string[] = [];
    for (let i = 0; i < SAMPLING_INVITES_PER_WORKER * 12; i++) {
      const out = execFileSync(process.execPath, [admin, "invite", "--data", data, "--modules", "gap,sampling"], { encoding: "utf8" });
      const code = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\b/.exec(out)?.[0];
      if (!code) throw new Error(`No invite code in the admin tool's output:\n${out}`);
      withSampling.push(code);
    }
    process.env.GAP_E2E_INVITES_SAMPLING = JSON.stringify(withSampling);
  }
  const child = spawn(process.execPath, [join(SERVER_DIST, "server.mjs"), "--data", data, "--web", join(WEB, "dist-server"), "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += String(d)));
  child.stderr?.on("data", (d) => (output += String(d)));
  children.push(child);
  await waitForHealth(port, child, () => output);
  return data;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(SERVER_DIST, "server.mjs")) || !existsSync(join(SERVER_DIST, "admin.mjs"))) {
    throw new Error("The server is not built. Run: npm run build -w @gap/server");
  }
  if (!existsSync(join(WEB, "dist-server", "index.html"))) {
    throw new Error("The server-mode web build is missing. Run: npm run build:server -w @gap/web");
  }
  const children: ChildProcess[] = [];
  const dirs: string[] = [];
  try {
    // Workers inherit these, so the tests can ask the admin tool for invite codes.
    process.env.GAP_E2E_ADMIN = join(SERVER_DIST, "admin.mjs");
    process.env.GAP_E2E_DATA_SERVER = await start("server", SERVER_PORT, children, dirs);
    process.env.GAP_E2E_DATA_CLIENT = await start("client", CLIENT_PORT, children, dirs);
  } catch (e) {
    for (const c of children) c.kill();
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
  return async () => {
    for (const c of children) c.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  };
}
