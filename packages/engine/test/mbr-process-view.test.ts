// The Process view of a batch record: moments, clocks, samples, volumes and the deterministic tracker. The tracker never guesses a number:
// where the record does not state one, the check says what is missing. All data are fictional.
import { describe, expect, it, vi } from "vitest";
import { mbrRecordSchema, type MbrRecord } from "@gap/process-model";
import { buildDemoProject, buildProcessView, clockStatusAt, describeMoment, mergeMbr, parseHours, parseQuantity, shapeForUnitOp } from "@gap/engine";
import { ACTOR } from "./helpers";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const NOW = "2026-01-01T00:00:00Z";

const block = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, steps: [], params: [], samples: [], timeLimits: [], cmoFields: [], ...over });
const step = (n: number, text: string) => ({ id: `ST-${String(n).padStart(4, "0")}`, text });
/** A small record made by hand: the project of the demo is used only as a carrier (no plan is linked unless a test says so). */
function rec(sections: unknown[], extra: Record<string, unknown> = {}): MbrRecord {
  return mbrRecordSchema.parse({ id: "MBR-009", title: "Hand-made record (fictional)", status: "draft", sections, createdAt: NOW, updatedAt: NOW, ...extra });
}
const viewOf = (r: MbrRecord) => buildProcessView({ ...demo, mbr: { records: [r] } }, r);
const findingsOf = (v: ReturnType<typeof viewOf>, check: string) => v.findings.filter((f) => f.checkId === check);
const checkOf = (v: ReturnType<typeof viewOf>, id: string) => v.checks.find((c) => c.id === id)!;

describe("parsers read what is written and nothing else", () => {
  it("reads hours from a value and a unit, and refuses ranges and text", () => {
    expect(parseHours("24", "h")).toBe(24);
    expect(parseHours("up to 4", "h")).toBe(4);
    expect(parseHours("90", "min")).toBe(1.5);
    expect(parseHours("2", "days")).toBe(48);
    expect(parseHours("3 to 5", "h")).toBeUndefined();
    expect(parseHours("", "h")).toBeUndefined();
    expect(parseHours("24", "L")).toBeUndefined();
  });
  it("reads a sample quantity and refuses what it cannot read", () => {
    expect(parseQuantity("2 × 10 mL")).toMatchObject({ count: 2, each: 10, kind: "volume" });
    expect(parseQuantity("20 mL")).toMatchObject({ count: 1, each: 20 });
    expect(parseQuantity("300 syringes")).toMatchObject({ count: 1, each: 300, kind: "units" });
    expect(parseQuantity("a little")).toBeUndefined();
  });
  it("maps unit operations to shapes and leaves an unknown one generic", () => {
    expect(shapeForUnitOp("sterile_filtration")).toEqual({ shape: "filter", known: true });
    expect(shapeForUnitOp("aseptic_filling").shape).toBe("filler");
    expect(shapeForUnitOp("some_new_operation")).toEqual({ shape: "generic", known: false });
    expect(shapeForUnitOp(undefined)).toEqual({ shape: "generic", known: false });
  });
});

describe("a generic record with no volumes, no limits and no plan", () => {
  const r = rec([
    { id: "SC-01", unitOp: "mystery_op", title: "Custom operation", blocks: [block("BL-001", "Do the thing", { steps: [step(1, "Do the first thing."), step(2, "Do the second thing.")] })] },
    { id: "SC-02", title: "Added by the author", blocks: [] },
  ]);
  const v = viewOf(r);
  it("draws an unknown or custom operation as a generic vessel with its own title", () => {
    expect(v.equipment.map((e) => [e.title, e.shape, e.known])).toEqual([
      ["Custom operation", "generic", false],
      ["Added by the author", "generic", false],
    ]);
  });
  it("has a start, one moment per block (and one for an empty section) and an end", () => {
    expect(v.moments.map((m) => m.kind)).toEqual(["start", "block", "block", "end"]);
    expect(v.moments[1]!.stepRange).toBe("1.1 to 1.2");
    expect(v.moments[2]!.stepIds).toEqual([]);
  });
  it("says 'not enough data' for every volume check and invents no number", () => {
    expect(checkOf(v, "V1").status).toBe("no_data");
    expect(checkOf(v, "V1").missing[0]).toMatch(/batch volume/);
    expect(checkOf(v, "V2").status).toBe("no_data");
    expect(v.momentVolumes.every((m) => m.statedL === undefined && m.remainingL === undefined)).toBe(true);
    expect(v.missingData.length).toBeGreaterThan(0);
    expect(v.findings.filter((f) => f.checkId.startsWith("V"))).toEqual([]);
  });
  it("describes the current moment in words", () => {
    expect(describeMoment(v, 1)).toContain("Steps 1.1 to 1.2");
    expect(describeMoment(v, 1)).toContain("No clock is running");
  });
});

describe("clocks against limits", () => {
  const limit = (id: string, label: string, value: string, extra: Record<string, unknown> = {}) => ({ id, label, key: "hold_x", value, unit: "h", targets: [], ...extra });
  const param = (id: string, label: string, value: string, extra: Record<string, unknown> = {}) => ({ id, label, mbrValue: value, mbrUnit: "h", ...extra });
  it("flags a planned time longer than the limit when the row is not a study point", () => {
    const r = rec([{ id: "SC-01", title: "Hold section", blocks: [block("BL-001", "Hold", { steps: [step(1, "Start the hold.")], timeLimits: [limit("R-0001", "Maximum cold storage hold", "24")], params: [param("R-0002", "Planned cold storage hold", "30")] })] }]);
    const v = viewOf(r);
    const f = findingsOf(v, "C2");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("major");
    expect(f[0]!.title).toContain("planned 30 h is longer than the limit 24 h");
    expect(f[0]!.rows).toContain("R-0001");
  });
  it("lists a planned time over the limit as a note when the record marks it a study point", () => {
    const r = rec([{ id: "SC-01", title: "Hold section", blocks: [block("BL-001", "Hold", { steps: [step(1, "Start the hold.")], timeLimits: [limit("R-0001", "Maximum cold storage hold", "24")], params: [param("R-0002", "Study point: cold storage hold", "30", { studyPoint: true })] })] }]);
    const f = findingsOf(viewOf(r), "C2");
    expect(f.map((x) => x.severity)).toEqual(["note"]);
  });
  it("does not link a planned time that matches two limits equally well", () => {
    const r = rec([{ id: "SC-01", title: "Two holds", blocks: [block("BL-001", "Holds", { steps: [step(1, "Go.")], timeLimits: [limit("R-0001", "Cold storage hold", "24"), limit("R-0003", "Cold storage hold time", "48")], params: [param("R-0002", "Planned cold storage hold", "30")] })] }]);
    const v = viewOf(r);
    // the row is as close to one limit as to the other: it is linked to neither, so no comparison is made
    expect(v.clocks.every((c) => c.plannedHours === undefined)).toBe(true);
    expect(checkOf(v, "C2").status).toBe("no_data");
  });
  it("shows a clock at the block that states it when no step range is given, and says so", () => {
    const r = rec([{ id: "SC-01", title: "Hold section", blocks: [block("BL-001", "Hold", { steps: [step(1, "Start the hold.")], timeLimits: [limit("R-0001", "Maximum hold", "24")] })] }]);
    const v = viewOf(r);
    expect(v.clocks[0]!.span).toBe("block");
    expect(clockStatusAt(v.clocks[0]!, 1)).toBe("applies_here");
    expect(clockStatusAt(v.clocks[0]!, 0)).toBe("not_here");
    expect(findingsOf(v, "C6")[0]!.severity).toBe("note");
  });
  it("flags sub-limits that add up to more than the total, and runs the clock over the sub-limit steps", () => {
    const r = rec([
      {
        id: "SC-01",
        title: "Out of refrigeration",
        blocks: [
          block("BL-001", "Work", {
            steps: [step(1, "Start."), step(2, "Middle."), step(3, "End.")],
            timeLimits: [limit("R-0001", "Total time out of refrigeration", "4", { targets: [{ id: "R-0002", label: "Part A", value: "3", unit: "h", fromStepId: "ST-0001", toStepId: "ST-0002" }, { id: "R-0003", label: "Part B", value: "2", unit: "h", fromStepId: "ST-0002", toStepId: "ST-0003" }] })],
          }),
        ],
      },
    ]);
    const v = viewOf(r);
    expect(findingsOf(v, "C3")[0]!.title).toContain("sub-limits add up to 5 h, more than the total 4 h");
    expect(v.clocks[0]!.span).toBe("target_steps");
  });
  it("reports a time limit without a usable value as missing data", () => {
    const r = rec([{ id: "SC-01", title: "S", blocks: [block("BL-001", "B", { steps: [step(1, "Go.")], timeLimits: [{ id: "R-0001", label: "Maximum hold", targets: [] }] })] }]);
    const c = checkOf(viewOf(r), "C1");
    expect(c.status).toBe("no_data");
    expect(c.missing[0]).toContain("R-0001");
  });
});

describe("samples and volumes", () => {
  const sampleRow = (id: string, pointId: string, quantity: string | undefined) => ({ id, planId: "SP-X", pointId, test: "Assay", ...(quantity ? { quantity } : {}) });
  const batchRow = { id: "R-0001", label: "Batch volume", mbrValue: "1", mbrUnit: "L" };
  const base = (steps: ReturnType<typeof step>[], samples: ReturnType<typeof sampleRow>[], params: unknown[] = [batchRow]) =>
    rec([{ id: "SC-01", title: "Mixing", blocks: [block("BL-001", "Mix", { steps, params, samples })] }]);

  it("takes a sample at the step that names it, with the port the step names", () => {
    const v = viewOf(base([step(1, "Mix."), step(2, "Take sample SP-001 from the bottom sampling valve.")], [sampleRow("R-0002", "SP-001", "2 × 10 mL")]));
    const s = v.samples[0]!;
    expect(s.stepNumber).toBe("1.2");
    expect(s.port).toMatch(/valve/i);
    expect(s.volumeMl).toBe(20);
    expect(s.momentIndex).toBe(1);
    expect(v.moments[1]!.sampleIds).toEqual(["R-0002"]);
  });
  it("lets each sample withdrawal reduce the volume left, moment by moment, from the stated batch volume only", () => {
    const r = rec([
      {
        id: "SC-01",
        title: "Mixing",
        blocks: [
          block("BL-001", "Start", { steps: [step(1, "Take sample SP-001 at the sampling port.")], params: [batchRow], samples: [sampleRow("R-0002", "SP-001", "2 × 100 mL")] }),
          block("BL-002", "End", { steps: [step(2, "Take sample SP-002 at the sampling port.")], samples: [sampleRow("R-0003", "SP-002", "2 × 100 mL")] }),
        ],
      },
    ]);
    const v = viewOf(r);
    expect(v.momentVolumes[1]!.statedL).toBe(1);
    expect(v.momentVolumes[1]!.withdrawnL).toBeCloseTo(0.2);
    expect(v.momentVolumes[1]!.remainingL).toBeCloseTo(0.8);
    expect(v.momentVolumes[2]!.remainingL).toBeCloseTo(0.6);
    expect(v.momentVolumes[0]!.remainingL).toBeUndefined();
    expect(checkOf(v, "V1").status).toBe("ok");
  });
  it("flags samples larger than the stated batch volume", () => {
    const v = viewOf(base([step(1, "Take sample SP-001 at the port.")], [sampleRow("R-0002", "SP-001", "2 × 600 mL")]));
    expect(findingsOf(v, "V1")[0]!.severity).toBe("major");
  });
  it("flags a sample no step names, and a sample with no readable quantity", () => {
    const v = viewOf(base([step(1, "Mix.")], [sampleRow("R-0002", "SP-001", undefined)]));
    expect(findingsOf(v, "S1")).toHaveLength(1);
    expect(findingsOf(v, "S2")).toHaveLength(1);
    expect(checkOf(v, "S2").missing[0]).toContain("SP-001");
  });
  it("flags a step whose written quantity differs from the sample row", () => {
    const v = viewOf(base([step(1, "Take sample SP-001 (2 x 20 mL) at the port.")], [sampleRow("R-0002", "SP-001", "2 × 10 mL")]));
    expect(findingsOf(v, "S4")[0]!.title).toContain("SP-001");
  });
});

describe("the SYR-305 demo record, split at its hold", () => {
  const rec0 = demo.mbr.records[0]!;
  const v = buildProcessView(demo, rec0);
  const whole = mergeMbr(demo, rec0.id, ACTOR);
  const vw = buildProcessView(whole, whole.mbr.records[0]!);

  it("has one piece of equipment per section and a hold where the parts meet", () => {
    expect(v.equipment.filter((e) => e.sectionId)).toHaveLength(rec0.sections.length);
    expect(v.equipment.filter((e) => e.shape === "hold")).toHaveLength(1);
    expect(v.equipment.find((e) => e.title.includes("Sterile filtration"))!.shape).toBe("filter");
  });
  it("steps through the hold-start and hold-end entries as moments, with the part boundary between them", () => {
    const kinds = v.moments.map((m) => m.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds.at(-1)).toBe("end");
    const hs = v.moments.find((m) => m.kind === "hold_start")!;
    const he = v.moments.find((m) => m.kind === "hold_end")!;
    expect([hs.part, he.part]).toEqual([1, 2]);
    expect(he.index).toBe(hs.index + 1);
    expect(v.moments.filter((m) => m.kind === "block" && m.part === 1).length).toBeGreaterThan(5);
    expect(v.moments.filter((m) => m.kind === "block" && m.part === 2).length).toBeGreaterThan(3);
    expect(vw.moments.some((m) => m.kind === "hold_start")).toBe(false);
  });
  it("puts SP-007 on the hold-start entry and SP-009 on the hold-end entry", () => {
    const at = (id: string) => v.moments[v.samples.find((s) => s.pointId === id)!.momentIndex]!.kind;
    expect(at("SP-007")).toBe("hold_start");
    expect(at("SP-009")).toBe("hold_end");
  });
  it("runs the post-BBR hold clock across the split against the record's own 24 h limit", () => {
    const c = v.clocks.find((x) => x.kind === "hold" && x.label.startsWith("Post-BBR"))!;
    expect(c.span).toBe("split");
    expect(c.limitHours).toBe(24);
    expect(c.limitRowId).toBe(rec0.split!.holdLimitId);
    expect(c.plannedHours).toBe(30);
    expect(c.studyPoint).toBe(true);
    const hs = v.moments.find((m) => m.kind === "hold_start")!.index;
    expect(clockStatusAt(c, hs - 1)).toBe("not_started");
    expect(clockStatusAt(c, hs)).toBe("running");
    expect(clockStatusAt(c, hs + 1)).toBe("running");
    expect(clockStatusAt(c, hs + 2)).toBe("finished");
  });
  it("finds the demo's 30 h planned holds as study points over their limits, not as errors", () => {
    expect(findingsOf(v, "C2").map((f) => f.severity)).toEqual(["note"]);
    expect(v.findings.filter((f) => f.severity === "major")).toEqual([]);
  });
  it("compares the three plan batches with the fill volume the record states", () => {
    expect(v.volumeBatches.map((b) => [b.label, b.status])).toEqual([["PPQ 1", "ok"], ["PPQ 2", "ok"], ["PPQ 3", "ok"]]);
    expect(v.volumeBatches[0]!.filledL).toBeCloseTo(46.2);
  });
  it("cites steps and rows in every finding", () => {
    for (const f of v.findings) expect(f.steps.length + f.rows.length + f.moments.length).toBeGreaterThan(0);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildProcessView(demo, rec0))).toBe(JSON.stringify(v));
  });
});
