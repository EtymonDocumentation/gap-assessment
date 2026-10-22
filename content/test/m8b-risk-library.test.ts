// Milestone 8 follow-up: updating an assessment from a newer library version. The engine only reports what would read differently
// (rescoreChanges) and logs why the method changed (setMethod note); the answers are never touched. All data are fictional.
import { addItem, buildDemoProject, createAssessment, rescoreChanges, setMethod, updateItem } from "@gap/engine";
import type { Actor, Project, RiskConfig } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, riskLoadouts } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "QA", at: "2026-10-22T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-23T10:00:00.000Z" };
const loadout = (id: string): RiskConfig => structuredClone(riskLoadouts.loadouts.find((l) => l.id === id)!.config);

/** An assessment with the FMEA 1-10 method and two scored items (RPN 36 and 240). */
function scored(): { project: Project; id: string } {
  const made = createAssessment(buildDemoProject(content, demos["arx-217"]), { title: "Fill-finish risk (fictional)" }, ACTOR);
  let project = setMethod(made.project, made.assessmentId, loadout("fmea-1-10"), ACTOR);
  for (const [fm, v] of [
    ["Leak", { severity: 4, occurrence: 3, detection: 3 }],
    ["Particle", { severity: 8, occurrence: 6, detection: 5 }],
  ] as const) {
    const a = addItem(project, made.assessmentId, { failureMode: fm }, ACTOR);
    project = updateItem(a.project, made.assessmentId, a.itemId, { initial: { values: { ...v } } }, ACTOR);
  }
  return { project, id: made.assessmentId };
}

describe("rescoreChanges: what a newer library version would do to the scores", () => {
  it("reports nothing when only the wording of a level changes", () => {
    const { project } = scored();
    const a = project.risk.assessments[0]!;
    const next = loadout("fmea-1-10");
    if (next.method !== "fmea") throw new Error();
    next.severity.levels = [{ value: 8, description: "Patient harm possible (fictional)" }];
    expect(rescoreChanges(a, next)).toEqual([]);
  });

  it("lists a score that lands in a new band and a score that no longer fits the scale", () => {
    const { project } = scored();
    const a = project.risk.assessments[0]!;
    const next = loadout("fmea-1-10");
    if (next.method !== "fmea") throw new Error();
    next.bands = [
      { label: "Lower (fictional)", minRpn: 1, maxRpn: 100 },
      { label: "Higher (fictional)", minRpn: 101, maxRpn: 1000 },
    ];
    next.detection = { min: 1, max: 4, levels: [] };
    const [first, second] = a.items;
    // 4 x 3 x 3 = 36 now has a band label; the second item has detection 5, outside the new 1 to 4 scale.
    expect(rescoreChanges(a, next)).toEqual([
      { itemId: first!.id, which: "initial", before: "36", after: "36 Lower (fictional)" },
      { itemId: second!.id, which: "initial", before: "240", after: "Not scored" },
    ]);
  });

  it("includes residual scores, skips empty scores, and says nothing without a method", () => {
    const { project, id } = scored();
    const a0 = project.risk.assessments[0]!;
    const withResidual = updateItem(project, id, a0.items[0]!.id, { residual: { values: { severity: 4, occurrence: 1, detection: 2 } } }, LATER);
    const a = withResidual.risk.assessments[0]!;
    const next = loadout("fmea-1-10");
    if (next.method !== "fmea") throw new Error();
    next.bands = [{ label: "All (fictional)", minRpn: 1, maxRpn: 1000 }];
    const changes = rescoreChanges(a, next);
    expect(changes.filter((c) => c.which === "residual")).toEqual([{ itemId: a.items[0]!.id, which: "residual", before: "8", after: "8 All (fictional)" }]);
    const bare = createAssessment(project, { title: "No method (fictional)" }, ACTOR);
    expect(rescoreChanges(bare.project.risk.assessments.at(-1)!, next)).toEqual([]);
  });
});

describe("setMethod with a note", () => {
  it("writes the reason into the change log and keeps the earlier method", () => {
    const { project, id } = scored();
    const next = loadout("fmea-1-10");
    if (next.method !== "fmea") throw new Error();
    next.libraryRef = { id: "lib-1", name: "QRM method (fictional)", version: "2" };
    const done = setMethod(project, id, next, LATER, { note: "Updated from the library: QRM method (fictional), version 1 to version 2" });
    const ev = done.changeLog.at(-1)!;
    expect(ev.action).toBe("risk_method_set");
    expect(ev.detail).toContain("Updated from the library: QRM method (fictional), version 1 to version 2");
    expect(ev.before).toMatchObject({ method: "fmea" });
    expect(done.risk.assessments[0]!.config?.libraryRef?.version).toBe("2");
    // The scores are still the person's own answers.
    expect(done.risk.assessments[0]!.items[0]!.initial.values).toEqual({ severity: 4, occurrence: 3, detection: 3 });
  });
});
