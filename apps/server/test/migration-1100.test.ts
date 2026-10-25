/// <reference types="node" />
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleProject, signedInClient, startEnv, type TestEnv } from "./helpers";

/**
 * Schema 1.10.0 adds the Scope step (project.stepScope) and ends the review workflow: old revisions and reviewer comments
 * move, untouched, into document.archivedReview. The laptop server keeps whole project files on disk, so a project stored by
 * a 1.9.0 build must still load, and must keep its revisions and comments (archived, not destroyed) when written back. These
 * tests run against a throw-away data folder; the live data folder is never touched.
 */

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.cleanup());

const PROJECT_ID = "6a1d9b63-4a6f-4e8f-8b52-1b2c3d4e5f60";
const REVISION = {
  number: 1,
  status: "draft",
  summary: "First draft (fictional)",
  by: "A. Reviewer (fictional)",
  at: "2026-10-05T09:00:00.000Z",
  fingerprint: "0123456789abcdef",
  template: { mode: "builtin", name: "Built-in default", version: "1.0.0" },
};
const COMMENT = {
  seq: 1,
  anchor: { sectionId: "scope" },
  by: "B. Checker (fictional)",
  at: "2026-10-06T09:00:00.000Z",
  text: "Please check the scope (fictional).",
  status: "open",
  replies: [],
};

/** A project file as a 1.9.0 build stored it, with a revision and a reviewer comment. */
function oldStoredFile() {
  const p = JSON.parse(JSON.stringify(sampleProject("Old reviewed project (fictional)"))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  p.schemaVersion = "1.9.0";
  delete p.stepScope;
  p.document = { revisions: [REVISION], comments: [COMMENT], exports: [] };
  return { id: PROJECT_ID, revision: 1, updatedAt: "2026-01-02T00:00:00.000Z", project: p };
}

describe("a project stored by a 1.9.0 build", () => {
  it("is read back exactly as stored (the server does not rewrite files on read)", async () => {
    const c = await signedInClient(env);
    const dir = join(env.dataDir, "users", c.userId, "projects");
    await mkdir(dir, { recursive: true });
    const file = oldStoredFile();
    await writeFile(join(dir, `${PROJECT_ID}.json`), JSON.stringify(file));
    const got = await c.get(`/api/projects/${PROJECT_ID}`);
    expect(got.json).toEqual(file);
  });

  it("keeps the revision and the comment, archived and untouched, when the old file is saved back", async () => {
    const c = await signedInClient(env);
    const dir = join(env.dataDir, "users", c.userId, "projects");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${PROJECT_ID}.json`), JSON.stringify(oldStoredFile()));
    const put = await c.put(`/api/projects/${PROJECT_ID}`, { project: oldStoredFile().project, baseRevision: 1 });
    expect(put.status).toBe(200);
    const saved = (await c.get(`/api/projects/${PROJECT_ID}`)).json.project;
    expect(saved.schemaVersion).toBe("1.19.0");
    expect(saved.stepScope).toEqual({ excluded: [] });
    expect(saved.document.revisions).toBeUndefined();
    expect(saved.document.comments).toBeUndefined();
    expect(saved.document.archivedReview.revisions).toEqual([REVISION]);
    expect(saved.document.archivedReview.comments).toEqual([COMMENT]);
    expect(saved.changeLog.at(-1)).toMatchObject({ by: "System (file update)", action: "archive_review" });
  });

  it("archives the same way when an old file is uploaded as a new project", async () => {
    const c = await signedInClient(env);
    const made = await c.post("/api/projects", { project: oldStoredFile().project });
    expect(made.status).toBe(201);
    const saved = (await c.get(`/api/projects/${made.json.id}`)).json.project;
    expect(saved.schemaVersion).toBe("1.19.0");
    expect(saved.document.archivedReview.comments).toEqual([COMMENT]);
  });
});
