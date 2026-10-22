import {
  assess,
  buildDemoProject,
  buildDocument,
  buildValidationPlan,
  changeLogView,
  tbdItems,
  verificationSummary,
} from "@gap/engine";
import { getEntry, parseProject, SCHEMA_VERSION, SYSTEM_ACTOR, verifyEntry, type Actor } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";
import { kit, q, T1 } from "../../packages/engine/test/helpers";

/**
 * Migration 1.8.0 -> 1.9.0: "Unknown (to be confirmed)" is retired and merged into TBD.
 *
 * The old engine is not runnable any more, so "behaviour does not change" is proven in two halves:
 *  1. A project written the 1.8.0 way (status "unknown", no tbd block) migrates to entries that are deep-equal to the
 *     same answers recorded natively as "TBD with no details", and every result computed from the two (comparison,
 *     gaps, open items, validation plan, verification, TBD list, document) is equal.
 *  2. The behaviour the old Unknown had is pinned explicitly (information required, an open item, no gap invented,
 *     cannot be verified), so a later change to TBD handling cannot silently change what a migrated file means.
 */

const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every entry object of a raw project file, with the dotted path the entry carries. */
function rawEntries(raw: Record<string, any>): any[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const take = (fields: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const e of Object.values<any>(fields ?? {})) out.push(e); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  take(raw.scope);
  for (const side of ["source", "target"]) {
    const m = raw.processes?.[side];
    take(m?.site?.fields);
    for (const uo of Object.values<any>(m?.unitOperations ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
      take(uo.fields);
      for (const coll of Object.values<any>(uo.collections ?? {})) for (const item of Object.values<any>(coll)) take(item.fields); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
  return out;
}

/**
 * Writes a current project the way a 1.8.0 build stored it: a TBD with no details at all was an "unknown" entry.
 * (A TBD that names an owner, a due date, a note or a best guess was already a TBD in 1.8.0 and stays one.)
 */
function asVersion180(p: unknown): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = json(p);
  raw.schemaVersion = "1.8.0";
  for (const e of rawEntries(raw)) {
    if (e.status === "tbd" && Object.keys(e.tbd ?? {}).length === 0) {
      e.status = "unknown";
      delete e.tbd;
    }
  }
  return raw;
}

/** A project with several unknowns of every shape the old tool allowed. */
function projectWithUnknowns() {
  let p = kit.base();
  p = kit.pair(p, "comp.vessel_type", "stainless_tank", "glass");
  p = kit.unk(p, "comp.mixer", "source"); // a source-side unknown
  p = kit.v(p, "comp.mixer", "target", "rocking"); // ...answered at the target
  p = kit.v(p, "comp.vessel_capacity", "source", q(100, "L"));
  p = kit.unk(p, "comp.vessel_capacity", "target"); // a target-side unknown
  p = kit.unk(p, "fill.pump", "source"); // unknown at both sides
  p = kit.unk(p, "fill.pump", "target");
  p = kit.par(p, "comp.mixing_speed", "source", { classification: "KPP", setPoint: q(150, "rpm"), nor: { min: q(120, "rpm"), max: q(180, "rpm") }, par: { min: q(100, "rpm"), max: q(200, "rpm") }, rangeBasis: "PPQ" });
  p = kit.par(p, "comp.mixing_speed", "target", { setPoint: "tbd", nor: "same" }); // a per-field unknown
  p = kit.unk(p, "comp.mixing_speed", "source"); // whole-question unknown over a parameter
  return p;
}

const SAMPLES: [string, () => ReturnType<typeof projectWithUnknowns>][] = [
  ["a project with several unknowns", projectWithUnknowns],
  ["the ARX-217 demo", () => buildDemoProject(content, demos["arx-217"])],
];

const NOW = "2026-10-21T08:00:00.000Z";
const REVIEWER: Actor = { name: "A. Reviewer (fictional)", role: "QA", at: T1 };

describe("migration 1.8.0 -> 1.9.0", () => {
  it("is the current schema version", () => {
    expect(SCHEMA_VERSION).toBe("1.12.0");
  });

  it("converts every unknown entry to a TBD with empty details and nothing invented", () => {
    const old = asVersion180(projectWithUnknowns());
    const unknownCount = rawEntries(old).filter((e) => e.status === "unknown").length;
    expect(unknownCount).toBeGreaterThan(5);
    const p = parseProject(old, { now: NOW });
    expect(p.schemaVersion).toBe("1.12.0");
    const migrated = rawEntries(json(p));
    expect(migrated.some((e) => e.status === "unknown")).toBe(false);
    const converted = rawEntries(old)
      .map((e, i) => [e, migrated[i]])
      .filter(([before]) => before.status === "unknown");
    expect(converted).toHaveLength(unknownCount);
    for (const [before, after] of converted) {
      expect(after.status).toBe("tbd");
      expect(after.tbd).toEqual({}); // no owner, no due date, no best guess, no note
      expect(after.sameAsSource ?? false).toBe(before.sameAsSource ?? false);
      expect(after.sources).toEqual(before.sources);
      expect(after.history).toEqual(before.history);
    }
  });

  it("writes one change-log record per converted entry, by the system, after the existing history", () => {
    const old = asVersion180(projectWithUnknowns());
    const unknownCount = rawEntries(old).filter((e) => e.status === "unknown").length;
    const p = parseProject(old, { now: NOW });
    const added = p.changeLog.slice(old.changeLog.length);
    expect(added).toHaveLength(unknownCount);
    expect(p.changeLog.slice(0, old.changeLog.length)).toEqual(old.changeLog); // history is never rewritten
    for (const ev of added) {
      expect(ev).toMatchObject({
        at: NOW,
        by: SYSTEM_ACTOR,
        action: "migrate_status",
        detail: "Unknown converted to TBD (schema 1.9.0, no change in meaning)",
        before: { status: "unknown" },
        after: { status: "tbd", tbd: {} },
      });
      expect(getEntry(p, ev.path!)?.status).toBe("tbd");
    }
    expect(SYSTEM_ACTOR).toBe("System (file update)");
  });

  it("keeps same-as-source on the converted entry's log snapshot and on the entry", () => {
    let proj = kit.base();
    proj = kit.unk(proj, "comp.vessel_type", "source");
    proj = kit.same(proj, "comp.vessel_type");
    const old = asVersion180(proj);
    const p = parseProject(old, { now: NOW });
    expect(getEntry(p, "target.uo.compounding.equip.vessel.type")).toMatchObject({ status: "established", sameAsSource: true });
    expect(getEntry(p, "source.uo.compounding.equip.vessel.type")).toMatchObject({ status: "tbd", tbd: {} });
  });

  it("is a no-op for a file that has no unknown entries, apart from the version stamp", () => {
    const clean = json(kit.pair(kit.base(), "comp.vessel_type", "stainless_tank", "glass"));
    clean.schemaVersion = "1.8.0";
    const p = parseProject(clean, { now: NOW });
    expect(p.changeLog).toHaveLength(clean.changeLog.length);
    expect(json(p).processes).toEqual(clean.processes);
  });

  it("migrates the same file the same way twice, and a migrated file loads unchanged", () => {
    const old = asVersion180(projectWithUnknowns());
    const once = parseProject(old, { now: NOW });
    expect(parseProject(old, { now: NOW })).toEqual(once);
    expect(parseProject(json(once), { now: "2027-01-01T00:00:00.000Z" })).toEqual(once); // already current: no new records
  });

  it("leaves verification untouched: the verified entries keep their record and the counts do not change", () => {
    let proj = kit.pair(kit.base(), "comp.vessel_type", "stainless_tank", "glass");
    proj = kit.unk(proj, "comp.mixer", "source");
    proj = verifyEntry(proj, "source.uo.compounding.equip.vessel.type", REVIEWER);
    const old = asVersion180(proj);
    const p = parseProject(old, { now: NOW });
    expect(getEntry(p, "source.uo.compounding.equip.vessel.type")?.verification).toEqual(getEntry(proj, "source.uo.compounding.equip.vessel.type")?.verification);
    expect(p.changeLog.filter((e) => e.action === "verify")).toHaveLength(proj.changeLog.filter((e) => e.action === "verify").length);
  });
  it("rejects a new write of status unknown", () => {
    const bad = json(kit.pair(kit.base(), "comp.vessel_type", "stainless_tank", "glass"));
    const first = rawEntries(bad)[0];
    first.status = "unknown";
    delete first.value;
    expect(() => parseProject(bad)).toThrow();
  });
});

describe.each(SAMPLES)("behaviour is identical before and after migration: %s", (_name, build) => {
  const native = build();
  const migrated = parseProject(asVersion180(native), { now: NOW });

  it("had unknowns to convert", () => {
    expect(rawEntries(asVersion180(native)).some((e) => e.status === "unknown")).toBe(true);
  });

  it("the entries are deep-equal; only the change log gains the conversion records", () => {
    expect(migrated.processes).toEqual(native.processes);
    expect(migrated.scope).toEqual(native.scope);
    expect(migrated.answers).toEqual(native.answers);
    expect(migrated.sources).toEqual(native.sources);
  });

  it("comparison, gaps, open items and inactive entries are equal", () => {
    const a = assess(content, native);
    const b = assess(content, migrated);
    expect(b.gaps).toEqual(a.gaps);
    expect(b.openItems).toEqual(a.openItems);
    expect(b.inactive).toEqual(a.inactive);
    expect(b.instances.map((i) => i.key)).toEqual(a.instances.map((i) => i.key));
  });

  it("validation plan, verification summary and TBD list are equal", () => {
    const a = assess(content, native);
    const b = assess(content, migrated);
    expect(buildValidationPlan(content, migrated, b)).toEqual(buildValidationPlan(content, native, a));
    expect(verificationSummary(content, migrated)).toEqual(verificationSummary(content, native));
    expect(tbdItems(content, migrated, b)).toEqual(tbdItems(content, native, a));
  });

  it("the document is equal apart from the change-log records that describe the conversion", () => {
    const a = buildDocument(content, native, assess(content, native), NOW);
    const b = buildDocument(content, migrated, assess(content, migrated), NOW);
    const strip = (d: typeof a) => d.sections.filter((s) => !/change.?log/i.test(s.title + s.id));
    expect(strip(b)).toEqual(strip(a));
    expect(b.tbdCount).toBe(a.tbdCount);
  });
});

describe("what an Unknown meant is pinned (so the merged TBD cannot drift)", () => {
  const p = kit.unk(kit.pair(kit.base(), "comp.vessel_type", "stainless_tank", "glass"), "comp.mixer", "target");
  const a = kit.run(p);

  it("is an open information item and invents no gap", () => {
    expect(a.openItems.map((o) => o.ref)).toContain("target.uo.compounding.equip.mixer.operatingPrinciple");
    const g = a.gaps.find((x) => x.key.includes("mixer"));
    if (g) expect(g.category).toBe("information_required");
  });

  it("cannot be verified", () => {
    expect(() => verifyEntry(p, "target.uo.compounding.equip.mixer.operatingPrinciple", REVIEWER)).toThrow(/TBD/);
  });

  it("reads as TBD with no details in the TBD list, never with an invented owner or date", () => {
    const item = tbdItems(content, p, a).find((i) => i.ref === "target.uo.compounding.equip.mixer.operatingPrinciple");
    expect(item).toBeDefined();
    expect(item!.owner).toBeUndefined();
    expect(item!.due).toBeUndefined();
    expect(item!.bestGuess).toBeUndefined();
  });
});

describe("old change-log history keeps saying Unknown", () => {
  it("renders an old record as recorded and the conversion record as TBD", () => {
    const proj = kit.unk(kit.base(), "comp.vessel_type", "source");
    const old = asVersion180(proj);
    // A 1.8.0 file recorded the answer as Unknown in its log, too.
    for (const ev of old.changeLog) if (ev.action === "answer" && ev.after?.status === "tbd") ev.after = { status: "unknown" };
    const p = parseProject(old, { now: NOW });
    const rows = changeLogView(content, p, {});
    expect(rows.find((r) => r.action === "answer" && r.after === "Unknown")).toBeDefined();
    const conv = rows.find((r) => r.action === "migrate_status")!;
    expect(conv).toMatchObject({ by: SYSTEM_ACTOR, before: "Unknown" });
    expect(conv.after).toMatch(/^To be determined \(TBD\)/);
  });
});
