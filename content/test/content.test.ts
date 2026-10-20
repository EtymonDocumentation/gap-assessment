import {
  boundPaths,
  buildContent,
  CATEGORIES,
  ContentError,
  findRule,
  optionsFor,
  parameterFields,
  type RawContent,
} from "@gap/engine";
import { isValidContentPath, unitDef } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, rawContent } from "../index";

type Mut = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ------------------------------------------------------------------ helpers

const clone = (): Mut => structuredClone(rawContent) as Mut;

function findQuestion(raw: Mut, id: string): Mut {
  for (const file of Object.values(raw.questionFiles) as Mut[]) {
    const hit = (file.questions as Mut[]).find((x) => x.id === id);
    if (hit) return hit;
  }
  throw new Error(`test setup: no question ${id}`);
}

function findRuleRaw(raw: Mut, id: string): Mut {
  for (const file of Object.values(raw.ruleFiles) as Mut[]) {
    const hit = (file.rules as Mut[]).find((x) => x.id === id);
    if (hit) return hit;
  }
  throw new Error(`test setup: no rule ${id}`);
}

/** Builds content from a modified clone and returns the reported problems. Fails if the content is accepted. */
function problemsOf(mutate: (raw: Mut) => void): string[] {
  const raw = clone();
  mutate(raw);
  try {
    buildContent(raw as RawContent);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return (e as ContentError).problems;
  }
  throw new Error("buildContent accepted broken content");
}

const BANK_FILE = "questions/00-scoping-and-site.yaml";
const COMPOUNDING_FILE = "questions/20-compounding.yaml";

/** Every path in a parsed YAML structure whose value is null (a mapping key with nothing after the colon). */
function nullPaths(value: unknown, path = "$", out: string[] = []): string[] {
  if (value === null) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => nullPaths(v, `${path}[${i}]`, out));
  else if (typeof value === "object" && value !== undefined) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) nullPaths(v, `${path}.${k}`, out);
  }
  return out;
}

// ================================================================== the shipped content

describe("shipped content builds", () => {
  it("builds without error and reports its versions", () => {
    expect(content.versions).toEqual({ catalog: "1.2.0", questions: "1.2.0", rules: "1.2.0", templates: "1.1.0" });
    for (const v of Object.values(content.versions)) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("builds the same bundle every time and does not modify the raw input", () => {
    const before = JSON.stringify(rawContent);
    const again = buildContent(rawContent);
    expect(JSON.stringify(rawContent)).toBe(before);
    expect(again.questions.map((q) => q.id)).toEqual(content.questions.map((q) => q.id));
    expect(again.versions).toEqual(content.versions);
  });

  it("indexes every question and section by id", () => {
    expect(content.questionById.size).toBe(content.questions.length);
    expect(content.sectionById.size).toBe(content.sections.length);
    for (const q of content.questions) expect(content.questionById.get(q.id)).toBe(q);
  });

  it("orders sections by their order number, with no duplicates", () => {
    const orders = content.sections.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    expect(new Set(content.sections.map((s) => s.id)).size).toBe(content.sections.length);
  });

  it("every question belongs to a known section, and every section has questions", () => {
    for (const q of content.questions) expect(content.sectionById.has(q.section), q.id).toBe(true);
    for (const s of content.sections) expect(content.questions.some((q) => q.section === s.id), s.id).toBe(true);
  });

  it("every unit-operation section names a catalog unit operation", () => {
    const keys = new Set(content.catalog.unitOperations.map((u) => u.key));
    for (const s of content.sections.filter((x) => x.kind === "uo")) expect(keys.has(s.uo!), s.id).toBe(true);
  });

  it("question ids are unique and each side of each bound path is bound once", () => {
    expect(new Set(content.questions.map((q) => q.id)).size).toBe(content.questions.length);
    const seen = new Map<string, string>();
    for (const q of content.questions) {
      const sides = q.sides === "shared" ? ["shared"] : q.sides === "paired" ? ["source", "target"] : [q.sides];
      for (const side of sides) {
        for (const path of boundPaths(q, side as "source" | "target" | "shared")) {
          const key = `${side}:${path}`;
          expect(seen.get(key), `${key} bound by ${q.id}`).toBeUndefined();
          seen.set(key, q.id);
        }
      }
    }
  });

  it("every bound path is a valid reference", () => {
    for (const q of content.questions) {
      if (q.input.type === "parameter") expect(q.binds, q.id).toMatch(/^uo\.[a-z0-9_]+\.param\.[a-z0-9_]+$/);
      else expect(isValidContentPath(q.binds), `${q.id}: ${q.binds}`).toBe(true);
    }
  });

  it("every question bound inside a unit operation points at an item in the catalog", () => {
    const items = new Set(content.catalog.unitOperations.flatMap((u) => u.items.map((i) => `uo.${u.key}.${i.coll}.${i.key}`)));
    for (const q of content.questions) {
      const parts = q.binds.split(".");
      if (parts[0] !== "uo" || parts.length < 5) continue;
      expect(items.has(parts.slice(0, 4).join(".")), `${q.id} binds ${q.binds}`).toBe(true);
    }
  });

  it("the catalog defines every comparison category exactly once", () => {
    const keys = content.catalog.categories.map((c) => c.key);
    expect([...keys].sort()).toEqual([...CATEGORIES].sort());
  });

  it("catalog keys are unique (unit operations, activities, option values within a set)", () => {
    const uoKeys = content.catalog.unitOperations.map((u) => u.key);
    expect(new Set(uoKeys).size).toBe(uoKeys.length);
    const acts = content.catalog.activities.map((a) => a.key);
    expect(new Set(acts).size).toBe(acts.length);
    for (const [name, options] of Object.entries(content.catalog.optionSets)) {
      const values = options.map((o) => o.value);
      expect(new Set(values).size, name).toBe(values.length);
      for (const o of options) expect(o.label.trim(), `${name}.${o.value}`).not.toBe("");
    }
  });

  it("templates are complete and use only placeholders the document builder fills", () => {
    const known = new Set(["program", "modality", "dosageForm", "presentation", "transferType", "markets", "sourceSite", "targetSite", "date"]);
    const doc = content.templates.document;
    for (const [field, text] of Object.entries(doc)) {
      if (typeof text !== "string") continue;
      expect(text.trim(), field).not.toBe("");
      for (const m of text.matchAll(/\{(\w+)\}/g)) expect(known.has(m[1]!), `${field}: {${m[1]}}`).toBe(true);
    }
    expect(doc.approvalRoles.length).toBeGreaterThan(0);
    expect(doc.regulatoryStatement).toContain("regulatory");
    expect(doc.banner).toMatch(/not (validated|for GMP)/i);
  });
});

// ================================================================== rules and questions

describe("rules cover the questions", () => {
  const compared = content.questions.filter((q) => q.sides !== "shared");

  it("every non-shared question has a matching rule", () => {
    expect(compared.length).toBeGreaterThan(40);
    for (const q of compared) expect(findRule(content.rules, q.binds), `${q.id} (${q.binds})`).toBeDefined();
  });

  it("shared (scoping) questions are not compared", () => {
    for (const q of content.questions.filter((x) => x.sides === "shared")) {
      expect(q.binds.startsWith("scope."), q.id).toBe(true);
    }
  });

  it("rule ids are unique and every rule is the first match for at least one question (no dead rules)", () => {
    const ids = content.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const used = new Set(compared.map((q) => findRule(content.rules, q.binds)!.id));
    const dead = ids.filter((id) => !used.has(id));
    expect(dead).toEqual([]);
  });

  it("the first matching rule wins: specific rules sit ahead of generic ones", () => {
    const by = (path: string) => findRule(content.rules, path)?.id;
    expect(by("uo.compounding.param.batch_size")).toBe("R-BATCH-SIZE");
    expect(by("uo.compounding.param.mixing_speed")).toBe("R-PARAM-RANGE");
    expect(by("uo.sterile_filtration.mat.sua.present")).toBe("R-SUA-PRESENCE");
    expect(by("uo.sterile_filtration.mat.prefilter.present")).toBe("R-FILTER-TRAIN");
    expect(by("uo.sterile_filtration.mat.sterilizing_filter.supplier")).toBe("R-FILTER-DESIGN");
    expect(by("uo.aseptic_filling.mat.container.supplier")).toBe("R-COMPONENT");
    expect(by("uo.sterile_filtration.ipc.integrity.tests")).toBe("R-INTEGRITY-TESTS");
    expect(by("uo.compounding.ipc.panel.tests")).toBe("R-IPC-SET");
    expect(by("uo.compounding.nothing.here")).toBeUndefined();
    // Both rules match the filter supplier; only file order decides.
    const matching = content.rules.filter((r) => findRule([r], "uo.sterile_filtration.mat.sterilizing_filter.supplier")).map((r) => r.id);
    expect(matching).toEqual(["R-FILTER-DESIGN", "R-COMPONENT"]);
  });

  it("every evidence rule maps exactly the answers its question offers", () => {
    for (const q of compared) {
      const rule = findRule(content.rules, q.binds)!;
      if (rule.comparator !== "evidence") continue;
      const offered = optionsFor(content, q).map((o) => o.value).sort();
      expect(Object.keys(rule.config.map!).sort(), `${rule.id} vs ${q.id}`).toEqual(offered);
    }
  });

  it("every coverage rule points at real question paths", () => {
    for (const rule of content.rules.filter((r) => r.comparator === "coverage")) {
      const against = rule.config.against!;
      expect(content.questions.some((q) => q.binds === against.path), `${rule.id} against ${against.path}`).toBe(true);
      expect(content.questions.some((q) => rule.match.includes(q.binds)), `${rule.id} study question`).toBe(true);
    }
  });

  it("evidence and coverage questions are target-side or source-side follow-ups, not paired", () => {
    for (const q of compared) {
      const rule = findRule(content.rules, q.binds)!;
      if (rule.comparator === "evidence") expect(q.sides, q.id).toBe("target");
      if (rule.comparator === "coverage") expect(q.sides, q.id).not.toBe("paired");
    }
  });

  it("only comparator kinds the engine implements are used", () => {
    const implemented = new Set(["range", "scale", "upper_limit", "lower_limit", "enum", "text", "presence", "set", "coverage", "evidence", "informational"]);
    for (const r of content.rules) expect(implemented.has(r.comparator), r.id).toBe(true);
  });

  it("every activity named by a rule or outcome exists in the catalog", () => {
    const keys = new Set(content.catalog.activities.map((a) => a.key));
    for (const r of content.rules) {
      const named = [...r.activities, ...Object.values(r.outcomes).flatMap((o) => o?.activities ?? [])];
      for (const a of named) expect(keys.has(a), `${r.id}: ${a}`).toBe(true);
    }
  });

  it("no rule has the regulatory wording of its own: the note text lives in code", () => {
    for (const r of content.rules) expect(r.why, r.id).not.toMatch(/Requires regulatory affairs assessment/);
  });

  it("scale rules carry ratio tiers, set/presence rules carry no unit config", () => {
    for (const r of content.rules.filter((x) => x.comparator === "scale")) expect(r.config.ratioSeverity?.length, r.id).toBeGreaterThan(0);
  });
});

describe("question definitions", () => {
  it("every option set a question names exists and is not empty", () => {
    for (const q of content.questions) {
      if (q.input.optionsFrom) {
        expect(content.catalog.optionSets[q.input.optionsFrom], `${q.id}: ${q.input.optionsFrom}`).toBeDefined();
        expect(optionsFor(content, q).length, q.id).toBeGreaterThan(0);
      }
      if (q.input.type === "choice" || q.input.type === "multi_choice") {
        expect(optionsFor(content, q).length, q.id).toBeGreaterThan(0);
      }
    }
  });

  it("every option set in the catalog is used by at least one question or parameter field", () => {
    const used = new Set(content.questions.map((q) => q.input.optionsFrom).filter(Boolean));
    used.add("classification");
    used.add("rangeBasis");
    const unused = Object.keys(content.catalog.optionSets).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });

  it("the parameter option sets exist", () => {
    expect(content.catalog.optionSets["classification"]!.map((o) => o.value)).toEqual(["CPP", "KPP", "non_critical"]);
    expect(content.catalog.optionSets["rangeBasis"]!.length).toBeGreaterThan(1);
  });

  it("numeric questions list known units of a single dimension", () => {
    for (const q of content.questions.filter((x) => ["quantity", "range", "parameter"].includes(x.input.type))) {
      expect(q.input.units?.length, q.id).toBeGreaterThan(0);
      const dims = new Set(q.input.units!.map((u) => unitDef(u)?.dimension));
      expect(dims.has(undefined), `${q.id}: unknown unit in ${q.input.units}`).toBe(false);
      expect(dims.size, q.id).toBe(1);
    }
  });

  it("parameter questions bind to a parameter root and use known fields", () => {
    for (const q of content.questions.filter((x) => x.input.type === "parameter")) {
      expect(q.sides, q.id).toBe("paired");
      expect(parameterFields(q, "source").length, q.id).toBeGreaterThan(0);
      expect(parameterFields(q, "target"), q.id).toContain("setPoint");
    }
  });

  it("parents exist, sit in the same section and are not self-referencing", () => {
    for (const q of content.questions.filter((x) => x.parent)) {
      const parent = content.questionById.get(q.parent!);
      expect(parent, `${q.id} parent ${q.parent}`).toBeDefined();
      expect(parent!.section, q.id).toBe(q.section);
      expect(q.parent).not.toBe(q.id);
    }
  });

  it("follow-up questions that are triggered by an answer explain why they were asked", () => {
    for (const q of content.questions.filter((x) => x.parent && x.showWhen && ("changed" in x.showWhen || "increased" in x.showWhen || "any" in x.showWhen))) {
      expect(q.triggerNote, q.id).toBeTruthy();
    }
  });

  it("every question carries a prompt and an explanation", () => {
    for (const q of content.questions) {
      expect(q.prompt.trim(), q.id).not.toBe("");
      expect(q.why.trim(), q.id).not.toBe("");
    }
  });
});

// ================================================================== broken clones

describe("buildContent reports specific problems", () => {
  it("a duplicate question id", () => {
    const problems = problemsOf((raw) => {
      const file = raw.questionFiles[COMPOUNDING_FILE];
      file.questions.push({ ...structuredClone(findQuestion(raw, "comp.vessel_type")), binds: "uo.compounding.equip.vessel.material" });
    });
    expect(problems).toContain("question comp.vessel_type: duplicate id");
  });

  it("an option set that does not exist", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_type").input.optionsFrom = "no_such_set";
    });
    expect(problems).toEqual(['question comp.vessel_type: unknown option set "no_such_set"']);
  });

  it("a unit that does not exist", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_capacity").input.units = ["L", "furlong"];
    });
    expect(problems).toEqual(['question comp.vessel_capacity: unknown unit "furlong"']);
  });

  it("units of different dimensions", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_capacity").input.units = ["L", "h"];
    });
    expect(problems).toEqual(["question comp.vessel_capacity: units span more than one dimension"]);
  });

  it("a numeric question with no units", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_capacity").input.units = [];
    });
    expect(problems).toEqual(["question comp.vessel_capacity: numeric input needs units"]);
  });

  it("a choice question with neither options nor an option set", () => {
    const problems = problemsOf((raw) => {
      delete findQuestion(raw, "comp.vessel_type").input.optionsFrom;
    });
    expect(problems).toEqual(["question comp.vessel_type: choice input needs options or optionsFrom"]);
  });

  it("an activity that is not in the catalog, in a rule or in one of its outcomes", () => {
    const inRule = problemsOf((raw) => {
      findRuleRaw(raw, "R-FILL-PUMP").activities.push("levitate");
    });
    expect(inRule).toEqual(['rule R-FILL-PUMP: unknown activity "levitate"']);
    const inOutcome = problemsOf((raw) => {
      findRuleRaw(raw, "R-SUA-PRESENCE").outcomes.removed_element.activities.push("teleport");
    });
    expect(inOutcome).toEqual(['rule R-SUA-PRESENCE: unknown activity "teleport"']);
  });

  it("a parameter question with a bad bind path", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.mixing_speed").binds = "uo.compounding.equip.mixer.speed";
    });
    expect(problems).toContain("question comp.mixing_speed: parameter questions bind to uo.<uo>.param.<key>");
    const tooDeep = problemsOf((raw) => {
      findQuestion(raw, "comp.mixing_speed").binds = "uo.compounding.param.mixing_speed.extra";
    });
    expect(tooDeep).toContain("question comp.mixing_speed: parameter questions bind to uo.<uo>.param.<key>");
  });

  it("a non-parameter question with an invalid bind path", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_type").binds = "uo.compounding.widgets.vessel.type";
    });
    expect(problems).toContain('question comp.vessel_type: invalid binds path "uo.compounding.widgets.vessel.type"');
  });

  it("a missing bank header", () => {
    const problems = problemsOf((raw) => {
      delete raw.questionFiles[BANK_FILE].bank;
    });
    expect(problems).toEqual(["questions: no file declares the bank header (bank.id, bank.version)"]);
  });

  it("two bank headers", () => {
    const problems = problemsOf((raw) => {
      raw.questionFiles[COMPOUNDING_FILE].bank = { id: "second", version: "1.0.0" };
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/only one question file may declare the bank header/);
  });

  it("a missing or duplicated ruleset header", () => {
    const missing = problemsOf((raw) => {
      delete raw.ruleFiles["rules/rules.yaml"].ruleset;
    });
    expect(missing).toEqual(["rules: no file declares the ruleset header (ruleset.id, ruleset.version)"]);
    const twice = problemsOf((raw) => {
      raw.ruleFiles["rules/second.yaml"] = { ruleset: { id: "x", version: "1.0.0" }, rules: [] };
    });
    expect(twice).toEqual(["rules/second.yaml: only one rules file may declare the ruleset header"]);
  });

  it("a question in an unknown section, with an unknown parent, or with a parent elsewhere", () => {
    expect(
      problemsOf((raw) => {
        findQuestion(raw, "comp.mixer").section = "uo.nowhere";
      }),
    ).toContain('question comp.mixer: unknown section "uo.nowhere"');
    expect(
      problemsOf((raw) => {
        findQuestion(raw, "comp.mixing_demonstrated").parent = "comp.ghost";
      }),
    ).toEqual(['question comp.mixing_demonstrated: unknown parent "comp.ghost"']);
    expect(
      problemsOf((raw) => {
        findQuestion(raw, "comp.mixing_demonstrated").parent = "filt.presence";
      }),
    ).toEqual(["question comp.mixing_demonstrated: parent is in a different section"]);
  });

  it("scope paths and shared sides must go together", () => {
    const shared = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_type").sides = "shared";
    });
    expect(shared).toContain("question comp.vessel_type: scope paths must use sides: shared, and only scope paths may");
    const scoped = problemsOf((raw) => {
      findQuestion(raw, "scope.program").sides = "paired";
    });
    expect(scoped).toContain("question scope.program: scope paths must use sides: shared, and only scope paths may");
  });

  it("a question bound outside its unit operation", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.mixer").section = "uo.capping";
    });
    expect(problems).toContain("question comp.mixer: binds outside its unit operation");
  });

  it("the same path bound twice on the same side", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.mixer").binds = "uo.compounding.equip.vessel.type";
    });
    expect(problems).toContain("question comp.mixer: source:uo.compounding.equip.vessel.type is already bound by comp.vessel_type");
    expect(problems).toContain("question comp.mixer: target:uo.compounding.equip.vessel.type is already bound by comp.vessel_type");
  });

  it("a question with no matching rule", () => {
    const problems = problemsOf((raw) => {
      findRuleRaw(raw, "R-VESSEL-TYPE").match = ["uo.compounding.equip.vessel.somewhere_else"];
    });
    expect(problems).toEqual(['question comp.vessel_type: no comparison rule matches "uo.compounding.equip.vessel.type"']);
  });

  it("bad references in a showWhen condition", () => {
    const path = problemsOf((raw) => {
      findQuestion(raw, "fill.accuracy").showWhen = { changed: "uo.nope" };
    });
    expect(path).toEqual(['question fill.accuracy: invalid condition path "uo.nope"']);
    const ref = problemsOf((raw) => {
      findQuestion(raw, "filt.sua_supplier").showWhen = { isTrue: "middle.uo.sterile_filtration.mat.sua.present" };
    });
    expect(ref).toEqual(['question filt.sua_supplier: invalid condition reference "middle.uo.sterile_filtration.mat.sua.present"']);
    const uo = problemsOf((raw) => {
      findQuestion(raw, "fill.accuracy").showWhen = { uoPresent: "warp_drive" };
    });
    expect(uo).toEqual(['question fill.accuracy: unknown unit operation "warp_drive" in condition']);
    const nested = problemsOf((raw) => {
      findQuestion(raw, "fill.aps").showWhen = { any: [{ increased: "uo.aseptic_filling.param.max_fill_duration.max" }, { not: { eq: ["target.bogus", "x"] } }] };
    });
    expect(nested).toEqual(['question fill.aps: invalid condition reference "target.bogus"']);
  });

  it("a comparison against a path that is not valid", () => {
    const problems = problemsOf((raw) => {
      findRuleRaw(raw, "R-APS-COVERAGE").config.against.path = "uo.aseptic_filling.study.x";
    });
    expect(problems).toEqual(['rule R-APS-COVERAGE: invalid config.against.path "uo.aseptic_filling.study.x"']);
  });

  it("an evidence rule without a map, and a coverage rule without its settings", () => {
    expect(
      problemsOf((raw) => {
        delete findRuleRaw(raw, "R-EV-BRET").config.map;
      }),
    ).toEqual(["rule R-EV-BRET: evidence comparator needs config.map"]);
    expect(
      problemsOf((raw) => {
        delete findRuleRaw(raw, "R-MIXING-COVERAGE").config.coverageSide;
      }),
    ).toEqual(["rule R-MIXING-COVERAGE: coverage comparator needs config.against and config.coverageSide"]);
  });

  it("a duplicate rule id", () => {
    const problems = problemsOf((raw) => {
      raw.ruleFiles["rules/rules.yaml"].rules.push(structuredClone(findRuleRaw(raw, "R-MIXER")));
    });
    expect(problems).toEqual(["rule R-MIXER: duplicate id"]);
  });

  it("a unit-operation section naming an unknown unit operation", () => {
    const problems = problemsOf((raw) => {
      raw.questionFiles[BANK_FILE].sections.find((s: Mut) => s.id === "uo.capping").uo = "warp_drive";
    });
    expect(problems).toContain('section uo.capping: unknown unit operation "warp_drive"');
  });

  it("a unit-operation condition that reaches outside the scope answers", () => {
    const problems = problemsOf((raw) => {
      const uo = raw.catalog.unitOperations.find((u: Mut) => u.key === "capping");
      uo.applicableWhen = { eq: ["source.site.name", "x"] };
    });
    expect(problems).toEqual(["unit operation capping: applicableWhen may only use scope.* references"]);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_type").input.optionsFrom = "no_such_set";
      findQuestion(raw, "comp.vessel_capacity").input.units = ["L", "furlong"];
      findRuleRaw(raw, "R-FILL-PUMP").activities.push("levitate");
    });
    expect(problems).toHaveLength(3);
  });

  it("header problems are reported on their own, before the cross-checks run", () => {
    // Design: without both headers the bundle is not assembled, so other problems stay hidden until the headers are fixed.
    const problems = problemsOf((raw) => {
      findQuestion(raw, "comp.vessel_type").input.optionsFrom = "no_such_set";
      delete raw.questionFiles[BANK_FILE].bank;
    });
    expect(problems).toEqual(["questions: no file declares the bank header (bank.id, bank.version)"]);
  });

  it("names the file and the field for a schema error in a question file", () => {
    const problems = problemsOf((raw) => {
      delete raw.questionFiles[COMPOUNDING_FILE].questions[0].prompt;
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^questions\/20-compounding\.yaml: questions\.0\.prompt: /);
  });

  it("names the file for a schema error in a rule file", () => {
    const problems = problemsOf((raw) => {
      findRuleRaw(raw, "R-MIXER").comparator = "telepathy";
    });
    // A rules file that fails its schema is dropped, so the missing ruleset header is reported as well.
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^rules\/rules\.yaml: rules\.\d+\.comparator: /);
    expect(problems[1]).toBe("rules: no file declares the ruleset header (ruleset.id, ruleset.version)");
  });

  it("rejects a rule id that is not R-UPPERCASE", () => {
    const problems = problemsOf((raw) => {
      findRuleRaw(raw, "R-MIXER").id = "mixer";
    });
    expect(problems.some((p) => p.includes("rules.") && p.includes(".id"))).toBe(true);
  });

  it("rejects a bad version string in the catalog", () => {
    const problems = problemsOf((raw) => {
      raw.catalog.catalog.version = "one";
    });
    expect(problems).toEqual(["catalog: catalog.version: must be semver x.y.z"]);
  });

  it("rejects an incomplete document template", () => {
    const problems = problemsOf((raw) => {
      delete raw.templates.document.banner;
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^templates: document\.banner: /);
  });

  it("rejects an unknown condition operator in a showWhen", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "fill.accuracy").showWhen = { sortOf: "uo.x" };
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain("questions/40-aseptic-filling.yaml");
  });

  it("an empty condition list is invalid", () => {
    const problems = problemsOf((raw) => {
      findQuestion(raw, "fill.accuracy").showWhen = { all: [] };
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("ContentError carries all problems in its message", () => {
    const raw = clone();
    delete raw.questionFiles[BANK_FILE].bank;
    findQuestion(raw, "comp.vessel_type").input.optionsFrom = "no_such_set";
    try {
      buildContent(raw as RawContent);
      expect.unreachable();
    } catch (e) {
      const err = e as ContentError;
      expect(err.message.startsWith("Content validation failed:\n- ")).toBe(true);
      for (const p of err.problems) expect(err.message).toContain(p);
    }
  });

  it("the unmodified clone still builds (so the cases above fail for their own reason)", () => {
    expect(() => buildContent(clone() as RawContent)).not.toThrow();
  });
});

// ================================================================== YAML guard

describe("YAML content has no null values", () => {
  it("the walker finds nulls in nested objects and arrays, and ignores empty strings, zeros and false", () => {
    expect(nullPaths({ a: { b: null, c: [1, { d: null }] }, e: "", f: 0, g: false })).toEqual(["$.a.b", "$.a.c[1].d"]);
    expect(nullPaths(null)).toEqual(["$"]);
    expect(nullPaths({ ok: [] })).toEqual([]);
  });

  it("no mapping value anywhere in the question, rule, catalog and template files is null", () => {
    expect(nullPaths(rawContent.catalog, "catalog")).toEqual([]);
    expect(nullPaths(rawContent.templates, "templates")).toEqual([]);
    for (const [file, data] of Object.entries(rawContent.questionFiles)) expect(nullPaths(data, file), file).toEqual([]);
    for (const [file, data] of Object.entries(rawContent.ruleFiles)) expect(nullPaths(data, file), file).toEqual([]);
  });

  it("no mapping value anywhere in the demo scripts is null", () => {
    for (const [name, data] of Object.entries(demos)) expect(nullPaths(data, name), name).toEqual([]);
  });

  it("option values are strings, so words like no/yes/on/off were not turned into booleans", () => {
    const sets = (rawContent.catalog as unknown as { optionSets: Record<string, { value: unknown }[]> }).optionSets;
    expect(Object.keys(sets).length).toBeGreaterThan(0);
    for (const [name, options] of Object.entries(sets)) {
      for (const o of options) expect(typeof o.value, name).toBe("string");
    }
  });
});
