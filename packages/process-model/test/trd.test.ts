import { describe, expect, it } from "vitest";
import { emptyProject, parseProject, SCHEMA_VERSION, TRD_BASIS_LOADOUTS, TRD_FORMAT_VERSION, TRD_SOURCE_DOC_TYPES, trdDocumentSchema, trdOverrideSchema, trdRangeSchema, trdStateSchema, type Actor } from "../src/index";

const T0 = "2026-10-23T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT", at: T0 };
const fresh = () => emptyProject({ title: "TRD schema test (fictional)", actor: ACTOR, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } });
const doc = (over: Record<string, unknown> = {}) => ({ id: "TRD-001", title: "Test TRD (fictional)", status: "draft", origin: { kind: "blank", importedAt: T0 }, details: [], steps: [], createdAt: T0, updatedAt: T0, ...over });
const step = (over: Record<string, unknown> = {}) => ({ id: "TS-01", label: "Sterile filtration", custom: false, fields: [], items: [], ...over });

describe("TRD schema (project schema 1.15.0)", () => {
  it("is version 1.15.0 and TRD format 1.0.0", () => {
    expect(SCHEMA_VERSION).toBe("1.15.0");
    expect(TRD_FORMAT_VERSION).toBe("1.0.0");
  });

  it("starts a new project with no TRD", () => {
    expect(fresh().trd).toEqual({ documents: [] });
  });

  it("migrates a 1.14.0 project by adding an empty list and invents no TRD", () => {
    const old = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    old.schemaVersion = "1.14.0";
    delete old.trd;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.15.0");
    expect(p.trd).toEqual({ documents: [] });
    expect(p.meta.title).toBe("TRD schema test (fictional)");
  });

  it("keeps a TRD that is already there when migrating", () => {
    const raw = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    raw.schemaVersion = "1.14.0";
    raw.trd = { documents: [doc()] };
    expect(parseProject(raw).trd.documents).toHaveLength(1);
  });

  it("round-trips a TRD with an override and limits", () => {
    const p = fresh();
    const item = {
      collection: "param",
      key: "temperature",
      label: "Temperature",
      custom: false,
      fields: [{ key: "setPoint", label: "Set point", pulled: { status: "established", value: { value: 20, unit: "°C" }, display: "20 °C", sourceIds: ["s1"] }, override: { status: "established", display: "21", unit: "°C", by: "Alex", at: T0 } }],
      limits: { nor: { min: 18, max: 22, unit: "°C", sourceIds: ["s1"], locations: { s1: { section: "5.1", page: "12" } }, basis: "Internal technical report" } },
    };
    p.trd = trdStateSchema.parse({ documents: [doc({ steps: [step({ items: [item] })] })] });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back.trd.documents[0]!.steps[0]!.items[0]!.limits!.nor!.basis).toBe("Internal technical report");
  });

  it("accepts an override without a reason (the output says 'No reason recorded')", () => {
    expect(trdOverrideSchema.safeParse({ status: "established", display: "5", by: "a", at: T0 }).success).toBe(true);
  });

  it("refuses an override that breaks the no-defaults rule", () => {
    expect(trdOverrideSchema.safeParse({ status: "established", by: "a", at: T0 }).success).toBe(false);
    expect(trdOverrideSchema.safeParse({ status: "not_established", display: "5", by: "a", at: T0 }).success).toBe(false);
    expect(trdOverrideSchema.safeParse({ status: "tbd", display: "5", by: "a", at: T0 }).success).toBe(true);
  });

  it("refuses a range with neither end", () => {
    expect(trdRangeSchema.safeParse({ sourceIds: [] }).success).toBe(false);
    expect(trdRangeSchema.safeParse({ max: 3, sourceIds: [] }).success).toBe(true);
  });

  it("refuses duplicate TRD ids, step ids and items", () => {
    expect(trdStateSchema.safeParse({ documents: [doc(), doc()] }).success).toBe(false);
    expect(trdDocumentSchema.safeParse(doc({ steps: [step(), step()] })).success).toBe(false);
    const it = { collection: "equip", key: "a", label: "A", custom: false, fields: [] };
    expect(trdDocumentSchema.safeParse(doc({ steps: [step({ items: [it, it] })] })).success).toBe(false);
  });

  it("offers the basis and document-type load-outs as suggestions only", () => {
    expect(TRD_BASIS_LOADOUTS).toContain("Confirmed by PPQ summary report");
    expect(TRD_SOURCE_DOC_TYPES).toEqual(["PPQ summary report", "Process development report", "Characterization study report", "Internal technical report"]);
    // The basis is free text: a value that is not a load-out is valid.
    expect(trdRangeSchema.safeParse({ min: 1, sourceIds: [], basis: "Vendor letter (fictional)" }).success).toBe(true);
  });

  it("accepts the TRD export formats in the export history", () => {
    const p = fresh();
    p.document.exports.push({ at: T0, format: "trd-docx", template: { mode: "builtin", name: "Built-in", version: "1" }, fingerprint: "abc" } as never);
    expect(parseProject(JSON.parse(JSON.stringify(p))).document.exports[0]!.format).toBe("trd-docx");
  });
});
