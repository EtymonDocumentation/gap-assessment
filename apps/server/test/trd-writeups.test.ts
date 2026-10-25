/// <reference types="node" />
import { editLibraryWriteup } from "@gap/engine";
import { trdWriteups } from "@gap/content";
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
    username: `wu${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Person",
    password: GOOD_PASSWORD,
  });
  expect(res.status).toBe(201);
  return c;
}

describe("the TRD write-up library on the server (M9.1)", () => {
  const lib = trdWriteups.find((w) => w.id === "wu_compounding")!;
  const v2 = editLibraryWriteup(lib, { title: "Compounding (edited, fictional)" }, "2026-10-25T09:00:00.000Z", "Test Person");

  it("is behind the TRD module", async () => {
    const no = await clientWith("gap,mbr");
    expect((await no.get("/api/trd-writeups")).status).toBe(403);
    expect((await no.put(`/api/trd-writeups/${v2.id}`, { writeup: v2 })).status).toBe(403);
    expect((await no.del(`/api/trd-writeups/${v2.id}`)).status).toBe(403);
  });

  it("stores a user copy per account, checks the id and the shape, and removes it", async () => {
    const yes = await clientWith("gap,trd");
    expect((await yes.get("/api/trd-writeups")).json.writeups).toHaveLength(0);
    expect((await yes.put(`/api/trd-writeups/${v2.id}`, { writeup: v2 })).status).toBe(200);
    const items = (await yes.get("/api/trd-writeups")).json.writeups as { id: string; version: number; title: string }[];
    expect(items.find((w) => w.id === v2.id)).toMatchObject({ version: v2.version, title: "Compounding (edited, fictional)" });
    // The id in the address must match the write-up, and the shape must be valid.
    expect((await yes.put("/api/trd-writeups/other_id", { writeup: v2 })).status).toBe(400);
    expect((await yes.put(`/api/trd-writeups/${v2.id}`, { writeup: { ...v2, parts: "no" } })).status).toBe(400);
    // Another account never sees it.
    const other = await clientWith("gap,trd");
    expect((await other.get("/api/trd-writeups")).json.writeups).toHaveLength(0);
    expect((await yes.del(`/api/trd-writeups/${v2.id}`)).status).toBe(204);
    expect((await yes.del(`/api/trd-writeups/${v2.id}`)).status).toBe(404);
  });
});
