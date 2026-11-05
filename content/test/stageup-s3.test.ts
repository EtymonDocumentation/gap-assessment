// STAGEUP job S3: comparing two versions, and the version stamp every document carries. Fictional data only.
import {
  buildDemoProject,
  changeProjectStage,
  compareChangeWord,
  compareCounts,
  compareSummary,
  compareToCsv,
  compareVersions,
  documentHeaderLine,
  ensureStartVersion,
  loggedBetween,
  NO_VERSION_HISTORY,
  openSide,
  projectStage,
  recordExport,
  saveVersion,
  savedVersionStamp,
  stampDocument,
  WORKING_COPY_LABEL,
  workingCopyStamp,
  buildDocument,
  assess,
  type CompareRow,
} from "@gap/engine";
import { emptyProject, type Actor, type Project } from "@gap/process-model";
import { renderHtml } from "@gap/renderers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 180_000 });

const ACTOR: Actor = { name: "A. Tester (fictional)", at: "2026-11-04T09:00:00.000Z" };
const at = (n: number): Actor => ({ ...ACTOR, at: `2026-11-04T09:${String(n).padStart(2, "0")}:00.000Z` });

let demo: Project;
beforeAll(() => {
  demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
}, 120_000);

describe("compareVersions", () => {
  it("finds nothing between identical projects, with and without unchanged items", () => {
    expect(compareVersions(content, demo, structuredClone(demo))).toEqual([]);
    const withSame = compareVersions(content, demo, structuredClone(demo), { includeSame: true });
    expect(withSame.length).toBeGreaterThan(50);
    expect(withSame.every((r) => r.kind === "same" && r.a === r.b)).toBe(true);
    expect(compareSummary(withSame)).toBe("No differences between these two.");
  });

  it("shows the project stage as a gap row, with the words the documents use", async () => {
    const before = await ensureStartVersion(demo, ACTOR);
    const to = projectStage(before) === "clinical" ? "ppq" : "clinical";
    const after = (await changeProjectStage(before, content, to, at(1), "Stage moved for the test")).project;
    const rows = compareVersions(content, before, after);
    const stage = rows.find((r) => r.doc === "gap" && /stage/i.test(r.item));
    expect(stage, "the stage answer").toBeTruthy();
    expect(stage!.kind).toBe("changed");
    expect(stage!.a).not.toBe(stage!.b);
    expect(compareChangeWord("changed", "v2")).toBe("Changed");
  });

  it("reports changed, added and removed items in the TRD, sampling plan, batch record and risk", () => {
    const b = structuredClone(demo);
    // TRD: a text, a step description.
    b.trd.documents[0]!.purpose = "New purpose text (fictional).";
    // Sampling plan: one point's rationale changed, one point removed, one added.
    const plan = b.sampling.plans[0]!;
    const first = plan.points[0]!;
    first.rationale = "Changed rationale (fictional).";
    const removed = plan.points.pop()!;
    plan.points.push({ ...structuredClone(first), id: "SP-999", attribute: "Added attribute (fictional)" });
    // Batch record: a step text.
    const step = b.mbr.records[0]!.sections.flatMap((s) => s.blocks).flatMap((x) => x.steps)[0]!;
    step.text = "Changed step text (fictional).";
    // Risk: the scope note.
    b.risk.assessments[0]!.scopeNote = "Changed scope (fictional).";
    const rows = compareVersions(content, demo, b);
    const by = (doc: string) => rows.filter((r) => r.doc === doc);
    expect(by("trd").some((r) => r.item === "Purpose" && r.kind !== "same" && r.b === "New purpose text (fictional).")).toBe(true);
    expect(by("sampling").some((r) => r.kind === "changed" && r.item === "Rationale" && r.b === "Changed rationale (fictional).")).toBe(true);
    expect(by("sampling").some((r) => r.kind === "removed" && r.item.includes(removed.id))).toBe(true);
    const added = by("sampling").find((r) => r.kind === "added" && r.item.includes("SP-999"));
    expect(added, "the added point").toBeTruthy();
    expect(added!.a).toBe("");
    expect(by("mbr").some((r) => r.kind === "changed" && r.b === "Changed step text (fictional).")).toBe(true);
    expect(by("risk").some((r) => /scope/i.test(r.item) && r.kind === "changed")).toBe(true);
    const counts = compareCounts(rows);
    expect(counts.trd + counts.sampling + counts.mbr + counts.risk).toBeGreaterThanOrEqual(6);
    expect(compareSummary(rows)).toMatch(/^\d+ changes: /);
    // The other direction turns added into removed.
    const back = compareVersions(content, b, demo);
    expect(back.some((r) => r.kind === "added" && r.item.includes(removed.id))).toBe(true);
    expect(back.some((r) => r.kind === "removed" && r.item.includes("SP-999"))).toBe(true);
  });

  it("uses the working copy as a side and reads a saved version back", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await saveVersion(p, at(2), "before")).project;
    const label = p.versionHistory!.entries.at(-1)!.label;
    const edited = structuredClone(p);
    edited.risk.assessments[0]!.scopeNote = "Edited after the version (fictional).";
    const saved = await openSide(edited, label);
    const working = await openSide(edited, WORKING_COPY_LABEL);
    expect(working).toBe(edited);
    expect(saved).not.toBeNull();
    const rows = compareVersions(content, saved!, working!);
    expect(rows.filter((r) => r.kind !== "same")).toHaveLength(1);
    expect(rows[0]!.b).toBe("Edited after the version (fictional).");
    expect(await openSide(edited, "v99")).toBeNull();
    expect(loggedBetween(saved!, working!)).toBe(0);
    expect(compareChangeWord("added", WORKING_COPY_LABEL)).toBe("Added in the working copy");
    expect(compareChangeWord("removed", "v2.1")).toBe("Removed in v2.1");
  });

  it("writes a CSV where every cell is quoted and formulas are neutralised", () => {
    const rows: CompareRow[] = [{ doc: "trd", area: "TRD", item: "Purpose", kind: "changed", a: "=SUM(1)", b: 'say "hi"' }];
    const csv = compareToCsv(rows, "v2", "Working copy");
    expect(csv.split("\r\n")[0]).toBe('"Document","Area","Item","Change","v2","Working copy"');
    expect(csv).toContain(`"'=SUM(1)"`);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"Changed"');
  });

  it("counts the changes logged between two versions", () => {
    const a = emptyProject({ title: "A (fictional)", actor: ACTOR, contentRefs: content.versions });
    const b = structuredClone(a);
    b.changeLog.push({ at: ACTOR.at, by: ACTOR.name, action: "answer", detail: "x" } as never);
    expect(loggedBetween(a, b)).toBe(1);
    expect(loggedBetween(b, a)).toBe(1);
  });
});

describe("the version stamp", () => {
  it("says a saved version, the working copy before and after a change, and no history", async () => {
    const none = emptyProject({ title: "No history (fictional)", actor: ACTOR, contentRefs: content.versions });
    expect(workingCopyStamp(none)).toEqual({ row: NO_VERSION_HISTORY, label: "", saved: "" });

    let p = await ensureStartVersion(none, ACTOR);
    p = (await saveVersion(p, at(3), "x")).project;
    expect(workingCopyStamp(p)).toEqual({ row: "Working copy after v1.1 (no changes since it was saved)", label: "Working copy after v1.1", saved: "2026-11-04" });
    const changed = structuredClone(p);
    changed.meta.title = "Changed (fictional)";
    expect(workingCopyStamp(changed).row).toBe("Working copy after v1.1 (changes since not saved as a version)");
    expect(workingCopyStamp(changed).saved).toBe("");

    expect(savedVersionStamp({ label: "v2", at: "2026-11-04T09:00:00.000Z", stage: "clinical" })).toEqual({ row: "v2 (saved 2026-11-04), project stage Clinical", label: "v2", saved: "2026-11-04" });
    expect(savedVersionStamp({ label: "v1", at: "2026-11-04T09:00:00.000Z" }).row).toBe("v1 (saved 2026-11-04), project stage not set");
  });

  it("goes on the cover data, the header line and the HTML preview, and never changes the content", () => {
    const doc = buildDocument(content, demo, assess(content, demo), "2026-11-04T09:00:00.000Z");
    expect(doc.cover.version).toBeUndefined();
    const stamped = stampDocument(doc, savedVersionStamp({ label: "v2", at: "2026-11-04T09:00:00.000Z", stage: "ppq" }));
    expect(stamped.sections).toBe(doc.sections);
    expect(documentHeaderLine(stamped)).toBe(`${doc.title} · Project stage: ${doc.cover.stageShort} · v2`);
    expect(documentHeaderLine(doc)).toBe(`${doc.title} · Project stage: ${doc.cover.stageShort}`);
    const html = renderHtml(stamped);
    expect(html).toContain("Version: v2 (saved 2026-11-04), project stage PPQ");
    expect(html).toContain(`Project stage: ${doc.cover.stageShort} · v2`);
    expect(renderHtml(doc)).not.toContain("Version: ");
  });

  it("is written to the export record of a working copy, and a project without history records none", async () => {
    const record = (project: Project) =>
      recordExport(project, { at: ACTOR.at, by: ACTOR.name, format: "docx", template: { mode: "builtin", name: "Built-in default", version: "1.4.0" }, fingerprint: "abc" }).document.exports.at(-1)!;
    expect(record(demo).version).toBeUndefined();
    const p = await ensureStartVersion(demo, ACTOR);
    expect(record(p).version).toBe("Working copy after v1");
  });
});
