/// <reference types="node" />
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, GOOD_PASSWORD, newInvite, signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

/** A fictional company table, as the web app sends it. */
const table = (name = "QC-SAMP-001 (fictional)") => ({
  table: { name, version: "1.0", rows: [{ lotMin: 1, lotMax: null, sampleSize: 8 }], history: [] },
});

/** An account whose invite carries the sampling module. */
async function samplingClient(): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", "gap,sampling"),
    username: `samp${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

describe("company sampling tables", () => {
  it("refuses an account without the sampling module, on every route", async () => {
    const c = await signedInClient(env);
    for (const [method, path] of [["GET", "/api/sampling-tables"], ["POST", "/api/sampling-tables"], ["PUT", `/api/sampling-tables/${"a".repeat(8)}-0000-4000-8000-000000000001`], ["DELETE", `/api/sampling-tables/${"a".repeat(8)}-0000-4000-8000-000000000001`]] as const) {
      const r = await c.call(method, path, method === "GET" || method === "DELETE" ? undefined : table());
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("module-not-included");
    }
  });

  it("creates, lists, updates and deletes to the trash with the module", async () => {
    const c = await samplingClient();
    const made = await c.post("/api/sampling-tables", table());
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await c.get("/api/sampling-tables");
    expect(list.json.tables.map((t: { id: string }) => t.id)).toEqual([id]);

    const changed = table("Renamed (fictional)");
    changed.table.rows[0]!.sampleSize = 13;
    const put = await c.put(`/api/sampling-tables/${id}`, changed);
    expect(put.status).toBe(200);
    expect(put.json.table).toMatchObject({ id, name: "Renamed (fictional)" });

    const del = await c.del(`/api/sampling-tables/${id}`);
    expect(del.status).toBe(204);
    expect((await c.get("/api/sampling-tables")).json.tables).toEqual([]);
    expect((await c.del(`/api/sampling-tables/${id}`)).status).toBe(404);
  });

  it("keeps each account's tables to itself", async () => {
    const a = await samplingClient();
    const b = await samplingClient();
    const made = await a.post("/api/sampling-tables", table());
    expect((await b.get("/api/sampling-tables")).json.tables).toEqual([]);
    expect((await b.put(`/api/sampling-tables/${made.json.id}`, table())).status).toBe(404);
    expect((await b.del(`/api/sampling-tables/${made.json.id}`)).status).toBe(404);
  });

  it("rejects a table without a name and a request that is not a valid id", async () => {
    const c = await samplingClient();
    const bad = table("");
    expect((await c.post("/api/sampling-tables", bad)).status).toBe(400);
    expect((await c.put("/api/sampling-tables/not-an-id", table())).status).toBeGreaterThanOrEqual(400);
  });

  it("writes the table file below the account's own folder", async () => {
    const c = await samplingClient();
    const made = await c.post("/api/sampling-tables", table());
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name === `${made.json.id}.json`) found.push(join(dir, e.name));
      }
    };
    await walk(env.dataDir);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("sampling-tables");
  });
});
