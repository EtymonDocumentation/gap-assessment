import { describe, expect, it } from "vitest";
import {
  compareQuantities,
  convert,
  formatNumber,
  formatQuantity,
  formatRange,
  quantitiesEqual,
  quantityRatio,
  quantityWithin,
  rangesEqual,
  rangeWithin,
  toBase,
  UnitError,
  unitDef,
  unitsForDimension,
  UNITS,
} from "@gap/process-model";

const q = (value: number, unit: string) => ({ value, unit });

describe("unit table", () => {
  it("has unique symbols and a base unit (factor 1, offset 0) per dimension", () => {
    const symbols = UNITS.map((u) => u.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const dim of new Set(UNITS.map((u) => u.dimension))) {
      expect(unitsForDimension(dim).some((u) => u.factor === 1 && !u.offset), dim).toBe(true);
    }
  });

  it("looks units up by symbol", () => {
    expect(unitDef("mL")?.dimension).toBe("volume");
    expect(unitDef("nonsense")).toBeUndefined();
    expect(unitsForDimension("volume").map((u) => u.symbol)).toEqual(["µL", "mL", "L"]);
  });
});

describe("convert", () => {
  it("converts volumes", () => {
    expect(convert(q(1, "L"), "mL")).toEqual(q(1000, "mL"));
    expect(convert(q(2500, "mL"), "L")).toEqual(q(2.5, "L"));
    expect(convert(q(500, "µL"), "mL").value).toBeCloseTo(0.5, 12);
    expect(convert(q(1.2, "mL"), "µL").value).toBeCloseTo(1200, 9);
    expect(convert(q(1, "L"), "µL").value).toBeCloseTo(1_000_000, 6);
  });

  it("converts temperature with an offset", () => {
    expect(convert(q(25, "°C"), "K").value).toBeCloseTo(298.15, 9);
    expect(convert(q(300, "K"), "°C").value).toBeCloseTo(26.85, 9);
    expect(convert(q(0, "°C"), "K").value).toBeCloseTo(273.15, 9);
    expect(convert(q(20, "°C"), "°C")).toEqual(q(20, "°C"));
  });

  it("converts time", () => {
    expect(convert(q(2, "h"), "min")).toEqual(q(120, "min"));
    expect(convert(q(90, "min"), "h")).toEqual(q(1.5, "h"));
    expect(convert(q(1, "d"), "h")).toEqual(q(24, "h"));
    expect(convert(q(30, "s"), "min")).toEqual(q(0.5, "min"));
  });

  it("converts pressure", () => {
    expect(convert(q(1, "bar"), "kPa").value).toBeCloseTo(100, 9);
    expect(convert(q(1000, "mbar"), "bar").value).toBeCloseTo(1, 12);
    expect(convert(q(1, "bar"), "psi").value).toBeCloseTo(14.5038, 3);
    expect(convert(q(14.5038, "psi"), "bar").value).toBeCloseTo(1, 4);
  });

  it("converts area, mass, flow, speed and force", () => {
    expect(convert(q(1, "m²"), "cm²")).toEqual(q(10000, "cm²"));
    expect(convert(q(2500, "cm²"), "m²")).toEqual(q(0.25, "m²"));
    expect(convert(q(1, "kg"), "mg")).toEqual(q(1_000_000, "mg"));
    expect(convert(q(1, "L/min"), "mL/min")).toEqual(q(1000, "mL/min"));
    expect(convert(q(60, "L/h"), "L/min").value).toBeCloseTo(1, 12);
    expect(convert(q(120, "units/min"), "units/h").value).toBeCloseTo(7200, 6);
    expect(convert(q(1, "CFU/mL"), "CFU/100 mL")).toEqual(q(100, "CFU/100 mL"));
    expect(convert(q(10, "lbf"), "N").value).toBeCloseTo(44.482216153, 8);
  });

  it("round-trips through another unit", () => {
    for (const [from, via] of [["L", "µL"], ["psi", "kPa"], ["h", "s"], ["K", "°C"]] as const) {
      const back = convert(convert(q(12.5, from), via), from);
      expect(back.value).toBeCloseTo(12.5, 8);
      expect(back.unit).toBe(from);
    }
  });

  it("throws UnitError on unknown units and cross-dimension conversion", () => {
    expect(() => convert(q(1, "L"), "kg")).toThrow(UnitError);
    expect(() => convert(q(1, "L"), "furlong")).toThrow(UnitError);
    expect(() => convert(q(1, "furlong"), "L")).toThrow(UnitError);
    expect(() => toBase(q(1, "furlong"))).toThrow(/Unknown unit/);
  });
});

describe("compareQuantities / quantitiesEqual", () => {
  it("orders quantities across units", () => {
    expect(compareQuantities(q(1, "L"), q(999, "mL"))).toBe(1);
    expect(compareQuantities(q(999, "mL"), q(1, "L"))).toBe(-1);
    expect(compareQuantities(q(1, "h"), q(59, "min"))).toBe(1);
    expect(compareQuantities(q(1, "bar"), q(101, "kPa"))).toBe(-1);
  });

  it("treats the same physical value in different units as equal", () => {
    expect(quantitiesEqual(q(1, "L"), q(1000, "mL"))).toBe(true);
    expect(quantitiesEqual(q(1.2, "mL"), q(1200, "µL"))).toBe(true);
    expect(quantitiesEqual(q(0.1, "m²"), q(1000, "cm²"))).toBe(true);
    expect(quantitiesEqual(q(0, "°C"), q(273.15, "K"))).toBe(true);
    expect(quantitiesEqual(q(30, "min"), q(0.5, "h"))).toBe(true);
  });

  it("absorbs floating point noise but not real differences", () => {
    expect(quantitiesEqual(q(0.1 + 0.2, "L"), q(0.3, "L"))).toBe(true);
    expect(quantitiesEqual(q(1.2, "mL"), q(1.201, "mL"))).toBe(false);
    expect(quantitiesEqual(q(1, "L"), q(1001, "mL"))).toBe(false);
  });

  it("throws UnitError across dimensions", () => {
    expect(() => compareQuantities(q(1, "L"), q(1, "kg"))).toThrow(UnitError);
    expect(() => quantitiesEqual(q(1, "h"), q(1, "bar"))).toThrow(UnitError);
  });
});

describe("rangesEqual", () => {
  it("compares both bounds after conversion", () => {
    expect(rangesEqual({ min: q(1.18, "mL"), max: q(1.22, "mL") }, { min: q(1180, "µL"), max: q(1220, "µL") })).toBe(true);
    expect(rangesEqual({ min: q(1, "L"), max: q(2, "L") }, { min: q(1, "L"), max: q(3, "L") })).toBe(false);
  });

  it("requires open bounds to match open bounds", () => {
    expect(rangesEqual({ max: q(5, "h") }, { max: q(300, "min") })).toBe(true);
    expect(rangesEqual({ max: q(5, "h") }, { min: q(1, "h"), max: q(5, "h") })).toBe(false);
    expect(rangesEqual({ min: q(1, "h") }, { max: q(1, "h") })).toBe(false);
    expect(rangesEqual({}, {})).toBe(true);
  });
});

describe("rangeWithin / quantityWithin", () => {
  const outer = { min: q(40, "L"), max: q(60, "L") };

  it("is inclusive at both ends", () => {
    expect(rangeWithin({ min: q(40, "L"), max: q(60, "L") }, outer)).toBe(true);
    expect(rangeWithin({ min: q(45, "L"), max: q(55, "L") }, outer)).toBe(true);
  });

  it("detects overrun on either side, across units", () => {
    expect(rangeWithin({ min: q(39, "L"), max: q(55, "L") }, outer)).toBe(false);
    expect(rangeWithin({ min: q(45, "L"), max: q(61, "L") }, outer)).toBe(false);
    expect(rangeWithin({ min: q(45000, "mL"), max: q(60000, "mL") }, outer)).toBe(true);
    expect(rangeWithin({ min: q(45000, "mL"), max: q(60001, "mL") }, outer)).toBe(false);
  });

  it("handles one-sided outer ranges", () => {
    expect(rangeWithin({ min: q(5, "L"), max: q(9000, "L") }, { min: q(1, "L") })).toBe(true);
    expect(rangeWithin({ min: q(0.5, "L"), max: q(9, "L") }, { min: q(1, "L") })).toBe(false);
    expect(rangeWithin({ min: q(-5, "L"), max: q(10, "L") }, { max: q(10, "L") })).toBe(true);
    expect(rangeWithin({ min: q(-5, "L"), max: q(11, "L") }, { max: q(10, "L") })).toBe(false);
  });

  it("requires the inner range to be bounded where the outer range is bounded", () => {
    expect(rangeWithin({ min: q(45, "L") }, outer)).toBe(false);
    expect(rangeWithin({ max: q(55, "L") }, outer)).toBe(false);
    expect(rangeWithin({ min: q(45, "L") }, { min: q(40, "L") })).toBe(true);
    expect(rangeWithin({ max: q(45, "L") }, { min: q(40, "L") })).toBe(false);
  });

  it("treats a fully open outer range as containing everything", () => {
    expect(rangeWithin({ min: q(1, "L"), max: q(2, "L") }, {})).toBe(true);
    expect(rangeWithin({}, {})).toBe(true);
  });

  it("checks single quantities against a range", () => {
    expect(quantityWithin(q(50, "L"), outer)).toBe(true);
    expect(quantityWithin(q(60000, "mL"), outer)).toBe(true);
    expect(quantityWithin(q(61, "L"), outer)).toBe(false);
  });

  it("propagates UnitError when dimensions differ", () => {
    expect(() => rangeWithin({ min: q(1, "kg"), max: q(2, "kg") }, outer)).toThrow(UnitError);
  });
});

describe("quantityRatio", () => {
  it("is target over source after conversion", () => {
    expect(quantityRatio(q(150, "L"), q(60, "L"))).toBeCloseTo(2.5, 12);
    expect(quantityRatio(q(1, "L"), q(500, "mL"))).toBeCloseTo(2, 12);
    expect(quantityRatio(q(0.2, "m²"), q(0.1, "m²"))).toBeCloseTo(2, 12);
    expect(quantityRatio(q(30, "min"), q(1, "h"))).toBeCloseTo(0.5, 12);
  });

  it("throws UnitError for different dimensions or unknown units", () => {
    expect(() => quantityRatio(q(1, "L"), q(1, "h"))).toThrow(UnitError);
    expect(() => quantityRatio(q(1, "L"), q(1, "bogus"))).toThrow(UnitError);
  });
});

describe("formatting", () => {
  it("formats numbers without float noise", () => {
    expect(formatNumber(30)).toBe("30");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(1 / 3)).toBe("0.333333");
  });

  it("formats quantities, omitting the unit for plain counts", () => {
    expect(formatQuantity(q(60, "L"))).toBe("60 L");
    expect(formatQuantity(q(0.1, "m²"))).toBe("0.1 m²");
    expect(formatQuantity(q(7, "count"))).toBe("7");
  });

  it("formats a range with a single unit as min–max unit", () => {
    expect(formatRange({ min: q(20, "rpm"), max: q(30, "rpm") })).toBe("20–30 rpm");
  });

  it("formats a range with min equal to max as a single value", () => {
    expect(formatRange({ min: q(60, "L"), max: q(60, "L") })).toBe("60 L");
    expect(formatRange({ min: q(7, "count"), max: q(7, "count") })).toBe("7");
  });

  it("keeps both units when the bounds use different units", () => {
    expect(formatRange({ min: q(1, "L"), max: q(2000, "mL") })).toBe("1 L – 2000 mL");
    // Equal physical value in different units is not collapsed (display-only choice).
    expect(formatRange({ min: q(1, "L"), max: q(1000, "mL") })).toBe("1 L – 1000 mL");
  });

  it("formats one-sided and empty ranges", () => {
    expect(formatRange({ min: q(5, "L") })).toBe("≥ 5 L");
    expect(formatRange({ max: q(24, "h") })).toBe("≤ 24 h");
    expect(formatRange({})).toBe("(no bounds)");
  });
});
