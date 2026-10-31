/// <reference types="node" />
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedInClient, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

/** A fictional saved answer set, as the web app sends it. */
const set = (name = "Site A answers (fictional)") => ({
  set: {
    format: "gap-saved-answers",
    formatVersion: 1,
    name,
    savedAt: "2026-10-31T09:00:00.000Z",
    sourceProject: "Demo project (fictional)",
    sides: "source",
    answers: [
      { questionId: "dsi.presence", side: "source", input: { kind: "value", value: true } },
      { questionId: "dsi.shipper", side: "source", input: { kind: "not_applicable", justification: "Not used at this site (fictional)" } },
    ],
  },
});

describe("saved answer sets", () => {
  it("needs a signed-in account", async () => {
    const env2 = env;
    const res = await fetch(`http://127.0.0.1:${env2.port}/api/saved-answers`);
    expect(res.status).toBe(401);
  });

  it("creates, lists, renames and deletes to the trash", async () => {
    const c = await signedInClient(env);
    const made = await c.post("/api/saved-answers", set());
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const list = (await c.get("/api/saved-answers")).json.sets as { id: string; name: string; answers: unknown[] }[];
    expect(list.map((s) => s.id)).toEqual([id]);
    expect(list[0]!.answers).toHaveLength(2);
    const renamed = await c.put(`/api/saved-answers/${id}`, set("Renamed (fictional)"));
    expect(renamed.status).toBe(200);
    expect(renamed.json.set).toMatchObject({ id, name: "Renamed (fictional)" });
    expect((await c.del(`/api/saved-answers/${id}`)).status).toBe(204);
    expect((await c.get("/api/saved-answers")).json.sets).toEqual([]);
    expect((await c.del(`/api/saved-answers/${id}`)).status).toBe(404);
    // Deleted, not erased: the file is in the account's trash.
    const found: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name.endsWith(`-${id}.json`)) found.push(join(dir, e.name));
      }
    };
    await walk(env.dataDir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("saved-answers");
  });

  it("keeps each account's sets to itself", async () => {
    const a = await signedInClient(env);
    const b = await signedInClient(env);
    const made = await a.post("/api/saved-answers", set());
    expect((await b.get("/api/saved-answers")).json.sets).toEqual([]);
    expect((await b.put(`/api/saved-answers/${made.json.id}`, set())).status).toBe(404);
    expect((await b.del(`/api/saved-answers/${made.json.id}`)).status).toBe(404);
  });

  it("rejects a set without a name, a TBD answer, a unit that does not match, and an id that is not valid", async () => {
    const c = await signedInClient(env);
    expect((await c.post("/api/saved-answers", set(""))).status).toBe(400);
    const tbd = set();
    tbd.set.answers[0] = { questionId: "dsi.presence", side: "source", input: { kind: "tbd" } } as never;
    expect((await c.post("/api/saved-answers", tbd)).status).toBe(400);
    const wrongUnit = set();
    wrongUnit.set.answers[0]!.side = "target";
    expect((await c.post("/api/saved-answers", wrongUnit)).status).toBe(400);
    expect((await c.put("/api/saved-answers/not-an-id", set())).status).toBeGreaterThanOrEqual(400);
    expect((await c.get("/api/saved-answers")).json.sets).toEqual([]);
  });
});
