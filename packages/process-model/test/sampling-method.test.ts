import { describe, expect, it } from "vitest";
import { SAMPLING_PLAN_FORMAT_VERSION, SCHEMA_VERSION, emptyProject, parseProject, sampleMethodSchema, type Actor } from "../src/index";

const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };
const refs = { catalog: "1.0.0", questions: "1.0.0", rules: "1.0.0", templates: "1.0.0" };

describe("sampling method (current versions: schema 1.32.0, plan format 1.8.0)", () => {
  it("has the new versions", () => {
    expect(SCHEMA_VERSION).toBe("1.34.0");
    expect(SAMPLING_PLAN_FORMAT_VERSION).toBe("1.8.0");
  });

  it("accepts an empty method and every answer, and rejects a non-positive flush volume or an unknown access", () => {
    expect(sampleMethodSchema.safeParse({}).success).toBe(true);
    expect(sampleMethodSchema.safeParse({ access: "added_y_connector", added: { forStudyOnly: true, removedAfter: true }, flush: { practice: "flush_volume", volume: { value: 50, unit: "mL" } }, closedSystem: "closed" }).success).toBe(true);
    expect(sampleMethodSchema.safeParse({ flush: { volume: { value: 0, unit: "mL" } } }).success).toBe(false);
    expect(sampleMethodSchema.safeParse({ access: "teleport" }).success).toBe(false);
  });

  it("opens a 1.26.0 project unchanged except for the version", () => {
    const old = JSON.parse(JSON.stringify(emptyProject({ title: "Old project (fictional)", actor: ACTOR, contentRefs: refs }))) as Record<string, any>;
    old.schemaVersion = "1.26.0";
    const before = JSON.stringify(old.sampling);
    const p = parseProject(old);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(JSON.stringify(p.sampling)).toBe(before);
  });
});
