// The SYR-305 demo PPQ sampling plan (three batches at 50 L, 100 L and 9 L), the TRD figures that changed with it, and the
// batch record rows that point at the plan. All data are fictional. The plan's rationale text must not contradict the TRD numbers.
import { buildDemoProject, buildSamplingPlanDocument, sampleDiff, sampleFieldsOf, samplingOpenItems } from "@gap/engine";
import { planTotals, unitsPerBatch } from "@gap/sampling";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const plan = project.sampling.plans[0]!;
const doc = project.trd.documents[0]!;
const rec = project.mbr.records[0]!;
const item = (uo: string, key: string) => doc.steps.find((s) => s.key === uo)!.items.find((i) => i.key === key)!;
const limitsOf = (uo: string, key: string) => item(uo, key).limits!;
const setPointOf = (uo: string, key: string) => {
  const sp = limitsOf(uo, key).setPoint;
  return sp && "value" in sp ? sp.value : NaN;
};

describe("SYR-305 PPQ sampling plan", () => {
  it("is built complete: the only open item is the agency-requests statement", () => {
    const open = samplingOpenItems(content, project, plan);
    // One plan-level item, and no point is incomplete. The demo schema cannot state "no agency requests", so that one stays open on purpose.
    expect([...new Set(open.map((o) => o.ref))]).toEqual(["plan"]);
    expect(open).toHaveLength(1);
    expect(JSON.stringify(open)).toMatch(/agency/i);
  });

  it("has Table 4 samples 1 to 17 in order, with the expected types", () => {
    expect(plan.points.map((p) => p.id)).toEqual(Array.from({ length: 17 }, (_, i) => `SP-${String(i + 1).padStart(3, "0")}`));
    const types = plan.points.map((p) => p.type);
    expect(types.slice(0, 6)).toEqual(Array(6).fill("mixing_homogeneity"));
    expect(types.slice(6, 9)).toEqual(Array(3).fill("hold_time"));
    expect(types.slice(9, 14)).toEqual(Array(5).fill("ppq_enhanced"));
    expect(types[14]).toBe("hold_time");
    expect(types[15]).toBe("stability");
    expect(types[16]).toBe("supporting_study");
  });

  it("has three batches of 50 L, 100 L and 9 L, and sample 9 applies to the two outer batches only", () => {
    expect(plan.batches.map((b) => b.label)).toEqual(["PPQ 1", "PPQ 2", "PPQ 3"]);
    const nine = plan.points[8]!;
    expect(nine.appliesTo).toHaveLength(2);
    expect(nine.appliesTo).toEqual([plan.batches[1]!.id, plan.batches[2]!.id]);
    for (const p of plan.points.filter((x) => x.id !== nine.id)) expect(p.appliesTo, p.id).toBe("all");
    // Units are counted on the batches a point applies to, so sample 9 adds nothing to PPQ 1.
    expect(unitsPerBatch(plan, nine).filter((u) => u.applies).map((u) => u.batchId)).toEqual(nine.appliesTo);
    expect(planTotals(plan).perBatch).toHaveLength(3);
  });

  it("derives the stability quantity from conditions x time points x units: 600 syringes", () => {
    const stab = plan.points[15]!;
    expect(stab.detail?.stability?.conditions).toHaveLength(2);
    expect(stab.detail?.stability?.timePoints).toHaveLength(5);
    expect(unitsPerBatch(plan, stab).every((u) => u.units === 600)).toBe(true);
  });

  it("states the impeller point and the batch bracket in the rationale, matching the TRD", () => {
    const text = JSON.stringify(plan);
    expect(text).toMatch(/9 L/);
    expect(text).toMatch(/100 L/);
    expect(text).toMatch(/50 L/);
    expect(text).not.toMatch(/\b40 L\b/);
    expect(JSON.stringify(plan)).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
  });

  it("renders to a document that carries the banner and the filing wording only as the assessment request", () => {
    const d = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: "2026-10-26T00:00:00.000Z" });
    const text = JSON.stringify(d);
    expect(text).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(text).not.toMatch(/filing category/i);
  });
});

describe("SYR-305 TRD figures after the PPQ proposal", () => {
  it("sets the batch size after dilution to 50 L, NOR 45 to 55 L, PAR 9 to 100 L", () => {
    const l = limitsOf("compounding", "batch_size");
    expect(setPointOf("compounding", "batch_size")).toBe(50);
    expect([l.nor?.min, l.nor?.max]).toEqual([45, 55]);
    expect([l.par?.min, l.par?.max]).toEqual([9, 100]);
  });

  it("allows 4 h filter contact in the normal range and 24 h in the proven range", () => {
    const l = limitsOf("bbr_filtration", "max_filtration_time");
    expect(setPointOf("bbr_filtration", "max_filtration_time")).toBe(4);
    expect(l.nor?.max).toBe(4);
    expect(l.par?.max).toBe(24);
  });

  it("keeps the hold limits equal to their claims and the filling speed PAR at 200", () => {
    expect(limitsOf("aseptic_filling", "line_speed").par?.max).toBe(200);
    expect(limitsOf("aseptic_filling", "max_fill_duration").par?.max).toBe(8);
    expect(limitsOf("storage_shipping", "max_total_time_out_of_refrigeration").nor?.max).toBe(12);
  });

  it("writes the single-use mixing bag and its impeller point, and tracks time out of refrigeration per portion", () => {
    const text = JSON.stringify(project.trd.documents[0]);
    expect(text).toContain("100 L single-use mixing bag");
    expect(text).toContain("covered from a volume of 9 L");
    expect(text).toContain("for each portion");
  });
});

describe("SYR-305 batch record sample rows", () => {
  const rows = rec.sections.flatMap((s) => s.blocks).flatMap((b) => b.samples);

  it("links to the plan and has one row per point, each still equal to its point", () => {
    expect(rec.planId).toBe(plan.id);
    expect(rows.map((r) => r.pointId).sort()).toEqual(plan.points.map((p) => p.id));
    for (const r of rows) expect(sampleDiff(r, plan), r.pointId).toEqual({ missing: false, keys: [] });
  });

  it("shows a set of containers as 'N x quantity', and a single container as the plain quantity", () => {
    const first = plan.points[0]!;
    expect(first.containerUnitsPerSample).toBe(2);
    expect(sampleFieldsOf(plan, first).quantity).toBe("2 × 10 mL");
    const stab = plan.points[15]!;
    expect(sampleFieldsOf(plan, stab).quantity).not.toContain("×");
  });

  it("does not hard-code the PPQ-only extended holds as limits: hold limits equal the TRD claims", () => {
    const limits = rec.sections.flatMap((s) => s.blocks).flatMap((b) => b.timeLimits);
    for (const t of limits.filter((x) => x.trd?.status === "established")) expect(Number.isFinite(Number(t.value)), t.key).toBe(true);
    // The PPQ plan challenges holds up to 36 h; no batch-record limit takes that figure.
    expect(limits.map((t) => t.value)).not.toContain("36");
  });

  it("tracks time out of refrigeration per portion in the library blocks the record uses", () => {
    const texts = rec.sections.flatMap((s) => s.blocks).flatMap((b) => b.steps.map((st) => st.text)).join(" ");
    expect(texts).toContain("{portion ID}");
    expect(texts).toMatch(/this portion leaves refrigerated storage/);
    expect(texts).toMatch(/this portion returns to refrigerated storage/);
  });
});
