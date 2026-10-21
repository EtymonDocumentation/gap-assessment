import { getEntry, parseProject, SCHEMA_VERSION } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { kit } from "../../packages/engine/test/helpers";

/**
 * Migration 1.6.0 -> 1.7.0 (TBD status, citation locations, the Answering from bar, tbdCount on revisions).
 * The 1.6.0 file is the current shape with the new optional fields removed and the old version number put back: all
 * the new fields are optional, so nothing is rewritten, and above all an old "unknown" must stay "unknown".
 */

const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function oldFile() {
  let p = kit.ask(kit.base(), "fill.pump", "target", { kind: "unknown" });
  p = kit.v(p, "fill.pump", "source", "rotary_piston");
  const raw = json(p);
  raw.schemaVersion = "1.6.0";
  return raw;
}

describe("migration 1.6.0 -> 1.7.0", () => {
  it("reads the old file and stamps the current schema version", () => {
    expect(parseProject(oldFile()).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe("1.7.0");
  });

  it("leaves an old 'unknown' as unknown; it is not turned into a TBD", () => {
    const p = parseProject(oldFile());
    const e = getEntry(p, "target.uo.aseptic_filling.equip.filler.operatingPrinciple")!;
    expect(e.status).toBe("unknown");
    expect(e.tbd).toBeUndefined();
  });

  it("old citations have no location, there is no answering-from choice and old revisions have no TBD count", () => {
    const p = parseProject(oldFile());
    const e = getEntry(p, "source.uo.aseptic_filling.equip.filler.operatingPrinciple")!;
    expect(e.status).toBe("established");
    expect(e.sourceLocations).toBeUndefined();
    expect(p.interview.answeringFrom).toBeUndefined();
    expect(p.document.revisions.every((r) => r.tbdCount === undefined)).toBe(true);
  });
});
