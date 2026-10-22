import { describe, expect, it } from "vitest";
import { emptyProject, parseProject, reportOnlyAllowed, samplingPlanSchema, samplingPointSchema, SCHEMA_VERSION, type Actor } from "../src/index";

const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };

const point = (over: Record<string, unknown> = {}) => ({
  id: "SP-001",
  origin: { kind: "manual" },
  category: "routine_ipc_release",
  unitOp: "aseptic_filling",
  attribute: "Fill weight",
  timing: { options: ["beginning"] },
  sampleSize: { inputs: {} },
  rationale: "",
  appliesTo: "all",
  sourceIds: [],
  createdAt: T0,
  updatedAt: T0,
  ...over,
});
const plan = (points: unknown[] = [], batches: unknown[] = [{ id: "B-001", label: "PPQ batch 1" }]) => ({
  id: "SPL-001",
  title: "Plan (fictional)",
  runType: "ppq",
  status: "draft",
  batches,
  batchRationale: "",
  points,
  createdAt: T0,
  updatedAt: T0,
});

describe("sampling plan schema", () => {
  it("accepts a point with nothing chosen: no method, no counts, no acceptance (nothing is defaulted)", () => {
    const p = samplingPointSchema.parse(point());
    expect(p.sampleSize.method).toBeUndefined();
    expect(p.locationsCount).toBeUndefined();
    expect(p.acceptance).toBeUndefined();
  });

  it("allows report only for characterization, supporting studies and other, and refuses it elsewhere", () => {
    for (const c of ["characterization", "supporting_study", "other"]) {
      expect(samplingPointSchema.safeParse(point({ category: c, acceptance: { kind: "report_only" } })).success).toBe(true);
      expect(reportOnlyAllowed(c as never)).toBe(true);
    }
    for (const c of ["routine_ipc_release", "ppq_enhanced"]) {
      const r = samplingPointSchema.safeParse(point({ category: c, acceptance: { kind: "report_only" } }));
      expect(r.success).toBe(false);
      expect(reportOnlyAllowed(c as never)).toBe(false);
    }
  });

  it("refuses duplicate ids and points that apply to a batch that is not in the plan", () => {
    expect(samplingPlanSchema.safeParse(plan([point(), point()])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([], [{ id: "B-001", label: "a" }, { id: "B-001", label: "b" }])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point({ appliesTo: ["B-009"] })])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point({ appliesTo: ["B-001"] })])).success).toBe(true);
  });

  it("has no default batch count: a plan may have no batches yet", () => {
    expect(samplingPlanSchema.parse(plan([], [])).batches).toEqual([]);
  });
});

describe("project schema 1.11.0", () => {
  const fresh = () => emptyProject({ title: "Sampling schema test (fictional)", actor: ACTOR, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } });

  it("starts a new project with no plans", () => {
    expect(SCHEMA_VERSION).toBe("1.11.0");
    expect(fresh().sampling).toEqual({ plans: [] });
  });

  it("migrates a 1.10.0 project by adding an empty plan list and keeps everything else", () => {
    const old = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    old.schemaVersion = "1.10.0";
    delete old.sampling;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.11.0");
    expect(p.sampling).toEqual({ plans: [] });
    expect(p.meta.title).toBe("Sampling schema test (fictional)");
  });

  it("round-trips a project that holds a plan", () => {
    const p = fresh();
    p.sampling.plans.push(samplingPlanSchema.parse(plan([point()])));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
