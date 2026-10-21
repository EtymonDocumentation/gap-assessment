import { getEntry, parseProject, SCHEMA_VERSION } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { kit } from "../../packages/engine/test/helpers";

/**
 * Migration 1.7.0 -> 1.8.0 (project.tailoring). A 1.7.0 file has no tailoring record. It must read as "every topic
 * included" (the conservative default), and the labelling location, a new question, must stay unanswered rather than
 * be filled in for the user.
 */

const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function oldFile() {
  const raw = json(kit.v(kit.base(), "fill.pump", "source", "rotary_piston"));
  raw.schemaVersion = "1.7.0";
  delete raw.tailoring;
  return raw;
}

describe("migration 1.7.0 -> 1.8.0", () => {
  it("reads the old file, stamps the current version and starts with nothing switched off", () => {
    const p = parseProject(oldFile());
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.tailoring).toEqual({ excluded: [] });
  });

  it("keeps existing answers and leaves the labelling location unanswered", () => {
    const p = parseProject(oldFile());
    expect(getEntry(p, "source.uo.aseptic_filling.equip.filler.operatingPrinciple")?.status).toBe("established");
    expect(getEntry(p, "source.site.labellingLocation")).toBeUndefined();
    expect(getEntry(p, "target.site.labellingLocation")).toBeUndefined();
  });

  it("rejects an exclusion without a reason and a duplicated exclusion", () => {
    const bad = oldFile();
    bad.schemaVersion = "1.8.0";
    bad.tailoring = { excluded: [{ uo: "bulk_packaging", topic: "hold", reason: " ", by: "Pat (fictional)", at: "2026-10-04T09:00:00.000Z" }] };
    expect(() => parseProject(bad)).toThrow();
    const dup = { uo: "bulk_packaging", topic: "hold", reason: "r", by: "Pat (fictional)", at: "2026-10-04T09:00:00.000Z" };
    bad.tailoring = { excluded: [dup, dup] };
    expect(() => parseProject(bad)).toThrow();
  });
});
