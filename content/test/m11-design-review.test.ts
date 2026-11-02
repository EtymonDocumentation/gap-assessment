// M11 job 1: the sampling design review. Migration 1.27.0 -> 1.28.0, the stored answers and their edits, the catalog's expected marks,
// and what the two demo plans raise (no demo answers are stored).
import {
  answerReview,
  buildDemoProject,
  buildSamplingPlanDocument,
  samplingOpenItems,
  clearReviewAnswer,
  nextStudyEquipmentId,
  planDesignReview,
  reviewContext,
  setReviewCheckOff,
  setStudyEquipment,
  SamplingError,
} from "@gap/engine";
import { SAMPLING_PLAN_FORMAT_VERSION, SCHEMA_VERSION, parseProject, type Actor, type Project } from "@gap/process-model";
import { designReview } from "@gap/sampling";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 60000 });

const T0 = "2026-11-02T09:00:00.000Z";
const actor: Actor = { name: "Alex Example (fictional)", at: T0 };
const build = (id: "syr-305" | "arx-217") => buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
const SYR = build("syr-305");
const ARX = build("arx-217");
const planOf = (p: Project) => p.sampling.plans[0]!;

describe("versions and migration", () => {
  it("is schema 1.28.0 and plan format 1.7.0", () => {
    expect(SCHEMA_VERSION).toBe("1.28.0");
    expect(SAMPLING_PLAN_FORMAT_VERSION).toBe("1.7.0");
  });

  it("opens a 1.27.0 plan with only the version changed, and a plan with no review stays free of the field", () => {
    const old = JSON.parse(JSON.stringify(SYR)) as Record<string, any>;
    old.schemaVersion = "1.27.0";
    // Parsing the same data at the current version is the baseline: the old version must add nothing else.
    const current = parseProject(JSON.parse(JSON.stringify(SYR)));
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.28.0");
    expect(p.sampling).toEqual(current.sampling);
    expect(planOf(p).designReview).toBeUndefined();
  });

  it("round-trips a stored review", () => {
    const p = setReviewCheckOff(SYR, planOf(SYR).id, "A1", true, "Covered by our SOP (fictional)", actor);
    expect(planOf(parseProject(JSON.parse(JSON.stringify(p)))).designReview?.off).toEqual({ A1: "Covered by our SOP (fictional)" });
  });
});

describe("the catalog's expected marks", () => {
  it("lists the marked entries (a starting load-out) and keeps the catalog version bumped", () => {
    expect(samplingSuggestions.catalog.version).toBe("1.2.0");
    const marked = samplingSuggestions.candidates.filter((c) => c.expected).map((c) => c.key);
    expect(marked.sort()).toEqual(["bbr_filter_integrity", "bbr_prefiltration_bioburden", "blend_uniformity", "fill_weight", "sf_filter_integrity", "sf_prefiltration_bioburden"]);
    expect(reviewContext(content, SYR, samplingSuggestions).expected?.map((e) => e.key).sort()).toEqual(marked);
    expect(reviewContext(content, SYR).expected).toBeUndefined();
  });
});

describe("the demos raise questions and store no answers", () => {
  for (const [id, project] of [["syr-305", SYR], ["arx-217", ARX]] as const) {
    it(`${id}: findings in groups A, B and D, none of them answered`, () => {
      const plan = planOf(project);
      expect(plan.designReview).toBeUndefined();
      const view = planDesignReview(content, project, plan, samplingSuggestions);
      const groups = new Set(view.items.map((i) => i.finding.group));
      expect(groups.has("A")).toBe(true);
      expect(groups.has("B")).toBe(true);
      expect(view.unanswered).toBe(view.questions);
      expect(view.questions).toBeGreaterThan(3);
    });
  }

  it("syr-305 raises a question in group D from the TRD or the expected list", () => {
    const view = planDesignReview(content, SYR, planOf(SYR), samplingSuggestions);
    expect(view.items.some((i) => i.finding.group === "D")).toBe(true);
  });
});

describe("SYR-305: the review raises no false alarm for what the plan already covers", () => {
  const view = planDesignReview(content, SYR, planOf(SYR), samplingSuggestions);
  it("B5 lists only the failure modes with no linked sample (RA-005, -007, -008, -009)", () => {
    // The risk assessment links samples as "SPL-001.SP-018"; reading only the bare "SP-018" form once listed all ten failure modes.
    const ids = view.items.filter((i) => i.finding.checkId === "B5").flatMap((i) => [...i.finding.states.matchAll(/RAS-001\/(RA-\d+)/g)].map((m) => m[1]));
    expect(ids).toEqual(["RA-005", "RA-007", "RA-008", "RA-009"]);
  });

  it("D2 no longer lists the bioburden studies the plan has (SP-021, SP-009) and words integrity tests as batch-record steps", () => {
    const d2 = view.items.filter((i) => i.finding.checkId === "D2").map((i) => i.finding);
    expect(d2.map((f) => f.key)).toEqual(["D2:bbr_filter_integrity", "D2:sf_filter_integrity", "D2:fill_weight"]);
    expect(d2.filter((f) => f.question.includes("batch record")).map((f) => f.key)).toEqual(["D2:bbr_filter_integrity", "D2:sf_filter_integrity"]);
    expect(d2[2]!.states).toContain("no sample of the plan covers it");
  });
});

describe("unanswered review questions are visible where the plan lists its open items", () => {
  it("the plan export has its own line and meta row, and the plan's open-item number is unchanged", () => {
    const plan = planOf(SYR);
    const n = planDesignReview(content, SYR, plan, samplingSuggestions).unanswered;
    const doc = buildSamplingPlanDocument(content, SYR, plan, samplingSuggestions, { generatedAt: T0 });
    const text = JSON.stringify(doc.sections.find((s) => s.id === "open-items"));
    expect(text).toContain(`${n} design review questions not answered yet. These are not counted in the open items above.`);
    expect(doc.meta).toContainEqual(["Design review", `${n} design review questions not answered yet`]);
    expect(doc.meta).toContainEqual(["Open items", String(samplingOpenItems(content, SYR, plan).length)]);
  });
});

describe("editing the review", () => {
  const planId = planOf(SYR).id;
  const finding = designReview(planOf(SYR), reviewContext(content, SYR, samplingSuggestions))[0]!;

  it("stores an answer with who, when and the fingerprint; the same answer again changes nothing", () => {
    const p = answerReview(SYR, planId, finding.key, { response: "confirmed", reason: "  Checked with QA (fictional) ", factsFingerprint: finding.factsFingerprint }, actor);
    expect(planOf(p).designReview?.answers?.[finding.key]).toEqual({ response: "confirmed", reason: "Checked with QA (fictional)", by: actor.name, at: T0, factsFingerprint: finding.factsFingerprint });
    expect(p.changeLog.at(-1)).toMatchObject({ action: "sampling_plan_update", path: `sampling.${planId}.designReview.${finding.key}` });
    expect(answerReview(p, planId, finding.key, { response: "confirmed", reason: "Checked with QA (fictional)", factsFingerprint: finding.factsFingerprint }, actor)).toBe(p);
    // No reason is allowed; the answer then carries none.
    const bare = answerReview(SYR, planId, finding.key, { response: "not_applicable", factsFingerprint: finding.factsFingerprint }, actor);
    expect(planOf(bare).designReview?.answers?.[finding.key]).not.toHaveProperty("reason");
    expect(() => answerReview(SYR, planId, "", { response: "confirmed", factsFingerprint: "x" }, actor)).toThrow(SamplingError);
  });

  it("clears an answer and leaves the plan as it was; the log keeps the old answer", () => {
    const p = answerReview(SYR, planId, finding.key, { response: "changed", factsFingerprint: finding.factsFingerprint }, actor);
    const cleared = clearReviewAnswer(p, planId, finding.key, actor);
    expect(planOf(cleared).designReview).toBeUndefined();
    expect(JSON.stringify(planOf(cleared).steps)).toBe(JSON.stringify(planOf(SYR).steps));
    expect(cleared.changeLog.at(-1)?.before).toMatchObject({ answer: { response: "changed" } });
    expect(clearReviewAnswer(SYR, planId, finding.key, actor)).toBe(SYR);
  });

  it("switches a check off with an optional reason and on again", () => {
    const off = setReviewCheckOff(SYR, planId, finding.checkId, true, " Our SOP covers it (fictional) ", actor);
    expect(planOf(off).designReview?.off).toEqual({ [finding.checkId]: "Our SOP covers it (fictional)" });
    expect(designReview(planOf(off), reviewContext(content, off, samplingSuggestions)).some((f) => f.checkId === finding.checkId)).toBe(false);
    expect(off.changeLog.at(-1)?.detail).toContain("switched off");
    const on = setReviewCheckOff(off, planId, finding.checkId, false, undefined, actor);
    expect(planOf(on).designReview).toBeUndefined();
    expect(setReviewCheckOff(SYR, planId, finding.checkId, false, undefined, actor)).toBe(SYR);
    expect(() => setReviewCheckOff(SYR, planId, "Z9", true, undefined, actor)).toThrow(SamplingError);
  });

  it("edits the equipment used only for sampling (A5) and checks the step and samples it names", () => {
    const plan = planOf(SYR);
    const stepId = plan.steps[0]!.id;
    const pointId = plan.points[0]!.id;
    const items = [{ id: nextStudyEquipmentId([]), what: "  Extra sampling manifold (fictional) ", stepId, pointIds: [pointId], qualified: false }];
    const p = setStudyEquipment(SYR, planId, { used: true, items }, actor);
    expect(planOf(p).designReview?.studyEquipment).toEqual({ used: true, items: [{ id: "EQ-01", what: "Extra sampling manifold (fictional)", stepId, pointIds: [pointId], qualified: false }] });
    expect(nextStudyEquipmentId(planOf(p).designReview!.studyEquipment!.items)).toBe("EQ-02");
    expect(setStudyEquipment(p, planId, planOf(p).designReview!.studyEquipment, actor)).toBe(p);
    expect(() => setStudyEquipment(SYR, planId, { used: true, items: [{ id: "EQ-01", what: "x", stepId: "ST-99" }] }, actor)).toThrow(/not in the plan/);
    expect(() => setStudyEquipment(SYR, planId, { used: true, items: [{ id: "EQ-01", what: "x", pointIds: ["SP-999"] }] }, actor)).toThrow(/not in the plan/);
    // Unanswered again and no items leaves no trace.
    expect(planOf(setStudyEquipment(p, planId, undefined, actor)).designReview).toBeUndefined();
    // Saying "no equipment" removes the A5 question for the plan.
    const none = setStudyEquipment(SYR, planId, { used: false, items: [] }, actor);
    expect(designReview(planOf(none)).some((f) => f.checkId === "A5")).toBe(false);
    expect(designReview(planOf(SYR)).some((f) => f.checkId === "A5")).toBe(true);
  });
});
