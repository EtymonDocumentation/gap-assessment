import { describe, expect, it } from "vitest";
import {
  emptyProject,
  failureModeSuggestionsSchema,
  parseProject,
  riskAssessmentSchema,
  riskConfigSchema,
  riskLoadoutsSchema,
  riskScaleSchema,
  riskStateSchema,
  type Actor,
} from "../src/index";

const T0 = "2026-10-22T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "QA", at: T0 };
const scale = { min: 1, max: 10, levels: [] };
const fmeaConfig = { method: "fmea", severity: scale, occurrence: scale, detection: scale, bands: [] };
const item = (over: Record<string, unknown> = {}) => ({ id: "RA-001", failureMode: "Seal leak (fictional)", initial: { values: {} }, gapIds: [], samplingPointIds: [], sourceIds: [], createdAt: T0, updatedAt: T0, ...over });
const assessment = (over: Record<string, unknown> = {}) => ({ id: "RAS-001", title: "Fill-finish risk (fictional)", status: "draft", steps: [], items: [], actions: [], createdAt: T0, updatedAt: T0, ...over });

describe("risk shapes", () => {
  it("accepts an assessment with no method: there is no default", () => {
    const a = riskAssessmentSchema.parse(assessment());
    expect(a.method).toBeUndefined();
    expect(a.config).toBeUndefined();
  });

  it("accepts each method config and refuses a method that does not match its config", () => {
    expect(riskAssessmentSchema.safeParse(assessment({ method: "fmea", config: fmeaConfig })).success).toBe(true);
    expect(riskAssessmentSchema.safeParse(assessment({ method: "matrix", config: fmeaConfig })).success).toBe(false);
    expect(riskAssessmentSchema.safeParse(assessment({ method: "fmea" })).success).toBe(false);
  });

  it("refuses a scale that runs backwards or describes a level twice or outside the scale", () => {
    expect(riskScaleSchema.safeParse({ min: 5, max: 1, levels: [] }).success).toBe(false);
    expect(riskScaleSchema.safeParse({ min: 1, max: 5, levels: [{ value: 9, description: "x" }] }).success).toBe(false);
    expect(riskScaleSchema.safeParse({ min: 1, max: 5, levels: [{ value: 2, description: "x" }, { value: 2, description: "y" }] }).success).toBe(false);
  });

  it("limits a user-defined method to two to four factors with distinct keys", () => {
    const f = (key: string) => ({ key, name: key, scale });
    const base = { method: "custom", combine: "product", lookup: [], bands: [] };
    expect(riskConfigSchema.safeParse({ ...base, factors: [f("a")] }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ ...base, factors: [f("a"), f("b"), f("c"), f("d"), f("e")] }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ ...base, factors: [f("a"), f("a")] }).success).toBe(false);
    expect(riskConfigSchema.safeParse({ ...base, factors: [f("a"), f("b")] }).success).toBe(true);
  });

  it("refuses a matrix cell outside the grid", () => {
    const m = { method: "matrix", likelihood: [{ label: "L1" }], severity: [{ label: "S1" }], cells: [{ row: 2, col: 1, label: "x" }] };
    expect(riskConfigSchema.safeParse(m).success).toBe(false);
    expect(riskConfigSchema.safeParse({ ...m, cells: [{ row: 1, col: 1, label: "x" }] }).success).toBe(true);
  });

  it("refuses duplicate ids, a step that is not in the assessment and an action of an unknown item", () => {
    expect(riskAssessmentSchema.safeParse(assessment({ items: [item(), item()] })).success).toBe(false);
    expect(riskAssessmentSchema.safeParse(assessment({ items: [item({ stepId: "ST-01" })] })).success).toBe(false);
    expect(riskAssessmentSchema.safeParse(assessment({ steps: [{ id: "ST-01", label: "Filling" }], items: [item({ stepId: "ST-01" })] })).success).toBe(true);
    expect(riskAssessmentSchema.safeParse(assessment({ actions: [{ id: "AC-001", itemId: "RA-009", text: "x", status: "open" }] })).success).toBe(false);
  });

  it("keeps a residual score optional", () => {
    const a = riskAssessmentSchema.parse(assessment({ method: "fmea", config: fmeaConfig, items: [item()] }));
    expect(a.items[0]!.residual).toBeUndefined();
  });

  it("refuses the same assessment id twice", () => {
    expect(riskStateSchema.safeParse({ assessments: [assessment(), assessment()] }).success).toBe(false);
  });

  it("checks the catalog files strictly", () => {
    expect(riskLoadoutsSchema.safeParse({ catalog: { version: "1.0.0" }, loadouts: [{ id: "x", title: "X", description: "d", config: fmeaConfig, extra: 1 }] }).success).toBe(false);
    expect(failureModeSuggestionsSchema.safeParse({ catalog: { id: "c", version: "1" }, suggestions: [{ key: "Bad Key", unitOp: "aseptic_filling", failureMode: "f", effect: "e", causes: "c", rationale: "r" }] }).success).toBe(false);
  });
});

describe("project schema 1.14.0 (risk), read by 1.15.0", () => {
  const fresh = () => emptyProject({ title: "Risk schema test (fictional)", actor: ACTOR, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } });

  it("starts a new project with no assessment", () => {
    expect(fresh().risk).toEqual({ assessments: [] });
  });

  it("migrates a 1.13.0 project by adding an empty list and invents no assessment", () => {
    const old = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    old.schemaVersion = "1.13.0";
    delete old.risk;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.25.0");
    expect(p.risk).toEqual({ assessments: [] });
    expect(p.meta.title).toBe("Risk schema test (fictional)");
  });

  it("round-trips an assessment", () => {
    const p = fresh();
    p.risk = riskStateSchema.parse({ assessments: [assessment({ method: "fmea", config: fmeaConfig, items: [item()] })] });
    expect(parseProject(JSON.parse(JSON.stringify(p))).risk.assessments[0]!.items[0]!.id).toBe("RA-001");
  });
});
