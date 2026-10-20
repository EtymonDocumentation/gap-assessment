import { describe, expect, it } from "vitest";
import {
  activeRefs,
  assess,
  confirmSection,
  inactiveEntries,
  instanceRefs,
  isAnswered,
  isPresenceQuestion,
  nextInstance,
  progress,
  sidesOf,
  staticQuestionProvider,
  treeOrder,
  uoApplicable,
  visibleInstances,
} from "@gap/engine";
import { getEntry, type Project } from "@gap/process-model";
import { ACTOR, content, kit, q, rng } from "./helpers";

const { v, par, unk, same, na, base, newProject, inst } = kit;

const keys = (p: Project, mode: "paired" | "sequential" = "paired") => visibleInstances(content, p, mode).map((i) => i.key);
const idsOf = (p: Project) => new Set(visibleInstances(content, p, "paired").map((i) => i.question.id));

const SCOPING_IDS = [
  "scope.program",
  "scope.modality",
  "scope.dosage_form",
  "scope.presentation",
  "scope.ds_state",
  "scope.containment",
  "scope.markets",
  "scope.transfer_type",
];

describe("empty project", () => {
  const p = newProject();

  it("shows the scoping questions, the site questions and the unit-operation presence questions (paired order)", () => {
    expect(keys(p)).toEqual([
      ...SCOPING_IDS.map((id) => `${id}@shared`),
      "site.name@source",
      "site.name@target",
      "site.line@source",
      "site.line@target",
      "site.barrier@source",
      "site.barrier@target",
      "site.background_grade@source",
      "site.background_grade@target",
      "site.batch_record@source",
      "site.batch_record@target",
      "rt.presence@source",
      "rt.presence@target",
      "comp.presence@source",
      "comp.presence@target",
      "filt.presence@source",
      "filt.presence@target",
      "fill.presence@source",
      "fill.presence@target",
      "vi.presence@source",
      "vi.presence@target",
      "lp.presence@source",
      "lp.presence@target",
      "ss.presence@source",
      "ss.presence@target",
    ]);
  });

  it("hides capping until the presentation is a vial, and hides every non-presence unit-operation question", () => {
    const ids = idsOf(p);
    expect(ids.has("cap.presence")).toBe(false);
    for (const id of ["comp.batch_size", "comp.mixer", "filt.membrane", "fill.pump", "fill.volume"]) expect(ids.has(id), id).toBe(false);
  });

  it("shows the 'not scale change' site questions because an unanswered transfer type cannot rule them out", () => {
    const ids = idsOf(p);
    expect(ids.has("site.barrier")).toBe(true);
    expect(ids.has("site.containment")).toBe(false);
  });

  it("assigns depth 0 and the right section to every instance", () => {
    for (const i of visibleInstances(content, p, "paired")) {
      expect(i.depth).toBe(0);
      expect(i.section.id).toBe(i.question.section);
      expect(i.key).toBe(`${i.question.id}@${i.side}`);
    }
  });
});

describe("entry sequence modes", () => {
  const rich = (() => {
    let p = base({ uos: ["compounding", "sterile_filtration", "aseptic_filling", "capping"] });
    p = v(p, "fill.pump", "source", "rotary_piston");
    p = v(p, "fill.pump", "target", "peristaltic");
    p = par(p, "comp.batch_size", "source", { setPoint: q(60, "L"), par: rng(40, 60, "L"), rangeBasis: "PPQ" });
    p = par(p, "comp.batch_size", "target", { setPoint: q(150, "L"), nor: rng(120, 150, "L") });
    return p;
  })();

  it("paired mode emits the source instance immediately followed by the target instance of the same question", () => {
    const list = visibleInstances(content, rich, "paired");
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]!;
      if (cur.question.sides === "paired" && cur.side === "source") {
        const nxt = list[i + 1]!;
        expect(nxt.key, cur.key).toBe(`${cur.question.id}@target`);
      }
    }
    // spot check
    const k = keys(rich);
    expect(k.indexOf("fill.pump@target")).toBe(k.indexOf("fill.pump@source") + 1);
  });

  it("sequential mode emits all shared, then all source, then all target instances", () => {
    const list = visibleInstances(content, rich, "sequential");
    const sides = list.map((i) => i.side);
    const firstSource = sides.indexOf("source");
    const firstTarget = sides.indexOf("target");
    expect(sides.slice(0, firstSource).every((s) => s === "shared")).toBe(true);
    expect(sides.slice(firstSource, firstTarget).every((s) => s === "source")).toBe(true);
    expect(sides.slice(firstTarget).every((s) => s === "target")).toBe(true);
    expect(sides.filter((s) => s === "shared")).toHaveLength(8);
  });

  it("sequential mode is the paired list regrouped by side, with the same instances", () => {
    const paired = visibleInstances(content, rich, "paired");
    const regrouped = [
      ...paired.filter((i) => i.side === "shared"),
      ...paired.filter((i) => i.side === "source"),
      ...paired.filter((i) => i.side === "target"),
    ].map((i) => i.key);
    expect(keys(rich, "sequential")).toEqual(regrouped);
    expect(new Set(keys(rich, "sequential"))).toEqual(new Set(keys(rich, "paired")));
  });

  it("the question provider follows the project's entry sequence", () => {
    const provider = staticQuestionProvider(content);
    const seq = base({ entrySequence: "sequential" });
    expect(provider.next(newProject())?.key).toBe("scope.program@shared");
    // Sequential: after scoping is answered, the first unanswered instance is the first source question.
    expect(provider.next(seq)?.key).toBe("site.name@source");
    expect(provider.next(base())?.key).toBe("site.name@source");
    expect(provider.rationale(content.questionById.get("fill.pump")!)).toBe(content.questionById.get("fill.pump")!.why);
  });
});

describe("applicability by scoping answers", () => {
  it("capping appears for vials and disappears for prefilled syringes", () => {
    const vial = base({ uos: ["compounding", "sterile_filtration", "aseptic_filling", "capping"] });
    const syringe = base({ presentation: "prefilled_syringe", uos: ["compounding", "sterile_filtration", "aseptic_filling"] });
    expect(keys(vial)).toContain("cap.presence@source");
    expect(keys(vial)).toContain("cap.presence@target");
    const capKeys = (p: Project) => visibleInstances(content, p, "paired").filter((i) => i.section.id === "uo.capping");
    expect(capKeys(vial).length).toBeGreaterThan(0);
    expect(capKeys(syringe)).toEqual([]);
    expect(progress(content, vial, visibleInstances(content, vial, "paired")).some((s) => s.section.id === "uo.capping")).toBe(true);
    expect(progress(content, syringe, visibleInstances(content, syringe, "paired")).some((s) => s.section.id === "uo.capping")).toBe(false);
  });

  it("answers given for capping are retained but reported inactive when the presentation changes", () => {
    let p = base({ uos: ["compounding", "sterile_filtration", "aseptic_filling", "capping"] });
    p = v(p, "cap.principle", "source", "single_head_roller");
    p = v(p, "cap.principle", "target", "multi_head_roller");
    expect(inactiveEntries(p, visibleInstances(content, p, "paired"))).toEqual([]);
    const switched = v(p, "scope.presentation", "shared", "prefilled_syringe");
    const inactive = inactiveEntries(switched, visibleInstances(content, switched, "paired")).map((e) => e.path);
    expect(inactive.sort()).toEqual(
      [
        "source.uo.capping.presence",
        "target.uo.capping.presence",
        "source.uo.capping.equip.capper.operatingPrinciple",
        "target.uo.capping.equip.capper.operatingPrinciple",
      ].sort(),
    );
    expect(getEntry(switched, "source.uo.capping.equip.capper.operatingPrinciple")?.value).toBe("single_head_roller");
  });

  it("lyophilization applies only to a lyophilized dosage form", () => {
    expect(uoApplicable(content, v(newProject(), "scope.dosage_form", "shared", "lyophilized"), "lyophilization")).toBe(true);
    expect(uoApplicable(content, v(newProject(), "scope.dosage_form", "shared", "liquid"), "lyophilization")).toBe(false);
    expect(uoApplicable(content, newProject(), "lyophilization")).toBe(false);
    expect(uoApplicable(content, newProject(), "compounding")).toBe(true);
    expect(uoApplicable(content, newProject(), "not_a_unit_operation")).toBe(false);
  });

  it("site.containment appears only when the product requires containment", () => {
    expect(idsOf(base({ containment: "standard" })).has("site.containment")).toBe(false);
    const hp = base({ containment: "high_potency" });
    expect(keys(hp)).toContain("site.containment@source");
    expect(keys(hp)).toContain("site.containment@target");
    // Unanswered containment: not shown.
    expect(idsOf(newProject()).has("site.containment")).toBe(false);
    // Changing the answer back removes it again.
    expect(idsOf(v(hp, "scope.containment", "shared", "standard")).has("site.containment")).toBe(false);
  });

  it("a scale-change transfer skips the facility questions", () => {
    const ids = idsOf(base({ transfer: "scale_change" }));
    for (const id of ["site.barrier", "site.background_grade", "site.batch_record"]) expect(ids.has(id), id).toBe(false);
    for (const id of ["site.name", "site.line"]) expect(ids.has(id), id).toBe(true);
  });
});

describe("follow-up questions", () => {
  it("fill.accuracy, fill.shear and fill.ppq appear only when the pump principle differs", () => {
    const followUps = ["fill.accuracy", "fill.shear", "fill.ppq"];
    const start = v(base(), "fill.pump", "source", "rotary_piston");
    // Target not yet answered: no trigger yet.
    for (const id of followUps) expect(idsOf(start).has(id), id).toBe(false);
    // Target different: all three on the target side only.
    const diff = v(start, "fill.pump", "target", "peristaltic");
    for (const id of followUps) expect(keys(diff), id).toContain(`${id}@target`);
    for (const id of followUps) expect(keys(diff), id).not.toContain(`${id}@source`);
    // Target equal (explicitly or via same-as-source): none.
    for (const eq of [v(start, "fill.pump", "target", "rotary_piston"), same(start, "fill.pump")]) {
      for (const id of followUps) expect(idsOf(eq).has(id), id).toBe(false);
    }
    // Target unknown: not determinable, so no follow-ups.
    for (const id of followUps) expect(idsOf(unk(start, "fill.pump", "target")).has(id), id).toBe(false);
  });

  it("follow-ups sit directly after their parent at depth 1", () => {
    const p = v(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", "peristaltic");
    const list = visibleInstances(content, p, "paired");
    const at = list.findIndex((i) => i.key === "fill.pump@target");
    expect(list.slice(at, at + 4).map((i) => i.key)).toEqual(["fill.pump@target", "fill.accuracy@target", "fill.shear@target", "fill.ppq@target"]);
    expect(list.filter((i) => i.question.parent === "fill.pump").every((i) => i.depth === 1)).toBe(true);
  });

  it("comp.mixing_coverage and comp.hold_time appear only when the target batch size is larger", () => {
    const withBatch = (target: number) => {
      let p = par(base(), "comp.batch_size", "source", { setPoint: q(60, "L"), par: rng(40, 60, "L"), rangeBasis: "PPQ" });
      p = par(p, "comp.batch_size", "target", { setPoint: q(target, "L"), nor: rng(target, target, "L") });
      return p;
    };
    const larger = keys(withBatch(150));
    expect(larger).toContain("comp.mixing_coverage@source");
    expect(larger).toContain("comp.hold_time@source");
    expect(larger).toContain("comp.hold_time@target");
    expect(larger).not.toContain("comp.mixing_coverage@target"); // source-only question
    for (const target of [60, 30]) {
      const ids = idsOf(withBatch(target));
      expect(ids.has("comp.mixing_coverage"), `target ${target}`).toBe(false);
      expect(ids.has("comp.hold_time"), `target ${target}`).toBe(false);
    }
  });

  it("a larger batch also triggers filter sizing and the APS coverage follow-up", () => {
    let p = par(base(), "comp.batch_size", "source", { setPoint: q(60, "L"), par: rng(40, 60, "L"), rangeBasis: "PPQ" });
    p = par(p, "comp.batch_size", "target", { setPoint: q(120, "L"), nor: rng(100, 120, "L") });
    expect(keys(p)).toContain("filt.sizing@target");
    expect(keys(p)).toContain("fill.aps@target");
  });

  it("comp.mixing_demonstrated appears when either the mixer or the vessel type differs", () => {
    let p = base();
    p = v(v(p, "comp.mixer", "source", "top_entry_impeller"), "comp.mixer", "target", "top_entry_impeller");
    p = v(v(p, "comp.vessel_type", "source", "stainless_tank"), "comp.vessel_type", "target", "stainless_tank");
    expect(idsOf(p).has("comp.mixing_demonstrated")).toBe(false);
    expect(keys(v(p, "comp.mixer", "target", "rocking"))).toContain("comp.mixing_demonstrated@target");
    expect(keys(v(p, "comp.vessel_type", "target", "single_use_bag"))).toContain("comp.mixing_demonstrated@target");
  });

  it("filt.sua_el needs a new single-use assembly at the target, with the source answered", () => {
    const sua = (src: string | undefined, tgt: string) => {
      let p = base();
      if (src) p = v(p, "filt.sua", "source", src);
      return v(p, "filt.sua", "target", tgt);
    };
    expect(idsOf(sua("no", "yes")).has("filt.sua_el")).toBe(true);
    expect(idsOf(sua("yes", "yes")).has("filt.sua_el")).toBe(false);
    expect(idsOf(sua("no", "no")).has("filt.sua_el")).toBe(false);
    expect(idsOf(sua(undefined, "yes")).has("filt.sua_el")).toBe(false);
    // The supplier follow-up needs only a target assembly.
    expect(idsOf(sua(undefined, "yes")).has("filt.sua_supplier")).toBe(true);
    expect(idsOf(sua("no", "no")).has("filt.sua_supplier")).toBe(false);
  });

  it("hides target-only follow-ups when the unit operation is not performed at the target, even if they were answered", () => {
    let p = base();
    p = v(p, "filt.presence", "target", "no");
    p = v(p, "filt.sua", "source", "no");
    p = v(p, "filt.sua", "target", "yes"); // answered while the step is absent
    const k = keys(p);
    expect(k).toContain("filt.sua@source");
    expect(k).not.toContain("filt.sua@target");
    expect(idsOf(p).has("filt.sua_el")).toBe(false);
    expect(idsOf(p).has("filt.sua_supplier")).toBe(false);
  });

  it("a target that does not perform the step hides that unit operation's questions on the target side only", () => {
    const p = v(base(), "comp.presence", "target", "no");
    const k = keys(p);
    expect(k).toContain("comp.batch_size@source");
    expect(k).not.toContain("comp.batch_size@target");
    expect(k).toContain("comp.presence@target");
  });
});

describe("closing a branch keeps the answer but marks it inactive", () => {
  const open = (() => {
    let p = base();
    p = v(p, "fill.pump", "source", "rotary_piston");
    p = v(p, "fill.pump", "target", "peristaltic");
    p = v(p, "fill.accuracy", "target", "planned");
    return p;
  })();
  const ACC = "target.uo.aseptic_filling.study.fill_accuracy.status";
  const KEY = "R-EV-FILL-ACCURACY:uo.aseptic_filling.study.fill_accuracy.status";

  it("while the branch is open the answer is active and compared", () => {
    const a = assess(content, open);
    expect(a.inactive).toEqual([]);
    expect(a.gaps.find((g) => g.key === KEY)).toMatchObject({ category: "outside_validated_range", severity: "high" });
  });

  it("changing the target pump back to 'same as source' hides the follow-up and reports its answer as inactive", () => {
    const closed = same(open, "fill.pump");
    const list = visibleInstances(content, closed, "paired");
    expect(list.some((i) => i.question.id === "fill.accuracy")).toBe(false);

    // Answer retained in the model...
    const e = getEntry(closed, ACC);
    expect(e?.status).toBe("established");
    expect(e?.value).toBe("planned");
    // ...reported as inactive...
    const a = assess(content, closed);
    expect(a.inactive.map((x) => x.path)).toEqual([ACC]);
    // ...and excluded from the comparison and open items.
    expect(a.gaps.some((g) => g.key === KEY)).toBe(false);
    expect(a.gaps.some((g) => g.questionId === "fill.accuracy")).toBe(false);
    expect(a.openItems.some((o) => o.questionId === "fill.accuracy")).toBe(false);
    // The pump gap itself is now equivalent.
    expect(a.gaps.find((g) => g.key === "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple")?.category).toBe("equivalent");
  });

  it("reopening the branch restores the earlier answer without asking again", () => {
    const reopened = v(same(open, "fill.pump"), "fill.pump", "target", "time_pressure");
    const list = visibleInstances(content, reopened, "paired");
    const acc = list.find((i) => i.key === "fill.accuracy@target");
    expect(acc).toBeDefined();
    expect(isAnswered(reopened, acc!)).toBe(true);
    expect(assess(content, reopened).inactive).toEqual([]);
  });

  it("inactiveEntries ignores entries that were never established", () => {
    expect(inactiveEntries(newProject(), visibleInstances(content, newProject(), "paired"))).toEqual([]);
  });
});

describe("nextInstance", () => {
  it("returns the first unanswered instance and advances as questions are answered", () => {
    let p = newProject();
    const list = () => visibleInstances(content, p, "paired");
    expect(nextInstance(list(), p)?.key).toBe("scope.program@shared");
    p = v(p, "scope.program", "shared", "TST-001");
    expect(nextInstance(list(), p)?.key).toBe("scope.modality@shared");
  });

  it("treats Unknown, Not applicable and Same as source as answered", () => {
    let p = newProject();
    p = unk(p, "scope.program", "shared");
    expect(nextInstance(visibleInstances(content, p, "paired"), p)?.key).toBe("scope.modality@shared");
    let t = v(newProject(), "fill.pump", "source", "rotary_piston");
    t = same(t, "fill.pump");
    expect(isAnswered(t, inst("fill.pump", "target"))).toBe(true);
    t = na(t, "comp.vessel_type", "source", "Not used (fictional)");
    expect(isAnswered(t, inst("comp.vessel_type", "source"))).toBe(true);
    expect(isAnswered(t, inst("comp.vessel_type", "target"))).toBe(false);
  });

  it("starts at the given key and wraps around to earlier unanswered questions", () => {
    let p = newProject();
    const list = visibleInstances(content, p, "paired");
    p = v(p, "scope.program", "shared", "TST-001");
    p = v(p, "scope.modality", "shared", "mab");
    // From an unanswered later key: that key itself.
    expect(nextInstance(list, p, "site.line@source")?.key).toBe("site.line@source");
    // From an answered key: the next unanswered one after it.
    expect(nextInstance(list, p, "scope.program@shared")?.key).toBe("scope.dosage_form@shared");
    // From the last key (unanswered) it is returned; once answered, the search wraps to the earliest unanswered.
    const last = list[list.length - 1]!;
    expect(nextInstance(list, p, last.key)?.key).toBe(last.key);
    p = v(p, "ss.presence", "target", "yes");
    expect(nextInstance(list, p, last.key)?.key).toBe("scope.dosage_form@shared");
    // Unknown key falls back to the start.
    expect(nextInstance(list, p, "no.such@key")?.key).toBe("scope.dosage_form@shared");
  });

  it("returns undefined when everything in the list is answered", () => {
    const p = v(newProject(), "scope.program", "shared", "TST-001");
    const one = visibleInstances(content, newProject(), "paired").slice(0, 1);
    expect(nextInstance(one, p)).toBeUndefined();
    expect(nextInstance([], p)).toBeUndefined();
  });

  it("a parameter question is answered only when every bound field is recorded", () => {
    const i = inst("comp.batch_size", "source");
    expect(instanceRefs(i)).toEqual([
      "source.uo.compounding.param.batch_size.setPoint",
      "source.uo.compounding.param.batch_size.par",
      "source.uo.compounding.param.batch_size.rangeBasis",
    ]);
    expect(isAnswered(base(), i)).toBe(false);
    expect(isAnswered(par(base(), "comp.batch_size", "source", { setPoint: q(60, "L"), par: rng(40, 60, "L"), rangeBasis: "PPQ" }), i)).toBe(true);
    expect(isAnswered(unk(base(), "comp.batch_size", "source"), i)).toBe(true);
  });
});

describe("progress", () => {
  it("counts total and answered instances per section and side", () => {
    let p = newProject();
    p = v(p, "scope.program", "shared", "TST-001");
    p = v(p, "scope.modality", "shared", "mab");
    p = v(p, "site.name", "source", "Site North (fictional)");
    const list = visibleInstances(content, p, "paired");
    const prog = progress(content, p, list);
    const scoping = prog.find((s) => s.section.id === "scoping")!;
    expect(scoping.total).toBe(8);
    expect(scoping.answered).toBe(2);
    expect(scoping.bySide.shared).toEqual({ total: 8, answered: 2 });
    expect(scoping.bySide.source).toEqual({ total: 0, answered: 0 });
    const site = prog.find((s) => s.section.id === "site")!;
    expect(site.total).toBe(10);
    expect(site.bySide.source).toEqual({ total: 5, answered: 1 });
    expect(site.bySide.target).toEqual({ total: 5, answered: 0 });
    // Capping, stoppering and lyophilization are not applicable on an empty project (vial presentation and lyophilized product are not yet known).
    expect(prog.map((s) => s.section.id)).toEqual([
      "scoping",
      "site",
      "uo.ds_receipt_thaw",
      "uo.compounding",
      "uo.sterile_filtration",
      "uo.aseptic_filling",
      "uo.visual_inspection",
      "uo.labeling_packaging",
      "uo.storage_shipping",
    ]);
  });

  it("reports section confirmation", () => {
    const p = newProject();
    const list = visibleInstances(content, p, "paired");
    expect(progress(content, p, list).every((s) => !s.confirmed)).toBe(true);
    const confirmed = confirmSection(p, "scoping", "shared", ACTOR);
    const prog = progress(content, confirmed, visibleInstances(content, confirmed, "paired"));
    expect(prog.find((s) => s.section.id === "scoping")?.confirmed).toBe(true);
    expect(prog.find((s) => s.section.id === "site")?.confirmed).toBe(false);
  });
});

describe("small helpers", () => {
  it("sidesOf maps the question's sides to instance sides", () => {
    expect(sidesOf(content.questionById.get("scope.program")!)).toEqual(["shared"]);
    expect(sidesOf(content.questionById.get("fill.pump")!)).toEqual(["source", "target"]);
    expect(sidesOf(content.questionById.get("comp.mixing_coverage")!)).toEqual(["source"]);
    expect(sidesOf(content.questionById.get("fill.accuracy")!)).toEqual(["target"]);
  });

  it("isPresenceQuestion recognises only a unit operation's own presence question", () => {
    const sec = (id: string) => content.sectionById.get(id)!;
    expect(isPresenceQuestion(content.questionById.get("comp.presence")!, sec("uo.compounding"))).toBe(true);
    expect(isPresenceQuestion(content.questionById.get("comp.batch_size")!, sec("uo.compounding"))).toBe(false);
    expect(isPresenceQuestion(content.questionById.get("scope.program")!, sec("scoping"))).toBe(false);
  });

  it("treeOrder places each follow-up after its parent with increasing depth", () => {
    const order = treeOrder(content, "uo.compounding");
    const ids = order.map((o) => o.q.id);
    expect(ids.indexOf("comp.mixing_coverage")).toBe(ids.indexOf("comp.batch_size") + 1);
    expect(ids.indexOf("comp.hold_time")).toBe(ids.indexOf("comp.batch_size") + 2);
    expect(ids.indexOf("comp.mixing_demonstrated")).toBe(ids.indexOf("comp.mixer") + 1);
    expect(order.find((o) => o.q.id === "comp.batch_size")!.depth).toBe(0);
    expect(order.find((o) => o.q.id === "comp.hold_time")!.depth).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("activeRefs lists exactly the entries written by visible instances", () => {
    const list = visibleInstances(content, newProject(), "paired");
    const refs = activeRefs(list);
    expect(refs.has("scope.program")).toBe(true);
    expect(refs.has("source.uo.compounding.presence")).toBe(true);
    expect(refs.has("source.uo.compounding.param.batch_size.setPoint")).toBe(false);
  });
});
