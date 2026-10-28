import { assess, buildDemoProject, setStepsExcluded, stepGroups } from "@gap/engine";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "@gap/content";
import { emptyProject } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { nextStep, scopeRecorded, stepDone } from "../src/next-step";

const blank = () => emptyProject({ title: "Test project", actor: { name: "Tester", at: "2026-01-01T00:00:00.000Z" }, contentRefs: content.versions });
const demo = (id: keyof typeof demos) =>
  buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });

describe("next step on the Home page", () => {
  it("offers the scope first on a fresh project, and shows no tick for it", () => {
    const p = blank();
    const a = assess(content, p);
    expect(scopeRecorded(p)).toBe(false);
    expect(nextStep(p, a)).toMatchObject({ path: "/scope", label: "Choose the scope" });
    expect(stepDone(p, a)).toEqual({});
  });

  it("offers the interview once the scope is recorded, with a count that follows the number of open questions", () => {
    let p = blank();
    const uo = stepGroups(content, p)[0]!.steps.find((s) => s.state === "included")!.uo;
    p = setStepsExcluded(content, p, [uo], true, undefined, { name: "Tester", at: "2026-01-02T00:00:00.000Z" });
    const a = assess(content, p);
    const n = nextStep(p, a);
    expect(n.path).toBe("/interview");
    expect(n.label).toMatch(/^Answer \d+ more questions?$/);
    expect(stepDone(p, a).scope).toBe(true);
    expect(stepDone(p, a).interview).toBeUndefined();
  });

  it("sends an opened demo to the gap register once every question is answered, and ticks the interview but never the register or document", () => {
    const p = demo("syr-305");
    const a = assess(content, p);
    const n = nextStep(p, a);
    // The demo's answers are replayed through the interview, so the interview is complete and the next step is the register.
    expect(n.path).toBe("/register");
    expect(stepDone(p, a).interview).toBe(true);
    expect(stepDone(p, a).register).toBeUndefined();
    expect(stepDone(p, a).document).toBeUndefined();
  }, 30000);
});
