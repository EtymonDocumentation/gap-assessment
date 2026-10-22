import { getEntry, parseProject, SCHEMA_VERSION } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { kit } from "../../packages/engine/test/helpers";

/**
 * Migration 1.6.0 -> 1.7.0 (TBD status, citation locations, the Answering from bar, tbdCount on revisions).
 * The 1.6.0 file is the current shape with the new optional fields removed and the old version number put back: all
 * the new fields are optional, so nothing is rewritten by that step. An old "unknown" is converted later, by the
 * 1.8.0 -> 1.9.0 step (see migration-190.test.ts), because the answer was retired.
 */

const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function oldFile() {
  let p = kit.ask(kit.base(), "fill.pump", "target", { kind: "tbd" });
  p = kit.v(p, "fill.pump", "source", "rotary_piston");
  const raw = json(p);
  // A 1.6.0 file knows no TBD: the target answer was "Unknown".
  const target = raw.processes.target.unitOperations.aseptic_filling.collections.equip.filler.fields.operatingPrinciple;
  target.status = "unknown";
  delete target.tbd;
  raw.schemaVersion = "1.6.0";
  return raw;
}

describe("migration 1.6.0 -> 1.7.0", () => {
  it("reads the old file and stamps the current schema version", () => {
    expect(parseProject(oldFile()).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe("1.11.0");
  });

  it("an old 'unknown' reaches the current version as a TBD with no details (nothing invented)", () => {
    const p = parseProject(oldFile());
    const e = getEntry(p, "target.uo.aseptic_filling.equip.filler.operatingPrinciple")!;
    expect(e.status).toBe("tbd");
    expect(e.tbd).toEqual({});
  });

  it("old citations have no location, there is no answering-from choice and old revisions have no TBD count", () => {
    const p = parseProject(oldFile());
    const e = getEntry(p, "source.uo.aseptic_filling.equip.filler.operatingPrinciple")!;
    expect(e.status).toBe("established");
    expect(e.sourceLocations).toBeUndefined();
    expect(p.interview.answeringFrom).toBeUndefined();
    expect(((p.document.archivedReview?.revisions ?? []) as { tbdCount?: number }[]).every((r) => r.tbdCount === undefined)).toBe(true);
  });
});
