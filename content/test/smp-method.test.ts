import { describe, expect, it, vi } from "vitest";
import { buildCmoInstructionsDocument, buildDemoProject, buildMbrDocument, buildSamplingPlanDocument, removePoint, updatePlan, type Block, type DocModel } from "@gap/engine";
import { planMethodReminders } from "@gap/sampling";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 60000 });

const GENERATED = "2026-10-01T00:00:00.000Z";
const ACTOR = { name: "Alex Example (fictional)", at: GENERATED };
const text = (d: DocModel): string => JSON.stringify(d.sections.flatMap((s) => s.blocks as Block[]));

describe("How each sample is taken: demos, reminders and documents", () => {
  for (const id of ["arx-217", "syr-305"] as const) {
    const project = buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
    const plan = project.sampling.plans[0]!;

    it(`${id}: every branch is shown and one point is left partly unanswered`, () => {
      const m = plan.points.map((p) => p.method).filter(Boolean);
      expect(m.some((x) => x!.access === "added_y_connector" && x!.added?.forStudyOnly === true)).toBe(true);
      expect(m.some((x) => x!.access === "shared_port" && x!.shared?.order && x!.shared.pointIds?.length)).toBe(true);
      expect(m.some((x) => x!.bag?.mixedFirst === true && x!.bag.mixingTime)).toBe(true);
      expect(m.some((x) => x!.flush?.volume && x!.flush.discardTo)).toBe(true);
      // The switch is off in the demos; the partly answered point still shows reminders because it was started.
      expect(plan.askSampleMethod).toBeUndefined();
      expect(planMethodReminders(plan).length).toBeGreaterThan(0);
    });

    it(`${id}: the plan, the CMO instructions and the batch record carry the answers and the open items`, () => {
      const planDoc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: GENERATED });
      const cmo = buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, { generatedAt: GENERATED });
      const mbr = buildMbrDocument(project, project.mbr.records[0]!, { generatedAt: GENERATED });
      expect(text(planDoc)).toContain("How the sample is taken");
      expect(planDoc.sections.map((x) => x.title)).toContain("Sampling method reminders");
      expect(text(cmo)).toContain("How the sample is taken:");
      expect(text(cmo)).toMatch(/Flush \d+ mL from the port to/);
      expect(text(mbr)).toMatch(/Flush \d+ mL from the port to|Discard the first/);
      // Reminders are not open items of the plan: the count in the header is unchanged by them.
      const noMethod = structuredClone(project);
      for (const p of noMethod.sampling.plans[0]!.points) delete p.method;
      expect(buildSamplingPlanDocument(content, noMethod, noMethod.sampling.plans[0]!, samplingSuggestions, { generatedAt: GENERATED }).tbdCount).toBe(planDoc.tbdCount);
    });
  }

  it("the plan switch asks every point, and removing a point takes it off the shared-port lists", () => {
    const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
    const plan = project.sampling.plans[0]!;
    const before = planMethodReminders(plan).length;
    const on = updatePlan(project, plan.id, { askSampleMethod: true }, ACTOR);
    expect(on.sampling.plans[0]!.askSampleMethod).toBe(true);
    expect(planMethodReminders(on.sampling.plans[0]!).length).toBeGreaterThan(before);
    const off = updatePlan(on, plan.id, { askSampleMethod: false }, ACTOR);
    expect(off.sampling.plans[0]!.askSampleMethod).toBeUndefined();
    const sharer = plan.points.find((p) => p.method?.shared?.pointIds?.length)!;
    const partner = sharer.method!.shared!.pointIds![0]!;
    const bare = structuredClone(project);
    bare.sampling.plans[0]!.subsections = [];
    const gone = removePoint(bare, plan.id, partner, ACTOR);
    expect(gone.sampling.plans[0]!.points.find((p) => p.id === sharer.id)!.method?.shared?.pointIds ?? []).not.toContain(partner);
  });
});
