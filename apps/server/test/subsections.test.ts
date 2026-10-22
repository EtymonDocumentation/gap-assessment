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

/** A fictional library subsection, as the web app sends it. */
const item = (name = "Sample handling (fictional)") => ({
  item: { name, version: "1.0", blocks: [{ type: "paragraph", text: "Label every container for {planId}." }], history: [] },
});

async function samplingClient(): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", "gap,sampling"),
    username: `sub${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

describe("Plan subsections library", () => {
  it("refuses an account without the sampling module, on every route", async () => {
    const c = await signedInClient(env);
    const id = `${"a".repeat(8)}-0000-4000-8000-000000000001`;
    for (const [method, path] of [["GET", "/api/subsections"], ["POST", "/api/subsections"], ["PUT", `/api/subsections/${id}`], ["DELETE", `/api/subsections/${id}`]] as const) {
      const r = await c.call(method, path, method === "GET" || method === "DELETE" ? undefined : item());
      expect(r.status).toBe(403);
      expect(r.json.error).toBe("module-not-included");
    }
  });

  it("creates, lists, updates and deletes to the trash with the module", async () => {
    const c = await samplingClient();
    const made = await c.post("/api/subsections", item());
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await c.get("/api/subsections")).json.items.map((t: { id: string }) => t.id)).toEqual([id]);

    const put = await c.put(`/api/subsections/${id}`, item("Renamed (fictional)"));
    expect(put.status).toBe(200);
    expect(put.json.item).toMatchObject({ id, name: "Renamed (fictional)" });

    expect((await c.del(`/api/subsections/${id}`)).status).toBe(204);
    expect((await c.get("/api/subsections")).json.items).toEqual([]);
    expect((await c.del(`/api/subsections/${id}`)).status).toBe(404);
  });

  it("keeps each account's items to itself and rejects a nameless item", async () => {
    const a = await samplingClient();
    const b = await samplingClient();
    const made = await a.post("/api/subsections", item());
    expect((await b.get("/api/subsections")).json.items).toEqual([]);
    expect((await b.put(`/api/subsections/${made.json.id}`, item())).status).toBe(404);
    expect((await b.del(`/api/subsections/${made.json.id}`)).status).toBe(404);
    expect((await a.post("/api/subsections", item(""))).status).toBe(400);
  });

  it("stores the file below the account's own subsections folder", async () => {
    const c = await samplingClient();
    const made = await c.post("/api/subsections", item());
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name === `${made.json.id}.json`) found.push(join(dir, e.name));
      }
    };
    await walk(env.dataDir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("subsections");
  });
});
