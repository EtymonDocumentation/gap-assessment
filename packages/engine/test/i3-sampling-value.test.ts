import { SAMPLING_TYPES } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { checkSamplingValue, parseSamplingImportSynonyms, readAmount, resolveSamplingType, SAMPLING_COLUMN_KINDS, timingFromText } from "../src";
import { samplingImportSynonyms as syn } from "../../../content/index";

describe("sampling import value rules (I3)", () => {
  it("reads an amount only with its unit, never converts, refuses a decimal comma and a range", () => {
    expect(readAmount("10 mL")).toEqual({ value: 10, unit: "mL" });
    expect(readAmount("0.5 L")).toEqual({ value: 0.5, unit: "L" });
    expect(readAmount("10")).toHaveProperty("reason");
    expect(readAmount("2,5 mL")).toHaveProperty("reason");
    expect(readAmount("5 to 10 mL")).toHaveProperty("reason");
    expect(readAmount("0 mL")).toHaveProperty("reason");
    expect(readAmount("a few")).toHaveProperty("reason");
  });
  it("finds a study type by the name of the tool, its key or a synonym, and only when it is unique", () => {
    expect(resolveSamplingType("IPC", syn)).toBe("ipc");
    expect(resolveSamplingType("Lot release", syn)).toBe("release");
    expect(resolveSamplingType("Release testing", syn)).toBe("release");
    expect(resolveSamplingType("hold_time", syn)).toBe("hold_time");
    expect(resolveSamplingType("something unclear", syn)).toBeUndefined();
    expect(resolveSamplingType("", syn)).toBeUndefined();
  });
  it("turns a timing made of position words into options, and keeps anything else word for word", () => {
    expect(timingFromText("Beginning, middle, end", syn)).toEqual({ options: ["beginning", "middle", "end"] });
    expect(timingFromText("start and end", syn)).toEqual({ options: ["beginning", "end"] });
    expect(timingFromText("Every 30 minutes", syn)).toEqual({ options: ["other"], other: "Every 30 minutes" });
  });
  it("explains why a text cannot be used and says nothing about free text", () => {
    expect(checkSamplingValue("amount", "10", syn)).toMatch(/unit/);
    expect(checkSamplingValue("type", "nonsense", syn)).toMatch(/study types/);
    expect(checkSamplingValue("attribute", "anything", syn)).toBeUndefined();
    expect(checkSamplingValue("amount", "", syn)).toBeUndefined();
  });
});

describe("the sampling synonyms list in content/ (I3)", () => {
  it("has a word list for every column of a sampling point and every study type", () => {
    expect(syn.columns.map((c) => c.kind).sort()).toEqual([...SAMPLING_COLUMN_KINDS].sort());
    expect(syn.types.map((t) => t.type).sort()).toEqual([...SAMPLING_TYPES].sort());
  });
  it("refuses a stray key and an unknown step", () => {
    const good = JSON.parse(JSON.stringify(syn));
    expect(() => parseSamplingImportSynonyms(good, ["a"])).not.toThrow();
    expect(() => parseSamplingImportSynonyms({ ...good, stray: 1 })).toThrow(/invalid/);
    expect(() => parseSamplingImportSynonyms({ ...good, steps: [{ uo: "nope", words: ["x"] }] }, ["a"])).toThrow(/unknown unit operation/);
  });
});
