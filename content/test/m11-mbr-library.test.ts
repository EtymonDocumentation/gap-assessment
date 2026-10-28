import { describe, expect, it } from "vitest";
import { blocksForUnitOp } from "@gap/engine";
import { mbrLibrary } from "../index";

describe("M11 shipped step-blocks library", () => {
  it("loads, an edited block keeps every earlier version in full and the ids are unique", () => {
    expect(mbrLibrary.length).toBeGreaterThanOrEqual(20);
    expect(new Set(mbrLibrary.map((b) => b.id)).size).toBe(mbrLibrary.length);
    for (const b of mbrLibrary) {
      expect((b.history ?? []).map((h) => h.version)).toEqual(Array.from({ length: b.version - 1 }, (_, i) => i + 1));
      expect(b.steps.length).toBeGreaterThan(0);
    }
  });

  it("offers blocks for the main unit operations and keeps values out of the text", () => {
    for (const uo of ["compounding", "sterile_filtration", "aseptic_filling", "visual_inspection", "storage_shipping"]) {
      expect(blocksForUnitOp(mbrLibrary, uo).length).toBeGreaterThan(0);
    }
    // The library names which TRD value a row pulls; it never carries a number of its own.
    for (const b of mbrLibrary) for (const p of b.params) expect(p).not.toHaveProperty("value");
  });

  it("uses neutral wording only", () => {
    const text = JSON.stringify(mbrLibrary);
    expect(text).not.toMatch(/\b(must|violation|non-compliant)\b/i);
  });
});

// Blocks changed after the operator walk-through of the SYR-305 demo record: each change is a new version and the old text stays in full.
describe("blocks changed after the operator walk-through", () => {
  const block = (id: string) => mbrLibrary.find((b) => b.id === id)!;

  it("keeps the old text of the bioburden sample, the filtration start and the filter record in the history", () => {
    expect(block("bbr_filtration_run").version).toBe(4);
    expect(block("sterile_filtration_inline").version).toBe(2);
    expect(block("filter_records").version).toBe(2);
    expect(block("sterile_filtration_inline").history![0]!.steps).toHaveLength(4); // v1 still had the start step
    expect(block("sterile_filtration_inline").steps).toHaveLength(3);
  });

  it("takes the bioburden sample of the formulated bulk before the hold ends, and starts the filtration in its own block", () => {
    const steps = block("bbr_filtration_run").steps;
    const sample = steps.findIndex((t) => /bioburden sample/.test(t));
    const holdEnd = steps.findIndex((t) => /hold end|end of the hold/i.test(t) && !/bioburden/.test(t));
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThan(holdEnd);
    const start = block("sterile_filtration_inline_start");
    expect(start.version).toBe(1);
    expect(start.steps[0]).toMatch(/bioburden sample/);
    expect(start.steps[1]).toMatch(/out of cold storage only now/);
    expect(start.steps[2]).toMatch(/^Start the filtration into the surge bag/);
  });

  it("has a batch identification block for the first section, and a filter record that copies the post-use reading", () => {
    expect(block("batch_identification").steps[0]).toContain("{batch number}");
    expect(block("filter_records").steps.join(" ")).toContain("Do not test the filter again for this table");
  });
});
