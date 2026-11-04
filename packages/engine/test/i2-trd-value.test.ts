import { parseTrdSynonyms, readValue } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, trdImportSynonyms } from "../../../content/index";

// Level 3 of the TRD upload (job I2): how a cell of another document is read into low / high / unit. The original text always stays.
describe("readValue: values with units and ranges", () => {
  it("reads a range written with a dash, with 'to' and with a unit on the end", () => {
    expect(readValue("2-8 °C")).toMatchObject({ kind: "range", low: 2, high: 8, unit: "°C", original: "2-8 °C" });
    expect(readValue("2 to 8 °C")).toMatchObject({ kind: "range", low: 2, high: 8, unit: "°C" });
    expect(readValue("2 – 8 °C")).toMatchObject({ kind: "range", low: 2, high: 8 });
    expect(readValue("between 20 and 40 min")).toMatchObject({ kind: "range", low: 20, high: 40, unit: "min" });
  });

  it("reads limits: NMT, NLT, <=, >=, and 'max'", () => {
    expect(readValue("NMT 24 h")).toMatchObject({ kind: "max", value: 24, unit: "h", strict: false });
    expect(readValue("≤ 30 min")).toMatchObject({ kind: "max", value: 30, unit: "min", strict: false });
    expect(readValue("NLT 4 h")).toMatchObject({ kind: "min", value: 4, unit: "h", strict: false });
    expect(readValue("≥ 2 bar")).toMatchObject({ kind: "min", value: 2, unit: "bar", strict: false });
    expect(readValue("24 h max")).toMatchObject({ kind: "max", value: 24, unit: "h" });
  });

  it("marks a strict limit, so the evidence can say the TRD keeps only the number", () => {
    expect(readValue("> 24 h")).toMatchObject({ kind: "min", value: 24, unit: "h", strict: true });
    expect(readValue("< 30 min")).toMatchObject({ kind: "max", value: 30, unit: "min", strict: true });
  });

  it("reads a single number, with or without a unit, and keeps the original text", () => {
    expect(readValue("5.0")).toMatchObject({ kind: "number", value: 5, original: "5.0" });
    expect(readValue("120 vials/min")).toMatchObject({ kind: "number", value: 120, unit: "vials/min" });
    expect(readValue("4.8 mL")).toMatchObject({ kind: "number", value: 4.8, unit: "mL" });
  });

  it("never converts a unit: two different units stay as written", () => {
    const v = readValue("30 min to 2 h");
    expect(v.kind === "range" ? [v.lowUnit, v.highUnit] : []).toEqual(["min", "h"]);
  });

  it("refuses a decimal comma and a plus-minus value instead of guessing", () => {
    expect(readValue("2,5 mL")).toMatchObject({ kind: "refused" });
    expect(readValue("0,1 mbar")).toMatchObject({ kind: "refused" });
    expect(readValue("20 ± 2 °C")).toMatchObject({ kind: "refused" });
  });

  it("tells a blank cell from a cell that is not a value", () => {
    expect(readValue("")).toMatchObject({ kind: "blank" });
    expect(readValue("n/a")).toMatchObject({ kind: "blank" });
    expect(readValue("Pass")).toMatchObject({ kind: "none" });
  });
});

describe("the synonyms list in content/", () => {
  it("is valid against the catalog and has the sections and columns the matcher needs", () => {
    expect(trdImportSynonyms.columns.map((c) => c.kind)).toEqual(expect.arrayContaining(["name", "set", "nor", "par", "unit", "low", "high", "limit", "hold", "time"]));
    expect(trdImportSynonyms.sections.length).toBeGreaterThan(1);
  });

  it("refuses a synonym that names a step or parameter the catalog does not have", () => {
    const ops = content.catalog.unitOperations.map((u) => u.key);
    const params = content.catalog.unitOperations.flatMap((u) => u.items.filter((i) => i.coll === "param").map((i) => ({ uo: u.key, key: i.key })));
    const good = JSON.parse(JSON.stringify(trdImportSynonyms));
    expect(() => parseTrdSynonyms(good, params, ops)).not.toThrow();
    expect(() => parseTrdSynonyms({ ...good, steps: [{ uo: "no_such_step", words: ["x"] }] }, params, ops)).toThrow(/unknown unit operation/);
    expect(() => parseTrdSynonyms({ ...good, parameters: [{ uo: ops[0], key: "no_such_key", words: ["x"] }] }, params, ops)).toThrow();
  });
});
