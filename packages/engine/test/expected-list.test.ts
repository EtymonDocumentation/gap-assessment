// The account's "Expected studies" list: versions, history, removal with a logged reason, and what the design review (D2) and the
// Process view's Coverage group read from it. All data are fictional.
import { describe, expect, it, vi } from "vitest";
import {
  addExpectedVersion,
  answerReview,
  buildDemoProject,
  buildProcessView,
  currentExpectedVersion,
  emptyExpectedListDoc,
  expectedKeysInForce,
  expectedStudies,
  planDesignReview,
  removeExpectedVersion,
  shippedExpectedKeys,
  withExpectedList,
  type EffectiveSuggestions,
  type ExpectedListDoc,
} from "@gap/engine";
import { ACTOR } from "./helpers";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions as shipped, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

const demo = buildDemoProject(content, demos["syr-305"], shipped, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const T = (n: number) => `2026-11-0${n}T10:00:00.000Z`;
const listOf = (keys: string[], n = 1): ExpectedListDoc => addExpectedVersion(emptyExpectedListDoc(), shipped, keys, "edited", undefined, T(n));
const allKeys = shipped.candidates.map((c) => c.key);

describe("the list store (pure)", () => {
  it("starts as the shipped marks, with no version of its own", () => {
    const doc = emptyExpectedListDoc();
    expect(currentExpectedVersion(doc)).toBeUndefined();
    expect(expectedKeysInForce(shipped, doc)).toEqual(shippedExpectedKeys(shipped));
    expect(shippedExpectedKeys(shipped).length).toBeGreaterThan(0);
    // No version: the catalog is used as it is, and no list marker is set.
    expect(withExpectedList(shipped, doc)).toBe(shipped);
  });

  it("saves versions with a reason, keeps the history and numbers them on", () => {
    let doc = addExpectedVersion(emptyExpectedListDoc(), shipped, ["a", "b", "a"], "edited", " Our SOP asks for it (fictional) ", T(1));
    doc = addExpectedVersion(doc, shipped, ["a"], "edited", undefined, T(2));
    expect(doc.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(doc.versions[0]).toMatchObject({ keys: ["a", "b"], reason: "Our SOP asks for it (fictional)", catalogVersion: shipped.catalog.version, kind: "edited" });
    expect(doc.versions[1]!.reason).toBeUndefined();
    expect(currentExpectedVersion(doc)!.number).toBe(2);
  });

  it("removes any version with a logged reason, falls back to the one before, and never reuses a number", () => {
    let doc = addExpectedVersion(emptyExpectedListDoc(), shipped, ["a"], "edited", "one", T(1));
    doc = addExpectedVersion(doc, shipped, ["b"], "edited", "two", T(2));
    const two = doc.versions[1]!;
    doc = removeExpectedVersion(doc, two.id, "Entered by mistake (fictional)", T(3));
    expect(currentExpectedVersion(doc)!.number).toBe(1);
    expect(doc.removed).toEqual([{ at: T(3), number: 2, savedAt: T(2), reason: "Entered by mistake (fictional)" }]);
    doc = addExpectedVersion(doc, shipped, ["c"], "edited", undefined, T(4));
    expect(doc.versions.map((v) => v.number)).toEqual([1, 3]);
    // Even the only versions can go; then the shipped marks apply again. A blank reason is logged as such, not refused.
    doc = removeExpectedVersion(doc, doc.versions[1]!.id, "x", T(5));
    doc = removeExpectedVersion(doc, doc.versions[0]!.id, " ", T(5));
    expect(doc.versions).toEqual([]);
    expect(doc.removed.at(-1)!.reason).toBe("No reason given.");
    expect(expectedKeysInForce(shipped, doc)).toEqual(shippedExpectedKeys(shipped));
  });

  it("reset saves the shipped list as a new version", () => {
    let doc = listOf([]);
    doc = addExpectedVersion(doc, shipped, shippedExpectedKeys(shipped), "reset", undefined, T(2));
    expect(currentExpectedVersion(doc)).toMatchObject({ number: 2, kind: "reset" });
    expect(expectedStudies(withExpectedList(shipped, doc)).map((e) => e.key).sort()).toEqual([...shippedExpectedKeys(shipped)].sort());
    // Same entries as the shipped marks: no list marker, so earlier answers keep their fingerprints.
    expect(withExpectedList(shipped, doc).expectedListId).toBeUndefined();
  });

  it("keeps a key the catalog no longer has in the list but leaves it out of the check", () => {
    const doc = listOf([...shippedExpectedKeys(shipped), "gone_from_catalog"]);
    expect(currentExpectedVersion(doc)!.keys).toContain("gone_from_catalog");
    const eff = withExpectedList(shipped, doc);
    expect(expectedStudies(eff).map((e) => e.key)).not.toContain("gone_from_catalog");
    expect(expectedStudies(eff).length).toBe(shippedExpectedKeys(shipped).length);
    expect(eff.expectedListId).toBeUndefined();
  });
});

describe("D2 and the Coverage group read the account's list", () => {
  const plan = demo.sampling.plans[0]!;
  const d2 = (s: EffectiveSuggestions, proj = demo) => planDesignReview(content, proj, proj.sampling.plans.find((p) => p.id === plan.id)!, s).items.filter((i) => i.finding.checkId === "D2");

  it("an entry added to the list raises, and an entry taken off stops raising", () => {
    expect(d2(withExpectedList(shipped, listOf([])))).toEqual([]);
    const raisedAll = d2(withExpectedList(shipped, listOf(allKeys))).map((i) => i.finding.key);
    expect(raisedAll.length).toBeGreaterThan(d2(shipped).length);
    const one = raisedAll[0]!.replace("D2:", "");
    const without = d2(withExpectedList(shipped, listOf(allKeys.filter((k) => k !== one)))).map((i) => i.finding.key);
    expect(without).toEqual(raisedAll.filter((k) => k !== `D2:${one}`));
  });

  it("a changed list makes an answered D2 question say 'look again'; an unchanged list leaves it answered", () => {
    const all = withExpectedList(shipped, listOf(allKeys));
    const first = d2(all)[0]!.finding;
    const answered = answerReview(demo, plan.id, first.key, { response: "not_applicable", factsFingerprint: first.factsFingerprint }, ACTOR);
    const stateIn = (s: EffectiveSuggestions) => d2(s, answered).find((i) => i.finding.key === first.key)?.state;
    expect(stateIn(all)).toBe("answered");
    // The same entry is still expected, but the list around it changed: the answer was given for another list.
    const other = allKeys.find((k) => `D2:${k}` !== first.key)!;
    expect(stateIn(withExpectedList(shipped, listOf(allKeys.filter((k) => k !== other))))).toBe("look_again");
  });

  it("the Coverage group uses the same list", () => {
    const rec = demo.mbr.records[0];
    if (!rec) return;
    const count = (keys: string[]) => buildProcessView(demo, rec, { expected: expectedStudies(withExpectedList(shipped, listOf(keys))) }).findings.filter((f) => f.checkId === "D2").length;
    expect(count([])).toBe(0);
    expect(count(allKeys)).toBeGreaterThanOrEqual(count(shippedExpectedKeys(shipped)));
  });
});
