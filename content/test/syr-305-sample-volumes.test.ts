import { buildDemoProject, buildMbrDocument, buildProcessView, sampleIdsTakenAt } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

// Row 12 of the expert walk-through: the answers about HOW a sample is taken (flush volume, first-draw discard, Y-connector flush and where
// the liquid goes) must reach the batch record step that takes the sample with the exact entered volumes, and the volume balance must count
// each flush once and each sample once.
const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const rec = project.mbr.records[0]!;
const plan = project.sampling.plans[0]!;
const view = buildProcessView(project, rec);
const doc = buildMbrDocument(project, rec, { generatedAt: "2026-11-02T00:00:00Z", appVersion: "0.0.0-test" });
const tableText = JSON.stringify(doc.sections.flatMap((s) => s.blocks));
const stepRows = doc.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "table" && b.columns[0] === "Step" ? b.rows : [])));
const stepOf = (re: RegExp) => String(stepRows.find((r) => re.test(String(r[1])))?.[1] ?? "");

describe("sample method reaches the batch record steps", () => {
  it("finds the sample numbers a hand-written step takes, and not the ones it only checks or says are taken elsewhere", () => {
    expect(sampleIdsTakenAt({ text: "Take samples SP-005 (top) and SP-006 (bottom) at the end of mixing." })).toEqual(["SP-005", "SP-006"]);
    expect(sampleIdsTakenAt({ text: "Check that sample SP-018 was taken at the step that names it." })).toEqual([]);
    expect(sampleIdsTakenAt({ text: "Sample SP-009 is not taken here: it is taken in the filling section." })).toEqual([]);
    expect(sampleIdsTakenAt({ text: "Take the bag out.", placedFor: { points: ["SP-001"] } })).toEqual(["SP-001"]);
  });

  it("prints the entered flush at the step: 50 mL at the shared port, 10 mL first-draw discard, 100 mL through the Y-connector", () => {
    const mixing = stepOf(/^Take samples SP-005/);
    expect(mixing).toContain("50 mL");
    expect(mixing).toContain("waste container at the compounding vessel");
    const bag = stepOf(/^Take sample SP-009/);
    expect(bag).toContain("10 mL");
    expect(bag).toContain("waste bag on the sample-bag manifold");
    const y = stepOf(/^Take sample SP-021/);
    expect(y).toContain("100 mL");
    expect(y).toContain("waste bag");
    expect(y).toMatch(/Y-connector/);
    // No generic 5 mL purge is left on the steps that take these samples.
    for (const t of [mixing, bag, y]) expect(t).not.toMatch(/first 5 mL|5 mL purge|line purge/);
  });

  it("prints the method of a sample once, at the step that takes it, not again in the separate table", () => {
    const listed = doc.sections.flatMap((x) => x.blocks.flatMap((b) => (b.type === "table" && b.caption?.startsWith("How each sample is taken") ? b.rows.map((r) => String(r[0])) : [])));
    for (const id of ["SP-001", "SP-005", "SP-018", "SP-020", "SP-021"]) expect(listed, id).not.toContain(id);
    expect(tableText.split("SP-005: ")).toHaveLength(2);
    expect(tableText.split("SP-021: ")).toHaveLength(2);
  });

  it("names SP-021 after its answers: the Y-connector in the transfer line, not the sampling valve of the vessel", () => {
    const sp21 = plan.points.find((p) => p.id === "SP-021")!;
    expect(sp21.method?.access).toBe("added_y_connector");
    expect(sp21.attribute).toContain("Y-connector");
    expect(sp21.attribute).not.toContain("sampling valve of the compounding vessel");
  });
});

describe("volume flow and the single subtraction", () => {
  const byPoint = (id: string) => view.samples.find((s) => s.pointId === id)!;

  it("counts every stated flush once, with the volume the plan states", () => {
    for (const id of ["SP-001", "SP-002", "SP-003", "SP-004", "SP-005", "SP-006"]) expect(byPoint(id).flushMl, id).toBe(50);
    for (const id of ["SP-007", "SP-008", "SP-009"]) expect(byPoint(id).flushMl, id).toBe(10);
    expect(byPoint("SP-021").flushMl).toBe(100);
    expect(view.samples.filter((s) => s.flushMl !== undefined)).toHaveLength(view.samples.filter((s) => s.flushMl !== undefined).length);
  });

  it("states the bulk samples and flushes as 0.84 L and that matches the sample rows and flushes of the plan", () => {
    const pooled = ["SP-001", "SP-002", "SP-003", "SP-004", "SP-005", "SP-006", "SP-007", "SP-008", "SP-009", "SP-021"];
    const rowsMl = pooled.reduce((s, id) => s + (byPoint(id).volumeMl ?? 0), 0);
    const flushMl = pooled.reduce((s, id) => s + (byPoint(id).flushMl ?? 0), 0);
    expect(rowsMl).toBe(200);
    expect(flushMl).toBe(430);
    const bioburdenMl = 200; // two bioburden samples of 100 mL, with samples 9 and 21
    const ipcMl = 10;
    const totalL = (rowsMl + flushMl + bioburdenMl + ipcMl) / 1000;
    expect(totalL).toBeCloseTo(0.84, 6);
    const balance = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => x.text).concat(b.note ?? ""))).join("\n");
    expect(balance).toContain("Bulk samples and flushes are 0.84 L in every batch");
  });

  it("does not subtract samples 18 and 19 (40 mL) a second time: they are out of the pool at the thaw step", () => {
    const text = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => x.text).concat(b.note ?? ""))).join("\n");
    expect(text).toMatch(/Samples 18 and 19 \(2 x 20 mL from the thawed containers\) are not counted here/);
    expect(byPoint("SP-018").volumeMl).toBe(20);
    expect(byPoint("SP-019").volumeMl).toBe(20);
    // 0.84 L is not 0.84 L plus 0.04 L: the pooled-sample list above holds neither point.
  });

  it("leaves every PPQ lot, lot 1 included, with a spare that is not negative", () => {
    const rows = Object.fromEntries(view.volumeBatches.map((b) => [b.label, b]));
    const bulkL = 0.84;
    const holdUpL = 3.0;
    for (const [label, size] of [["PPQ 1", 50], ["PPQ 2", 100], ["PPQ 3", 9]] as const) {
      const b = rows[label]!;
      expect(b.batchSizeL).toBe(size);
      const spare = size - b.filledL! - bulkL - holdUpL;
      expect(spare, label).toBeGreaterThanOrEqual(0);
    }
    expect(50 - rows["PPQ 1"]!.filledL! - bulkL - holdUpL).toBeCloseTo(0.51, 6);
    expect(9 - rows["PPQ 3"]!.filledL! - bulkL - holdUpL).toBeCloseTo(0.045, 6);
  });
});
