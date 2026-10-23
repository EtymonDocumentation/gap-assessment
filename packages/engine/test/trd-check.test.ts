import { describe, expect, it } from "vitest";
import { checkLimits, rangeText, setPointText } from "../src/index";

const src = ["src-1"];
const range = (min: number | undefined, max: number | undefined, unit: string | undefined, sourceIds = src) => ({ ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(unit ? { unit } : {}), sourceIds });
const texts = (c: ReturnType<typeof checkLimits>) => c.findings.map((f) => f.text);

describe("PAR / NOR check (report only)", () => {
  it("has nothing to say when nothing is entered", () => {
    expect(checkLimits(undefined)).toEqual({ findings: [], working: [] });
    expect(checkLimits({}).findings).toEqual([]);
  });

  it("finds no problem when the NOR lies inside the PAR and the set point inside the NOR", () => {
    const c = checkLimits({ setPoint: { value: 20, unit: "°C", sourceIds: src }, nor: range(18, 22, "°C"), par: range(15, 25, "°C") });
    expect(c.findings).toEqual([]);
    expect(c.working.length).toBe(3);
  });

  it("reports a NOR end outside the PAR, in neutral words, one finding per end", () => {
    const c = checkLimits({ nor: range(10, 30, "°C"), par: range(15, 25, "°C") });
    expect(texts(c)).toEqual(["NOR min 10 °C is below PAR min 15 °C", "NOR max 30 °C is above PAR max 25 °C"]);
    expect(c.findings.every((f) => f.level === "problem")).toBe(true);
    expect(texts(c).join(" ")).not.toMatch(/unacceptable|fail|reject|invalid/i);
  });

  it("compares only the ends that both ranges state", () => {
    expect(checkLimits({ nor: range(10, undefined, "°C"), par: range(undefined, 25, "°C") }).findings).toEqual([]);
    expect(texts(checkLimits({ nor: range(undefined, 26, "°C"), par: range(undefined, 25, "°C") }))).toEqual(["NOR max 26 °C is above PAR max 25 °C"]);
  });

  it("reports a set point outside the NOR, and outside the PAR only when there is no NOR", () => {
    expect(texts(checkLimits({ setPoint: { value: 30, unit: "°C", sourceIds: src }, nor: range(18, 22, "°C"), par: range(15, 35, "°C") }))).toEqual(["Set point 30 °C is above NOR max 22 °C"]);
    expect(texts(checkLimits({ setPoint: { value: 10, unit: "°C", sourceIds: src }, par: range(15, 25, "°C") }))).toEqual(["Set point 10 °C is below PAR min 15 °C"]);
    // With a NOR the set point is not also compared with the PAR.
    expect(checkLimits({ setPoint: { value: 20, unit: "°C", sourceIds: src }, nor: range(18, 22, "°C"), par: range(19, 21, "°C") }).findings.filter((f) => f.kind === "set_point_outside_par")).toEqual([]);
  });

  it("reports a range whose minimum is above its maximum", () => {
    const c = checkLimits({ par: range(30, 10, "rpm") });
    expect(c.findings.map((f) => f.kind)).toContain("range_order");
    expect(texts(c)[0]).toBe("PAR minimum 30 rpm is above its maximum 10 rpm");
  });

  it("says it cannot compare when units differ, and never converts", () => {
    const c = checkLimits({ nor: range(25, 35, "min"), par: range(0.4, 0.7, "h") });
    expect(texts(c)).toContain("NOR and PAR: cannot compare: units differ (min vs h)");
    expect(c.findings.filter((f) => f.kind === "nor_outside_par")).toEqual([]);
    const sp = checkLimits({ setPoint: { value: 20, unit: "°C", sourceIds: src }, nor: range(60, 80, "°F") });
    expect(texts(sp)).toContain("Set point and NOR: cannot compare: units differ (°C vs °F)");
    expect(sp.findings.map((f) => f.kind)).not.toContain("set_point_outside_nor");
  });

  it("treats a missing unit on one side as a difference, and no unit on both as comparable", () => {
    expect(texts(checkLimits({ nor: range(1, 2, undefined), par: range(0, 3, "bar") }))).toEqual(["NOR and PAR: cannot compare: units differ (no unit stated vs bar)"]);
    expect(checkLimits({ nor: range(1, 2, undefined), par: range(0, 3, undefined) }).findings).toEqual([]);
  });

  it("lists a missing citation as an open item, not an error", () => {
    const c = checkLimits({ setPoint: { value: 1, sourceIds: [] }, nor: range(1, 2, "bar", []), par: range(0, 3, "bar") });
    expect(c.findings.filter((f) => f.kind === "no_source").map((f) => [f.level, f.text])).toEqual([
      ["open", "NOR has no source cited"],
      ["open", "Set point has no source cited"],
    ]);
  });

  it("labels values copied from a TBD best guess as provisional", () => {
    const c = checkLimits({ setPoint: { value: 1, unit: "bar", provisional: true, sourceIds: src }, nor: { ...range(1, 2, "bar"), provisional: true } });
    expect(c.findings.filter((f) => f.kind === "provisional").map((f) => f.text)).toEqual([
      "NOR was copied from a provisional (TBD best guess) project value",
      "Set point was copied from a provisional (TBD best guess) project value",
    ]);
    expect(rangeText({ ...range(1, 2, "bar"), provisional: true })).toBe("1 to 2 bar (provisional)");
    expect(setPointText({ value: 1, unit: "bar", provisional: true, sourceIds: [] })).toBe("1 bar (provisional)");
  });

  it("writes ranges in words", () => {
    expect(rangeText(range(15, 25, "°C"))).toBe("15 to 25 °C");
    expect(rangeText(range(undefined, 25, "°C"))).toBe("up to 25 °C");
    expect(rangeText(range(15, undefined, "°C"))).toBe("from 15 °C");
    expect(rangeText(undefined)).toBe("");
  });
});
