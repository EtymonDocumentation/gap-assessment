// Milestone 7.2: the process flow of a sampling plan. Migration 1.12.0 -> 1.13.0, steps (add, reorder, remove with samples),
// the one-time copy from the project scope and its independence, flow placement, the points table order, and the suggestions
// being filtered to the plan's steps. All data are fictional.
import {
  acceptSuggestion,
  addPoint,
  addStep,
  buildDemoProject,
  copyStepsFromScope,
  createPlan,
  excludeStep,
  moveStep,
  projectScopeSteps,
  removeStep,
  SamplingError,
  setPointFlow,
  suggestPoints,
  updatePoint,
} from "@gap/engine";
import { parseProject, type Actor, type Project, type SamplingPlan } from "@gap/process-model";
import { NOT_ON_DIAGRAM, pointsAt, tableOrder, trayPoints, unitOpForStep } from "@gap/sampling";
import { describe, expect, it } from "vitest";
import { content, demos, samplingSuggestions } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-06T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-07T10:00:00.000Z" };

const blank = (): Project => buildDemoProject(content, demos["arx-217"]);
const planOf = (p: Project, id: string): SamplingPlan => p.sampling.plans.find((x) => x.id === id)!;

/** A plan with three catalog steps and one custom step, and four points: one per slot kind. */
function fixture() {
  let project = blank();
  const made = createPlan(project, { title: "Flow plan (fictional)", steps: [{ unitOp: "compounding", label: "Pooling, compounding and dilution" }, { unitOp: "sterile_filtration", label: "Sterile filtration" }, { unitOp: "aseptic_filling", label: "Aseptic filling and stoppering" }] }, ACTOR);
  project = made.project;
  const planId = made.planId;
  project = addStep(project, planId, { label: "Intermediate hold (fictional)" }, ACTOR).project;
  const steps = planOf(project, planId).steps;
  const add = (attribute: string, flow?: { stepId: string; at?: "before" | "during" | "after" }) => {
    const r = addPoint(project, planId, { unitOp: "none", type: "ipc", attribute, ...(flow ? { flow } : {}) }, ACTOR);
    project = r.project;
    return r.pointId;
  };
  const a = add("A", { stepId: steps[1]!.id, at: "after" });
  const b = add("B", { stepId: steps[1]!.id, at: "before" });
  const c = add("C", { stepId: steps[0]!.id });
  const d = add("D");
  return { project, planId, steps, ids: { a, b, c, d } };
}

describe("migration 1.12.0 -> 1.13.0", () => {
  it("builds the steps from the points' unit operations, in process order, with the position not set, and logs it", () => {
    const demo = blank();
    const withPlan = createPlan(demo, { title: "Old plan (fictional)" }, ACTOR);
    let project = withPlan.project;
    for (const [uo, attr] of [["aseptic_filling", "Fill weight"], ["compounding", "Blend"], ["finished_product", "Release"], ["aseptic_filling", "Second"]] as const) project = addPoint(project, withPlan.planId, { unitOp: uo, type: "ipc", attribute: attr }, ACTOR).project;
    const old = JSON.parse(JSON.stringify(project)) as Record<string, any>;
    old.schemaVersion = "1.12.0";
    for (const pl of old.sampling.plans) {
      delete pl.steps;
      for (const pt of pl.points) delete pt.flow;
    }
    const before = old.changeLog.length;
    const migrated = parseProject(old);
    expect(migrated.schemaVersion).toBe("1.26.0");
    const pl = migrated.sampling.plans.find((x) => x.id === withPlan.planId)!;
    expect(pl.steps.map((s) => s.unitOp)).toEqual(["compounding", "aseptic_filling"]);
    expect(pl.points.map((p) => p.flow?.stepId !== undefined)).toEqual([true, true, false, true]);
    expect(pl.points.every((p) => p.flow?.at === undefined)).toBe(true);
    expect(migrated.changeLog.slice(before).some((e) => e.action === "migrate_sampling_steps")).toBe(true);
  });
});

describe("steps", () => {
  it("add, reorder and refuse a doubled catalog step", () => {
    const { project, planId, steps } = fixture();
    expect(steps.map((s) => s.label)).toEqual(["Pooling, compounding and dilution", "Sterile filtration", "Aseptic filling and stoppering", "Intermediate hold (fictional)"]);
    expect(steps[3]!.unitOp).toBeUndefined();
    const up = moveStep(project, planId, steps[1]!.id, "up", LATER);
    expect(planOf(up, planId).steps.map((s) => s.id)).toEqual([steps[1]!.id, steps[0]!.id, steps[2]!.id, steps[3]!.id]);
    expect(up.changeLog.at(-1)!.action).toBe("sampling_step_move");
    // Moving the first step up changes nothing and logs nothing.
    expect(moveStep(project, planId, steps[0]!.id, "up", LATER)).toBe(project);
    expect(() => addStep(project, planId, { unitOp: "sterile_filtration", label: "Sterile filtration" }, ACTOR)).toThrow(SamplingError);
  });

  it("removing a step that holds samples is refused until the person chooses to move them; then they go to Not on the diagram", () => {
    const { project, planId, steps, ids } = fixture();
    expect(() => removeStep(project, planId, steps[1]!.id, LATER)).toThrow(/Choose to move them/);
    const after = removeStep(project, planId, steps[1]!.id, LATER, { movePointsToTray: true });
    const plan = planOf(after, planId);
    expect(plan.steps.map((s) => s.id)).not.toContain(steps[1]!.id);
    expect(plan.points).toHaveLength(4);
    expect(trayPoints(plan).map((p) => p.id).sort()).toEqual([ids.a, ids.b, ids.d].sort());
    const last = after.changeLog.at(-1)!;
    expect(last.action).toBe("sampling_step_remove");
    expect(last.detail).toContain(ids.a);
    // An empty step goes without the choice.
    expect(planOf(removeStep(project, planId, steps[3]!.id, LATER), planId).steps).toHaveLength(3);
  });
});

describe("flow placement", () => {
  it("moves a point between slots, steps and the tray, keeps the unit operation consistent and logs each move", () => {
    const { project, planId, steps, ids } = fixture();
    const slotPoint = planOf(project, planId).points.find((p) => p.id === ids.a)!;
    expect(slotPoint.unitOp).toBe("sterile_filtration");
    let p = setPointFlow(project, planId, ids.a, { stepId: steps[2]!.id, at: "during" }, LATER);
    let pt = planOf(p, planId).points.find((x) => x.id === ids.a)!;
    expect(pt.flow).toEqual({ stepId: steps[2]!.id, at: "during" });
    expect(pt.unitOp).toBe("aseptic_filling");
    expect(p.changeLog.at(-1)!.action).toBe("sampling_point_update");
    // Custom step: the unit operation is "custom_step".
    p = setPointFlow(p, planId, ids.a, { stepId: steps[3]!.id }, LATER);
    pt = planOf(p, planId).points.find((x) => x.id === ids.a)!;
    expect(pt.unitOp).toBe(unitOpForStep(steps[3]!));
    expect(pt.unitOp).toBe("custom_step");
    expect(pt.flow).toEqual({ stepId: steps[3]!.id });
    // The tray removes the flow.
    p = setPointFlow(p, planId, ids.a, null, LATER);
    pt = planOf(p, planId).points.find((x) => x.id === ids.a)!;
    expect(pt.flow).toBeUndefined();
    expect(trayPoints(planOf(p, planId)).map((x) => x.id)).toContain(ids.a);
  });

  it("refuses a flow that names a step the plan does not have", () => {
    const { project, planId, ids } = fixture();
    expect(() => setPointFlow(project, planId, ids.a, { stepId: "ST-999" }, LATER)).toThrow();
  });

  it("the points table lists diagram points by step order then slot, then the tray points", () => {
    const { project, planId, ids, steps } = fixture();
    const plan = planOf(project, planId);
    expect(tableOrder(plan).map((p) => p.id)).toEqual([ids.c, ids.b, ids.a, ids.d]);
    expect(pointsAt(plan, steps[1]!.id, "before").map((p) => p.id)).toEqual([ids.b]);
    // Reordering the steps reorders the table.
    const swapped = moveStep(project, planId, steps[1]!.id, "up", LATER);
    expect(tableOrder(planOf(swapped, planId)).map((p) => p.id)).toEqual([ids.b, ids.a, ids.c, ids.d]);
    expect(NOT_ON_DIAGRAM).toBe("Not on the diagram");
  });

  it("an extra sample added without a step is simply not on the diagram", () => {
    const { project, planId } = fixture();
    const r = addPoint(project, planId, { unitOp: "aseptic_filling", type: "other", attribute: "Extra" }, LATER);
    const pt = planOf(r.project, planId).points.find((p) => p.id === r.pointId)!;
    expect(pt.flow).toBeUndefined();
    expect(trayPoints(planOf(r.project, planId)).map((p) => p.id)).toContain(r.pointId);
  });
});

describe("the plan's steps and the project scope are independent", () => {
  it("copy replaces or appends, and editing one never changes the other", () => {
    const project0 = blank();
    const scope = projectScopeSteps(content, project0);
    expect(scope.length).toBeGreaterThan(3);
    const made = createPlan(project0, { title: "Copy plan (fictional)", steps: scope }, ACTOR);
    const planId = made.planId;
    expect(planOf(made.project, planId).steps.map((s) => s.unitOp)).toEqual(scope.map((s) => s.unitOp));

    // Removing a plan step leaves the project scope as it was.
    const first = planOf(made.project, planId).steps[0]!;
    const trimmed = removeStep(made.project, planId, first.id, LATER);
    expect(projectScopeSteps(content, trimmed).map((s) => s.unitOp)).toEqual(scope.map((s) => s.unitOp));
    expect(trimmed.stepScope).toEqual(made.project.stepScope);

    // Leaving a step out of the scope leaves the plan's steps as they were.
    const out = excludeStep(content, trimmed, scope[1]!.unitOp!, "Not part of this sampling plan (fictional)", LATER);
    expect(planOf(out, planId).steps).toEqual(planOf(trimmed, planId).steps);
    const newScope = projectScopeSteps(content, out);
    expect(newScope.map((s) => s.unitOp)).not.toContain(scope[1]!.unitOp);

    // Append puts back the missing scope steps at the end, without doubling those already there.
    const appended = copyStepsFromScope(out, planId, newScope, "append", LATER);
    const unitOps = planOf(appended, planId).steps.map((s) => s.unitOp);
    expect(new Set(unitOps).size).toBe(unitOps.length);
    expect(unitOps).toContain(first.unitOp);
    expect(appended.changeLog.at(-1)!.action).toBe("sampling_steps_copy");
    // Appending when nothing is missing changes nothing.
    expect(copyStepsFromScope(appended, planId, newScope, "append", LATER)).toBe(appended);

    // Replace follows the scope exactly; a custom step goes and its samples move to the tray.
    const withCustom = addStep(appended, planId, { label: "Hold (fictional)" }, LATER);
    const held = addPoint(withCustom.project, planId, { unitOp: "none", type: "ipc", flow: { stepId: withCustom.stepId } }, LATER);
    const replaced = copyStepsFromScope(held.project, planId, newScope, "replace", LATER);
    expect(planOf(replaced, planId).steps.map((s) => s.unitOp)).toEqual(newScope.map((s) => s.unitOp));
    expect(planOf(replaced, planId).points.find((p) => p.id === held.pointId)!.flow).toBeUndefined();
    // The gap scope is still what it was.
    expect(replaced.stepScope).toEqual(out.stepScope);
  });
});

describe("suggestions follow the plan's steps", () => {
  it("offers only the plan's steps and the not-step-bound ones; a step left out of the gap scope is still offered when the plan has it", () => {
    const made = createPlan(blank(), { title: "Filter plan (fictional)", steps: [{ unitOp: "sterile_filtration", label: "Sterile filtration" }] }, ACTOR);
    const plan = planOf(made.project, made.planId);
    const list = suggestPoints(content, made.project, samplingSuggestions, plan);
    expect(list.length).toBeGreaterThan(0);
    const allowed = new Set(["sterile_filtration", "finished_product", "none"]);
    expect(list.every((s) => allowed.has(s.uo))).toBe(true);
    expect(list.some((s) => s.uo === "sterile_filtration")).toBe(true);
    expect(list.some((s) => s.uo === "aseptic_filling")).toBe(false);

    // The gap scope leaves the step out; the plan still has it, so its candidates stay.
    const out = excludeStep(content, made.project, "sterile_filtration", "Left out of the gap scope (fictional)", LATER);
    const again = suggestPoints(content, out, samplingSuggestions, planOf(out, made.planId));
    expect(again.some((s) => s.uo === "sterile_filtration")).toBe(true);

    // Accepting one puts the point on the plan's matching step, position not set.
    const s = list.find((x) => x.uo === "sterile_filtration" && !x.added)!;
    const accepted = acceptSuggestion(made.project, made.planId, s, LATER);
    const pt = planOf(accepted.project, made.planId).points.at(-1)!;
    expect(pt.flow).toEqual({ stepId: plan.steps[0]!.id });
    // A suggestion for a step the plan does not have goes to the tray.
    const other = suggestPoints(content, made.project, samplingSuggestions, plan).find((x) => x.uo === "none" && !x.added);
    if (other) {
      const a2 = acceptSuggestion(made.project, made.planId, other, LATER);
      expect(planOf(a2.project, made.planId).points.at(-1)!.flow).toBeUndefined();
    }
  });

  it("editing a point's type keeps it on its step", () => {
    const { project, planId, ids } = fixture();
    const after = updatePoint(project, planId, ids.a, { type: "release" }, LATER);
    expect(planOf(after, planId).points.find((p) => p.id === ids.a)!.flow).toEqual(planOf(project, planId).points.find((p) => p.id === ids.a)!.flow);
  });
});
