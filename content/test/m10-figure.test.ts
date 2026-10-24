// Milestone 10: the optional data behind the PPQ flow figures (step hours and text, holds, time targets, sub-processes, sample hours).
// Old plans load unchanged, the edit functions keep the plan valid and logged, removals clean up, and the prefill is only a suggestion.
// All data are fictional.
import {
  addFigureItem,
  addPoint,
  addStep,
  buildDemoProject,
  createPlan,
  figureTextSuggestions,
  holdSuggestions,
  removeFigureItem,
  removeStep,
  SamplingError,
  setPointFlow,
  setTimeZero,
  updateFigureItem,
  updatePoint,
  updateStep,
} from "@gap/engine";
import { parseProject, samplingPlanSchema, type Actor, type Project, type SamplingPlan } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, riskLoadouts, failureModes, samplingSuggestions } from "../index";

const demoProject = () => buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-06T09:00:00.000Z" };
const planOf = (p: Project, id: string): SamplingPlan => p.sampling.plans.find((x) => x.id === id)!;

function fixture() {
  const made = createPlan(
    buildDemoProject(content, demos["arx-217"]),
    { title: "Figure plan (fictional)", steps: [{ unitOp: "compounding", label: "Pooling and dilution" }, { unitOp: "sterile_filtration", label: "Sterile filtration" }, { unitOp: "aseptic_filling", label: "Filling" }] },
    ACTOR,
  );
  const plan = planOf(made.project, made.planId);
  return { project: made.project, planId: made.planId, steps: plan.steps.map((s) => s.id) };
}

describe("plan format 1.4.0", () => {
  it("an old plan (no figure fields) loads unchanged and is still valid", () => {
    const { project, planId } = fixture();
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, any>;
    raw.schemaVersion = "1.16.0";
    const migrated = parseProject(raw);
    const plan = planOf(migrated, planId);
    expect(plan.holds).toBeUndefined();
    expect(plan.timeTargets).toBeUndefined();
    expect(plan.subProcesses).toBeUndefined();
    expect(plan.steps.every((s) => s.durationHours === undefined && s.figureText === undefined)).toBe(true);
    expect(JSON.stringify(plan)).toBe(JSON.stringify(planOf(project, planId)));
    expect(samplingPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects references that point nowhere, and nothing else (no new completeness rules)", () => {
    const { project, planId, steps } = fixture();
    const plan = structuredClone(planOf(project, planId));
    const ok = { ...plan, holds: [{ id: "HD-001", afterStepId: steps[0], label: "Hold" }] };
    expect(samplingPlanSchema.safeParse(ok).success).toBe(true);
    expect(samplingPlanSchema.safeParse({ ...plan, holds: [{ id: "HD-001", afterStepId: "ST-99", label: "Hold" }] }).success).toBe(false);
    expect(samplingPlanSchema.safeParse({ ...plan, timeTargets: [{ id: "TT-001", label: "T", fromStepId: steps[0], fromEdge: "end", toStepId: "ST-99", toEdge: "end", comparator: ">=", hours: 5 }] }).success).toBe(false);
    expect(samplingPlanSchema.safeParse({ ...ok, holds: [ok.holds[0], ok.holds[0]] }).success).toBe(false);
    expect(samplingPlanSchema.safeParse({ ...plan, steps: plan.steps.map((s, i) => (i ? s : { ...s, subProcess: "SB-001" })) }).success).toBe(false);
    expect(samplingPlanSchema.safeParse({ ...plan, steps: plan.steps.map((s) => ({ ...s, durationHours: -1 })) }).success).toBe(false);
  });
});

describe("editing the figure data", () => {
  it("step hours and text are optional, trimmed and logged; null clears", () => {
    const { project, planId, steps } = fixture();
    const before = project.changeLog.length;
    let p = updateStep(project, planId, steps[0]!, { figureText: ["  Mix 30 min ", "", "Temp 5 C"], durationHours: 4 }, ACTOR);
    expect(planOf(p, planId).steps[0]).toMatchObject({ figureText: ["Mix 30 min", "Temp 5 C"], durationHours: 4 });
    expect(p.changeLog.length).toBe(before + 1);
    p = updateStep(p, planId, steps[0]!, { figureText: [], durationHours: null }, ACTOR);
    expect(planOf(p, planId).steps[0]!.figureText).toBeUndefined();
    expect(planOf(p, planId).steps[0]!.durationHours).toBeUndefined();
    expect(() => updateStep(p, planId, steps[0]!, { subProcess: "SB-001" }, ACTOR)).toThrow();
  });

  it("holds, time targets and sub-processes: add, edit, remove, each change-logged", () => {
    const { project, planId, steps } = fixture();
    let p = addFigureItem(project, planId, "holds", { afterStepId: steps[0]!, label: "Mixed hold", durationText: "22-24 h", durationHours: 24 }, ACTOR).project;
    expect(planOf(p, planId).holds![0]).toMatchObject({ id: "HD-001", label: "Mixed hold" });
    p = addFigureItem(p, planId, "timeTargets", { label: "Bulk target", fromStepId: steps[0]!, fromEdge: "end", toStepId: steps[2]!, toEdge: "end", comparator: ">=", hours: 100 }, ACTOR).project;
    const sb = addFigureItem(p, planId, "subProcesses", { label: "Buffer", feedsStepId: steps[1]! }, ACTOR);
    p = sb.project;
    expect(sb.itemId).toBe("SB-001");
    p = updateFigureItem(p, planId, "holds", "HD-001", { condition: "CRT", durationText: "" }, ACTOR);
    expect(planOf(p, planId).holds![0]).toMatchObject({ condition: "CRT" });
    expect(planOf(p, planId).holds![0]!.durationText).toBeUndefined();
    expect(() => addFigureItem(p, planId, "holds", { afterStepId: steps[0]!, label: "  " }, ACTOR)).toThrow(SamplingError);
    expect(() => addFigureItem(p, planId, "holds", { afterStepId: steps[0]!, label: "x", durationHours: -2 }, ACTOR)).toThrow(SamplingError);
    expect(() => addFigureItem(p, planId, "holds", { afterStepId: "ST-99", label: "x" }, ACTOR)).toThrow();
    const actions = p.changeLog.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["sampling_hold_add", "sampling_time_target_add", "sampling_sub_process_add", "sampling_hold_update"]));
    p = removeFigureItem(p, planId, "timeTargets", "TT-001", ACTOR);
    expect(planOf(p, planId).timeTargets).toBeUndefined();
  });

  it("a sample sits on a hold after its own step only; removing the hold keeps the sample on the step", () => {
    const { project, planId, steps } = fixture();
    let p = addFigureItem(project, planId, "holds", { afterStepId: steps[0]!, label: "Hold" }, ACTOR).project;
    const pt = addPoint(p, planId, { unitOp: "none", type: "hold_time", attribute: "A", flow: { stepId: steps[0]! } }, ACTOR);
    p = setPointFlow(pt.project, planId, pt.pointId, { stepId: steps[0]!, holdId: "HD-001" }, ACTOR);
    expect(planOf(p, planId).points[0]!.flow!.holdId).toBe("HD-001");
    expect(() => setPointFlow(p, planId, pt.pointId, { stepId: steps[1]!, holdId: "HD-001" }, ACTOR)).toThrow();
    p = updatePoint(p, planId, pt.pointId, { takenAtHour: 12.5 }, ACTOR);
    expect(planOf(p, planId).points[0]!.takenAtHour).toBe(12.5);
    p = removeFigureItem(p, planId, "holds", "HD-001", ACTOR);
    expect(planOf(p, planId).points[0]!.flow).toEqual({ stepId: steps[0] });
  });

  it("removing a step takes its holds and time targets with it and says so in the log", () => {
    const { project, planId, steps } = fixture();
    let p = addFigureItem(project, planId, "holds", { afterStepId: steps[1]!, label: "Hold" }, ACTOR).project;
    p = addFigureItem(p, planId, "timeTargets", { label: "T", fromStepId: steps[0]!, fromEdge: "end", toStepId: steps[1]!, toEdge: "start", comparator: "<=", hours: 8 }, ACTOR).project;
    p = addFigureItem(p, planId, "subProcesses", { label: "Buffer", feedsStepId: steps[1]! }, ACTOR).project;
    p = setTimeZero(p, planId, { stepId: steps[1]!, edge: "end" }, ACTOR);
    p = removeStep(p, planId, steps[1]!, ACTOR);
    const plan = planOf(p, planId);
    expect(plan.holds).toBeUndefined();
    expect(plan.timeTargets).toBeUndefined();
    expect(plan.timeZero).toBeUndefined();
    expect(plan.subProcesses![0]!.feedsStepId).toBeUndefined();
    expect(samplingPlanSchema.safeParse(plan).success).toBe(true);
    expect(JSON.stringify(p.changeLog.at(-1))).toContain("HD-001");
  });

  it("a step in a sub-process goes back to the main process when the sub-process is removed", () => {
    const { project, planId } = fixture();
    let p = addFigureItem(project, planId, "subProcesses", { label: "Buffer" }, ACTOR).project;
    const s = addStep(p, planId, { label: "Buffer prep" }, ACTOR);
    p = updateStep(s.project, planId, s.stepId, { subProcess: "SB-001" }, ACTOR);
    expect(planOf(p, planId).steps.find((x) => x.id === s.stepId)!.subProcess).toBe("SB-001");
    p = removeFigureItem(p, planId, "subProcesses", "SB-001", ACTOR);
    expect(planOf(p, planId).steps.find((x) => x.id === s.stepId)!.subProcess).toBeUndefined();
  });
});

describe("prefill suggestions (never written without a person accepting them)", () => {
  it("hold suggestions come from hold-time points; the plan is not changed", () => {
    const project = demoProject();
    const plan = project.sampling.plans[0]!;
    const before = JSON.stringify(plan);
    const sug = holdSuggestions(plan);
    for (const s of sug) expect(s.durationText.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).toBe(before);
  }, 60000);

  it("step text suggestions come from established project parameter values only", () => {
    const project = demoProject();
    const plan = project.sampling.plans[0]!;
    const before = JSON.stringify(project);
    const sug = figureTextSuggestions(content, project, plan);
    for (const lines of Object.values(sug)) expect(lines.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(project)).toBe(before);
  }, 60000);
});

describe("the demo plan", () => {
  it("carries fictional holds, time targets, hours and a buffer sub-process so both figures render", () => {
    const plan = demoProject().sampling.plans[0]!;
    expect(plan.holds!.length).toBeGreaterThanOrEqual(2);
    expect(plan.timeTargets!.length).toBeGreaterThanOrEqual(2);
    expect(plan.subProcesses![0]!.processingTarget).toBeDefined();
    expect(plan.steps.filter((s) => s.subProcess).length).toBe(2);
    expect(plan.points.some((p) => p.takenAtHour !== undefined)).toBe(true);
    expect(samplingPlanSchema.safeParse(plan).success).toBe(true);
  }, 60000);
});
