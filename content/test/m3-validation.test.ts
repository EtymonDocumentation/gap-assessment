import { applyAnswer, assess, findRule, type AnswerInput, type FieldAnswer } from "@gap/engine";
import { emptyProject, type Actor, type Project } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content } from "../index";

// Tests for the milestone 3 content: validation study families, equipment qualification and the
// rule-to-activity audit. Projects are built through the engine by replaying answers with
// applyAnswer, exactly as the interview (and the demo builder) does.

const actor: Actor = { name: "Test Responder (fictional)", at: "2026-10-01T09:00:00.000Z" };
type Side = "shared" | "source" | "target";
type Step = [id: string, side: Side, input: AnswerInput];

const val = (value: unknown): AnswerInput => ({ kind: "value", value: value as never });
const same: AnswerInput = { kind: "same_as_source" };
const unknown: AnswerInput = { kind: "unknown" };
const q = (value: number, unit: string) => ({ value, unit });
const range = (min: number, max: number, unit: string) => val({ min: q(min, unit), max: q(max, unit) });
const fv = (value: unknown): FieldAnswer => ({ kind: "value", value: value as never });

function param(setPoint: [number, string], nor: [number, number], par?: [number, number]): AnswerInput {
  const unit = setPoint[1];
  const fields: Record<string, FieldAnswer> = {
    setPoint: fv(q(setPoint[0], unit)),
    nor: fv({ min: q(nor[0], unit), max: q(nor[1], unit) }),
  };
  {
    const p = par ?? nor;
    fields.par = fv({ min: q(p[0], unit), max: q(p[1], unit) });
    fields.classification = fv("CPP");
    fields.rangeBasis = fv("PPQ");
  }
  return { kind: "composite", fields } as AnswerInput;
}

function scoping(dosageForm = "liquid", dsState = "liquid"): Step[] {
  return [
    ["scope.program", "shared", val("ARX-999")],
    ["scope.modality", "shared", val("mab")],
    ["scope.dosage_form", "shared", val(dosageForm)],
    ["scope.presentation", "shared", val("vial")],
    ["scope.ds_state", "shared", val(dsState)],
    ["scope.containment", "shared", val("standard")],
    ["scope.markets", "shared", val(["us", "eu"])],
    ["scope.transfer_type", "shared", val("site_to_site")],
  ];
}

function build(steps: Step[]): Project {
  let project = emptyProject({ title: "M3 test (fictional)", actor, contentRefs: content.versions, entrySequence: "paired" });
  for (const [id, side, input] of steps) {
    const question = content.questionById.get(id);
    if (!question) throw new Error(`test setup: unknown question ${id}`);
    const section = content.sectionById.get(question.section)!;
    project = applyAnswer(project, content, { key: `${id}@${side}`, question, side, section, depth: 0 }, input, actor, { docRefs: [] });
  }
  return project;
}

const presence = (id: string): Step[] => [[id, "source", val("yes")], [id, "target", val("yes")]];
const pair = (id: string, source: unknown, target: AnswerInput | "same"): Step[] => [[id, "source", val(source)], [id, "target", target === "same" ? same : target]];
const visibleIds = (steps: Step[]) => new Set(assess(content, build(steps)).instances.map((i) => i.question.id));
const gapOf = (steps: Step[], key: string) => assess(content, build(steps)).gaps.find((g) => g.key === key);

const base = scoping();
const fill = presence("fill.presence");
const comp = presence("comp.presence");
const filt = presence("filt.presence");
const cap = presence("cap.presence");
const ship = presence("ss.presence");

const m3Questions = content.questions.filter((x) => x.tags?.includes("m3"));

// ------------------------------------------------------------------ the new questions are covered

describe("milestone 3 questions", () => {
  it("adds questions to every unit operation that has equipment, and to each study family's unit operation", () => {
    const sections = new Set(m3Questions.map((x) => x.section));
    for (const uo of [
      "uo.ds_receipt_thaw", "uo.compounding", "uo.sterile_filtration", "uo.aseptic_filling", "uo.stoppering",
      "uo.lyophilization", "uo.capping", "uo.visual_inspection", "uo.labeling_packaging", "uo.storage_shipping",
    ]) {
      expect(sections.has(uo), uo).toBe(true);
    }
  });

  it("every new question has a first-matching rule and a non-empty why", () => {
    expect(m3Questions.length).toBeGreaterThan(40);
    for (const x of m3Questions) {
      expect(findRule(content.rules, x.binds), `${x.id} (${x.binds})`).toBeDefined();
      expect(x.why.trim().length, `${x.id} why`).toBeGreaterThan(20);
    }
  });

  it("the generic fallback rules stay the last three rules", () => {
    expect(content.rules.map((r) => r.id).slice(-3)).toEqual(["R-GEN-EQUIP-PRINCIPLE", "R-GEN-MAT-PRESENCE", "R-GEN-IPC-DESCRIPTION"]);
  });

  it("never states a filing category in a rule, activity or new question", () => {
    const text = JSON.stringify([content.rules, content.catalog.activities, m3Questions]);
    expect(text).not.toMatch(/prior approval|CBE-?30|CBE-?0|annual report|major change|moderate change|minor change/i);
  });

  it("study item keys named by an activity are real study items", () => {
    const studyKeys = new Set(content.catalog.unitOperations.flatMap((u) => u.items.filter((i) => i.coll === "study").map((i) => i.key)));
    const linked = content.catalog.activities.filter((a) => (a.studies ?? []).length > 0);
    expect(linked.length).toBeGreaterThan(15);
    for (const a of linked) for (const s of a.studies!) expect(studyKeys.has(s), `${a.key} -> ${s}`).toBe(true);
  });

  it("the validation activities link to the study families they imply", () => {
    const studies = (key: string) => content.catalog.activities.find((a) => a.key === key)?.studies ?? [];
    expect(studies("ppq")).toContain("ppq");
    expect(studies("media_fill")).toContain("aps");
    expect(studies("filter_bacterial_retention")).toContain("bacterial_retention");
    expect(studies("hold_time_study")).toEqual(expect.arrayContaining(["hold_time", "filtered_hold"]));
    expect(studies("cleaning_validation")).toContain("cleaning");
    expect(studies("cci_study")).toContain("cci");
    expect(studies("extractables_leachables")).toEqual(expect.arrayContaining(["sua_el", "container_el"]));
    expect(studies("shipping_validation")).toContain("shipping_validation");
  });
});

// ------------------------------------------------------------------ gating of each study family

describe("milestone 3 gating of the study families", () => {
  // PPQ
  it("asks for the PPQ approach only when the pump, batch size or container format changes", () => {
    const run = (pump: AnswerInput | "same", batch: number, container: AnswerInput | "same" = "same"): Set<string> =>
      visibleIds([
        ...base, ...fill, ...comp,
        ...pair("fill.pump", "rotary_piston", pump),
        ...pair("comp.batch_size", undefined, "same").slice(0, 0),
        ["comp.batch_size", "source", param([60, "L"], [50, 60], [40, 60])],
        ["comp.batch_size", "target", batch === 60 ? same : param([batch, "L"], [batch - 10, batch])],
        ...pair("fill.container", "2R", container),
      ]);
    expect(run("same", 60).has("fill.ppq_strategy")).toBe(false);
    expect(run(val("peristaltic"), 60).has("fill.ppq_strategy")).toBe(true);
    expect(run("same", 150).has("fill.ppq_strategy")).toBe(true);
    expect(run("same", 60, val("6R")).has("fill.ppq_strategy")).toBe(true);
  });

  it("asks for the number of PPQ batches only for a full or reduced PPQ", () => {
    const run = (strategy?: string) =>
      visibleIds([
        ...base, ...fill, ...pair("fill.pump", "rotary_piston", val("peristaltic")),
        ...(strategy ? ([["fill.ppq_strategy", "target", val(strategy)]] as Step[]) : []),
      ]);
    expect(run().has("fill.ppq_batches")).toBe(false);
    expect(run("full_ppq").has("fill.ppq_batches")).toBe(true);
    expect(run("reduced_bridging").has("fill.ppq_batches")).toBe(true);
    expect(run("source_data_leveraged").has("fill.ppq_batches")).toBe(false);
    expect(run("not_decided").has("fill.ppq_batches")).toBe(false);
  });

  // APS
  it("always asks about APS initial runs and interventions, and asks APS scope only when the configuration changes", () => {
    const unchanged = visibleIds([...base, ...fill, ...pair("fill.pump", "rotary_piston", "same")]);
    expect(unchanged.has("fill.aps_runs")).toBe(true);
    expect(unchanged.has("fill.aps_interventions")).toBe(true);
    expect(unchanged.has("fill.aps_scope")).toBe(false);
    expect(visibleIds([...base, ...fill, ...pair("fill.pump", "rotary_piston", val("peristaltic"))]).has("fill.aps_scope")).toBe(true);
    expect(visibleIds([...base, ...fill, ...pair("fill.stopper", "Stopper Vendor D, STP-20-DEMO", val("Stopper Vendor Z (fictional)"))]).has("fill.aps_scope")).toBe(true);
  });

  // Filter validation
  it("asks for bacterial retention test conditions when the filter, pressure or batch size is more demanding", () => {
    const run = (extra: Step[]) => visibleIds([...base, ...filt, ...comp, ...extra]);
    const filterSame = pair("filt.supplier", "Filter Vendor A (fictional)", "same");
    const filterChanged = pair("filt.supplier", "Filter Vendor A (fictional)", val("Filter Vendor B (fictional)"));
    const batchSame: Step[] = [["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", same]];
    const batchLarger: Step[] = [["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])]];
    expect(run([...filterSame, ...batchSame]).has("filt.bret_conditions")).toBe(false);
    expect(run([...filterChanged, ...batchSame]).has("filt.bret_conditions")).toBe(true);
    expect(run([...filterSame, ...batchLarger]).has("filt.bret_conditions")).toBe(true);
    const pressure = (target: AnswerInput): Step[] => [["filt.pressure", "source", param([1.5, "bar"], [1, 2], [0.5, 2.5])], ["filt.pressure", "target", target]];
    expect(run([...filterSame, ...batchSame, ...pressure(param([2.2, "bar"], [2, 2.4]))]).has("filt.bret_conditions")).toBe(true);
  });

  it("asks for the product-wet integrity specification only when the filter or the integrity test method changes", () => {
    const filterSame = pair("filt.supplier", "Filter Vendor A (fictional)", "same");
    expect(visibleIds([...base, ...filt, ...filterSame, ...pair("filt.integrity_method", "bubble_point", "same")]).has("filt.integrity_validation")).toBe(false);
    expect(visibleIds([...base, ...filt, ...filterSame, ...pair("filt.integrity_method", "bubble_point", val("diffusive_flow"))]).has("filt.integrity_validation")).toBe(true);
    expect(
      visibleIds([...base, ...filt, ...pair("filt.supplier", "Filter Vendor A (fictional)", val("Filter Vendor B (fictional)")), ...pair("filt.integrity_method", "bubble_point", "same")]).has("filt.integrity_validation"),
    ).toBe(true);
  });

  // Hold times
  it("asks for hold study coverage and endpoints only when the bulk hold time increases", () => {
    const run = (target: number) =>
      visibleIds([
        ...base, ...comp,
        ["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])],
        ["comp.hold_time", "source", val(q(24, "h"))], ["comp.hold_time", "target", val(q(target, "h"))],
      ]);
    for (const id of ["comp.hold_cov", "comp.hold_basis"]) {
      expect(run(36).has(id), `${id} longer`).toBe(true);
      expect(run(24).has(id), `${id} same`).toBe(false);
      expect(run(12).has(id), `${id} shorter`).toBe(false);
    }
  });

  it("asks for filtered bulk hold study coverage only when the filtered bulk hold time increases", () => {
    const run = (target: number) => visibleIds([...base, ...fill, ["fill.filtered_hold", "source", val(q(12, "h"))], ["fill.filtered_hold", "target", val(q(target, "h"))]]);
    expect(run(18).has("fill.filtered_hold_cov")).toBe(true);
    expect(run(12).has("fill.filtered_hold_cov")).toBe(false);
    expect(run(8).has("fill.filtered_hold_cov")).toBe(false);
  });

  // Cleaning
  it("asks for cleaning validation only when the target uses reusable product-contact equipment", () => {
    const ids = ["fill.cleaning", "fill.cleaning_worst", "fill.cleaning_carryover"];
    const run = (vessel: string, pump: string) => visibleIds([...base, ...fill, ...pair("fill.bulk_vessel", "stainless_tank", val(vessel)), ...pair("fill.pump", "rotary_piston", val(pump))]);
    for (const id of ids) {
      expect(run("single_use_bag", "peristaltic").has(id), `${id} single-use`).toBe(false);
      expect(run("stainless_tank", "peristaltic").has(id), `${id} stainless vessel`).toBe(true);
      expect(run("glass", "peristaltic").has(id), `${id} glass vessel`).toBe(true);
      expect(run("single_use_bag", "rotary_piston").has(id), `${id} reusable pump`).toBe(true);
    }
    const vessel = (type: string) => visibleIds([...base, ...comp, ...pair("comp.vessel_type", "stainless_tank", val(type))]);
    expect(vessel("single_use_bag").has("comp.cleaning")).toBe(false);
    expect(vessel("stainless_tank").has("comp.cleaning")).toBe(true);
  });

  // CCI
  it("asks for CCI method validation only when the CCI test method changes", () => {
    const run = (target: AnswerInput | "same") => visibleIds([...base, ...cap, ...pair("cap.cci_method", "dye_ingress", target)]);
    expect(run(val("hvld")).has("cap.cci_method_validation")).toBe(true);
    expect(run("same").has("cap.cci_method_validation")).toBe(false);
    // The method and the sensitivity are always asked when capping applies.
    expect(run("same").has("cap.cci_method")).toBe(true);
    expect(run("same").has("cap.cci_sensitivity")).toBe(true);
  });

  it("asks for CCI over shelf life when the method, container format, capper or shipper changes", () => {
    const method = (t: AnswerInput | "same") => visibleIds([...base, ...cap, ...pair("cap.cci_method", "dye_ingress", t)]).has("cap.cci_lifecycle");
    expect(method(val("hvld"))).toBe(true);
    expect(method("same")).toBe(false);
    expect(visibleIds([...base, ...cap, ...ship, ...pair("ss.shipper", "passive_insulated", val("active_container"))]).has("cap.cci_lifecycle")).toBe(true);
  });

  // E&L
  it("asks the E&L data source and risk outcome only when a single-use assembly is new at the target", () => {
    const run = (target: string) => visibleIds([...base, ...filt, ...pair("filt.sua", "no", val(target))]);
    for (const id of ["filt.sua_el", "filt.sua_el_source", "filt.sua_el_risk"]) {
      expect(run("yes").has(id), `${id} new`).toBe(true);
      expect(run("no").has(id), `${id} not used`).toBe(false);
    }
    expect(visibleIds([...base, ...filt, ...pair("filt.sua", "yes", "same")]).has("filt.sua_el_source")).toBe(false);
  });

  it("asks for container closure E&L data only when the container format, supplier or stopper changes", () => {
    const run = (extra: Step[]) => visibleIds([...base, ...fill, ...extra]);
    expect(run([...pair("fill.container", "2R", "same"), ...pair("fill.container_supplier", "Glass Vendor C (fictional)", "same")]).has("fill.container_el")).toBe(false);
    expect(run(pair("fill.container", "2R", val("6R"))).has("fill.container_el")).toBe(true);
    expect(run(pair("fill.container_supplier", "Glass Vendor C (fictional)", val("Glass Vendor Y (fictional)"))).has("fill.container_el")).toBe(true);
    expect(run(pair("fill.stopper", "Stopper Vendor D, STP-20-DEMO", val("Stopper Vendor Z (fictional)"))).has("fill.container_el")).toBe(true);
  });

  // Shipping
  it("asks for the shipping qualification scope and seasonal profiles when the shipper, lane or transport modes change", () => {
    const run = (shipper: AnswerInput | "same", lane: AnswerInput | "same", modes: AnswerInput | "same") =>
      visibleIds([...base, ...ship, ...pair("ss.shipper", "passive_insulated", shipper), ...pair("ss.lane", "Lane A (fictional)", lane), ...pair("ss.modes", ["road"], modes)]);
    for (const id of ["ss.ship_scope", "ss.ship_profiles"]) {
      expect(run("same", "same", "same").has(id), `${id} unchanged`).toBe(false);
      expect(run(val("active_container"), "same", "same").has(id), `${id} shipper`).toBe(true);
      expect(run("same", val("Lane B (fictional)"), "same").has(id), `${id} lane`).toBe(true);
      expect(run("same", "same", val(["road", "air"])).has(id), `${id} modes`).toBe(true);
    }
  });

  // Equipment qualification
  it("asks for the qualified range only when the target equipment is qualified or planned", () => {
    const run = (target: string) => visibleIds([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", val(target))]);
    for (const id of ["fill.filler_speed_range", "fill.filler_volume_range"]) {
      expect(run("not_qualified").has(id), `${id} not qualified`).toBe(false);
      for (const status of ["planned", "iq_complete", "oq_complete", "pq_complete", "requalification_due"]) {
        expect(run(status).has(id), `${id} ${status}`).toBe(true);
      }
    }
    expect(visibleIds([...base, ...fill]).has("fill.filler_qual")).toBe(true);
  });

  it("hides the thaw system and lyophilizer qualification for a liquid product with liquid drug substance", () => {
    const liquid = visibleIds([...base, ...presence("rt.presence")]);
    expect(liquid.has("rt.thaw_qual")).toBe(false);
    expect(liquid.has("rt.storage_qual")).toBe(true);
    expect(visibleIds([...scoping("liquid", "frozen"), ...presence("rt.presence")]).has("rt.thaw_qual")).toBe(true);
    expect(visibleIds([...base, ...presence("lyo.presence")]).has("lyo.qual")).toBe(false);
    expect(visibleIds([...scoping("lyophilized"), ...presence("lyo.presence")]).has("lyo.qual")).toBe(true);
  });
});

// ------------------------------------------------------------------ classifications

describe("milestone 3 classifications", () => {
  it("classifies a filtered bulk hold longer than the validated hold as outside the validated range, with a regulatory note", () => {
    const g = gapOf([...base, ...fill, ...pair("fill.filtered_hold", q(12, "h"), val(q(18, "h")))], "R-FILTERED-HOLD:uo.aseptic_filling.param.max_filtered_hold.max");
    expect(g?.category).toBe("outside_validated_range");
    expect(g?.activities).toContain("hold_time_study");
    expect(g?.regulatoryNote).toBe("Requires regulatory affairs assessment.");
    const within = gapOf([...base, ...fill, ...pair("fill.filtered_hold", q(12, "h"), val(q(8, "h")))], "R-FILTERED-HOLD:uo.aseptic_filling.param.max_filtered_hold.max");
    expect(within?.category).toBe("within_validated_range");
  });

  it("classifies a hold time outside the study coverage as outside the validated range", () => {
    const bulk = (coverage: number) =>
      gapOf(
        [
          ...base, ...comp,
          ["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])],
          ["comp.hold_time", "source", val(q(24, "h"))], ["comp.hold_time", "target", val(q(36, "h"))],
          ["comp.hold_cov", "target", val(q(coverage, "h"))],
        ],
        "R-HOLD-COVERAGE-BULK:uo.compounding.study.hold_time.coverage",
      );
    expect(bulk(24)?.category).toBe("outside_validated_range");
    expect(bulk(24)?.activities).toEqual(["hold_time_study"]);
    expect(bulk(48)?.category).toBe("within_validated_range");
    // Units are converted: 2 d covers 36 h.
    expect(
      gapOf(
        [...base, ...comp, ["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])],
          ["comp.hold_time", "source", val(q(24, "h"))], ["comp.hold_time", "target", val(q(36, "h"))], ["comp.hold_cov", "target", val(q(2, "d"))]],
        "R-HOLD-COVERAGE-BULK:uo.compounding.study.hold_time.coverage",
      )?.category,
    ).toBe("within_validated_range");

    const filtered = (coverage: number) =>
      gapOf(
        [...base, ...fill, ...pair("fill.filtered_hold", q(12, "h"), val(q(18, "h"))), ["fill.filtered_hold_cov", "target", val(q(coverage, "h"))]],
        "R-HOLD-COVERAGE-FILTERED:uo.aseptic_filling.study.filtered_hold.coverage",
      );
    expect(filtered(12)?.category).toBe("outside_validated_range");
    expect(filtered(18)?.category).toBe("within_validated_range");
  });

  it("classifies a hold study with missing endpoints as outside the validated range", () => {
    const basis = (answer: string) =>
      gapOf(
        [
          ...base, ...comp,
          ["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])],
          ["comp.hold_time", "source", val(q(24, "h"))], ["comp.hold_time", "target", val(q(36, "h"))],
          ["comp.hold_basis", "target", val(answer)],
        ],
        "R-EV-HOLD-BASIS:uo.compounding.study.hold_time.basis",
      );
    expect(basis("full_study")?.category).toBe("within_validated_range");
    expect(basis("partial_study")?.category).toBe("outside_validated_range");
  });

  it("classifies a change of CCI method as a different principle", () => {
    const method = (target: AnswerInput | "same") => gapOf([...base, ...cap, ...pair("cap.cci_method", "dye_ingress", target)], "R-CCI-METHOD:uo.capping.study.cci.method");
    expect(method(val("hvld"))?.category).toBe("different_principle");
    expect(method(val("hvld"))?.activities).toEqual(expect.arrayContaining(["cci_method_validation", "cci_study"]));
    expect(method("same")?.category).toBe("equivalent");
  });

  it("compares the CCI detection limit: a less sensitive target method is outside the validated range", () => {
    const limit = (target: number) => gapOf([...base, ...cap, ...pair("cap.cci_sensitivity", q(10, "µm"), val(q(target, "µm")))], "R-CCI-SENSITIVITY:uo.capping.study.cci.sensitivity");
    expect(limit(5)?.category).toBe("within_validated_range");
    expect(limit(20)?.category).toBe("outside_validated_range");
    // 0.02 mm is 20 µm.
    expect(gapOf([...base, ...cap, ...pair("cap.cci_sensitivity", q(10, "µm"), val(q(0.02, "mm")))], "R-CCI-SENSITIVITY:uo.capping.study.cci.sensitivity")?.category).toBe("outside_validated_range");
  });

  it("classifies APS initial runs and interventions", () => {
    const runs = (target: number) => gapOf([...base, ...fill, ...pair("fill.aps_runs", q(3, "count"), val(q(target, "count")))], "R-APS-INITIAL-RUNS:uo.aseptic_filling.study.aps.initialRuns");
    expect(runs(3)?.category).toBe("equivalent");
    expect(runs(2)?.category).toBe("outside_validated_range");
    const interventions = (target: number) => gapOf([...base, ...fill, ...pair("fill.aps_interventions", q(12, "count"), val(q(target, "count")))], "R-APS-INTERVENTIONS:uo.aseptic_filling.param.max_interventions.max");
    expect(interventions(16)?.category).toBe("outside_validated_range");
    expect(interventions(10)?.category).toBe("within_validated_range");
  });

  it("maps the PPQ approach, E&L, cleaning and shipping answers to categories", () => {
    const ppq = (answer: string) =>
      gapOf([...base, ...fill, ...pair("fill.pump", "rotary_piston", val("peristaltic")), ["fill.ppq_strategy", "target", val(answer)]], "R-PPQ-STRATEGY:uo.aseptic_filling.study.ppq.strategy")?.category;
    expect(ppq("full_ppq")).toBe("new_requirement");
    expect(ppq("reduced_bridging")).toBe("outside_validated_range");
    expect(ppq("source_data_leveraged")).toBe("within_validated_range");
    expect(ppq("not_decided")).toBe("information_required");

    const el = (answer: string) => gapOf([...base, ...filt, ...pair("filt.sua", "no", val("yes")), ["filt.sua_el_source", "target", val(answer)]], "R-EL-DATA-SOURCE:uo.sterile_filtration.study.sua_el.dataSource")?.category;
    expect(el("product_specific_study")).toBe("within_validated_range");
    expect(el("supplier_data")).toBe("outside_validated_range");

    const clean = (answer: string) =>
      gapOf([...base, ...fill, ...pair("fill.bulk_vessel", "stainless_tank", "same"), ["fill.cleaning_carryover", "target", val(answer)]], "R-CLEAN-CARRYOVER:uo.aseptic_filling.study.cleaning.carryover")?.category;
    expect(clean("health_based_limits")).toBe("within_validated_range");
    expect(clean("visual_rinse_only")).toBe("outside_validated_range");

    const scope = (answer: string) =>
      gapOf([...base, ...ship, ...pair("ss.shipper", "passive_insulated", val("active_container")), ["ss.ship_scope", "target", val(answer)]], "R-SHIP-SCOPE:uo.storage_shipping.study.shipping_validation.scope")?.category;
    expect(scope("lane_performance_qualified")).toBe("within_validated_range");
    expect(scope("desk_based")).toBe("outside_validated_range");
  });

  it("reports an added transport mode as a new requirement", () => {
    const g = gapOf([...base, ...ship, ...pair("ss.modes", ["road"], val(["road", "air"]))], "R-SHIP-MODES:uo.storage_shipping.doc.shipping_lane.modes#air");
    expect(g?.category).toBe("new_requirement");
    expect(g?.activities).toContain("shipping_validation");
  });
});

// ------------------------------------------------------------------ equipment qualification

describe("milestone 3 equipment qualification", () => {
  const FILLER_STATUS = "R-EQ-STATUS:uo.aseptic_filling.equip.filler.qualificationStatus";
  const FILLER_SPEED = "R-EQ-RANGE-FILLER-SPEED:uo.aseptic_filling.equip.filler.qualifiedRange_speed";
  const speeds = (): Step[] => [["fill.speed", "source", param([200, "units/min"], [180, 220], [150, 240])], ["fill.speed", "target", param([300, "units/min"], [280, 320])]];

  it("has a qualification status question for every major equipment item", () => {
    const bound = new Set(content.questions.filter((x) => x.binds.endsWith(".qualificationStatus")).map((x) => x.binds));
    for (const path of [
      "uo.ds_receipt_thaw.equip.thaw_unit", "uo.ds_receipt_thaw.equip.ds_storage", "uo.compounding.equip.vessel", "uo.compounding.equip.mixer",
      "uo.sterile_filtration.equip.integrity_tester", "uo.aseptic_filling.equip.filler", "uo.aseptic_filling.equip.bulk_vessel",
      "uo.stoppering.equip.stoppering_unit", "uo.lyophilization.equip.lyophilizer", "uo.lyophilization.equip.loading_system",
      "uo.capping.equip.capper", "uo.visual_inspection.equip.inspection", "uo.labeling_packaging.equip.labeler",
      "uo.labeling_packaging.equip.serialization", "uo.storage_shipping.equip.storage_unit", "uo.storage_shipping.equip.shipper",
    ]) {
      expect(bound.has(`${path}.qualificationStatus`), path).toBe(true);
    }
  });

  it("every qualification status question is paired and uses the equipQualification option set", () => {
    for (const x of content.questions.filter((y) => y.binds.endsWith(".qualificationStatus"))) {
      expect(x.sides, x.id).toBe("paired");
      expect(x.input.optionsFrom, x.id).toBe("equipQualification");
    }
    expect((content.catalog.optionSets.equipQualification ?? []).map((o) => o.value)).toEqual([
      "not_qualified", "planned", "iq_complete", "oq_complete", "pq_complete", "requalification_due",
    ]);
  });

  it("every qualified range question is target-side, checked by a coverage rule against a real parameter of the same unit operation", () => {
    const rangeQs = content.questions.filter((x) => /\.equip\.[a-z_]+\.qualifiedRange(_[a-z_]+)?$/.test(x.binds));
    expect(rangeQs.length).toBeGreaterThanOrEqual(10);
    const items = new Set(content.catalog.unitOperations.flatMap((u) => u.items.map((i) => `uo.${u.key}.${i.coll}.${i.key}`)));
    for (const x of rangeQs) {
      expect(x.sides, x.id).toBe("target");
      expect(x.input.type, x.id).toBe("range");
      const rule = findRule(content.rules, x.binds)!;
      expect(rule.comparator, x.id).toBe("coverage");
      expect(rule.config.coverageSide, x.id).toBe("target");
      expect(rule.config.against?.side, x.id).toBe("target");
      const against = rule.config.against!.path;
      expect(against.split(".").slice(0, 2).join("."), x.id).toBe(x.binds.split(".").slice(0, 2).join("."));
      expect(items.has(against.split(".").slice(0, 4).join(".")), `${x.id} -> ${against}`).toBe(true);
    }
  });

  it("classifies a target filler that is only planned, against a qualified source, as a new requirement", () => {
    const g = gapOf([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", val("planned"))], FILLER_STATUS);
    expect(g?.category).toBe("new_requirement");
    expect(g?.activities).toContain("equipment_qualification");
    expect(gapOf([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", val("not_qualified"))], FILLER_STATUS)?.category).toBe("new_requirement");
    expect(gapOf([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", val("oq_complete"))], FILLER_STATUS)?.category).toBe("new_requirement");
    expect(g?.regulatoryNote).toBeUndefined();
  });

  it("classifies equal qualification status as equivalent and an unknown target status as information required", () => {
    expect(gapOf([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", val("pq_complete"))], FILLER_STATUS)?.category).toBe("equivalent");
    const unknownTarget = gapOf([...base, ...fill, ...pair("fill.filler_qual", "pq_complete", unknown)], FILLER_STATUS);
    expect(unknownTarget?.category).toBe("information_required");
    expect(unknownTarget?.activities).toEqual(["information_gathering"]);
    expect(gapOf([...base, ...fill, ["fill.filler_qual", "source", unknown], ["fill.filler_qual", "target", val("pq_complete")]], FILLER_STATUS)?.category).toBe("information_required");
  });

  it("classifies a qualified range that does not cover the target process range as outside the validated range", () => {
    const run = (min: number, max: number) =>
      gapOf([...base, ...fill, ...speeds(), ...pair("fill.filler_qual", "pq_complete", val("pq_complete")), ["fill.filler_speed_range", "target", range(min, max, "units/min")]], FILLER_SPEED);
    // The target normal operating range is 280 to 320 units/min.
    const outside = run(150, 250);
    expect(outside?.category).toBe("outside_validated_range");
    expect(outside?.activities).toEqual(["equipment_qualification", "equipment_requalification"]);
    expect(run(250, 350)?.category).toBe("within_validated_range");
    expect(run(280, 320)?.category).toBe("within_validated_range");
    expect(run(290, 350)?.category).toBe("outside_validated_range");
    // Units are converted: 12000 to 21000 units/h is 200 to 350 units/min.
    expect(gapOf([...base, ...fill, ...speeds(), ...pair("fill.filler_qual", "pq_complete", val("pq_complete")), ["fill.filler_speed_range", "target", range(12000, 21000, "units/h")]], FILLER_SPEED)?.category).toBe("within_validated_range");
  });

  it("checks the filler volume range against the target fill volume in another unit", () => {
    const volume = (min: number, max: number) =>
      gapOf(
        [
          ...base, ...fill,
          ["fill.volume", "source", param([1.2, "mL"], [1.18, 1.22], [1.15, 1.25])], ["fill.volume", "target", param([1200, "µL"], [1180, 1220])],
          ...pair("fill.filler_qual", "pq_complete", val("planned")),
          ["fill.filler_volume_range", "target", range(min, max, "mL")],
        ],
        "R-EQ-RANGE-FILLER-VOLUME:uo.aseptic_filling.equip.filler.qualifiedRange_volume",
      );
    expect(volume(0.8, 2)?.category).toBe("within_validated_range");
    expect(volume(1.3, 2)?.category).toBe("outside_validated_range");
  });

  it("reports information required when the target process value is missing for the range check", () => {
    const g = gapOf(
      [...base, ...fill, ["fill.speed", "source", param([200, "units/min"], [180, 220], [150, 240])], ["fill.speed", "target", unknown], ...pair("fill.filler_qual", "pq_complete", val("pq_complete")), ["fill.filler_speed_range", "target", range(150, 350, "units/min")]],
      FILLER_SPEED,
    );
    expect(g?.category).toBe("information_required");
  });

  it("checks the shipper qualified duration against the planned transit time", () => {
    const run = (maxHours: number) =>
      gapOf(
        [...base, ...ship, ...pair("ss.transit", q(48, "h"), val(q(72, "h"))), ...pair("ss.shipper_qual", "pq_complete", val("oq_complete")), ["ss.shipper_range", "target", range(12, maxHours, "h")]],
        "R-EQ-RANGE-SHIPPER:uo.storage_shipping.equip.shipper.qualifiedRange",
      );
    expect(run(60)?.category).toBe("outside_validated_range");
    expect(run(96)?.category).toBe("within_validated_range");
  });

  it("checks the vessel qualified working volume against the target batch size", () => {
    const run = (min: number, max: number) =>
      gapOf(
        [...base, ...comp, ["comp.batch_size", "source", param([60, "L"], [50, 60])], ["comp.batch_size", "target", param([150, "L"], [120, 150])], ...pair("comp.vessel_qual", "pq_complete", val("oq_complete")), ["comp.vessel_range", "target", range(min, max, "L")]],
        "R-EQ-RANGE-VESSEL:uo.compounding.equip.vessel.qualifiedRange",
      );
    expect(run(100, 200)?.category).toBe("within_validated_range");
    expect(run(20, 100)?.category).toBe("outside_validated_range");
  });
});

// ------------------------------------------------------------------ audit of the rules

describe("rules audit", () => {
  const activityKeys = new Set(content.catalog.activities.map((a) => a.key));

  it("every activity has a unique key, a label and a plain-English description", () => {
    expect(activityKeys.size).toBe(content.catalog.activities.length);
    for (const a of content.catalog.activities) {
      expect(a.key, a.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(a.label.trim().length, `${a.key} label`).toBeGreaterThan(3);
      expect(a.description.trim().length, `${a.key} description`).toBeGreaterThan(20);
    }
  });

  it("the new M3 activities exist", () => {
    for (const key of ["equipment_requalification", "cleaning_validation", "cci_method_validation", "filter_integrity_validation"]) {
      expect(activityKeys.has(key), key).toBe(true);
    }
  });

  // The categories each comparator can return, other than equivalent. information_required carries
  // the engine default activity (information_gathering); within_validated_range is a "no further
  // study" outcome and defaults to no activities by design.
  function reachable(rule: (typeof content.rules)[number]): string[] {
    switch (rule.comparator) {
      case "enum":
      case "text":
        return [rule.config.differentAs ?? "different_principle", "information_required"];
      case "presence":
        return ["new_requirement", "removed_element", "information_required"];
      case "set":
        return ["new_requirement", "removed_element", "information_required"];
      case "range":
        return ["within_validated_range", "outside_validated_range", "information_required"];
      case "scale":
        return ["within_validated_range", "scale_change", "information_required"];
      case "upper_limit":
      case "lower_limit":
      case "coverage":
        return ["within_validated_range", "outside_validated_range", "information_required"];
      case "evidence":
        return [...new Set([...Object.values(rule.config.map ?? {}), "information_required"])];
      default:
        return [];
    }
  }

  function effectiveActivities(rule: (typeof content.rules)[number], category: string): string[] {
    const outcome = (rule.outcomes as Record<string, { activities?: string[] } | undefined>)[category];
    if (outcome?.activities) return outcome.activities;
    if (category === "information_required") return ["information_gathering"];
    if (category === "within_validated_range") return [];
    return rule.activities;
  }

  it("every non-equivalent outcome that calls for work lists at least one activity", () => {
    for (const rule of content.rules) {
      for (const category of reachable(rule)) {
        if (category === "equivalent" || category === "within_validated_range") continue;
        const activities = effectiveActivities(rule, category);
        expect(activities.length, `${rule.id} / ${category}`).toBeGreaterThan(0);
        for (const a of activities) expect(activityKeys.has(a), `${rule.id} / ${category}: ${a}`).toBe(true);
      }
    }
  });

  it("every rule that reports a gap names at least one activity", () => {
    for (const rule of content.rules.filter((r) => r.comparator !== "informational")) {
      const named = [...rule.activities, ...Object.values(rule.outcomes).flatMap((o) => o?.activities ?? [])];
      expect(named.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("an informational rule names no activity and reports no severity", () => {
    for (const rule of content.rules.filter((r) => r.comparator === "informational")) {
      expect(rule.activities, rule.id).toEqual([]);
      expect(rule.severity, rule.id).toBe("none");
    }
  });

  it("every rule has a title, a version and a non-empty why", () => {
    for (const rule of content.rules) {
      expect(rule.title.trim().length, rule.id).toBeGreaterThan(3);
      expect(rule.why.trim().length, rule.id).toBeGreaterThan(20);
      expect(rule.version, rule.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("the regulatory flag is set only on rules about registered or registered-adjacent information", () => {
    const flagged = new Set(content.rules.filter((r) => r.regulatory).map((r) => r.id));
    // Equipment qualification, cleaning, shipping scope and APS run counts are not registered information.
    for (const id of ["R-EQ-STATUS", "R-EQ-RANGE-FILLER-SPEED", "R-EV-CLEANING", "R-CLEAN-CARRYOVER", "R-SHIP-SCOPE", "R-SHIP-MODES", "R-APS-INITIAL-RUNS", "R-PPQ-STRATEGY"]) {
      expect(flagged.has(id), id).toBe(false);
    }
    for (const id of ["R-FILTERED-HOLD", "R-CCI-METHOD", "R-EV-BRET-CONDITIONS", "R-EL-RISK"]) {
      expect(flagged.has(id), id).toBe(true);
    }
  });
});
