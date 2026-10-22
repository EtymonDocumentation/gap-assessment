import { describe, expect, it } from "vitest";
import { confRelPlan, fixedCountPlan } from "../../src/index";

describe("fixedCountPlan", () => {
  it("returns the count with its basis", () => {
    const r = fixedCountPlan({ count: 10, basis: "Protocol requirement PR-1" });
    expect(r).toMatchObject({ method: "fixed", ok: true, problems: [], sampleSize: 10 });
    expect(r.working.map((w) => w.value)).toEqual(["10", "Protocol requirement PR-1"]);
    expect(r.citation).not.toBe("");
  });

  it("needs both the count and the basis", () => {
    expect(fixedCountPlan({}).problems).toHaveLength(2);
    expect(fixedCountPlan({ count: 5 }).problems).toEqual(["Enter the basis for the fixed sample count (where the number comes from)."]);
    expect(fixedCountPlan({ basis: "x" }).problems).toEqual(["Enter the fixed sample count."]);
    expect(fixedCountPlan({ count: 5, basis: "   " }).ok).toBe(false);
    expect(fixedCountPlan({ count: 5, basis: "   " }).sampleSize).toBeUndefined();
  });

  it("rejects a count that is not a whole number of 1 or more", () => {
    for (const count of [0, -3, 2.5, Number.NaN]) {
      const r = fixedCountPlan({ count, basis: "x" });
      expect(r.ok, String(count)).toBe(false);
      expect(r.sampleSize).toBeUndefined();
    }
  });
});

describe("confRelPlan known values", () => {
  const cases: [number, number, number, number][] = [
    [0.95, 0.99, 0, 299],
    [0.95, 0.95, 0, 59],
    [0.9, 0.9, 0, 22],
    [0.95, 0.95, 1, 93],
    [0.99, 0.99, 0, 459],
  ];
  it.each(cases)("C %s / R %s / c %s gives n = %s", (confidence, reliability, allowedFailures, n) => {
    const r = confRelPlan({ confidence, reliability, allowedFailures });
    expect(r).toMatchObject({ method: "conf-rel", ok: true, problems: [], sampleSize: n });
    expect(r.hundredPercent).toBeUndefined();
    expect(r.working.length).toBeGreaterThan(4);
  });

  it("agrees with n = ceil(ln(1 - C) / ln(R)) for c = 0 on a grid", () => {
    for (const C of [0.5, 0.8, 0.9, 0.95, 0.99, 0.999]) {
      for (const R of [0.5, 0.8, 0.9, 0.95, 0.99, 0.999]) {
        const closed = Math.ceil(Math.log(1 - C) / Math.log(R) - 1e-9);
        expect(confRelPlan({ confidence: C, reliability: R, allowedFailures: 0 }).sampleSize, `C${C} R${R}`).toBe(closed);
      }
    }
  });

  it("is exact when the answer lands exactly on the target (C 0.75, R 0.5, c 0 needs n = 2)", () => {
    expect(confRelPlan({ confidence: 0.75, reliability: 0.5, allowedFailures: 0 }).sampleSize).toBe(2);
  });

  it("stays stable for large n and for several allowed failures", () => {
    const r = confRelPlan({ confidence: 0.999, reliability: 0.9999, allowedFailures: 5 });
    expect(r.ok).toBe(true);
    expect(r.sampleSize!).toBeGreaterThan(50_000);
    expect(Number.isFinite(r.sampleSize)).toBe(true);
  });
});

describe("confRelPlan properties", () => {
  it("never needs fewer samples for a higher confidence", () => {
    for (const c of [0, 1, 3]) {
      let last = 0;
      for (const C of [0.5, 0.7, 0.8, 0.9, 0.95, 0.975, 0.99, 0.999]) {
        const n = confRelPlan({ confidence: C, reliability: 0.95, allowedFailures: c }).sampleSize!;
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
    }
  });

  it("never needs fewer samples for a higher reliability", () => {
    for (const c of [0, 1, 3]) {
      let last = 0;
      for (const R of [0.5, 0.7, 0.8, 0.9, 0.95, 0.975, 0.99, 0.999]) {
        const n = confRelPlan({ confidence: 0.95, reliability: R, allowedFailures: c }).sampleSize!;
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
    }
  });

  it("needs more samples when more failures are allowed", () => {
    const n = (c: number) => confRelPlan({ confidence: 0.95, reliability: 0.95, allowedFailures: c }).sampleSize!;
    expect(n(0)).toBeLessThan(n(1));
    expect(n(1)).toBeLessThan(n(2));
  });
});

describe("confRelPlan lot size and problems", () => {
  it("flags 100 % inspection when n is larger than the lot", () => {
    const r = confRelPlan({ confidence: 0.95, reliability: 0.99, allowedFailures: 0, lotSize: 100 });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.hundredPercent).toBe(true);
    expect(r.sampleSize).toBe(100);
  });

  it("keeps n when the lot is larger", () => {
    const r = confRelPlan({ confidence: 0.95, reliability: 0.99, allowedFailures: 0, lotSize: 299 });
    expect(r.hundredPercent).toBeUndefined();
    expect(r.sampleSize).toBe(299);
  });

  it("lists every missing input and gives no sample size", () => {
    const r = confRelPlan({});
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(3);
    expect(r.sampleSize).toBeUndefined();
    expect(confRelPlan({ confidence: 0.95, reliability: 0.99 }).problems).toEqual(["Enter the number of failures allowed in the sample (0 is allowed)."]);
  });

  it("rejects inputs outside their range (percentages instead of fractions, negative or fractional failures)", () => {
    expect(confRelPlan({ confidence: 95, reliability: 0.99, allowedFailures: 0 }).ok).toBe(false);
    expect(confRelPlan({ confidence: 0.95, reliability: 1, allowedFailures: 0 }).ok).toBe(false);
    expect(confRelPlan({ confidence: 0, reliability: 0.9, allowedFailures: 0 }).ok).toBe(false);
    expect(confRelPlan({ confidence: 0.95, reliability: 0.99, allowedFailures: -1 }).ok).toBe(false);
    expect(confRelPlan({ confidence: 0.95, reliability: 0.99, allowedFailures: 1.5 }).ok).toBe(false);
    expect(confRelPlan({ confidence: 0.95, reliability: 0.99, allowedFailures: 0, lotSize: 0 }).ok).toBe(false);
  });

  it("stops at the search cap with a problem instead of running forever", () => {
    const r = confRelPlan({ confidence: 0.99, reliability: 0.99999999, allowedFailures: 0 });
    expect(r.ok).toBe(false);
    expect(r.sampleSize).toBeUndefined();
    expect(r.problems[0]).toContain("1,000,000");
  });
});
