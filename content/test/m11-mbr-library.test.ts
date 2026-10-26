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
