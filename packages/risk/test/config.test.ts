import { describe, expect, it } from "vitest";
import { bandProblems, configProblems, describeAnswers, describeMethod, factorColumns, heatCounts, scoreRange } from "../src/index";
import { custom, fmea, matrix3, qualitative } from "./fixtures";

describe("bandProblems", () => {
  it("is quiet for bands that cover the range once", () => {
    expect(bandProblems([{ label: "A", minRpn: 1, maxRpn: 9 }, { label: "B", minRpn: 10, maxRpn: 20 }], { lo: 1, hi: 20 })).toEqual([]);
  });
  it("reports an overlap", () => {
    expect(bandProblems([{ label: "A", minRpn: 1, maxRpn: 12 }, { label: "B", minRpn: 10, maxRpn: 20 }])[0]).toContain('"A" and "B" overlap (10 to 12)');
  });
  it("reports an overlap with a wide band that swallows a later one", () => {
    const p = bandProblems([{ label: "Wide", minRpn: 1, maxRpn: 100 }, { label: "In", minRpn: 10, maxRpn: 20 }, { label: "Out", minRpn: 50, maxRpn: 60 }]);
    expect(p.filter((x) => x.includes("overlap"))).toHaveLength(2);
  });
  it("reports a gap between bands and at the ends of the range", () => {
    expect(bandProblems([{ label: "A", minRpn: 5, maxRpn: 9 }, { label: "B", minRpn: 15, maxRpn: 20 }], { lo: 1, hi: 30 })).toEqual(["No band covers 10 to 14", "No band covers 1 to 4", "No band covers 21 to 30"]);
  });
  it("does not call touching whole-number bands a gap", () => {
    expect(bandProblems([{ label: "A", minRpn: 1, maxRpn: 9 }, { label: "B", minRpn: 10, maxRpn: 12 }])).toEqual([]);
  });
  it("reports a reversed band and a repeated label", () => {
    const p = bandProblems([{ label: "A", minRpn: 9, maxRpn: 1 }, { label: "B", minRpn: 1, maxRpn: 2 }, { label: "B", minRpn: 3, maxRpn: 4 }]);
    expect(p).toContain('Band "A" starts at 9 and ends at 1');
    expect(p).toContain('Band label "B" is used 2 times');
  });
});

describe("scoreRange", () => {
  it("is the product of the extremes for FMEA", () => {
    expect(scoreRange(fmea())).toEqual({ lo: 1, hi: 1000 });
    expect(scoreRange(fmea({ severity: { min: 1, max: 5, levels: [] }, occurrence: { min: 1, max: 5, levels: [] }, detection: { min: 1, max: 5, levels: [] } }))).toEqual({ lo: 1, hi: 125 });
  });
  it("follows the combination of a user-defined method, and is absent for the others", () => {
    expect(scoreRange(custom("sum"))).toEqual({ lo: 2, hi: 6 });
    expect(scoreRange(custom("max"))).toEqual({ lo: 1, hi: 3 });
    expect(scoreRange(custom("lookup"))).toBeUndefined();
    expect(scoreRange(matrix3())).toBeUndefined();
    expect(scoreRange(qualitative())).toBeUndefined();
  });
});

describe("configProblems", () => {
  it("has none for a method without bands: bands are the user's choice", () => {
    expect(configProblems(fmea())).toEqual([]);
    expect(configProblems(qualitative())).toEqual([]);
    expect(configProblems(matrix3())).toEqual([]);
  });
  it("reports band problems over the whole possible RPN range", () => {
    expect(configProblems(fmea({ bands: [{ label: "Low", minRpn: 1, maxRpn: 100 }] }))).toEqual(["No band covers 101 to 1000"]);
  });
  it("reports a severity rule outside the severity scale", () => {
    expect(configProblems(fmea({ severityTrigger: { min: 11, label: "x" } }))[0]).toContain("outside the severity scale 1 to 10");
  });
  it("counts the matrix cells without a label", () => {
    expect(configProblems(matrix3(false))).toEqual(["9 of 9 matrix cells have no risk label"]);
  });
  it("reports repeated level names", () => {
    expect(configProblems({ ...qualitative(), levels: [{ label: "High" }, { label: "High" }] })).toEqual(['The level "High" appears twice']);
  });
  it("counts the combinations a lookup table lacks", () => {
    expect(configProblems(custom("lookup", { lookup: [{ levels: [1, 1], label: "x" }] }))).toEqual(["The lookup table has no label for 8 of 9 combinations"]);
  });
});

describe("describe and columns", () => {
  it("lists the score columns per method", () => {
    expect(factorColumns(fmea()).map((c) => c.short)).toEqual(["S", "O", "D"]);
    expect(factorColumns(matrix3()).map((c) => c.key)).toEqual(["likelihood", "severity"]);
    expect(factorColumns(custom("sum")).map((c) => c.name)).toEqual(["Impact", "Frequency"]);
    expect(factorColumns(qualitative())).toEqual([]);
  });
  it("describes answers in words", () => {
    expect(describeAnswers(fmea(), { values: { severity: 7, occurrence: 4 } })).toBe("S 7, O 4");
    expect(describeAnswers(matrix3(), { values: { likelihood: 2, severity: 3 } })).toBe("Likelihood: Possible, Severity: Major");
    expect(describeAnswers(qualitative(), { values: {}, level: "High" })).toBe("High");
  });
  it("describes an FMEA with its formula and says when there are no bands", () => {
    const d = describeMethod(fmea());
    expect(d.formula).toContain("severity x occurrence x detection");
    expect(d.scales.map((s) => s.name)).toEqual(["Severity", "Occurrence", "Detection"]);
    expect(d.bandsText).toBe("No bands defined by the user. Scores are shown without a judgement.");
    expect(d.bands).toEqual([]);
  });
  it("describes bands sorted by range, with the severity rule", () => {
    const d = describeMethod(fmea({ bands: [{ label: "B", minRpn: 50, maxRpn: 100, note: "n" }, { label: "A", minRpn: 1, maxRpn: 49 }], severityTrigger: { min: 9, label: "Assess" } }));
    expect(d.bands).toEqual([{ label: "A", range: "1 to 49" }, { label: "B", range: "50 to 100", note: "n" }]);
    expect(d.extra[0]).toContain("severity of 9 or more");
  });
  it("describes the matrix grid as text and the lookup table as lines", () => {
    const m = describeMethod(matrix3());
    expect(m.grid?.rows).toEqual(["Rare", "Possible", "Likely"]);
    expect(m.grid?.cells[2]).toEqual(["Band B", "Band A", "Band A"]);
    const l = describeMethod(custom("lookup", { lookup: [{ levels: [2, 3], label: "Act now" }] }));
    expect(l.extra).toEqual(["Impact 2, Frequency 3: Act now"]);
  });
});

describe("heatCounts", () => {
  it("counts the items per cell and the items that cannot be placed", () => {
    const h = heatCounts(matrix3(), [
      { values: { likelihood: 1, severity: 1 } },
      { values: { likelihood: 1, severity: 1 } },
      { values: { likelihood: 3, severity: 2 } },
      { values: { likelihood: 2 } },
      undefined,
    ]);
    expect(h.counts[0]![0]).toBe(2);
    expect(h.counts[2]![1]).toBe(1);
    expect(h.placed).toBe(3);
    expect(h.notScored).toBe(2);
  });
  it("places nothing for a method without a grid", () => {
    expect(heatCounts(fmea(), [{ values: {} }])).toEqual({ counts: [], placed: 0, notScored: 1 });
  });
});
