/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { customKeyFromLabel, emptyProject, ImportError, isCustomKey, isValidCustomKey, parseProject, SCHEMA_VERSION } from "@gap/process-model";

const actor = { name: "Test Person (fictional)", at: "2026-10-01T09:00:00.000Z" };
const fresh = () => emptyProject({ title: "Custom test (fictional)", actor, contentRefs: { catalog: "1", questions: "1", rules: "1", templates: "1" } });
const json = (p: unknown) => JSON.parse(JSON.stringify(p));

const withCustom = () => {
  const p = fresh();
  p.custom = {
    unitOperations: [{ key: "x_visual_check", label: "Visual check", sequence: 25, createdBy: actor.name, createdAt: actor.at }],
    items: [
      { uo: "x_visual_check", coll: "param", key: "x_hold_temp", label: "Hold temperature", dimension: "temperature", createdBy: actor.name, createdAt: actor.at },
      { uo: "compounding", coll: "ipc", key: "x_foam_check", label: "Foam check", createdBy: actor.name, createdAt: actor.at },
    ],
  };
  return p;
};

describe("custom keys", () => {
  it("recognises and validates keys", () => {
    expect(isCustomKey("x_a")).toBe(true);
    expect(isCustomKey("batch_size")).toBe(false);
    expect(isValidCustomKey("x_a_b2")).toBe(true);
    expect(isValidCustomKey("x_a.b")).toBe(false);
    expect(customKeyFromLabel("Hold temp", ["x_hold_temp"])).toBe("x_hold_temp_2");
  });
});

describe("custom definitions in the project", () => {
  it("a new project has empty definitions and the current schema version", () => {
    expect(fresh().custom).toEqual({ unitOperations: [], items: [] });
    expect(fresh().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("round-trips through JSON", () => {
    const p = withCustom();
    expect(parseProject(json(p))).toEqual(p);
  });

  it("migrates a 1.0.0 project that has no custom block", () => {
    const old = json(fresh());
    old.schemaVersion = "1.0.0";
    delete old.custom;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.custom).toEqual({ unitOperations: [], items: [] });
  });

  it("rejects invalid definitions", () => {
    const bad = (mutate: (p: any) => void) => {
      const p = json(withCustom());
      mutate(p);
      expect(() => parseProject(p)).toThrow(ImportError);
    };
    bad((p) => (p.custom.unitOperations[0].key = "visual"));
    bad((p) => (p.custom.unitOperations[0].key = "x_a.b"));
    bad((p) => p.custom.unitOperations.push({ ...p.custom.unitOperations[0] }));
    bad((p) => p.custom.items.push({ ...p.custom.items[0] }));
    bad((p) => (p.custom.items[0].uo = "x_undefined"));
    bad((p) => delete p.custom.items[0].dimension);
    bad((p) => (p.custom.items[1].coll = "study"));
    bad((p) => (p.custom.items[1].key = "foam"));
  });
});
