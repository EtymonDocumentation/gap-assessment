import type { SampleMethod, SamplingBatch, SamplingPlan, SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { designReview, designReviewView, methodDocumentLines, parseQuantity, sterileFilterIndex, studyEquipmentTable, volumeMlOf, volumeTakenPerBatch, type ReviewFinding } from "../../src/index";

// M11 job 2: group C (volume taken, draw order on a shared port), the shared volume arithmetic and the study-only equipment lines.
const at = "2026-10-01T00:00:00.000Z";
const point = (id: string, extra: Partial<SamplingPoint> = {}, method?: SampleMethod): SamplingPoint =>
  ({
    id,
    origin: { kind: "manual" },
    type: "ipc",
    unitOp: "compounding",
    attribute: "Bulk pH (fictional)",
    timing: { options: ["end"] },
    sampleSize: { inputs: {} },
    rationale: "Fictional.",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...(method ? { method } : {}),
    ...extra,
  }) as SamplingPoint;
const batch = (n: number, size?: number, unit?: string): SamplingBatch => ({ id: `B-00${n}`, label: `PPQ ${n}`, ...(size !== undefined ? { batchSize: size } : {}), ...(unit ? { batchSizeUnit: unit } : {}) }) as SamplingBatch;
const planOf = (points: SamplingPoint[], batches: SamplingBatch[], extra: Partial<SamplingPlan> = {}): SamplingPlan =>
  ({ id: "SPL-001", title: "Plan", status: "draft", steps: [], batches, batchRationale: "", parties: [], agencyRequests: [], points, subsections: [], createdAt: at, updatedAt: at, ...extra }) as SamplingPlan;
const raised = (p: SamplingPlan, check: string): ReviewFinding[] => designReview(p).filter((f) => f.checkId === check);
const ml = (id: string, value: number, locations: number | undefined, extra: Partial<SamplingPoint> = {}, method?: SampleMethod) =>
  point(id, { quantity: { value, unit: "mL" }, ...(locations !== undefined ? { locationsCount: locations } : {}), ...extra }, method);

describe("shared volume arithmetic", () => {
  it("reads quantities and turns them into mL the same way for the plan and the record", () => {
    expect(parseQuantity("2 × 10 mL")).toMatchObject({ count: 2, each: 10, kind: "volume" });
    expect(volumeMlOf(2, 10, "ml")).toBe(20);
    expect(volumeMlOf(1, 1.5, "l")).toBe(1500);
  });

  it("counts samples and flushes per batch, smallest batch first", () => {
    const p = planOf([ml("SP-001", 10, 3, {}, { access: "dedicated_port", flush: { practice: "flush_volume", volume: { value: 5, unit: "mL" }, discardTo: "waste" } })], [batch(1, 50, "L"), batch(2, 9, "L")]);
    const rows = volumeTakenPerBatch(p);
    expect(rows.map((r) => r.label)).toEqual(["PPQ 2", "PPQ 1"]);
    expect(rows[0]).toMatchObject({ sampleMl: 30, flushMl: 15, batchSizeMl: 9000 });
    expect(rows[0]!.percent).toBeCloseTo(0.5);
  });

  it("shares the sterile-filtration key with the batch record", () => {
    expect(sterileFilterIndex(["a", "sterile_filtration", "x", "sterile_filtration"], "first")).toBe(1);
    expect(sterileFilterIndex(["a", "sterile_filtration", "x", "sterile_filtration"], "last")).toBe(3);
    expect(sterileFilterIndex(["a"], "first")).toBe(-1);
  });
});

describe("design review C1: volume taken from each batch", () => {
  const base = () => planOf([ml("SP-001", 10, 3), ml("SP-002", 100, 2)], [batch(1, 50, "L"), batch(2, 9, "L")]);

  it("raises once with the numbers when no percent is set (smallest batch first)", () => {
    const f = raised(base(), "C1");
    expect(f).toHaveLength(1);
    expect(f[0]!.key).toBe("C1:plan");
    expect(f[0]!.group).toBe("C");
    expect(f[0]!.states.indexOf("PPQ 2")).toBeLessThan(f[0]!.states.indexOf("PPQ 1"));
    expect(f[0]!.states).toContain("230 mL of samples");
    expect(f[0]!.question).toMatch(/\?$/);
  });

  it("with a percent: raises above it, stays quiet at or below it", () => {
    const p = (percent: number) => ({ ...base(), designReview: { volumeFlagPercent: percent } }) as SamplingPlan;
    expect(raised(p(2), "C1")[0]!.question).toContain("more than 2 %");
    expect(raised(p(2), "C1")[0]!.states).toContain("flagged above 2 %");
    expect(raised(p(5), "C1")).toEqual([]);
  });

  it("a different percent changes the fingerprint, so an answer reads look again", () => {
    const a = raised({ ...base(), designReview: { volumeFlagPercent: 1 } } as SamplingPlan, "C1")[0]!;
    const b = raised({ ...base(), designReview: { volumeFlagPercent: 2 } } as SamplingPlan, "C1")[0]!;
    expect(a.factsFingerprint).not.toBe(b.factsFingerprint);
  });

  it("a batch size that is not in litres is not compared, and the finding says so", () => {
    const p = planOf([ml("SP-001", 10, 3)], [batch(1, 120, "kg")]);
    const f = raised(p, "C1")[0]!;
    expect(f.states).toContain("not in litres");
    expect(raised({ ...p, designReview: { volumeFlagPercent: 5 } } as SamplingPlan, "C1")).toHaveLength(1);
  });

  it("an unknown quantity or location is named, never guessed", () => {
    const p = planOf([ml("SP-001", 10, 3), point("SP-002"), ml("SP-003", 10, undefined)], [batch(1, 50, "L")]);
    const f = raised(p, "C1")[0]!;
    expect(f.states).toContain("the quantity of SP-002");
    expect(f.states).toContain("how many locations SP-003 is taken at");
    expect(f.states).toContain("30 mL of samples");
  });

  it("is silent when no volume can be counted, or the plan has no batch", () => {
    expect(raised(planOf([point("SP-001")], [batch(1, 50, "L")]), "C1")).toEqual([]);
    expect(raised(planOf([ml("SP-001", 10, 3)], []), "C1")).toEqual([]);
    const syringes = point("SP-001", { quantity: { value: 5, unit: "syringes" }, locationsCount: 3 });
    expect(raised(planOf([syringes], [batch(1, 50, "L")]), "C1")).toEqual([]);
  });

  it("uses no forbidden words", () => {
    const f = raised(base(), "C1")[0]!;
    expect(`${f.states} ${f.why} ${f.question}`).not.toMatch(/\b(error|non-compliant|fail|must)\b/i);
  });
});

describe("design review C2: draw order on a shared port", () => {
  const shared = (order: string | undefined, microbialId = "SP-001") =>
    planOf(
      [
        point("SP-001", { attribute: microbialId === "SP-001" ? "Bioburden of the bulk" : "Bulk pH" }, { access: "shared_port", shared: { pointIds: ["SP-002"], ...(order ? { order } : {}), flushBetween: true } }),
        point("SP-002", { attribute: microbialId === "SP-002" ? "Endotoxin" : "Bulk pH" }, { access: "shared_port", shared: { pointIds: ["SP-001"], ...(order ? { order } : {}), flushBetween: true } }),
      ],
      [],
    );

  it("stays quiet when the microbial sample is drawn first", () => {
    expect(raised(shared("SP-001 first, then SP-002"), "C2")).toEqual([]);
    expect(raised(shared("BIOBURDEN first, then pH"), "C2")).toEqual([]);
  });

  it("asks when the microbial sample is not first", () => {
    const f = raised(shared("SP-002, then SP-001"), "C2");
    expect(f).toHaveLength(1);
    expect(f[0]!.key).toBe("C2:SP-001+SP-002");
    expect(f[0]!.states).toContain("before the microbial sample");
  });

  it("asks when the order is not written or does not name the microbial sample", () => {
    expect(raised(shared(undefined), "C2")[0]!.states).toContain("No order is written");
    expect(raised(shared("pH first"), "C2")[0]!.states).toContain("cannot be read");
  });

  it("matches the microbial words case-insensitively (endotoxin, sterility, micro)", () => {
    expect(raised(shared("SP-001 then SP-002", "SP-002"), "C2")).toHaveLength(1);
    const p = planOf([point("SP-001", { attribute: "STERILITY" }, { access: "shared_port", shared: { pointIds: ["SP-002"], order: "SP-002 then SP-001" } }), point("SP-002", {}, { access: "shared_port", shared: { pointIds: ["SP-001"] } })], []);
    expect(raised(p, "C2")).toHaveLength(1);
  });

  it("is silent when no sample on the port is microbial, or the port is not shared", () => {
    const none = planOf([point("SP-001", {}, { access: "shared_port", shared: { pointIds: ["SP-002"] } }), point("SP-002", {}, { access: "shared_port", shared: { pointIds: ["SP-001"] } })], []);
    expect(raised(none, "C2")).toEqual([]);
    expect(raised(planOf([point("SP-001", { attribute: "Bioburden" }, { access: "dedicated_port" })], []), "C2")).toEqual([]);
  });
});

describe("study-only equipment lines (A5 feed)", () => {
  const withEq = () =>
    planOf(
      [point("SP-001", { flow: { stepId: "ST-01", at: "during" } }), point("SP-002", { flow: { stepId: "ST-02", at: "during" } }), point("SP-003")],
      [],
      {
        steps: [
          { id: "ST-01", unitOp: "compounding", label: "Compounding" },
          { id: "ST-02", unitOp: "bbr_filtration", label: "BBR" },
        ],
        designReview: { studyEquipment: { used: true, items: [{ id: "EQ-01", what: "Manifold (fictional)", stepId: "ST-01", removedAfter: true }, { id: "EQ-02", what: "Extra bag", pointIds: ["SP-002"], qualified: false }] } },
      } as Partial<SamplingPlan>,
    );

  it("adds a PPQ-only line to the samples the item names (by sample, or by step)", () => {
    const p = withEq();
    expect(methodDocumentLines(p.points[0]!, p, "ppq").map((l) => l.text)).toEqual(["PPQ only: Manifold (fictional) (EQ-01) is used only to take samples; removed afterwards."]);
    expect(methodDocumentLines(p.points[1]!, p, "ppq")[0]!.text).toContain("Extra bag (EQ-02)");
    expect(methodDocumentLines(p.points[2]!, p, "ppq")).toEqual([]);
  });

  it("says study only at another project stage, and writes nothing without equipment", () => {
    const p = withEq();
    expect(methodDocumentLines(p.points[0]!, p, "clinical")[0]!.text).toMatch(/^study only:/);
    expect(methodDocumentLines(p.points[0]!, { ...p, designReview: undefined } as SamplingPlan, "ppq")).toEqual([]);
    expect(studyEquipmentTable({ ...p, designReview: undefined } as SamplingPlan)).toBeUndefined();
  });

  it("lists every item in the plan table with what is not stated", () => {
    const t = studyEquipmentTable(withEq())!;
    expect(t.rows[0]).toEqual(["EQ-01", "Manifold (fictional)", "Compounding", "Not stated", "Not stated", "Not stated", "Yes"]);
    expect(t.rows[1]![5]).toBe("No");
  });
});

describe("design review view with group C", () => {
  it("puts C1 and C2 in the C group with the plain heading", () => {
    const p = planOf([ml("SP-001", 10, 3)], [batch(1, 50, "L")]);
    const g = designReviewView(p).groups.find((x) => x.group === "C")!;
    expect(g.title).toBe("How much is taken, and in what order");
    expect(g.items.map((i) => i.finding.checkId)).toEqual(["C1"]);
  });
});
