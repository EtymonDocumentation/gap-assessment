import { describe, expect, it } from "vitest";
import {
  describeVerification,
  getEntry,
  ImportError,
  isSelfVerification,
  parseProject,
  planVerification,
  removeSource,
  SCHEMA_VERSION,
  unverifyEntry,
  verificationState,
  verifyEntries,
  verifyEntry,
  VerificationError,
  type Actor,
  type Project,
} from "@gap/process-model";
import { buildDemoProject } from "@gap/engine";
import { content as realContent, demos } from "../../../content/index";
import { ACTOR, OTHER_ACTOR, T1, kit } from "../../engine/test/helpers";

const { v, unk, same, na, newProject } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";
const MIXER_S = "source.uo.compounding.equip.mixer.operatingPrinciple";

/** A verifier with a role, so the role is carried through. */
const REVIEWER: Actor = { name: "A. Reviewer (fictional)", role: "QA", at: T1 };
const T2 = "2026-10-03T08:00:00.000Z";

const recorded = () => v(newProject(), "comp.vessel_type", "source", "stainless_tank");
const json = (p: Project) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("verification states", () => {
  it("is unverified until someone verifies", () => {
    expect(verificationState(recorded(), VESSEL_S)).toEqual({ state: "unverified" });
    expect(describeVerification({ state: "unverified" })).toBe("Unverified");
  });

  it("is verified by name, role and date, and says so in words", () => {
    const p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    const st = verificationState(p, VESSEL_S);
    expect(st).toEqual({ state: "verified", by: "A. Reviewer (fictional)", role: "QA", at: T1 });
    expect(describeVerification(st)).toBe("Verified by A. Reviewer (fictional) (QA) on 2026-10-02");
  });

  it("is withdrawn when the value changes, with the reason and the original verifier kept", () => {
    let p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    p = v(p, "comp.vessel_type", "source", "glass");
    const st = verificationState(p, VESSEL_S);
    expect(st).toEqual({ state: "withdrawn", by: "A. Reviewer (fictional)", role: "QA", at: T1, reason: "value_changed" });
    expect(describeVerification(st)).toBe(
      "Verification withdrawn (value changed after verification); was verified by A. Reviewer (fictional) (QA) on 2026-10-02",
    );
  });

  it("is withdrawn when the status changes (established to Unknown, or to Not applicable)", () => {
    const verified = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    expect(verificationState(unk(verified, "comp.vessel_type", "source"), VESSEL_S)).toMatchObject({ state: "withdrawn", reason: "status_changed" });
    expect(verificationState(na(verified, "comp.vessel_type", "source", "Not used (fictional)"), VESSEL_S)).toMatchObject({
      state: "withdrawn",
      reason: "status_changed",
    });
  });

  it("a same-as-source target is withdrawn when the SOURCE value changes, and verified again when it changes back", () => {
    let p = same(recorded(), "comp.vessel_type");
    p = verifyEntry(p, VESSEL_T, REVIEWER);
    expect(verificationState(p, VESSEL_T).state).toBe("verified");
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(verificationState(p, VESSEL_T)).toMatchObject({ state: "withdrawn", reason: "source_changed" });
    expect(describeVerification(verificationState(p, VESSEL_T))).toContain("the source value changed after verification");
    p = v(p, "comp.vessel_type", "source", "stainless_tank");
    expect(verificationState(p, VESSEL_T).state).toBe("verified");
  });

  it("stays verified when the same value is simply re-answered", () => {
    let p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    p = v(p, "comp.vessel_type", "source", "stainless_tank");
    expect(verificationState(p, VESSEL_S).state).toBe("verified");
  });

  it("a verification survives a metadata-only change such as attaching a source", () => {
    const p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    expect(getEntry(p, VESSEL_S)!.verification!.status).toBe("established");
  });
});

describe("what can be verified", () => {
  it("refuses an entry that is not established, naming the reason", () => {
    expect(() => verifyEntry(newProject(), VESSEL_S, REVIEWER)).toThrow(/No entry/);
    const p = recorded();
    const reverted = removeSource(p, getEntry(p, VESSEL_S)!.sourceIds[0]!, ACTOR).project;
    expect(getEntry(reverted, VESSEL_S)!.status).toBe("not_established");
    expect(() => verifyEntry(reverted, VESSEL_S, REVIEWER)).toThrow(/not established/);
  });

  it("refuses an Unknown entry: it is an open information item", () => {
    const p = unk(newProject(), "comp.vessel_type", "source");
    expect(() => verifyEntry(p, VESSEL_S, REVIEWER)).toThrow(VerificationError);
    expect(() => verifyEntry(p, VESSEL_S, REVIEWER)).toThrow(/Unknown/);
  });

  it("allows an established and a Not-applicable entry", () => {
    expect(verificationState(verifyEntry(recorded(), VESSEL_S, REVIEWER), VESSEL_S).state).toBe("verified");
    const n = verifyEntry(na(newProject(), "comp.vessel_type", "source", "Not used (fictional)"), VESSEL_S, REVIEWER);
    expect(verificationState(n, VESSEL_S).state).toBe("verified");
  });

  it("a same-as-source target whose source is Unknown cannot be verified", () => {
    const p = same(unk(newProject(), "comp.vessel_type", "source"), "comp.vessel_type");
    expect(() => verifyEntry(p, VESSEL_T, REVIEWER)).toThrow(/Unknown/);
  });

  it("requires a verifier name", () => {
    expect(() => verifyEntry(recorded(), VESSEL_S, { name: "  ", at: T1 })).toThrow(/name/i);
  });
});

describe("four-eyes: verifying your own entry", () => {
  it("refuses the recorder unless self-verification is confirmed", () => {
    const p = recorded();
    expect(isSelfVerification(p, VESSEL_S, ACTOR.name)).toBe(true);
    expect(isSelfVerification(p, VESSEL_S, REVIEWER.name)).toBe(false);
    expect(() => verifyEntry(p, VESSEL_S, ACTOR)).toThrow(/recorded this entry/);
  });

  it("compares names ignoring case and spacing", () => {
    expect(isSelfVerification(recorded(), VESSEL_S, "  alex   EXAMPLE (fictional) ")).toBe(true);
  });

  it("records the flag on the verification and in every display when confirmed", () => {
    const p = verifyEntry(recorded(), VESSEL_S, ACTOR, { selfVerification: true });
    expect(getEntry(p, VESSEL_S)!.verification).toMatchObject({ by: ACTOR.name, selfVerification: true });
    const st = verificationState(p, VESSEL_S);
    expect(st).toMatchObject({ state: "verified", selfVerification: true });
    expect(describeVerification(st)).toBe("Verified by Alex Example (fictional) (MSAT engineer) on 2026-10-01 (same person as recorder)");
    expect(p.changeLog.at(-1)).toMatchObject({ action: "verify", detail: expect.stringContaining("Self-verification") });
  });

  it("does not flag a different person, even if the flag is passed", () => {
    const p = verifyEntry(recorded(), VESSEL_S, REVIEWER, { selfVerification: true });
    expect(getEntry(p, VESSEL_S)!.verification!.selfVerification).toBeUndefined();
  });

  it("treats the recorder of the SOURCE entry as a recorder of a same-as-source target", () => {
    const p = same(v(newProject(), "comp.vessel_type", "source", "stainless_tank", ACTOR), "comp.vessel_type", OTHER_ACTOR);
    expect(isSelfVerification(p, VESSEL_T, OTHER_ACTOR.name)).toBe(true);
    expect(isSelfVerification(p, VESSEL_T, ACTOR.name)).toBe(true);
    expect(isSelfVerification(p, VESSEL_T, REVIEWER.name)).toBe(false);
  });
});

describe("withdrawing a verification", () => {
  it("requires a reason", () => {
    const p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    expect(() => unverifyEntry(p, VESSEL_S, ACTOR, "   ")).toThrow(/reason/);
    expect(() => unverifyEntry(p, VESSEL_S, ACTOR, "")).toThrow(VerificationError);
  });

  it("removes the verification and logs the reason with before and after", () => {
    const p = unverifyEntry(verifyEntry(recorded(), VESSEL_S, REVIEWER), VESSEL_S, ACTOR, "Source document was superseded (fictional)");
    expect(verificationState(p, VESSEL_S)).toEqual({ state: "unverified" });
    expect(getEntry(p, VESSEL_S)!.verification).toBeUndefined();
    const ev = p.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "unverify", path: VESSEL_S, detail: "Source document was superseded (fictional)", by: ACTOR.name });
    expect((ev.before as { verification: string }).verification).toContain("Verified by A. Reviewer (fictional)");
    expect((ev.after as { verification: string }).verification).toBe("Unverified");
  });

  it("can also clear an already withdrawn verification", () => {
    let p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(verificationState(p, VESSEL_S).state).toBe("withdrawn");
    p = unverifyEntry(p, VESSEL_S, ACTOR, "Re-checking after the change (fictional)");
    expect(verificationState(p, VESSEL_S).state).toBe("unverified");
  });

  it("refuses when there is nothing to withdraw", () => {
    expect(() => unverifyEntry(recorded(), VESSEL_S, ACTOR, "x")).toThrow(/no verification/);
  });
});

describe("bulk verification", () => {
  function scenario(): Project {
    let p = recorded(); // established (recorded by Alex)
    p = unk(p, "comp.mixer", "source"); // unknown
    p = na(p, "comp.vessel_type", "target", "Not used (fictional)"); // not applicable
    return p;
  }

  it("verifies what can be verified and reports every skipped entry with its reason", () => {
    const p = scenario();
    const refs = [VESSEL_S, VESSEL_T, MIXER_S, "target.uo.compounding.equip.mixer.operatingPrinciple"];
    const r = verifyEntries(p, refs, REVIEWER, {}, "Compounding");
    expect(r.verified).toEqual([VESSEL_S, VESSEL_T]);
    expect(r.skipped.map((s) => s.ref)).toEqual([MIXER_S, "target.uo.compounding.equip.mixer.operatingPrinciple"]);
    expect(r.skipped[0]!.reason).toMatch(/Unknown/);
    expect(r.skipped[1]!.reason).toMatch(/not established|No entry/);
    expect(verificationState(r.project, VESSEL_S).state).toBe("verified");
    expect(verificationState(r.project, MIXER_S).state).toBe("unverified");
  });

  it("skips entries already verified and entries recorded by the verifier, unless self-verification is confirmed", () => {
    const p = verifyEntry(scenario(), VESSEL_T, REVIEWER);
    const plan = planVerification(p, [VESSEL_S, VESSEL_T], ACTOR.name);
    expect(plan.verify).toEqual([]);
    expect(plan.skip.map((s) => s.reason)).toEqual([expect.stringMatching(/Recorded by the verifier/), "Already verified"]);
    const withSelf = planVerification(p, [VESSEL_S, VESSEL_T], ACTOR.name, { selfVerification: true });
    expect(withSelf.verify).toEqual([VESSEL_S]);
  });

  it("logs one verify event per entry and one summary event", () => {
    const before = scenario();
    const r = verifyEntries(before, [VESSEL_S, VESSEL_T, MIXER_S], REVIEWER, {}, "Compounding");
    const added = r.project.changeLog.slice(before.changeLog.length);
    expect(added.map((e) => e.action)).toEqual(["verify", "verify", "verify_many"]);
    expect(added.at(-1)).toMatchObject({ detail: "Compounding: 2 verified, 1 skipped", after: { verified: 2, skipped: 1 } });
  });

  it("does not mutate the project it was given", () => {
    const p = scenario();
    const snapshot = JSON.stringify(p);
    verifyEntries(p, [VESSEL_S], REVIEWER);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("verification in the change log", () => {
  it("records before and after for a verification, including the value verified", () => {
    const p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    const ev = p.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "verify", path: VESSEL_S, by: REVIEWER.name, at: T1 });
    expect(ev.before).toEqual({ verification: "Unverified" });
    expect(ev.after).toMatchObject({ status: "established", value: "stainless_tank", verification: expect.stringContaining("Verified by A. Reviewer") });
  });
});

describe("schema 1.2.0 features", () => {
  it("is superseded by the current version", () => {
    expect(SCHEMA_VERSION).toBe("1.5.0");
    expect(newProject().schemaVersion).toBe("1.5.0");
  });

  it("round-trips a project with verified, withdrawn and self-verified entries through JSON", () => {
    let p = verifyEntry(recorded(), VESSEL_S, REVIEWER);
    p = v(p, "comp.vessel_type", "source", "glass"); // withdrawn
    p = verifyEntry(v(p, "comp.mixer", "source", "rocking"), MIXER_S, ACTOR, { selfVerification: true });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
    expect(verificationState(back, VESSEL_S).state).toBe("withdrawn");
    expect(verificationState(back, MIXER_S)).toMatchObject({ state: "verified", selfVerification: true });
  });

  it("migrates 1.0.0 through 1.1.0 and 1.2.0 to the current version", () => {
    const old = json(verifyEntry(recorded(), VESSEL_S, REVIEWER));
    old.schemaVersion = "1.0.0";
    delete old.custom;
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.5.0");
    expect(p.custom).toEqual({ unitOperations: [], items: [] });
    expect(verificationState(p, VESSEL_S).state).toBe("verified");
  });

  it("migrates 1.1.0 and derives selfVerification only where verifier and recorder share a name", () => {
    let p = verifyEntry(recorded(), VESSEL_S, ACTOR, { selfVerification: true });
    p = verifyEntry(v(p, "comp.mixer", "source", "rocking"), MIXER_S, REVIEWER);
    const old = json(p);
    old.schemaVersion = "1.1.0";
    // A 1.1.0 file knew nothing of the flag, the role-less status snapshot or the sameAsSource marker.
    for (const ref of [VESSEL_S, MIXER_S]) {
      const parts = ref.split(".");
      const e = old.processes.source.unitOperations.compounding.collections.equip[parts[4]!].fields[parts[5]!];
      delete e.verification.selfVerification;
    }
    const migrated = parseProject(old);
    expect(migrated.schemaVersion).toBe("1.5.0");
    expect(getEntry(migrated, VESSEL_S)!.verification!.selfVerification).toBe(true);
    expect(getEntry(migrated, MIXER_S)!.verification!.selfVerification).toBeUndefined();
  });

  it("loads an old verification that has only by, at and fingerprint", () => {
    const old = json(verifyEntry(recorded(), VESSEL_S, REVIEWER));
    old.schemaVersion = "1.1.0";
    const e = old.processes.source.unitOperations.compounding.collections.equip.vessel.fields.type;
    e.verification = { by: e.verification.by, at: e.verification.at, fingerprint: e.verification.fingerprint };
    const p = parseProject(old);
    expect(verificationState(p, VESSEL_S)).toEqual({ state: "verified", by: "A. Reviewer (fictional)", at: T1 });
  });

  it("rejects a malformed verification record", () => {
    const bad = json(verifyEntry(recorded(), VESSEL_S, REVIEWER));
    bad.processes.source.unitOperations.compounding.collections.equip.vessel.fields.type.verification.selfVerification = "yes";
    expect(() => parseProject(bad)).toThrow(ImportError);
    const bad2 = json(verifyEntry(recorded(), VESSEL_S, REVIEWER));
    bad2.processes.source.unitOperations.compounding.collections.equip.vessel.fields.type.verification.status = "approved";
    expect(() => parseProject(bad2)).toThrow(ImportError);
    const bad3 = json(verifyEntry(recorded(), VESSEL_S, REVIEWER));
    delete bad3.processes.source.unitOperations.compounding.collections.equip.vessel.fields.type.verification.fingerprint;
    expect(() => parseProject(bad3)).toThrow(ImportError);
  });

  it("the demonstration project (with its verifications) survives a JSON round trip", () => {
    const demo = buildDemoProject(realContent, demos["arx-217"]);
    expect(parseProject(JSON.parse(JSON.stringify(demo)))).toEqual(demo);
  });
});
