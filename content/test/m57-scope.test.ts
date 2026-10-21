// Milestone 5.7: the Scope step. Stage groups, leaving whole process steps (unit operations) out of the assessment on both
// sides, the not-applicable reading of the answers, and the document that says what was left out. All data are fictional.
import {
  assess,
  buildDemoProject,
  buildDocument,
  buildValidationPlan,
  changeLogView,
  dependsOnReason,
  excludeStep,
  includeStep,
  inactiveEntries,
  isStepExcluded,
  notApplicableReason,
  progress,
  ScopeError,
  setStepsExcluded,
  stepExclusions,
  stepGroups,
  stepSummary,
  visibleInstances,
  type DocModel,
} from "@gap/engine";
import { emptyProject, parseProject, type Actor, type Project } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-04T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-05T10:30:00.000Z" };
const GENERATED = "2026-10-06T00:00:00.000Z";

const demo = buildDemoProject(content, demos["arx-217"]);
const ids = (p: Project) => new Set(visibleInstances(content, p, "paired").map((i) => i.question.id));
const docOf = (p: Project): DocModel => buildDocument(content, p, assess(content, p), GENERATED);
const scopeMd = (d: DocModel) => renderMarkdown({ ...d, sections: d.sections.filter((s) => s.id === "scope") });

/** Aseptic filling is always applicable and has recorded values in the demo. */
const UO = "aseptic_filling";
const FILLING_PRESENCE = "fill.presence";

describe("stage groups", () => {
  it("put every unit operation in exactly one group, in process order", () => {
    const all = content.catalog.stageGroups.flatMap((g) => g.unitOperations);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(content.catalog.unitOperations.map((u) => u.key).sort());
    const seq = (k: string) => content.catalog.unitOperations.find((u) => u.key === k)!.sequence;
    const firsts = content.catalog.stageGroups.map((g) => seq(g.unitOperations[0]!));
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  it("are reported with a state for each step, all included on a new project unless the answers rule a step out", () => {
    const groups = stepGroups(content, demo);
    expect(groups.map((g) => g.key)).toEqual(content.catalog.stageGroups.map((g) => g.key));
    const steps = groups.flatMap((g) => g.steps);
    expect(steps).toHaveLength(content.catalog.unitOperations.length);
    expect(steps.some((s) => s.state === "excluded")).toBe(false);
    // No default: nothing is left out unless a person chose it.
    expect(demo.stepScope).toEqual({ excluded: [] });
  });
});

describe("leaving a process step out", () => {
  const off = excludeStep(content, demo, UO, "The program does not fill at this site (fictional)", ACTOR);

  it("stores who, when and the optional reason, and is change-logged", () => {
    expect(off.stepScope.excluded).toEqual([{ uo: UO, reason: "The program does not fill at this site (fictional)", by: ACTOR.name, at: ACTOR.at }]);
    expect(isStepExcluded(off, UO)).toBe(true);
    expect(isStepExcluded(demo, UO)).toBe(false);
    expect(off.changeLog.at(-1)).toMatchObject({ action: "scope_exclude_uo", by: ACTOR.name, path: `uo.${UO}` });
    expect(off.changeLog.at(-1)!.detail).toMatch(/Aseptic filling/);
    expect(changeLogView(content, off).find((r) => r.action === "scope_exclude_uo")!.actionLabel).toBe("Process step left out (scope)");
  });

  it("accepts no reason: nothing is invented, and the log says so", () => {
    const blank = excludeStep(content, demo, UO, "   ", ACTOR);
    expect(blank.stepScope.excluded[0]!.reason).toBeUndefined();
    expect(blank.changeLog.at(-1)!.detail).toContain("No reason recorded");
  });

  it("refuses an unknown step and a step that is already out", () => {
    expect(() => excludeStep(content, demo, "no_such_step", undefined, ACTOR)).toThrow(ScopeError);
    expect(() => excludeStep(content, off, UO, undefined, ACTOR)).toThrow(/already left out/);
    expect(() => includeStep(content, demo, UO, ACTOR)).toThrow(/not left out/);
  });

  it("does not change the project it was given", () => {
    expect(demo.stepScope.excluded).toEqual([]);
    expect(demo.changeLog.some((c) => c.action === "scope_exclude_uo")).toBe(false);
  });

  it("removes the step's questions from the interview and its section from the progress", () => {
    expect(ids(demo).has(FILLING_PRESENCE)).toBe(true);
    expect(ids(off).has(FILLING_PRESENCE)).toBe(false);
    const sections = (p: Project) => progress(content, p, visibleInstances(content, p, "paired")).map((s) => s.section.uo);
    expect(sections(demo)).toContain(UO);
    expect(sections(off)).not.toContain(UO);
  });

  it("removes the step from gaps, the validation plan and the document, on both sides", () => {
    const gapsOf = (p: Project) => assess(content, p).gaps.filter((g) => g.path.startsWith(`uo.${UO}.`));
    expect(gapsOf(demo).length).toBeGreaterThan(0);
    expect(gapsOf(off)).toHaveLength(0);
    const planKeys = (p: Project) => buildValidationPlan(content, p).flatMap((r) => r.gaps.map((g) => g.key));
    expect(planKeys(demo).some((k) => k.includes(`uo.${UO}.`))).toBe(true);
    expect(planKeys(off).some((k) => k.includes(`uo.${UO}.`))).toBe(false);
    const text = (p: Project) => JSON.stringify(docOf(p).sections.filter((s) => s.id === "gap-table" || s.id === "differences"));
    expect(text(demo)).toContain("Aseptic filling");
    expect(text(off)).not.toContain("Aseptic filling");
  });

  it("keeps the recorded values as inactive entries, and restores everything when ticked again", () => {
    const inactive = inactiveEntries(off, visibleInstances(content, off, "paired")).map((e) => e.path);
    expect(inactive.some((p) => p.includes(`uo.${UO}.`))).toBe(true);
    expect(off.processes).toEqual(demo.processes);
    const back = includeStep(content, off, UO, LATER);
    expect(back.stepScope.excluded).toEqual([]);
    expect(back.processes).toEqual(demo.processes);
    expect(assess(content, back).gaps.map((g) => g.key)).toEqual(assess(content, demo).gaps.map((g) => g.key));
    expect(ids(back).has(FILLING_PRESENCE)).toBe(true);
    expect(back.changeLog.slice(-2).map((c) => c.action)).toEqual(["scope_exclude_uo", "scope_include_uo"]);
  });

  it("counts the recorded values that are kept", () => {
    const info = stepGroups(content, off).flatMap((g) => g.steps).find((s) => s.uo === UO)!;
    expect(info.state).toBe("excluded");
    expect(info.answerCount).toBeGreaterThan(0);
    expect(info.exclusion).toMatchObject({ by: ACTOR.name, reason: "The program does not fill at this site (fictional)" });
  });

  it("a group tick leaves out several steps, one change-log entry each, and puts them back", () => {
    const group = content.catalog.stageGroups.find((g) => g.unitOperations.includes(UO))!;
    const all = setStepsExcluded(content, demo, group.unitOperations, true, "Not in this program (fictional)", ACTOR);
    expect(all.stepScope.excluded.map((e) => e.uo)).toEqual(group.unitOperations);
    expect(all.changeLog.filter((c) => c.action === "scope_exclude_uo")).toHaveLength(group.unitOperations.length);
    const back = setStepsExcluded(content, all, group.unitOperations, false, undefined, LATER);
    expect(back.stepScope.excluded).toEqual([]);
  });

  it("is summarised as steps in scope out of the steps a person can choose", () => {
    const total = content.catalog.unitOperations.length;
    const s0 = stepSummary(content, demo);
    expect(s0.included + s0.notApplicable).toBe(total);
    const s1 = stepSummary(content, off);
    expect(s1.included).toBe(s0.included - 1);
    expect(s1.selectable).toBe(s0.selectable);
  });

  it("survives a file round trip", () => {
    expect(parseProject(JSON.parse(JSON.stringify(off)))).toEqual(off);
  });
});

describe("not applicable, from the answers", () => {
  it("names the answer that rules the step out, and links to its question", () => {
    // The demo is a liquid product, so lyophilization does not apply.
    const na = notApplicableReason(content, demo, "lyophilization");
    expect(na).toBeDefined();
    expect(na!.text).toMatch(/^Not applicable: .*Liquid/i);
    expect(na!.questionKey).toMatch(/^[a-z_.0-9]+@(shared|source)$/);
    expect(notApplicableReason(content, demo, UO)).toBeUndefined();
  });

  it("shows such a step as not applicable, not as a choice", () => {
    const step = stepGroups(content, demo).flatMap((g) => g.steps).find((s) => s.uo === "lyophilization")!;
    expect(step.state).toBe("not_applicable");
    expect(step.notApplicable!.text).toMatch(/^Not applicable: /);
  });

  it("never calls a step not applicable while its scoping question is unanswered: it stays in scope and names the question", () => {
    const blank = emptyProject({ title: "Blank (fictional)", actor: ACTOR, contentRefs: content.versions });
    const steps = stepGroups(content, blank).flatMap((g) => g.steps);
    // Nothing is answered, so nothing can be ruled out by an answer.
    expect(steps.filter((s) => s.state === "not_applicable")).toEqual([]);
    expect(stepSummary(content, blank).notApplicable).toBe(0);
    const lyo = steps.find((s) => s.uo === "lyophilization")!;
    expect(lyo.state).toBe("included");
    expect(lyo.dependsOn!.text).toMatch(/^Depends on an unanswered question: /);
    expect(lyo.dependsOn!.questionKey).toMatch(/@(shared|source)$/);
    expect(notApplicableReason(content, blank, "lyophilization")).toBeUndefined();
    expect(dependsOnReason(content, blank, "lyophilization")).toEqual(lyo.dependsOn);
    // Once the question is answered the answer decides: the demo is liquid, so lyophilization is not applicable.
    expect(dependsOnReason(content, demo, "lyophilization")).toBeUndefined();
  });

  it("an excluded step is shown as left out even when the answers also rule it out", () => {
    const p = excludeStep(content, demo, "lyophilization", undefined, ACTOR);
    expect(stepGroups(content, p).flatMap((g) => g.steps).find((s) => s.uo === "lyophilization")!.state).toBe("excluded");
  });
});

describe("the document says what was left out", () => {
  it("lists a left-out step with its reason, who and when, and 'No reason recorded' when empty", () => {
    let p = excludeStep(content, demo, UO, "Filled at a partner site (fictional)", ACTOR);
    p = excludeStep(content, p, "capping", undefined, LATER);
    const md = scopeMd(docOf(p));
    expect(md).toContain("Process step left out");
    expect(md).toContain("Filled at a partner site (fictional)");
    expect(md).toContain("No reason recorded");
    expect(md).toContain(ACTOR.name);
    expect(md).toContain(LATER.name);
    expect(md).toContain("2026-10-04");
    expect(md).toContain("2026-10-05");
    expect(stepExclusions(content, p).map((e) => e.uo)).toEqual(["aseptic_filling", "capping"]);
  });

  it("states that nothing was left out when nothing was", () => {
    expect(scopeMd(docOf(demo))).toMatch(/No process steps were left out/);
  });

  it("changes the document and its fingerprint per selection, in every format", () => {
    const p = excludeStep(content, demo, UO, undefined, ACTOR);
    expect(renderHtml(docOf(p))).not.toBe(renderHtml(docOf(demo)));
    expect(renderMarkdown(docOf(p))).not.toBe(renderMarkdown(docOf(demo)));
  });
});
