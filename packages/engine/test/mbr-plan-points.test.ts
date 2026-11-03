// Plan points the batch record leaves out: listed as open items, added from there together with their sampling step, and noted in the
// Process view. The SYR-305 demo is the base (its record covers its whole plan); ARX-217 shows the points a real record leaves out.
// All data are fictional.
import { describe, expect, it, vi } from "vitest";
import type { MbrRecord, Project, SamplingPoint } from "@gap/process-model";
import { addPlanPointToSection, buildDemoProject, buildProcessView, mbrOpenItems, numberSteps, planPointsNotInRecord, removeSampleRow, sampleHomeBlock, unplacedSamples } from "@gap/engine";
import { ACTOR } from "./helpers";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

const build = (key: "syr-305" | "arx-217"): Project => buildDemoProject(content, demos[key], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const project = build("syr-305");

const recOf = (p: Project): MbrRecord => p.mbr.records[0]!;
const sectionOf = (p: Project, unitOp: string) => recOf(p).sections.find((s) => s.unitOp === unitOp)!;
const rowOf = (p: Project, pointId: string) => recOf(p).sections.flatMap((s) => s.blocks.flatMap((b) => b.samples)).find((r) => r.pointId === pointId)!;
const items = (p: Project) => mbrOpenItems(p, recOf(p), mbrLibrary);
const notInRecord = (p: Project) => items(p).filter((o) => o.kind === "sample_not_in_record");
const withoutRow = (p: Project, pointId: string): Project => removeSampleRow(p, recOf(p).id, rowOf(p, pointId).id, ACTOR);
const basePoint = project.sampling.plans[0]!.points.find((p) => p.id === "SP-001")!;

/** A copy of the project whose plan has one more point: SP-001 under a new number (a complete point), changed by `patch`. */
function withPoint(p: Project, patch: Partial<SamplingPoint> & { id: string }): Project {
  const next = structuredClone(p);
  next.sampling.plans[0]!.points.push({ ...structuredClone(basePoint), ...patch } as SamplingPoint);
  return next;
}

/** A copy of the project whose record has a second section on the unit operation, with no block in it. */
function withBareSection(p: Project, unitOp: string, id: string, title: string): Project {
  const next = structuredClone(p);
  const rec = recOf(next);
  rec.sections.push({ ...structuredClone(rec.sections.find((s) => s.unitOp === unitOp)!), id, title, blocks: [] });
  return next;
}

describe("plan points the record leaves out", () => {
  it("lists nothing for the SYR-305 record: its sample tables hold every point of its plan", () => {
    expect(planPointsNotInRecord(project, recOf(project))).toEqual([]);
    expect(notInRecord(project)).toEqual([]);
    // The open items the demo shows (and its end-to-end test expects) are unchanged.
    expect(items(project).map((o) => o.kind)).toEqual(["before_issue"]);
  });

  it("lists a point whose row was taken out of the record, with the one section it belongs in", () => {
    const row = rowOf(project, "SP-001");
    const p = withoutRow(project, "SP-001");
    const compounding = sectionOf(p, "compounding");
    expect(planPointsNotInRecord(p, recOf(p))).toEqual([{ pointId: "SP-001", test: row.test, sectionIds: [compounding.id], chooseWhere: false }]);
    const open = notInRecord(p);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ where: compounding.title, text: `In the sampling plan, not in this batch record: SP-001 (${row.test})`, pointId: "SP-001", sectionIds: [compounding.id], chooseWhere: false });
    // Counted with the record's other open items, so "Open items (n)" never hides a sample of the plan.
    expect(items(p)).toHaveLength(items(project).length + 1);
  });

  it("does not list a point on a unit operation the record has no section for: that is another record's business", () => {
    expect(recOf(project).sections.some((s) => s.unitOp === "capping")).toBe(false);
    const p = withPoint(project, { id: "SP-090", unitOp: "capping" });
    expect(planPointsNotInRecord(p, recOf(p))).toEqual([]);
    expect(items(p)).toHaveLength(items(project).length);
  });

  it("lists a point that names no unit operation as 'choose where', with every section as a possible place", () => {
    for (const unitOp of ["none", "custom_step"]) {
      const p = withPoint(project, { id: "SP-091", unitOp });
      const rec = recOf(p);
      expect(planPointsNotInRecord(p, rec)).toEqual([{ pointId: "SP-091", test: expect.any(String), sectionIds: rec.sections.map((s) => s.id), chooseWhere: true }]);
      expect(notInRecord(p)[0]).toMatchObject({ where: "Choose where", pointId: "SP-091", chooseWhere: true });
    }
  });

  it("names every section that could take the point when two sections share its unit operation", () => {
    const p = withBareSection(withoutRow(project, "SP-001"), "compounding", "SC-900", "Compounding of the second tank");
    const first = sectionOf(p, "compounding");
    const [item] = notInRecord(p);
    expect(item!.sectionIds).toEqual([first.id, "SC-900"]);
    expect(item!.where).toBe(`Choose where: ${first.title}, Compounding of the second tank`);
  });

  it("is the same list in the ARX-217 demo: only points that fit a section of the record, or name no unit operation", () => {
    const arx = build("arx-217");
    const rec = recOf(arx);
    const plan = arx.sampling.plans.find((p) => p.id === rec.planId)!;
    const covered = new Set(rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.samples.map((r) => r.pointId))));
    const left = planPointsNotInRecord(arx, rec);
    expect(left.length).toBeGreaterThan(0);
    for (const x of left) {
      const point = plan.points.find((q) => q.id === x.pointId)!;
      expect(covered.has(x.pointId), x.pointId).toBe(false);
      if (x.chooseWhere) {
        expect(["none", "custom_step"], x.pointId).toContain(point.unitOp);
        expect(x.sectionIds, x.pointId).toEqual(rec.sections.map((s) => s.id));
      } else {
        expect(x.sectionIds.length, x.pointId).toBeGreaterThan(0);
        for (const id of x.sectionIds) expect(rec.sections.find((s) => s.id === id)!.unitOp, x.pointId).toBe(point.unitOp);
      }
    }
    expect(mbrOpenItems(arx, rec, mbrLibrary).filter((o) => o.kind === "sample_not_in_record")).toHaveLength(left.length);
  });
});

describe("the block that takes a new sample row", () => {
  it("is the sample table of the section", () => {
    expect(sampleHomeBlock(sectionOf(project, "compounding"), basePoint, mbrLibrary)?.libraryId).toBe("sample_table");
  });

  it("is the one block that already holds sample rows when it is a block the author wrote", () => {
    const p = structuredClone(project);
    const compounding = sectionOf(p, "compounding");
    const table = compounding.blocks.find((b) => b.libraryId === "sample_table")!;
    delete table.libraryId;
    expect(sampleHomeBlock(compounding, basePoint, mbrLibrary)?.id).toBe(table.id);
  });

  it("is not guessed when no block of the section holds sample rows", () => {
    const visual = sectionOf(project, "visual_inspection");
    expect(visual.blocks.some((b) => b.samples.length > 0)).toBe(false);
    expect(sampleHomeBlock(visual, basePoint, mbrLibrary)).toBeUndefined();
  });
});

describe("adding a plan point to a section from the open items", () => {
  // The plan gains a point at the start of mixing after the record was made.
  const added = withPoint(project, { id: "SP-092" });
  const rec = recOf(added);
  const compounding = sectionOf(added, "compounding");
  const mixingOf = (p: Project) => sectionOf(p, "compounding").blocks.find((b) => b.libraryId === "dilution_and_mixing")!;

  it("puts the row in the sample table and writes the sampling step where the block names the place for the moment", () => {
    expect(notInRecord(added).map((o) => o.pointId)).toEqual(["SP-092"]);
    const after = addPlanPointToSection(added, rec.id, compounding.id, "SP-092", mbrLibrary, ACTOR);
    const section = sectionOf(after, "compounding");
    expect(section.blocks.find((b) => b.libraryId === "sample_table")!.samples.map((r) => r.pointId)).toContain("SP-092");
    const mixing = mixingOf(after);
    const at = mixing.steps.findIndex((s) => s.placedFor?.points.includes("SP-092"));
    expect(at).toBeGreaterThan(0);
    expect(mixing.steps[at]!.placedFor).toEqual({ moment: "beginning", points: ["SP-092"] });
    expect(mixing.steps[at]!.text.startsWith("Take sample SP-092 ")).toBe(true);
    // Right after the library step that marks the start of mixing, behind the sampling steps of that moment that are already there.
    const start = mixing.steps.findIndex((s) => s.text.startsWith("Start mixing"));
    expect(at).toBeGreaterThan(start);
    expect(mixing.steps.slice(start + 1, at).every((s) => s.placedFor?.moment === "beginning")).toBe(true);
    // The sample is named by a step and the record no longer leaves it out: the open items are back to what they were.
    expect(unplacedSamples(section)).toEqual([]);
    expect(notInRecord(after)).toEqual([]);
    expect(items(after).map((o) => o.kind)).toEqual(items(project).map((o) => o.kind));
  });

  it("logs one edit", () => {
    const after = addPlanPointToSection(added, rec.id, compounding.id, "SP-092", mbrLibrary, ACTOR);
    const log = after.changeLog.slice(added.changeLog.length);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "mbr_sample_add", after: { samplingPointIds: "SP-092" } });
    expect(log[0]!.detail).toContain("its sampling step was written in block");
  });

  it("changes nothing when the record already has a row for the point", () => {
    const after = addPlanPointToSection(added, rec.id, compounding.id, "SP-092", mbrLibrary, ACTOR);
    const again = addPlanPointToSection(after, rec.id, compounding.id, "SP-092", mbrLibrary, ACTOR);
    expect(again.changeLog).toHaveLength(after.changeLog.length);
    expect(sectionOf(again, "compounding")).toEqual(sectionOf(after, "compounding"));
  });

  it("refuses a section the point does not belong in, a point that is not in the plan, and a section with no block for sample rows", () => {
    expect(() => addPlanPointToSection(added, rec.id, sectionOf(added, "ds_receipt_thaw").id, "SP-092", mbrLibrary, ACTOR)).toThrow(/does not belong in section/);
    expect(() => addPlanPointToSection(added, rec.id, compounding.id, "SP-777", mbrLibrary, ACTOR)).toThrow(/not in/);
    const bare = withBareSection(added, "compounding", "SC-900", "Compounding of the second tank");
    expect(() => addPlanPointToSection(bare, rec.id, "SC-900", "SP-092", mbrLibrary, ACTOR)).toThrow(/no block that holds sample rows/);
  });

  it("writes no step when the library step that marks the place was reworded, and the sample then shows as an open item", () => {
    const edited = structuredClone(added);
    mixingOf(edited).steps.find((s) => s.text.startsWith("Start mixing"))!.text = "Start the mixer (wording changed by the author).";
    const after = addPlanPointToSection(edited, rec.id, compounding.id, "SP-092", mbrLibrary, ACTOR);
    expect(mixingOf(after).steps.some((s) => s.placedFor?.points.includes("SP-092"))).toBe(false);
    expect(sectionOf(after, "compounding").blocks.find((b) => b.libraryId === "sample_table")!.samples.map((r) => r.pointId)).toContain("SP-092");
    expect(items(after).filter((o) => o.kind === "sample_not_placed").map((o) => o.where)).toEqual([`${compounding.title}, sample SP-092`]);
    expect(after.changeLog.at(-1)!.detail).toContain("no sampling step was written for it");
  });

  it("writes no step for a point whose timing is 'other': the plan names no moment", () => {
    const p = withPoint(project, { id: "SP-093", timing: { ...basePoint.timing, options: ["other"] as never } });
    const after = addPlanPointToSection(p, rec.id, sectionOf(p, "compounding").id, "SP-093", mbrLibrary, ACTOR);
    expect(mixingOf(after).steps.some((s) => s.placedFor?.points.includes("SP-093"))).toBe(false);
    expect(items(after).filter((o) => o.kind === "sample_not_placed")).toHaveLength(1);
  });
});

describe("the Process view and the plan points the record leaves out", () => {
  const viewOf = (p: Project) => buildProcessView(p, recOf(p));
  const s7 = (p: Project) => viewOf(p).findings.filter((f) => f.checkId === "S7");

  it("has no finding while the record and its plan agree", () => {
    expect(viewOf(project).checks.find((c) => c.id === "S7")!.status).toBe("ok");
    expect(s7(project)).toEqual([]);
  });

  it("makes one note when a point is missing, and says the picture shows the record as written", () => {
    const found = s7(withoutRow(project, "SP-001"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "note", title: "The batch record and its sampling plan differ: 0 rows changed, 1 point missing", detail: "The picture shows the batch record as written." });
  });

  it("counts the rows changed and the points missing in that one note", () => {
    const p = structuredClone(withoutRow(project, "SP-001"));
    rowOf(p, "SP-002").test = "A test name the author changed";
    const found = s7(p);
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("The batch record and its sampling plan differ: 1 row changed, 1 point missing");
  });

  it("shows a sample added from the open items at the step that tells the operator to take it", () => {
    const added = withPoint(project, { id: "SP-092" });
    expect(s7(added)).toHaveLength(1);
    const after = addPlanPointToSection(added, recOf(added).id, sectionOf(added, "compounding").id, "SP-092", mbrLibrary, ACTOR);
    expect(s7(after)).toEqual([]);
    const step = sectionOf(after, "compounding").blocks.flatMap((b) => b.steps).find((s) => s.placedFor?.points.includes("SP-092"))!;
    const sample = viewOf(after).samples.find((x) => x.pointId === "SP-092")!;
    expect(sample.tiedToStep).toBe(true);
    expect(sample.stepNumber).toBe(numberSteps(recOf(after)).get(step.id));
  });
});
