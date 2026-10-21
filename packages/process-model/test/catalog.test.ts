import { describe, expect, it } from "vitest";
import { CatalogError, catalogSchema, loadCatalog, type Catalog } from "../src/index";
import { catalog } from "../src/catalog-data";

const clone = (): Catalog => structuredClone(catalog);
const problems = (c: unknown): string[] => {
  try {
    loadCatalog(c);
  } catch (e) {
    if (e instanceof CatalogError) return e.problems;
    throw e;
  }
  return [];
};

describe("process-model catalog", () => {
  it("loads and validates", () => {
    expect(catalogSchema.safeParse(catalog).success).toBe(true);
    expect(catalog.catalog.id).toBe("fill-finish-catalog");
    expect(catalog.catalog.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(catalog.unitOperations.length).toBeGreaterThan(10);
    expect(catalog.stageGroups.length).toBeGreaterThan(3);
  });

  it("holds nothing that belongs to the gap assessment only", () => {
    expect(Object.keys(catalog).sort()).toEqual(["catalog", "fieldLabels", "optionSets", "stageGroups", "unitOperations"]);
  });

  it("puts every unit operation in exactly one stage group", () => {
    const seen = new Map<string, number>();
    for (const g of catalog.stageGroups) for (const u of g.unitOperations) seen.set(u, (seen.get(u) ?? 0) + 1);
    for (const u of catalog.unitOperations) expect(seen.get(u.key), u.key).toBe(1);
  });

  it("supplies options, never answers: every option set is a non-empty list of value and label", () => {
    for (const [name, opts] of Object.entries(catalog.optionSets)) {
      expect(opts.length, name).toBeGreaterThan(0);
      for (const o of opts) expect(typeof o.value === "string" && typeof o.label === "string", name).toBe(true);
    }
  });

  it("rejects a unit operation that is in no stage group", () => {
    const c = clone();
    c.stageGroups[0]!.unitOperations = c.stageGroups[0]!.unitOperations.slice(1);
    expect(problems(c).join("\n")).toMatch(/is in no stage group/);
  });

  it("rejects a unit operation that is in two stage groups", () => {
    const c = clone();
    c.stageGroups[1]!.unitOperations.push(c.stageGroups[0]!.unitOperations[0]!);
    expect(problems(c).join("\n")).toMatch(/is in two stage groups/);
  });

  it("rejects a stage group naming an unknown unit operation", () => {
    const c = clone();
    c.stageGroups[0]!.unitOperations.push("no_such_step");
    expect(problems(c).join("\n")).toMatch(/unknown unit operation "no_such_step"/);
  });

  it("rejects a duplicate unit operation key", () => {
    const c = clone();
    c.unitOperations.push({ ...c.unitOperations[0]! });
    expect(problems(c).join("\n")).toMatch(/duplicate unit operation key/);
  });

  it("limits applicableWhen to scope.* and hiddenWhen to site.* answers", () => {
    const a = clone();
    a.unitOperations[0]!.applicableWhen = { eq: ["site.stage", "commercial"] };
    expect(problems(a).join("\n")).toMatch(/applicableWhen may only use scope\.\* references/);
    const h = clone();
    h.unitOperations[0]!.hiddenWhen = { eq: ["scope.modality", "mab"] };
    expect(problems(h).join("\n")).toMatch(/hiddenWhen may only use site\.\* references/);
  });

  it("rejects a topic that collides with an item collection name", () => {
    const c = clone();
    c.unitOperations[0]!.topics = [{ key: "param", label: "Parameters" }];
    expect(problems(c).join("\n")).toMatch(/collides with an item collection name/);
  });

  it("rejects a malformed catalog", () => {
    expect(() => loadCatalog({ catalog: { id: "x", version: "one" } })).toThrow(CatalogError);
  });
});
