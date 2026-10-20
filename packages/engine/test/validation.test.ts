import { describe, expect, it } from "vitest";
import type { Project } from "@gap/process-model";
import {
  addCustomItem,
  buildContent,
  buildDocument,
  buildEquipmentQualification,
  buildValidationPlan,
  ContentError,
  assess,
  effectiveContent,
  equipmentQualificationToCsv,
  readinessOf,
  setGapOverlay,
  STUDY_STATUS_READINESS,
  validationPlanToCsv,
  type ContentBundle,
  type RawContent,
} from "@gap/engine";
import { ACTOR, makeKit, q, rng, withEntry, rawContent } from "./helpers";

/*
 * Fixture content: two small unit operations built only for these tests, so the tests do not depend on the
 * shipped question bank, rules or demo (which change from milestone to milestone).
 */

const act = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, description: `${label} description (fictional).`, ...extra });

function fixtureRaw(mutate?: (r: Record<string, any>) => void): RawContent { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    catalog: {
      catalog: { id: "fixture", version: "1.0.0" },
      unitOperations: [
        {
          key: "fill_x",
          label: "Filling X",
          sequence: 20,
          description: "Fixture filling step.",
          milestone: 1,
          items: [
            { coll: "param", key: "fill_volume", label: "Fill volume" },
            { coll: "equip", key: "filler", label: "Filler" },
            { coll: "equip", key: "capper_unit", label: "Plain unit" },
            { coll: "study", key: "ppq", label: "PPQ" },
            { coll: "study", key: "aps", label: "APS" },
            { coll: "study", key: "imp", label: "Impact assessment" },
          ],
        },
        {
          key: "cap_x",
          label: "Capping X",
          sequence: 30,
          description: "Fixture capping step.",
          milestone: 1,
          items: [
            { coll: "equip", key: "crimper", label: "Crimper" },
            { coll: "study", key: "cci", label: "CCI" },
          ],
        },
      ],
      fieldLabels: { coverage: "Covered range", qualificationStatus: "Qualification status" },
      optionSets: {
        classification: [
          { value: "CPP", label: "CPP" },
          { value: "GPP", label: "GPP" },
        ],
        rangeBasis: [{ value: "characterization", label: "Characterization study" }],
        evidenceAvailability: [
          { value: "available", label: "Available and applicable" },
          { value: "planned", label: "Planned, not yet available" },
          { value: "not_planned", label: "Not available and not planned" },
        ],
        validationCoverage: [
          { value: "covered", label: "Covered by existing validation" },
          { value: "bridging_required", label: "Partially covered; bridging study required" },
          { value: "not_covered", label: "Not covered" },
        ],
        impactAssessment: [
          { value: "no_impact", label: "Assessed; no impact" },
          { value: "impact", label: "Assessed; impact identified" },
          { value: "not_assessed", label: "Not assessed" },
        ],
        qualStatus: [
          { value: "not_qualified", label: "Not qualified" },
          { value: "iq_complete", label: "IQ complete" },
          { value: "pq_complete", label: "PQ complete" },
          { value: "planned", label: "Qualification planned" },
        ],
        principle: [
          { value: "a", label: "Principle A" },
          { value: "b", label: "Principle B" },
        ],
      },
      activities: [
        act("information_gathering", "Information gathering"),
        act("act_ppq", "PPQ activity", { studies: ["ppq"] }),
        act("act_other", "Other activity"),
        act("act_cci", "CCI activity", { studies: ["cci", "aps"] }),
        act("act_hold", "Impact activity", { studies: ["imp"] }),
        act("act_eq", "Equipment qualification"),
        act("act_inj", "=HYPERLINK(\"x\")", { description: 'He said "hi", then left' }),
      ],
      categories: [
        "equivalent",
        "within_validated_range",
        "outside_validated_range",
        "different_principle",
        "scale_change",
        "new_requirement",
        "removed_element",
        "information_required",
      ].map((key) => ({ key, label: key, description: key })),
    },
    questionFiles: {
      "q.yaml": {
        bank: { id: "fixture", version: "1.0.0" },
        sections: [
          { id: "uo.fill_x", title: "Filling X", kind: "uo", uo: "fill_x", order: 20 },
          { id: "uo.cap_x", title: "Capping X", kind: "uo", uo: "cap_x", order: 30 },
        ],
        questions: [
          { id: "f.presence", section: "uo.fill_x", prompt: "Is filling performed?", why: "w", sides: "paired", binds: "uo.fill_x.presence", input: { type: "yes_no" } },
          {
            id: "f.principle",
            section: "uo.fill_x",
            prompt: "Filler principle",
            why: "w",
            sides: "paired",
            binds: "uo.fill_x.equip.filler.operatingPrinciple",
            input: { type: "choice", optionsFrom: "principle" },
          },
          { id: "f.volume", section: "uo.fill_x", prompt: "Fill volume", why: "w", sides: "paired", binds: "uo.fill_x.param.fill_volume", input: { type: "parameter", units: ["mL"] } },
          {
            id: "f.qual",
            section: "uo.fill_x",
            prompt: "Qualification status of the filler",
            label: "Filler qualification",
            why: "w",
            sides: "paired",
            binds: "uo.fill_x.equip.filler.qualificationStatus",
            input: { type: "choice", optionsFrom: "qualStatus" },
          },
          {
            id: "f.qrange",
            section: "uo.fill_x",
            prompt: "Qualified fill volume range of the filler",
            label: "Fill volume",
            why: "w",
            sides: "target",
            binds: "uo.fill_x.equip.filler.qualifiedRange_fill_volume",
            input: { type: "range", units: ["mL"] },
          },
          { id: "f.ppq", section: "uo.fill_x", prompt: "PPQ coverage", why: "w", sides: "target", binds: "uo.fill_x.study.ppq.status", input: { type: "choice", optionsFrom: "validationCoverage" } },
          { id: "f.aps_cov", section: "uo.fill_x", prompt: "APS covered duration", why: "w", sides: "target", binds: "uo.fill_x.study.aps.coverage", input: { type: "quantity", units: ["h"] } },
          { id: "f.imp", section: "uo.fill_x", prompt: "Impact assessment", why: "w", sides: "target", binds: "uo.fill_x.study.imp.status", input: { type: "choice", optionsFrom: "impactAssessment" } },
          { id: "c.presence", section: "uo.cap_x", prompt: "Is capping performed?", why: "w", sides: "paired", binds: "uo.cap_x.presence", input: { type: "yes_no" } },
          { id: "c.cci", section: "uo.cap_x", prompt: "CCI evidence", why: "w", sides: "target", binds: "uo.cap_x.study.cci.status", input: { type: "choice", optionsFrom: "evidenceAvailability" } },
          {
            id: "c.qual",
            section: "uo.cap_x",
            prompt: "Qualification status of the crimper",
            label: "Crimper qualification",
            why: "w",
            sides: "paired",
            binds: "uo.cap_x.equip.crimper.qualificationStatus",
            input: { type: "choice", optionsFrom: "qualStatus" },
          },
        ],
      },
    },
    ruleFiles: {
      "r.yaml": {
        ruleset: { id: "fixture", version: "1.0.0" },
        rules: [
          { id: "R-FX-PRESENCE", version: "1.0.0", title: "Presence", match: ["uo.*.presence"], comparator: "presence", severity: "high", why: "Presence differs.", activities: ["act_other"] },
          { id: "R-FX-PRINCIPLE", version: "1.0.0", title: "Principle", match: ["uo.*.equip.*.operatingPrinciple"], comparator: "enum", severity: "medium", regulatory: true, why: "Principle differs.", activities: ["act_other", "act_ppq", "act_inj", "act_eq"] },
          { id: "R-FX-QUAL", version: "1.0.0", title: "Qualification", match: ["uo.*.equip.*.qualificationStatus"], comparator: "enum", severity: "low", why: "Qualification differs.", activities: ["act_eq"] },
          {
            id: "R-FX-QRANGE",
            version: "1.0.0",
            title: "Qualified range covers target",
            match: ["uo.fill_x.equip.filler.qualifiedRange_fill_volume"],
            comparator: "coverage",
            config: { coverageSide: "target", against: { side: "target", path: "uo.fill_x.param.fill_volume" } },
            severity: "high",
            why: "Range must cover the process.",
            activities: ["act_eq"],
          },
          { id: "R-FX-PARAM", version: "1.0.0", title: "Parameter", match: ["uo.*.param.*"], comparator: "range", severity: "medium", why: "Range differs.", activities: ["act_other"] },
          { id: "R-FX-PPQ", version: "1.0.0", title: "PPQ evidence", match: ["uo.fill_x.study.ppq.status"], comparator: "evidence", config: { map: { covered: "within_validated_range", bridging_required: "outside_validated_range", not_covered: "outside_validated_range" } }, severity: "high", why: "PPQ missing.", activities: ["act_ppq"] },
          { id: "R-FX-IMP", version: "1.0.0", title: "Impact evidence", match: ["uo.fill_x.study.imp.status"], comparator: "evidence", config: { map: { no_impact: "within_validated_range", impact: "outside_validated_range", not_assessed: "outside_validated_range" } }, severity: "low", why: "Impact.", activities: ["act_hold"] },
          { id: "R-FX-CCI", version: "1.0.0", title: "CCI evidence", match: ["uo.cap_x.study.cci.status"], comparator: "evidence", config: { map: { available: "within_validated_range", planned: "outside_validated_range", not_planned: "outside_validated_range" } }, severity: "medium", why: "CCI.", activities: ["act_cci"] },
          { id: "R-FX-INFO", version: "1.0.0", title: "Informational", match: ["uo.*.study.*.coverage"], comparator: "informational", severity: "none", why: "Info." },
        ],
      },
    },
    templates: rawContent.templates,
  };
  mutate?.(raw);
  return raw as RawContent;
}

const content: ContentBundle = buildContent(fixtureRaw());
const kit = makeKit(content);
const { v, pair, unk } = kit;

/** Both unit operations present at both sites, no other answers. */
function present(): Project {
  return kit.both(kit.both(kit.newProject(), "f.presence", "yes"), "c.presence", "yes");
}

/** Scenario: principle differs, PPQ not covered, CCI planned, impact identified. */
function scenario(): Project {
  let p = present();
  p = pair(p, "f.principle", "a", "b");
  p = v(p, "f.ppq", "target", "not_covered");
  p = v(p, "c.cci", "target", "planned");
  p = v(p, "f.imp", "target", "impact");
  return p;
}

const planOf = (p: Project) => buildValidationPlan(content, p);
const row = (p: Project, key: string) => {
  const r = planOf(p).find((x) => x.activityKey === key);
  if (!r) throw new Error(`No plan row ${key}. Present: ${planOf(p).map((x) => x.activityKey).join(", ")}`);
  return r;
};

describe("validation plan: rows and gap mapping", () => {
  it("has only information gathering for a project with no answers", () => {
    // The presence questions are unanswered, so the comparison is "information required".
    expect(planOf(kit.newProject()).map((r) => r.activityKey)).toEqual(["information_gathering"]);
  });

  it("has one row per implied activity, listing the gaps that imply it", () => {
    const p = scenario();
    const a = assess(content, p);
    const keys = planOf(p).map((r) => r.activityKey);
    expect(new Set(keys).size).toBe(keys.length);
    const principle = a.gaps.find((g) => g.key === "R-FX-PRINCIPLE:uo.fill_x.equip.filler.operatingPrinciple")!;
    const ppq = a.gaps.find((g) => g.key === "R-FX-PPQ:uo.fill_x.study.ppq.status")!;
    expect(row(p, "act_ppq").gaps.map((g) => g.displayId)).toEqual([principle.displayId, ppq.displayId]);
    expect(row(p, "act_other").gaps.map((g) => g.displayId)).toContain(principle.displayId);
    expect(row(p, "act_cci").gaps).toHaveLength(1);
    // Equivalent pairs imply nothing; an activity nobody implies has no row.
    expect(keys).not.toContain("never_implied");
    for (const r of planOf(p)) for (const g of r.gaps) expect(g.category).not.toBe("equivalent");
  });

  it("sorts highest severity first, then catalog order", () => {
    const p = scenario();
    const plan = planOf(p);
    const rank = { high: 3, medium: 2, low: 1, none: 0 } as const;
    for (let i = 1; i < plan.length; i++) expect(rank[plan[i - 1]!.severity]).toBeGreaterThanOrEqual(rank[plan[i]!.severity]);
    const order = content.catalog.activities.map((a) => a.key);
    for (let i = 1; i < plan.length; i++) {
      if (plan[i - 1]!.severity === plan[i]!.severity) expect(order.indexOf(plan[i - 1]!.activityKey)).toBeLessThan(order.indexOf(plan[i]!.activityKey));
    }
    const at = (k: string) => plan.findIndex((r) => r.activityKey === k);
    expect(at("act_ppq")).toBeLessThan(at("act_other")); // high (PPQ evidence) ahead of medium
    expect(at("act_other")).toBeLessThan(at("act_hold")); // medium ahead of low
    expect(row(p, "act_ppq").severity).toBe("high");
    expect(row(p, "act_hold").severity).toBe("low");
  });

  it("carries the regulatory note of an implying gap", () => {
    expect(row(scenario(), "act_ppq").regulatoryNote).toBe("Requires regulatory affairs assessment.");
    expect(row(scenario(), "act_hold").regulatoryNote).toBeUndefined();
  });

  it("an unanswered comparison implies information gathering, never a validation activity", () => {
    const p = present();
    const keys = planOf(p).map((r) => r.activityKey);
    expect(keys).toContain("information_gathering");
    expect(keys).not.toContain("act_ppq");
    expect(row(p, "information_gathering").readiness).toBe("no_study");
  });
});

describe("validation plan: study status and readiness", () => {
  it("links the studies named by the activity with source and target status", () => {
    const r = row(scenario(), "act_ppq");
    expect(r.studies).toHaveLength(1);
    expect(r.studies[0]).toMatchObject({ key: "ppq", uoKey: "fill_x", uoLabel: "Filling X" });
    // The PPQ question is asked on the target only; the source is not asked and is not invented.
    expect(r.studies[0]!.source).toEqual({ display: "—", entry: "not_asked" });
    expect(r.studies[0]!.target).toEqual({ display: "Not covered", entry: "established" });
  });

  it("derives readiness from the target status of the linked studies", () => {
    const p = scenario();
    expect(row(p, "act_ppq")).toMatchObject({ readiness: "not_planned", readinessLabel: "Not planned" });
    expect(row(p, "act_cci")).toMatchObject({ readiness: "planned" });
    expect(row(p, "act_hold")).toMatchObject({ readiness: "bridging_required" });
    const available = v(scenario(), "c.cci", "target", "available");
    // "Available" lies within the validated range: no gap, so the CCI activity drops out of the plan.
    expect(planOf(available).map((r) => r.activityKey)).not.toContain("act_cci");
    expect(row(v(scenario(), "f.ppq", "target", "covered"), "act_ppq").readiness).toBe("evidence_available");
  });

  it("an unknown or unanswered study status reads as information required, with an open item", () => {
    const unknown = unk(scenario(), "f.ppq", "target");
    const r = row(unknown, "act_ppq");
    expect(r.readiness).toBe("information_required");
    expect(r.studies[0]!.target).toEqual({ display: "Unknown (to be confirmed)", entry: "unknown" });
    expect(r.openItems).toBe(1);

    let blank = present();
    blank = pair(blank, "f.principle", "a", "b");
    const b = row(blank, "act_ppq");
    expect(b.readiness).toBe("information_required");
    expect(b.studies[0]!.target).toEqual({ display: "Not established", entry: "not_established" });
    expect(b.openItems).toBe(1);
  });

  it("takes the worst readiness when several studies are linked", () => {
    const wide = buildContent(
      fixtureRaw((r) => {
        r.catalog.activities.find((a: { key: string }) => a.key === "act_ppq").studies = ["ppq", "imp"];
      }),
    );
    const k = makeKit(wide);
    let p = k.both(k.both(k.newProject(), "f.presence", "yes"), "c.presence", "yes");
    p = k.pair(p, "f.principle", "a", "b");
    p = k.v(p, "f.ppq", "target", "covered");
    p = k.v(p, "f.imp", "target", "impact");
    expect(buildValidationPlan(wide, p).find((r) => r.activityKey === "act_ppq")!.readiness).toBe("bridging_required");
    p = k.v(p, "f.imp", "target", "no_impact");
    expect(buildValidationPlan(wide, p).find((r) => r.activityKey === "act_ppq")!.readiness).toBe("evidence_available");
  });

  it("shows the other recorded fields of a study as details", () => {
    const wide = buildContent(
      fixtureRaw((r) => {
        r.catalog.activities.find((a: { key: string }) => a.key === "act_ppq").studies = ["ppq", "aps"];
      }),
    );
    const k = makeKit(wide);
    let p = k.both(k.both(k.newProject(), "f.presence", "yes"), "c.presence", "yes");
    p = k.pair(p, "f.principle", "a", "b");
    p = k.v(p, "f.ppq", "target", "covered");
    p = k.v(p, "f.aps_cov", "target", q(36, "h"));
    const aps = buildValidationPlan(wide, p).find((r) => r.activityKey === "act_ppq")!.studies.find((s) => s.key === "aps")!;
    // The APS study has no status question: it is not asked, so it does not affect readiness.
    expect(aps.readiness).toBe("not_asked");
    expect(aps.details).toEqual([{ label: "APS covered duration", source: { display: "—", entry: "not_asked" }, target: { display: "36 h", entry: "established" } }]);
  });

  it("a linked study that is not asked anywhere reads as information required", () => {
    const p = scenario();
    // act_cci links cci (answered) and aps (no status question); readiness comes from cci alone.
    expect(row(p, "act_cci").studies.map((s) => s.key)).toEqual(["cci", "aps"]);
    expect(row(p, "act_cci").readiness).toBe("planned");
    const none = present();
    const q2 = pair(none, "f.principle", "a", "b");
    // Hide the PPQ question by removing the unit operation at the target: its study is no longer asked.
    const hidden = v(q2, "f.presence", "target", "no");
    expect(planOf(hidden).find((r) => r.activityKey === "act_ppq")).toBeUndefined();
  });

  it("the readiness table covers every study-status option set in the catalog, once, and falls back for the rest", () => {
    const sets = ["evidenceAvailability", "validationCoverage", "impactAssessment"] as const;
    for (const s of sets) {
      for (const o of content.catalog.optionSets[s]!) {
        expect(STUDY_STATUS_READINESS[o.value], `${s}.${o.value}`).toBeDefined();
        expect(readinessOf({ status: "established", value: o.value })).toBe(STUDY_STATUS_READINESS[o.value]);
      }
    }
    expect(readinessOf({ status: "established", value: "not_a_known_option" })).toBe("information_required");
    expect(readinessOf({ status: "unknown" })).toBe("information_required");
    expect(readinessOf({ status: "not_established" })).toBe("information_required");
    expect(readinessOf({ status: "not_applicable" })).toBe("information_required");
    expect(readinessOf({ status: "established", value: "available" })).toBe("evidence_available");
    expect(readinessOf({ status: "established", value: "bridging_required" })).toBe("bridging_required");
  });
});

describe("validation plan: overlays, inactive answers and custom items", () => {
  it("a closed or accepted gap still implies its activity, listed with its status", () => {
    const p = scenario();
    const before = row(p, "act_ppq");
    expect(before.openGaps).toBe(2);
    const closed = setGapOverlay(p, "R-FX-PPQ:uo.fill_x.study.ppq.status", { status: "accepted_no_action" }, ACTOR);
    const after = row(closed, "act_ppq");
    expect(after.gaps).toHaveLength(2);
    expect(after.gaps.find((g) => g.key === "R-FX-PPQ:uo.fill_x.study.ppq.status")!.status).toBe("accepted_no_action");
    expect(after.openGaps).toBe(1);
    const all = setGapOverlay(closed, "R-FX-PRINCIPLE:uo.fill_x.equip.filler.operatingPrinciple", { status: "closed" }, ACTOR);
    expect(row(all, "act_ppq").openGaps).toBe(0);
    expect(planOf(all).map((r) => r.activityKey)).toContain("act_ppq");
  });

  it("uses the effective (overridden) severity", () => {
    const p = setGapOverlay(scenario(), "R-FX-PPQ:uo.fill_x.study.ppq.status", { severityOverride: { value: "low", justification: "Fictional justification." } }, ACTOR);
    expect(row(p, "act_ppq").severity).toBe("medium"); // the principle gap (medium) now dominates
  });

  it("drops activities whose gaps come from answers that are no longer active", () => {
    const p = scenario();
    expect(planOf(p).map((r) => r.activityKey)).toContain("act_cci");
    const off = v(p, "c.presence", "target", "no"); // capping no longer applies at the target: the CCI answer is kept but inactive
    expect(planOf(off).map((r) => r.activityKey)).not.toContain("act_cci");
  });

  it("includes gaps from custom items", () => {
    let p = present();
    p = addCustomItem(p, content, { uo: "fill_x", coll: "equip", label: "Extra pump" }, ACTOR);
    const eff = effectiveContent(content, p);
    const ek = makeKit(eff);
    const key = p.custom.items[0]!.key;
    const qid = `x.fill_x.equip.${key}.principle`;
    p = ek.pair(p, qid, "peristaltic", "rotary piston");
    const plan = buildValidationPlan(content, p);
    expect(plan.map((r) => r.activityKey)).toContain("act_ppq");
    const g = plan.find((r) => r.activityKey === "act_ppq")!.gaps.find((x) => x.attribute.includes("Extra pump"));
    expect(g?.category).toBe("different_principle");
  });
});

describe("validation plan: CSV", () => {
  it("has a header, one line per row, and quotes every cell", () => {
    const p = scenario();
    const csv = validationPlanToCsv(planOf(p));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(planOf(p).length + 1);
    expect(lines[0]).toBe('"Activity","Description","Implied by gaps","Gap statuses","Highest severity","Regulatory","Readiness","Linked studies","Source study status","Target study status","Open gaps","Open information items"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain('"PPQ activity"');
    expect(csv).toContain("PPQ (Filling X): Not covered");
    expect(csv).not.toMatch(/undefined|NaN|\[object/);
  });

  it("neutralises formulas and doubles quotes", () => {
    const csv = validationPlanToCsv(planOf(scenario()));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toContain(',"=HYPERLINK');
    expect(csv).toContain('"He said ""hi"", then left"');
  });
});

describe("equipment qualification", () => {
  /** Source PQ complete, target IQ complete; target qualified fill volume 5-100 mL against a 45-55 mL target NOR. */
  function equipped(range = rng(5, 100, "mL")): Project {
    let p = present();
    p = pair(p, "f.qual", "pq_complete", "iq_complete");
    p = kit.par(p, "f.volume", "source", { setPoint: q(50, "mL"), nor: rng(45, 55, "mL"), par: rng(40, 60, "mL"), classification: "CPP", rangeBasis: "characterization" });
    p = kit.par(p, "f.volume", "target", { setPoint: q(50, "mL"), nor: rng(45, 55, "mL") });
    p = v(p, "f.qrange", "target", range);
    return p;
  }
  const eq = (p: Project) => buildEquipmentQualification(content, p);

  it("lists equipment with qualification questions, in unit operation order, and skips the rest", () => {
    const rows = eq(equipped());
    expect(rows.map((r) => `${r.uoKey}.${r.equipKey}`)).toEqual(["fill_x.filler", "cap_x.crimper"]);
    expect(rows.some((r) => r.equipKey === "capper_unit")).toBe(false);
  });

  it("shows source and target status with the option labels", () => {
    const filler = eq(equipped())[0]!;
    expect(filler.source).toEqual({ display: "PQ complete", entry: "established" });
    expect(filler.target).toEqual({ display: "IQ complete", entry: "established" });
  });

  it("compares the target qualified range with the target process range found through the coverage rule", () => {
    const filler = eq(equipped())[0]!;
    expect(filler.ranges).toHaveLength(1);
    expect(filler.ranges[0]!.attribute).toBe("Fill volume");
    expect(filler.ranges[0]!.qualified).toEqual({ display: "5–100 mL", entry: "established" });
    expect(filler.ranges[0]!.required).toMatchObject({ display: "45–55 mL", entry: "established" });
    expect(filler.ranges[0]!.required!.basis).toContain("target NOR");
    // The coverage gap is linked, with its category and display id.
    const coverage = filler.gaps.find((g) => g.key.startsWith("R-FX-QRANGE"))!;
    expect(coverage).toMatchObject({ category: "within_validated_range" });
    expect(coverage.displayId).toMatch(/^G-\d{3}$/);
    const narrow = eq(equipped(rng(5, 50, "mL")))[0]!;
    expect(narrow.gaps.find((g) => g.key.startsWith("R-FX-QRANGE"))!.category).toBe("outside_validated_range");
  });

  it("links the status difference as a gap", () => {
    const filler = eq(equipped())[0]!;
    expect(filler.gaps.map((g) => g.key)).toContain("R-FX-QUAL:uo.fill_x.equip.filler.qualificationStatus");
  });

  it("shows unknown and not established values as such, never a value", () => {
    let p = present();
    p = unk(p, "f.qual", "source");
    const filler = eq(p)[0]!;
    expect(filler.source).toEqual({ display: "Unknown (to be confirmed)", entry: "unknown" });
    expect(filler.target).toEqual({ display: "Not established", entry: "not_established" });
    expect(filler.ranges[0]!.qualified).toEqual({ display: "Not established", entry: "not_established" });
    expect(filler.ranges[0]!.required).toMatchObject({ display: "Not established", entry: "not_established" });
  });

  it("has no rows when the unit operation is not in scope", () => {
    expect(eq(kit.newProject())).toEqual([]);
    const p = kit.both(kit.newProject(), "f.presence", "no");
    expect(eq(p).filter((r) => r.uoKey === "fill_x")).toEqual([]);
  });

  it("includes custom equipment that has qualification entries recorded", () => {
    let p = equipped();
    p = addCustomItem(p, content, { uo: "fill_x", coll: "equip", label: "Spare filler" }, ACTOR);
    const key = p.custom.items[0]!.key;
    expect(eq(p).some((r) => r.equipKey === key)).toBe(false); // nothing recorded yet
    p = withEntry(p, `source.uo.fill_x.equip.${key}.qualificationStatus`, "pq_complete");
    p = withEntry(p, `target.uo.fill_x.equip.${key}.qualificationStatus`, "planned");
    const spare = eq(p).find((r) => r.equipKey === key)!;
    expect(spare).toMatchObject({ equipLabel: "Spare filler", custom: true, ranges: [] });
    expect(spare.source.entry).toBe("established");
    expect(spare.target.entry).toBe("established");
  });

  it("exports a CSV with the same protections", () => {
    const csv = equipmentQualificationToCsv(eq(equipped()));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Unit operation","Equipment","Source qualification","Target qualification","Qualified range (target)","Required by target process","Gaps"');
    expect(lines[1]).toContain('"Fill volume: 5–100 mL"');
    expect(lines[1]).toContain("45–55 mL");
    expect(csv).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe("document sections", () => {
  it("adds the validation plan and the equipment qualification sections", () => {
    const p = scenario();
    const a = assess(content, p);
    const doc = buildDocument(content, p, a, "2026-10-02T00:00:00.000Z");
    const ids = doc.sections.map((s) => s.id);
    expect(ids).toContain("validation-plan");
    expect(ids).toContain("equipment-qualification");
    expect(ids.indexOf("equipment-qualification")).toBe(ids.indexOf("validation-plan") + 1);
    doc.sections.forEach((s, i) => expect(s.number).toBe(String(i + 1)));
    const plan = doc.sections.find((s) => s.id === "validation-plan")!;
    const table = plan.blocks.find((b) => b.type === "table");
    expect(table?.type === "table" && table.columns).toContain("Readiness");
    const ppq = table?.type === "table" ? table.rows.find((r) => r[0] === "PPQ activity") : undefined;
    expect(ppq?.[2]).toMatch(/G-\d{3}, G-\d{3}/);
    expect(ppq?.[5]).toBe("PPQ (Filling X): —"); // PPQ is not asked on the source
    expect(ppq?.[6]).toBe("PPQ (Filling X): Not covered");
    expect(ppq?.[7]).toBe("Not planned");
  });

  it("states plainly when no equipment qualification is recorded", () => {
    const p = kit.newProject();
    const doc = buildDocument(content, p, assess(content, p), "2026-10-02T00:00:00.000Z");
    const eqs = doc.sections.find((s) => s.id === "equipment-qualification")!;
    expect(eqs.blocks.some((b) => b.type === "paragraph" && b.text === "No equipment qualification information has been recorded.")).toBe(true);
  });
});

describe("content cross-check for activity studies", () => {
  it("accepts study keys that exist in some unit operation", () => {
    expect(() => buildContent(fixtureRaw())).not.toThrow();
  });

  it("reports an unknown study key", () => {
    const build = () =>
      buildContent(
        fixtureRaw((r) => {
          r.catalog.activities.find((a: { key: string }) => a.key === "act_ppq").studies = ["ppq", "no_such_study"];
        }),
      );
    expect(build).toThrow(ContentError);
    expect(build).toThrow(/activity act_ppq: unknown study "no_such_study"/);
  });

  it("rejects a key that is not a study item (an equipment key)", () => {
    expect(() =>
      buildContent(
        fixtureRaw((r) => {
          r.catalog.activities.find((a: { key: string }) => a.key === "act_ppq").studies = ["filler"];
        }),
      ),
    ).toThrow(/unknown study "filler"/);
  });
});
