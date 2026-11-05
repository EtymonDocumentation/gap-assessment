// STAGEUP job S1: version history inside the project, the stage change with its version and review, and the open-item sentence in the five
// documents. Engine and data only (no screens). Fictional data only.
import {
  ACTION_LABELS,
  buildDemoProject,
  buildDocument,
  assess,
  buildMbrDocument,
  buildRiskAssessmentDocument,
  buildSamplingPlanDocument,
  buildTrdDocument,
  changeLogView,
  changeProjectStage,
  ensureStartVersion,
  hasUnsavedChanges,
  historyUsage,
  leftOutSentence,
  mbrPpqOnlyItems,
  openReviewCount,
  openReviewItems,
  partIsIn,
  pointStageReminder,
  PROGRAM_STAGES,
  projectFingerprint,
  projectStage,
  readVersion,
  removalLine,
  removeVersion,
  riskStageLine,
  saveVersion,
  setProjectStage,
  setReviewItemReviewed,
  stageOpenItems,
  stageReviewItems,
  stageReviewOpenLines,
  StageChangeError,
  StageReviewError,
  trdRangeIntro,
  VERSION_LIMITS,
  VersionError,
  VersionLimitError,
  withoutHistory,
  type ProgramStage,
} from "@gap/engine";
import { emptyProject, parseProject, SCHEMA_VERSION, type Actor, type Project } from "@gap/process-model";
import { renderMarkdown } from "@gap/renderers";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 180_000 });

const NOW = "2026-11-04T09:00:00.000Z";
const ACTOR: Actor = { name: "A. Tester (fictional)", at: NOW };
const opts = { generatedAt: NOW, appVersion: "0.0.0-test" };
const flat = (s: string) => s.replace(/\s+/g, " ");

let demo: Project;
beforeAll(() => {
  demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
}, 120_000);

/** A small project (no documents) for the cheap cases. */
const small = (): Project => emptyProject({ title: "Small (fictional)", actor: ACTOR, contentRefs: content.versions });
const at = (n: number): Actor => ({ ...ACTOR, at: `2026-11-04T09:${String(n).padStart(2, "0")}:00.000Z` });

describe("migration to 1.30.0", () => {
  it("adds an empty version history and changes nothing else; twice gives the same", () => {
    const p = small();
    const raw = JSON.parse(JSON.stringify(p));
    raw.schemaVersion = "1.29.0";
    delete raw.versionHistory;
    const once = parseProject(raw);
    expect(SCHEMA_VERSION).toBe("1.30.0");
    expect(once.schemaVersion).toBe("1.30.0");
    expect(once.versionHistory).toEqual({ entries: [], reviews: [] });
    expect(parseProject(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect({ ...once, versionHistory: undefined }).toEqual({ ...p, versionHistory: undefined });
  });
  it("does not make the start version itself (it cannot compress); the store does", async () => {
    const p = small();
    expect(p.versionHistory?.entries).toEqual([]);
    const q = await ensureStartVersion(p, ACTOR);
    expect(q.versionHistory!.entries.map((e) => e.label)).toEqual(["v1"]);
    expect(q.versionHistory!.entries[0]!.kind).toBe("start");
  });
  it("makes the start version only when no version ever existed", async () => {
    const q = await ensureStartVersion(small(), ACTOR);
    expect(await ensureStartVersion(q, at(1))).toBe(q);
    const emptied = removeVersion(q, q.versionHistory!.entries[0]!.id, at(2), "Not needed any more");
    expect(await ensureStartVersion(emptied, at(3))).toBe(emptied);
  });
});

describe("numbering and snapshots", () => {
  it("counts v1, then v1.1 and v1.2 for saved versions", async () => {
    let p = await ensureStartVersion(small(), ACTOR);
    p = (await saveVersion(p, at(1), "first")).project;
    p = (await saveVersion(p, at(2))).project;
    expect(p.versionHistory!.entries.map((e) => e.label)).toEqual(["v1", "v1.1", "v1.2"]);
  });
  it("never reuses a label after a removal", async () => {
    let p = await ensureStartVersion(small(), ACTOR);
    p = (await saveVersion(p, at(1))).project;
    p = (await saveVersion(p, at(2))).project;
    const last = p.versionHistory!.entries.at(-1)!;
    p = removeVersion(p, last.id, at(3), "Saved by mistake");
    p = (await saveVersion(p, at(4))).project;
    expect(p.versionHistory!.entries.map((e) => e.label)).toEqual(["v1", "v1.1", "v1.3"]);
  });
  it("reads a saved version back through parseProject with the same fingerprint, and later edits never change it", async () => {
    let p = await ensureStartVersion(small(), ACTOR);
    const v1 = p.versionHistory!.entries[0]!;
    const back = await readVersion(v1);
    expect(projectFingerprint(back)).toBe(v1.fingerprint);
    expect(back.versionHistory).toBeUndefined();
    p = { ...p, meta: { ...p.meta, title: "Edited later" } };
    expect((await readVersion(v1)).meta.title).toBe("Small (fictional)");
    expect(hasUnsavedChanges(p)).toBe(true);
  });
  it("is not 'changed' right after a save, and is after an edit", async () => {
    const { project } = await saveVersion(await ensureStartVersion(small(), ACTOR), at(1));
    expect(hasUnsavedChanges(project)).toBe(false);
    expect(hasUnsavedChanges({ ...project, meta: { ...project.meta, title: "Other" } })).toBe(true);
  });
});

describe("budget and removal", () => {
  it("refuses the 61st version and says how to get out", async () => {
    let p = await ensureStartVersion(small(), ACTOR);
    p = { ...p, versionHistory: { ...p.versionHistory!, entries: Array.from({ length: VERSION_LIMITS.maxVersions }, (_, i) => ({ ...p.versionHistory!.entries[0]!, id: `ver-${i}`, minor: i, label: `v1.${i}` })) } };
    await expect(saveVersion(p, at(1))).rejects.toThrow(VersionLimitError);
    await expect(saveVersion(p, at(1))).rejects.toThrow(/Remove a version/);
    expect(historyUsage(p).atLimit).toBe(true);
  });
  it("refuses a version that would pass the size limit", async () => {
    const p = await ensureStartVersion(small(), ACTOR);
    const big = { ...p, versionHistory: { ...p.versionHistory!, entries: [{ ...p.versionHistory!.entries[0]!, bytes: VERSION_LIMITS.maxBytes - 10 }] } };
    await expect(saveVersion(big, at(1))).rejects.toThrow(VersionLimitError);
    expect(historyUsage(big).nearLimit).toBe(true);
  });
  it("lets any version go (start, major, minor) with a reason, logs it and leaves a history line", async () => {
    let p = await ensureStartVersion(small(), ACTOR);
    p = (await saveVersion(p, at(1))).project;
    for (const e of [...p.versionHistory!.entries]) p = removeVersion(p, e.id, at(2), "Cleaning up");
    expect(p.versionHistory!.entries).toEqual([]);
    expect(p.versionHistory!.removed!.map((r) => r.label)).toEqual(["v1", "v1.1"]);
    expect(p.changeLog.filter((c) => c.action === "version_remove")).toHaveLength(2);
    expect(removalLine(p.versionHistory!.removed![0]!)).toContain("v1 removed on 2026-11-04 by A. Tester (fictional): Cleaning up");
  });
  it("needs a reason and a version that exists", async () => {
    const p = await ensureStartVersion(small(), ACTOR);
    const id = p.versionHistory!.entries[0]!.id;
    expect(() => removeVersion(p, id, at(1), " ")).toThrow(VersionError);
    expect(() => removeVersion(p, "nope", at(1), "Reason")).toThrow(VersionError);
  });
});

describe("changeProjectStage", () => {
  it("goes forward with a major version, writes the answer and the stage_change record, and is not 'changed' afterwards", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await changeProjectStage(p, content, "clinical", at(1), "Moving to the clinical build")).project;
    const r = await changeProjectStage(p, content, "ppq", at(2), "PPQ is approved");
    expect(r.entry!.label).toBe("v3");
    expect(r.project.versionHistory!.entries.map((e) => e.label)).toEqual(["v1", "v2", "v3"]);
    expect(projectStage(r.project)).toBe("ppq");
    expect(r.project.changeLog.some((c) => c.action === "stage_change")).toBe(true);
    expect(r.project.changeLog.some((c) => c.action === "answer")).toBe(true);
    expect(hasUnsavedChanges(r.project)).toBe(false);
    expect(r.review!.direction).toBe("forward");
    expect(r.review!.versionLabel).toBe("v3");
    expect(r.review!.items.length).toBeGreaterThan(0);
  });
  it("going back is allowed with a reason, bumps the major again and rolls nothing back", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await changeProjectStage(p, content, "commercial", at(1), "Commercial wording")).project;
    const r = await changeProjectStage(p, content, "clinical", at(2), "Entered wrongly");
    expect(r.review!.direction).toBe("back");
    expect(r.entry!.label).toBe("v3");
    expect(r.project.processes).toEqual({ ...p.processes, target: r.project.processes.target });
  });
  it("needs a reason when the stage changes, but not for the first time", async () => {
    const p = await ensureStartVersion(demo, ACTOR);
    const set = p.processes.target.site.fields as Record<string, unknown>;
    const first = structuredClone(p);
    delete (first.processes.target.site.fields as Record<string, unknown>).programStage;
    expect(set).toBeDefined();
    const r = await changeProjectStage(first, content, "clinical", at(1), "");
    expect(r.review!.direction).toBe("first-set");
    await expect(changeProjectStage(p, content, projectStage(p) === "clinical" ? "ppq" : "clinical", at(1), "  ")).rejects.toThrow(StageChangeError);
  });
  it("choosing the stage it already has saves no version and asks no reason", async () => {
    const p = await ensureStartVersion(demo, ACTOR);
    const r = await changeProjectStage(p, content, projectStage(p)!, at(1), "");
    expect(r.entry).toBeUndefined();
    expect(r.project.versionHistory!.entries).toHaveLength(1);
  });
  it("saves a minor 'before-change' version first only when the working copy differs", async () => {
    const clean = await ensureStartVersion(demo, ACTOR);
    const to: ProgramStage = projectStage(clean) === "clinical" ? "ppq" : "clinical";
    const a = await changeProjectStage(clean, content, to, at(1), "No edits before");
    expect(a.autoEntry).toBeUndefined();
    expect(a.project.versionHistory!.entries.map((e) => e.label)).toEqual(["v1", "v2"]);
    const edited: Project = { ...clean, meta: { ...clean.meta, title: "Edited before the change" } };
    const b = await changeProjectStage(edited, content, to, at(2), "Edits before");
    expect(b.autoEntry!.kind).toBe("before-change");
    expect(b.project.versionHistory!.entries.map((e) => e.label)).toEqual(["v1", "v1.1", "v2"]);
    expect((await readVersion(b.autoEntry!)).meta.title).toBe("Edited before the change");
  });
  it("leaves the project untouched when it is refused", async () => {
    const p = await ensureStartVersion(demo, ACTOR);
    await expect(changeProjectStage(p, content, projectStage(p) === "clinical" ? "ppq" : "clinical", at(1), "")).rejects.toThrow();
    expect(p.versionHistory!.entries).toHaveLength(1);
  });
});

describe("setProjectStage stays inside the engine", () => {
  // Every editor must go through changeProjectStage (reason, version, review). These web callers still call the inner function until
  // screen job S2 replaces them; the allow-list is temporary and shrinks to nothing.
  const ALLOWED = new Set(["packages/engine/src/project-stage.ts", "apps/web/src/stage-ui.tsx" /* S2 removes these */]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "e2e", "test"].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  it("is called by nothing else", () => {
    const root = join(__dirname, "..", "..");
    const hits = [...walk(join(root, "packages")), ...walk(join(root, "apps"))]
      .filter((f) => /\bsetProjectStage\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));
    expect(hits).toEqual([]);
  });
  it("still works as the inner step", () => {
    const r = setProjectStage(demo, content, projectStage(demo) === "clinical" ? "ppq" : "clinical", ACTOR);
    expect(r.changed).toBe(true);
  });
});

describe("stageReviewItems", () => {
  const stages: (ProgramStage | undefined)[] = [undefined, ...PROGRAM_STAGES];
  const withStage = (s: ProgramStage | undefined): Project => {
    const p = structuredClone(demo);
    const f = p.processes.target.site.fields as Record<string, { value?: unknown }>;
    if (s === undefined) delete f.programStage;
    else f.programStage = { ...(f.programStage ?? {}), value: s } as never;
    return p;
  };
  for (const from of stages)
    for (const to of stages) {
      if (from === to) continue;
      it(`${from ?? "not set"} to ${to ?? "not set"}: items differ in wording and name a document`, () => {
        const items = stageReviewItems(withStage(to), content, from, to);
        for (const i of items) {
          expect(i.before).not.toBe(i.after);
          expect(["gap", "trd", "sampling", "mbr", "risk"]).toContain(i.doc);
          expect(i.title.length).toBeGreaterThan(0);
        }
        expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
      });
    }
  it("has no items when the stage is the same", () => {
    for (const s of stages) expect(stageReviewItems(demo, content, s, s)).toEqual([]);
  });
  it("lists items only for documents the project has", () => {
    const bare = small();
    const docs = new Set(stageReviewItems(bare, content, "clinical", "commercial").map((i) => i.doc));
    expect([...docs].filter((d) => d !== "gap")).toEqual([]);
  });
  it("builds its text by calling the real wording functions", () => {
    const p = withStage("ppq");
    const items = stageReviewItems(p, content, "clinical", "ppq");
    const trd = items.find((i) => i.key.startsWith("T1"));
    expect(trd?.before).toContain(trdRangeIntro("clinical")!.slice(0, 20));
    expect(trd?.after).toContain(trdRangeIntro("ppq")!.slice(0, 20));
    expect(typeof partIsIn).toBe("function");
    expect(typeof pointStageReminder).toBe("function");
    expect(typeof riskStageLine).toBe("function");
    expect(typeof leftOutSentence).toBe("function");
    expect(typeof mbrPpqOnlyItems).toBe("function");
  });
  it("uses every export of stage-chain.ts (a new wording function must be reviewed too)", () => {
    const src = join(__dirname, "..", "..", "packages", "engine", "src");
    const chain = readFileSync(join(src, "stage-chain.ts"), "utf8");
    const review = readFileSync(join(src, "stage-review.ts"), "utf8");
    const stage = readFileSync(join(src, "stage.ts"), "utf8");
    const names = [...chain.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]!);
    // genericActivityStageNote reaches the review through activityStageNote in stage.ts.
    const INDIRECT: Record<string, string> = { genericActivityStageNote: "activityStageNote" };
    const missing = names.filter((n) => {
      if (review.includes(n)) return false;
      const via = INDIRECT[n];
      return !(via && review.includes(via) && stage.includes(n));
    });
    expect(missing).toEqual([]);
  });
});

describe("reviews carry over, tick and un-tick", () => {
  it("takes an open item over into the next review as ONE item and logs it", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    const start = projectStage(p);
    const first = (start === "clinical" ? "ppq" : "clinical") as ProgramStage;
    p = (await changeProjectStage(p, content, first, at(1), "First change")).project;
    const r1 = p.versionHistory!.reviews[0]!;
    expect(r1.items.length).toBeGreaterThan(0);
    const second: ProgramStage = (first as ProgramStage) === "commercial" ? "ppq" : "commercial";
    const out = await changeProjectStage(p, content, second, at(2), "Second change");
    const [old, fresh] = out.project.versionHistory!.reviews;
    const carried = fresh!.items.filter((i) => i.carried);
    expect(carried.length).toBeGreaterThan(0);
    for (const c of carried) {
      expect(c.carried!.fromReviewId).toBe(old!.id);
      expect(old!.items.find((o) => o.key === c.key)!.replaced).toBeDefined();
    }
    expect(out.project.changeLog.filter((c) => c.action === "stage_review_replaced")).toHaveLength(carried.length);
    // an item is open in exactly one review
    const keys = openReviewItems(out.project).map((x) => x.item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("keeps a ticked item ticked and does not carry it over", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    const first = (projectStage(p) === "clinical" ? "ppq" : "clinical") as ProgramStage;
    p = (await changeProjectStage(p, content, first, at(1), "First change")).project;
    const r1 = p.versionHistory!.reviews[0]!;
    const key = r1.items[0]!.key;
    p = setReviewItemReviewed(p, r1.id, key, true, at(2), "Looked at it");
    const second: ProgramStage = (first as ProgramStage) === "commercial" ? "ppq" : "commercial";
    p = (await changeProjectStage(p, content, second, at(3), "Second change")).project;
    const old = p.versionHistory!.reviews[0]!.items.find((i) => i.key === key)!;
    expect(old.reviewed?.by).toBe(ACTOR.name);
    expect(old.replaced).toBeUndefined();
    expect(p.versionHistory!.reviews[1]!.items.find((i) => i.key === key)?.carried).toBeUndefined();
  });
  it("ticks and un-ticks, logging both, and needs a name", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await changeProjectStage(p, content, projectStage(p) === "clinical" ? "ppq" : "clinical", at(1), "Change")).project;
    const r = p.versionHistory!.reviews[0]!;
    const key = r.items[0]!.key;
    const before = openReviewCount(p);
    const ticked = setReviewItemReviewed(p, r.id, key, true, at(2), "Checked with QA");
    expect(openReviewCount(ticked)).toBe(before - 1);
    expect(ticked.changeLog.at(-1)).toMatchObject({ action: "stage_review_item" });
    const reopened = setReviewItemReviewed(ticked, r.id, key, false, at(3));
    expect(openReviewCount(reopened)).toBe(before);
    expect(reopened.changeLog.at(-1)!.detail).toContain("Reopened");
    expect(() => setReviewItemReviewed(p, r.id, key, true, { name: " ", at: NOW })).toThrow(StageReviewError);
    expect(() => setReviewItemReviewed(p, r.id, "nope", true, at(2))).toThrow(StageReviewError);
  });
});

describe("the open-item sentence in all five documents", () => {
  it("is printed by each document builder and the change-log view can show the new actions", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await changeProjectStage(p, content, projectStage(p) === "clinical" ? "ppq" : "clinical", at(1), "Change")).project;
    const r = p.versionHistory!.reviews[0]!;
    const docs: Record<string, string> = {
      gap: renderMarkdown(buildDocument(content, p, assess(content, p), NOW)),
      trd: renderMarkdown(buildTrdDocument(p, p.trd.documents[0]!, opts)),
      sampling: renderMarkdown(buildSamplingPlanDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, opts)),
      mbr: renderMarkdown(buildMbrDocument(p, p.mbr.records[0]!, opts)),
      risk: renderMarkdown(buildRiskAssessmentDocument(content, p, p.risk.assessments[0]!, failureModes, opts)),
    };
    let seen = 0;
    for (const [doc, md] of Object.entries(docs)) {
      const lines = stageReviewOpenLines(p, doc as never);
      if (!r.items.some((i) => i.doc === doc)) {
        expect(lines).toEqual([]);
        continue;
      }
      seen++;
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^Stage review: \d+ items? for this document (is|are) still to be reviewed after the change from \w+ to .+ \(v2\)\.$/);
      expect(flat(md)).toContain(`Open item: ${lines[0]}`);
      expect(stageOpenItems(p, { doc: doc as never })).toContain(lines[0]);
    }
    expect(seen).toBeGreaterThan(0);
    // ticking every item of a document removes its sentence
    let q = p;
    for (const i of r.items) q = setReviewItemReviewed(q, r.id, i.key, true, at(2));
    for (const doc of ["gap", "trd", "sampling", "mbr", "risk"] as const) expect(stageReviewOpenLines(q, doc)).toEqual([]);
    const rows = changeLogView(content, q);
    expect(rows.some((x) => x.actionLabel === ACTION_LABELS.stage_change)).toBe(true);
    expect(rows.some((x) => x.actionLabel === ACTION_LABELS.stage_review_item)).toBe(true);
  });
  it("has plain labels for the new log actions (and none say snapshot, commit or revision)", () => {
    for (const k of ["version_save", "stage_change", "stage_review_item", "stage_review_replaced", "version_remove"]) {
      expect(ACTION_LABELS[k]).toBeTruthy();
      expect(ACTION_LABELS[k]).not.toMatch(/snapshot|commit|revision/i);
    }
  });
  it("lists nothing extra when there is no review", () => {
    expect(stageOpenItems(demo, { doc: "trd" })).toEqual(stageOpenItems(demo));
  });
});

describe("withoutHistory", () => {
  it("drops only the history", () => {
    const { versionHistory, ...rest } = demo;
    expect(versionHistory).toBeDefined();
    expect(withoutHistory(demo)).toEqual(rest);
  });
});
