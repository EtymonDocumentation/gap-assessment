import { describe, expect, it } from "vitest";
import {
  allEntries,
  contentPathOf,
  emptyProject,
  fingerprintResolved,
  fnv1a,
  fullRef,
  getEntry,
  ImportError,
  isEntry,
  isValidContentPath,
  newId,
  parseProject,
  parseRef,
  PathError,
  pathMatches,
  putEntry,
  removeSource,
  resolveEntry,
  SCHEMA_VERSION,
  sideOfRef,
  sourceById,
  stableStringify,
  verificationState,
  verifyEntry,
  type Entry,
  type Project,
} from "@gap/process-model";
import { buildDemoProject } from "@gap/engine";
import { content as realContent, demos } from "../../../content/index";
import { ACTOR, DOC_A, OTHER_ACTOR, T0, T1, kit, q, rng, withEntry } from "../../engine/test/helpers";

const { v, par, unk, same, na, pair, base, newProject, run, gap } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";
const PUMP_S = "source.uo.aseptic_filling.equip.filler.operatingPrinciple";
const PUMP_KEY = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";

const interviewSourceId = (p: Project, ref: string) => {
  const e = getEntry(p, ref)!;
  return e.sourceIds.find((id) => sourceById(p, id)!.type === "interview_answer")!;
};

describe("resolveEntry", () => {
  it("reports an absent entry as not_established", () => {
    expect(resolveEntry(newProject(), VESSEL_S)).toEqual({ ref: VESSEL_S, status: "not_established", entryIds: [], sameAsSource: false });
  });

  it("reports an absent target entry whose parent containers do not exist", () => {
    expect(resolveEntry(newProject(), "target.uo.nothing.equip.x.y").status).toBe("not_established");
    expect(resolveEntry(newProject(), "scope.modality").status).toBe("not_established");
  });

  it("resolves an established value", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const r = resolveEntry(p, VESSEL_S);
    expect(r).toMatchObject({ ref: VESSEL_S, status: "established", value: "stainless_tank", sameAsSource: false });
    expect(r.entryIds).toEqual([getEntry(p, VESSEL_S)!.id]);
    expect(r.justification).toBeUndefined();
  });

  it("resolves an unknown entry with no value", () => {
    const r = resolveEntry(unk(newProject(), "comp.vessel_type", "source"), VESSEL_S);
    expect(r.status).toBe("unknown");
    expect("value" in r).toBe(false);
  });

  it("resolves a not_applicable entry with its justification", () => {
    const r = resolveEntry(na(newProject(), "comp.vessel_type", "source", "Not used (fictional)"), VESSEL_S);
    expect(r).toMatchObject({ status: "not_applicable", justification: "Not used (fictional)", sameAsSource: false });
    expect("value" in r).toBe(false);
  });

  it("resolves a quantity value to a plain object", () => {
    const p = v(newProject(), "comp.vessel_capacity", "source", q(100, "L"));
    expect(resolveEntry(p, "source.uo.compounding.equip.vessel.capacity").value).toEqual(q(100, "L"));
  });

  it("follows sameAsSource live to the source entry and lists both entry ids", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    const r = resolveEntry(p, VESSEL_T);
    expect(r).toMatchObject({ status: "established", value: "stainless_tank", sameAsSource: true });
    expect(r.entryIds).toEqual([getEntry(p, VESSEL_T)!.id, getEntry(p, VESSEL_S)!.id]);
    // The stored target entry carries no value of its own.
    expect(getEntry(p, VESSEL_T)!.value).toBeUndefined();
  });

  it("re-resolves when the source answer changes", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(resolveEntry(p, VESSEL_T).value).toBe("glass");
    p = unk(p, "comp.vessel_type", "source");
    expect(resolveEntry(p, VESSEL_T)).toMatchObject({ status: "unknown", sameAsSource: true });
  });

  it("carries the source's not_applicable justification through sameAsSource", () => {
    let p = na(newProject(), "comp.vessel_type", "source", "Not used (fictional)");
    p = same(p, "comp.vessel_type");
    expect(resolveEntry(p, VESSEL_T)).toMatchObject({ status: "not_applicable", justification: "Not used (fictional)", sameAsSource: true });
  });

  it("is not_established (still flagged sameAsSource) when the source entry is missing", () => {
    const p = same(newProject(), "comp.vessel_type");
    const r = resolveEntry(p, VESSEL_T);
    expect(r).toMatchObject({ status: "not_established", sameAsSource: true });
    expect(r.entryIds).toEqual([getEntry(p, VESSEL_T)!.id]);
    expect("value" in r).toBe(false);
  });

  it("does not chain same-as-source: a source that is itself same-as-source is not_established", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    const broken = structuredClone(p);
    getEntry(broken, VESSEL_S)!.sameAsSource = true;
    expect(resolveEntry(broken, VESSEL_T).status).toBe("not_established");
  });

  it("throws on sameAsSource used on a source-side entry (malformed data)", () => {
    const p = structuredClone(v(newProject(), "comp.vessel_type", "source", "glass"));
    getEntry(p, VESSEL_S)!.sameAsSource = true;
    expect(() => resolveEntry(p, VESSEL_S)).toThrow(/sameAsSource on non-target entry/);
  });

  it("resolves composite parameter fields independently", () => {
    let p = par(newProject(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: rng(120, 180, "rpm"),
      par: rng(100, 200, "rpm"),
      rangeBasis: "PPQ",
    });
    p = par(p, "comp.mixing_speed", "target", { setPoint: "same", nor: "unknown" });
    expect(resolveEntry(p, "target.uo.compounding.param.mixing_speed.setPoint")).toMatchObject({ status: "established", value: q(150, "rpm") });
    expect(resolveEntry(p, "target.uo.compounding.param.mixing_speed.nor").status).toBe("unknown");
  });
});

describe("fingerprints", () => {
  it("stableStringify sorts keys, drops undefined properties and maps undefined to null", () => {
    expect(stableStringify({ b: 1, a: { d: [2, 1], c: undefined } })).toBe('{"a":{"d":[2,1]},"b":1}');
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("fnv1a is deterministic, 8 hex digits and sensitive to small changes", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c"); // published FNV-1a 32-bit test vector
    expect(fnv1a("foobar")).toBe("bf9cf968"); // published FNV-1a 32-bit test vector
    expect(fnv1a("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("fingerprintResolved ignores key order and entry ids but not status, value or justification", () => {
    const base = { ref: "r", entryIds: ["a"], sameAsSource: false };
    const a = fingerprintResolved({ ...base, status: "established", value: { min: q(1, "L"), max: q(2, "L") } });
    const b = fingerprintResolved({ ...base, entryIds: ["z", "y"], status: "established", value: { max: q(2, "L"), min: q(1, "L") } });
    expect(a).toBe(b);
    expect(fingerprintResolved({ ...base, status: "established", value: q(1, "L") })).not.toBe(fingerprintResolved({ ...base, status: "established", value: q(1, "mL") }));
    expect(fingerprintResolved({ ...base, status: "unknown" })).not.toBe(fingerprintResolved({ ...base, status: "not_applicable", justification: "x" }));
    expect(fingerprintResolved({ ...base, status: "not_applicable", justification: "x" })).not.toBe(
      fingerprintResolved({ ...base, status: "not_applicable", justification: "y" }),
    );
  });
});

describe("verification", () => {
  it("is unverified until someone verifies, and also for missing entries", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    expect(verificationState(p, VESSEL_S)).toEqual({ state: "unverified" });
    expect(verificationState(p, VESSEL_T)).toEqual({ state: "unverified" });
  });

  it("verifyEntry records who and when, and the state becomes verified", () => {
    const p = verifyEntry(v(newProject(), "comp.vessel_type", "source", "stainless_tank"), VESSEL_S, OTHER_ACTOR);
    expect(verificationState(p, VESSEL_S)).toEqual({ state: "verified", by: "Sam Sample (fictional)", at: T1 });
    expect(getEntry(p, VESSEL_S)!.verification!.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(p.changeLog.at(-1)).toMatchObject({ action: "verify", path: VESSEL_S, by: "Sam Sample (fictional)", at: T1 });
  });

  it("does not mutate the project it was given", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const snapshot = JSON.stringify(p);
    verifyEntry(p, VESSEL_S, OTHER_ACTOR);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("is withdrawn (keeping who and when) when the value changes after verification", () => {
    let p = verifyEntry(v(newProject(), "comp.vessel_type", "source", "stainless_tank"), VESSEL_S, OTHER_ACTOR);
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(verificationState(p, VESSEL_S)).toEqual({ state: "withdrawn", by: "Sam Sample (fictional)", at: T1, reason: "value_changed" });
  });

  it("stays verified when the same value is simply re-answered", () => {
    let p = verifyEntry(v(newProject(), "comp.vessel_type", "source", "stainless_tank"), VESSEL_S, OTHER_ACTOR);
    p = v(p, "comp.vessel_type", "source", "stainless_tank");
    expect(getEntry(p, VESSEL_S)!.revision).toBe(2);
    expect(verificationState(p, VESSEL_S).state).toBe("verified");
  });

  it("is withdrawn when the status changes, for example to Unknown", () => {
    let p = verifyEntry(v(newProject(), "comp.vessel_type", "source", "stainless_tank"), VESSEL_S, OTHER_ACTOR);
    p = unk(p, "comp.vessel_type", "source");
    expect(verificationState(p, VESSEL_S).state).toBe("withdrawn");
  });

  it("refuses to verify an Unknown entry (an open information item) but can verify a Not-applicable one", () => {
    expect(() => verifyEntry(unk(newProject(), "comp.vessel_type", "source"), VESSEL_S, OTHER_ACTOR)).toThrow(/Unknown/);
    const n = verifyEntry(na(newProject(), "comp.vessel_type", "source", "Not used (fictional)"), VESSEL_S, OTHER_ACTOR);
    expect(verificationState(n, VESSEL_S).state).toBe("verified");
  });

  it("a verified sameAsSource target is withdrawn when the source value changes, and verified again if it changes back", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    p = verifyEntry(p, VESSEL_T, OTHER_ACTOR);
    expect(verificationState(p, VESSEL_T).state).toBe("verified");
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(verificationState(p, VESSEL_T)).toEqual({ state: "withdrawn", by: "Sam Sample (fictional)", at: T1, reason: "source_changed" });
    // Verification is judged against the resolved value, so reverting the source restores it.
    p = v(p, "comp.vessel_type", "source", "stainless_tank");
    expect(verificationState(p, VESSEL_T).state).toBe("verified");
  });

  it("a sameAsSource target whose source answer is removed is withdrawn", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = verifyEntry(same(p, "comp.vessel_type"), VESSEL_T, OTHER_ACTOR);
    p = removeSource(p, interviewSourceId(p, VESSEL_S), ACTOR).project;
    expect(resolveEntry(p, VESSEL_T).status).toBe("not_established");
    expect(verificationState(p, VESSEL_T).state).toBe("withdrawn");
  });

  it("refuses to verify an entry that does not exist or is not established", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    expect(() => verifyEntry(p, VESSEL_T, ACTOR)).toThrow(/No entry at/);
    const reverted = removeSource(p, interviewSourceId(p, VESSEL_S), ACTOR).project;
    expect(getEntry(reverted, VESSEL_S)!.status).toBe("not_established");
    expect(() => verifyEntry(reverted, VESSEL_S, ACTOR)).toThrow(/not established/);
  });
});

describe("removeSource", () => {
  it("reverts an entry whose only source is removed: value dropped, revision bumped, listed in `reverted`", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const before = getEntry(p, VESSEL_S)!;
    const { project, reverted } = removeSource(p, before.sourceIds[0]!, OTHER_ACTOR);
    expect(reverted).toEqual([VESSEL_S]);
    const e = getEntry(project, VESSEL_S)!;
    expect(e.status).toBe("not_established");
    expect(e.sourceIds).toEqual([]);
    expect("value" in e).toBe(false);
    expect("sameAsSource" in e).toBe(false);
    expect("justification" in e).toBe(false);
    expect(e.revision).toBe(before.revision + 1);
    expect(e.id).toBe(before.id);
    expect(resolveEntry(project, VESSEL_S).status).toBe("not_established");
    expect(project.sources).toEqual([]);
  });

  it("drops the answer record of the removed source", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = v(p, "comp.mixer", "source", "rocking");
    expect(p.answers).toHaveLength(2);
    const { project } = removeSource(p, interviewSourceId(p, VESSEL_S), ACTOR);
    expect(project.answers.map((a) => a.questionId)).toEqual(["comp.mixer"]);
    expect(project.sources).toHaveLength(1);
  });

  it("writes revert_on_source_removal (with the prior value) and remove_source entries to the change log", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const src = p.sources[0]!;
    const { project } = removeSource(p, src.id, OTHER_ACTOR);
    const added = project.changeLog.slice(p.changeLog.length);
    expect(added).toMatchObject([
      {
        at: T1,
        by: "Sam Sample (fictional)",
        action: "revert_on_source_removal",
        path: VESSEL_S,
        before: { status: "established", value: "stainless_tank" },
        after: { status: "not_established" },
      },
      { at: T1, by: "Sam Sample (fictional)", action: "remove_source", detail: `interview_answer: ${src.label}`, before: { id: src.id }, after: { citingEntries: 1, reverted: 1 } },
    ]);
  });

  it("keeps an entry established when another source still supports it, and does not list it", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A]);
    const interview = interviewSourceId(p, VESSEL_S);
    const doc = getEntry(p, VESSEL_S)!.sourceIds.find((id) => id !== interview)!;
    const { project, reverted } = removeSource(p, interview, ACTOR);
    expect(reverted).toEqual([]);
    const e = getEntry(project, VESSEL_S)!;
    expect(e).toMatchObject({ status: "established", value: "stainless_tank", sourceIds: [doc], revision: 1 });
    expect(project.changeLog.map((c) => c.action)).not.toContain("revert_on_source_removal");
    expect(project.changeLog.at(-1)!.action).toBe("remove_source");
    // The remaining source can be removed next, which now reverts.
    const second = removeSource(project, doc, ACTOR);
    expect(second.reverted).toEqual([VESSEL_S]);
    expect(getEntry(second.project, VESSEL_S)!.status).toBe("not_established");
  });

  it("removing a shared document source reverts only entries that had no other support", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A]);
    p = v(p, "comp.mixer", "source", "rocking", ACTOR, [DOC_A]);
    const doc = p.sources.find((s) => s.type === "document_reference")!;
    const { project, reverted } = removeSource(p, doc.id, ACTOR);
    expect(reverted).toEqual([]);
    for (const e of allEntries(project)) expect(e.sourceIds).not.toContain(doc.id);
    expect(getEntry(project, VESSEL_S)!.status).toBe("established");
    expect(project.answers).toHaveLength(2); // answers cite the interview source, not the document
  });

  it("reverts an Unknown entry and a Not-applicable entry (dropping the justification)", () => {
    let p = unk(newProject(), "comp.vessel_type", "source");
    p = na(p, "comp.mixer", "source", "Not used (fictional)");
    const a = removeSource(p, interviewSourceId(p, VESSEL_S), ACTOR);
    expect(a.reverted).toEqual([VESSEL_S]);
    const b = removeSource(a.project, interviewSourceId(a.project, "source.uo.compounding.equip.mixer.operatingPrinciple"), ACTOR);
    expect(b.reverted).toEqual(["source.uo.compounding.equip.mixer.operatingPrinciple"]);
    const e = getEntry(b.project, "source.uo.compounding.equip.mixer.operatingPrinciple")!;
    expect(e.status).toBe("not_established");
    expect(e.justification).toBeUndefined();
  });

  it("reverts every field written by one composite answer, and lists each", () => {
    const p = par(newProject(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: "unknown",
      par: rng(100, 200, "rpm"),
      rangeBasis: "PPQ",
    });
    const { project, reverted } = removeSource(p, p.sources[0]!.id, ACTOR);
    const prefix = "source.uo.compounding.param.mixing_speed.";
    expect([...reverted].sort()).toEqual(["classification", "nor", "par", "rangeBasis", "setPoint"].map((f) => prefix + f).sort());
    for (const r of reverted) expect(getEntry(project, r)!.status).toBe("not_established");
  });

  it("leaves a target sameAsSource entry in place; it now resolves to not_established", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    const { project, reverted } = removeSource(p, interviewSourceId(p, VESSEL_S), ACTOR);
    expect(reverted).toEqual([VESSEL_S]);
    expect(getEntry(project, VESSEL_T)).toMatchObject({ status: "established", sameAsSource: true });
    expect(resolveEntry(project, VESSEL_T)).toMatchObject({ status: "not_established", sameAsSource: true });
  });

  it("removing a superseded source only drops its old answer record", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const old = p.sources[0]!.id;
    p = v(p, "comp.vessel_type", "source", "glass");
    const { project, reverted } = removeSource(p, old, ACTOR);
    expect(reverted).toEqual([]);
    expect(getEntry(project, VESSEL_S)).toMatchObject({ status: "established", value: "glass" });
    expect(project.answers).toHaveLength(1);
  });

  it("scoping entries revert too", () => {
    const p = v(newProject(), "scope.modality", "shared", "mab");
    const { project, reverted } = removeSource(p, p.sources[0]!.id, ACTOR);
    expect(reverted).toEqual(["scope.modality"]);
    expect(project.scope["modality"]!.status).toBe("not_established");
  });

  it("throws for an unknown source id and leaves the input untouched", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const snapshot = JSON.stringify(p);
    expect(() => removeSource(p, "src-nope", ACTOR)).toThrow(/Unknown source src-nope/);
    removeSource(p, p.sources[0]!.id, ACTOR);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("after removal, assess turns the gap into information_required and records an open item", () => {
    const p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    const before = gap(run(p), PUMP_KEY);
    expect(before.category).toBe("different_principle");

    const { project, reverted } = removeSource(p, interviewSourceId(p, PUMP_S), ACTOR);
    expect(reverted).toEqual([PUMP_S]);
    const after = run(project);
    const g = gap(after, PUMP_KEY);
    expect(g.category).toBe("information_required");
    expect(g.regulatoryNote).toBeUndefined(); // information-required rows are never flagged
    expect(after.openItems.map((o) => o.ref)).toContain(PUMP_S);
  });

  it("removing the target's source gives the same result on the other side", () => {
    const p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    const { project } = removeSource(p, interviewSourceId(p, "target.uo.aseptic_filling.equip.filler.operatingPrinciple"), ACTOR);
    expect(gap(run(project), PUMP_KEY).category).toBe("information_required");
  });

  it("removing a non-supporting answer leaves the gap as it was", () => {
    const p = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    const scoping = p.answers.find((a) => a.questionId === "scope.program")!.sourceId;
    const { project, reverted } = removeSource(p, scoping, ACTOR);
    expect(reverted).toEqual(["scope.program"]);
    expect(gap(run(project), PUMP_KEY).category).toBe("different_principle");
  });
});

describe("paths and entry helpers", () => {
  it("parses each reference form", () => {
    expect(parseRef("scope.modality")).toEqual({ side: "shared", kind: "scope", key: "modality" });
    expect(parseRef("source.site.barrier")).toEqual({ side: "source", kind: "site", field: "barrier" });
    expect(parseRef("target.uo.compounding.presence")).toEqual({ side: "target", kind: "uo", uo: "compounding", field: "presence" });
    expect(parseRef(VESSEL_S)).toEqual({ side: "source", kind: "item", uo: "compounding", coll: "equip", item: "vessel", field: "type" });
  });

  it("rejects malformed references", () => {
    for (const bad of ["", "modality", "scope", "scope.a.b", "other.site.x", "source.site", "source.uo.compounding", "source.uo.a.b.c", "source.uo.a.nope.item.field", "source.site.a.b"]) {
      expect(() => parseRef(bad), bad).toThrow(PathError);
    }
  });

  it("fullRef prefixes the side, leaves scope paths alone and demands a side otherwise", () => {
    expect(fullRef("source", "uo.compounding.presence")).toBe("source.uo.compounding.presence");
    expect(fullRef("shared", "scope.modality")).toBe("scope.modality");
    expect(fullRef("target", "scope.modality")).toBe("scope.modality");
    expect(() => fullRef("shared", "uo.compounding.presence")).toThrow(PathError);
  });

  it("sideOfRef and contentPathOf", () => {
    expect(sideOfRef(VESSEL_T)).toBe("target");
    expect(sideOfRef("scope.modality")).toBe("shared");
    expect(contentPathOf(VESSEL_S)).toBe("uo.compounding.equip.vessel.type");
    expect(contentPathOf("target.site.barrier")).toBe("site.barrier");
    expect(contentPathOf("scope.modality")).toBe("scope.modality");
  });

  it("isValidContentPath accepts side-less paths and rejects the rest", () => {
    expect(isValidContentPath("uo.compounding.equip.vessel.type")).toBe(true);
    expect(isValidContentPath("site.barrier")).toBe(true);
    expect(isValidContentPath("scope.modality")).toBe(true);
    expect(isValidContentPath("uo.compounding.equip.vessel")).toBe(false);
    expect(isValidContentPath("uo.compounding.widgets.vessel.type")).toBe(false);
    expect(isValidContentPath("")).toBe(false);
  });

  it("pathMatches lets * match exactly one segment", () => {
    expect(pathMatches("uo.*.presence", "uo.compounding.presence")).toBe(true);
    expect(pathMatches("uo.*.param.*.setPoint", "uo.compounding.param.mixing_speed.setPoint")).toBe(true);
    expect(pathMatches("uo.*.param.*.setPoint", "uo.compounding.equip.mixing_speed.setPoint")).toBe(false);
    expect(pathMatches("uo.*.param.*.setPoint", "uo.compounding.param.setPoint")).toBe(false); // segment count differs
    expect(pathMatches("uo.compounding.*", "uo.compounding.presence")).toBe(true);
    expect(pathMatches("uo.compounding.*", "uo.compounding.a.b")).toBe(false);
    expect(pathMatches("uo.compounding.presence", "uo.filling.presence")).toBe(false);
  });

  it("putEntry creates containers on demand and replaces existing entries; getEntry reads them back", () => {
    const p = emptyProject({ title: "x", actor: ACTOR, contentRefs: kit.content.versions });
    expect(p.meta).toMatchObject({ title: "x", createdAt: T0, createdBy: "Alex Example (fictional)" });
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.settings.entrySequence).toBe("paired");
    const e = (path: string, value: string): Entry => ({ id: `e-${path}`, path, status: "established", value, sourceIds: ["s"], recordedBy: "x", recordedAt: T0, revision: 1 });
    putEntry(p, e("scope.k", "1"));
    putEntry(p, e("target.site.barrier", "2"));
    putEntry(p, e("source.uo.new_uo.presence", "3"));
    putEntry(p, e("source.uo.new_uo.equip.thing.type", "4"));
    putEntry(p, e("source.uo.new_uo.equip.thing.type", "5"));
    expect(getEntry(p, "scope.k")!.value).toBe("1");
    expect(getEntry(p, "target.site.barrier")!.value).toBe("2");
    expect(getEntry(p, "source.uo.new_uo.presence")!.value).toBe("3");
    expect(getEntry(p, "source.uo.new_uo.equip.thing.type")!.value).toBe("5");
    expect(p.processes.source.unitOperations["new_uo"]).toMatchObject({ key: "new_uo", label: "new_uo", sequence: 999 });
    expect(p.processes.source.unitOperations["new_uo"]!.collections.equip["thing"]).toMatchObject({ key: "thing", label: "thing" });
    expect(getEntry(p, "source.uo.other.presence")).toBeUndefined();
    expect(getEntry(p, "source.uo.new_uo.equip.nothing.type")).toBeUndefined();
    expect([...allEntries(p)].map((x) => x.value).sort()).toEqual(["1", "2", "3", "5"]);
  });

  it("newId makes distinct prefixed ids; sourceById and isEntry", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("ent")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^ent-[0-9a-z]+$/);
    const p = v(newProject(), "comp.vessel_type", "source", "glass");
    expect(sourceById(p, p.sources[0]!.id)).toBe(p.sources[0]);
    expect(sourceById(p, "nope")).toBeUndefined();
    expect(isEntry(getEntry(p, VESSEL_S))).toBe(true);
    expect(isEntry({ status: "x" })).toBe(false);
    expect(isEntry(null)).toBe(false);
    expect(isEntry("entry")).toBe(false);
  });

  it("withEntry (test helper) inserts a number value that resolves as written", () => {
    const p = withEntry(newProject(), "source.site.count", 7);
    expect(resolveEntry(p, "source.site.count")).toMatchObject({ status: "established", value: 7 });
  });
});

describe("parseProject", () => {
  const demo = buildDemoProject(realContent, demos["arx-217"]);
  const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("round-trips the demo project through JSON without loss", () => {
    expect(demo.sources.length).toBeGreaterThan(50);
    const parsed = parseProject(json(demo));
    expect(parsed).toEqual(json(demo));
  });

  it("round-trips an empty project and a hand-built one with overlays and confirmations", () => {
    const empty = newProject();
    expect(parseProject(json(empty))).toEqual(json(empty));
    const p = structuredClone(pair(base(), "fill.pump", "rotary_piston", "peristaltic"));
    p.gapOverlays.push({ gapKey: PUMP_KEY, status: "in_progress", owner: "Owner (fictional)", severityOverride: { value: "medium", justification: "Because (fictional)", by: "A", at: T0 } });
    p.interview.confirmations.push({ sectionId: "site", side: "both", by: "A", at: T0 });
    expect(parseProject(json(p))).toEqual(json(p));
  });

  it("does not mutate its input", () => {
    const raw = json(demo);
    const snapshot = JSON.stringify(raw);
    parseProject(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  const mutated = (edit: (raw: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const raw = json(pair(base(), "fill.pump", "rotary_piston", "peristaltic"));
    edit(raw);
    return raw;
  };
  const issuesOf = (raw: unknown): string[] => {
    try {
      parseProject(raw);
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      return (e as ImportError).issues;
    }
    throw new Error("parseProject accepted a bad project");
  };

  it("rejects an established entry with no source", () => {
    const raw = mutated((r) => { r.scope.modality.sourceIds = []; });
    const issues = issuesOf(raw);
    expect(issues.some((i) => i.includes("scope.modality") && i.includes("Established entry scope.modality has no source"))).toBe(true);
  });

  it("rejects an established entry with no value and no sameAsSource", () => {
    const raw = mutated((r) => { delete r.scope.modality.value; });
    expect(issuesOf(raw).join("\n")).toContain("Established entry scope.modality has no value");
  });

  it("accepts an established sameAsSource entry that has no value of its own", () => {
    const raw = mutated((r) => {
      const t = r.processes.target.unitOperations.aseptic_filling.collections.equip.filler.fields.operatingPrinciple;
      delete t.value;
      t.sameAsSource = true;
    });
    expect(() => parseProject(raw)).not.toThrow();
  });

  it("rejects a value on an entry that is not established", () => {
    const raw = mutated((r) => { r.scope.modality.status = "unknown"; });
    expect(issuesOf(raw).join("\n")).toContain("has a value but status unknown");
  });

  it("rejects not_applicable without a justification (missing, empty or blank)", () => {
    for (const justification of [undefined, "", "   "]) {
      const raw = mutated((r) => {
        const e = r.scope.modality;
        delete e.value;
        e.status = "not_applicable";
        if (justification !== undefined) e.justification = justification;
      });
      expect(issuesOf(raw).join("\n"), String(justification)).toContain("Not-applicable entry scope.modality needs a justification");
    }
  });

  it("accepts not_applicable with a justification", () => {
    const raw = mutated((r) => {
      const e = r.scope.modality;
      delete e.value;
      e.status = "not_applicable";
      e.justification = "Does not apply (fictional)";
    });
    expect(parseProject(raw).scope["modality"]!.status).toBe("not_applicable");
  });

  it("rejects a severity override without a justification", () => {
    const raw = mutated((r) => {
      r.gapOverlays.push({ gapKey: "k", status: "open", severityOverride: { value: "low", justification: "  ", by: "A", at: T0 } });
    });
    expect(issuesOf(raw).join("\n")).toContain("gapOverlays.0.severityOverride.justification");
  });

  it("rejects bad enum values, non-finite quantities and wrong types, naming the path", () => {
    expect(issuesOf(mutated((r) => { r.scope.modality.status = "bogus"; })).join("\n")).toContain("scope.modality.status");
    expect(issuesOf(mutated((r) => { r.settings.entrySequence = "random"; })).join("\n")).toContain("settings.entrySequence");
    expect(issuesOf(mutated((r) => { r.sources[0].type = "magic"; })).join("\n")).toContain("sources.0.type");
    expect(issuesOf(mutated((r) => { r.scope.modality.revision = -1; })).join("\n")).toContain("scope.modality.revision");
    expect(issuesOf(mutated((r) => { r.meta = "nope"; })).join("\n")).toContain("meta");
    // A malformed quantity must be rejected, not silently read as an empty range.
    for (const bad of [{ value: null, unit: "L" }, { value: 5 }, { value: "5", unit: "L" }, { value: 5, unit: "" }]) {
      const withBadQuantity = json(v(newProject(), "comp.vessel_capacity", "source", q(1, "L")));
      withBadQuantity.processes.source.unitOperations.compounding.collections.equip.vessel.fields.capacity.value = bad;
      expect(issuesOf(withBadQuantity).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    const withInfinity = structuredClone(v(newProject(), "comp.vessel_capacity", "source", q(1, "L")));
    (getEntry(withInfinity, "source.uo.compounding.equip.vessel.capacity")!.value as { value: number }).value = Number.POSITIVE_INFINITY;
    expect(() => parseProject(withInfinity)).toThrow(ImportError);
  });

  it("reports at most 20 issues", () => {
    const raw = mutated((r) => {
      for (const e of Object.values(r.scope) as Record<string, any>[]) e.sourceIds = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (let i = 0; i < 30; i++) r.scope[`extra${i}`] = { ...r.scope.modality, id: `x${i}`, path: `scope.extra${i}`, sourceIds: [] };
    });
    const issues = issuesOf(raw);
    expect(issues.length).toBe(20);
  });

  it("rejects an unsupported or missing schema version", () => {
    const old = mutated((r) => { r.schemaVersion = "0.9.0"; });
    expect(() => parseProject(old)).toThrow(/Unsupported schema version 0\.9\.0 \(this build reads 1.5.0\)/);
    const future = mutated((r) => { r.schemaVersion = "2.0.0"; });
    expect(() => parseProject(future)).toThrow(ImportError);
    const none = mutated((r) => { delete r.schemaVersion; });
    expect(() => parseProject(none)).toThrow(/no schemaVersion/);
    expect(() => parseProject({ ...json(demo), schemaVersion: "" })).toThrow(/no schemaVersion/);
    expect(() => parseProject({ ...json(demo), schemaVersion: 1 })).toThrow(/Unsupported schema version 1 /);
  });

  it("throws ImportError (never another error type) on garbage", () => {
    for (const garbage of [null, undefined, "", "hello", "{}", 42, true, [], {}, { schemaVersion: SCHEMA_VERSION }, { schemaVersion: SCHEMA_VERSION, meta: {} }, [1, 2, 3]]) {
      let thrown: unknown;
      try {
        parseProject(garbage);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, JSON.stringify(garbage)).toBeInstanceOf(ImportError);
    }
  });

  it("gives a plain message for non-objects and lists issues for a malformed project", () => {
    expect(() => parseProject("hello")).toThrow("Not a project file");
    expect(() => parseProject(null)).toThrow("Not a project file");
    try {
      parseProject({ schemaVersion: SCHEMA_VERSION });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      expect((e as ImportError).message).toBe("The project file failed validation");
      expect((e as ImportError).issues.length).toBeGreaterThan(0);
      expect((e as ImportError).issues.some((i) => i.startsWith("meta:"))).toBe(true);
    }
    expect(new ImportError("x").issues).toEqual([]);
  });
});
