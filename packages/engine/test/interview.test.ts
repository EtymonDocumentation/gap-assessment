import { describe, expect, it } from "vitest";
import { AnswerError, applyAnswer, confirmSection, normalizeValue, setEntrySequence, setResponder, type AnswerInput } from "@gap/engine";
import { getEntry, resolveEntry, type Project } from "@gap/process-model";
import { ACTOR, DOC_A, DOC_B, OTHER_ACTOR, T0, T1, composite, content, kit, q, rng } from "./helpers";

const { v, par, unk, same, na, ask, inst, newProject, base } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";

describe("applyAnswer: sources and entries", () => {
  it("creates an interview_answer source carrying the responder and the date", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    expect(p.sources).toHaveLength(1);
    const s = p.sources[0]!;
    expect(s).toMatchObject({
      type: "interview_answer",
      responder: { name: "Alex Example (fictional)", role: "MSAT engineer" },
      date: T0,
    });
    expect(s.label).toBe("Interview answer: Compounding vessel type [SU]");
    expect(s.id).toMatch(/^src-/);
    expect(s.supersededBy).toBeUndefined();
  });

  it("omits the role when the actor has none", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank", OTHER_ACTOR);
    expect(p.sources[0]!.responder).toEqual({ name: "Sam Sample (fictional)" });
    expect(p.sources[0]!.date).toBe(T1);
  });

  it("labels scoping answers as scoping", () => {
    const p = v(newProject(), "scope.program", "shared", "TST-001");
    expect(p.sources[0]!.label).toBe("Interview answer: Program or product code [scoping]");
  });

  it("writes an established entry that cites the new source", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const e = getEntry(p, VESSEL_S)!;
    expect(e).toMatchObject({
      path: VESSEL_S,
      status: "established",
      value: "stainless_tank",
      sourceIds: [p.sources[0]!.id],
      recordedBy: "Alex Example (fictional)",
      recordedAt: T0,
      revision: 1,
    });
    expect(e.id).toMatch(/^ent-/);
  });

  it("creates containers and labels items from the catalog", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const uo = p.processes.source.unitOperations["compounding"]!;
    expect(uo.label).toBe("Pooling, compounding and dilution");
    expect(uo.sequence).toBe(20);
    expect(uo.collections.equip["vessel"]!.label).toBe("Compounding vessel");
  });

  it("records the answer in the answer log and the change log", () => {
    const p = v(newProject(), "comp.vessel_type", "target", "single_use_bag");
    expect(p.answers).toHaveLength(1);
    expect(p.answers[0]).toMatchObject({
      questionId: "comp.vessel_type",
      side: "target",
      kind: "value",
      raw: { kind: "value", value: "single_use_bag" },
      sourceId: p.sources[0]!.id,
      by: "Alex Example (fictional)",
      at: T0,
    });
    expect(p.changeLog).toHaveLength(1);
    expect(p.changeLog[0]).toMatchObject({ action: "answer", path: VESSEL_T, after: { status: "established", value: "single_use_bag" } });
    expect(p.changeLog[0]!.before).toBeUndefined();
  });

  it("does not mutate the project it was given", () => {
    const before = newProject();
    const snapshot = JSON.stringify(before);
    v(before, "comp.vessel_type", "source", "stainless_tank");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("does not change the project when an answer is rejected", () => {
    const before = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const snapshot = JSON.stringify(before);
    expect(() => v(before, "comp.vessel_type", "source", "wooden_barrel")).toThrow(AnswerError);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("applyAnswer: re-answering", () => {
  it("supersedes the previous source and replaces the entry's support", () => {
    const first = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const firstSource = first.sources[0]!;
    const second = v(first, "comp.vessel_type", "source", "glass", OTHER_ACTOR);
    expect(second.sources).toHaveLength(2);
    const [oldS, newS] = second.sources as [typeof firstSource, typeof firstSource];
    expect(oldS.id).toBe(firstSource.id);
    expect(oldS.supersededBy).toBe(newS.id);
    expect(newS.supersededBy).toBeUndefined();
    const e = getEntry(second, VESSEL_S)!;
    expect(e.sourceIds).toEqual([newS.id]);
    expect(e.value).toBe("glass");
    expect(e.recordedBy).toBe("Sam Sample (fictional)");
    expect(e.revision).toBe(2);
    expect(e.id).toBe(getEntry(first, VESSEL_S)!.id); // same entry, new revision
  });

  it("chains supersession across several answers and logs the before/after values", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = v(p, "comp.vessel_type", "source", "glass");
    p = v(p, "comp.vessel_type", "source", "single_use_bag");
    const [s1, s2, s3] = p.sources as [(typeof p.sources)[number], (typeof p.sources)[number], (typeof p.sources)[number]];
    expect(s1.supersededBy).toBe(s2.id);
    expect(s2.supersededBy).toBe(s3.id);
    expect(s3.supersededBy).toBeUndefined();
    expect(p.answers).toHaveLength(3);
    const last = p.changeLog.at(-1)!;
    expect(last.before).toMatchObject({ status: "established", value: "glass" });
    expect(last.after).toMatchObject({ status: "established", value: "single_use_bag" });
    expect(getEntry(p, VESSEL_S)!.revision).toBe(3);
  });

  it("does not supersede an answer on the other side or to another question", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = v(p, "comp.vessel_type", "target", "glass");
    p = v(p, "comp.mixer", "source", "rocking");
    expect(p.sources.every((s) => s.supersededBy === undefined)).toBe(true);
  });

  it("can replace a value with Unknown and back", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = unk(p, "comp.vessel_type", "source");
    expect(getEntry(p, VESSEL_S)).toMatchObject({ status: "unknown" });
    expect(getEntry(p, VESSEL_S)!.value).toBeUndefined();
    p = v(p, "comp.vessel_type", "source", "glass");
    expect(resolveEntry(p, VESSEL_S)).toMatchObject({ status: "established", value: "glass" });
  });
});

describe("applyAnswer: document references", () => {
  it("creates one document_reference source per identifier and attaches it to value entries", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A]);
    const docSources = p.sources.filter((s) => s.type === "document_reference");
    expect(docSources).toHaveLength(1);
    expect(docSources[0]).toMatchObject({ docRef: DOC_A, label: "TEST-DOC-001 Fictional study A", date: T0 });
    const e = getEntry(p, VESSEL_S)!;
    expect(e.sourceIds).toEqual([p.sources.find((s) => s.type === "interview_answer")!.id, docSources[0]!.id]);
  });

  it("dedupes by identifier across answers and across calls", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A, DOC_A]);
    p = v(p, "comp.mixer", "source", "rocking", OTHER_ACTOR, [{ ...DOC_A, title: "A different title for the same identifier" }, DOC_B]);
    const docs = p.sources.filter((s) => s.type === "document_reference");
    expect(docs.map((d) => d.docRef!.identifier)).toEqual(["TEST-DOC-001", "TEST-DOC-002"]);
    expect(docs[0]!.docRef!.title).toBe("Fictional study A"); // the first reference wins
    const docA = docs[0]!.id;
    expect(getEntry(p, VESSEL_S)!.sourceIds).toContain(docA);
    expect(getEntry(p, "source.uo.compounding.equip.mixer.operatingPrinciple")!.sourceIds).toContain(docA);
    expect(getEntry(p, VESSEL_S)!.sourceIds.filter((id) => id === docA)).toHaveLength(1); // listed once even though cited twice in one call
  });

  it("uses the identifier alone as the label when there is no title", () => {
    const p = v(newProject(), "comp.vessel_type", "source", "glass", ACTOR, [{ identifier: "TEST-DOC-009", docType: "Memo" }]);
    expect(p.sources.find((s) => s.type === "document_reference")!.label).toBe("TEST-DOC-009");
  });

  it("does not attach a document to Unknown, Not applicable or Same-as-source entries", () => {
    const withDoc = (input: AnswerInput, side: "source" | "target", prior?: Project): Project =>
      ask(prior ?? newProject(), "comp.vessel_type", side, input, ACTOR, [DOC_A]);
    const unknown = withDoc({ kind: "unknown" }, "source");
    const notApplicable = withDoc({ kind: "not_applicable", justification: "Not used (fictional)" }, "source");
    const sameAs = withDoc({ kind: "same_as_source" }, "target", v(newProject(), "comp.vessel_type", "source", "glass"));
    for (const [p, ref] of [
      [unknown, VESSEL_S],
      [notApplicable, VESSEL_S],
      [sameAs, VESSEL_T],
    ] as const) {
      const e = getEntry(p, ref)!;
      expect(e.sourceIds).toHaveLength(1);
      expect(p.sources.find((s) => s.id === e.sourceIds[0])!.type).toBe("interview_answer");
    }
  });

  it("attaches documents only to the value fields of a composite parameter answer", () => {
    const p = par(newProject(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: "unknown",
      par: rng(100, 200, "rpm"),
      rangeBasis: "characterization",
    }, ACTOR, [DOC_A]);
    const docId = p.sources.find((s) => s.type === "document_reference")!.id;
    const ref = (f: string) => `source.uo.compounding.param.mixing_speed.${f}`;
    expect(getEntry(p, ref("setPoint"))!.sourceIds).toContain(docId);
    expect(getEntry(p, ref("par"))!.sourceIds).toContain(docId);
    expect(getEntry(p, ref("nor"))!.status).toBe("unknown");
    expect(getEntry(p, ref("nor"))!.sourceIds).not.toContain(docId);
  });
});

describe("applyAnswer: kinds of answer", () => {
  it("same_as_source on the target follows the source live", () => {
    let p = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    p = same(p, "comp.vessel_type");
    const e = getEntry(p, VESSEL_T)!;
    expect(e).toMatchObject({ status: "established", sameAsSource: true });
    expect(e.value).toBeUndefined();
    expect(resolveEntry(p, VESSEL_T)).toMatchObject({ status: "established", value: "stainless_tank", sameAsSource: true });
    expect(p.answers.at(-1)).toMatchObject({ kind: "same_as_source", side: "target" });
  });

  it("not_applicable stores a trimmed justification", () => {
    const p = na(newProject(), "comp.vessel_type", "source", "  Vessel not used (fictional)  ");
    expect(getEntry(p, VESSEL_S)).toMatchObject({ status: "not_applicable", justification: "Vessel not used (fictional)" });
  });

  it("a whole-question Unknown on a parameter marks every field unknown", () => {
    const p = unk(newProject(), "comp.mixing_speed", "source");
    for (const f of ["classification", "setPoint", "nor", "par", "rangeBasis"]) {
      expect(getEntry(p, `source.uo.compounding.param.mixing_speed.${f}`)?.status, f).toBe("unknown");
    }
    expect(p.sources).toHaveLength(1); // one source for the whole answer
  });

  it("a whole-question Same-as-source on a target parameter marks every target field", () => {
    let p = par(newProject(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: rng(120, 180, "rpm"),
      par: rng(100, 200, "rpm"),
      rangeBasis: "PPQ",
    });
    p = same(p, "comp.mixing_speed");
    for (const f of ["setPoint", "nor"]) {
      expect(getEntry(p, `target.uo.compounding.param.mixing_speed.${f}`)).toMatchObject({ status: "established", sameAsSource: true });
    }
    expect(getEntry(p, "target.uo.compounding.param.mixing_speed.par")).toBeUndefined(); // not a target field
    expect(resolveEntry(p, "target.uo.compounding.param.mixing_speed.setPoint").value).toEqual(q(150, "rpm"));
  });

  it("a composite answer can mix values, unknowns and same-as-source per field", () => {
    let p = par(newProject(), "comp.mixing_speed", "source", {
      classification: "KPP",
      setPoint: q(150, "rpm"),
      nor: rng(120, 180, "rpm"),
      par: rng(100, 200, "rpm"),
      rangeBasis: "PPQ",
    });
    p = par(p, "comp.mixing_speed", "target", { setPoint: "same", nor: "unknown" });
    expect(getEntry(p, "target.uo.compounding.param.mixing_speed.setPoint")).toMatchObject({ status: "established", sameAsSource: true });
    expect(getEntry(p, "target.uo.compounding.param.mixing_speed.nor")?.status).toBe("unknown");
  });

  it("yes_no answers are stored as booleans", () => {
    const refs = (p: Project, side: "source" | "target") => getEntry(p, `${side}.uo.compounding.presence`)!.value;
    let p = v(newProject(), "comp.presence", "source", "yes");
    p = v(p, "comp.presence", "target", "no");
    expect(refs(p, "source")).toBe(true);
    expect(refs(p, "target")).toBe(false);
    p = v(p, "comp.presence", "source", false);
    p = v(p, "comp.presence", "target", true);
    expect(refs(p, "source")).toBe(false);
    expect(refs(p, "target")).toBe(true);
  });

  it("normalises text, multi-choice and quantity answers", () => {
    let p = v(newProject(), "scope.program", "shared", "  TST-001  ");
    expect(getEntry(p, "scope.program")!.value).toBe("TST-001");
    p = v(p, "scope.markets", "shared", ["us", "eu", "us"]);
    expect(getEntry(p, "scope.markets")!.value).toEqual(["us", "eu"]);
    p = v(p, "comp.vessel_capacity", "source", q(100, "L"));
    expect(getEntry(p, "source.uo.compounding.equip.vessel.capacity")!.value).toEqual(q(100, "L"));
    p = v(p, "comp.mixing_coverage", "source", { min: q(20, "L") });
    expect(getEntry(p, "source.uo.compounding.study.mixing.coverage")!.value).toEqual({ min: q(20, "L") });
  });

  it("stores shared scoping answers under scope.*", () => {
    const p = v(newProject(), "scope.modality", "shared", "mab");
    expect(p.scope["modality"]).toMatchObject({ path: "scope.modality", status: "established", value: "mab" });
  });
});

describe("applyAnswer: rejected answers", () => {
  const rejects = (fn: () => unknown, message?: RegExp) => {
    expect(fn).toThrow(AnswerError);
    if (message) expect(fn).toThrow(message);
  };
  const P = newProject();

  it("rejects an option that is not in the list", () => {
    rejects(() => v(P, "comp.vessel_type", "source", "wooden_barrel"), /Choose one of the options/);
    rejects(() => v(P, "comp.vessel_type", "source", 5), /Choose one of the options/);
    rejects(() => v(P, "comp.vessel_type", "source", ["glass"]), /Choose one of the options/);
  });

  it("rejects bad multi-choice answers", () => {
    rejects(() => v(P, "scope.markets", "shared", []), /at least one/);
    rejects(() => v(P, "scope.markets", "shared", ["us", "mars"]), /at least one/);
    rejects(() => v(P, "scope.markets", "shared", "us"), /at least one/);
  });

  it("rejects a unit that is not allowed for the question", () => {
    rejects(() => v(P, "comp.vessel_capacity", "source", q(100, "kg")), /unit "kg" is not allowed/);
    rejects(() => v(P, "comp.vessel_capacity", "source", q(100, "h")), /not allowed/);
    // A real unit of the right dimension that the question does not list is also refused.
    rejects(() => v(P, "comp.vessel_capacity", "source", q(100, "µL")), /not allowed/);
  });

  it("rejects a bare value for a parameter question instead of copying it into every field", () => {
    rejects(() => v(P, "comp.mixing_speed", "source", q(1, "rpm")), /composite/);
    rejects(() => v(P, "comp.mixing_speed", "target", "anything"), /composite/);
  });

  it("rejects a non-numeric or non-finite quantity", () => {
    rejects(() => v(P, "comp.vessel_capacity", "source", "100 L"), /enter a number/);
    rejects(() => v(P, "comp.vessel_capacity", "source", q(Number.NaN, "L")), /enter a number/);
    rejects(() => v(P, "comp.vessel_capacity", "source", q(Number.POSITIVE_INFINITY, "L")), /enter a number/);
  });

  it("rejects a range whose minimum exceeds its maximum, also across units", () => {
    rejects(() => v(P, "comp.mixing_coverage", "source", rng(80, 20, "L")), /minimum is greater than maximum/);
    rejects(() => v(P, "comp.mixing_coverage", "source", { min: q(1, "L"), max: q(900, "mL") }), /minimum is greater than maximum/);
  });

  it("accepts equal bounds and one-sided ranges, and rejects an empty range", () => {
    expect(() => v(P, "comp.mixing_coverage", "source", rng(50, 50, "L"))).not.toThrow();
    expect(() => v(P, "comp.mixing_coverage", "source", { max: q(50, "L") })).not.toThrow();
    rejects(() => v(P, "comp.mixing_coverage", "source", {}), /at least one bound/);
    rejects(() => v(P, "comp.mixing_coverage", "source", q(5, "L")), /at least one bound/);
  });

  it("rejects a parameter answer that omits a field", () => {
    rejects(
      () => par(P, "comp.mixing_speed", "source", { classification: "KPP", setPoint: q(150, "rpm"), par: rng(100, 200, "rpm"), rangeBasis: "PPQ" }),
      /Answer every field \(missing: Normal operating range \(NOR\)\)/,
    );
    rejects(() => par(P, "comp.mixing_speed", "target", { setPoint: q(150, "rpm") }), /missing: Normal operating range/);
    rejects(() => ask(P, "comp.mixing_speed", "target", { kind: "composite", fields: {} }), /Answer every field/);
  });

  it("rejects bad parameter field values", () => {
    const ok = { classification: "KPP", setPoint: q(150, "rpm"), nor: rng(120, 180, "rpm"), par: rng(100, 200, "rpm"), rangeBasis: "PPQ" } as const;
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, classification: "critical-ish" }), /classification: choose one of the options/);
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, rangeBasis: "hunch" }), /rangeBasis: choose one of the options/);
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, setPoint: q(150, "L") }), /not allowed/);
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, nor: rng(180, 120, "rpm") }), /NOR: minimum is greater than maximum/);
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, par: rng(200, 100, "rpm") }), /PAR/);
    rejects(() => par(P, "comp.mixing_speed", "source", { ...ok, setPoint: "fast" }), /Set point: enter a number/);
  });

  it("rejects same_as_source on the source side", () => {
    rejects(() => ask(P, "comp.vessel_type", "source", { kind: "same_as_source" }), /only available on RU-side paired questions/);
    rejects(() => ask(P, "comp.mixing_speed", "source", { kind: "same_as_source" }), /only available/);
    rejects(
      () => par(P, "comp.mixing_speed", "source", { classification: "same", setPoint: q(1, "rpm"), nor: rng(1, 2, "rpm"), par: rng(1, 2, "rpm"), rangeBasis: "PPQ" }),
      /only available/,
    );
  });

  it("rejects same_as_source where the question does not allow it", () => {
    rejects(() => same(P, "site.name"), /only available/); // sameAsSource: false
    rejects(() => same(P, "comp.procedures"), /only available/); // target-only question, not paired
    rejects(() => ask(P, "scope.modality", "shared", { kind: "same_as_source" }), /only available/);
  });

  it("rejects not_applicable without a justification", () => {
    rejects(() => ask(P, "comp.vessel_type", "source", { kind: "not_applicable", justification: "" }), /requires a justification/);
    rejects(() => na(P, "comp.vessel_type", "source", "   \t "), /requires a justification/);
    rejects(
      () => ask(P, "comp.mixing_speed", "source", { kind: "composite", fields: { classification: { kind: "not_applicable", justification: " " } } }),
      /Answer every field|requires a justification/,
    );
  });

  it("rejects malformed shapes", () => {
    rejects(() => ask(P, "comp.vessel_type", "source", composite({ setPoint: q(1, "rpm") })), /Composite answers are only for parameter questions/);
    rejects(() => v(P, "scope.program", "shared", "   "), /Enter text/);
    rejects(() => v(P, "scope.program", "shared", 42), /Enter text/);
    rejects(() => v(P, "comp.presence", "source", "maybe"), /Answer yes or no/);
    rejects(() => v(P, "comp.mixing_speed", "shared", q(1, "rpm")), /Parameter questions are not shared|composite/);
    rejects(() => ask(P, "comp.mixing_speed", "shared", { kind: "unknown" }), /Parameter questions are not shared/);
  });

  it("normalizeValue validates against the question without touching a project", () => {
    expect(normalizeValue(content, content.questionById.get("comp.presence")!, "yes")).toBe(true);
    expect(() => normalizeValue(content, content.questionById.get("comp.presence")!, "x")).toThrow(AnswerError);
    expect(() => normalizeValue(content, content.questionById.get("comp.batch_size")!, q(1, "L"))).toThrow(/composite/);
  });
});

describe("applyAnswer: verification interplay", () => {
  it("keeps an existing verification record on the entry (it is judged against the value later)", () => {
    const p0 = v(newProject(), "comp.vessel_type", "source", "stainless_tank");
    const withVerification = structuredClone(p0);
    getEntry(withVerification, VESSEL_S)!.verification = { by: "Reviewer (fictional)", at: T1, fingerprint: "stale" };
    const p1 = v(withVerification, "comp.vessel_type", "source", "glass");
    expect(getEntry(p1, VESSEL_S)!.verification).toEqual({ by: "Reviewer (fictional)", at: T1, fingerprint: "stale" });
  });
});

describe("project-level helpers", () => {
  it("setResponder stores the responder and rejects a blank name", () => {
    const p = setResponder(newProject(), { name: "Alex Example (fictional)", role: "MSAT engineer" });
    expect(p.interview.responder).toEqual({ name: "Alex Example (fictional)", role: "MSAT engineer" });
    expect(() => setResponder(newProject(), { name: "  " })).toThrow(AnswerError);
  });

  it("setEntrySequence switches the mode without touching the original", () => {
    const p = newProject();
    const s = setEntrySequence(p, "sequential");
    expect(s.settings.entrySequence).toBe("sequential");
    expect(p.settings.entrySequence).toBe("paired");
  });

  it("confirmSection records one confirmation per section and side, replacing earlier ones", () => {
    let p = confirmSection(newProject(), "site", "both", ACTOR);
    p = confirmSection(p, "site", "both", OTHER_ACTOR);
    p = confirmSection(p, "site", "source", ACTOR);
    expect(p.interview.confirmations).toEqual([
      { sectionId: "site", side: "both", by: "Sam Sample (fictional)", at: T1 },
      { sectionId: "site", side: "source", by: "Alex Example (fictional)", at: T0 },
    ]);
    expect(p.changeLog.filter((c) => c.action === "confirm_section")).toHaveLength(3);
  });

  it("works on a prepared base project (sanity check of the test kit)", () => {
    const p = base();
    expect(inst("comp.presence", "source").key).toBe("comp.presence@source");
    expect(resolveEntry(p, "source.uo.compounding.presence").value).toBe(true);
  });
});
