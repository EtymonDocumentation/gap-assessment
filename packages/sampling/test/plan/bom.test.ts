import type { SamplingPlan, SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { planTotals, SAMPLING_BOM_INTRO, samplingBom } from "../../src/index";

const at = "2026-10-01T00:00:00.000Z";

/** A fictional liquid sample: two 10 mL tubes at one location per batch. */
function point(over: Partial<SamplingPoint> = {}): SamplingPoint {
  return {
    id: "SP-001",
    origin: { kind: "manual" },
    type: "ipc",
    responsible: { party: "cmo" },
    reporting: { what: ["individual"] },
    unitOp: "compounding",
    attribute: "pH",
    timing: { options: ["beginning"] },
    locationsCount: 1,
    sampleSize: { method: "fixed", inputs: { count: 2, basis: "Fictional SOP" } },
    quantity: { value: 10, unit: "mL" },
    container: "Sampling tube",
    closure: "Screw cap",
    acceptance: { kind: "criterion", text: "Within range" },
    rationale: "Check",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

function plan(points: SamplingPoint[], batches = 3): SamplingPlan {
  return {
    id: "SPL-001",
    title: "Test plan",
    status: "draft",
    steps: [],
    batches: Array.from({ length: batches }, (_, i) => ({ id: `B-00${i + 1}`, label: `PPQ ${i + 1}` })),
    batchRationale: "Fictional",
    parties: [],
    agencyRequests: [],
    noAgencyRequests: true,
    points,
    subsections: [],
    createdAt: at,
    updatedAt: at,
  } as SamplingPlan;
}

describe("sampling bill of materials", () => {
  it("an empty plan has no lines, nothing still to state and the same plain intro", () => {
    const bom = samplingBom(plan([]));
    expect(bom.groups).toEqual([]);
    expect(bom.stillToState).toEqual([]);
    expect(bom.lineCount).toBe(0);
    expect(bom.source).toBe("sampling");
    expect(SAMPLING_BOM_INTRO).toBe("Lists what may be used to take the PPQ samples. The batch record records what is actually used.");
  });

  it("the same container and closure after trim and case-fold is one line; a different closure splits it", () => {
    const bom = samplingBom(
      plan([
        point(),
        point({ id: "SP-002", container: "  sampling   TUBE ", closure: "screw cap" }),
        point({ id: "SP-003", container: "Sampling tube", closure: "Crimp cap" }),
      ]),
    );
    const g = bom.groups.find((x) => x.key === "containers-process")!;
    expect(g.lines).toHaveLength(2);
    const [merged, split] = g.lines;
    expect(merged!.pointIds).toEqual(["SP-001", "SP-002"]);
    expect(merged!.item).toBe("Sampling tube");
    expect(merged!.perBatch.map((b) => b.quantity)).toEqual([4, 4, 4]);
    expect(merged!.total).toBe(12);
    expect(merged!.volumes).toEqual(["10 mL"]);
    expect(split!.closure).toBe("Crimp cap");
    expect(split!.total).toBe(6);
    expect(g.lines.every((l) => l.source === "sampling")).toBe(true);
  });

  it("points with different volumes in the same container are one line that lists both volumes", () => {
    const g = samplingBom(plan([point(), point({ id: "SP-002", quantity: { value: 100, unit: "mL" } })])).groups[0]!;
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0]!.volumes).toEqual(["10 mL", "100 mL"]);
  });

  it("a point that applies to some batches only leaves 0 in the others", () => {
    const g = samplingBom(plan([point({ appliesTo: ["B-001", "B-003"] })])).groups[0]!;
    expect(g.lines[0]!.perBatch.map((b) => b.quantity)).toEqual([2, 0, 2]);
    expect(g.lines[0]!.total).toBe(4);
  });

  it("quantities are the plan's units: sample size times locations, not multiplied again by containers per sample", () => {
    const p = point({ locationsCount: 3, containerUnitsPerSample: 2 });
    const bom = samplingBom(plan([p]));
    expect(bom.groups[0]!.lines[0]!.perBatch[0]!.quantity).toBe(6);
  });

  it("liquid containers and counted product units are separate groups, and both add up to the plan totals", () => {
    const p = plan([
      point(),
      point({ id: "SP-002", container: "Drug product syringe", closure: undefined, quantity: { value: 10, unit: "syringes" }, sampleSize: { method: "fixed", inputs: { count: 10, basis: "Fictional" } } }),
      point({ id: "SP-003", container: "Bottle", closure: "Cap", quantity: { value: 500, unit: "mL" }, locationsCount: 2, sampleSize: { method: "fixed", inputs: { count: 1, basis: "Fictional" } } }),
    ]);
    const bom = samplingBom(p);
    const containers = bom.groups.find((g) => g.key === "containers-process")!;
    const counted = bom.groups.find((g) => g.key === "product-units-process")!;
    expect(counted.title).toMatch(/not ordered/);
    expect(counted.lines[0]!.item).toBe("Drug product syringe");
    expect(counted.lines[0]!.perBatch[0]!.quantity).toBe(10);
    const totals = planTotals(p);
    for (const [i, t] of totals.perBatch.entries()) {
      const c = containers.lines.reduce((s, l) => s + l.perBatch[i]!.quantity, 0);
      const u = counted.lines.reduce((s, l) => s + l.perBatch[i]!.quantity, 0);
      expect(c).toBe(t.liquidUnits);
      expect(c + u).toBe(t.units);
    }
  });

  it("stability and retain containers are kept in their own groups", () => {
    const stability = point({
      id: "SP-002",
      type: "stability",
      container: "Stability vial",
      closure: "Stopper",
      quantity: { value: 2, unit: "mL" },
      detail: { stability: { conditions: [{ label: "5 C", detail: "" }, { label: "25 C", detail: "" }], timePoints: [{ label: "T0" }, { label: "T1" }], unitsPerPull: 3 } },
    });
    const retain = point({ id: "SP-003", type: "retain_reserve", container: "Retain bottle", closure: "Cap", quantity: { value: 50, unit: "mL" }, detail: { retain: { unitsPerBatch: 5 } } });
    const p = plan([point(), stability, retain], 2);
    const bom = samplingBom(p);
    expect(bom.groups.map((g) => g.key)).toEqual(["containers-process", "containers-stability", "containers-retain"]);
    expect(bom.groups[1]!.lines[0]!.perBatch.map((b) => b.quantity)).toEqual([12, 12]);
    expect(bom.groups[2]!.lines[0]!.total).toBe(10);
    const t = planTotals(p);
    expect(bom.groups[1]!.lines[0]!.total).toBe(t.stabilityUnits);
    expect(bom.groups[2]!.lines[0]!.total).toBe(t.retainUnits);
  });

  it("sampling parts come from the method; a port counts only when it was added for the study", () => {
    const p = plan(
      [
        point({ method: { access: "added_y_connector" } }),
        point({ id: "SP-002", method: { access: "added_y_connector" }, appliesTo: ["B-001"] }),
        point({ id: "SP-003", method: { access: "aseptic_connector" } }),
        point({ id: "SP-004", method: { access: "shared_port", added: { forStudyOnly: true } } }),
        point({ id: "SP-005", method: { access: "shared_port", added: { forStudyOnly: false } } }),
        point({ id: "SP-006", method: { access: "grab_open" } }),
      ],
      2,
    );
    const parts = samplingBom(p).groups.find((g) => g.key === "parts")!;
    expect(parts.lines.map((l) => l.item)).toEqual(["Y-connector added to the assembly", "Aseptic connector", "Port shared with other samples, added for the study"]);
    expect(parts.lines[0]!.pointIds).toEqual(["SP-001", "SP-002"]);
    expect(parts.lines[0]!.perBatch.map((b) => b.quantity)).toEqual([2, 1]);
    expect(parts.quantityLabel).toBe("Sampling points");
  });

  it("flush volumes are added up in mL per batch with where they are discarded; other units are named, not added", () => {
    const flush = (volume: { value: number; unit: string }, discardTo = "the waste container") => ({ access: "shared_port" as const, flush: { practice: "flush_volume" as const, volume, discardTo } });
    const p = plan([point({ locationsCount: 2, method: flush({ value: 30, unit: "mL" }) }), point({ id: "SP-002", locationsCount: 1, method: flush({ value: 0.05, unit: "L" }, " The waste container ") }), point({ id: "SP-003", method: flush({ value: 3, unit: "drops" }, "a sink") })], 2);
    const fl = samplingBom(p).groups.find((g) => g.key === "flush")!;
    expect(fl.lines).toHaveLength(2);
    expect(fl.lines[0]!.item).toBe("Flush or first draw, discarded to the waste container");
    expect(fl.lines[0]!.perBatch.map((b) => b.quantity)).toEqual([110, 110]);
    expect(fl.lines[0]!.unit).toBe("mL");
    expect(fl.lines[1]!.total).toBe(0);
    expect(fl.lines[1]!.note).toMatch(/Not added up: SP-003/);
  });

  it("points that cannot be counted are listed as still to be stated and add no line", () => {
    const p = plan([
      point({ container: undefined }),
      point({ id: "SP-002", quantity: undefined }),
      point({ id: "SP-003", locationsCount: undefined }),
      point({ id: "SP-004", container: "Complete tube" }),
    ]);
    const bom = samplingBom(p);
    expect(bom.stillToState.map((s) => s.pointId)).toEqual(["SP-001", "SP-002", "SP-003"]);
    expect(bom.stillToState[0]!.reasons).toEqual(["container not named"]);
    expect(bom.stillToState[1]!.reasons).toEqual(["quantity per container not stated"]);
    expect(bom.stillToState[2]!.reasons).toEqual(["number of samples not worked out"]);
    // SP-003 names a container and a quantity, so it is listed, but only as a lower bound (nothing is counted for it).
    const lines = bom.groups.find((g) => g.key === "containers-process")!.lines;
    expect(lines.map((l) => l.item)).toEqual(["Sampling tube", "Complete tube"]);
    expect(lines[0]!.pointIds).toEqual(["SP-003"]);
    expect(lines[0]!.total).toBe(0);
    expect(lines[0]!.note).toMatch(/lower bound/i);
    expect(bom.stillToState.map((s) => s.text)[0]).toBe("SP-001 (pH): container not named.");
  });

  it("a 100% inspection is a note, never a quantity", () => {
    const aql = point({ sampleSize: { method: "aql-105e", inputs: { level: "II", aql: 0.65, inspection: "normal" } } });
    const p = { ...plan([aql]), batches: [{ id: "B-001", label: "PPQ 1", plannedLotSizeUnits: 10 }] } as SamplingPlan;
    const bom = samplingBom(p);
    expect(bom.groups).toEqual([]);
    expect(bom.hundredPercent).toHaveLength(1);
    expect(bom.hundredPercent[0]!.text).toMatch(/100% of the lot/);
    expect(bom.stillToState).toEqual([]);
  });

  it("equipment used only for sampling comes from the design review; yes with no item is still to be stated", () => {
    const withItems = plan([point()]);
    withItems.designReview = { studyEquipment: { used: true, items: [{ id: "EQ-01", what: "Extra sampling bag", pointIds: ["SP-001"], qualified: false }] } } as SamplingPlan["designReview"];
    const bom = samplingBom(withItems);
    expect(bom.equipment!.rows).toHaveLength(1);
    expect(bom.equipment!.rows[0]![0]).toBe("EQ-01");
    expect(bom.stillToState).toEqual([]);

    const none = plan([point()]);
    none.designReview = { studyEquipment: { used: true, items: [] } } as SamplingPlan["designReview"];
    const b2 = samplingBom(none);
    expect(b2.equipment).toBeUndefined();
    expect(b2.stillToState).toHaveLength(1);
    expect(b2.stillToState[0]!.pointId).toBeUndefined();
  });
});
