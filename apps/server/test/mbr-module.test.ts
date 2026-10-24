/// <reference types="node" />
import { buildDemoProject } from "@gap/engine";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "@gap/content";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, GOOD_PASSWORD, newInvite, startEnv, type TestEnv } from "./helpers";

vi.setConfig({ testTimeout: 60000 });

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

async function clientWith(modules: string): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", modules),
    username: `mbr${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

const withMbr = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
const withoutMbr = { ...withMbr, mbr: { records: [] } };

describe("batch record module gating on the server", () => {
  it("refuses a project that holds a batch record for an account without the module, but saves one without", async () => {
    const c = await clientWith("gap,sampling,trd");
    const plain = await c.post("/api/projects", { project: withoutMbr });
    expect(plain.status).toBe(201);
    const r = await c.post("/api/projects", { project: withMbr });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("module-not-included");
    const put = await c.put(`/api/projects/${plain.json.id}`, { project: withMbr, baseRevision: 1 });
    expect(put.status).toBe(403);
  });

  it("saves the batch record for an account with the module", async () => {
    const c = await clientWith("gap,sampling,trd,mbr");
    const made = await c.post("/api/projects", { project: withMbr });
    expect(made.status).toBe(201);
    const back = await c.get(`/api/projects/${made.json.id}`);
    expect(back.json.project.mbr.records).toHaveLength(1);
  });

  it("keeps the step-blocks library behind the module, and stores a user copy per account", async () => {
    const lib = mbrLibrary[0]!;
    const block = { ...lib, version: 2, history: [{ version: 1, title: lib.title, unitOps: lib.unitOps, steps: lib.steps, params: lib.params, timeLimits: lib.timeLimits, sampleTypes: lib.sampleTypes, cmoFields: lib.cmoFields }] };
    const no = await clientWith("gap");
    expect((await no.get("/api/mbr-blocks")).status).toBe(403);
    expect((await no.put(`/api/mbr-blocks/${block.id}`, { block })).status).toBe(403);

    const yes = await clientWith("gap,mbr");
    expect((await yes.put(`/api/mbr-blocks/${block.id}`, { block })).status).toBe(200);
    const items = (await yes.get("/api/mbr-blocks")).json.blocks as { id: string; version: number }[];
    expect(items.find((b) => b.id === block.id)?.version).toBe(2);
    // The id in the address must match the block.
    expect((await yes.put("/api/mbr-blocks/other_id", { block })).status).toBe(400);
    // Another account never sees it.
    const other = await clientWith("gap,mbr");
    expect((await other.get("/api/mbr-blocks")).json.blocks).toHaveLength(0);
    expect((await yes.del(`/api/mbr-blocks/${block.id}`)).status).toBe(204);
  });
});
