/// <reference types="node" />
import { editLibraryRecord, newLibraryRecord } from "@gap/engine";
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
    username: `xl${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

const v1 = newLibraryRecord("xl_surfactant_c", { name: "Surfactant C (fictional)", classKey: "surfactant", tests: [{ test: "Assay" }], prompts: ["Fatty acid composition"] }, "2026-11-09T09:00:00.000Z", "Test Person");
const v2 = editLibraryRecord(v1, { name: v1.name, classKey: "surfactant", tests: [{ test: "Assay" }, { test: "Peroxide value" }], prompts: [] }, "2026-11-09T10:00:00.000Z", "Test Person");

describe("the excipient library on the server (M13 job 3)", () => {
  it("is behind the excipient module: an account without it is refused on every route", async () => {
    const no = await clientWith("gap,trd,mbr");
    expect((await no.get("/api/excipient-library")).status).toBe(403);
    expect((await no.put(`/api/excipient-library/${v1.id}`, { record: v1 })).status).toBe(403);
    expect((await no.call("DELETE", `/api/excipient-library/${v1.id}`, { reason: "No longer needed" })).status).toBe(403);
    expect((await no.get("/api/excipient-library")).json.error).toBe("module-not-included");
  });

  it("stores a record per account with its versions, checks the id and the shape, and keeps it private to the account", async () => {
    const yes = await clientWith("gap,excipient");
    expect((await yes.get("/api/excipient-library")).json.records).toHaveLength(0);
    expect((await yes.put(`/api/excipient-library/${v1.id}`, { record: v1 })).status).toBe(200);
    expect((await yes.put(`/api/excipient-library/${v1.id}`, { record: v2 })).status).toBe(200);
    const items = (await yes.get("/api/excipient-library")).json.records as { id: string; version: number; tests: unknown[]; history: unknown[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: v1.id, version: 2 });
    expect(items[0]!.history).toHaveLength(1);
    // The id in the address must match the record, the id must be a plain one, and the shape must be valid.
    expect((await yes.put("/api/excipient-library/xl_other", { record: v1 })).status).toBe(400);
    expect((await yes.put("/api/excipient-library/not-an-id", { record: { ...v1, id: "not-an-id" } })).status).toBe(400);
    expect((await yes.put(`/api/excipient-library/${v1.id}`, { record: { ...v1, tests: "no" } })).status).toBe(400);
    expect((await yes.put(`/api/excipient-library/${v1.id}`, { record: { ...v1, classLabel: "own words" } })).status).toBe(400);
    // Another account, even with the module, sees none of it and cannot remove it.
    const other = await clientWith("gap,excipient");
    expect((await other.get("/api/excipient-library")).json.records).toHaveLength(0);
    expect((await other.call("DELETE", `/api/excipient-library/${v1.id}`, { reason: "Not mine" })).status).toBe(404);
    expect((await yes.get("/api/excipient-library")).json.records).toHaveLength(1);
  });

  it("removing needs a reason, and a second removal finds nothing", async () => {
    const yes = await clientWith("gap,excipient");
    await yes.put(`/api/excipient-library/${v1.id}`, { record: v1 });
    expect((await yes.call("DELETE", `/api/excipient-library/${v1.id}`)).status).toBe(400);
    expect((await yes.call("DELETE", `/api/excipient-library/${v1.id}`, { reason: "  " })).status).toBe(400);
    expect((await yes.call("DELETE", `/api/excipient-library/${v1.id}`, { reason: "Replaced by a newer record (fictional)" })).status).toBe(204);
    expect((await yes.call("DELETE", `/api/excipient-library/${v1.id}`, { reason: "Again" })).status).toBe(404);
    expect((await yes.get("/api/excipient-library")).json.records).toHaveLength(0);
  });

  it("refuses a body larger than the library limit and keeps working", async () => {
    const yes = await clientWith("gap,excipient");
    const big = await yes.call("PUT", `/api/excipient-library/${v1.id}`, undefined, { "Content-Type": "application/json" }, Buffer.alloc(5 * 1024 * 1024, 32));
    expect(big.status).toBe(413);
    expect(big.json.error).toBe("too-large");
    const bigReason = await yes.call("DELETE", `/api/excipient-library/${v1.id}`, undefined, { "Content-Type": "application/json", "Content-Length": String(20 * 1024) }, Buffer.alloc(20 * 1024, 32));
    expect(bigReason.status).toBe(413);
    expect((await yes.get("/api/excipient-library")).status).toBe(200);
  });

  it("refuses a request without the same-origin header", async () => {
    const yes = await clientWith("gap,excipient");
    const res = await yes.call("PUT", `/api/excipient-library/${v1.id}`, { record: v1 }, { "X-Gap-Request": "" });
    expect([400, 403]).toContain(res.status);
    expect((await yes.get("/api/excipient-library")).json.records).toHaveLength(0);
  });
});
