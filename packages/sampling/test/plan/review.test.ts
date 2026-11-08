import { samplingPlanSchema, type PlanStep, type SampleMethod, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { REVIEW_CHECKS, designReview, designReviewLine, designReviewView, type ReviewContext } from "../../src/index";

const at = "2026-10-01T00:00:00.000Z";
const point = (id: string, extra: Partial<SamplingPoint> = {}, method?: SampleMethod): SamplingPoint =>
  ({
    id,
    origin: { kind: "manual" },
    type: "ipc",
    unitOp: "compounding",
    attribute: "Bulk pH (fictional)",
    timing: { options: ["end"] },
    sampleSize: { inputs: {} },
    rationale: "Fictional.",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...(method ? { method } : {}),
    ...extra,
  }) as SamplingPoint;
const step = (n: number, unitOp: string, label = unitOp): PlanStep => ({ id: `ST-${String(n).padStart(2, "0")}`, unitOp, label });
const planOf = (points: SamplingPoint[], steps: PlanStep[] = [], extra: Partial<SamplingPlan> = {}): SamplingPlan =>
  ({ id: "SPL-001", title: "Plan", status: "draft", steps, batches: [], batchRationale: "", parties: [], agencyRequests: [], points, subsections: [], createdAt: at, updatedAt: at, ...extra }) as SamplingPlan;
const raised = (p: SamplingPlan, check: string, ctx?: ReviewContext) => designReview(p, ctx).filter((f) => f.checkId === check);
/** A point with its way of being taken stated (so A8 stays quiet) and the given method. */
const taken = (id: string, method: SampleMethod, extra: Partial<SamplingPoint> = {}) => point(id, extra, { access: "dedicated_port", closedSystem: "closed", ...method });

describe("design review: group A, how the samples are taken", () => {
  it("A1 asks about a port that is not flushed, and stays quiet when it is flushed", () => {
    const p = planOf([taken("SP-001", { flush: { practice: "none_stated_reason", reason: "Dead leg is short (fictional)" } })]);
    const f = raised(p, "A1")[0]!;
    expect(f.key).toBe("A1:SP-001");
    expect(f.states).toContain("Dead leg is short");
    expect(f.question).toMatch(/\?$/);
    expect(raised(planOf([taken("SP-001", { flush: { practice: "flush_volume", volume: { value: 5, unit: "mL" }, discardTo: "waste" } })]), "A1")).toEqual([]);
  });

  it("A2 asks when a shared port is not flushed between samples", () => {
    const shared = (flushBetween: boolean | undefined) => planOf([taken("SP-001", { access: "shared_port", shared: { pointIds: ["SP-002"], flushBetween } }), taken("SP-002", { access: "shared_port", shared: { pointIds: ["SP-001"] } })]);
    expect(raised(shared(false), "A2").map((f) => f.key)).toEqual(["A2:SP-001"]);
    expect(raised(shared(true), "A2")).toEqual([]);
    expect(raised(shared(undefined), "A2")).toEqual([]);
  });

  it("A3 asks when the shared-port lists do not agree, once per pair", () => {
    const bad = planOf([taken("SP-001", { access: "shared_port", shared: { pointIds: ["SP-002"] } }), taken("SP-002", { access: "dedicated_port" })]);
    expect(raised(bad, "A3").map((f) => f.key)).toEqual(["A3:SP-001+SP-002"]);
    const oneWay = planOf([taken("SP-001", { access: "shared_port", shared: { pointIds: ["SP-002"] } }), taken("SP-002", { access: "shared_port", shared: { pointIds: [] } })]);
    expect(raised(oneWay, "A3")).toHaveLength(1);
    const good = planOf([taken("SP-001", { access: "shared_port", shared: { pointIds: ["SP-002"] } }), taken("SP-002", { access: "shared_port", shared: { pointIds: ["SP-001"] } })]);
    expect(raised(good, "A3")).toEqual([]);
  });

  it("A4 asks per the answers given about a part added only for the study", () => {
    const added = (a: NonNullable<SampleMethod["added"]>, access: SampleMethod["access"] = "added_y_connector") => planOf([taken("SP-001", { access, added: a })]);
    const f = raised(added({ forStudyOnly: true, inCommercialAssembly: false, validatedAssembly: false, removedAfter: true }), "A4")[0]!;
    expect(f.question).toContain("commercial process");
    expect(f.question).toContain("extractables");
    expect(f.question).toContain("removal");
    // Unknown answers are asked too, not skipped.
    expect(raised(added({ forStudyOnly: true }), "A4")[0]!.states).toContain("is not stated");
    // A bag manifold or an aseptic connector can be added for the study as well.
    expect(raised(added({ forStudyOnly: true }, "bag_sample_manifold"), "A4")).toHaveLength(1);
    // Nothing to ask when the part is not added, or is in the commercial assembly, qualified and left in place.
    expect(raised(added({ forStudyOnly: false }, "dedicated_port"), "A4")).toEqual([]);
    expect(raised(added({ forStudyOnly: true, inCommercialAssembly: true, validatedAssembly: true, removedAfter: false }), "A4")).toEqual([]);
  });

  it("A5 asks the plan-level question until it is answered, then lists items that have unknowns", () => {
    const base = [taken("SP-001", {})];
    expect(raised(planOf(base), "A5").map((f) => f.key)).toEqual(["A5:plan"]);
    expect(raised(planOf([]), "A5")).toEqual([]);
    const answered = (se: NonNullable<SamplingPlan["designReview"]>["studyEquipment"]) => planOf(base, [step(1, "compounding")], { designReview: { studyEquipment: se } });
    expect(raised(answered({ used: false, items: [] }), "A5")).toEqual([]);
    const items = raised(answered({ used: true, items: [{ id: "EQ-01", what: "Extra sampling bag (fictional)", stepId: "ST-01", inCommercialProcess: false, qualified: true }] }), "A5");
    expect(items.map((f) => f.key)).toEqual(["A5:EQ-01"]);
    expect(items[0]!.states).toContain("whether it is removed afterwards");
    expect(items[0]!.subjects).toEqual(["ST-01"]);
    expect(raised(answered({ used: true, items: [{ id: "EQ-01", what: "Extra bag", stepId: "ST-01", inCommercialProcess: false, qualified: true, removedAfter: true }] }), "A5")).toEqual([]);
  });

  it("A6 asks about an open draw and A7 about an unmixed bag", () => {
    expect(raised(planOf([taken("SP-001", { closedSystem: "open", openClass: "Grade A hood (fictional)" })]), "A6")[0]!.states).toContain("Grade A hood");
    expect(raised(planOf([taken("SP-001", { access: "grab_open", closedSystem: undefined })]), "A6")).toHaveLength(1);
    expect(raised(planOf([taken("SP-001", { closedSystem: "closed" })]), "A6")).toEqual([]);
    const bag = (mixedFirst: boolean) => planOf([taken("SP-001", { access: "bag_sample_manifold", bag: { mixedFirst } })]);
    expect(raised(bag(false), "A7").map((f) => f.key)).toEqual(["A7:SP-001"]);
    expect(raised(bag(true), "A7")).toEqual([]);
  });

  it("A8 is one summary of the samples with no 'how taken' answer", () => {
    const p = planOf([point("SP-001"), point("SP-002"), taken("SP-003", {})]);
    const f = raised(p, "A8")[0]!;
    expect(f.key).toBe("A8:plan");
    expect(f.subjects).toEqual(["SP-001", "SP-002"]);
    expect(raised(planOf([taken("SP-001", {})]), "A8")).toEqual([]);
  });
});

describe("design review: group B, where the samples sit", () => {
  const steps = [step(1, "bbr_filtration", "Bioburden-reduction filtration"), step(2, "sterile_filtration", "Sterile filtration"), step(3, "aseptic_filling", "Filling")];
  const on = (id: string, stepId: string, at: "before" | "during" | "after" | undefined, extra: Partial<SamplingPoint> = {}) => taken(id, {}, { flow: { stepId, ...(at ? { at } : {}) }, ...extra });

  it("B1 asks about a sample after the sterile filter that is not taken from filled units", () => {
    const f = raised(planOf([on("SP-001", "ST-02", "after")], steps), "B1");
    expect(f.map((x) => x.key)).toEqual(["B1:SP-001"]);
    expect(f[0]!.states).toContain("Sterile filtration");
    expect(raised(planOf([on("SP-001", "ST-02", "before")], steps), "B1")).toEqual([]);
    expect(raised(planOf([on("SP-001", "ST-03", "during")], steps), "B1")).toEqual([]);
    // Filled units and release samples are what the check asks for, so they are not asked about.
    expect(raised(planOf([on("SP-001", "ST-02", "after", { type: "release" })], steps), "B1")).toEqual([]);
    expect(raised(planOf([on("SP-001", "ST-02", "after", { materialType: "Filled syringes (fictional)" })], steps), "B1")).toEqual([]);
    // A step between the filter and filling counts too; without a sterile filtration step the check is silent.
    const between = [...steps.slice(0, 2), step(4, "hold_vessel", "Filtrate hold"), steps[2]!];
    expect(raised(planOf([on("SP-001", "ST-04", "during")], between), "B1")).toHaveLength(1);
    expect(raised(planOf([on("SP-001", "ST-01", "after")], [steps[0]!]), "B1")).toEqual([]);
  });

  it("B2 asks when a filter has no bioburden sample right before it (case-insensitive), and is silent when placement is unknown", () => {
    const bio = (id: string, stepId: string, at: "before" | "after" | undefined, attribute = "BIOBURDEN of the bulk") => on(id, stepId, at, { attribute });
    expect(raised(planOf([on("SP-009", "ST-03", "during")], steps), "B2").map((f) => f.key)).toEqual(["B2:ST-01", "B2:ST-02"]);
    // A bioburden sample before the BBR filter, and one after the BBR filter (right before the sterile filter).
    const covered = planOf([bio("SP-001", "ST-01", "before"), bio("SP-002", "ST-01", "after")], steps);
    expect(raised(covered, "B2")).toEqual([]);
    // A bioburden sample whose position is not set cannot be placed, so the check does not guess (B4 reports it).
    expect(raised(planOf([bio("SP-001", "ST-01", undefined)], steps), "B2")).toEqual([]);
    expect(raised(planOf([point("SP-001", { attribute: "Bioburden" })], steps), "B2")).toEqual([]);
    expect(raised(planOf([on("SP-001", "ST-03", "during")], [step(1, "compounding")]), "B2")).toEqual([]);
  });

  it("B3 summarises steps with no sample, and stays quiet while the plan has no samples", () => {
    const f = raised(planOf([on("SP-001", "ST-01", "before")], steps), "B3")[0]!;
    expect(f.subjects).toEqual(["ST-02", "ST-03"]);
    expect(raised(planOf([], steps), "B3")).toEqual([]);
  });

  it("B4 summarises samples that are not placed or have no position", () => {
    const f = raised(planOf([point("SP-001"), on("SP-002", "ST-01", undefined), on("SP-003", "ST-01", "before")], steps), "B4")[0]!;
    expect(f.subjects).toEqual(["SP-001", "SP-002"]);
    expect(raised(planOf([on("SP-003", "ST-01", "before")], steps), "B4")).toEqual([]);
  });

  it("B5 asks about failure modes of the risk assessment with no linked sample, and is silent without a risk assessment", () => {
    const ctx = (pointIds: string[]): ReviewContext => ({ riskItems: [{ id: "RAS-001/RA-001", failureMode: "Filter bypass (fictional)", unitOp: "sterile_filtration", label: "Sterile filtration", pointIds }] });
    const p = planOf([on("SP-001", "ST-02", "before")], steps);
    expect(raised(p, "B5", ctx([])).map((f) => f.key)).toEqual(["B5:ST-02"]);
    expect(raised(p, "B5", ctx(["SP-001"]))).toEqual([]);
    // The risk assessment spells a link "SPL-001.SP-001" (plan id and point id); that is the same sample. A link into another plan is not.
    expect(raised(p, "B5", ctx(["SPL-001.SP-001"]))).toEqual([]);
    expect(raised(p, "B5", ctx(["SPL-002.SP-001"])).map((f) => f.key)).toEqual(["B5:ST-02"]);
    expect(raised(p, "B5")).toEqual([]);
  });
});

// CR-07: with no project stage the questions used to read as PPQ, presenting an unknown stage as a known one.
describe("design review: the project stage in the wording", () => {
  const steps = [step(1, "compounding"), step(2, "filling")];
  const plan = planOf([point("SP-001", { flow: { stepId: "ST-01", at: "after" } })], steps);
  const ask = (stage?: string) => designReview(plan, { trdSteps: [{ label: "Hold (fictional)" }], ...(stage ? { stage } : {}) }).filter((f) => f.checkId === "B3" || f.checkId === "D1");
  const words = (fs: ReturnType<typeof ask>) => fs.map((f) => `${f.states} ${f.why} ${f.question}`).join("\n");

  it("uses the plain wording when the stage is not set", () => {
    const fs = ask();
    expect(fs.map((f) => f.checkId).sort()).toEqual(["B3", "D1"]);
    expect(words(fs)).not.toMatch(/PPQ/);
    expect(words(fs)).toContain("these batches");
  });

  it("uses the plain wording at any stage other than PPQ, and keeps PPQ only for PPQ", () => {
    expect(words(ask("clinical"))).not.toMatch(/PPQ/);
    expect(words(ask("ppq"))).toMatch(/PPQ/);
  });

  it("keeps the check, the key and the facts the same whatever the stage, so a saved answer still belongs to its question", () => {
    const keys = (fs: ReturnType<typeof ask>) => fs.map((f) => [f.key, f.factsFingerprint]);
    expect(keys(ask())).toEqual(keys(ask("ppq")));
    expect(keys(ask("commercial"))).toEqual(keys(ask("ppq")));
  });
});

describe("design review: group D, what the plan left out", () => {
  it("D2 counts a bioburden sample right before the filter as the expected bioburden study, and asks about integrity tests as batch-record steps", () => {
    const exp = [
      { key: "bbr_prefiltration_bioburden", uo: "bbr_filtration", type: "ipc" as const, attribute: "Pre-filtration bioburden (bioburden-reduction filter inlet)" },
      { key: "bbr_filter_integrity", uo: "bbr_filtration", type: "filter_study" as const, attribute: "Filter integrity test (before and after use)" },
    ];
    const steps = [step(1, "compounding"), step(2, "bbr_filtration")];
    // The team's own sample, named differently from the catalog's, at the end of the step ahead of the filter.
    const own = planOf([point("SP-001", { unitOp: "compounding", type: "hold_time", attribute: "Formulated bulk: pH, bioburden before the filter (100 mL, 10 CFU/100 mL)", flow: { stepId: "ST-01", at: "after" } })], steps);
    const f = raised(own, "D2", { expected: exp });
    expect(f.map((x) => x.key)).toEqual(["D2:bbr_filter_integrity"]);
    expect(f[0]!.states).toContain("not a sample");
    expect(f[0]!.question).toContain("batch record");
    // No bioburden sample: the study is missing and says so as a sample.
    expect(raised(planOf([], steps), "D2", { expected: exp }).map((x) => x.states.includes("no sample of the plan covers it"))).toEqual([true, false]);
    // A bioburden sample with no place on the diagram: nothing is guessed.
    const loose = planOf([point("SP-001", { attribute: "Bioburden (fictional)" })], steps);
    expect(raised(loose, "D2", { expected: exp }).map((x) => x.key)).toEqual(["D2:bbr_filter_integrity"]);
  });

  const expected = [
    { key: "blend_uniformity", uo: "compounding", type: "mixing_homogeneity" as const, attribute: "Blend uniformity" },
    { key: "sf_filter_integrity", uo: "sterile_filtration", type: "filter_study" as const, attribute: "Filter integrity test" },
  ];
  it("D1 asks about process steps the plan has no step for, from the TRD first and the Scope otherwise", () => {
    const p = planOf([], [step(1, "compounding")]);
    const ctx: ReviewContext = { trdSteps: [{ unitOp: "compounding", label: "Compounding" }, { unitOp: "aseptic_filling", label: "Filling" }, { label: "Special rinse" }], scopeSteps: [{ unitOp: "capping", label: "Capping" }] };
    expect(raised(p, "D1", ctx).map((f) => f.key)).toEqual(["D1:aseptic_filling", "D1:custom:special rinse"]);
    expect(raised(p, "D1", { scopeSteps: ctx.scopeSteps }).map((f) => f.key)).toEqual(["D1:capping"]);
    expect(raised(p, "D1")).toEqual([]);
    // A custom TRD step is matched to a plan step by its label, ignoring case.
    expect(raised(planOf([], [{ id: "ST-01", label: "SPECIAL RINSE" }]), "D1", { trdSteps: [{ label: "Special rinse" }] })).toEqual([]);
  });

  it("D2 asks for an expected study with no covering sample, by suggestion key or by step and type", () => {
    const p = planOf([], [step(1, "compounding"), step(2, "sterile_filtration")]);
    expect(raised(p, "D2", { expected }).map((f) => f.key)).toEqual(["D2:blend_uniformity", "D2:sf_filter_integrity"]);
    const bySuggestion = planOf([point("SP-001", { origin: { kind: "seeded", suggestionKey: "cat:blend_uniformity", gapIds: [] } })], p.steps);
    expect(raised(bySuggestion, "D2", { expected }).map((f) => f.key)).toEqual(["D2:sf_filter_integrity"]);
    const byType = planOf([point("SP-001", { unitOp: "sterile_filtration", type: "filter_study" })], p.steps);
    expect(raised(byType, "D2", { expected }).map((f) => f.key)).toEqual(["D2:blend_uniformity"]);
    // A unit operation that is neither in the plan nor in the process raises nothing; no marks means silence.
    expect(raised(planOf([], [step(1, "capping")]), "D2", { expected })).toEqual([]);
    expect(raised(p, "D2")).toEqual([]);
    // It also covers the steps of the process the plan lacks (D1 asks about the step; D2 about the study).
    expect(raised(planOf([], []), "D2", { expected, scopeSteps: [{ unitOp: "compounding", label: "Compounding" }] }).map((f) => f.key)).toEqual(["D2:blend_uniformity"]);
  });
});

describe("design review: answers, fingerprints, switching off", () => {
  const flushless = (reason: string) => taken("SP-001", { flush: { practice: "none_stated_reason", reason } });
  const withAnswer = (plan: SamplingPlan, fp: string): SamplingPlan => ({ ...plan, designReview: { answers: { "A1:SP-001": { response: "confirmed", reason: "Short leg", by: "Alex Example (fictional)", at, factsFingerprint: fp } } } });

  it("a stored answer is 'answered' while the facts match and 'look again' once they change", () => {
    const first = planOf([flushless("Reason one")]);
    const fp = designReview(first)[0]!.factsFingerprint;
    const a1 = (p: SamplingPlan) => designReviewView(p).items.find((i) => i.finding.key === "A1:SP-001")!;
    expect(a1(first).state).toBe("unanswered");
    expect(a1(withAnswer(first, fp)).state).toBe("answered");
    const view = designReviewView(withAnswer(planOf([flushless("Reason two")]), fp));
    expect(a1(withAnswer(planOf([flushless("Reason two")]), fp)).state).toBe("look_again");
    expect(view.lookAgain).toBe(1);
    expect(designReviewLine(view)).toMatch(/^\d+ design review questions? not answered yet, 1 to look at again$/);
    expect(view.questions).toBe(view.unanswered + view.lookAgain + view.items.filter((i) => i.state === "answered").length);
  });

  it("the fingerprint is stable for the same facts and differs for different facts", () => {
    expect(designReview(planOf([flushless("same")]))[0]!.factsFingerprint).toBe(designReview(planOf([flushless("same")]))[0]!.factsFingerprint);
    expect(designReview(planOf([flushless("same")]))[0]!.factsFingerprint).not.toBe(designReview(planOf([flushless("other")]))[0]!.factsFingerprint);
    // D2's fingerprint includes the expected marks (key, step, type, wording).
    const p = planOf([], [step(1, "compounding")]);
    const a = designReview(p, { expected: [{ key: "k", uo: "compounding", type: "mixing_homogeneity", attribute: "One" }] })[0]!.factsFingerprint;
    const b = designReview(p, { expected: [{ key: "k", uo: "compounding", type: "mixing_homogeneity", attribute: "Two" }] })[0]!.factsFingerprint;
    expect(a).not.toBe(b);
  });

  it("an answer whose finding no longer arises is ignored", () => {
    const fixed = withAnswer(planOf([taken("SP-001", { flush: { practice: "flush_volume", volume: { value: 5, unit: "mL" }, discardTo: "waste" } })]), "x");
    expect(designReviewView(fixed).items.filter((i) => i.finding.checkId === "A1")).toEqual([]);
  });

  it("a switched-off check raises nothing and is listed with its reason", () => {
    const p = { ...planOf([flushless("r")]), designReview: { off: { A1: "Our SOP covers ports (fictional)", A5: "" } } };
    const v = designReviewView(p);
    expect(v.items.map((i) => i.finding.checkId)).not.toContain("A1");
    expect(v.off.map((o) => [o.checkId, o.reason])).toEqual([["A1", "Our SOP covers ports (fictional)"], ["A5", ""]]);
  });

  it("the plan schema accepts the stored review and older plans without it", () => {
    expect(samplingPlanSchema.safeParse(planOf([])).success).toBe(true);
    expect(samplingPlanSchema.safeParse(withAnswer(planOf([flushless("r")]), "x")).success).toBe(true);
  });

  it("every check has a wording free of verdict words, and ends its question with a question mark", () => {
    const ctx: ReviewContext = { trdSteps: [{ unitOp: "aseptic_filling", label: "Filling" }], expected: [{ key: "k", uo: "compounding", type: "mixing_homogeneity", attribute: "Blend uniformity" }], riskItems: [{ id: "R/1", failureMode: "x", unitOp: "sterile_filtration", label: "Sterile filtration", pointIds: [] }] };
    const steps = [step(1, "compounding"), step(2, "bbr_filtration"), step(3, "sterile_filtration"), step(4, "aseptic_filling")];
    const p = planOf(
      [
        point("SP-001"),
        taken("SP-002", { access: "shared_port", flush: { practice: "none_stated_reason" }, shared: { pointIds: ["SP-005"], flushBetween: false }, added: { forStudyOnly: true }, closedSystem: "open" }, { flow: { stepId: "ST-03", at: "after" } }),
        taken("SP-003", { access: "bag_sample_manifold", bag: { mixedFirst: false } }),
        taken("SP-005", { access: "dedicated_port" }),
      ],
      steps,
    );
    const all = designReview(p, ctx);
    expect(new Set(all.map((f) => f.checkId)).size).toBeGreaterThanOrEqual(12);
    for (const f of all) {
      expect(f.question).toMatch(/\?$/);
      expect(`${f.states} ${f.why} ${f.question}`).not.toMatch(/\b(error|non-?compliant|fail|fails|failed|must|violation)\b/i);
      expect(REVIEW_CHECKS.some((c) => c.id === f.checkId && c.group === f.group)).toBe(true);
    }
  });
});

describe("design review: the account expected list in D2 facts", () => {
  const p = planOf([], [step(1, "compounding")]);
  const exp = [{ key: "k", uo: "compounding", type: "mixing_homogeneity" as const, attribute: "One" }];
  it("a changed list (expectedListId) changes the fingerprint; an unchanged list leaves it as it was", () => {
    const shipped = designReview(p, { expected: exp })[0]!.factsFingerprint;
    expect(designReview(p, { expected: exp, expectedListId: "k,other" })[0]!.factsFingerprint).not.toBe(shipped);
    expect(designReview(p, { expected: exp })[0]!.factsFingerprint).toBe(shipped);
  });
});
