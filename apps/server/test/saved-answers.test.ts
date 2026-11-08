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

  // CR-10: two tabs or two computers editing one set. The later save used to replace the earlier one without a word.
  it("refuses a save made from an out-of-date copy and keeps the newer set", async () => {
    const c = await signedInClient(env);
    const [at1, at2, at3] = ["2026-11-01T10:00:00.000Z", "2026-11-01T10:05:00.000Z", "2026-11-01T10:06:00.000Z"];
    const stamped = (name: string, updatedAt: string) => ({ set: { ...set(name).set, updatedAt } });
    const made = await c.post("/api/saved-answers", stamped("First (fictional)", at1));
    expect(made.status).toBe(201);
    const id = made.json.id as string;

    // Computer one saves a change from the copy stamped at1.
    const one = await c.put(`/api/saved-answers/${id}`, { ...stamped("Changed on computer one (fictional)", at2), baseUpdatedAt: at1 });
    expect(one.status).toBe(200);

    // Computer two still holds the copy stamped at1: its save is refused with a conflict that names the stored stamp, and nothing is replaced.
    const two = await c.put(`/api/saved-answers/${id}`, { ...stamped("Changed on computer two (fictional)", at3), baseUpdatedAt: at1 });
    expect(two.status).toBe(409);
    expect(two.json).toMatchObject({ error: "conflict", updatedAt: at2 });
    expect(String(two.json.message)).toMatch(/was changed somewhere else/);
    const kept = (await c.get("/api/saved-answers")).json.sets as { id: string; name: string }[];
    expect(kept.find((s) => s.id === id)!.name).toBe("Changed on computer one (fictional)");

    // After it reads the newer copy, the same save goes through.
    const retry = await c.put(`/api/saved-answers/${id}`, { ...stamped("Changed on computer two (fictional)", at3), baseUpdatedAt: at2 });
    expect(retry.status).toBe(200);
    expect(retry.json.set).toMatchObject({ id, name: "Changed on computer two (fictional)", updatedAt: at3 });
  });

  it("still accepts a save that sends no stamp (an older web app), and a set saved before stamps existed", async () => {
    const c = await signedInClient(env);
    const made = await c.post("/api/saved-answers", set("Old set (fictional)"));
    const id = made.json.id as string;
    expect((await c.put(`/api/saved-answers/${id}`, set("No stamp (fictional)"))).status).toBe(200);
    // A set with no stamp stored cannot be compared with one: a save that names one is refused, a save that names none is not.
    const withBase = { ...set("With a stamp (fictional)"), baseUpdatedAt: "2026-11-01T10:00:00.000Z" };
    expect((await c.put(`/api/saved-answers/${id}`, withBase)).status).toBe(409);
  });
});
