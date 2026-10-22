// Milestone 7.2 part B: the pure helpers behind the short form, wizard and "More details" groups. All data are fictional.
import { addPoint, buildDemoProject, catalogInsertIndex, createPlan, updatePoint } from "@gap/engine";
import type { Actor, SamplingPoint, SamplingType } from "@gap/process-model";
import { POINT_GROUPS, checkPoint, groupSummary, initialOpenGroups, toFillText, typeChangeHidesValues, wizardPatch, WIZARD_FIELDS } from "@gap/sampling";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-06T09:00:00.000Z" };

function fixture(type: SamplingType) {
  const made = createPlan(buildDemoProject(content, demos["arx-217"]), { title: "Add plan (fictional)", steps: [] }, ACTOR);
  const added = addPoint(made.project, made.planId, { unitOp: "none", type, attribute: "Assay (fictional)" }, ACTOR);
  const plan = added.project.sampling.plans.find((p) => p.id === made.planId)!;
  return { project: added.project, planId: made.planId, plan, point: plan.points[0]! };
}

describe("catalogInsertIndex", () => {
  const seqs = content.catalog.unitOperations.slice().sort((a, b) => a.sequence - b.sequence);
  it("puts a step among catalog steps by process order, and at the end when nothing is later", () => {
    const [a, b, c] = [seqs[0]!.key, seqs[1]!.key, seqs[2]!.key];
    expect(catalogInsertIndex(content, [{ unitOp: a }, { unitOp: c }], b)).toBe(1);
    expect(catalogInsertIndex(content, [{ unitOp: a }], c)).toBe(1);
    expect(catalogInsertIndex(content, [{ unitOp: c }], a)).toBe(0);
    expect(catalogInsertIndex(content, [], a)).toBe(0);
  });
  it("lets custom steps keep their place and appends an unknown key", () => {
    const [a, b] = [seqs[0]!.key, seqs[1]!.key];
    expect(catalogInsertIndex(content, [{}, { unitOp: b }], a)).toBe(1);
    expect(catalogInsertIndex(content, [{ unitOp: a }], "no_such_step")).toBe(1);
  });
});

describe("groups", () => {
  it("every open item of checkPoint sits in exactly one group", () => {
    const { plan, point } = fixture("mixing_homogeneity");
    const c = checkPoint(plan, point);
    const all = POINT_GROUPS.flatMap((g) => c.byGroup[g]);
    expect(all.length).toBe(c.problems.length);
    expect(new Set(all)).toEqual(new Set(c.problems));
  });
  it("opens only the first group that has something to fill", () => {
    expect(initialOpenGroups({ type: [], sampling: [], testing: ["x"], acceptance: ["y"], reporting: [], sources: [] }, POINT_GROUPS)).toEqual(["testing"]);
    expect(initialOpenGroups({ type: [], sampling: [], testing: [], acceptance: [], reporting: [], sources: [] }, POINT_GROUPS)).toEqual([]);
  });
  it("says counts in words and an empty group as nothing entered", () => {
    expect(toFillText(0)).toBe("Nothing open");
    expect(toFillText(3)).toBe("3 to fill");
    const { point } = fixture("ipc");
    expect(groupSummary(point, "sources")).toBe("Nothing entered yet");
    expect(groupSummary(point, "testing")).toContain("Assay (fictional)");
  });
});

describe("type change", () => {
  it("asks only when the old type's group holds a value, and not between types sharing a group", () => {
    const { project, planId, point } = fixture("mixing_homogeneity");
    expect(typeChangeHidesValues(point, "ipc")).toBe(false);
    const filled = updatePoint(project, planId, point.id, { detail: { mixing: { vesselRef: "Tank 1 (fictional)" } } }, ACTOR);
    const p = filled.sampling.plans[0]!.points.find((x) => x.id === point.id) as SamplingPoint;
    expect(typeChangeHidesValues(p, "ipc")).toBe(true);
    expect(typeChangeHidesValues(p, "mixing_homogeneity")).toBe(false);
    expect(typeChangeHidesValues({ type: "characterization", detail: { analyses: { informs: "x" } } }, "supporting_study")).toBe(false);
  });
});

describe("wizardPatch", () => {
  it("leaves blank answers out and trims the rest", () => {
    expect(wizardPatch("ipc", {})).toEqual({});
    const patch = wizardPatch("hold_time", { "hold.start": "  after pooling ", "hold.end": "   " });
    expect(patch).toEqual({ detail: { hold: { start: "after pooling" } } });
  });
  it("routes the other-type label to typeLabel and keeps multi-choices as lists", () => {
    expect(wizardPatch("other", { typeLabel: "Visual check" })).toEqual({ typeLabel: "Visual check" });
    expect(wizardPatch("mixing_homogeneity", { "mixing.positions": ["top"] })).toEqual({ detail: { mixing: { positions: ["top"] } } });
  });
  it("offers no preselected answer for any type", () => {
    for (const fields of Object.values(WIZARD_FIELDS)) for (const f of fields) expect("default" in f).toBe(false);
  });
});
