import { describe, expect, it } from "vitest";
import { evaluate, type Condition } from "@gap/engine";
import type { Project } from "@gap/process-model";
import { kit, q, rng, withEntry } from "./helpers";

const { v, par, unk, same, na, base, newProject } = kit;

const BATCH_SP_T = "target.uo.compounding.param.batch_size.setPoint";
const BATCH_SP_S = "source.uo.compounding.param.batch_size.setPoint";
const BATCH_NOR_T = "target.uo.compounding.param.batch_size.nor";
const SUA_T = "target.uo.sterile_filtration.mat.sua.present";
const SUA_S = "source.uo.sterile_filtration.mat.sua.present";

/** A project with a mix of equal, different, increased, unknown and missing values. */
function scenario(): Project {
  let p = base();
  p = v(p, "scope.dosage_form", "shared", "lyophilized"); // re-answer; liquid replaced
  p = v(p, "scope.markets", "shared", ["us", "eu"]);
  // sua: no at source, yes at target
  p = v(p, "filt.sua", "source", "no");
  p = v(p, "filt.sua", "target", "yes");
  // batch size 60 L -> 150 L
  p = par(p, "comp.batch_size", "source", { setPoint: q(60, "L"), par: rng(40, 60, "L"), rangeBasis: "PPQ" });
  p = par(p, "comp.batch_size", "target", { setPoint: q(150, "L"), nor: rng(120, 150, "L") });
  // pump principle differs
  p = v(p, "fill.pump", "source", "rotary_piston");
  p = v(p, "fill.pump", "target", "peristaltic");
  // fill check: target follows source (live)
  p = v(p, "fill.check", "source", "inline_100");
  p = same(p, "fill.check");
  // filling duration: 30 h at source, the same duration expressed in minutes at target
  p = v(p, "fill.duration", "source", q(30, "h"));
  p = v(p, "fill.duration", "target", q(1800, "min"));
  // fill volume: ranges move up
  p = par(p, "fill.volume", "source", { classification: "CPP", setPoint: q(1.2, "mL"), nor: rng(1.18, 1.22, "mL"), par: rng(1.15, 1.25, "mL"), rangeBasis: "PPQ" });
  p = par(p, "fill.volume", "target", { setPoint: q(1.35, "mL"), nor: rng(1.3, 1.4, "mL") });
  // container format unknown at target, established at source
  p = v(p, "fill.container", "source", "2R");
  p = unk(p, "fill.container", "target");
  // compounding ipc: same elements in a different order, then a smaller set
  p = v(p, "comp.ipc", "source", ["bioburden", "ph"]);
  p = v(p, "comp.ipc", "target", ["ph", "bioburden"]);
  // vessel type not applicable at source
  p = na(p, "comp.vessel_type", "source", "No vessel (fictional)");
  return p;
}

const P = scenario();
const E = newProject(); // nothing answered
const ev = (c: Condition, project: Project = P, side?: "source" | "target" | "shared") => evaluate(c, { project, ...(side ? { side } : {}) });

describe("logical operators", () => {
  const T: Condition = { eq: ["scope.dosage_form", "lyophilized"] };
  const F: Condition = { eq: ["scope.dosage_form", "liquid"] };

  it("all requires every member", () => {
    expect(ev({ all: [T, T] })).toBe(true);
    expect(ev({ all: [T, F] })).toBe(false);
  });

  it("any requires at least one member", () => {
    expect(ev({ any: [F, T] })).toBe(true);
    expect(ev({ any: [F, F] })).toBe(false);
  });

  it("not negates, and nests", () => {
    expect(ev({ not: F })).toBe(true);
    expect(ev({ not: T })).toBe(false);
    expect(ev({ all: [{ not: F }, { any: [F, T] }, { not: { all: [T, F] } }] })).toBe(true);
  });
});

describe("eq", () => {
  it("matches established string values exactly", () => {
    expect(ev({ eq: ["scope.dosage_form", "lyophilized"] })).toBe(true);
    expect(ev({ eq: ["scope.dosage_form", "liquid"] })).toBe(false);
    expect(ev({ eq: ["scope.dosage_form", "Lyophilized"] })).toBe(false); // case-sensitive
  });

  it("compares yes/no questions (stored as booleans) against boolean or yes/no/true literals", () => {
    expect(ev({ eq: [SUA_T, true] })).toBe(true);
    expect(ev({ eq: [SUA_T, "yes"] })).toBe(true);
    expect(ev({ eq: [SUA_T, "true"] })).toBe(true);
    expect(ev({ eq: [SUA_T, "no"] })).toBe(false);
    expect(ev({ eq: [SUA_S, false] })).toBe(true);
    expect(ev({ eq: [SUA_S, "no"] })).toBe(true);
    expect(ev({ eq: [SUA_S, "yes"] })).toBe(false);
  });

  it("compares numbers", () => {
    const p = withEntry(P, "target.uo.compounding.param.counter.setPoint", 5);
    expect(ev({ eq: ["target.uo.compounding.param.counter.setPoint", 5] }, p)).toBe(true);
    expect(ev({ eq: ["target.uo.compounding.param.counter.setPoint", 6] }, p)).toBe(false);
  });

  it("follows same-as-source live", () => {
    expect(ev({ eq: ["target.uo.aseptic_filling.ipc.fill_check.frequency", "inline_100"] })).toBe(true);
    const changed = v(P, "fill.check", "source", "statistical");
    expect(ev({ eq: ["target.uo.aseptic_filling.ipc.fill_check.frequency", "inline_100"] }, changed)).toBe(false);
    expect(ev({ eq: ["target.uo.aseptic_filling.ipc.fill_check.frequency", "statistical"] }, changed)).toBe(true);
  });
});

describe("in", () => {
  it("matches any listed literal", () => {
    expect(ev({ in: ["target.uo.aseptic_filling.equip.filler.operatingPrinciple", ["peristaltic", "time_pressure"]] })).toBe(true);
    expect(ev({ in: ["target.uo.aseptic_filling.equip.filler.operatingPrinciple", ["rotary_piston"]] })).toBe(false);
    expect(ev({ in: [SUA_T, ["yes"]] })).toBe(true);
  });
});

describe("includes", () => {
  it("tests membership of multi-choice answers", () => {
    expect(ev({ includes: ["scope.markets", "eu"] })).toBe(true);
    expect(ev({ includes: ["scope.markets", "jp"] })).toBe(false);
  });

  it("is false for non-array values", () => {
    expect(ev({ includes: ["scope.dosage_form", "lyophilized"] })).toBe(false);
  });
});

describe("answered / isUnknown / isTrue", () => {
  it("answered is true for any recorded status, including unknown and not applicable", () => {
    expect(ev({ answered: "scope.markets" })).toBe(true);
    expect(ev({ answered: "target.uo.aseptic_filling.mat.container.format" })).toBe(true); // unknown
    expect(ev({ answered: "source.uo.compounding.equip.vessel.type" })).toBe(true); // not applicable
    expect(ev({ answered: "scope.transfer_type" }, E)).toBe(false);
    expect(ev({ answered: "target.uo.capping.mat.seal.partNumber" })).toBe(false);
  });

  it("isUnknown is true only for entries answered Unknown", () => {
    expect(ev({ isUnknown: "target.uo.aseptic_filling.mat.container.format" })).toBe(true);
    expect(ev({ isUnknown: "source.uo.aseptic_filling.mat.container.format" })).toBe(false);
    expect(ev({ isUnknown: "source.uo.compounding.equip.vessel.type" })).toBe(false);
    expect(ev({ isUnknown: "target.uo.capping.mat.seal.partNumber" })).toBe(false);
  });

  it("isTrue is true only for an established boolean true", () => {
    expect(ev({ isTrue: SUA_T })).toBe(true);
    expect(ev({ isTrue: SUA_S })).toBe(false);
    expect(ev({ isTrue: "scope.dosage_form" })).toBe(false);
    expect(ev({ isTrue: SUA_T }, E)).toBe(false);
  });
});

describe("uoPresent", () => {
  const pp = (src: string, tgt: string): Project => {
    let p = newProject();
    p = v(p, "comp.presence", "source", src);
    return v(p, "comp.presence", "target", tgt);
  };

  it("uses the side of the question being evaluated", () => {
    const p = pp("yes", "no");
    expect(ev({ uoPresent: "compounding" }, p, "source")).toBe(true);
    expect(ev({ uoPresent: "compounding" }, p, "target")).toBe(false);
  });

  it("without a source or target side, is true when either side performs the step", () => {
    expect(ev({ uoPresent: "compounding" }, pp("yes", "no"), "shared")).toBe(true);
    expect(ev({ uoPresent: "compounding" }, pp("no", "yes"))).toBe(true);
    expect(ev({ uoPresent: "compounding" }, pp("no", "no"))).toBe(false);
  });

  it("is false when presence has not been answered", () => {
    expect(ev({ uoPresent: "compounding" }, E, "source")).toBe(false);
    expect(ev({ uoPresent: "compounding" }, E)).toBe(false);
  });
});

describe("changed", () => {
  it("is true when both sides are established and differ", () => {
    expect(ev({ changed: "uo.aseptic_filling.equip.filler.operatingPrinciple" })).toBe(true);
  });

  it("is false when equal, including through same-as-source", () => {
    expect(ev({ changed: "uo.aseptic_filling.ipc.fill_check.frequency" })).toBe(false);
  });

  it("converts units before comparing", () => {
    expect(ev({ changed: "uo.aseptic_filling.param.max_fill_duration.max" })).toBe(false);
  });

  it("compares multi-choice values as sets", () => {
    expect(ev({ changed: "uo.compounding.ipc.panel.tests" })).toBe(false);
    expect(ev({ changed: "uo.compounding.ipc.panel.tests" }, v(P, "comp.ipc", "target", ["ph"]))).toBe(true);
  });

  it("cannot be decided (false) when either side is unknown, not applicable or missing", () => {
    expect(ev({ changed: "uo.aseptic_filling.mat.container.format" })).toBe(false); // target unknown
    expect(ev({ changed: "uo.compounding.equip.vessel.type" })).toBe(false); // source N/A, target missing
    expect(ev({ changed: "uo.capping.mat.seal.partNumber" })).toBe(false);
  });
});

describe("increased / decreased", () => {
  it("compares target against source", () => {
    expect(ev({ increased: "uo.compounding.param.batch_size.setPoint" })).toBe(true);
    expect(ev({ decreased: "uo.compounding.param.batch_size.setPoint" })).toBe(false);
    const smaller = par(P, "comp.batch_size", "target", { setPoint: q(30, "L"), nor: rng(30, 40, "L") });
    expect(ev({ increased: "uo.compounding.param.batch_size.setPoint" }, smaller)).toBe(false);
    expect(ev({ decreased: "uo.compounding.param.batch_size.setPoint" }, smaller)).toBe(true);
  });

  it("is false in both directions when values are equal after unit conversion", () => {
    expect(ev({ increased: "uo.aseptic_filling.param.max_fill_duration.max" })).toBe(false);
    expect(ev({ decreased: "uo.aseptic_filling.param.max_fill_duration.max" })).toBe(false);
  });

  it("compares ranges by their upper bound", () => {
    expect(ev({ increased: "uo.aseptic_filling.param.fill_volume.nor" })).toBe(true);
    expect(ev({ decreased: "uo.aseptic_filling.param.fill_volume.nor" })).toBe(false);
  });

  it("is false for non-numeric values, unknowns and missing entries", () => {
    expect(ev({ increased: "uo.aseptic_filling.equip.filler.operatingPrinciple" })).toBe(false);
    expect(ev({ decreased: "uo.aseptic_filling.equip.filler.operatingPrinciple" })).toBe(false);
    expect(ev({ increased: "uo.aseptic_filling.mat.container.format" })).toBe(false);
    expect(ev({ increased: "uo.compounding.param.batch_size.setPoint" }, E)).toBe(false);
  });

  it("is false when the two sides use different dimensions", () => {
    let p = withEntry(newProject(), "source.uo.compounding.param.x.setPoint", q(5, "L"));
    p = withEntry(p, "target.uo.compounding.param.x.setPoint", q(9, "h"));
    expect(ev({ increased: "uo.compounding.param.x.setPoint" }, p)).toBe(false);
    expect(ev({ decreased: "uo.compounding.param.x.setPoint" }, p)).toBe(false);
  });
});

describe("ratioAbove", () => {
  it("is strictly greater than the threshold (target / source)", () => {
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 2] })).toBe(true); // 2.5
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 2.5] })).toBe(false); // strict
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 3] })).toBe(false);
  });

  it("is false for equal values after unit conversion and for decreases", () => {
    expect(ev({ ratioAbove: ["uo.aseptic_filling.param.max_fill_duration.max", 1] })).toBe(false);
    const smaller = par(P, "comp.batch_size", "target", { setPoint: q(30, "L"), nor: rng(30, 40, "L") });
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 0.4] }, smaller)).toBe(true); // 0.5 > 0.4
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 1] }, smaller)).toBe(false);
  });

  it("is false when a side is missing, unknown or in a different dimension", () => {
    expect(ev({ ratioAbove: ["uo.compounding.param.batch_size.setPoint", 1] }, E)).toBe(false);
    expect(ev({ ratioAbove: ["uo.aseptic_filling.mat.container.format", 1] })).toBe(false);
    let p = withEntry(newProject(), "source.uo.compounding.param.x.setPoint", q(5, "L"));
    p = withEntry(p, "target.uo.compounding.param.x.setPoint", q(9, "h"));
    expect(ev({ ratioAbove: ["uo.compounding.param.x.setPoint", 1] }, p)).toBe(false);
  });
});

describe("gt / gte / lt / lte", () => {
  it("compare against a literal quantity with unit conversion", () => {
    expect(ev({ gt: [BATCH_SP_T, q(100, "L")] })).toBe(true);
    expect(ev({ gt: [BATCH_SP_T, q(149999, "mL")] })).toBe(true);
    expect(ev({ gt: [BATCH_SP_T, q(150000, "mL")] })).toBe(false); // equal
    expect(ev({ gte: [BATCH_SP_T, q(150000, "mL")] })).toBe(true);
    expect(ev({ lte: [BATCH_SP_T, q(150, "L")] })).toBe(true);
    expect(ev({ lt: [BATCH_SP_T, q(150, "L")] })).toBe(false);
    expect(ev({ lt: [BATCH_SP_T, q(200, "L")] })).toBe(true);
    expect(ev({ lt: [BATCH_SP_T, q(149999, "mL")] })).toBe(false);
  });

  it("compare against another entry", () => {
    expect(ev({ gt: [BATCH_SP_T, BATCH_SP_S] })).toBe(true);
    expect(ev({ gte: [BATCH_SP_T, BATCH_SP_S] })).toBe(true);
    expect(ev({ lt: [BATCH_SP_T, BATCH_SP_S] })).toBe(false);
    expect(ev({ lte: [BATCH_SP_S, BATCH_SP_T] })).toBe(true);
  });

  it("use the upper bound of a range value", () => {
    expect(ev({ gte: [BATCH_NOR_T, q(150, "L")] })).toBe(true);
    expect(ev({ gt: [BATCH_NOR_T, q(150, "L")] })).toBe(false);
  });

  it("compare plain numbers", () => {
    const p = withEntry(withEntry(newProject(), "target.uo.compounding.param.n.setPoint", 5), "target.uo.compounding.param.m.setPoint", 3);
    expect(ev({ gt: ["target.uo.compounding.param.n.setPoint", 3] }, p)).toBe(true);
    expect(ev({ gte: ["target.uo.compounding.param.n.setPoint", 5] }, p)).toBe(true);
    expect(ev({ lt: ["target.uo.compounding.param.n.setPoint", 5] }, p)).toBe(false);
    expect(ev({ lte: ["target.uo.compounding.param.n.setPoint", 5] }, p)).toBe(true);
    expect(ev({ gt: ["target.uo.compounding.param.n.setPoint", "target.uo.compounding.param.m.setPoint"] }, p)).toBe(true);
  });

  it("are false when the operands are not comparable", () => {
    expect(ev({ gt: [BATCH_SP_T, q(5, "h")] })).toBe(false); // different dimension
    expect(ev({ lt: [BATCH_SP_T, q(5, "h")] })).toBe(false);
    expect(ev({ gt: [BATCH_SP_T, 3] })).toBe(false); // quantity vs bare number
    expect(ev({ gt: ["target.uo.aseptic_filling.equip.filler.operatingPrinciple", q(1, "L")] })).toBe(false); // text
  });
});

describe("undeterminable conditions evaluate to false", () => {
  const MISSING = "target.uo.capping.mat.seal.partNumber";
  const UNKNOWN = "target.uo.aseptic_filling.mat.container.format";
  const cases: [string, Condition][] = [
    ["eq", { eq: [MISSING, "x"] }],
    ["in", { in: [MISSING, ["x"]] }],
    ["includes", { includes: [MISSING, "x"] }],
    ["isTrue", { isTrue: MISSING }],
    ["isUnknown", { isUnknown: MISSING }],
    ["answered", { answered: MISSING }],
    ["uoPresent", { uoPresent: "capping" }],
    ["changed", { changed: "uo.capping.mat.seal.partNumber" }],
    ["increased", { increased: "uo.capping.param.rsf.setPoint" }],
    ["decreased", { decreased: "uo.capping.param.rsf.setPoint" }],
    ["ratioAbove", { ratioAbove: ["uo.capping.param.rsf.setPoint", 1] }],
    ["gt", { gt: [MISSING, q(1, "N")] }],
    ["gte", { gte: [MISSING, q(1, "N")] }],
    ["lt", { lt: [MISSING, q(1, "N")] }],
    ["lte", { lte: [MISSING, q(1, "N")] }],
  ];

  it.each(cases)("%s is false when the value is missing", (_name, cond) => {
    expect(ev(cond, P)).toBe(false);
    expect(ev(cond, E)).toBe(false);
  });

  it("is false for value operators when the value is Unknown", () => {
    expect(ev({ eq: [UNKNOWN, "2R"] })).toBe(false);
    expect(ev({ in: [UNKNOWN, ["2R", "6R"]] })).toBe(false);
    expect(ev({ isTrue: UNKNOWN })).toBe(false);
    expect(ev({ gt: [UNKNOWN, q(1, "L")] })).toBe(false);
  });

  it("not turns an undeterminable condition into true (so 'not eq' shows a question until the value is established)", () => {
    expect(ev({ not: { eq: [MISSING, "x"] } })).toBe(true);
    expect(ev({ not: { eq: [UNKNOWN, "2R"] } })).toBe(true);
  });
});
