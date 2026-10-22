import { describe, expect, it } from "vitest";
import { configToDraft, draftToConfig, emptyDraft, lookupCombos } from "../src/risk-draft";

describe("risk method draft", () => {
  it("an empty draft is never turned into a config: no default values", () => {
    for (const m of ["fmea", "matrix", "custom", "qualitative"] as const) {
      expect(draftToConfig(emptyDraft(m)).ok).toBe(false);
    }
  });

  it("an FMEA draft with scales becomes a config with no bands and no rule", () => {
    const d = emptyDraft("fmea");
    if (d.method !== "fmea") throw new Error();
    for (const s of [d.severity, d.occurrence, d.detection]) {
      s.min = "1";
      s.max = "5";
    }
    const r = draftToConfig(d);
    expect(r.ok && r.config.method === "fmea" && r.config.bands).toEqual([]);
    expect(r.ok && "severityTrigger" in r.config).toBe(false);
  });

  it("explains a backwards scale and a band without numbers in words", () => {
    const d = emptyDraft("fmea");
    if (d.method !== "fmea") throw new Error();
    for (const s of [d.severity, d.occurrence, d.detection]) {
      s.min = "5";
      s.max = "1";
    }
    const r = draftToConfig(d);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toContain("cannot start at 5 and end at 1");
    d.bands = [{ label: "Low", min: "", max: "", note: "" }];
    expect(draftToConfig(d).ok).toBe(false);
  });

  it("round-trips a matrix with its cell labels and drops unlabelled cells", () => {
    const d = emptyDraft("matrix");
    if (d.method !== "matrix") throw new Error();
    d.likelihood = [{ label: "Rare", description: "" }, { label: "Likely", description: "" }];
    d.severity = [{ label: "Minor", description: "" }];
    d.cells = [["Low"], [""]];
    const r = draftToConfig(d);
    expect(r.ok && r.config.method === "matrix" && r.config.cells).toEqual([{ row: 1, col: 1, label: "Low" }]);
    expect(r.ok && configToDraft(r.config)).toMatchObject({ cells: [["Low"], [""]] });
  });

  it("keeps the factor keys of a saved user-defined method and builds the lookup combinations", () => {
    const d = emptyDraft("custom");
    if (d.method !== "custom") throw new Error();
    d.factors[0] = { key: "impact", name: "Impact", scale: { min: "1", max: "2", levels: [] } };
    d.factors[1] = { key: "f2", name: "Frequency", scale: { min: "1", max: "3", levels: [] } };
    d.combine = "lookup";
    d.lookup = { "1,1": "A", "2,3": "B" };
    expect(lookupCombos(d.factors)).toHaveLength(6);
    const r = draftToConfig(d);
    expect(r.ok && r.config.method === "custom" && r.config.lookup).toEqual([{ levels: [1, 1], label: "A" }, { levels: [2, 3], label: "B" }]);
    expect(r.ok && r.config.method === "custom" && r.config.factors[0]!.key).toBe("impact");
  });
});
