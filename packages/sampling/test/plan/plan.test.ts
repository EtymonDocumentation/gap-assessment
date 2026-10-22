import { samplingPlanSchema, type CompanyTableSnapshot, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { buildPullSchedule, checkPoint, methodInputsText, openItems, planTotals, resultText, tableChangedSince, tablesUsed, unitsPerBatch } from "../../src/index";

const at = "2026-10-01T00:00:00.000Z";

/** A fictional company table: lots up to 500 take 8, larger lots up to 5000 take 13, then 20. */
const table: CompanyTableSnapshot = {
  id: "tbl-1",
  name: "QC-SAMP-001 (fictional)",
  version: "1.0",
  rows: [
    { lotMin: 1, lotMax: 500, sampleSize: 8 },
    { lotMin: 501, lotMax: 5000, sampleSize: 13 },
    { lotMin: 5001, lotMax: null, sampleSize: 20 },
  ],
};

function point(over: Partial<SamplingPoint> = {}): SamplingPoint {
  return {
    id: "SP-001",
    origin: { kind: "manual" },
    category: "routine_ipc_release",
    unitOp: "aseptic_filling",
    attribute: "Fill weight",
    timing: { options: ["beginning", "end"] },
    locationsCount: 3,
    sampleSize: { method: "fixed", inputs: { count: 5, basis: "SOP (fictional)" } },
    acceptance: { kind: "criterion", text: "Within range" },
    rationale: "Routine check",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

function plan(points: SamplingPoint[], lots: (number | undefined)[] = [4000, 4000]): SamplingPlan {
  return {
    id: "SPL-001",
    title: "Test plan",
    runType: "ppq",
    status: "draft",
    batches: lots.map((l, i) => ({ id: `B-00${i + 1}`, label: `PPQ batch ${i + 1}`, ...(l !== undefined ? { plannedLotSizeUnits: l } : {}) })),
    batchRationale: "Three is the site rule (fictional).",
    points,
    createdAt: at,
    updatedAt: at,
  };
}

describe("point completeness", () => {
  it("a fully entered point is complete and produces a sample size per batch", () => {
    const p = plan([point()]);
    const c = checkPoint(p, p.points[0]!);
    expect(c.status).toBe("complete");
    expect(c.problems).toEqual([]);
    expect(c.perBatch.map((r) => r.sampleSize)).toEqual([5, 5]);
  });

  it("a point with nothing but a step and a category lists every missing decision and invents none", () => {
    const bare = point({ attribute: "", timing: { options: [] }, locationsCount: undefined, sampleSize: { inputs: {} }, acceptance: undefined, rationale: "" });
    const p = plan([bare]);
    const c = checkPoint(p, bare);
    expect(c.status).toBe("incomplete");
    const all = c.problems.join(" ");
    expect(all).toMatch(/attribute/i);
    expect(all).toMatch(/rationale/i);
    expect(all).toMatch(/when or where/i);
    expect(all).toMatch(/locations/i);
    expect(all).toMatch(/acceptance/i);
    expect(all).toMatch(/method/i);
  });

  it("a missing input of a method is reported and gives no sample size", () => {
    const pt = point({ sampleSize: { method: "conf-rel", inputs: { confidence: 0.95 } } });
    const p = plan([pt]);
    const c = checkPoint(p, pt);
    expect(c.status).toBe("incomplete");
    expect(c.perBatch.every((r) => r.sampleSize === undefined)).toBe(true);
  });

  it("a batch with no planned lot size is named when the method needs one", () => {
    const pt = point({ sampleSize: { method: "company-table", inputs: { table } } });
    const p = plan([pt], [4000, undefined]);
    const c = checkPoint(p, pt);
    expect(c.status).toBe("incomplete");
    expect(c.problems.some((x) => x.startsWith("PPQ batch 2:"))).toBe(true);
    expect(c.perBatch[0]?.sampleSize).toBe(13);
  });

  it("different lot sizes give different company-table sizes per batch", () => {
    const pt = point({ sampleSize: { method: "company-table", inputs: { table } } });
    const p = plan([pt], [400, 4000, 9000]);
    expect(checkPoint(p, pt).perBatch.map((r) => r.sampleSize)).toEqual([8, 13, 20]);
  });

  it("no method means no calculation", () => {
    const pt = point({ sampleSize: { inputs: {} } });
    const p = plan([pt]);
    expect(checkPoint(p, pt).perBatch.every((r) => !r.ok)).toBe(true);
  });
});

describe("units per batch and totals", () => {
  it("multiplies the sample size by the locations", () => {
    const p = plan([point()]);
    expect(unitsPerBatch(p, p.points[0]!).map((u) => u.text)).toEqual(["5 x 3 = 15", "5 x 3 = 15"]);
    expect(planTotals(p).units).toBe(30);
  });

  it("a point that applies to one batch is 'Not planned' for the other", () => {
    const p = plan([point({ appliesTo: ["B-002"] })]);
    expect(unitsPerBatch(p, p.points[0]!).map((u) => u.text)).toEqual(["Not planned", "5 x 3 = 15"]);
    expect(planTotals(p).perBatch.map((b) => b.units)).toEqual([0, 15]);
  });

  it("a point that cannot be worked out adds nothing and is said so in a note", () => {
    const p = plan([point(), point({ id: "SP-002", sampleSize: { inputs: {} } })]);
    const t = planTotals(p);
    expect(t.units).toBe(30);
    expect(t.notWorkedOut).toEqual(["SP-002"]);
    expect(t.notes.join(" ")).toMatch(/lower bound/);
  });

  it("100% of the lot is shown as such and left out of the totals with a note", () => {
    // An AQL plan whose table sample size reaches the lot size inspects the whole lot (MIL-STD-105E rule).
    const pt = point({ sampleSize: { method: "aql-105e", inputs: { level: "II", aql: 0.65, inspection: "normal" } } });
    const p = plan([pt], [10, 10]);
    const u = unitsPerBatch(p, pt);
    expect(u.every((x) => x.hundredPercent && x.text === "100% of lot")).toBe(true);
    const t = planTotals(p);
    expect(t.units).toBe(0);
    expect(t.hundredPercent).toEqual(["SP-001"]);
    expect(t.notes.join(" ")).toMatch(/100% of the lot/);
  });

  it("without locations the units are not worked out", () => {
    const pt = point({ locationsCount: undefined });
    const p = plan([pt]);
    expect(unitsPerBatch(p, pt)[0]?.text).toBe("Not worked out");
  });
});

describe("open items and schedule", () => {
  it("an empty plan lists plan-level items, no default batch count", () => {
    const p = { ...plan([], []), batchRationale: "" };
    const texts = openItems(p).map((i) => i.text).join(" | ");
    expect(texts).toMatch(/No PPQ batches/);
    expect(texts).toMatch(/rationale for the number of batches/);
    expect(texts).toMatch(/No sampling points/);
  });

  it("each problem of a point is one open item with the point id", () => {
    const bare = point({ rationale: "", acceptance: undefined });
    const items = openItems(plan([bare]));
    expect(items.filter((i) => i.ref === "SP-001").length).toBe(2);
  });

  it("the pull schedule has one row per batch and applicable point", () => {
    const p = plan([point(), point({ id: "SP-002", appliesTo: ["B-001"] })]);
    const rows = buildPullSchedule(p);
    expect(rows.map((r) => `${r.batchId}/${r.pointId}`)).toEqual(["B-001/SP-001", "B-001/SP-002", "B-002/SP-001"]);
    expect(rows[0]?.unitsText).toBe("5 x 3 = 15");
  });
});

describe("report only", () => {
  it("is refused by the plan schema for routine and enhanced points", () => {
    const bad = plan([point({ acceptance: { kind: "report_only" } })]);
    expect(samplingPlanSchema.safeParse(bad).success).toBe(false);
    const ok = plan([point({ category: "characterization", acceptance: { kind: "report_only" } })]);
    expect(samplingPlanSchema.safeParse(ok).success).toBe(true);
  });

  it("is reported by the completeness check if such a point is built in memory", () => {
    const pt = point({ acceptance: { kind: "report_only" } });
    expect(checkPoint(plan([pt]), pt).problems.join(" ")).toMatch(/Report only is not allowed/);
  });
});

describe("company tables", () => {
  it("reports a changed library table, a new version, and a missing table", () => {
    expect(tableChangedSince(table, [table])).toBeUndefined();
    expect(tableChangedSince(table, [{ ...table, version: "2.0" }])).toMatch(/version 2\.0/);
    expect(tableChangedSince(table, [{ ...table, rows: [{ lotMin: 1, lotMax: null, sampleSize: 3 }] }])).toMatch(/different rows/);
    expect(tableChangedSince(table, [])).toMatch(/no longer in the sampling tables library/);
  });

  it("lists each table used once", () => {
    const a = point({ sampleSize: { method: "company-table", inputs: { table } } });
    const b = point({ id: "SP-002", sampleSize: { method: "company-table", inputs: { table } } });
    expect(tablesUsed(plan([a, b])).map((t) => t.id)).toEqual(["tbl-1"]);
  });
});

describe("words", () => {
  it("never states a missing input as a value", () => {
    expect(methodInputsText({ sampleSize: { method: "conf-rel", inputs: {} } })).toBe("Confidence not given, reliability not given, allowed failures not given");
    expect(methodInputsText({ sampleSize: { inputs: {} } })).toBe("No method chosen");
  });
  it("writes percentages without float noise", () => {
    expect(methodInputsText({ sampleSize: { method: "conf-rel", inputs: { confidence: 0.95, reliability: 0.999, allowedFailures: 0 } } })).toContain("Confidence 95%, reliability 99.9%");
  });
  it("conf-rel 95/95 with no failures gives 59 containers", () => {
    const pt = point({ sampleSize: { method: "conf-rel", inputs: { confidence: 0.95, reliability: 0.95, allowedFailures: 0 } } });
    const r = checkPoint(plan([pt]), pt).perBatch[0]!;
    expect(r.sampleSize).toBe(59);
    expect(resultText(r)).toBe("n = 59");
  });
});
