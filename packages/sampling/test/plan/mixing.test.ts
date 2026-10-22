import { designLoadoutsSchema, mixingDesignSchema, samplingPointSchema, type DesignLoadout, type SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { applyLoadout, checkPoint, hasDesign, mixingDesign, reportingInstructions } from "../../src/index";

const at = "2026-10-01T00:00:00.000Z";

const bracketing: DesignLoadout = {
  id: "worst-case-bracketing",
  title: "Worst-case bracketing",
  description: "Two runs at the ends of the ranges.",
  design: {
    approach: "Worst-case bracketing",
    runs: [
      { label: "Run 1", batchSize: { tag: "max" }, speed: { tag: "min" }, mixTime: { tag: "target" }, challenges: ["homogeneity"], rationale: "Largest batch, slowest speed." },
      { label: "Run 2", batchSize: { tag: "min" }, speed: { tag: "max" }, mixTime: { tag: "target" }, challenges: ["shear_protein_quality"] },
    ],
    rangeSupport: [{ parameter: "Batch size", rangeKind: "PAR" }],
  },
};
const threeAtTarget: DesignLoadout = {
  id: "three-at-target",
  title: "3 batches at target",
  description: "Three runs at target.",
  design: { approach: "3 batches at target", runs: [1, 2, 3].map((n) => ({ label: `Batch ${n}`, batchSize: { tag: "target" as const }, speed: { tag: "target" as const }, mixTime: { tag: "target" as const } })) },
};

function mixingPoint(design?: SamplingPoint["detail"] extends infer D ? (D extends { mixing?: infer M } ? (M extends { design?: infer X } ? X : never) : never) : never): SamplingPoint {
  return {
    id: "SP-001",
    origin: { kind: "manual" },
    type: "mixing_homogeneity",
    unitOp: "compounding",
    attribute: "Blend uniformity",
    timing: { options: ["end"] },
    locationsCount: 3,
    sampleSize: { method: "fixed", inputs: { count: 3, basis: "SOP (fictional)" } },
    acceptance: { kind: "criterion", text: "RSD at most 5% (fictional)" },
    rationale: "Shows the bulk is uniform.",
    responsible: { party: "cmo" },
    reporting: { what: ["individual"] },
    appliesTo: "all",
    sourceIds: [],
    detail: {
      mixing: {
        vesselRef: "Tank T-1 (fictional)",
        parameters: "Speed and time (fictional)",
        positions: ["top", "bottom"],
        timePoints: [{ label: "End", time: "End of mixing" }],
        criterionBasis: "RSD",
        ...(design ? { design } : {}),
      },
    },
    createdAt: at,
    updatedAt: at,
  };
}
const plan = (p: SamplingPoint) =>
  ({ id: "SPL-001", title: "T", runType: "ppq", status: "draft", batches: [{ id: "B-001", label: "PPQ batch 1", plannedLotSizeUnits: 100 }], batchRationale: "r", parties: [], agencyRequests: [], noAgencyRequests: true, points: [p], subsections: [], createdAt: at, updatedAt: at }) as never;

describe("optional mixing study design", () => {
  it("is never required: a mixing point with no design is complete", () => {
    const p = mixingPoint();
    expect(checkPoint(plan(p), p).problems).toEqual([]);
  });

  it("adds no problems however little of it is filled in (blank values, no runs, a free label only)", () => {
    for (const design of [{}, { approach: "Own design" }, bracketing.design, { runs: [{ label: "" }] }]) {
      const p = mixingPoint(design);
      expect(checkPoint(plan(p), p).problems, JSON.stringify(design)).toEqual([]);
    }
  });

  it("accepts any number of runs, including none, and every range kind including unset", () => {
    expect(mixingDesignSchema.safeParse({ runs: [] }).success).toBe(true);
    expect(mixingDesignSchema.safeParse({ runs: Array.from({ length: 7 }, (_, i) => ({ label: `R${i}` })) }).success).toBe(true);
    for (const rangeKind of ["PAR", "NOR", "other", "unset"]) expect(mixingDesignSchema.safeParse({ rangeSupport: [{ parameter: "Speed", rangeKind }] }).success).toBe(true);
    expect(mixingDesignSchema.safeParse({ rangeSupport: [{ parameter: "Speed" }] }).success).toBe(true);
    expect(mixingDesignSchema.safeParse({ rangeSupport: [{ parameter: "Speed", rangeKind: "PAR/NOR" }] }).success).toBe(false);
  });

  it("is carried by the point schema", () => {
    expect(samplingPointSchema.safeParse(mixingPoint(bracketing.design)).success).toBe(true);
  });
});

describe("design load-outs", () => {
  it("the catalog shape is strict and carries no values", () => {
    expect(designLoadoutsSchema.safeParse({ catalog: { version: "1.0.0" }, loadouts: [bracketing, threeAtTarget] }).success).toBe(true);
    expect(designLoadoutsSchema.safeParse({ catalog: { version: "1.0.0" }, loadouts: [{ ...bracketing, extra: 1 }] }).success).toBe(false);
    for (const lo of [bracketing, threeAtTarget]) for (const r of lo.design.runs ?? []) for (const k of ["batchSize", "speed", "mixTime"] as const) expect(r[k]?.value).toBeUndefined();
  });

  it("start blank: nothing is applied and nothing is printed", () => {
    expect(hasDesign(undefined)).toBe(false);
    expect(mixingDesign(mixingPoint())).toEqual({ rangeLines: [] });
  });

  it("replace swaps the design and leaves the load-out untouched", () => {
    const existing = { approach: "My own", runs: [{ label: "Mine" }] };
    const snapshot = structuredClone(bracketing);
    const out = applyLoadout(existing, bracketing, "replace");
    expect(out.runs?.map((r) => r.label)).toEqual(["Run 1", "Run 2"]);
    expect(out.approach).toBe("Worst-case bracketing");
    out.runs![0]!.label = "edited";
    expect(bracketing).toEqual(snapshot);
  });

  it("append adds the runs after the existing ones and keeps the person's own label", () => {
    const existing = { approach: "My own", runs: [{ label: "Mine" }], rangeSupport: [{ parameter: "Speed", rangeKind: "NOR" as const }] };
    const out = applyLoadout(existing, bracketing, "append");
    expect(out.approach).toBe("My own");
    expect(out.runs?.map((r) => r.label)).toEqual(["Mine", "Run 1", "Run 2"]);
    expect(out.rangeSupport?.map((r) => r.parameter)).toEqual(["Speed", "Batch size"]);
    expect(existing.runs).toHaveLength(1);
  });

  it("append onto nothing is the same as replace", () => {
    expect(applyLoadout(undefined, threeAtTarget, "append")).toEqual(threeAtTarget.design);
  });
});

describe("what the design prints", () => {
  it("prints the label, the run table and the range lines when there are any", () => {
    const filled = applyLoadout(undefined, bracketing, "replace");
    filled.runs![0]!.batchSize = { value: 21, unit: "L", tag: "max" };
    const d = mixingDesign(mixingPoint(filled));
    expect(d.approach).toBe("Worst-case bracketing");
    expect(d.matrix?.columns).toContain("Challenges");
    expect(d.matrix?.rows[0]).toContain("21 L (maximum)");
    expect(d.matrix?.rows[1]![4]).toBe("Shear and protein quality");
    expect(d.rangeLines).toEqual(["Range for Batch size (PAR): not given"]);
  });

  it("has no NOR/PAR wording of its own: the kind is whatever the person chose", () => {
    const d = mixingDesign(mixingPoint({ rangeSupport: [{ parameter: "Speed", rangeKind: "NOR", text: "100 to 140 rpm" }, { parameter: "Time", text: "15 to 25 min" }] }));
    expect(d.rangeLines).toEqual(["Range for Speed (NOR): 100 to 140 rpm", "Range for Time: 15 to 25 min"]);
  });

  it("the reporting instructions carry the table when present and say nothing about it when absent", () => {
    const withDesign = mixingPoint(applyLoadout(undefined, bracketing, "replace"));
    const a = reportingInstructions(plan(withDesign), withDesign, { unitOpLabel: (k) => k }).paragraphs.join("\n");
    expect(a).toContain("Study design: Worst-case bracketing.");
    expect(a).toContain("Run 1 (batch size not given");
    expect(a).not.toMatch(/must|each run separately/i);
    const without = mixingPoint();
    const b = reportingInstructions(plan(without), without, { unitOpLabel: (k) => k }).paragraphs.join("\n");
    expect(b).not.toMatch(/Study design|Runs:|Range for/);
  });
});
