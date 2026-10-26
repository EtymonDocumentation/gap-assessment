import { describe, expect, it, vi } from "vitest";
import type { MbrRecord, Project } from "@gap/process-model";
import {
  addBlockForRequirement,
  addBlockFromLibrary,
  addCustomBlock,
  addMbrStep,
  addParamRow,
  addSection,
  blockLibraryStatus,
  buildDemoProject,
  createMbr,
  editLibraryBlock,
  mbrOpenItems,
  moveMbrStep,
  NOTE_OUTSIDE,
  NOTE_TIGHTER,
  numberSteps,
  paramNote,
  removeMbrStep,
  renderStepText,
  REMOVED_STEP,
  sampleNotices,
  setParam,
  stepRefToken,
  targetSum,
  trdNotices,
  trdRequirementsWithoutStep,
  updateBlockFromLibrary,
  updateMbrStep,
  updateRowFromTrd,
  updateSampleRowFromPlan,
} from "@gap/engine";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "../../../content/index";
import { ACTOR } from "./helpers";

vi.setConfig({ testTimeout: 60000 });

const base = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
const trd = base.trd.documents[0]!;
const plan = base.sampling.plans[0]!;
const lib = (id: string) => mbrLibrary.find((b) => b.id === id)!;

/** A record from the demo TRD and plan with one section for compounding, one for sterile filtration. */
function start() {
  const r = createMbr(
    base,
    {
      title: "Test record (fictional)",
      trdId: trd.id,
      planId: plan.id,
      sections: [
        { unitOp: "compounding", title: "Compounding", blocks: [lib("dilution_and_mixing"), lib("sample_table")] },
        { unitOp: "sterile_filtration", title: "Sterile filtration", blocks: [lib("sterile_filtration_run")] },
      ],
    },
    ACTOR,
  );
  return { project: r.project, id: r.recordId };
}
const rec = (p: Project, id: string): MbrRecord => p.mbr.records.find((r) => r.id === id)!;
const rows = (r: MbrRecord) => r.sections.flatMap((s) => s.blocks.flatMap((b) => b.params));

describe("M11 batch record engine", () => {
  it("creates a record with ids from MBR-001, a change-log entry, and never preselects a choice", () => {
    const { project, id } = start();
    expect(id).toBe("MBR-001");
    expect(rows(rec(project, id)).length).toBeGreaterThan(3);
    expect(rows(rec(project, id)).every((r) => r.choice === undefined)).toBe(true);
    expect(project.changeLog.at(-1)!.action).toBe("mbr_add");
    expect(mbrOpenItems(project, rec(project, id), mbrLibrary).some((o) => o.kind === "not_decided")).toBe(true);
  });

  it("numbers steps by position, keeps references as ids and shows them as (Step n.m)", () => {
    let { project } = start();
    const id = "MBR-001";
    const r0 = rec(project, id);
    const first = r0.sections[0]!.blocks[0]!.steps[0]!;
    const last = r0.sections[1]!.blocks[0]!.steps[0]!;
    project = updateMbrStep(project, id, first.id, `Check against ${stepRefToken(last.id)}.`, ACTOR);
    const numbers = numberSteps(rec(project, id));
    expect(numbers.get(first.id)).toBe("1.1");
    expect(renderStepText(rec(project, id).sections[0]!.blocks[0]!.steps[0]!.text, numbers)).toBe(`Check against (Step ${numbers.get(last.id)}).`);
    // A step added before the referenced one moves its number, and the text follows without being rewritten.
    const added = addMbrStep(project, id, rec(project, id).sections[1]!.blocks[0]!.id, "New first step", ACTOR, 0);
    project = added.project;
    expect(numberSteps(rec(project, id)).get(last.id)).toBe("2.2");
    project = moveMbrStep(project, id, added.stepId, 1, ACTOR);
    expect(numberSteps(rec(project, id)).get(last.id)).toBe("2.1");
    expect(renderStepText(rec(project, id).sections[0]!.blocks[0]!.steps[0]!.text, numberSteps(rec(project, id)))).toContain("(Step 2.1)");
    // Removing the referenced step leaves a plain note, never a wrong number.
    project = removeMbrStep(project, id, last.id, ACTOR);
    expect(renderStepText(rec(project, id).sections[0]!.blocks[0]!.steps[0]!.text, numberSteps(rec(project, id)))).toContain(REMOVED_STEP);
  });

  it("never reuses an id inside a record", () => {
    const { project, id } = start();
    const block = rec(project, id).sections[0]!.blocks[0]!;
    const a = addMbrStep(project, id, block.id, "a", ACTOR);
    const b = removeMbrStep(a.project, id, a.stepId, ACTOR);
    const c = addMbrStep(b, id, block.id, "b", ACTOR);
    expect(c.stepId).not.toBe(a.stepId);
  });

  it("same as TRD copies the TRD value and keeps it read-only; tightened takes the author's own value with a unit of its own", () => {
    let { project } = start();
    const id = "MBR-001";
    const row = rows(rec(project, id)).find((r) => r.trd?.status === "established" && r.trd.text)!;
    project = setParam(project, id, row.id, { choice: "same_as_trd" }, ACTOR);
    const same = rows(rec(project, id)).find((r) => r.id === row.id)!;
    expect(same.mbrValue).toBe(row.trd!.text);
    expect(() => setParam(project, id, row.id, { mbrValue: "1" }, ACTOR)).toThrow(/follows the TRD value/);
    project = setParam(project, id, row.id, { choice: "tightened_by_cmo", mbrValue: "5", mbrUnit: "my-unit", reason: "Reason (fictional)" }, ACTOR);
    const t = rows(rec(project, id)).find((r) => r.id === row.id)!;
    // The unit is held per side and never converted.
    expect(t.mbrUnit).toBe("my-unit");
    expect(t.trd!.unit).toBe(row.trd!.unit);
    // Back to "not decided": the choice is removed, not defaulted.
    project = setParam(project, id, row.id, { choice: null }, ACTOR);
    expect(rows(rec(project, id)).find((r) => r.id === row.id)!.choice).toBeUndefined();
    expect(project.changeLog.at(-1)!.action).toBe("mbr_row_update");
  });

  it("reports differences as information only, and not for a study point", () => {
    let { project } = start();
    const id = "MBR-001";
    const row = rows(rec(project, id)).find((r) => r.trd?.min !== undefined && r.trd?.max !== undefined && r.trd.min !== r.trd.max)!;
    const unit = row.trd!.unit ?? "";
    const { min, max } = row.trd!;
    const pick = () => rows(rec(project, id)).find((r) => r.id === row.id)!;
    project = setParam(project, id, row.id, { choice: "tightened_by_cmo", mbrValue: `${min! + (max! - min!) / 4} to ${max! - (max! - min!) / 4}`, mbrUnit: unit }, ACTOR);
    expect(paramNote(pick())).toBe(NOTE_TIGHTER);
    project = setParam(project, id, row.id, { mbrValue: `${min! - 5} to ${max! + 5}` }, ACTOR);
    // The edit was saved: a note never refuses it.
    expect(pick().mbrValue).toBe(`${min! - 5} to ${max! + 5}`);
    expect(paramNote(pick())).toBe(NOTE_OUTSIDE);
    project = setParam(project, id, row.id, { studyPoint: true }, ACTOR);
    expect(paramNote(pick())).toBeUndefined();
    // Different units are not compared: no note and no conversion.
    project = setParam(project, id, row.id, { studyPoint: false, mbrUnit: "zz" }, ACTOR);
    expect(paramNote(pick())).toBeUndefined();
  });

  it("notices a changed TRD value and rewrites a row only when asked", () => {
    let { project } = start();
    const id = "MBR-001";
    const row = rows(rec(project, id)).find((r) => r.trd?.status === "established" && r.trd.text)!;
    project = setParam(project, id, row.id, { choice: "same_as_trd" }, ACTOR);
    // Simulate a copy made before the TRD changed.
    const aged = structuredClone(project);
    const target = rows(rec(aged, id)).find((r) => r.id === row.id)!;
    target.trd!.text = "999";
    target.mbrValue = "999";
    expect(trdNotices(aged, rec(aged, id)).map((n) => n.rowId)).toContain(row.id);
    // Nothing is rewritten by looking, or by anything but the Update.
    expect(rows(rec(aged, id)).find((r) => r.id === row.id)!.mbrValue).toBe("999");
    const updated = updateRowFromTrd(aged, id, row.id, ACTOR);
    expect(rows(rec(updated, id)).find((r) => r.id === row.id)!.mbrValue).toBe(row.trd!.text);
    expect(trdNotices(updated, rec(updated, id)).map((n) => n.rowId)).not.toContain(row.id);
    expect(updated.changeLog.at(-1)!.action).toBe("mbr_trd_refresh");
  });

  it("a tightened value survives an update from the TRD", () => {
    let { project } = start();
    const id = "MBR-001";
    const row = rows(rec(project, id)).find((r) => r.trd?.status === "established" && r.trd.text)!;
    project = setParam(project, id, row.id, { choice: "tightened_by_cmo", mbrValue: "7" }, ACTOR);
    const aged = structuredClone(project);
    rows(rec(aged, id)).find((r) => r.id === row.id)!.trd!.text = "999";
    const updated = updateRowFromTrd(aged, id, row.id, ACTOR);
    expect(rows(rec(updated, id)).find((r) => r.id === row.id)!.mbrValue).toBe("7");
  });

  it("shows a changed sampling plan on the sample rows and updates them on request", () => {
    const { project, id } = start();
    const sample = rec(project, id).sections.flatMap((s) => s.blocks.flatMap((b) => b.samples))[0]!;
    expect(sampleNotices(project, rec(project, id))).toHaveLength(0);
    const changed = structuredClone(project);
    changed.sampling.plans[0]!.points.find((p) => p.id === sample.pointId)!.container = "Changed container (fictional)";
    expect(sampleNotices(changed, rec(changed, id)).map((n) => n.rowId)).toContain(sample.id);
    const fresh = updateSampleRowFromPlan(changed, id, sample.id, ACTOR);
    expect(sampleNotices(fresh, rec(fresh, id))).toHaveLength(0);
    expect(fresh.changeLog.at(-1)!.action).toBe("mbr_sample_refresh");
  });

  it("lists TRD requirements without a step and adds a block for one", () => {
    let { project } = start();
    const id = "MBR-001";
    const missing = trdRequirementsWithoutStep(rec(project, id), trd, mbrLibrary);
    expect(missing.length).toBeGreaterThan(0);
    const q = missing[0]!;
    project = addBlockForRequirement(project, id, q, undefined, ACTOR).project;
    const after = trdRequirementsWithoutStep(rec(project, id), trd, mbrLibrary);
    expect(after.some((x) => x.itemKey === q.itemKey && x.unitOp === q.unitOp)).toBe(false);
    expect(after.length).toBeLessThan(missing.length);
  });

  it("versions library blocks: an edit makes the next version with the earlier one in the history, an unchanged save makes none", () => {
    const cur = lib("dilution_and_mixing");
    expect(editLibraryBlock(cur, { title: cur.title }, "2026-10-24T09:00:00.000Z", "A")).toBe(cur);
    const v2 = editLibraryBlock(cur, { steps: [...cur.steps, "One more step (fictional)."] }, "2026-10-24T09:00:00.000Z", "A");
    expect(v2.version).toBe(cur.version + 1);
    expect(v2.history).toHaveLength((cur.history?.length ?? 0) + 1);
    expect(v2.history!.at(-1)!.steps).toEqual(cur.steps);
  });

  it("shows 'newer' for a record made from an older library version and updates on request, keeping choices and step ids", () => {
    let { project } = start();
    const id = "MBR-001";
    const block = rec(project, id).sections[0]!.blocks[0]!;
    const row = block.params[0]!;
    project = setParam(project, id, row.id, { choice: "tightened_by_cmo", mbrValue: "7" }, ACTOR);
    const v2 = editLibraryBlock(lib(block.libraryId!), { steps: [...lib(block.libraryId!).steps, "Added step (fictional)."] }, "2026-10-24T09:00:00.000Z", "A");
    expect(blockLibraryStatus(block, [v2])).toEqual({ kind: "newer", libraryVersion: block.libraryVersion! + 1, usedVersion: block.libraryVersion! });
    const stepIds = block.steps.map((s) => s.id);
    project = updateBlockFromLibrary(project, id, block.id, v2, ACTOR);
    const nb = rec(project, id).sections[0]!.blocks[0]!;
    expect(nb.libraryVersion).toBe(block.libraryVersion! + 1);
    expect(nb.steps.slice(0, stepIds.length).map((s) => s.id)).toEqual(stepIds);
    expect(nb.steps.at(-1)!.text).toBe("Added step (fictional).");
    expect(nb.params.find((r) => r.id === row.id)!.mbrValue).toBe("7");
    expect(blockLibraryStatus(nb, [v2])).toEqual({ kind: "current" });
  });

  it("keeps a block of the author's own and a row without a TRD link, and logs each edit in words", () => {
    let { project } = start();
    const id = "MBR-001";
    const section = rec(project, id).sections[0]!;
    const b = addCustomBlock(project, id, section.id, { title: "Own block" }, ACTOR);
    const r = addParamRow(b.project, id, b.blockId, { label: "Own row" }, ACTOR);
    project = r.project;
    expect(rows(rec(project, id)).find((x) => x.id === r.rowId)!.trd).toBeUndefined();
    project = addSection(project, id, { title: "Extra" }, ACTOR).project;
    expect(addBlockFromLibrary(project, id, section.id, lib("batch_review"), ACTOR).project.changeLog.at(-1)!.action).toBe("mbr_block_add");
    const last = r.project.changeLog.at(-1)!;
    expect(JSON.stringify(last)).not.toMatch(/mbrValue|studyPoint|libraryVersion/);
  });

  it("states the sum of targets as information", () => {
    const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
    const limit = demo.mbr.records[0]!.sections.flatMap((s) => s.blocks.flatMap((b) => b.timeLimits)).find((l) => l.targets.length === 2)!;
    expect(targetSum(limit).text).toMatch(/information/i);
  });
});
