/// <reference types="node" />
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleProject, signedInClient, startEnv, type TestEnv } from "./helpers";

/**
 * Schema 1.9.0 retires the "Unknown" answer. The laptop server keeps whole project files on disk, so a project stored
 * by a 1.8.0 build must still load, and must convert to TBD when it is written back. These tests run against a
 * throw-away data folder with a copy of an old-format project; the live data folder is never touched.
 */

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

const PROJECT_ID = "5f0c8a52-3f5e-4d7e-9a41-0a1b2c3d4e5f";

/** A project file as a 1.8.0 build stored it, with one Unknown entry and the old log record saying so. */
function oldStoredFile() {
  const p = JSON.parse(JSON.stringify(sampleProject("Old stored project (fictional)"))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  p.schemaVersion = "1.8.0";
  p.scope.modality = {
    id: "ent-old-modality",
    path: "scope.modality",
    status: "unknown",
    sourceIds: [],
    recordedBy: "Test Person",
    recordedAt: "2026-01-02T00:00:00.000Z",
    revision: 1,
  };
  p.changeLog.push({ at: "2026-01-02T00:00:00.000Z", by: "Test Person", action: "answer", path: "scope.modality", after: { status: "unknown" } });
  return { id: PROJECT_ID, revision: 1, updatedAt: "2026-01-02T00:00:00.000Z", project: p };
}

describe("a project stored by a 1.8.0 build", () => {
  it("is listed and read back exactly as stored (the server does not rewrite files on read)", async () => {
    const c = await signedInClient(env);
    const dir = join(env.dataDir, "users", c.userId, "projects");
    await mkdir(dir, { recursive: true });
    const file = oldStoredFile();
    await writeFile(join(dir, `${PROJECT_ID}.json`), JSON.stringify(file));

    const list = await c.get("/api/projects");
    expect(list.json.projects.find((p: { id: string }) => p.id === PROJECT_ID)).toMatchObject({ schemaVersion: "1.8.0", revision: 1 });
    const got = await c.get(`/api/projects/${PROJECT_ID}`);
    expect(got.json).toEqual(file); // the web app migrates it on load and saves it back (see sync.ts)
  });

  it("converts Unknown to TBD, with a change-log record, when the old file is saved back", async () => {
    const c = await signedInClient(env);
    const dir = join(env.dataDir, "users", c.userId, "projects");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${PROJECT_ID}.json`), JSON.stringify(oldStoredFile()));

    const old = oldStoredFile().project;
    const put = await c.put(`/api/projects/${PROJECT_ID}`, { project: old, baseRevision: 1 });
    expect(put.status).toBe(200);
    const saved = (await c.get(`/api/projects/${PROJECT_ID}`)).json.project;
    expect(saved.schemaVersion).toBe("1.24.0");
    expect(saved.scope.modality).toMatchObject({ status: "tbd", tbd: {} });
    const record = saved.changeLog.at(-1);
    expect(record).toMatchObject({ by: "System (file update)", action: "migrate_status", path: "scope.modality" });
    expect(record.detail).toMatch(/Unknown converted to TBD/);
    // The old record is history and still says what was recorded.
    expect(saved.changeLog.find((e: { action: string; after?: { status?: string } }) => e.action === "answer" && e.after?.status === "unknown")).toBeDefined();
  });

  it("converts the same way when an old file is uploaded as a new project", async () => {
    const c = await signedInClient(env);
    const made = await c.post("/api/projects", { project: oldStoredFile().project });
    expect(made.status).toBe(201);
    const saved = (await c.get(`/api/projects/${made.json.id}`)).json.project;
    expect(saved.schemaVersion).toBe("1.24.0");
    expect(saved.scope.modality.status).toBe("tbd");
  });

  it("refuses a new write of the retired status on a current file", async () => {
    const c = await signedInClient(env);
    const bad = oldStoredFile().project;
    bad.schemaVersion = "1.10.0";
    const res = await c.post("/api/projects", { project: bad });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain("invalid-project");
  });
});
