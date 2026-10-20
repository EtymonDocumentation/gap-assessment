import { applyAnswer, assess, buildDemoProject, findRule, type AnswerInput, type FieldAnswer } from "@gap/engine";
import { emptyProject, type Actor, type Project } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

// Tests for the milestone 2 unit operations. Projects are built through the engine by replaying
// answers with applyAnswer, exactly as the interview (and the demo builder) does.

const actor: Actor = { name: "Test Responder (fictional)", at: "2026-10-01T09:00:00.000Z" };
type Side = "shared" | "source" | "target";
type Step = [id: string, side: Side, input: AnswerInput];

const val = (value: unknown): AnswerInput => ({ kind: "value", value: value as never });
const same: AnswerInput = { kind: "same_as_source" };
const unknown: AnswerInput = { kind: "unknown" };
const q = (value: number, unit: string) => ({ value, unit });
const fv = (value: unknown): FieldAnswer => ({ kind: "value", value: value as never });

function param(setPoint: [number, string], nor: [number, number], par?: [number, number]): AnswerInput {
  const unit = setPoint[1];
  const fields: Record<string, FieldAnswer> = {
    setPoint: fv(q(setPoint[0], unit)),
    nor: fv({ min: q(nor[0], unit), max: q(nor[1], unit) }),
  };
  if (par) {
    fields.par = fv({ min: q(par[0], unit), max: q(par[1], unit) });
    fields.classification = fv("CPP");
    fields.rangeBasis = fv("PPQ");
  }
  return { kind: "composite", fields } as AnswerInput;
}

function scoping(dosageForm: string, dsState: string): Step[] {
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
  let project = emptyProject({ title: "M2 test (fictional)", actor, contentRefs: content.versions, entrySequence: "paired" });
  for (const [id, side, input] of steps) {
    const question = content.questionById.get(id);
    if (!question) throw new Error(`test setup: unknown question ${id}`);
    const section = content.sectionById.get(question.section)!;
    project = applyAnswer(project, content, { key: `${id}@${side}`, question, side, section, depth: 0 }, input, actor, { docRefs: [] });
  }
  return project;
}

const presence = (id: string): Step[] => [[id, "source", val("yes")], [id, "target", val("yes")]];
const visibleIds = (steps: Step[]) => new Set(assess(content, build(steps)).instances.map((i) => i.question.id));
const visibleSections = (steps: Step[]) => new Set(assess(content, build(steps)).instances.map((i) => i.section.id));
const gapOf = (steps: Step[], key: string) => assess(content, build(steps)).gaps.find((g) => g.key === key);

const NEW_PREFIXES = ["rt.", "stop.", "lyo.", "vi.", "lp.", "ss."];
const newQuestions = content.questions.filter((x) => NEW_PREFIXES.some((p) => x.id.startsWith(p)));

// ------------------------------------------------------------------ section gating

describe("milestone 2 sections", () => {
  it("shows lyophilization and stoppering for a lyophilized product", () => {
    const sections = visibleSections(scoping("lyophilized", "liquid"));
    expect(sections.has("uo.lyophilization")).toBe(true);
    expect(sections.has("uo.stoppering")).toBe(true);
  });

  it("hides lyophilization and stoppering for the liquid demo product", () => {
    const demoSections = new Set(assess(content, buildDemoProject(content, demos["arx-217"])).instances.map((i) => i.section.id));
    expect(demoSections.has("uo.lyophilization")).toBe(false);
    expect(demoSections.has("uo.stoppering")).toBe(false);
    expect(visibleSections(scoping("liquid", "liquid")).has("uo.lyophilization")).toBe(false);
  });

  it("shows the thaw questions only for frozen drug substance", () => {
    const thaw = ["rt.thaw_principle", "rt.thaw_capacity", "rt.thaw_temp", "rt.thaw_duration", "rt.ambient_time", "rt.mixing"];
    const frozen = visibleIds([...scoping("liquid", "frozen"), ...presence("rt.presence")]);
    for (const id of thaw) expect(frozen.has(id), `${id} frozen`).toBe(true);
    const liquid = visibleIds([...scoping("liquid", "liquid"), ...presence("rt.presence")]);
    for (const id of thaw) expect(liquid.has(id), `${id} liquid`).toBe(false);
    // The container and storage questions apply to both states.
    expect(liquid.has("rt.container")).toBe(true);
  });
});

// ------------------------------------------------------------------ follow-up branching

describe("milestone 2 follow-up questions", () => {
  const base = scoping("liquid", "liquid");

  it("asks for automated inspection qualification only when the method changes to an automated one", () => {
    const changed = visibleIds([...base, ...presence("vi.presence"), ["vi.method", "source", val("manual")], ["vi.method", "target", val("automated")]]);
    expect(changed.has("vi.avi_qualification")).toBe(true);
    expect(changed.has("vi.inspector_qualification")).toBe(false);
    const unchanged = visibleIds([...base, ...presence("vi.presence"), ["vi.method", "source", val("manual")], ["vi.method", "target", same]]);
    expect(unchanged.has("vi.avi_qualification")).toBe(false);
    expect(unchanged.has("vi.inspector_qualification")).toBe(false);
    const toManual = visibleIds([...base, ...presence("vi.presence"), ["vi.method", "source", val("automated")], ["vi.method", "target", val("manual")]]);
    expect(toManual.has("vi.inspector_qualification")).toBe(true);
    expect(toManual.has("vi.avi_qualification")).toBe(false);
  });

  it("asks for stability support only when the storage condition changes", () => {
    const changed = visibleIds([...base, ...presence("ss.presence"), ["ss.condition", "source", val("refrigerated")], ["ss.condition", "target", val("frozen_20")]]);
    expect(changed.has("ss.stability")).toBe(true);
    const unchanged = visibleIds([...base, ...presence("ss.presence"), ["ss.condition", "source", val("refrigerated")], ["ss.condition", "target", same]]);
    expect(unchanged.has("ss.stability")).toBe(false);
  });

  it("asks for shipping qualification when the lane changes, but not when shipper and lane are unchanged", () => {
    const lane = (target: AnswerInput): Step[] => [
      ...base, ...presence("ss.presence"),
      ["ss.shipper", "source", val("passive_insulated")], ["ss.shipper", "target", same],
      ["ss.lane", "source", val("Lane A (fictional)")], ["ss.lane", "target", target],
    ];
    expect(visibleIds(lane(val("Lane B (fictional)"))).has("ss.shipping_validation")).toBe(true);
    expect(visibleIds(lane(same)).has("ss.shipping_validation")).toBe(false);
  });

  it("asks for time-out-of-refrigeration evidence only when the limit increases", () => {
    const tor = (target: number): Step[] => [
      ...base, ...presence("lp.presence"),
      ["lp.time_out", "source", val(q(4, "h"))], ["lp.time_out", "target", val(q(target, "h"))],
    ];
    expect(visibleIds(tor(6)).has("lp.tor_evidence")).toBe(true);
    expect(visibleIds(tor(4)).has("lp.tor_evidence")).toBe(false);
    expect(visibleIds(tor(2)).has("lp.tor_evidence")).toBe(false);
  });

  it("asks for cycle verification and APS coverage when the shelf area or loading method changes", () => {
    const lyo = scoping("lyophilized", "liquid");
    const shelf = (target: AnswerInput): Step[] => [...lyo, ...presence("lyo.presence"), ["lyo.shelf_area", "source", val(q(2, "m²"))], ["lyo.shelf_area", "target", target]];
    const bigger = visibleIds(shelf(val(q(4, "m²"))));
    expect(bigger.has("lyo.cycle_verification")).toBe(true);
    expect(bigger.has("lyo.aps_loading")).toBe(true);
    const unchanged = visibleIds(shelf(same));
    expect(unchanged.has("lyo.cycle_verification")).toBe(false);
    expect(unchanged.has("lyo.aps_loading")).toBe(false);
  });

  it("asks for stopper machinability only when the stopper preparation changes", () => {
    const lyo = scoping("lyophilized", "liquid");
    const options = (content.catalog.optionSets.stopperPreparation ?? []).map((o: { value: string }) => o.value);
    expect(options.length).toBeGreaterThan(1);
    const prep = (target: AnswerInput): Step[] => [...lyo, ...presence("stop.presence"), ["stop.preparation", "source", val(options[0])], ["stop.preparation", "target", target]];
    expect(visibleIds(prep(val(options[1]))).has("stop.machinability")).toBe(true);
    expect(visibleIds(prep(same)).has("stop.machinability")).toBe(false);
  });

  it("asks for stoppering APS coverage when the open time increases", () => {
    const lyo = scoping("lyophilized", "liquid");
    const open = (target: number): Step[] => [...lyo, ...presence("stop.presence"), ["stop.open_time", "source", val(q(2, "h"))], ["stop.open_time", "target", val(q(target, "h"))]];
    expect(visibleIds(open(4)).has("stop.aps")).toBe(true);
    expect(visibleIds(open(2)).has("stop.aps")).toBe(false);
  });
});

// ------------------------------------------------------------------ specific classifications

describe("milestone 2 classifications", () => {
  const lyo = scoping("lyophilized", "liquid");

  it("classifies a larger lyophilizer shelf area as a scale change", () => {
    const g = gapOf(
      [...lyo, ...presence("lyo.presence"), ["lyo.shelf_area", "source", val(q(2, "m²"))], ["lyo.shelf_area", "target", val(q(4, "m²"))]],
      "R-LYO-SHELF-AREA:uo.lyophilization.equip.lyophilizer.capacity",
    );
    expect(g?.category).toBe("scale_change");
  });

  it("classifies a primary drying pressure outside the validated range as outside, with a regulatory note, and converts units", () => {
    const run = (target: AnswerInput) =>
      gapOf(
        [...lyo, ...presence("lyo.presence"), ["lyo.primary_pressure", "source", param([0.1, "mbar"], [0.08, 0.12], [0.05, 0.2])], ["lyo.primary_pressure", "target", target]],
        "R-LYO-CYCLE-PARAM:uo.lyophilization.param.primary_pressure",
      );
    // 40 Pa is 0.4 mbar, above the validated 0.2 mbar.
    const outside = run(param([40, "Pa"], [35, 45]));
    expect(outside?.category).toBe("outside_validated_range");
    expect(outside?.regulatoryNote).toBe("Requires regulatory affairs assessment.");
    // 10 Pa is 0.1 mbar, the source set point itself.
    expect(run(param([10, "Pa"], [8, 12]))?.category).not.toBe("outside_validated_range");
  });

  it("classifies a change of inspection method as a different principle", () => {
    const g = gapOf(
      [...scoping("liquid", "liquid"), ...presence("vi.presence"), ["vi.method", "source", val("manual")], ["vi.method", "target", val("automated")]],
      "R-VI-METHOD:uo.visual_inspection.equip.inspection.operatingPrinciple",
    );
    expect(g?.category).toBe("different_principle");
  });

  it("reports information required when a target value is missing", () => {
    const g = gapOf(
      [...lyo, ...presence("lyo.presence"), ["lyo.shelf_area", "source", val(q(2, "m²"))], ["lyo.shelf_area", "target", unknown]],
      "R-LYO-SHELF-AREA:uo.lyophilization.equip.lyophilizer.capacity",
    );
    expect(g?.category).toBe("information_required");
  });

  it("never states a filing category in a rule or question text", () => {
    const text = JSON.stringify([content.rules, newQuestions]);
    expect(text).not.toMatch(/prior approval|CBE-?30|CBE-?0|annual report|major change|moderate change|minor change/i);
  });
});

// ------------------------------------------------------------------ coverage of the new questions

describe("milestone 2 questions are covered by rules", () => {
  it("there are new questions for all six unit operations", () => {
    for (const p of NEW_PREFIXES) expect(newQuestions.filter((x) => x.id.startsWith(p)).length, p).toBeGreaterThanOrEqual(8);
  });

  it("every new question has a first-matching rule and a non-empty why", () => {
    for (const x of newQuestions) {
      expect(findRule(content.rules, x.binds), `${x.id} (${x.binds})`).toBeDefined();
      expect(x.why.trim().length, `${x.id} why`).toBeGreaterThan(20);
    }
  });

  it("the three generic fallback rules are each the first match for at least one new question", () => {
    const first = new Set(newQuestions.map((x) => findRule(content.rules, x.binds)?.id));
    for (const id of ["R-GEN-EQUIP-PRINCIPLE", "R-GEN-MAT-PRESENCE", "R-GEN-IPC-DESCRIPTION"]) {
      expect(first.has(id), id).toBe(true);
    }
  });

  it("the generic fallback rules stay last in the rule file", () => {
    const ids = content.rules.map((r) => r.id);
    expect(ids.slice(-3)).toEqual(["R-GEN-EQUIP-PRINCIPLE", "R-GEN-MAT-PRESENCE", "R-GEN-IPC-DESCRIPTION"]);
  });
});
