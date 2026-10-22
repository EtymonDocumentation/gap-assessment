import { describe, expect, it } from "vitest";
import { scoreIsEmpty, scoreItem } from "../src/index";
import { custom, fmea, matrix3, qualitative } from "./fixtures";

describe("FMEA", () => {
  it("multiplies S x O x D and shows the working", () => {
    const r = scoreItem(fmea(), { values: { severity: 7, occurrence: 4, detection: 5 } });
    expect(r).toMatchObject({ scored: true, score: 140, sortKey: 140, problems: [] });
    expect(r.working[0]).toBe("Severity 7 x Occurrence 4 x Detection 5 = 140");
    expect(r.label).toBeUndefined();
  });

  it("says plainly that there are no bands instead of judging", () => {
    const r = scoreItem(fmea(), { values: { severity: 1, occurrence: 1, detection: 1 } });
    expect(r.working.join(" ")).toContain("No bands defined by the user");
    expect(r.problems).toEqual([]);
  });

  it("is not scored when a factor is missing, naming it", () => {
    const r = scoreItem(fmea(), { values: { severity: 7, detection: 5 } });
    expect(r.scored).toBe(false);
    expect(r.score).toBeUndefined();
    expect(r.problems).toEqual(["Occurrence has no value"]);
  });

  it("is not scored when a value is outside its scale", () => {
    const r = scoreItem(fmea({ detection: { min: 1, max: 5, levels: [] } }), { values: { severity: 7, occurrence: 4, detection: 9 } });
    expect(r.scored).toBe(false);
    expect(r.problems).toEqual(["Detection 9 is outside the scale 1 to 5"]);
  });

  it("reports the user's band in the user's words, with the note", () => {
    const bands = [
      { label: "Group 1", minRpn: 1, maxRpn: 99, note: "Review at periodic review" },
      { label: "Group 2", minRpn: 100, maxRpn: 1000 },
    ];
    const r = scoreItem(fmea({ bands }), { values: { severity: 7, occurrence: 4, detection: 5 } });
    expect(r.label).toBe("Group 2");
    expect(r.note).toBeUndefined();
    expect(scoreItem(fmea({ bands }), { values: { severity: 2, occurrence: 2, detection: 2 } })).toMatchObject({ label: "Group 1", note: "Review at periodic review" });
  });

  it("names no band, and says why, when the RPN is in no band or in two", () => {
    const gap = scoreItem(fmea({ bands: [{ label: "Low", minRpn: 1, maxRpn: 10 }] }), { values: { severity: 7, occurrence: 4, detection: 5 } });
    expect(gap.scored).toBe(true);
    expect(gap.label).toBeUndefined();
    expect(gap.problems).toEqual(["RPN 140 is in none of the user's bands"]);
    const two = scoreItem(fmea({ bands: [{ label: "A", minRpn: 100, maxRpn: 200 }, { label: "B", minRpn: 140, maxRpn: 300 }] }), { values: { severity: 7, occurrence: 4, detection: 5 } });
    expect(two.label).toBeUndefined();
    expect(two.problems[0]).toContain('in 2 of the user\'s bands ("A", "B")');
  });

  it("applies the severity rule only when the user entered one, next to the band", () => {
    const off = scoreItem(fmea(), { values: { severity: 10, occurrence: 1, detection: 1 } });
    expect(off.trigger).toBeUndefined();
    const on = scoreItem(fmea({ severityTrigger: { min: 9, label: "Always assess", note: "Patient safety" } }), { values: { severity: 10, occurrence: 1, detection: 1 } });
    expect(on.trigger).toEqual({ label: "Always assess", note: "Patient safety" });
    expect(on.score).toBe(10);
    expect(scoreItem(fmea({ severityTrigger: { min: 9, label: "x" } }), { values: { severity: 8, occurrence: 1, detection: 1 } }).trigger).toBeUndefined();
  });

  it("rejects a non-integer value", () => {
    expect(scoreItem(fmea(), { values: { severity: 2.5, occurrence: 1, detection: 1 } }).scored).toBe(false);
  });
});

describe("risk matrix", () => {
  it("reads the cell label by row (likelihood) and column (severity)", () => {
    const r = scoreItem(matrix3(), { values: { likelihood: 3, severity: 3 } });
    expect(r).toMatchObject({ scored: true, label: "Band A", sortKey: 3003, problems: [] });
    expect(r.score).toBeUndefined();
    expect(r.working[0]).toBe('Likelihood "Likely" (row 3) with severity "Major" (column 3)');
    expect(scoreItem(matrix3(), { values: { likelihood: 1, severity: 1 } }).label).toBe("Band C");
  });

  it("is not scored with a missing or out-of-range position", () => {
    expect(scoreItem(matrix3(), { values: { likelihood: 2 } })).toMatchObject({ scored: false, problems: ["Severity has no value"] });
    expect(scoreItem(matrix3(), { values: { likelihood: 4, severity: 1 } }).problems).toEqual(["Likelihood position 4 is outside 1 to 3"]);
  });

  it("places the item but names no risk when the cell has no label", () => {
    const r = scoreItem(matrix3(false), { values: { likelihood: 2, severity: 2 } });
    expect(r.scored).toBe(true);
    expect(r.label).toBeUndefined();
    expect(r.problems[0]).toContain("has no risk label");
  });
});

describe("user-defined method", () => {
  const v = { values: { impact: 2, freq: 3 } };
  it("combines by product, sum or max", () => {
    expect(scoreItem(custom("product"), v)).toMatchObject({ score: 6, sortKey: 6 });
    expect(scoreItem(custom("product"), v).working[0]).toBe("Impact 2 x Frequency 3 = 6");
    expect(scoreItem(custom("sum"), v).score).toBe(5);
    expect(scoreItem(custom("sum"), v).working[0]).toBe("Impact 2 + Frequency 3 = 5");
    expect(scoreItem(custom("max"), v).score).toBe(3);
    expect(scoreItem(custom("max"), v).working[0]).toBe("Highest of Impact 2, Frequency 3 = 3");
  });

  it("uses bands when the user defined them", () => {
    const r = scoreItem(custom("product", { bands: [{ label: "Watch", minRpn: 5, maxRpn: 9 }] }), v);
    expect(r.label).toBe("Watch");
  });

  it("looks the combination up in the user's table and never guesses a missing entry", () => {
    const cfg = custom("lookup", { lookup: [{ levels: [2, 3], label: "Act now" }] });
    expect(scoreItem(cfg, v)).toMatchObject({ scored: true, label: "Act now", problems: [] });
    expect(scoreItem(cfg, v).score).toBeUndefined();
    const missing = scoreItem(cfg, { values: { impact: 1, freq: 1 } });
    expect(missing.scored).toBe(true);
    expect(missing.label).toBeUndefined();
    expect(missing.problems[0]).toContain("has no entry");
  });

  it("is not scored when a factor is missing", () => {
    expect(scoreItem(custom("product"), { values: { impact: 2 } })).toMatchObject({ scored: false, problems: ["Frequency has no value"] });
  });
});

describe("qualitative", () => {
  it("needs a level from the user's list and a written reason", () => {
    expect(scoreItem(qualitative(), { values: {}, level: "High", reason: "Sterility is at stake" })).toMatchObject({ scored: true, label: "High", sortKey: 0, problems: [] });
    expect(scoreItem(qualitative(), { values: {}, level: "Low" })).toMatchObject({ scored: true, label: "Low", problems: ["The written reason is missing"] });
    expect(scoreItem(qualitative(), { values: {}, level: "Low", reason: "   " }).problems).toEqual(["The written reason is missing"]);
  });

  it("is not scored without a level, or with a level that is not in the list", () => {
    expect(scoreItem(qualitative(), { values: {} })).toMatchObject({ scored: false, problems: ["No level chosen"] });
    expect(scoreItem(qualitative(), { values: {}, level: "Severe" })).toMatchObject({ scored: false, problems: ['Level "Severe" is not in the user\'s list'] });
  });
});

describe("scoreIsEmpty", () => {
  it("is true for nothing entered, false for any answer", () => {
    expect(scoreIsEmpty(undefined)).toBe(true);
    expect(scoreIsEmpty({ values: {} })).toBe(true);
    expect(scoreIsEmpty({ values: { severity: 1 } })).toBe(false);
    expect(scoreIsEmpty({ values: {}, level: "High" })).toBe(false);
  });
});
