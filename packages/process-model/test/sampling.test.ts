import { describe, expect, it } from "vitest";
import {
  categoryToType,
  emptyProject,
  parseProject,
  reportOnlyAllowed,
  samplingPlanSchema,
  samplingPointSchema,
  SAMPLING_TYPES,
  SCHEMA_VERSION,
  type Actor,
} from "../src/index";

const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };

const point = (over: Record<string, unknown> = {}) => ({
  id: "SP-001",
  origin: { kind: "manual" },
  type: "ipc",
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
const plan = (points: unknown[] = [], batches: unknown[] = [{ id: "B-001", label: "PPQ batch 1" }], extra: Record<string, unknown> = {}) => ({
  id: "SPL-001",
  title: "Plan (fictional)",
  runType: "ppq",
  status: "draft",
  steps: [],
  batches,
  batchRationale: "",
  parties: [],
  agencyRequests: [],
  points,
  subsections: [],
  createdAt: T0,
  updatedAt: T0,
  ...extra,
});
const request = (over: Record<string, unknown> = {}) => ({ id: "AR-001", agency: "Agency (fictional)", question: "Q", sourceIds: [], createdAt: T0, updatedAt: T0, ...over });
const subsection = (over: Record<string, unknown> = {}) => ({
  id: "CS-001",
  title: "Note",
  blocks: [{ type: "paragraph", text: "Text" }],
  placement: "appendix",
  order: 0,
  includeInCmo: false,
  origin: { kind: "manual" },
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

describe("sampling plan schema", () => {
  it("accepts a point with nothing chosen: no type, no method, no counts, no acceptance (nothing is defaulted)", () => {
    const p = samplingPointSchema.parse(point({ type: undefined }));
    expect(p.type).toBeUndefined();
    expect(p.sampleSize.method).toBeUndefined();
    expect(p.locationsCount).toBeUndefined();
    expect(p.acceptance).toBeUndefined();
  });

  it("allows report only for characterization, supporting studies, stability, commitments and other, and refuses it elsewhere", () => {
    for (const t of ["characterization", "supporting_study", "stability", "regulatory_commitment", "other"]) {
      expect(samplingPointSchema.safeParse(point({ type: t, acceptance: { kind: "report_only" } })).success).toBe(true);
      expect(reportOnlyAllowed(t as never)).toBe(true);
    }
    for (const t of ["ipc", "release", "ppq_enhanced", "mixing_homogeneity", "hold_time", "filter_study", "retain_reserve"]) {
      const r = samplingPointSchema.safeParse(point({ type: t, acceptance: { kind: "report_only" } }));
      expect(r.success).toBe(false);
      expect(reportOnlyAllowed(t as never)).toBe(false);
    }
    expect(reportOnlyAllowed(undefined)).toBe(false);
  });

  it("lists the twelve study types", () => {
    expect(SAMPLING_TYPES).toHaveLength(12);
  });

  it("maps the old category to a type and leaves routine in-process / release without one", () => {
    expect(categoryToType("routine_ipc_release")).toBeUndefined();
    expect(categoryToType("ppq_enhanced")).toBe("ppq_enhanced");
    expect(categoryToType("characterization")).toBe("characterization");
    expect(categoryToType("supporting_study")).toBe("supporting_study");
    expect(categoryToType("other")).toBe("other");
  });

  it("refuses duplicate ids and points that apply to a batch that is not in the plan", () => {
    expect(samplingPlanSchema.safeParse(plan([point(), point()])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([], [{ id: "B-001", label: "a" }, { id: "B-001", label: "b" }])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point({ appliesTo: ["B-009"] })])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point({ appliesTo: ["B-001"] })])).success).toBe(true);
  });

  it("refuses links to agency requests and placements that point at nothing", () => {
    expect(samplingPlanSchema.safeParse(plan([point({ agencyRequestIds: ["AR-009"] })])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point({ agencyRequestIds: ["AR-001"] })], undefined, { agencyRequests: [request()] })).success).toBe(true);
    expect(samplingPlanSchema.safeParse(plan([point()], undefined, { subsections: [subsection({ placement: "in_point:SP-009" })] })).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([point()], undefined, { subsections: [subsection({ placement: "in_point:SP-001" })] })).success).toBe(true);
    expect(samplingPlanSchema.safeParse(plan([], undefined, { subsections: [subsection({ placement: "in_study_type:nonsense" })] })).success).toBe(false);
    expect(samplingPlanSchema.safeParse(plan([], undefined, { subsections: [subsection(), subsection()] })).success).toBe(false);
  });

  it("has no default batch count: a plan may have no batches yet", () => {
    expect(samplingPlanSchema.parse(plan([], [])).batches).toEqual([]);
  });
});

describe("project schema 1.12.0", () => {
  const fresh = () => emptyProject({ title: "Sampling schema test (fictional)", actor: ACTOR, contentRefs: { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" } });

  it("starts a new project with no plans", () => {
    expect(SCHEMA_VERSION).toBe("1.17.0");
    expect(fresh().sampling).toEqual({ plans: [] });
  });

  it("migrates a 1.10.0 project by adding an empty plan list and keeps everything else", () => {
    const old = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    old.schemaVersion = "1.10.0";
    delete old.sampling;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.17.0");
    expect(p.sampling).toEqual({ plans: [] });
    expect(p.meta.title).toBe("Sampling schema test (fictional)");
  });

  it("migrates 1.11.0 plans: category becomes type, routine in-process / release becomes no type and is change-logged", () => {
    const old = JSON.parse(JSON.stringify(fresh())) as Record<string, any>;
    old.schemaVersion = "1.11.0";
    const oldPoint = (id: string, category: string, extra: Record<string, unknown> = {}) => {
      const { type: _t, ...p } = point({ id, category, ...extra }) as Record<string, unknown>;
      return p;
    };
    const oldPlan = plan([
      oldPoint("SP-001", "routine_ipc_release"),
      oldPoint("SP-002", "ppq_enhanced"),
      oldPoint("SP-003", "other", { categoryLabel: "Visual inspection study" }),
      oldPoint("SP-004", "characterization", { acceptance: { kind: "report_only" } }),
    ]) as Record<string, unknown>;
    delete oldPlan.parties;
    delete oldPlan.agencyRequests;
    delete oldPlan.subsections;
    old.sampling = { plans: [oldPlan] };
    const before = old.changeLog.length;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.17.0");
    const pts = p.sampling.plans[0]!.points;
    expect(pts[0]!.type).toBeUndefined();
    expect(pts[1]!.type).toBe("ppq_enhanced");
    expect(pts[2]!.type).toBe("other");
    expect(pts[2]!.typeLabel).toBe("Visual inspection study");
    expect(pts[3]!.type).toBe("characterization");
    expect("category" in pts[0]!).toBe(false);
    expect(p.sampling.plans[0]!.parties).toEqual([]);
    expect(p.sampling.plans[0]!.agencyRequests).toEqual([]);
    expect(p.sampling.plans[0]!.subsections).toEqual([]);
    // Exactly one conversion needs a person's decision, and it leaves a record with the old value.
    const added = p.changeLog.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.action).toBe("migrate_sampling_type");
    expect(added[0]!.path).toBe("sampling.SPL-001.SP-001");
    expect(added[0]!.before).toEqual({ category: "routine_ipc_release" });
    expect(added[0]!.detail).toMatch(/Choose in-process control or release/);
  });

  it("round-trips a project that holds a plan", () => {
    const p = fresh();
    p.sampling.plans.push(samplingPlanSchema.parse(plan([point()])));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
