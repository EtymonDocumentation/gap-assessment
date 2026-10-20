import { describe, expect, it } from "vitest";
import { getEntry, isValidCustomKey, customKeyFromLabel, parseProject, type Project } from "@gap/process-model";
import {
  addCustomItem,
  addCustomUnitOperation,
  assess,
  baseContent,
  buildDocument,
  buildModelView,
  customDefinitionOf,
  effectiveContent,
  filterModelView,
  findRule,
  gapsToCsv,
  isCustomQuestion,
  isCustomSection,
  questionSchema,
  recordedEntries,
  removeCustomItem,
  removeCustomUnitOperation,
  renameCustomItem,
  renameCustomUnitOperation,
  sectionSchema,
  unitDimensions,
  visibleInstances,
  CustomError,
  type ContentBundle,
} from "@gap/engine";
import { ACTOR, OTHER_ACTOR, content, kit, makeKit, q, rng } from "./helpers";

/** A base project with the first three catalog unit operations present on both sides. */
const start = () => kit.base();

function withUo(p: Project = start(), label = "Visual check (custom)", after: string | null = "aseptic_filling"): { p: Project; key: string } {
  const next = addCustomUnitOperation(p, content, { label, description: "Inspection step added for the test.", ...(after ? { after } : {}) }, ACTOR);
  return { p: next, key: next.custom.unitOperations.at(-1)!.key };
}

/** Adds an item and returns the project, the effective kit and the new key. */
function withItem(p: Project, input: Parameters<typeof addCustomItem>[2]) {
  const next = addCustomItem(p, content, input, ACTOR);
  return { p: next, key: next.custom.items.at(-1)!.key, k: makeKit(effectiveContent(content, next)) };
}

describe("custom keys", () => {
  it("generates lowercase x_ keys from labels", () => {
    expect(customKeyFromLabel("Mixing speed")).toBe("x_mixing_speed");
    expect(customKeyFromLabel("  Ünïcode Température! (°C) ")).toBe("x_unicode_temperature_c");
    expect(customKeyFromLabel("Pump #2 / backup")).toBe("x_pump_2_backup");
  });

  it("falls back to x_item when nothing usable is left", () => {
    expect(customKeyFromLabel("???")).toBe("x_item");
    expect(customKeyFromLabel("")).toBe("x_item");
  });

  it("makes keys unique and bounded in length", () => {
    expect(customKeyFromLabel("Pump", ["x_pump"])).toBe("x_pump_2");
    expect(customKeyFromLabel("Pump", ["x_pump", "x_pump_2"])).toBe("x_pump_3");
    const long = customKeyFromLabel("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(isValidCustomKey(long)).toBe(true);
    expect(isValidCustomKey(customKeyFromLabel("a".repeat(200), [long]))).toBe(true);
  });

  it("validates keys as path segments", () => {
    for (const ok of ["x_a", "x_pump_2", "x_a1"]) expect(isValidCustomKey(ok), ok).toBe(true);
    for (const bad of ["x_", "pump", "x_a.b", "X_a", "x__a", "x_a_", "x_a b", "x_é", "x_" + "a".repeat(40)]) expect(isValidCustomKey(bad), bad).toBe(false);
  });
});

describe("effectiveContent", () => {
  it("is the loaded bundle itself when there are no custom definitions", () => {
    expect(effectiveContent(content, start())).toBe(content);
  });

  it("is memoised by reference and by definition value, and does not stack", () => {
    const { p } = withUo();
    const a = effectiveContent(content, p);
    expect(a).not.toBe(content);
    expect(effectiveContent(content, p)).toBe(a);
    expect(effectiveContent(content, structuredClone(p))).toBe(a);
    expect(effectiveContent(a, p)).toBe(a);
    expect(baseContent(a)).toBe(content);
    const { p: p2 } = withItem(p, { uo: "compounding", coll: "ipc", label: "Visual check" });
    expect(effectiveContent(content, p2)).not.toBe(a);
  });

  it("does not modify the loaded bundle", () => {
    const sections = content.sections.length;
    const questions = content.questions.length;
    const { p } = withUo();
    withItem(p, { uo: "compounding", coll: "ipc", label: "Visual check" });
    expect(content.sections.length).toBe(sections);
    expect(content.questions.length).toBe(questions);
  });

  it("synthesizes a section ordered by sequence, with a valid presence question", () => {
    const { p, key } = withUo();
    const eff = effectiveContent(content, p);
    const sec = eff.sectionById.get(`uo.${key}`)!;
    expect(sec).toMatchObject({ kind: "uo", uo: key, title: "Visual check (custom)" });
    expect(() => sectionSchema.parse(sec)).not.toThrow();
    expect(isCustomSection(sec)).toBe(true);
    const order = eff.sections.map((s) => s.id);
    expect(order.indexOf(`uo.${key}`)).toBeGreaterThan(order.indexOf("uo.aseptic_filling"));
    expect(order.indexOf(`uo.${key}`)).toBeLessThan(order.indexOf("uo.capping"));
    const pres = eff.questionById.get(`x.${key}.presence`)!;
    expect(pres).toMatchObject({ sides: "paired", binds: `uo.${key}.presence`, input: { type: "yes_no" }, why: "Inspection step added for the test." });
    expect(isCustomQuestion(pres)).toBe(true);
    expect(findRule(eff.rules, pres.binds)?.id).toBe("R-UO-PRESENCE");
    // The catalog gets the unit operation, in sequence.
    const catalog = eff.catalog.unitOperations.map((u) => u.key);
    expect(catalog.indexOf(key)).toBeGreaterThan(catalog.indexOf("aseptic_filling"));
  });

  it("gives every synthesized question a label, a why, the custom tag and a matching rule", () => {
    let { p } = withUo();
    const uo = p.custom.unitOperations[0]!.key;
    for (const input of [
      { uo, coll: "param" as const, label: "Hold temperature", dimension: "temperature" },
      { uo, coll: "equip" as const, label: "Inspection camera", dimension: "volume" },
      { uo: "compounding", coll: "mat" as const, label: "Anti-foam agent", why: "Controls foaming during mixing." },
      { uo: "capping", coll: "ipc" as const, label: "Seal appearance check" },
    ]) p = addCustomItem(p, content, input, ACTOR);
    const eff = effectiveContent(content, p);
    const mine = eff.questions.filter(isCustomQuestion);
    expect(mine.length).toBe(1 + 1 + 2 + 3 + 1);
    const expected: Record<string, string> = {
      "uo.x_hold_temperature": "R-PARAM-RANGE",
    };
    for (const question of mine) {
      expect(() => questionSchema.parse(question), question.id).not.toThrow();
      expect(question.label?.length, question.id).toBeGreaterThan(0);
      expect(question.why.length, question.id).toBeGreaterThan(0);
      expect(question.sides).toBe("paired");
      const rule = findRule(eff.rules, question.binds);
      expect(rule, question.binds).toBeDefined();
      void expected;
    }
    const ruleOf = (binds: string) => findRule(eff.rules, binds)?.id;
    const k1 = p.custom.items.map((i) => i.key);
    expect(ruleOf(`uo.${uo}.param.${k1[0]}`)).toBe("R-PARAM-RANGE");
    expect(ruleOf(`uo.${uo}.equip.${k1[1]}.operatingPrinciple`)).toBe("R-GEN-EQUIP-PRINCIPLE");
    expect(ruleOf(`uo.${uo}.equip.${k1[1]}.capacity`)).toBe("R-EQUIP-CAPACITY");
    expect(ruleOf(`uo.compounding.mat.${k1[2]}.present`)).toBe("R-GEN-MAT-PRESENCE");
    expect(ruleOf(`uo.compounding.mat.${k1[2]}.supplier`)).toBe("R-COMPONENT");
    expect(ruleOf(`uo.compounding.mat.${k1[2]}.partNumber`)).toBe("R-COMPONENT");
    expect(ruleOf(`uo.capping.ipc.${k1[3]}.description`)).toBe("R-GEN-IPC-DESCRIPTION");
    // The user's why is used; the default names the actor and date.
    expect(eff.questionById.get(`x.compounding.mat.${k1[2]}.present`)!.why).toBe("Controls foaming during mixing.");
    expect(eff.questionById.get(`x.capping.ipc.${k1[3]}`)!.why).toBe(`Custom item added by ${ACTOR.name} on ${ACTOR.at.slice(0, 10)}.`);
  });

  it("puts custom items after the catalog questions of a catalog unit operation", () => {
    const { p } = withItem(start(), { uo: "compounding", coll: "param", label: "Foam level", dimension: "percent" });
    const eff = effectiveContent(content, p);
    const inSection = eff.questions.filter((x) => x.section === "uo.compounding");
    expect(isCustomQuestion(inSection.at(-1)!)).toBe(true);
    expect(inSection.slice(0, -1).some(isCustomQuestion)).toBe(false);
    const insts = visibleInstances(eff, p, "paired").filter((i) => i.section.id === "uo.compounding");
    expect(isCustomQuestion(insts.at(-1)!.question)).toBe(true);
  });

  it("puts items of a catalog unit operation that has its own section after its catalog questions, gated by its presence", () => {
    const { p } = withItem(start(), { uo: "ds_receipt_thaw", coll: "ipc", label: "Thaw monitoring" });
    const eff = effectiveContent(content, p);
    expect(eff.sectionById.get("uo.ds_receipt_thaw")?.title).toBe(content.sectionById.get("uo.ds_receipt_thaw")!.title);
    const presenceId = content.questions.find((x) => x.section === "uo.ds_receipt_thaw" && x.binds === "uo.ds_receipt_thaw.presence")!.id;
    const ids = (pp: Project) => visibleInstances(eff, pp, "paired").filter((i) => i.section.id === "uo.ds_receipt_thaw").map((i) => i.question.id);
    expect(ids(p)).toEqual([presenceId, presenceId]);
    const open = makeKit(eff).both(p, presenceId, "yes");
    const all = ids(open);
    expect(all.at(-1)).toBe("x.ds_receipt_thaw.ipc.x_thaw_monitoring");
    expect(all.filter((x) => x.startsWith("x.")).length).toBe(2);
  });

  it("describes custom bound paths", () => {
    expect(customDefinitionOf("uo.x_a.presence")).toEqual({ uo: "x_a" });
    expect(customDefinitionOf("uo.compounding.param.x_b")).toEqual({ uo: "compounding", coll: "param", key: "x_b" });
    expect(customDefinitionOf("uo.compounding.equip.x_c.capacity")).toEqual({ uo: "compounding", coll: "equip", key: "x_c" });
    expect(customDefinitionOf("uo.compounding.param.batch_size")).toBeUndefined();
    expect(customDefinitionOf("scope.modality")).toBeUndefined();
  });

  it("offers unit dimensions from the units table", () => {
    const dims = unitDimensions();
    expect(dims.find((d) => d.dimension === "temperature")?.units).toContain("°C");
    expect(dims.every((d) => d.units.length > 0 && d.label.length > 0)).toBe(true);
  });
});

describe("adding definitions", () => {
  it("appends a change-log event with the actor and does not mutate the input", () => {
    const before = start();
    const snapshot = JSON.stringify(before);
    const { p } = withUo(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    const ev = p.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "custom_uo_add", by: ACTOR.name, at: ACTOR.at });
    expect(p.custom.unitOperations[0]).toMatchObject({ createdBy: ACTOR.name, createdAt: ACTOR.at });
    const q2 = addCustomItem(p, content, { uo: "capping", coll: "ipc", label: "Seal check" }, OTHER_ACTOR);
    expect(q2.changeLog.at(-1)).toMatchObject({ action: "custom_item_add", by: OTHER_ACTOR.name });
  });

  it("places a unit operation after a chosen one, or at the end", () => {
    const { p: a, key: ka } = withUo(start(), "Alpha step", "compounding");
    expect(a.custom.unitOperations[0]!.sequence).toBeGreaterThan(20);
    expect(a.custom.unitOperations[0]!.sequence).toBeLessThan(30);
    const { p: b, key: kb } = withUo(a, "Beta step", ka);
    expect(b.custom.unitOperations[1]!.sequence).toBeGreaterThan(a.custom.unitOperations[0]!.sequence);
    expect(b.custom.unitOperations[1]!.sequence).toBeLessThan(30);
    const { p: c, key: kc } = withUo(b, "Last step", null);
    expect(c.custom.unitOperations[2]!.sequence).toBeGreaterThan(90);
    const order = effectiveContent(content, c).catalog.unitOperations.map((u) => u.key);
    expect(order.indexOf(ka)).toBeLessThan(order.indexOf(kb));
    expect(order.indexOf(kb)).toBeLessThan(order.indexOf("sterile_filtration"));
    expect(order.at(-1)).toBe(kc);
  });

  it("never reuses a key that still has recorded values", () => {
    let { p, key } = withUo();
    expect(key).toBe("x_visual_check_custom");
    p = removeCustomUnitOperation(addAnswer(p, key), key, ACTOR);
    const again = addCustomUnitOperation(p, content, { label: "Visual check (custom)" }, ACTOR);
    expect(again.custom.unitOperations[0]!.key).toBe("x_visual_check_custom_2");
  });

  it("rejects bad input with clear errors", () => {
    const { p, key } = withUo();
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(CustomError);
        return (e as Error).message;
      }
      throw new Error("expected an error");
    };
    expect(err(() => addCustomUnitOperation(p, content, { label: "   " }, ACTOR))).toMatch(/Enter a name/);
    expect(err(() => addCustomUnitOperation(p, content, { label: "visual CHECK (custom)" }, ACTOR))).toMatch(/already exists/);
    expect(err(() => addCustomUnitOperation(p, content, { label: "Valid", after: "nope" }, ACTOR))).toMatch(/Choose a unit operation/);
    expect(err(() => addCustomUnitOperation(p, content, { label: "x".repeat(81) }, ACTOR))).toMatch(/longer than/);
    expect(err(() => addCustomItem(p, content, { uo: "nope", coll: "ipc", label: "A" }, ACTOR))).toMatch(/Choose a unit operation/);
    expect(err(() => addCustomItem(p, content, { uo: key, coll: "study" as never, label: "A" }, ACTOR))).toMatch(/kind of item/);
    expect(err(() => addCustomItem(p, content, { uo: key, coll: "param", label: "A" }, ACTOR))).toMatch(/dimension/);
    expect(err(() => addCustomItem(p, content, { uo: key, coll: "param", label: "A", dimension: "nonsense" }, ACTOR))).toMatch(/Unknown unit dimension/);
    expect(err(() => addCustomItem(p, content, { uo: key, coll: "ipc", label: "A", dimension: "volume" }, ACTOR))).toMatch(/Only parameters and equipment/);
    expect(err(() => addCustomItem(p, content, { uo: "compounding", coll: "param", label: "mixing SPEED", dimension: "rotation" }, ACTOR))).toMatch(/already has/);
    const once = addCustomItem(p, content, { uo: key, coll: "ipc", label: "Lighting check" }, ACTOR);
    expect(err(() => addCustomItem(once, content, { uo: key, coll: "ipc", label: "lighting check" }, ACTOR))).toMatch(/already has/);
  });
});

/** Answers the presence question of a custom unit operation on both sides (so it holds recorded values). */
function addAnswer(p: Project, uoKey: string): Project {
  const k = makeKit(effectiveContent(content, p));
  return k.both(p, `x.${uoKey}.presence`, "yes");
}

describe("sequencing and gating by presence", () => {
  it("shows a custom unit operation's items only when it is present", () => {
    let { p, key } = withUo();
    ({ p } = withItem(p, { uo: key, coll: "ipc", label: "Lighting check" }));
    const eff = effectiveContent(content, p);
    const ids = (pp: Project) => visibleInstances(eff, pp, "paired").filter((i) => i.section.id === `uo.${key}`).map((i) => i.key);
    expect(ids(p)).toEqual([`x.${key}.presence@source`, `x.${key}.presence@target`]);
    const k = makeKit(eff);
    const srcOnly = k.v(p, `x.${key}.presence`, "source", "yes");
    expect(ids(srcOnly)).toContain(`x.${key}.ipc.x_lighting_check@source`);
    expect(ids(srcOnly)).not.toContain(`x.${key}.ipc.x_lighting_check@target`);
    const both = k.v(srcOnly, `x.${key}.presence`, "target", "yes");
    expect(ids(both)).toEqual([
      `x.${key}.presence@source`,
      `x.${key}.presence@target`,
      `x.${key}.ipc.x_lighting_check@source`,
      `x.${key}.ipc.x_lighting_check@target`,
    ]);
    const no = k.v(srcOnly, `x.${key}.presence`, "target", "no");
    expect(ids(no)).not.toContain(`x.${key}.ipc.x_lighting_check@target`);
  });

  it("orders sequential entry as source pass then target pass", () => {
    let { p, key } = withUo();
    ({ p } = withItem(p, { uo: key, coll: "ipc", label: "Lighting check" }));
    const k = makeKit(effectiveContent(content, p));
    p = k.both(p, `x.${key}.presence`, "yes");
    const seq = visibleInstances(effectiveContent(content, p), p, "sequential").filter((i) => i.section.id === `uo.${key}`).map((i) => i.key);
    expect(seq).toEqual([
      `x.${key}.presence@source`,
      `x.${key}.ipc.x_lighting_check@source`,
      `x.${key}.presence@target`,
      `x.${key}.ipc.x_lighting_check@target`,
    ]);
  });
});

describe("comparison of each custom kind", () => {
  const setup = (input: Parameters<typeof addCustomItem>[2]) => {
    let { p, key: uo } = withUo();
    const target = { ...input, uo: input.uo === "@custom" ? uo : input.uo };
    const made = withItem(p, target);
    p = made.k.both(made.p, `x.${uo}.presence`, "yes");
    return { ...made, p, uo, base: `uo.${target.uo}` };
  };
  const gapOf = (k: ReturnType<typeof makeKit>, p: Project, path: string) => k.run(p).gaps.filter((g) => g.path === path);

  const PAR = { classification: "CPP", rangeBasis: "PPQ" } as const;

  it("parameter: target inside the source PAR is within the validated range", () => {
    const s = setup({ uo: "@custom", coll: "param", label: "Hold temperature", dimension: "temperature" });
    const id = `x.${s.uo}.param.${s.key}`;
    let p = s.k.par(s.p, id, "source", { ...PAR, setPoint: q(20, "°C"), nor: rng(18, 22, "°C"), par: rng(10, 30, "°C") });
    p = s.k.par(p, id, "target", { setPoint: q(25, "°C"), nor: rng(22, 28, "°C") });
    const [g] = gapOf(s.k, p, `uo.${s.uo}.param.${s.key}`);
    expect(g).toMatchObject({ category: "within_validated_range", ruleId: "R-PARAM-RANGE", severity: "low", attribute: "Hold temperature", sectionId: `uo.${s.uo}` });
  });

  it("parameter: target outside the source PAR is outside the validated range, with severity from the class", () => {
    const s = setup({ uo: "@custom", coll: "param", label: "Hold temperature", dimension: "temperature" });
    const id = `x.${s.uo}.param.${s.key}`;
    let p = s.k.par(s.p, id, "source", { ...PAR, setPoint: q(20, "°C"), nor: rng(18, 22, "°C"), par: rng(10, 30, "°C") });
    p = s.k.par(p, id, "target", { setPoint: q(35, "°C"), nor: rng(32, 38, "°C") });
    const [g] = gapOf(s.k, p, `uo.${s.uo}.param.${s.key}`);
    expect(g).toMatchObject({ category: "outside_validated_range", severity: "high" });
    expect(g!.regulatoryNote).toBeDefined();
  });

  it("parameter on a catalog unit operation, with units converted", () => {
    let { p } = withItem(start(), { uo: "compounding", coll: "param", label: "Foam level", dimension: "volume" });
    const k = makeKit(effectiveContent(content, p));
    const id = `x.compounding.param.x_foam_level`;
    p = k.par(p, id, "source", { ...PAR, setPoint: q(10, "mL"), nor: rng(8, 12, "mL"), par: rng(5, 20, "mL") });
    p = k.par(p, id, "target", { setPoint: q(0.01, "L"), nor: rng(8, 12, "mL") });
    const g = k.run(p).gaps.find((x) => x.path === "uo.compounding.param.x_foam_level")!;
    expect(g.category).toBe("equivalent");
  });

  it("parameter: unknown target gives information required", () => {
    const s = setup({ uo: "@custom", coll: "param", label: "Hold temperature", dimension: "temperature" });
    const id = `x.${s.uo}.param.${s.key}`;
    let p = s.k.par(s.p, id, "source", { ...PAR, setPoint: q(20, "°C"), nor: rng(18, 22, "°C"), par: rng(10, 30, "°C") });
    p = s.k.unk(p, id, "target");
    expect(gapOf(s.k, p, `uo.${s.uo}.param.${s.key}`)[0]!.category).toBe("information_required");
  });

  it("equipment: a different operating principle, and a capacity change", () => {
    const s = setup({ uo: "@custom", coll: "equip", label: "Inspection camera", dimension: "volume" });
    const principle = `x.${s.uo}.equip.${s.key}.principle`;
    const capacity = `x.${s.uo}.equip.${s.key}.capacity`;
    let p = s.k.pair(s.p, principle, "Line-scan camera", "Area-scan camera");
    p = s.k.pair(p, capacity, q(100, "L"), q(300, "L"));
    const gaps = s.k.run(p).gaps;
    expect(gaps.find((g) => g.path.endsWith(`${s.key}.operatingPrinciple`))).toMatchObject({ category: "different_principle", ruleId: "R-GEN-EQUIP-PRINCIPLE" });
    expect(gaps.find((g) => g.path.endsWith(`${s.key}.capacity`))).toMatchObject({ category: "scale_change", ruleId: "R-EQUIP-CAPACITY" });
    const same = s.k.pair(p, principle, "Line-scan camera", "Line-scan camera");
    expect(s.k.run(same).gaps.find((g) => g.path.endsWith(`${s.key}.operatingPrinciple`))!.category).toBe("equivalent");
  });

  it("equipment without a dimension has no capacity question", () => {
    const s = setup({ uo: "@custom", coll: "equip", label: "Inspection camera" });
    expect(s.k.content.questionById.has(`x.${s.uo}.equip.${s.key}.capacity`)).toBe(false);
  });

  it("material: new, removed, and a supplier difference when used on both sides", () => {
    const s = setup({ uo: "@custom", coll: "mat", label: "Coated label" });
    const present = `x.${s.uo}.mat.${s.key}.present`;
    const supplier = `x.${s.uo}.mat.${s.key}.supplier`;
    const part = `x.${s.uo}.mat.${s.key}.part_number`;
    const path = (f: string) => `uo.${s.uo}.mat.${s.key}.${f}`;

    const added = s.k.pair(s.p, present, "no", "yes");
    expect(gapOf(s.k, added, path("present"))[0]).toMatchObject({ category: "new_requirement", ruleId: "R-GEN-MAT-PRESENCE" });
    expect(s.k.run(added).gaps.some((g) => g.path.endsWith(`${s.key}.supplier`))).toBe(false);

    const removed = s.k.pair(s.p, present, "yes", "no");
    expect(gapOf(s.k, removed, path("present"))[0]!.category).toBe("removed_element");

    let both = s.k.pair(s.p, present, "yes", "yes");
    both = s.k.pair(both, supplier, "Vendor A (fictional)", "Vendor B (fictional)");
    both = s.k.pair(both, part, "LBL-1", "LBL-1");
    expect(gapOf(s.k, both, path("present"))[0]!.category).toBe("equivalent");
    expect(gapOf(s.k, both, path("supplier"))[0]).toMatchObject({ category: "different_principle", ruleId: "R-COMPONENT" });
    expect(gapOf(s.k, both, path("partNumber"))[0]!.category).toBe("equivalent");
  });

  it("in-process control: changed and unknown", () => {
    const s = setup({ uo: "@custom", coll: "ipc", label: "Lighting check" });
    const id = `x.${s.uo}.ipc.${s.key}`;
    const changed = s.k.pair(s.p, id, "Every 30 min, 5 units", "Every hour, 10 units");
    expect(gapOf(s.k, changed, `uo.${s.uo}.ipc.${s.key}.description`)[0]).toMatchObject({ category: "different_principle", ruleId: "R-GEN-IPC-DESCRIPTION" });
    const unknown = s.k.unk(s.k.v(s.p, id, "source", "Every hour"), id, "target");
    expect(gapOf(s.k, unknown, `uo.${s.uo}.ipc.${s.key}.description`)[0]!.category).toBe("information_required");
    expect(s.k.run(unknown).openItems.some((o) => o.questionId === id && o.side === "target")).toBe(true);
  });

  it("custom unit operation presence: a unit operation added at the target is a new requirement", () => {
    const { p, key } = withUo();
    const k = makeKit(effectiveContent(content, p));
    const next = k.pair(p, `x.${key}.presence`, "no", "yes");
    expect(k.run(next).gaps.find((g) => g.path === `uo.${key}.presence`)).toMatchObject({ category: "new_requirement", ruleId: "R-UO-PRESENCE", severity: "high" });
  });

  it("same as source works for a custom target value, and the source is shown in the target card", () => {
    const s = setup({ uo: "@custom", coll: "ipc", label: "Lighting check" });
    const id = `x.${s.uo}.ipc.${s.key}`;
    const p = s.k.same(s.k.v(s.p, id, "source", "Every hour"), id);
    expect(s.k.run(p).gaps.find((g) => g.path.endsWith(".description"))!.category).toBe("equivalent");
  });
});

describe("renaming and removal", () => {
  function recorded() {
    let { p, key: uo } = withUo();
    const a = withItem(p, { uo: "@custom".replace("@custom", uo), coll: "param", label: "Hold temperature", dimension: "temperature" });
    const par = a.key;
    const b = withItem(a.p, { uo: "compounding", coll: "ipc", label: "Foam check" });
    const k = b.k;
    p = k.both(b.p, `x.${uo}.presence`, "yes");
    p = k.par(p, `x.${uo}.param.${par}`, "source", { classification: "CPP", rangeBasis: "PPQ", setPoint: q(20, "°C"), nor: rng(18, 22, "°C"), par: rng(10, 30, "°C") });
    p = k.par(p, `x.${uo}.param.${par}`, "target", { setPoint: q(35, "°C"), nor: rng(32, 38, "°C") });
    p = k.pair(p, `x.compounding.ipc.${b.key}`, "Visual", "Instrument");
    return { p, uo, par, ipc: b.key };
  }

  it("removing an item keeps every value, makes it inactive and drops it from gaps, document and CSV", () => {
    const { p, uo, par } = recorded();
    const refs = [`source.uo.${uo}.param.${par}.setPoint`, `target.uo.${uo}.param.${par}.nor`];
    const before = refs.map((r) => structuredClone(getEntry(p, r)));
    const kBefore = makeKit(effectiveContent(content, p));
    const a0 = kBefore.run(p);
    expect(a0.gaps.some((g) => g.path === `uo.${uo}.param.${par}`)).toBe(true);
    expect(buildDocument(kBefore.content, p, a0, ACTOR.at).sections.map((x) => JSON.stringify(x)).join("")).toContain("Hold temperature");
    expect(recordedEntries(p, { uo, coll: "param", key: par }).length).toBeGreaterThan(0);

    const next = removeCustomItem(p, { uo, coll: "param", key: par }, OTHER_ACTOR);
    expect(next.custom.items.some((i) => i.key === par)).toBe(false);
    expect(refs.map((r) => getEntry(next, r))).toEqual(before);
    expect(next.changeLog.at(-1)).toMatchObject({ action: "custom_item_remove", by: OTHER_ACTOR.name });
    expect(next.changeLog.at(-1)!.detail).toMatch(/recorded value\(s\) kept as inactive/);

    const k = makeKit(effectiveContent(content, next));
    const a = k.run(next);
    expect(a.gaps.some((g) => g.path === `uo.${uo}.param.${par}`)).toBe(false);
    expect(a.inactive.map((e) => e.path)).toEqual(expect.arrayContaining(refs));
    expect(a.inactive.length).toBe(recordedEntries(next, { uo, coll: "param", key: par }).length);
    const doc = JSON.stringify(buildDocument(k.content, next, a, ACTOR.at).sections);
    expect(doc).not.toContain("Hold temperature");
    expect(gapsToCsv(k.content, a.gaps)).not.toContain("Hold temperature");

    const view = buildModelView(k.content, next, a);
    const row = view.inactive.find((r) => r.ref === refs[0])!;
    expect(row).toMatchObject({ side: "source", where: "Visual check (custom)", name: "Hold temperature: Set point", reason: expect.stringMatching(/custom item was removed/) });
    expect(row.display).toBe("20 °C");
  });

  it("removing a unit operation removes its items' definitions and keeps all values inactive", () => {
    const { p, uo, par } = recorded();
    const next = removeCustomUnitOperation(p, uo, ACTOR);
    expect(next.custom.unitOperations).toEqual([]);
    expect(next.custom.items.map((i) => i.uo)).toEqual(["compounding"]);
    expect(getEntry(next, `source.uo.${uo}.presence`)!.value).toBe(true);
    expect(getEntry(next, `source.uo.${uo}.param.${par}.setPoint`)!.value).toEqual(q(20, "°C"));
    expect(next.processes.source.unitOperations[uo]!.label).toBe("Visual check (custom)");
    const k = makeKit(effectiveContent(content, next));
    const a = k.run(next);
    expect(a.gaps.some((g) => g.path.startsWith(`uo.${uo}.`))).toBe(false);
    expect(a.inactive.filter((e) => e.path.includes(`.uo.${uo}.`)).length).toBe(recordedEntries(next, { uo }).length);
    expect(a.inactive.every((e) => e.status !== "not_established")).toBe(true);
    // The catalog unit operation and its other custom item are unaffected.
    expect(a.gaps.some((g) => g.path.startsWith("uo.compounding.ipc.x_"))).toBe(true);
    const view = buildModelView(k.content, next, a);
    expect(view.inactive.find((r) => r.ref === `source.uo.${uo}.presence`)!.reason).toMatch(/custom unit operation was removed/);
    expect(view.sections.some((s) => s.section.id === `uo.${uo}`)).toBe(false);
  });

  it("an entry whose gating closed is inactive too, and re-adding does not resurrect removed values", () => {
    const { p, uo, par } = recorded();
    const removed = removeCustomItem(p, { uo, coll: "param", key: par }, ACTOR);
    const again = addCustomItem(removed, content, { uo, coll: "param", label: "Hold temperature", dimension: "temperature" }, ACTOR);
    expect(again.custom.items.at(-1)!.key).toBe(`${par}_2`);
    const a = makeKit(effectiveContent(content, again)).run(again);
    expect(a.gaps.some((g) => g.path === `uo.${uo}.param.${par}_2`)).toBe(true);
    expect(a.gaps.find((g) => g.path === `uo.${uo}.param.${par}_2`)!.category).toBe("information_required");
    expect(a.inactive.some((e) => e.path.includes(`param.${par}.`))).toBe(true);
  });

  it("renaming keeps the key and the values and updates labels everywhere", () => {
    const { p, uo, par } = recorded();
    const next = renameCustomItem(p, { uo, coll: "param", key: par }, "Hold temp. (renamed)", OTHER_ACTOR);
    expect(next.custom.items.find((i) => i.key === par)!.label).toBe("Hold temp. (renamed)");
    expect(next.processes.source.unitOperations[uo]!.collections.param[par]!.label).toBe("Hold temp. (renamed)");
    expect(getEntry(next, `source.uo.${uo}.param.${par}.setPoint`)).toEqual(getEntry(p, `source.uo.${uo}.param.${par}.setPoint`));
    const a = makeKit(effectiveContent(content, next)).run(next);
    expect(a.gaps.find((g) => g.path === `uo.${uo}.param.${par}`)!.attribute).toBe("Hold temp. (renamed)");
    expect(next.changeLog.at(-1)).toMatchObject({ action: "custom_item_rename", by: OTHER_ACTOR.name, before: { label: "Hold temperature" } });

    const uoRenamed = renameCustomUnitOperation(next, uo, "Visual station", ACTOR);
    expect(uoRenamed.processes.target.unitOperations[uo]!.label).toBe("Visual station");
    const eff = effectiveContent(content, uoRenamed);
    expect(eff.sectionById.get(`uo.${uo}`)!.title).toBe("Visual station");
    expect(makeKit(eff).run(uoRenamed).gaps.find((g) => g.path === `uo.${uo}.param.${par}`)!.sectionTitle).toBe("Visual station");
    const other = addCustomUnitOperation(uoRenamed, content, { label: "Second custom step" }, ACTOR);
    expect(() => renameCustomUnitOperation(other, uo, "second CUSTOM step", ACTOR)).toThrow(/already exists/);
    expect(() => renameCustomItem(uoRenamed, { uo, coll: "param", key: "x_nope" }, "A", ACTOR)).toThrow(/no longer exists/);
    expect(() => removeCustomUnitOperation(uoRenamed, "x_nope", ACTOR)).toThrow(/no longer exists/);
  });
});

describe("pipeline integration", () => {
  it("a project without custom definitions assesses exactly as before", () => {
    const p = kit.pair(start(), "comp.vessel_type", "stainless_tank", "single_use_bag");
    expect(effectiveContent(content, p)).toBe(content);
    expect(assess(effectiveContent(content, p), p)).toEqual(assess(content, p));
  });

  it("custom rows reach the register, the CSV and the document", () => {
    let { p, key: uo } = withUo();
    const made = withItem(p, { uo, coll: "ipc", label: "Lighting check" });
    p = made.k.both(made.p, `x.${uo}.presence`, "yes");
    p = made.k.pair(p, `x.${uo}.ipc.${made.key}`, "Daily", "Weekly");
    const a = made.k.run(p);
    const g = a.gaps.find((x) => x.path.endsWith(".description"))!;
    expect(g).toMatchObject({ sectionTitle: "Visual check (custom)", attribute: "Lighting check", category: "different_principle" });
    expect(gapsToCsv(made.k.content, a.gaps)).toContain("Lighting check");
    const doc = buildDocument(made.k.content, p, a, ACTOR.at);
    const text = JSON.stringify(doc.sections);
    expect(text).toContain("Visual check (custom)");
    expect(text).toContain("Lighting check");
  });

  it("survives a JSON round trip with the same effective content and assessment", () => {
    let { p, key: uo } = withUo();
    const made = withItem(p, { uo, coll: "param", label: "Hold temperature", dimension: "temperature" });
    p = made.k.both(made.p, `x.${uo}.presence`, "yes");
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    const eff = effectiveContent(content, back);
    expect(eff).toBe(made.k.content);
    expect(assess(eff, back)).toEqual(made.k.run(p));
  });

  it("the Builder view lists custom attributes, filters and definitions", () => {
    let { p, key: uo } = withUo();
    const made = withItem(p, { uo, coll: "ipc", label: "Lighting check" });
    p = made.k.both(made.p, `x.${uo}.presence`, "yes");
    p = made.k.pair(p, `x.${uo}.ipc.${made.key}`, "Daily", "Weekly");
    p = made.k.unk(p, "comp.vessel_type", "target");
    const eff = made.k.content as ContentBundle;
    const view = buildModelView(eff, p, made.k.run(p));
    const sec = view.sections.find((s) => s.section.id === `uo.${uo}`)!;
    expect(sec.custom).toBe(true);
    const attr = sec.attributes.find((x) => x.id === `x.${uo}.ipc.${made.key}`)!;
    expect(attr).toMatchObject({ custom: true, differs: true, label: "Lighting check" });
    expect(attr.source).toMatchObject({ display: "Daily", status: "established", revision: 1, verification: "Unverified" });
    expect(attr.target!.sources[0]).toContain(ACTOR.name);
    expect(view.definitions.map((d) => [d.kind, d.label, d.recorded])).toEqual([
      ["uo", "Visual check (custom)", 4],
      ["item", "Lighting check", 2],
    ]);

    expect(filterModelView(view, { onlyDifferences: true }).sections.every((s) => s.attributes.every((a) => a.differs))).toBe(true);
    const open = filterModelView(view, { onlyOpen: true });
    expect(open.sections.flatMap((s) => s.attributes.map((a) => a.id))).toContain("comp.vessel_type");
    expect(open.sections.flatMap((s) => s.attributes).every((a) => a.open)).toBe(true);
    const text = filterModelView(view, { text: "lighting" });
    expect(text.sections.map((s) => s.section.id)).toEqual([`uo.${uo}`]);
    expect(filterModelView(view, { text: "visual check (custom)" }).sections[0]!.attributes.length).toBe(sec.attributes.length);
    expect(filterModelView(view, { text: "zzzz-no-match" }).sections).toEqual([]);
  });
});
