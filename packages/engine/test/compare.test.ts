import { describe, expect, it } from "vitest";
import { OverlayError, REGULATORY_NOTE, riskRanked, SEVERITY_RANK, setGapOverlay, type Gap } from "@gap/engine";
import { getEntry, type Project } from "@gap/process-model";
import { ACTOR, OTHER_ACTOR, T0, T1, customKit, kit, q, rawRule, rng, type FieldSpec, type FieldSpecs, type Kit } from "./helpers";

const { v, par, unk, same, na, pair, base, run, gap, content } = kit;

// ------------------------------------------------------------------ scenario builders

const MS = "R-PARAM-RANGE:uo.compounding.param.mixing_speed";
const BATCH = "R-BATCH-SIZE:uo.compounding.param.batch_size";
const HOLD = "R-HOLD-TIME:uo.compounding.param.max_hold_time.max";
const FILL_DUR = "R-FILL-DURATION:uo.aseptic_filling.param.max_fill_duration.max";
const PUMP = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";
const SUA = "R-SUA-PRESENCE:uo.sterile_filtration.mat.sua.present";
const INTEGRITY = "R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests";
const MIX_COV = "R-MIXING-COVERAGE:uo.compounding.study.mixing.coverage";
const APS = "R-APS-COVERAGE:uo.aseptic_filling.study.aps.coverage";
const ACCURACY = "R-EV-FILL-ACCURACY:uo.aseptic_filling.study.fill_accuracy.status";
const SHEAR = "R-EV-PUMP-IMPACT:uo.aseptic_filling.study.pump_product_impact.status";
const BRET = "R-EV-BRET:uo.sterile_filtration.study.bacterial_retention.status";
const COMP_PROC = "R-PROCEDURES:uo.compounding.doc.procedures.status";
const VESSEL = "R-VESSEL-TYPE:uo.compounding.equip.vessel.type";
const CAPACITY = "R-EQUIP-CAPACITY:uo.compounding.equip.vessel.capacity";
const SUPPLIER = "R-FILTER-DESIGN:uo.sterile_filtration.mat.sterilizing_filter.supplier";

const rpm = (n: number) => q(n, "rpm");
const rr = (a: number, b: number) => rng(a, b, "rpm");

interface SpeedSource {
  cls?: FieldSpec;
  sp?: FieldSpec;
  nor?: FieldSpec;
  par?: FieldSpec;
  vr?: FieldSpec;
}

/** Mixing speed answered on both sides. Defaults: source SP 150, NOR 120-180, PAR 100-200 (KPP); target identical. */
function speed(k: Kit, src: SpeedSource, tgt: { sp?: FieldSpec; nor?: FieldSpec } = {}, from?: Project): Project {
  const s: FieldSpecs = {
    classification: src.cls ?? "KPP",
    setPoint: src.sp ?? rpm(150),
    nor: src.nor ?? rr(120, 180),
    par: src.par ?? rr(100, 200),
    rangeBasis: "PPQ",
  };
  if (src.vr !== undefined) s.validatedRange = src.vr;
  const p = k.par(from ?? k.base(), "comp.mixing_speed", "source", s);
  return k.par(p, "comp.mixing_speed", "target", { setPoint: tgt.sp ?? rpm(150), nor: tgt.nor ?? rr(120, 180) });
}

const L = (n: number) => q(n, "L");

/** Batch size on both sides. Source has set point + PAR; target has set point + NOR. */
function batch(k: Kit, s: { sp: FieldSpec; par?: FieldSpec }, t: { sp: FieldSpec; nor?: FieldSpec }, from?: Project): Project {
  const p = k.par(from ?? k.base(), "comp.batch_size", "source", { setPoint: s.sp, par: s.par ?? rng(80, 120, "L"), rangeBasis: "PPQ" });
  return k.par(p, "comp.batch_size", "target", { setPoint: t.sp, nor: t.nor ?? rng(90, 110, "L") });
}

/** Batch size grows from 100 L to 250 L; this makes the growth follow-up questions visible. */
const grown = (k: Kit = kit) => batch(k, { sp: L(100) }, { sp: L(250), nor: rng(200, 300, "L") });

const categoryOf = (p: Project, key: string) => gap(run(p), key).category;

// ================================================================== range

describe("range comparator (process parameter, R-PARAM-RANGE)", () => {
  it("equivalent: set point and NOR match the SU", () => {
    const g = gap(run(speed(kit, {})), MS);
    expect(g).toMatchObject({
      category: "equivalent",
      severity: "none",
      ruleSeverity: "none",
      activities: [],
      status: "closed",
      rationale: "No difference identified.",
      detail: "RU set point and NOR match the SU.",
    });
    expect(g.displayId).toMatch(/^EQ-\d{3}$/);
    expect(g.regulatoryNote).toBeUndefined();
    expect(g.severityNote).toBeUndefined();
  });

  it("equivalent across units: 1.2 mL vs 1200 µL", () => {
    let p = par(base(), "fill.volume", "source", { classification: "CPP", setPoint: q(1.2, "mL"), nor: rng(1.18, 1.22, "mL"), par: rng(1, 1.4, "mL"), rangeBasis: "PPQ" });
    p = par(p, "fill.volume", "target", { setPoint: q(1200, "µL"), nor: rng(1180, 1220, "µL") });
    expect(categoryOf(p, "R-PARAM-RANGE:uo.aseptic_filling.param.fill_volume")).toBe("equivalent");
  });

  it("within_validated_range: RU window inside the SU PAR, low severity, procedure update only, no regulatory note", () => {
    const g = gap(run(speed(kit, { cls: "CPP" }, { sp: rpm(160), nor: rr(130, 170) })), MS);
    expect(g).toMatchObject({
      category: "within_validated_range",
      activities: ["procedure_update"],
      severity: "low", // within-range is always low, even for a CPP
      ruleSeverity: "low",
      status: "open",
    });
    expect(g.regulatoryNote).toBeUndefined();
    expect(g.rationale).toContain("Record the RU range in procedures");
    expect(g.detail).toBe("The RU NOR 130–170 rpm lies within the SU PAR 100–200 rpm.");
    expect(g.displayId).toMatch(/^G-\d{3}$/);
  });

  it("within_validated_range holds at the boundary of the PAR (inclusive)", () => {
    expect(categoryOf(speed(kit, {}, { sp: rpm(100), nor: rr(100, 200) }), MS)).toBe("within_validated_range");
  });

  it("outside_validated_range: NOR extends beyond the PAR; severity follows the SU classification", () => {
    const outside = { sp: rpm(150), nor: rr(90, 170) };
    const label = (value: string) => content.catalog.optionSets["classification"]!.find((o) => o.value === value)!.label;
    for (const [cls, severity] of [["CPP", "high"], ["KPP", "medium"], ["non_critical", "low"]] as const) {
      const g = gap(run(speed(kit, { cls }, outside)), MS);
      expect(g, cls).toMatchObject({
        category: "outside_validated_range",
        severity,
        ruleSeverity: severity,
        severityNote: `Parameter classified as ${label(cls)} at SU.`,
        regulatoryNote: REGULATORY_NOTE,
        activities: ["scientific_justification", "engineering_run", "ppq_coverage_assessment"],
      });
      expect(g.detail).toBe("The RU NOR 90–170 rpm extends beyond the SU PAR 100–200 rpm.");
    }
  });

  it("outside_validated_range: the set point alone can be outside even when the NOR is inside", () => {
    const g = gap(run(speed(kit, {}, { sp: rpm(250), nor: rr(120, 180) })), MS);
    expect(g.category).toBe("outside_validated_range");
  });

  it("uses the set point when the RU NOR is unknown", () => {
    const g = gap(run(speed(kit, {}, { sp: rpm(150), nor: "tbd" })), MS);
    expect(g.category).toBe("within_validated_range");
    expect(g.detail).toBe("The RU set point 150 rpm lies within the SU PAR 100–200 rpm.");
    const out = gap(run(speed(kit, {}, { sp: rpm(250), nor: "tbd" })), MS);
    expect(out.category).toBe("outside_validated_range");
  });

  it("an unknown classification applies the most conservative severity and says so", () => {
    const g = gap(run(speed(kit, { cls: "tbd" }, { nor: rr(90, 170) })), MS);
    expect(g).toMatchObject({
      category: "outside_validated_range",
      severity: "high",
      severityNote: "Classification not established at SU; the most conservative severity is applied.",
    });
  });

  it("information_required when the RU set point and NOR are both unknown", () => {
    const g = gap(run(speed(kit, {}, { sp: "tbd", nor: "tbd" })), MS);
    expect(g).toMatchObject({ category: "information_required", activities: ["information_gathering"], status: "open" });
    expect(g.detail).toBe("RU set point TBD (to be determined); RU NOR TBD (to be determined).");
    expect(g.regulatoryNote).toBeUndefined();
    expect(g.rationale).toBe("The comparison cannot be completed until the missing information is established. No value is assumed.");
  });

  it("information_required when the SU PAR is unknown", () => {
    const noPar = gap(run(speed(kit, { par: "tbd" }, { nor: rr(130, 170) })), MS);
    expect(noPar).toMatchObject({ category: "information_required" });
    expect(noPar.detail).toBe("SU PAR TBD (to be determined).");
  });

  it("a matching set point is not enough for 'equivalent' when the RU NOR is unknown but the SU NOR is known", () => {
    expect(categoryOf(speed(kit, {}, { sp: rpm(150), nor: "tbd" }), MS)).toBe("within_validated_range");
  });

  it("the information_required severity for a parameter also follows the classification", () => {
    const cpp = gap(run(speed(kit, { cls: "CPP" }, { sp: "tbd", nor: "tbd" })), MS);
    const free = gap(run(speed(kit, { cls: "non_critical" }, { sp: "tbd", nor: "tbd" })), MS);
    expect([cpp.severity, free.severity]).toEqual(["high", "low"]);
  });

  it("information_required when SU and RU units cannot be compared", () => {
    // Not reachable through the interview (units are validated), so the entry is written directly.
    const p = speed(kit, {});
    const broken = structuredClone(p);
    const e = getEntry(broken, "target.uo.compounding.param.mixing_speed.nor")!;
    e.value = rng(1, 2, "L");
    const g = gap(run(broken), MS);
    expect(g).toMatchObject({ category: "information_required", detail: "SU and RU units are not comparable." });
  });

  it("a parameter marked not applicable is reported as information_required, not as removed or new", () => {
    let p = speed(kit, {});
    p = na(p, "comp.mixing_speed", "target", "Not used at RU (fictional)");
    expect(categoryOf(p, MS)).toBe("information_required");
  });

  it("prefers the SU validated range over the PAR when both are recorded", () => {
    const k = customKit((raw) => {
      const mixSpeed = Object.values(raw.questionFiles as Record<string, any>) // eslint-disable-line @typescript-eslint/no-explicit-any
        .flatMap((f) => f.questions as any[]) // eslint-disable-line @typescript-eslint/no-explicit-any
        .find((x) => x.id === "comp.mixing_speed");
      mixSpeed.input.sourceFields = ["classification", "setPoint", "nor", "par", "validatedRange", "rangeBasis"];
    });
    const target = { sp: rpm(250), nor: rr(220, 280) };
    const withVr = gap(k.run(speed(k, { vr: rr(100, 300) }, target)), MS);
    expect(withVr.category).toBe("within_validated_range");
    expect(withVr.detail).toBe("The RU NOR 220–280 rpm lies within the SU validated range 100–300 rpm.");
    // Validated range unknown: falls back to the PAR, which does not cover the target.
    const fallback = gap(k.run(speed(k, { vr: "tbd" }, target)), MS);
    expect(fallback.category).toBe("outside_validated_range");
    expect(fallback.detail).toContain("SU PAR 100–200 rpm");
    // Without the field at all the same target is outside.
    expect(categoryOf(speed(kit, {}, target), MS)).toBe("outside_validated_range");
  });
});

// ================================================================== scale

describe("scale comparator", () => {
  describe("parameter (batch size, R-BATCH-SIZE)", () => {
    it("an identical batch size is never reported as 'equivalent' with the shipped questions (questionable, kept as is)", () => {
      // The source batch size is answered with a set point and a PAR, the target with a set point and a NOR.
      // The equivalence test compares the NOR on both sides, and the source has none, so it cannot succeed.
      // An identical nominal size inside the PAR therefore ends up as within_validated_range.
      for (const target of [L(100), q(100000, "mL")]) {
        const g = gap(run(batch(kit, { sp: L(100) }, { sp: target, nor: rng(90, 110, "L") })), BATCH);
        expect(g.category).toBe("within_validated_range");
      }
    });

    it("equivalent is reachable when both sides hold a NOR (modified copy of the question)", () => {
      const k = customKit((raw) => {
        const files = Object.values(raw.questionFiles as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
        const bs = files.flatMap((f) => f.questions as any[]).find((x) => x.id === "comp.batch_size"); // eslint-disable-line @typescript-eslint/no-explicit-any
        bs.input.sourceFields = ["setPoint", "nor", "par", "rangeBasis"];
      });
      const p = k.par(k.base(), "comp.batch_size", "source", { setPoint: L(100), nor: rng(90, 110, "L"), par: rng(80, 120, "L"), rangeBasis: "PPQ" });
      const same2 = k.par(p, "comp.batch_size", "target", { setPoint: q(100000, "mL"), nor: rng(90, 110, "L") });
      const g = gap(k.run(same2), BATCH);
      expect(g).toMatchObject({ category: "equivalent", detail: "RU nominal value and range match the SU." });
    });

    it("within_validated_range: the RU window lies inside the SU PAR", () => {
      const g = gap(run(batch(kit, { sp: L(100), par: rng(50, 150, "L") }, { sp: L(120), nor: rng(100, 140, "L") })), BATCH);
      expect(g).toMatchObject({ category: "within_validated_range", severity: "low", activities: [] });
      expect(g.rationale).toBe("The RU batch size lies within the batch size range covered by the SU validation.");
      expect(g.regulatoryNote).toBeUndefined();
    });

    it("scale_change: the ratio of RU to SU set point drives severity (x2 or more is high)", () => {
      const g = gap(run(grown()), BATCH);
      expect(g).toMatchObject({ category: "scale_change", severity: "high", regulatoryNote: REGULATORY_NOTE });
      expect(g.severityNote).toBe("Magnitude ×2.5 (≥ ×2).");
      expect(g.detail).toBe("Nominal scale changes ×2.5 (100 L to 250 L); outside the SU PAR 80–120 L.");
      expect(g.activities).toEqual(["mixing_study", "hold_time_study", "filter_sizing", "media_fill", "engineering_run", "ppq_coverage_assessment"]);
    });

    it("scale_change: a smaller increase is medium", () => {
      const g = gap(run(batch(kit, { sp: L(100) }, { sp: L(150), nor: rng(140, 160, "L") })), BATCH);
      expect(g).toMatchObject({ category: "scale_change", severity: "medium" });
      expect(g.severityNote).toBe("Magnitude ×1.5 (≥ ×1).");
    });

    it("scale_change: a reduction is measured by its inverse ratio (0.4 counts as x2.5)", () => {
      const g = gap(run(batch(kit, { sp: L(100) }, { sp: L(40), nor: rng(35, 45, "L") })), BATCH);
      expect(g).toMatchObject({ category: "scale_change", severity: "high" });
      expect(g.severityNote).toBe("Magnitude ×2.5 (≥ ×2).");
      expect(g.detail).toContain("Nominal scale changes ×0.4 (100 L to 40 L)");
    });

    it("scale_change: the ratio tiers apply regardless of the order they are written in", () => {
      const k = customKit((raw) => {
        rawRule(raw, "R-BATCH-SIZE").config.ratioSeverity.reverse();
      });
      const g = gap(k.run(grown(k)), BATCH);
      expect(g.severity).toBe("high");
      const smaller = gap(k.run(batch(k, { sp: L(100) }, { sp: L(150), nor: rng(140, 160, "L") })), BATCH);
      expect(smaller.severity).toBe("medium");
    });

    it("scale_change below every tier falls back to the rule severity", () => {
      const k = customKit((raw) => {
        rawRule(raw, "R-BATCH-SIZE").config.ratioSeverity = [{ atLeast: 5, severity: "high" }];
      });
      const g = gap(k.run(grown(k)), BATCH);
      expect(g.severity).toBe("medium"); // rule severity
      expect(g.severityNote).toBeUndefined();
    });

    it("information_required when the RU set point is unknown and the NOR is outside the PAR", () => {
      const g = gap(run(batch(kit, { sp: L(100) }, { sp: "tbd", nor: rng(200, 300, "L") })), BATCH);
      expect(g.category).toBe("information_required");
      expect(g.detail).toBe("RU nominal value TBD (to be determined).");
    });

    it("information_required when both RU values are unknown", () => {
      const g = gap(run(batch(kit, { sp: L(100) }, { sp: "tbd", nor: "tbd" })), BATCH);
      expect(g.category).toBe("information_required");
    });
  });

  describe("quantity (equipment capacity, filter area)", () => {
    it("equivalent across units", () => {
      const p = pair(base(), "comp.vessel_capacity", q(100, "L"), q(100000, "mL"));
      expect(gap(run(p), CAPACITY)).toMatchObject({ category: "equivalent", detail: "Same capacity or scale." });
      const area = pair(base(), "filt.area", q(0.1, "m²"), q(1000, "cm²"));
      expect(categoryOf(area, "R-FILTER-AREA:uo.sterile_filtration.mat.sterilizing_filter.area")).toBe("equivalent");
    });

    it("scale_change with medium severity from x2 and low from x1; no regulatory note on this rule", () => {
      const big = gap(run(pair(base(), "comp.vessel_capacity", q(100, "L"), q(250, "L"))), CAPACITY);
      expect(big).toMatchObject({ category: "scale_change", severity: "medium", detail: "Scale changes ×2.5 (100 L to 250 L)." });
      expect(big.regulatoryNote).toBeUndefined();
      const small = gap(run(pair(base(), "comp.vessel_capacity", q(100, "L"), q(150, "L"))), CAPACITY);
      expect(small).toMatchObject({ category: "scale_change", severity: "low" });
      const shrink = gap(run(pair(base(), "comp.vessel_capacity", q(100, "L"), q(40, "L"))), CAPACITY);
      expect(shrink).toMatchObject({ category: "scale_change", severity: "medium" });
    });

    it("converts units for the ratio", () => {
      const g = gap(run(pair(base(), "filt.area", q(0.1, "m²"), q(2500, "cm²"))), "R-FILTER-AREA:uo.sterile_filtration.mat.sterilizing_filter.area");
      expect(g).toMatchObject({ category: "scale_change", severity: "medium" });
      expect(g.detail).toBe("Scale changes ×2.5 (0.1 m² to 2500 cm²).");
    });

    it("information_required when either side is unknown", () => {
      const p = v(unk(base(), "comp.vessel_capacity", "source"), "comp.vessel_capacity", "target", q(100, "L"));
      const g = gap(run(p), CAPACITY);
      expect(g).toMatchObject({ category: "information_required", severity: "low" });
      expect(g.detail).toBe("SU value TBD (to be determined).");
    });
  });
});

// ================================================================== upper / lower limit

describe("upper_limit comparator", () => {
  const dur = (s: number, t: number, su = "h", tu = "h") => pair(base(), "fill.duration", q(s, su), q(t, tu));

  it("equivalent: same limit, also across units (24 h vs 1440 min)", () => {
    expect(gap(run(dur(24, 1440, "h", "min")), FILL_DUR)).toMatchObject({ category: "equivalent", detail: "RU limit equals the SU limit." });
  });

  it("within_validated_range: a lower RU limit is covered by the SU limit", () => {
    const g = gap(run(dur(24, 12)), FILL_DUR);
    expect(g).toMatchObject({ category: "within_validated_range", severity: "low", activities: [] });
    expect(g.detail).toBe("RU 12 h is within the SU validated maximum of 24 h.");
    expect(g.regulatoryNote).toBeUndefined();
  });

  it("outside_validated_range: a higher RU limit exceeds the SU (rule severity, regulatory note)", () => {
    const g = gap(run(dur(24, 36)), FILL_DUR);
    expect(g).toMatchObject({
      category: "outside_validated_range",
      severity: "high",
      regulatoryNote: REGULATORY_NOTE,
      activities: ["media_fill", "hold_time_study", "ppq_coverage_assessment"],
    });
    expect(g.detail).toBe("RU 36 h exceeds the SU validated maximum of 24 h.");
    expect(categoryOf(dur(24, 1500, "h", "min"), FILL_DUR)).toBe("outside_validated_range"); // 25 h
  });

  it("the within outcome of the hold time rule carries its own rationale", () => {
    let p = grown();
    p = pair(p, "comp.hold_time", q(48, "h"), q(24, "h"));
    const g = gap(run(p), HOLD);
    expect(g).toMatchObject({ category: "within_validated_range", rationale: "The planned maximum hold time is within the validated hold time." });
    const out = gap(run(pair(grown(), "comp.hold_time", q(24, "h"), q(48, "h"))), HOLD);
    expect(out).toMatchObject({ category: "outside_validated_range", severity: "high" });
  });

  it("information_required when a side is unknown", () => {
    const p = v(unk(base(), "fill.duration", "source"), "fill.duration", "target", q(24, "h"));
    expect(gap(run(p), FILL_DUR)).toMatchObject({ category: "information_required", severity: "high" });
  });

  it("SU not applicable and RU present is a new requirement", () => {
    const p = v(na(base(), "fill.duration", "source", "No limit (fictional)"), "fill.duration", "target", q(24, "h"));
    expect(categoryOf(p, FILL_DUR)).toBe("new_requirement");
  });
});

describe("lower_limit comparator (not used by the shipped rules; exercised on a modified copy)", () => {
  const k = customKit((raw) => {
    rawRule(raw, "R-FILL-DURATION").comparator = "lower_limit";
  });
  const dur = (s: number, t: number) => k.pair(k.base(), "fill.duration", q(s, "h"), q(t, "h"));

  it("a higher RU minimum is within the SU minimum", () => {
    const g = gap(k.run(dur(10, 12)), FILL_DUR);
    expect(g).toMatchObject({ category: "within_validated_range", comparator: "lower_limit" });
    expect(g.detail).toBe("RU 12 h is within the SU validated minimum of 10 h.");
  });

  it("a lower RU minimum is outside", () => {
    const g = gap(k.run(dur(10, 8)), FILL_DUR);
    expect(g.category).toBe("outside_validated_range");
    // Questionable wording kept as written: a target *below* a minimum is described as "exceeds ... minimum".
    expect(g.detail).toBe("RU 8 h exceeds the SU validated minimum of 10 h.");
  });

  it("equal minimums are equivalent", () => {
    expect(categoryOf(dur(10, 10), FILL_DUR)).toBe("equivalent");
  });
});

// ================================================================== enum / text

describe("enum comparator", () => {
  it("equivalent: same value", () => {
    const g = gap(run(pair(base(), "fill.pump", "rotary_piston", "rotary_piston")), PUMP);
    expect(g).toMatchObject({ category: "equivalent", detail: "SU and RU are the same.", severity: "none", activities: [] });
  });

  it("different_principle: values differ; rule severity, regulatory note and activities apply", () => {
    const g = gap(run(pair(base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP);
    expect(g).toMatchObject({
      category: "different_principle",
      severity: "high",
      ruleSeverity: "high",
      detail: "SU and RU differ.",
      regulatoryNote: REGULATORY_NOTE,
      status: "open",
      activities: ["engineering_run", "fill_accuracy_study", "product_quality_impact", "comparability_assessment", "equipment_qualification", "ppq", "procedure_update", "training"],
    });
    expect(g.rationale).toContain("A different principle is a design change.");
  });

  it("a rule without the regulatory flag raises no note (batch record system)", () => {
    const p = pair(base(), "site.batch_record", "paper", "electronic");
    const g = gap(run(p), "R-SITE-BRS:site.batchRecordSystem");
    expect(g).toMatchObject({ category: "different_principle", severity: "medium" });
    expect(g.regulatoryNote).toBeUndefined();
  });

  it("same-as-SU resolves live: equivalent, shown as such, citing both entries", () => {
    let p = v(base(), "fill.pump", "source", "rotary_piston");
    p = same(p, "fill.pump");
    const g = gap(run(p), PUMP);
    expect(g.category).toBe("equivalent");
    expect(g.targetDisplay).toBe("Rotary piston pump (same as SU)");
    expect(g.inputEntryIds).toHaveLength(2);
    // Changing the source afterwards changes the result without touching the target answer.
    const changed = v(p, "fill.pump", "source", "peristaltic");
    expect(categoryOf(changed, PUMP)).toBe("equivalent");
    expect(gap(run(changed), PUMP).sourceDisplay).toBe("Peristaltic pump");
  });

  it("information_required when a side is unknown, with the missing side named", () => {
    const g = gap(run(v(unk(base(), "fill.pump", "source"), "fill.pump", "target", "peristaltic")), PUMP);
    expect(g).toMatchObject({ category: "information_required", detail: "SU value TBD (to be determined).", activities: ["information_gathering"] });
    expect(g.regulatoryNote).toBeUndefined();
    const both = gap(run(unk(unk(base(), "fill.pump", "source"), "fill.pump", "target")), PUMP);
    expect(both.detail).toBe("SU value TBD (to be determined); RU value TBD (to be determined).");
  });

  it("information_required when a side was never answered", () => {
    const g = gap(run(v(base(), "fill.pump", "source", "rotary_piston")), PUMP);
    expect(g).toMatchObject({ category: "information_required", detail: "RU value not established." }); // sentence starts with a capital even when the source is fine
  });

  it("config.differentAs chooses the category for a difference", () => {
    const k = customKit((raw) => {
      rawRule(raw, "R-FILL-PUMP").config = { differentAs: "outside_validated_range" };
    });
    expect(gap(k.run(k.pair(k.base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP).category).toBe("outside_validated_range");
    expect(gap(k.run(k.pair(k.base(), "fill.pump", "rotary_piston", "rotary_piston")), PUMP).category).toBe("equivalent");
  });
});

describe("text comparator", () => {
  it("equivalent: ignores case and extra spacing", () => {
    const p = pair(base(), "filt.supplier", "Filter Vendor A (fictional)", "  filter   vendor a (fictional) ");
    expect(gap(run(p), SUPPLIER).category).toBe("equivalent");
  });

  it("different_principle: a different supplier is a design change with a regulatory note", () => {
    const g = gap(run(pair(base(), "filt.supplier", "Filter Vendor A (fictional)", "Filter Vendor B (fictional)")), SUPPLIER);
    expect(g).toMatchObject({ category: "different_principle", severity: "high", regulatoryNote: REGULATORY_NOTE });
    expect(g.sourceDisplay).toBe("Filter Vendor A (fictional)");
    expect(g.targetDisplay).toBe("Filter Vendor B (fictional)");
  });

  it("information_required when the RU is unknown", () => {
    const p = unk(v(base(), "filt.supplier", "source", "Filter Vendor A (fictional)"), "filt.supplier", "target");
    expect(gap(run(p), SUPPLIER).category).toBe("information_required");
  });
});

// ================================================================== presence

describe("presence comparator", () => {
  it("equivalent when present on both sides", () => {
    expect(gap(run(pair(base(), "filt.sua", "yes", "yes")), SUA)).toMatchObject({ category: "equivalent", detail: "Present at SU and RU." });
  });

  it("equivalent when absent on both sides", () => {
    expect(gap(run(pair(base(), "filt.sua", "no", "no")), SUA)).toMatchObject({ category: "equivalent", detail: "Not used at SU or RU." });
  });

  it("new_requirement: absent at SU, present at RU, with the rule's activities", () => {
    const g = gap(run(pair(base(), "filt.sua", "no", "yes")), SUA);
    expect(g).toMatchObject({
      category: "new_requirement",
      severity: "medium",
      regulatoryNote: REGULATORY_NOTE,
      detail: "Absent at SU; present at RU.",
      sourceDisplay: "No",
      targetDisplay: "Yes",
      activities: ["extractables_leachables", "filter_compatibility", "procedure_update", "training"],
    });
  });

  it("removed_element: present at SU, absent at RU; the outcome overrides rationale and activities", () => {
    const g = gap(run(pair(base(), "filt.sua", "yes", "no")), SUA);
    expect(g).toMatchObject({
      category: "removed_element",
      detail: "Present at SU; absent at RU.",
      activities: ["equipment_qualification", "procedure_update", "training"],
      rationale: "Replacing a single-use assembly with reusable equipment introduces cleaning and sterilization requirements.",
      severity: "medium",
    });
  });

  it("a unit operation present at only one site is flagged high (R-UO-PRESENCE)", () => {
    let p = base();
    p = v(p, "comp.presence", "target", "no");
    const g = gap(run(p), "R-UO-PRESENCE:uo.compounding.presence");
    expect(g).toMatchObject({ category: "removed_element", severity: "high", regulatoryNote: REGULATORY_NOTE });
  });

  it("information_required when one answer is unknown", () => {
    const p = unk(v(base(), "filt.sua", "source", "yes"), "filt.sua", "target");
    expect(gap(run(p), SUA).category).toBe("information_required");
  });
});

// ================================================================== set

describe("set comparator (R-INTEGRITY-TESTS)", () => {
  const sets = (s: string[], t: string[]) => pair(base(), "filt.integrity", s, t);

  it("equivalent: same elements in a different order", () => {
    const g = gap(run(sets(["pre_use_pre_sterilization", "post_use"], ["post_use", "pre_use_pre_sterilization"])), INTEGRITY);
    expect(g).toMatchObject({ category: "equivalent", detail: "Same elements at SU and RU." });
    expect(g.subKey).toBeUndefined();
  });

  it("removed_element: one gap per removed element, keyed with the element and keeping the rule severity", () => {
    const a = run(sets(["pre_use_pre_sterilization", "post_use"], ["post_use"]));
    const g = gap(a, `${INTEGRITY}#pre_use_pre_sterilization`);
    expect(g).toMatchObject({
      category: "removed_element",
      subKey: "pre_use_pre_sterilization",
      severity: "high",
      regulatoryNote: REGULATORY_NOTE,
      attribute: "Filter integrity tests: Pre-use pre-sterilization integrity test",
      detail: "Pre-use pre-sterilization integrity test: present at SU, absent at RU.",
    });
    expect(a.gaps.filter((x) => x.questionId === "filt.integrity")).toHaveLength(1);
  });

  it("new_requirement: an added element uses the outcome's low severity, no regulatory note, own activities", () => {
    const g = gap(run(sets(["post_use"], ["post_use", "pre_use_pre_sterilization"])), `${INTEGRITY}#pre_use_pre_sterilization`);
    expect(g).toMatchObject({
      category: "new_requirement",
      severity: "low",
      activities: ["procedure_update", "training"],
      rationale: "An additional integrity test strengthens the control strategy; procedures and training are needed.",
    });
    expect(g.regulatoryNote).toBeUndefined();
  });

  it("reports additions before removals, one gap per element, with consecutive display ids", () => {
    const a = run(sets(["post_use"], ["pre_use_pre_sterilization"]));
    const mine = a.gaps.filter((x) => x.questionId === "filt.integrity");
    expect(mine.map((x) => [x.subKey, x.category])).toEqual([
      ["pre_use_pre_sterilization", "new_requirement"],
      ["post_use", "removed_element"],
    ]);
    const n = (x: Gap) => Number(x.displayId.slice(2));
    expect(n(mine[1]!)).toBe(n(mine[0]!) + 1);
    expect(new Set(a.gaps.map((x) => x.key)).size).toBe(a.gaps.length); // keys are unique
  });

  it("in-process control panels (R-IPC-SET) use medium for removals and low for additions", () => {
    const rem = gap(run(pair(base(), "comp.ipc", ["ph", "osmolality"], ["ph"])), "R-IPC-SET:uo.compounding.ipc.panel.tests#osmolality");
    expect(rem).toMatchObject({ category: "removed_element", severity: "medium", regulatoryNote: REGULATORY_NOTE });
    const add = gap(run(pair(base(), "comp.ipc", ["ph"], ["ph", "density"])), "R-IPC-SET:uo.compounding.ipc.panel.tests#density");
    expect(add).toMatchObject({ category: "new_requirement", severity: "low" });
    expect(add.regulatoryNote).toBeUndefined();
  });

  it("information_required when a side is unknown", () => {
    const p = unk(v(base(), "filt.integrity", "source", ["post_use"]), "filt.integrity", "target");
    expect(gap(run(p), INTEGRITY).category).toBe("information_required");
  });
});

// ================================================================== coverage

describe("coverage comparator", () => {
  describe("mixing study coverage of the RU batch size (SU study, RU value)", () => {
    const cov = (c: Parameters<typeof v>[3]) => v(grown(), "comp.mixing_coverage", "source", c);

    it("within_validated_range when the RU NOR lies inside the covered range", () => {
      const g = gap(run(cov(rng(20, 400, "L"))), MIX_COV);
      expect(g).toMatchObject({ category: "within_validated_range", severity: "low", activities: [], detail: "200–300 L is within the covered range 20–400 L." });
      expect(g.regulatoryNote).toBeUndefined();
    });

    it("outside_validated_range when the RU NOR extends beyond it (rule severity high)", () => {
      const g = gap(run(cov(rng(20, 100, "L"))), MIX_COV);
      expect(g).toMatchObject({ category: "outside_validated_range", severity: "high", activities: ["mixing_study"], detail: "200–300 L is not within the covered range 20–100 L." });
      expect(g.regulatoryNote).toBeUndefined(); // rule is not flagged for regulatory assessment
    });

    it("the range is compared in a common unit", () => {
      expect(categoryOf(cov(rng(20000, 400000, "mL")), MIX_COV)).toBe("within_validated_range");
    });

    it("uses the RU set point when the NOR is unknown", () => {
      const p = v(
        batch(kit, { sp: L(100) }, { sp: L(250), nor: "tbd" }),
        "comp.mixing_coverage",
        "source",
        rng(20, 300, "L"),
      );
      const g = gap(run(p), MIX_COV);
      expect(g).toMatchObject({ category: "within_validated_range", detail: "250 L is within the covered range 20–300 L." });
      expect(categoryOf(v(batch(kit, { sp: L(100) }, { sp: L(250), nor: "tbd" }), "comp.mixing_coverage", "source", rng(20, 200, "L")), MIX_COV)).toBe("outside_validated_range");
    });

    it("shows the checked value in the RU column and nothing in the SU column of other rows", () => {
      const g = gap(run(cov(rng(20, 100, "L"))), MIX_COV);
      expect(g.sourceDisplay).toBe("20–100 L");
      expect(g.targetDisplay).toBe("Checked against: SP 250 L; NOR 200–300 L");
    });

    it("information_required when the coverage is unknown, naming the missing item", () => {
      const g = gap(run(unk(grown(), "comp.mixing_coverage", "source")), MIX_COV);
      expect(g.category).toBe("information_required");
      expect(g.detail).toContain("Covered range (SU) TBD (to be determined)");
    });

  });

  describe("APS duration coverage (RU study, RU value, quantity)", () => {
    const longer = () => pair(base(), "fill.duration", q(24, "h"), q(36, "h"));

    it("within_validated_range when the media fill covers the planned duration", () => {
      const g = gap(run(v(longer(), "fill.aps", "target", q(48, "h"))), APS);
      expect(g).toMatchObject({ category: "within_validated_range", severity: "low", detail: "36 h is within the covered range ≤ 48 h." });
    });

    it("converts units: 2880 min covers 36 h", () => {
      expect(categoryOf(v(longer(), "fill.aps", "target", q(2880, "min")), APS)).toBe("within_validated_range");
      expect(categoryOf(v(longer(), "fill.aps", "target", q(2000, "min")), APS)).toBe("outside_validated_range");
    });

    it("outside_validated_range when it does not (boundary is inclusive)", () => {
      const g = gap(run(v(longer(), "fill.aps", "target", q(30, "h"))), APS);
      expect(g).toMatchObject({ category: "outside_validated_range", severity: "high", activities: ["media_fill"], detail: "36 h is not within the covered range ≤ 30 h." });
      expect(categoryOf(v(longer(), "fill.aps", "target", q(36, "h")), APS)).toBe("within_validated_range");
    });

    it("information_required when the APS coverage is unknown", () => {
      expect(categoryOf(unk(longer(), "fill.aps", "target"), APS)).toBe("information_required");
    });

    it("information_required when the checked value is not established, naming it", () => {
      // The APS question is also shown when the batch size grows, even if the target duration is unknown.
      const p = v(unk(grown(), "fill.duration", "target"), "fill.aps", "target", q(48, "h"));
      const g = gap(run(v(p, "fill.duration", "source", q(24, "h"))), APS);
      expect(g.category).toBe("information_required");
      expect(g.detail).toBe("Compared value (RU) TBD (to be determined).");
    });

    it("is an RU-only row: the SU column is a dash", () => {
      const g = gap(run(v(longer(), "fill.aps", "target", q(30, "h"))), APS);
      expect(g.sourceDisplay).toBe("—");
      expect(g.targetDisplay).toBe("30 h");
    });
  });
});

// ================================================================== evidence

describe("evidence comparator (RU-side answer mapped to a category)", () => {
  const pumpChanged = () => pair(base(), "fill.pump", "rotary_piston", "peristaltic");
  const filterChanged = () => pair(base(), "filt.membrane", "pes", "pvdf");

  it("within_validated_range: evidence available", () => {
    const g = gap(run(v(pumpChanged(), "fill.accuracy", "target", "available")), ACCURACY);
    expect(g).toMatchObject({ category: "within_validated_range", severity: "low", detail: "Answer: Available and applicable.", activities: [] });
    expect(g.regulatoryNote).toBeUndefined();
  });

  it("outside_validated_range: planned or not planned, with the rule's severity and activities", () => {
    for (const answer of ["planned", "not_planned"]) {
      const g = gap(run(v(pumpChanged(), "fill.accuracy", "target", answer)), ACCURACY);
      expect(g, answer).toMatchObject({ category: "outside_validated_range", severity: "high", activities: ["fill_accuracy_study", "engineering_run"] });
    }
    expect(gap(run(v(pumpChanged(), "fill.accuracy", "target", "planned")), ACCURACY).detail).toBe("Answer: Planned, not yet available.");
  });

  it("each evidence rule uses its own answer map and regulatory flag", () => {
    const shearNo = gap(run(v(pumpChanged(), "fill.shear", "target", "no_impact")), SHEAR);
    expect(shearNo.category).toBe("within_validated_range");
    expect(shearNo.regulatoryNote).toBeUndefined();
    const shearImpact = gap(run(v(pumpChanged(), "fill.shear", "target", "impact")), SHEAR);
    expect(shearImpact).toMatchObject({ category: "outside_validated_range", severity: "high", regulatoryNote: REGULATORY_NOTE });
    expect(categoryOf(v(pumpChanged(), "fill.shear", "target", "not_assessed"), SHEAR)).toBe("outside_validated_range");
    expect(categoryOf(v(filterChanged(), "filt.bret", "target", "covered"), BRET)).toBe("within_validated_range");
    const bridging = gap(run(v(filterChanged(), "filt.bret", "target", "bridging_required")), BRET);
    expect(bridging).toMatchObject({ category: "outside_validated_range", severity: "high", regulatoryNote: REGULATORY_NOTE });
    expect(categoryOf(v(filterChanged(), "filt.bret", "target", "not_covered"), BRET)).toBe("outside_validated_range");
  });

  it("procedures map to equivalent, or new_requirement for both update and new (the RU value tells them apart)", () => {
    expect(categoryOf(v(base(), "comp.procedures", "target", "in_place"), COMP_PROC)).toBe("equivalent");
    const upd = gap(run(v(base(), "comp.procedures", "target", "update_required")), COMP_PROC);
    expect(upd).toMatchObject({ category: "new_requirement", severity: "low", activities: ["procedure_update", "training"], targetDisplay: "Exist; update required" });
    expect(upd.regulatoryNote).toBeUndefined();
    expect(gap(run(v(base(), "comp.procedures", "target", "new_required")), COMP_PROC)).toMatchObject({ category: "new_requirement", severity: "low", targetDisplay: "New procedures required" });
  });

  it("is an RU-only row: the SU column is a dash", () => {
    const g = gap(run(v(pumpChanged(), "fill.accuracy", "target", "planned")), ACCURACY);
    expect(g.sourceDisplay).toBe("—");
    expect(g.targetDisplay).toBe("Planned, not yet available");
  });

  it("information_required when the answer is unknown or missing", () => {
    expect(gap(run(unk(pumpChanged(), "fill.accuracy", "target")), ACCURACY)).toMatchObject({ category: "information_required", detail: "Evidence status TBD (to be determined)." });
    expect(gap(run(pumpChanged()), ACCURACY)).toMatchObject({ category: "information_required", detail: "Evidence status not established." });
  });

  it("not applicable reads as equivalent and quotes the justification", () => {
    const g = gap(run(na(pumpChanged(), "fill.accuracy", "target", "Surrogate data used (fictional)")), ACCURACY);
    expect(g).toMatchObject({ category: "equivalent", detail: "Not applicable: Surrogate data used (fictional)" });
  });

  it("an answer with no mapping is information_required and says so", () => {
    const k = customKit((raw) => {
      delete rawRule(raw, "R-EV-FILL-ACCURACY").config.map.planned;
    });
    const p = k.v(k.pair(k.base(), "fill.pump", "rotary_piston", "peristaltic"), "fill.accuracy", "target", "planned");
    expect(gap(k.run(p), ACCURACY)).toMatchObject({ category: "information_required", detail: 'No rule mapping for answer "planned".' });
  });
});

// ================================================================== not applicable

describe("not_applicable handling", () => {
  const vessel = (s: "na" | "unknown" | string, t: "na" | "unknown" | string) => {
    let p = base();
    p = s === "na" ? na(p, "comp.vessel_type", "source", "Not used (fictional)") : s === "unknown" ? unk(p, "comp.vessel_type", "source") : v(p, "comp.vessel_type", "source", s);
    p = t === "na" ? na(p, "comp.vessel_type", "target", "Not used (fictional)") : t === "unknown" ? unk(p, "comp.vessel_type", "target") : v(p, "comp.vessel_type", "target", t);
    return gap(run(p), VESSEL);
  };

  it("not applicable on both sides is equivalent", () => {
    expect(vessel("na", "na")).toMatchObject({ category: "equivalent", detail: "Not applicable at SU or RU." });
  });

  it("not applicable at SU with a value at RU is a new requirement", () => {
    const g = vessel("na", "glass");
    expect(g).toMatchObject({ category: "new_requirement", detail: "Not applicable at SU; present at RU.", severity: "medium", regulatoryNote: REGULATORY_NOTE });
    expect(g.sourceDisplay).toBe("Not applicable: Not used (fictional)");
  });

  it("a value at SU with not applicable at RU is a removed element", () => {
    expect(vessel("glass", "na")).toMatchObject({ category: "removed_element", detail: "Present at SU; not applicable at RU." });
  });

  it("not applicable against an unknown is information_required", () => {
    expect(vessel("na", "unknown").category).toBe("information_required");
    expect(vessel("unknown", "na").category).toBe("information_required");
  });

  it("works for quantity, presence and set questions too", () => {
    const cap = gap(run(v(na(base(), "comp.vessel_capacity", "source", "n/a (fictional)"), "comp.vessel_capacity", "target", q(10, "L"))), CAPACITY);
    expect(cap.category).toBe("new_requirement");
    const integrity = gap(run(na(v(base(), "filt.integrity", "source", ["post_use"]), "filt.integrity", "target", "Not tested (fictional)")), INTEGRITY);
    expect(integrity.category).toBe("removed_element");
  });
});

// ================================================================== severity

describe("severity rules", () => {
  it("equivalent is always none, whatever the rule says", () => {
    const g = gap(run(pair(base(), "fill.pump", "rotary_piston", "rotary_piston")), PUMP);
    expect([g.severity, g.ruleSeverity]).toEqual(["none", "none"]);
  });

  it("within_validated_range is always low unless an outcome says otherwise", () => {
    const g = gap(run(pair(base(), "fill.duration", q(24, "h"), q(12, "h"))), FILL_DUR);
    expect(g.severity).toBe("low");
  });

  it("an outcome severity beats the rule severity", () => {
    const k = customKit((raw) => {
      const r = rawRule(raw, "R-FILL-PUMP");
      r.outcomes = { different_principle: { severity: "low" } };
    });
    expect(gap(k.run(k.pair(k.base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP).severity).toBe("low");
  });

  it("an outcome severity beats the classification map and the ratio tiers", () => {
    const k = customKit((raw) => {
      rawRule(raw, "R-PARAM-RANGE").outcomes.outside_validated_range = { severity: "none" };
      rawRule(raw, "R-BATCH-SIZE").outcomes.scale_change = { severity: "low" };
    });
    expect(gap(k.run(speed(k, { cls: "CPP" }, { nor: rr(90, 170) })), MS).severity).toBe("none");
    expect(gap(k.run(grown(k)), BATCH).severity).toBe("low");
  });

  it("the classification map applies only to parameter questions", () => {
    // R-FILL-PUMP has no map; a modified copy with one still does not use it for a non-parameter question.
    const k = customKit((raw) => {
      rawRule(raw, "R-FILL-PUMP").severityBy = { classification: { CPP: "low" } };
    });
    expect(gap(k.run(k.pair(k.base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP)).toMatchObject({ severity: "high" });
    expect(gap(k.run(k.pair(k.base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP).severityNote).toBeUndefined();
  });

  it("a classification that has no entry in the map falls back to the most conservative severity", () => {
    const k = customKit((raw) => {
      rawRule(raw, "R-PARAM-RANGE").severityBy = { classification: { CPP: "high", KPP: "low" } };
    });
    const g = gap(k.run(speed(k, { cls: "non_critical" }, { nor: rr(90, 170) })), MS);
    expect(g.severity).toBe("high");
    expect(g.severityNote).toContain("most conservative");
  });

  it("information_required uses the rule severity for non-parameter questions", () => {
    const g = gap(run(unk(unk(base(), "fill.pump", "source"), "fill.pump", "target")), PUMP);
    expect(g.severity).toBe("high");
    const m = gap(run(unk(unk(base(), "comp.mixer", "source"), "comp.mixer", "target")), "R-MIXER:uo.compounding.equip.mixer.operatingPrinciple");
    expect(m.severity).toBe("medium");
  });

  it("severity is never below the rule's tier by accident: sorting keys follow none < low < medium < high", () => {
    expect(SEVERITY_RANK).toEqual({ none: 0, low: 1, medium: 2, high: 3 });
  });
});

// ================================================================== regulatory note

describe("regulatory note rules", () => {
  it("the note text is fixed", () => {
    expect(REGULATORY_NOTE).toBe("Requires regulatory affairs assessment.");
  });

  it("follows the rule flag for differences", () => {
    expect(gap(run(pair(base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP).regulatoryNote).toBe(REGULATORY_NOTE);
    expect(gap(run(pair(base(), "site.batch_record", "paper", "electronic")), "R-SITE-BRS:site.batchRecordSystem").regulatoryNote).toBeUndefined();
  });

  it("never appears on equivalent or information_required rows, even when every rule is flagged", () => {
    const k = customKit((raw) => {
      for (const file of Object.values(raw.ruleFiles) as any[]) for (const r of file.rules) r.regulatory = true; // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    let p = k.pair(k.base(), "fill.pump", "rotary_piston", "rotary_piston"); // equivalent
    p = k.unk(p, "comp.mixer", "source"); // information required
    p = k.pair(p, "comp.vessel_type", "glass", "stainless_tank"); // difference
    const a = k.run(p);
    for (const g of a.gaps) {
      if (g.category === "equivalent" || g.category === "information_required") expect(g.regulatoryNote, g.key).toBeUndefined();
    }
    expect(a.gaps.some((g) => g.category === "equivalent")).toBe(true);
    expect(a.gaps.some((g) => g.category === "information_required")).toBe(true);
    expect(gap(a, VESSEL).regulatoryNote).toBe(REGULATORY_NOTE);
  });

  it("within_validated_range is not flagged by default, even when the rule is", () => {
    const g = gap(run(speed(kit, {}, { sp: rpm(160), nor: rr(130, 170) })), MS);
    expect(g.category).toBe("within_validated_range");
    expect(g.regulatoryNote).toBeUndefined(); // R-PARAM-RANGE is flagged
  });

  it("an outcome can switch the flag on for within_validated_range, or off for a difference", () => {
    const on = customKit((raw) => {
      rawRule(raw, "R-PARAM-RANGE").outcomes.within_validated_range.regulatory = true;
    });
    expect(gap(on.run(speed(on, {}, { sp: rpm(160), nor: rr(130, 170) })), MS).regulatoryNote).toBe(REGULATORY_NOTE);
    const off = customKit((raw) => {
      rawRule(raw, "R-FILL-PUMP").outcomes = { different_principle: { regulatory: false } };
    });
    expect(gap(off.run(off.pair(off.base(), "fill.pump", "rotary_piston", "peristaltic")), PUMP).regulatoryNote).toBeUndefined();
  });

  it("an outcome flag applies only to its own category (set elements)", () => {
    const a = run(pair(base(), "filt.integrity", ["pre_use_pre_sterilization"], ["post_use"]));
    expect(gap(a, `${INTEGRITY}#pre_use_pre_sterilization`).regulatoryNote).toBe(REGULATORY_NOTE); // removed: rule flag
    expect(gap(a, `${INTEGRITY}#post_use`).regulatoryNote).toBeUndefined(); // added: outcome says false
  });
});

// ================================================================== activities and rationale

describe("activities and rationale defaults", () => {
  it("equivalent has no activities", () => {
    expect(gap(run(pair(base(), "fill.pump", "peristaltic", "peristaltic")), PUMP).activities).toEqual([]);
  });

  it("information_required defaults to information gathering", () => {
    expect(gap(run(v(base(), "fill.pump", "source", "peristaltic")), PUMP).activities).toEqual(["information_gathering"]);
  });

  it("within_validated_range defaults to no activities unless the outcome lists some", () => {
    expect(gap(run(pair(base(), "fill.duration", q(24, "h"), q(12, "h"))), FILL_DUR).activities).toEqual([]);
    expect(gap(run(speed(kit, {}, { sp: rpm(160), nor: rr(130, 170) })), MS).activities).toEqual(["procedure_update"]);
  });

  it("other categories take the rule's activities; an outcome list replaces them", () => {
    expect(gap(run(pair(base(), "fill.pump", "peristaltic", "time_pressure")), PUMP).activities).toContain("fill_accuracy_study");
    expect(gap(run(pair(base(), "filt.sua", "yes", "no")), SUA).activities).toEqual(["equipment_qualification", "procedure_update", "training"]);
  });

  it("an outcome can customise the information_required row", () => {
    const k = customKit((raw) => {
      rawRule(raw, "R-FILL-PUMP").outcomes = { information_required: { activities: ["training"], why: "Custom reason (fictional)." } };
    });
    const g = gap(k.run(k.v(k.base(), "fill.pump", "source", "peristaltic")), PUMP);
    expect(g).toMatchObject({ category: "information_required", activities: ["training"], rationale: "Custom reason (fictional)." });
  });

  it("rationale: the rule's reason for differences, a stock sentence otherwise", () => {
    expect(gap(run(pair(base(), "fill.pump", "peristaltic", "time_pressure")), PUMP).rationale).toContain("design change");
    const within = gap(run(pair(base(), "fill.duration", q(24, "h"), q(12, "h"))), FILL_DUR);
    expect(within.rationale).toContain("no additional validation activity is implied");
  });
});

// ================================================================== record contents and ordering

describe("gap records", () => {
  it("carry rule, question and section traceability", () => {
    const p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    const g = gap(run(p), PUMP);
    expect(g).toMatchObject({
      key: PUMP,
      ruleId: "R-FILL-PUMP",
      ruleVersion: "1.0.0",
      ruleTitle: "Filling pump operating principle",
      comparator: "enum",
      questionId: "fill.pump",
      sectionId: "uo.aseptic_filling",
      uoKey: "aseptic_filling",
      path: "uo.aseptic_filling.equip.filler.operatingPrinciple",
      attribute: "Filling pump principle",
      sourceDisplay: "Rotary piston pump",
      targetDisplay: "Peristaltic pump",
    });
    expect(g.inputRefs).toEqual([
      "source.uo.aseptic_filling.equip.filler.operatingPrinciple",
      "target.uo.aseptic_filling.equip.filler.operatingPrinciple",
    ]);
    expect(g.inputEntryIds).toEqual([
      getEntry(p, g.inputRefs[0]!)!.id,
      getEntry(p, g.inputRefs[1]!)!.id,
    ]);
  });

  it("a parameter gap records the classification entry as an input and shows all fields", () => {
    const g = gap(run(speed(kit, {}, { nor: rr(90, 170) })), MS);
    expect(g.inputRefs).toContain("source.uo.compounding.param.mixing_speed.classification");
    expect(g.inputRefs).toContain("target.uo.compounding.param.mixing_speed.nor");
    expect(g.sourceDisplay).toContain("PAR 100–200 rpm");
    expect(g.targetDisplay).toBe("SP 150 rpm; NOR 90–170 rpm");
    expect(g.sourceDisplay.startsWith("Class ")).toBe(true);
  });

  it("have unique keys of the form ruleId:path", () => {
    const a = run(grown());
    expect(new Set(a.gaps.map((x) => x.key)).size).toBe(a.gaps.length);
    for (const g of a.gaps) expect(g.key).toBe(`${g.ruleId}:${g.path}${g.subKey ? `#${g.subKey}` : ""}`);
  });

  it("numbers differences G-001... and equivalents EQ-001... separately, in document order", () => {
    let p = pair(base(), "fill.pump", "rotary_piston", "rotary_piston");
    p = pair(p, "comp.vessel_type", "glass", "stainless_tank");
    p = pair(p, "comp.mixer", "rocking", "rocking");
    p = pair(p, "filt.supplier", "A (fictional)", "B (fictional)");
    const a = run(p);
    const diffs = a.gaps.filter((g) => g.category !== "equivalent").map((g) => g.displayId);
    const eqs = a.gaps.filter((g) => g.category === "equivalent").map((g) => g.displayId);
    expect(diffs).toEqual(diffs.map((_, i) => `G-${String(i + 1).padStart(3, "0")}`));
    expect(eqs).toEqual(eqs.map((_, i) => `EQ-${String(i + 1).padStart(3, "0")}`));
    expect(eqs.length).toBeGreaterThanOrEqual(2);
    // Document order: compounding rows precede sterile filtration rows, which precede filling.
    const order = a.gaps.map((g) => g.uoKey);
    expect(order.indexOf("compounding")).toBeLessThan(order.indexOf("sterile_filtration"));
    expect(order.lastIndexOf("sterile_filtration")).toBeLessThan(order.indexOf("aseptic_filling"));
  });

  it("informational rules (site name) produce no row", () => {
    const p = pair(base(), "site.name", "SU Site (fictional)", "RU Site (fictional)");
    expect(run(p).gaps.some((g) => g.ruleId === "R-SITE-INFO")).toBe(false);
  });

  it("SU-only or RU-only questions with no rule produce no row", () => {
    const a = run(base());
    expect(a.gaps.every((g) => g.ruleId.startsWith("R-"))).toBe(true);
    expect(a.gaps.some((g) => g.questionId === "scope.program")).toBe(false);
  });

  it("a paired row is not produced until both sides are visible (no questions for a unit operation absent at a site)", () => {
    let p = base();
    p = v(p, "fill.presence", "target", "no");
    const a = run(p);
    expect(a.gaps.some((g) => g.questionId === "fill.pump")).toBe(false);
    expect(a.gaps.some((g) => g.key === "R-UO-PRESENCE:uo.aseptic_filling.presence")).toBe(true);
  });

  it("recomputes from current answers: re-answering changes the category", () => {
    let p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    expect(categoryOf(p, PUMP)).toBe("different_principle");
    p = v(p, "fill.pump", "target", "rotary_piston");
    expect(categoryOf(p, PUMP)).toBe("equivalent");
  });
});

describe("open items", () => {
  it("lists TBD and not-established entries of visible questions, not N/A or established ones", () => {
    let p = base();
    p = unk(v(p, "fill.pump", "source", "rotary_piston"), "fill.pump", "target");
    p = na(p, "comp.vessel_type", "source", "Not used (fictional)");
    const items = run(p).openItems;
    const pump = items.find((o) => o.ref === "target.uo.aseptic_filling.equip.filler.operatingPrinciple")!;
    expect(pump).toMatchObject({ status: "tbd", tbd: {}, side: "target", questionId: "fill.pump", prompt: "Filling pump operating principle", sectionId: "uo.aseptic_filling" });
    expect(items.some((o) => o.ref === "source.uo.aseptic_filling.equip.filler.operatingPrinciple")).toBe(false);
    expect(items.some((o) => o.ref === "source.uo.compounding.equip.vessel.type")).toBe(false);
    const unanswered = items.find((o) => o.ref === "target.uo.compounding.equip.vessel.type")!;
    expect(unanswered.status).toBe("not_established");
  });

  it("a same-as-SU answer whose SU is TBD is listed once, on the SU, where it has to be resolved", () => {
    // The retired "Unknown" was listed on both sides. A TBD is a commitment with an owner, so the RU row would only repeat the SU's.
    let p = unk(base(), "fill.pump", "source");
    p = same(p, "fill.pump");
    const items = run(p).openItems.filter((o) => o.questionId === "fill.pump");
    expect(items.map((o) => `${o.side}:${o.status}`).sort()).toEqual(["source:tbd"]);
  });
});

describe("riskRanked", () => {
  it("drops equivalents and orders by severity, then category weight, then document order", () => {
    let p = grown();
    p = pair(p, "fill.pump", "rotary_piston", "peristaltic");
    p = pair(p, "comp.vessel_type", "glass", "stainless_tank");
    p = pair(p, "comp.mixer", "rocking", "rocking");
    p = pair(p, "filt.integrity", ["post_use"], ["pre_use_pre_sterilization"]);
    const a = run(p);
    const ranked = riskRanked(a.gaps);
    expect(ranked.some((g) => g.category === "equivalent")).toBe(false);
    expect(ranked.length).toBe(a.gaps.filter((g) => g.category !== "equivalent").length);
    for (let i = 1; i < ranked.length; i++) {
      expect(SEVERITY_RANK[ranked[i - 1]!.severity]).toBeGreaterThanOrEqual(SEVERITY_RANK[ranked[i]!.severity]);
    }
    expect(ranked[0]!.severity).toBe("high");
    // Among equal severity, an outside-range row ranks above a scale change (weight 6 vs 4).
    const highs = ranked.filter((g) => g.severity === "high").map((g) => g.category);
    expect(highs.indexOf("outside_validated_range")).toBeLessThan(highs.indexOf("scale_change"));
  });

  it("uses the effective (overridden) severity", () => {
    let p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    p = pair(p, "comp.vessel_type", "glass", "stainless_tank");
    p = setGapOverlay(p, PUMP, { severityOverride: { value: "low", justification: "Reviewed (fictional)" } }, ACTOR);
    const index = (key: string, gaps: Gap[]) => gaps.findIndex((g) => g.key === key);
    const before = riskRanked(run(pair(pair(base(), "fill.pump", "rotary_piston", "peristaltic"), "comp.vessel_type", "glass", "stainless_tank")).gaps);
    expect(index(PUMP, before)).toBeLessThan(index(VESSEL, before)); // high outranks medium
    const ranked = riskRanked(run(p).gaps);
    expect(ranked[index(PUMP, ranked)]!.severity).toBe("low");
    expect(index(VESSEL, ranked)).toBeLessThan(index(PUMP, ranked)); // the effective severity decides, not the rule's
  });
});

// ================================================================== overlays

describe("gap overlays", () => {
  const withPump = () => pair(base(), "fill.pump", "rotary_piston", "peristaltic");

  it("record owner, status and notes, and show them on the gap", () => {
    const p = setGapOverlay(withPump(), PUMP, { owner: "  MSAT lead (fictional) ", status: "in_progress", notes: " Waiting for vendor " }, ACTOR);
    const g = gap(run(p), PUMP);
    expect(g).toMatchObject({ owner: "MSAT lead (fictional)", status: "in_progress", notes: "Waiting for vendor" });
    expect(p.gapOverlays).toHaveLength(1);
    expect(p.gapOverlays[0]).toMatchObject({ gapKey: PUMP, status: "in_progress", updatedBy: "Alex Example (fictional)", updatedAt: T0 });
  });

  it("a severity override needs a justification; severity changes while ruleSeverity stays", () => {
    const base0 = withPump();
    expect(() => setGapOverlay(base0, PUMP, { severityOverride: { value: "low", justification: "" } }, ACTOR)).toThrow(OverlayError);
    expect(() => setGapOverlay(base0, PUMP, { severityOverride: { value: "low", justification: "   \n" } }, ACTOR)).toThrow(/requires a justification/);
    const p = setGapOverlay(base0, PUMP, { severityOverride: { value: "low", justification: "  Risk accepted (fictional) " } }, OTHER_ACTOR);
    const g = gap(run(p), PUMP);
    expect(g.severity).toBe("low");
    expect(g.ruleSeverity).toBe("high");
    expect(g.severityOverride).toEqual({ value: "low", justification: "Risk accepted (fictional)", by: "Sam Sample (fictional)", at: T1 });
    expect(g.regulatoryNote).toBe(REGULATORY_NOTE); // not affected by the override
    expect(g.category).toBe("different_principle");
  });

  it("a rejected override changes nothing", () => {
    const p = withPump();
    const snapshot = JSON.stringify(p);
    expect(() => setGapOverlay(p, PUMP, { owner: "Someone", severityOverride: { value: "none", justification: " " } }, ACTOR)).toThrow(OverlayError);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("an override can be removed with null, restoring the rule severity", () => {
    let p = setGapOverlay(withPump(), PUMP, { severityOverride: { value: "low", justification: "Because (fictional)" } }, ACTOR);
    p = setGapOverlay(p, PUMP, { severityOverride: null }, ACTOR);
    const g = gap(run(p), PUMP);
    expect(g.severity).toBe("high");
    expect(g.severityOverride).toBeUndefined();
    expect(p.gapOverlays).toHaveLength(1); // same overlay record
  });

  it("an update that omits severityOverride keeps the existing override", () => {
    let p = setGapOverlay(withPump(), PUMP, { severityOverride: { value: "medium", justification: "Because (fictional)" } }, ACTOR);
    p = setGapOverlay(p, PUMP, { status: "closed" }, OTHER_ACTOR);
    const g = gap(run(p), PUMP);
    expect(g).toMatchObject({ severity: "medium", status: "closed" });
    expect(g.severityOverride!.by).toBe("Alex Example (fictional)");
  });

  it("blank owner or notes clear the stored value", () => {
    let p = setGapOverlay(withPump(), PUMP, { owner: "Owner (fictional)", notes: "Note" }, ACTOR);
    p = setGapOverlay(p, PUMP, { owner: "  ", notes: "" }, ACTOR);
    const g = gap(run(p), PUMP);
    expect(g.owner).toBeUndefined();
    expect(g.notes).toBeUndefined();
  });

  it("logs a gap_update with the before and after state, and does not mutate the input", () => {
    const p0 = withPump();
    const snapshot = JSON.stringify(p0);
    const p1 = setGapOverlay(p0, PUMP, { status: "in_progress" }, ACTOR);
    expect(JSON.stringify(p0)).toBe(snapshot);
    const p2 = setGapOverlay(p1, PUMP, { status: "closed" }, OTHER_ACTOR);
    const ev = p2.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "gap_update", path: PUMP, by: "Sam Sample (fictional)" });
    expect(ev.before).toMatchObject({ status: "in_progress" });
    expect(ev.after).toMatchObject({ status: "closed", updatedBy: "Sam Sample (fictional)" });
  });

  it("survive a change of answers because the gap key is stable", () => {
    let p = setGapOverlay(withPump(), PUMP, { owner: "Owner (fictional)", severityOverride: { value: "low", justification: "Because (fictional)" } }, ACTOR);
    p = v(p, "fill.pump", "target", "time_pressure");
    expect(gap(run(p), PUMP)).toMatchObject({ owner: "Owner (fictional)", severity: "low", category: "different_principle" });
    p = v(p, "fill.pump", "target", "rotary_piston"); // now equivalent
    expect(gap(run(p), PUMP)).toMatchObject({ owner: "Owner (fictional)", category: "equivalent" });
  });

  it("an overlay for a gap that does not exist is kept but has no effect", () => {
    const p = setGapOverlay(withPump(), "R-NOPE:uo.nowhere", { owner: "Owner (fictional)" }, ACTOR);
    expect(p.gapOverlays).toHaveLength(1);
    expect(() => run(p)).not.toThrow();
    expect(run(p).gaps.some((g) => g.owner === "Owner (fictional)")).toBe(false);
  });

  it("can change the status of an equivalent row, which is closed by default", () => {
    let p = pair(base(), "fill.pump", "rotary_piston", "rotary_piston");
    expect(gap(run(p), PUMP).status).toBe("closed");
    p = setGapOverlay(p, PUMP, { status: "open" }, ACTOR);
    expect(gap(run(p), PUMP).status).toBe("open");
  });

  it("accepted_no_action is a valid status and overlays on set elements are keyed by element", () => {
    let p = pair(base(), "filt.integrity", ["post_use"], ["pre_use_pre_sterilization"]);
    p = setGapOverlay(p, `${INTEGRITY}#post_use`, { status: "accepted_no_action", notes: "Justified (fictional)" }, ACTOR);
    const a = run(p);
    expect(gap(a, `${INTEGRITY}#post_use`).status).toBe("accepted_no_action");
    expect(gap(a, `${INTEGRITY}#pre_use_pre_sterilization`).status).toBe("open");
  });
});
