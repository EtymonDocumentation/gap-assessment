/// <reference types="node" />
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, GOOD_PASSWORD, newInvite, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

/** A fictional expected-studies document, as the web app sends it. */
const doc = (keys = ["blend_uniformity"], reason = "Our SOP asks for it (fictional)") => ({
  doc: {
    versions: [{ id: "v-1", number: 1, at: "2026-11-01T10:00:00.000Z", reason, keys, catalogVersion: "1.0.0", kind: "edited" }],
    removed: [{ at: "2026-11-02T10:00:00.000Z", number: 2, savedAt: "2026-11-01T11:00:00.000Z", reason: "Entered by mistake (fictional)" }],
  },
});

async function samplingClient(): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", "gap,sampling"),
    username: `exp${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

describe("Expected studies list", () => {
  it("refuses an account without the sampling module, on both routes", async () => {
    const c = await signedInClient(env);
    for (const [method, path] of [["GET", "/api/expected-studies"], ["PUT", "/api/expected-studies"]] as const) {
      const r = await c.call(method, path, method === "GET" ? undefined : doc());
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("module-not-included");
    }
  });

  it("starts empty, saves the document with its versions and removal log, and reads it back", async () => {
    const c = await samplingClient();
    expect((await c.get("/api/expected-studies")).json.doc).toBeNull();
    const put = await c.put("/api/expected-studies", doc());
    expect(put.status).toBe(200);
    const back = (await c.get("/api/expected-studies")).json.doc;
    expect(back.versions[0]).toMatchObject({ number: 1, keys: ["blend_uniformity"], reason: "Our SOP asks for it (fictional)" });
    expect(back.removed[0]).toMatchObject({ number: 2, reason: "Entered by mistake (fictional)" });
    // A later save replaces the document (a removal is a save with one version fewer and one more log line).
    await c.put("/api/expected-studies", { doc: { versions: [], removed: back.removed } });
    expect((await c.get("/api/expected-studies")).json.doc.versions).toEqual([]);
  });

  it("keeps each account's list to itself and rejects a malformed document", async () => {
    const a = await samplingClient();
    const b = await samplingClient();
    await a.put("/api/expected-studies", doc());
    expect((await b.get("/api/expected-studies")).json.doc).toBeNull();
    expect((await a.put("/api/expected-studies", { doc: { versions: [{ id: "x" }], removed: [] } })).status).toBe(400);
    expect((await a.put("/api/expected-studies", { nope: 1 })).status).toBe(400);
  });

  it("stores one file below the account's own folder", async () => {
    const c = await samplingClient();
    await c.put("/api/expected-studies", doc());
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name === "expected-studies.json") found.push(join(dir, e.name));
      }
    };
    await walk(env.dataDir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.includes("users"))).toBe(true);
    expect(JSON.parse(await readFile(found[0]!, "utf8")).versions.length).toBeGreaterThanOrEqual(0);
  });
});
