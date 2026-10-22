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

const scale = () => ({ min: 1, max: 5, levels: [] });
/** A fictional company risk method, as the web app sends it. */
const method = (name = "QRM-METH-001 (fictional)") => ({
  method: { name, version: "1.0", docRef: "SOP-QRM-001 (fictional)", config: { method: "fmea", severity: scale(), occurrence: scale(), detection: scale(), bands: [] }, history: [] },
});

async function riskClient(modules = "gap,risk"): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", modules),
    username: `risk${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

describe("risk method library", () => {
  it("refuses an account without the risk module, on every route, even with the sampling module", async () => {
    for (const c of [await signedInClient(env), await riskClient("gap,sampling")]) {
      for (const [m, path] of [["GET", "/api/risk-methods"], ["POST", "/api/risk-methods"], ["PUT", `/api/risk-methods/${"a".repeat(8)}-0000-4000-8000-000000000001`], ["DELETE", `/api/risk-methods/${"a".repeat(8)}-0000-4000-8000-000000000001`]] as const) {
        const r = await c.call(m, path, m === "GET" || m === "DELETE" ? undefined : method());
        expect(r.status).toBe(403);
        expect(r.json.error).toBe("module-not-included");
      }
    }
  });

  it("creates, lists, updates and deletes to the trash with the module", async () => {
    const c = await riskClient();
    const made = await c.post("/api/risk-methods", method());
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await c.get("/api/risk-methods")).json.methods.map((t: { id: string }) => t.id)).toEqual([id]);
    const put = await c.put(`/api/risk-methods/${id}`, method("Renamed (fictional)"));
    expect(put.status).toBe(200);
    expect(put.json.method).toMatchObject({ id, name: "Renamed (fictional)" });
    expect((await c.del(`/api/risk-methods/${id}`)).status).toBe(204);
    expect((await c.get("/api/risk-methods")).json.methods).toEqual([]);
    expect((await c.del(`/api/risk-methods/${id}`)).status).toBe(404);
  });

  it("keeps each account's methods to itself", async () => {
    const a = await riskClient();
    const b = await riskClient();
    const made = await a.post("/api/risk-methods", method());
    expect((await b.get("/api/risk-methods")).json.methods).toEqual([]);
    expect((await b.put(`/api/risk-methods/${made.json.id}`, method())).status).toBe(404);
    expect((await b.del(`/api/risk-methods/${made.json.id}`)).status).toBe(404);
  });

  it("rejects a method without a name, with a broken configuration, and an id that is not valid", async () => {
    const c = await riskClient();
    expect((await c.post("/api/risk-methods", method(""))).status).toBe(400);
    const broken = method();
    (broken.method.config.severity as { min: number }).min = 9;
    expect((await c.post("/api/risk-methods", broken)).status).toBe(400);
    expect((await c.put("/api/risk-methods/not-an-id", method())).status).toBeGreaterThanOrEqual(400);
  });

  it("writes the method file below the account's own folder", async () => {
    const c = await riskClient();
    const made = await c.post("/api/risk-methods", method());
    expect(made.status).toBe(201);
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name === `${made.json.id}.json`) found.push(join(dir, e.name));
      }
    };
    await walk(env.dataDir);
    expect(found.length).toBe(1);
    expect(found[0]).toContain("risk-methods");
  });
});
