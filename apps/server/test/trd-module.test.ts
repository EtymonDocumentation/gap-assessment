/// <reference types="node" />
import { buildDemoProject, createTrd } from "@gap/engine";
import { content, demos } from "@gap/content";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, GOOD_PASSWORD, newInvite, startEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

async function clientWith(modules: string): Promise<Client> {
  const c = new Client(env.port);
  const res = await c.post("/api/auth/signup", {
    inviteCode: await newInvite(env.dataDir, "--modules", modules),
    username: `trd${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

const demo = buildDemoProject(content, demos["arx-217"]);
const withoutTrd = { ...demo, trd: { documents: [] } };
const withTrd = createTrd(withoutTrd, { title: "TRD (fictional)", start: { kind: "blank" } }, { name: "Test Person", at: "2026-10-23T09:00:00.000Z" }).project;

describe("TRD module gating on the server", () => {
  it("refuses to save a project that holds a TRD for an account without the module, but saves one without", async () => {
    const c = await clientWith("gap,sampling,risk");
    const plain = await c.post("/api/projects", { project: withoutTrd });
    expect(plain.status).toBe(201);
    const r = await c.post("/api/projects", { project: withTrd });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("module-not-included");
    const put = await c.put(`/api/projects/${plain.json.id}`, { project: withTrd, baseRevision: 1 });
    expect(put.status).toBe(403);
    expect(put.json.error).toBe("module-not-included");
  });

  it("saves and returns the TRD for an account with the module", async () => {
    const c = await clientWith("gap,trd");
    const made = await c.post("/api/projects", { project: withTrd });
    expect(made.status).toBe(201);
    const back = await c.get(`/api/projects/${made.json.id}`);
    expect(back.json.project.trd.documents[0].title).toBe("TRD (fictional)");
    const put = await c.put(`/api/projects/${made.json.id}`, { project: withTrd, baseRevision: 1 });
    expect(put.status).toBe(200);
  });
});
