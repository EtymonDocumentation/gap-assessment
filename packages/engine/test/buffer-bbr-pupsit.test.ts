import { describe, expect, it } from "vitest";
import { assess, buildContent, evaluate, progress, visibleInstances, type Condition } from "@gap/engine";
import type { Project } from "@gap/process-model";
import { cloneRaw, content, kit, q, rawRule, rng } from "./helpers";

const { v, pair, par, both, base, run, gap } = kit;

const idsOf = (p: Project) => new Set(visibleInstances(content, p, "paired").map((i) => i.question.id));
const keysOf = (p: Project) => new Set(visibleInstances(content, p, "paired").map((i) => i.key));
const UOS = ["buffer_prep", "compounding", "bbr_filtration", "sterile_filtration", "aseptic_filling"];

/** Dilution yes, buffer preparation present on both sides. */
const withBuffer = (dilution: "yes" | "no" = "yes") => base({ dilution, uos: UOS });

/** All question ids of the buffer preparation section and the dilution-only questions of the compounding section. */
const BUFFER_IDS = content.questions.filter((x) => x.section === "uo.buffer_prep").map((x) => x.id);
const DILUTION_ONLY = ["comp.diluent", "comp.diluent_volume", "comp.target_conc"];

// ================================================================== dilution switch

describe("the dilution switch (scope.dilution)", () => {
  it("is a shared yes/no scoping question that writes scope.dilution, with a why", () => {
    const x = content.questionById.get("scope.dilution")!;
    expect(x.section).toBe("scoping");
    expect(x.sides).toBe("shared");
    expect(x.binds).toBe("scope.dilution");
    expect(x.input.type).toBe("yes_no");
    expect(x.why.length).toBeGreaterThan(20);
  });

  it("dilution = No hides the Buffer preparation section and every buffer and dilution-only question", () => {
    const p = withBuffer("no");
    const ids = idsOf(p);
    for (const id of [...BUFFER_IDS, ...DILUTION_ONLY]) expect(ids.has(id), id).toBe(false);
    expect(visibleInstances(content, p, "paired").some((i) => i.section.id === "uo.buffer_prep")).toBe(false);
    // The rest of the compounding section is untouched.
    expect(ids.has("comp.batch_size")).toBe(true);
  });

  it("an unanswered dilution question behaves like an unanswered drug substance state: everything stays hidden", () => {
    const raw = base({ uos: UOS });
    const p = (() => {
      const next = structuredClone(raw);
      // Remove the answer that the helper gave, leaving the question unanswered.
      delete (next.scope as Record<string, unknown>)["dilution"];
      return next;
    })();
    const ids = idsOf(p);
    expect(ids.has("scope.dilution")).toBe(true); // still asked
    for (const id of [...BUFFER_IDS, ...DILUTION_ONLY]) expect(id + (ids.has(id) ? " shown" : "")).toBe(id);
  });

  it("dilution = Yes shows the buffer preparation section and the dilution-only questions", () => {
    const p = withBuffer("yes");
    const ids = idsOf(p);
    expect(ids.has("buf.presence")).toBe(true);
    expect(ids.has("buf.route")).toBe(true);
    for (const id of DILUTION_ONLY) expect(ids.has(id), id).toBe(true);
  });

  it("buffer and dilution-only questions do not count in progress when dilution = No", () => {
    const yes = progress(content, withBuffer("yes"), visibleInstances(content, withBuffer("yes"), "paired"));
    const no = progress(content, withBuffer("no"), visibleInstances(content, withBuffer("no"), "paired"));
    expect(yes.some((s) => s.section.id === "uo.buffer_prep")).toBe(true);
    expect(no.some((s) => s.section.id === "uo.buffer_prep")).toBe(false);
    const comp = (s: typeof yes) => s.find((x) => x.section.id === "uo.compounding")!.total;
    expect(comp(yes) - comp(no)).toBe(DILUTION_ONLY.length * 2); // each question is paired (two instances)
  });

  it("answers given under dilution = Yes are kept but reported inactive when it is switched to No", () => {
    let p = withBuffer("yes");
    p = both(p, "buf.presence", "yes");
    p = v(p, "scope.dilution", "shared", "no");
    const a = assess(content, p);
    expect(a.inactive.map((x) => x.path)).toContain("source.uo.buffer_prep.presence");
    expect(a.gaps.some((g) => g.key.includes("uo.buffer_prep"))).toBe(false);
  });

  it("the compounding section keeps its title", () => {
    expect(content.sectionById.get("uo.compounding")!.title).toBe("Pooling, compounding and dilution");
  });
});

// ================================================================== buffer supply routes

describe("buffer preparation: supply routes", () => {
  const route = (r: string) => both(both(withBuffer("yes"), "buf.presence", "yes"), "buf.route", r);
  const ON_SITE = ["buf.dispensing", "buf.vessel_type", "buf.vessel_capacity", "buf.batch_volume", "buf.mixer", "buf.mixing_speed", "buf.mixing_time", "buf.ipc", "buf.hold_time"];
  const FROZEN = ["buf.storage_temp", "buf.thaw_principle", "buf.thaw_temp", "buf.thaw_duration", "buf.mixing"];
  const RTU = ["buf.supplier", "buf.storage", "buf.shelf_life"];

  it("until the route is answered only the presence, route and buffer BBR questions are shown", () => {
    const ids = idsOf(both(withBuffer("yes"), "buf.presence", "yes"));
    for (const id of [...ON_SITE, ...FROZEN, ...RTU]) expect(ids.has(id), id).toBe(false);
    expect(ids.has("buf.route")).toBe(true);
    expect(ids.has("buf.bbr_filtered")).toBe(true);
  });

  it("prepared on site shows the preparation questions and none of the thaw or ready-to-use ones", () => {
    const ids = idsOf(route("prepared_on_site"));
    for (const id of ON_SITE) expect(ids.has(id), id).toBe(true);
    for (const id of [...FROZEN, ...RTU, "buf.supplier_qual"]) expect(ids.has(id), id).toBe(false);
  });

  it("received frozen and thawed on site shows the storage and thaw questions only", () => {
    const ids = idsOf(route("received_frozen"));
    for (const id of FROZEN) expect(ids.has(id), id).toBe(true);
    for (const id of [...ON_SITE, ...RTU, "buf.supplier_qual"]) expect(ids.has(id), id).toBe(false);
  });

  it("received ready to use shows the supplier, storage and shelf life questions and the RU supplier qualification", () => {
    const ids = idsOf(route("received_rtu"));
    for (const id of [...RTU, "buf.supplier_qual"]) expect(ids.has(id), id).toBe(true);
    for (const id of [...ON_SITE, ...FROZEN]) expect(ids.has(id), id).toBe(false);
  });

  it("each side follows its own route: SU on site and RU ready to use", () => {
    let p = both(withBuffer("yes"), "buf.presence", "yes");
    p = pair(p, "buf.route", "prepared_on_site", "received_rtu");
    const keys = keysOf(p);
    expect(keys.has("buf.dispensing@source")).toBe(true);
    expect(keys.has("buf.dispensing@target")).toBe(false);
    expect(keys.has("buf.supplier@target")).toBe(true);
    expect(keys.has("buf.supplier@source")).toBe(false);
  });

  it("a different supply route is a high gap that needs regulatory affairs assessment, with a route-specific activity", () => {
    let p = both(withBuffer("yes"), "buf.presence", "yes");
    p = pair(p, "buf.route", "prepared_on_site", "received_rtu");
    const g = gap(run(p), "R-BUFFER-ROUTE:uo.buffer_prep.mat.buffer.supplyRoute");
    expect(g).toMatchObject({ category: "different_principle", severity: "high", regulatoryNote: "Requires regulatory affairs assessment." });
    expect(g.activities).toContain("buffer_supply_assessment");
    expect(g.activities).toContain("supplier_qualification");
  });

  it("route-specific questions that exist on one side only make no gap of their own", () => {
    let p = both(withBuffer("yes"), "buf.presence", "yes");
    p = pair(p, "buf.route", "prepared_on_site", "received_rtu");
    p = v(p, "buf.dispensing", "source", "automated_dispensing");
    p = v(p, "buf.supplier", "target", "Buffer Supplier C (fictional)");
    const a = run(p);
    expect(a.gaps.some((g) => g.questionId === "buf.dispensing")).toBe(false);
    expect(a.gaps.some((g) => g.questionId === "buf.supplier")).toBe(false);
  });

  it("the same route at both sites compares the route-specific answers", () => {
    let p = route("prepared_on_site");
    p = pair(p, "buf.dispensing", "manual_weighing", "automated_dispensing");
    expect(gap(run(p), "R-BUFFER-DISPENSING:uo.buffer_prep.equip.dispensing.operatingPrinciple")).toMatchObject({ category: "different_principle", severity: "medium" });
  });

  it("an RU buffer received ready to use asks for supplier qualification, and an unqualified supplier is a gap", () => {
    let p = route("received_rtu");
    p = v(p, "buf.supplier_qual", "target", "in_progress");
    const g = gap(run(p), "R-EV-BUFFER-SUPPLIER:uo.buffer_prep.mat.buffer.supplierQualification");
    expect(g.category).toBe("outside_validated_range");
    expect(g.activities).toContain("supplier_qualification");
  });

  it("a longer RU shelf life than the SU is a gap, a shorter one is within the SU limit", () => {
    let p = route("received_rtu");
    p = pair(p, "buf.shelf_life", q(30, "d"), q(60, "d"));
    expect(gap(run(p), "R-BUFFER-SHELF-LIFE:uo.buffer_prep.mat.buffer.shelfLife").category).toBe("outside_validated_range");
    p = pair(p, "buf.shelf_life", q(30, "d"), q(14, "d"));
    expect(gap(run(p), "R-BUFFER-SHELF-LIFE:uo.buffer_prep.mat.buffer.shelfLife").category).toBe("within_validated_range");
  });
});

// ================================================================== buffer BBR filtration

describe("buffer bioburden-reduction filtration (all routes, including on-site preparation)", () => {
  const onSite = () => both(both(both(withBuffer("yes"), "buf.presence", "yes"), "buf.route", "prepared_on_site"), "buf.bbr_filtered", "no");
  const DETAIL = ["buf.bbr_membrane", "buf.bbr_pore", "buf.bbr_bioburden", "buf.bbr_integrity"];

  it("asks whether the buffer is BBR filtered when it is prepared on site", () => {
    expect(idsOf(onSite()).has("buf.bbr_filtered")).toBe(true);
  });

  it("no BBR filtration hides the BBR detail questions", () => {
    const ids = idsOf(onSite());
    for (const id of DETAIL) expect(ids.has(id), id).toBe(false);
  });

  it("BBR filtration = yes shows the BBR detail questions on that side only", () => {
    const p = v(onSite(), "buf.bbr_filtered", "source", "yes");
    const keys = keysOf(p);
    for (const id of DETAIL) {
      expect(keys.has(`${id}@source`), id).toBe(true);
      expect(keys.has(`${id}@target`), id).toBe(false);
    }
  });

  it("the frozen and ready-to-use routes ask it too", () => {
    for (const r of ["received_frozen", "received_rtu"]) {
      const p = both(both(both(withBuffer("yes"), "buf.presence", "yes"), "buf.route", r), "buf.bbr_filtered", "yes");
      for (const id of DETAIL) expect(idsOf(p).has(id), `${r} ${id}`).toBe(true);
    }
  });

  it("BBR filtration at the SU and none at the RU is a removed element with its own activities", () => {
    const p = pair(onSite(), "buf.bbr_filtered", "yes", "no");
    const g = gap(run(p), "R-BUFFER-BBR-PRESENCE:uo.buffer_prep.mat.buffer_bbr_filter.present");
    expect(g).toMatchObject({ category: "removed_element", severity: "medium", regulatoryNote: "Requires regulatory affairs assessment." });
    expect(g.activities).toContain("buffer_supply_assessment");
  });

  it("BBR filtration new at the RU is a new requirement that needs filter validation", () => {
    const p = pair(onSite(), "buf.bbr_filtered", "no", "yes");
    const g = gap(run(p), "R-BUFFER-BBR-PRESENCE:uo.buffer_prep.mat.buffer_bbr_filter.present");
    expect(g.category).toBe("new_requirement");
    expect(g.activities).toContain("bbr_filter_validation");
  });
});

// ================================================================== BBR filtration and sterile filtration are separate

describe("BBR filtration and sterile filtration are separate sections", () => {
  it("are two sections with their own titles and order, BBR first", () => {
    const bbr = content.sectionById.get("uo.bbr_filtration")!;
    const sf = content.sectionById.get("uo.sterile_filtration")!;
    expect(bbr.title).toBe("Bioburden reduction (BBR) filtration");
    expect(sf.title).toBe("Sterile filtration");
    expect(bbr.order).toBe(25);
    expect(sf.order).toBe(30);
    const b = content.sectionById.get("uo.buffer_prep")!;
    expect(b.order).toBe(15);
  });

  it("the old BBR filter question is gone from sterile filtration and its presence question stands in the BBR section", () => {
    expect(content.questionById.has("filt.prefilter")).toBe(false);
    expect(content.questionById.get("bbr.presence")).toMatchObject({ section: "uo.bbr_filtration", binds: "uo.bbr_filtration.presence" });
    expect(content.questions.filter((x) => x.section === "uo.sterile_filtration").every((x) => !x.binds.includes("prefilter"))).toBe(true);
  });

  it("progress lists them as separate sections in process order", () => {
    const p = base({ uos: UOS });
    const ids = progress(content, p, visibleInstances(content, p, "paired")).map((s) => s.section.id);
    expect(ids.indexOf("uo.compounding")).toBeLessThan(ids.indexOf("uo.bbr_filtration"));
    expect(ids.indexOf("uo.bbr_filtration")).toBeLessThan(ids.indexOf("uo.sterile_filtration"));
  });

  it("the BBR detail questions appear only where a BBR step is present, and the sterile filtration questions do not depend on it", () => {
    let p = base({ uos: ["compounding", "bbr_filtration", "sterile_filtration"] });
    p = pair(p, "bbr.presence", "yes", "no");
    const keys = keysOf(p);
    expect(keys.has("bbr.membrane@source")).toBe(true);
    expect(keys.has("bbr.membrane@target")).toBe(false);
    expect(keys.has("filt.membrane@target")).toBe(true);
  });

  it("a BBR step at only one site is a gap of the BBR rule", () => {
    const base2 = () => base({ uos: ["compounding", "sterile_filtration"] });
    const removed = gap(run(pair(base2(), "bbr.presence", "yes", "no")), "R-BBR-PRESENCE:uo.bbr_filtration.presence");
    expect(removed).toMatchObject({ category: "removed_element", severity: "high" });
    const added = gap(run(pair(base2(), "bbr.presence", "no", "yes")), "R-BBR-PRESENCE:uo.bbr_filtration.presence");
    expect(added).toMatchObject({ category: "new_requirement" });
    expect(added.activities).toContain("bbr_filter_validation");
  });

  it("a different RU BBR filter asks for validation coverage, and a different pore rating is a gap", () => {
    let p = base({ uos: UOS.filter((x) => x !== "buffer_prep") });
    p = both(p, "bbr.presence", "yes");
    p = pair(p, "bbr.pore", "0.45", "0.2");
    expect(keysOf(p).has("bbr.validation@target")).toBe(true);
    const g = gap(run(p), "R-BBR-FILTER-DESIGN:uo.bbr_filtration.mat.bbr_filter.poreRating");
    expect(g.category).toBe("different_principle");
  });

  it("the BBR gap rules still carry the moved BBR rules over (area scale and integrity approach)", () => {
    let p = base({ uos: ["compounding", "bbr_filtration", "sterile_filtration"] });
    p = both(p, "bbr.presence", "yes");
    p = pair(p, "bbr.area", q(0.2, "m²"), q(0.4, "m²"));
    p = pair(p, "bbr.integrity", "pre_and_post_use", "post_use_only");
    const a = run(p);
    expect(gap(a, "R-BBR-AREA:uo.bbr_filtration.mat.bbr_filter.area").category).toBe("scale_change");
    expect(gap(a, "R-BBR-INTEGRITY:uo.bbr_filtration.ipc.integrity.approach").category).toBe("different_principle");
  });
});

// ================================================================== own-side references

describe("own-side condition references (uo.* and site.* without a side)", () => {
  const p = pair(both(withBuffer("yes"), "buf.presence", "yes"), "buf.route", "prepared_on_site", "received_rtu");
  const onSite: Condition = { eq: ["uo.buffer_prep.mat.buffer.supplyRoute", "prepared_on_site"] };

  it("resolve to the side of the question being evaluated", () => {
    expect(evaluate(onSite, { project: p, side: "source" })).toBe(true);
    expect(evaluate(onSite, { project: p, side: "target" })).toBe(false);
  });

  it("cannot be determined on a shared instance, so they are false", () => {
    expect(evaluate(onSite, { project: p, side: "shared" })).toBe(false);
    expect(evaluate(onSite, { project: p })).toBe(false);
  });

  it("work for in, answered, isTrue and isUnknown", () => {
    expect(evaluate({ in: ["uo.buffer_prep.mat.buffer.supplyRoute", ["received_rtu", "received_frozen"]] }, { project: p, side: "target" })).toBe(true);
    expect(evaluate({ in: ["uo.buffer_prep.mat.buffer.supplyRoute", ["received_rtu", "received_frozen"]] }, { project: p, side: "source" })).toBe(false);
    expect(evaluate({ answered: "uo.buffer_prep.mat.buffer.supplyRoute" }, { project: p, side: "source" })).toBe(true);
    expect(evaluate({ answered: "uo.buffer_prep.mat.buffer_bbr_filter.present" }, { project: p, side: "source" })).toBe(false);
    const q2 = v(p, "buf.bbr_filtered", "source", "yes");
    expect(evaluate({ isTrue: "uo.buffer_prep.mat.buffer_bbr_filter.present" }, { project: q2, side: "source" })).toBe(true);
    expect(evaluate({ isTrue: "uo.buffer_prep.mat.buffer_bbr_filter.present" }, { project: q2, side: "target" })).toBe(false);
  });
});

// ================================================================== PUPSIT

describe("PUPSIT block in sterile filtration", () => {
  const KEY = "R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status";
  const FOLLOW = ["filt.pupsit_method", "filt.pupsit_fluid", "filt.pupsit_downstream", "filt.pupsit_assembly", "filt.pupsit_flush", "filt.pupsit_basis", "filt.pupsit_ra"];
  const pupsit = (s?: string, t?: string) => {
    let p = base({ uos: ["sterile_filtration"] });
    if (s) p = v(p, "filt.pupsit", "source", s);
    if (t) p = v(p, "filt.pupsit", "target", t);
    return p;
  };
  const shown = (p: Project) => FOLLOW.filter((id) => keysOf(p).has(`${id}@source`) || keysOf(p).has(`${id}@target`));

  it("is a paired choice with the three options, citing Annex 1 in its why", () => {
    const x = content.questionById.get("filt.pupsit")!;
    expect(x.sides).toBe("paired");
    expect(x.input.type).toBe("choice");
    expect((content.catalog.optionSets[x.input.optionsFrom!] ?? []).map((o) => o.value)).toEqual(["performed", "not_performed_justified", "not_performed_unjustified"]);
    expect(x.why).toContain("Annex 1");
    expect(x.why).toContain("8.87");
  });

  it("the integrity tests no longer offer PUPSIT as an option", () => {
    const values = (content.catalog.optionSets["integrityTests"] ?? []).map((o) => o.value);
    expect(values).not.toContain("pupsit");
    expect(values).toEqual(["pre_use_pre_sterilization", "post_use"]);
  });

  it("shows no follow-up until PUPSIT is answered", () => {
    expect(shown(pupsit())).toEqual([]);
  });

  it("performed at both sites: method, wetting fluid and downstream protection on both sides, assembly and flush at the RU", () => {
    const p = pupsit("performed", "performed");
    const keys = keysOf(p);
    for (const id of ["filt.pupsit_method", "filt.pupsit_fluid", "filt.pupsit_downstream"]) {
      expect(keys.has(`${id}@source`), id).toBe(true);
      expect(keys.has(`${id}@target`), id).toBe(true);
    }
    expect(keys.has("filt.pupsit_assembly@target")).toBe(true);
    expect(keys.has("filt.pupsit_flush@target")).toBe(true);
    expect(keys.has("filt.pupsit_basis@target")).toBe(false);
    expect(keys.has("filt.pupsit_ra@target")).toBe(false);
  });

  it("performed at the SU and not performed at the RU: the performed follow-ups show for the SU only", () => {
    const keys = keysOf(pupsit("performed", "not_performed_unjustified"));
    expect(keys.has("filt.pupsit_method@source")).toBe(true);
    expect(keys.has("filt.pupsit_method@target")).toBe(false);
    expect(keys.has("filt.pupsit_assembly@target")).toBe(false);
    expect(keys.has("filt.pupsit_basis@target")).toBe(false);
    expect(keys.has("filt.pupsit_ra@target")).toBe(false);
  });

  it("not performed with a justification: the basis and the risk assessment status show at that site", () => {
    const keys = keysOf(pupsit("performed", "not_performed_justified"));
    expect(keys.has("filt.pupsit_basis@target")).toBe(true);
    expect(keys.has("filt.pupsit_basis@source")).toBe(false);
    expect(keys.has("filt.pupsit_ra@target")).toBe(true);
    expect(keys.has("filt.pupsit_method@target")).toBe(false);
    const both2 = keysOf(pupsit("not_performed_justified", "not_performed_justified"));
    expect(both2.has("filt.pupsit_basis@source")).toBe(true);
    expect(both2.has("filt.pupsit_basis@target")).toBe(true);
  });

  it("not performed without a justification asks for no follow-up", () => {
    expect(shown(pupsit("not_performed_unjustified", "not_performed_unjustified"))).toEqual([]);
  });

  it("the basis question is a multi-choice with the four bases", () => {
    const x = content.questionById.get("filt.pupsit_basis")!;
    expect(x.input.type).toBe("multi_choice");
    expect((content.catalog.optionSets[x.input.optionsFrom!] ?? []).map((o) => o.value)).toEqual(["masking_study", "supplier_data", "process_history", "other"]);
  });

  it("SU performs and RU does not, with a justification: removed control, high", () => {
    expect(gap(run(pupsit("performed", "not_performed_justified")), KEY)).toMatchObject({
      category: "removed_element",
      severity: "high",
      regulatoryNote: "Requires regulatory affairs assessment.",
    });
  });

  it("SU performs and RU does not, with no documented justification: removed control, high", () => {
    const g = gap(run(pupsit("performed", "not_performed_unjustified")), KEY);
    expect(g).toMatchObject({ category: "removed_element", severity: "high", regulatoryNote: "Requires regulatory affairs assessment." });
    expect(g.activities).toContain("pupsit_assembly_qualification");
  });

  it("RU not performed with no documented justification is a high gap even when the SU did not perform it either", () => {
    expect(gap(run(pupsit("not_performed_justified", "not_performed_unjustified")), KEY)).toMatchObject({ category: "new_requirement", severity: "high" });
    expect(gap(run(pupsit("not_performed_unjustified", "not_performed_unjustified")), KEY)).toMatchObject({ category: "new_requirement", severity: "high" });
  });

  it("RU performs and SU does not: an added control with procedures, training and assembly qualification", () => {
    const g = gap(run(pupsit("not_performed_justified", "performed")), KEY);
    expect(g).toMatchObject({ category: "new_requirement", severity: "medium" });
    expect(g.regulatoryNote).toBeUndefined();
    expect(g.activities).toEqual(expect.arrayContaining(["pupsit_assembly_qualification", "procedure_update", "training"]));
  });

  it("same answer at both sites is equivalent, and an RU justification where the SU has none is a low note", () => {
    expect(gap(run(pupsit("performed", "performed")), KEY).category).toBe("equivalent");
    expect(gap(run(pupsit("not_performed_justified", "not_performed_justified")), KEY).category).toBe("equivalent");
    expect(gap(run(pupsit("not_performed_unjustified", "not_performed_justified")), KEY)).toMatchObject({ category: "equivalent", severity: "none" });
  });

  it("an unknown answer is an information-required gap", () => {
    const p = kit.unk(pupsit("performed"), "filt.pupsit", "target");
    expect(gap(run(p), KEY).category).toBe("information_required");
  });

  it("a changed PUPSIT method or wetting fluid is a gap that asks for the integrity test validation activity", () => {
    let p = pupsit("performed", "performed");
    p = pair(p, "filt.pupsit_method", "bubble_point", "pressure_hold");
    p = pair(p, "filt.pupsit_fluid", "wfi", "product");
    const a = run(p);
    const m = gap(a, "R-PUPSIT-METHOD:uo.sterile_filtration.ipc.pupsit.method");
    const f = gap(a, "R-PUPSIT-METHOD:uo.sterile_filtration.ipc.pupsit.wettingFluid");
    for (const g of [m, f]) {
      expect(g.category).toBe("different_principle");
      expect(g.activities).toContain("filter_integrity_validation");
    }
  });

  it("a manual sterile-side connection at the RU against a closed assembly at the SU is a high gap", () => {
    const p = pair(pupsit("performed", "performed"), "filt.pupsit_downstream", "closed_assembly", "manual_connections");
    expect(gap(run(p), "R-PUPSIT-DOWNSTREAM:uo.sterile_filtration.ipc.pupsit.downstreamProtection")).toMatchObject({ category: "different_principle", severity: "high" });
  });

  it("an unqualified or undefined RU assembly, flush volume or risk assessment is a gap", () => {
    let p = pupsit("performed", "performed");
    p = v(p, "filt.pupsit_assembly", "target", "planned");
    p = v(p, "filt.pupsit_flush", "target", "not_defined");
    const a = run(p);
    expect(gap(a, "R-EV-PUPSIT-ASSEMBLY:uo.sterile_filtration.study.pupsit_assembly.status").activities).toContain("pupsit_assembly_qualification");
    expect(gap(a, "R-EV-PUPSIT-FLUSH:uo.sterile_filtration.ipc.pupsit.flushVolume").category).toBe("outside_validated_range");
    const j = v(pupsit("not_performed_justified", "not_performed_justified"), "filt.pupsit_ra", "target", "draft");
    expect(gap(run(j), "R-EV-PUPSIT-RA:uo.sterile_filtration.doc.pupsit_risk_assessment.status").category).toBe("outside_validated_range");
  });

  it("a different justification basis at the RU is a gap of the set rule", () => {
    let p = pupsit("not_performed_justified", "not_performed_justified");
    p = pair(p, "filt.pupsit_basis", ["masking_study"], ["masking_study", "supplier_data"]);
    const g = gap(run(p), "R-PUPSIT-BASIS:uo.sterile_filtration.ipc.pupsit.justificationBasis#supplier_data");
    expect(g.category).toBe("new_requirement");
  });

  it("R-INTEGRITY-TESTS keeps working for the remaining integrity tests", () => {
    const p = pair(base({ uos: ["sterile_filtration"] }), "filt.integrity", ["pre_use_pre_sterilization", "post_use"], ["post_use"]);
    expect(gap(run(p), "R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests#pre_use_pre_sterilization")).toMatchObject({ category: "removed_element", severity: "high" });
  });
});

// ================================================================== the transition comparator

describe("the transition comparator is checked when the content is built", () => {
  it("a transition rule without transitions is refused", () => {
    const raw = cloneRaw();
    delete rawRule(raw, "R-PUPSIT").config.transitions;
    expect(() => buildContent(raw)).toThrow(/transition/i);
  });

  it("a transition that names an answer the question does not offer is refused", () => {
    const raw = cloneRaw();
    rawRule(raw, "R-PUPSIT").config.transitions[0].to = ["not_an_option"];
    expect(() => buildContent(raw)).toThrow(/not_an_option/);
  });
});

// ================================================================== plunger stopper position (prefilled syringes and cartridges)

describe("plunger stopper position in aseptic filling", () => {
  const PFS_IDS = ["fill.stopper_method", "fill.stopper_position", "fill.headspace", "fill.stopper_checks", "fill.stopper_criterion"];
  const forPresentation = (presentation: string) => base({ presentation, uos: ["aseptic_filling"] });

  it("is hidden for a vial", () => {
    const ids = idsOf(forPresentation("vial"));
    for (const id of [...PFS_IDS, "fill.stopper_study"]) expect(ids.has(id), id).toBe(false);
  });

  it("is hidden while the presentation is unanswered", () => {
    const p = structuredClone(forPresentation("vial"));
    delete (p.scope as Record<string, unknown>)["presentation"];
    const ids = idsOf(p);
    expect(ids.has("scope.presentation")).toBe(true);
    for (const id of PFS_IDS) expect(ids.has(id), id).toBe(false);
  });

  it("is shown in the Aseptic filling section for a prefilled syringe and for a cartridge, on both sides", () => {
    for (const presentation of ["prefilled_syringe", "cartridge"]) {
      const keys = keysOf(forPresentation(presentation));
      for (const id of PFS_IDS) {
        expect(keys.has(`${id}@source`), `${presentation} ${id}`).toBe(true);
        expect(keys.has(`${id}@target`), `${presentation} ${id}`).toBe(true);
      }
      for (const id of PFS_IDS) expect(content.questionById.get(id)!.section).toBe("uo.aseptic_filling");
    }
  });

  it("the questions have the right shapes: paired choice, parameter in mm, upper limit in mm, multi-choice, text", () => {
    const g = (id: string) => content.questionById.get(id)!;
    expect(g("fill.stopper_method")).toMatchObject({ sides: "paired", binds: "uo.aseptic_filling.equip.stopper_placement_unit.operatingPrinciple" });
    expect(g("fill.stopper_method").input.type).toBe("choice");
    expect((content.catalog.optionSets["plungerPlacement"] ?? []).map((o) => o.value)).toEqual(["vacuum_placement", "vent_tube", "mechanical_insertion", "other"]);
    expect(g("fill.stopper_position")).toMatchObject({ sides: "paired", binds: "uo.aseptic_filling.param.stopper_position" });
    expect(g("fill.stopper_position").input).toMatchObject({ type: "parameter", units: ["mm"] });
    expect(g("fill.stopper_position").sideLabels?.source).toBe("{{Validated|Demonstrated}} stopper position range");
    expect(g("fill.headspace").input).toMatchObject({ type: "quantity", units: ["mm"] });
    expect(g("fill.stopper_checks").input.type).toBe("multi_choice");
    expect(g("fill.stopper_criterion").input.type).toBe("text");
    expect(g("fill.stopper_study")).toMatchObject({ sides: "target", parent: "fill.stopper_position", binds: "uo.aseptic_filling.study.stopper_position_study.status" });
  });

  it("the capability follow-up appears only when the placement method or the position range differs", () => {
    let p = forPresentation("prefilled_syringe");
    p = pair(p, "fill.stopper_method", "vacuum_placement", "vacuum_placement");
    p = par(p, "fill.stopper_position", "source", { classification: "CPP", setPoint: q(1.5, "mm"), nor: rng(1.3, 1.7, "mm"), par: rng(1.0, 2.0, "mm"), rangeBasis: "PPQ" });
    p = par(p, "fill.stopper_position", "target", { setPoint: q(1.5, "mm"), nor: rng(1.3, 1.7, "mm") });
    expect(keysOf(p).has("fill.stopper_study@target")).toBe(false);
    const method = pair(p, "fill.stopper_method", "vacuum_placement", "vent_tube");
    expect(keysOf(method).has("fill.stopper_study@target")).toBe(true);
    const range = par(p, "fill.stopper_position", "target", { setPoint: q(1.4, "mm"), nor: rng(1.2, 1.6, "mm") });
    expect(keysOf(range).has("fill.stopper_study@target")).toBe(true);
  });

  it("a different placement method is a high design-change gap that needs regulatory affairs assessment", () => {
    const p = pair(forPresentation("cartridge"), "fill.stopper_method", "vacuum_placement", "mechanical_insertion");
    const g = gap(run(p), "R-PFS-STOPPER-METHOD:uo.aseptic_filling.equip.stopper_placement_unit.operatingPrinciple");
    expect(g).toMatchObject({ category: "different_principle", severity: "high", regulatoryNote: "Requires regulatory affairs assessment." });
    expect(g.activities).toContain("stopper_position_study");
  });

  const position = (target: { setPoint: ReturnType<typeof q>; nor: ReturnType<typeof rng> }) => {
    let p = forPresentation("prefilled_syringe");
    p = par(p, "fill.stopper_position", "source", { classification: "CPP", setPoint: q(1.5, "mm"), nor: rng(1.3, 1.7, "mm"), par: rng(1.0, 2.0, "mm"), rangeBasis: "PPQ" });
    return par(p, "fill.stopper_position", "target", target);
  };
  const POS_KEY = "R-PFS-STOPPER-POSITION:uo.aseptic_filling.param.stopper_position";

  it("a position range within the SU range is low, with no extra study", () => {
    const g = gap(run(position({ setPoint: q(1.4, "mm"), nor: rng(1.2, 1.6, "mm") })), POS_KEY);
    expect(g).toMatchObject({ category: "within_validated_range", severity: "low" });
    expect(g.activities).toEqual(["procedure_update"]);
  });

  it("a position range outside the SU range is high and asks for the capability study", () => {
    const g = gap(run(position({ setPoint: q(2.4, "mm"), nor: rng(2.2, 2.6, "mm") })), POS_KEY);
    expect(g).toMatchObject({ category: "outside_validated_range", severity: "high", regulatoryNote: "Requires regulatory affairs assessment." });
    expect(g.activities).toContain("stopper_position_study");
  });

  it("the same position range is equivalent", () => {
    expect(gap(run(position({ setPoint: q(1.5, "mm"), nor: rng(1.3, 1.7, "mm") })), POS_KEY).category).toBe("equivalent");
  });

  it("a relaxed headspace limit is high, a tighter one is low", () => {
    const key = "R-PFS-HEADSPACE:uo.aseptic_filling.param.max_headspace.max";
    const at = (s: number, t: number) => gap(run(pair(forPresentation("prefilled_syringe"), "fill.headspace", q(s, "mm"), q(t, "mm"))), key);
    expect(at(3, 5)).toMatchObject({ category: "outside_validated_range", severity: "high" });
    expect(at(3, 2)).toMatchObject({ category: "within_validated_range", severity: "low" });
    expect(at(3, 3).category).toBe("equivalent");
  });

  it("a removed position check is a medium gap, an added one is low", () => {
    const key = "R-PFS-STOPPER-CHECK:uo.aseptic_filling.ipc.stopper_position_check.tests";
    const a = run(pair(forPresentation("prefilled_syringe"), "fill.stopper_checks", ["camera_inline_100", "height_measurement"], ["height_measurement", "camera_sampling"]));
    expect(gap(a, `${key}#camera_inline_100`)).toMatchObject({ category: "removed_element", severity: "medium" });
    expect(gap(a, `${key}#camera_sampling`)).toMatchObject({ category: "new_requirement", severity: "low" });
  });

  it("the capability study not yet done at the RU is a high gap with its own activity", () => {
    let p = pair(forPresentation("prefilled_syringe"), "fill.stopper_method", "vacuum_placement", "vent_tube");
    p = v(p, "fill.stopper_study", "target", "planned");
    const g = gap(run(p), "R-EV-PFS-STOPPER-POSITION:uo.aseptic_filling.study.stopper_position_study.status");
    expect(g).toMatchObject({ category: "outside_validated_range", severity: "high" });
    expect(g.activities).toContain("stopper_position_study");
  });

  it("changing the presentation to a vial leaves the answers in place but inactive", () => {
    let p = pair(forPresentation("prefilled_syringe"), "fill.stopper_method", "vacuum_placement", "vent_tube");
    p = v(p, "scope.presentation", "shared", "vial");
    const a = assess(content, p);
    expect(a.inactive.map((x) => x.path)).toContain("source.uo.aseptic_filling.equip.stopper_placement_unit.operatingPrinciple");
    expect(a.gaps.some((x) => x.questionId === "fill.stopper_method")).toBe(false);
  });
});
