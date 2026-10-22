import type { RiskConfig, RiskMethodSnapshot } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { configFromEntry, contentKey, libraryStatus, nextHistory, snapshotOf } from "../src/risk-library";

const scale = (max = 5) => ({ min: 1, max, levels: [] });
const fmea = (over: Partial<Extract<RiskConfig, { method: "fmea" }>> = {}): RiskConfig => ({ method: "fmea", severity: scale(), occurrence: scale(), detection: scale(), bands: [], ...over });
const entry = (version: string, config: RiskConfig = fmea()): RiskMethodSnapshot => ({ id: "lib-1", name: "QRM method (fictional)", version, config });

describe("risk method library: history", () => {
  it("starts a new entry with 'created' and no earlier content", () => {
    expect(nextHistory(undefined, "2026-10-22T09:00:00.000Z")).toEqual([{ at: "2026-10-22T09:00:00.000Z", action: "created" }]);
  });

  it("keeps the whole earlier content of an edited entry, and every earlier event", () => {
    const cur = { ...entry("1"), history: nextHistory(undefined, "t1") };
    const second = nextHistory(cur, "t2");
    expect(second).toHaveLength(2);
    expect(second[1]).toMatchObject({ at: "t2", action: "edited", before: { name: "QRM method (fictional)", version: "1", config: { method: "fmea" } } });
    // The copy is independent: changing the live entry later does not rewrite the history.
    (cur.config as { bands: unknown[] }).bands.push({ label: "x", minRpn: 1, maxRpn: 2 });
    expect((second[1]!.before!.config as { bands: unknown[] }).bands).toEqual([]);
  });

  it("a snapshot drops the library's bookkeeping and empty optional fields", () => {
    const s = snapshotOf({ ...entry("1"), docRef: "", owner: "" });
    expect(Object.keys(s).sort()).toEqual(["config", "id", "name", "version"]);
  });
});

describe("risk method library: how an assessment's copy compares with the entry", () => {
  const used = (e: RiskMethodSnapshot): RiskConfig => configFromEntry(e);

  it("has nothing to say for a method that is the assessment's own, or an entry that is gone", () => {
    expect(libraryStatus(fmea(), entry("1"))).toEqual({ kind: "none" });
    expect(libraryStatus(undefined, entry("1"))).toEqual({ kind: "none" });
    expect(libraryStatus(used(entry("1")), undefined)).toEqual({ kind: "none" });
    expect(libraryStatus(used(entry("1")), { ...entry("1"), id: "another" })).toEqual({ kind: "none" });
  });

  it("is current when version and content agree, whatever the order of the fields", () => {
    const e = entry("1");
    expect(libraryStatus(used(e), e)).toEqual({ kind: "current" });
    const reordered = { ...e, config: { bands: [], detection: scale(), occurrence: scale(), severity: scale(), method: "fmea" } as RiskConfig };
    expect(libraryStatus(used(e), reordered)).toEqual({ kind: "current" });
  });

  it("reports a newer library version with both version labels", () => {
    expect(libraryStatus(used(entry("1")), entry("2", fmea({ detection: scale(10) })))).toEqual({ kind: "newer", libraryVersion: "2", usedVersion: "1" });
  });

  it("reports an edit that kept the version label, so a changed scale is never invisible", () => {
    expect(libraryStatus(used(entry("1")), entry("1", fmea({ detection: scale(10) })))).toEqual({ kind: "changed-same-version", version: "1" });
  });

  it("ignores the informational links when it compares content", () => {
    expect(contentKey({ ...fmea(), loadoutId: "fmea-1-5" } as RiskConfig)).toBe(contentKey(fmea()));
    expect(contentKey(used(entry("1")))).toBe(contentKey(fmea()));
  });

  it("hands an assessment a copy linked to the entry by id, name and version", () => {
    const e = entry("3");
    const c = configFromEntry(e);
    expect(c.libraryRef).toEqual({ id: "lib-1", name: "QRM method (fictional)", version: "3" });
    (c as { bands: unknown[] }).bands.push({});
    expect((e.config as { bands: unknown[] }).bands).toEqual([]);
  });
});
