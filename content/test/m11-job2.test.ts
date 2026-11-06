import {
  buildCmoInstructionsDocument,
  buildDemoProject,
  buildMbrDocument,
  buildProcessView,
  buildSamplingPlanDocument,
  designReviewAppendixBlocks,
  expectedStudies,
  planDesignReview,
  setReviewCheckOff,
  setVolumeFlagPercent,
  type Block,
  type DocModel,
} from "@gap/engine";
import type { Project } from "@gap/process-model";
import { designReviewView, volumeTakenPerBatch } from "@gap/sampling";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

vi.setConfig({ testTimeout: 60000 });

// M11 job 2: group C, the Process view Coverage group, the plan appendix, study-only equipment lines and the demo answers.
const GEN = "2026-11-03T09:00:00.000Z";
const actor = { name: "Alex Example (fictional)", at: GEN };
const build = (id: "syr-305" | "arx-217") =>
  buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const SYR = build("syr-305");
const ARX = build("arx-217");
const planOf = (p: Project) => p.sampling.plans[0]!;
const view = (p: Project) => planDesignReview(content, p, planOf(p), samplingSuggestions);
const textOf = (d: DocModel): string => JSON.stringify(d.sections.flatMap((s) => s.blocks as Block[]));
const expected = expectedStudies(samplingSuggestions);

describe("demo answers", () => {
  it("SYR-305 shows every state: answered, unanswered, look again", () => {
    const v = view(SYR);
    const state = (key: string) => v.items.find((i) => i.finding.key === key)?.state;
    for (const k of ["A4:SP-021", "A6:SP-018", "C1:plan", "D1:ds_shipping_inbound"]) expect(state(k), k).toBe("answered");
    expect(state("B5:ST-004")).toBe("look_again");
    expect(v.items.some((i) => i.state === "unanswered")).toBe(true);
    // B3 was answered "not applicable" for the plan; the answer is stored with its reason-free form.
    expect(planOf(SYR).designReview?.answers?.["B3:plan"]?.response).toBe("not_applicable");
  });

  it("every demo answer key still arises in the full build, so none is silently lost", () => {
    for (const p of [SYR, ARX]) {
      const keys = new Set(view(p).items.map((i) => i.finding.key));
      for (const k of Object.keys(planOf(p).designReview?.answers ?? {})) expect(keys.has(k), k).toBe(true);
    }
  });

  it("ARX-217 stores answers too, and its C1 stays silent because no sample states a quantity", () => {
    expect(Object.keys(planOf(ARX).designReview?.answers ?? {}).length).toBeGreaterThanOrEqual(3);
    expect(view(ARX).items.some((i) => i.finding.group === "C")).toBe(false);
  });

  it("SYR-305 lists study-only equipment", () => {
    expect(planOf(SYR).designReview?.studyEquipment?.items.map((i: { id: string }) => i.id)).toEqual(["EQ-01", "EQ-02"]);
  });

  it("SYR-305 group C raises the volume question on the smallest PPQ batch", () => {
    const c1 = view(SYR).items.find((i) => i.finding.key === "C1:plan")!.finding;
    expect(c1.group).toBe("C");
    const first = volumeTakenPerBatch(planOf(SYR))[0]!;
    expect(c1.states).toContain(first.label);
  });
});

describe("the volume percent field", () => {
  it("stores the percent, logs it, clears it, and refuses a value that is not above 0", () => {
    const id = planOf(SYR).id;
    const p = setVolumeFlagPercent(SYR, id, 5, actor);
    expect(planOf(p).designReview?.volumeFlagPercent).toBe(5);
    expect(p.changeLog.at(-1)).toMatchObject({ action: "sampling_plan_update", path: `sampling.${id}.designReview.volumeFlagPercent` });
    // The demo C1 is at 7.7 %, so 5 % still raises it and 10 % does not.
    expect(view(p).items.some((i) => i.finding.key === "C1:plan")).toBe(true);
    expect(view(setVolumeFlagPercent(SYR, id, 10, actor)).items.some((i) => i.finding.key === "C1:plan")).toBe(false);
    const cleared = setVolumeFlagPercent(p, id, undefined, actor);
    expect(planOf(cleared).designReview).not.toHaveProperty("volumeFlagPercent");
    expect(() => setVolumeFlagPercent(SYR, id, 0, actor)).toThrow();
    expect(() => setVolumeFlagPercent(SYR, id, -2, actor)).toThrow();
  });

  it("a changed percent turns a stored C1 answer into look again", () => {
    const id = planOf(SYR).id;
    const v = view(setVolumeFlagPercent(SYR, id, 5, actor));
    expect(v.items.find((i) => i.finding.key === "C1:plan")?.state).toBe("look_again");
  });
});

describe("process view: Coverage group", () => {
  const withPlan = buildProcessView(SYR, SYR.mbr.records[0]!, { expected });

  it("is present when a plan is linked and uses the review's own wording", () => {
    const cov = withPlan.checks.filter((c) => c.group === "Coverage");
    expect(cov.map((c) => c.id)).toEqual(["D1", "D2"]);
    const d1 = view(SYR).items.filter((i) => i.finding.checkId === "D1");
    const notes = withPlan.findings.filter((f) => cov.some((c) => c.findingIds.includes(f.id)));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.title === d1[0]!.finding.question)).toBe(true);
  });

  it("is absent with no plan: no group, no notice", () => {
    const rec = { ...SYR.mbr.records[0]! };
    delete (rec as { planId?: string }).planId;
    const noPlan = buildProcessView({ ...SYR, mbr: { ...SYR.mbr, records: [rec] } }, rec, { expected });
    expect(noPlan.checks.some((c) => c.group === "Coverage")).toBe(false);
    expect(JSON.stringify(noPlan)).not.toMatch(/Coverage|design review/i);
  });

  it("leaves every other check as it was without the plan options (S5 and the volume tracker unchanged)", () => {
    const plain = buildProcessView(SYR, SYR.mbr.records[0]!);
    const strip = (v: typeof plain) => ({ ...v, checks: v.checks.filter((c) => c.group !== "Coverage"), findings: v.findings.filter((f) => !/^D[12]/.test(f.checkId ?? "")) });
    const other = (v: typeof plain) => v.checks.filter((c) => c.group !== "Coverage").map((c) => [c.id, c.status, c.summary]);
    expect(other(withPlan)).toEqual(other(plain));
    expect(strip(withPlan).checks.find((c) => c.id === "S5")?.summary).toBe(plain.checks.find((c) => c.id === "S5")?.summary);
    expect(withPlan.volumeBatches).toEqual(plain.volumeBatches);
    expect(withPlan.volumeSections).toEqual(plain.volumeSections);
  });

  it("a switched-off check shows as not applicable", () => {
    const off = setReviewCheckOff(SYR, planOf(SYR).id, "D1", true, "Covered elsewhere (fictional)", actor);
    const v = buildProcessView(off, off.mbr.records[0]!, { expected });
    expect(v.checks.find((c) => c.id === "D1")?.status).toBe("na");
  });
});

describe("plan appendix: Design review", () => {
  it("lists answered, look again and unanswered rows with the review's wording", () => {
    const doc = buildSamplingPlanDocument(content, SYR, planOf(SYR), samplingSuggestions, { generatedAt: GEN });
    const sec = doc.sections.find((s) => s.id === "design-review")!;
    const t = JSON.stringify(sec);
    expect(sec.title).toBe("Design review");
    expect(t).toContain("Not answered yet");
    expect(t).toContain("Confirmed");
    expect(t).toContain("Yes: the plan changed in the part this question reads since it was answered");
    expect(t).toContain("Checks switched off for this plan");
    expect(doc.sections.map((s) => s.id).indexOf("design-review")).toBeGreaterThan(doc.sections.map((s) => s.id).indexOf("source-register"));
  });

  it("lists a switched-off check with its reason", () => {
    const off = setReviewCheckOff(SYR, planOf(SYR).id, "A1", true, "Our SOP covers it (fictional)", actor);
    const blocks = designReviewAppendixBlocks(designReviewView(planOf(off)));
    expect(JSON.stringify(blocks)).toContain("Our SOP covers it (fictional)");
  });

  it("says the review raised no questions when there are none", () => {
    const empty = designReviewAppendixBlocks({ items: [], groups: [], off: [], questions: 0, unanswered: 0, lookAgain: 0 });
    expect(JSON.stringify(empty)).toContain("The design review raised no questions for the plan as it stands.");
    expect(JSON.stringify(empty)).toContain("No check is switched off.");
  });

  it("keeps the answers out of the batch record", () => {
    const rec = SYR.mbr.records[0]!;
    const t = textOf(buildMbrDocument(SYR, rec, { generatedAt: GEN, appVersion: "0.0.0-test" }));
    expect(t).not.toContain("Design review questions and answers");
    expect(t).not.toContain("Look again");
  });
});

describe("study-only equipment (A5)", () => {
  it("is listed in the plan body and the CMO instructions", () => {
    const planDoc = buildSamplingPlanDocument(content, SYR, planOf(SYR), samplingSuggestions, { generatedAt: GEN });
    const cmo = buildCmoInstructionsDocument(content, SYR, planOf(SYR), samplingSuggestions, { generatedAt: GEN });
    expect(planDoc.sections.some((s) => s.id === "study-equipment")).toBe(true);
    expect(textOf(planDoc)).toContain("Single-use tubing set with sterile bottles");
    expect(cmo.sections.some((s) => s.id === "cmo-equipment")).toBe(true);
    expect(textOf(cmo)).toContain("Small peristaltic pump");
  });

  it("adds a PPQ only line on the sample steps of a batch record started from the plan", () => {
    const t = textOf(buildMbrDocument(SYR, SYR.mbr.records[0]!, { generatedAt: GEN, appVersion: "0.0.0-test" }));
    expect(t).toContain("PPQ only: Small peristaltic pump");
  });

  it("writes nothing for a demo with no equipment", () => {
    expect(planOf(ARX).designReview?.studyEquipment).toBeUndefined();
    const t = textOf(buildMbrDocument(ARX, ARX.mbr.records[0]!, { generatedAt: GEN, appVersion: "0.0.0-test" }));
    expect(t).not.toContain("is used only to take samples");
    const planDoc = buildSamplingPlanDocument(content, ARX, planOf(ARX), samplingSuggestions, { generatedAt: GEN });
    expect(planDoc.sections.some((s) => s.id === "study-equipment")).toBe(false);
  });
});
