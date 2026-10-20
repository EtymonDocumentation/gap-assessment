import { describe, expect, it } from "vitest";
import {
  addSource,
  attachSource,
  detachSource,
  getEntry,
  removeSource,
  sourceUsage,
  SourceError,
  updateSource,
  verificationState,
  verifyEntry,
  type Actor,
  type Project,
} from "@gap/process-model";
import {
  assess,
  attachableSources,
  attachToCell,
  detachFromCell,
  filterSourceRows,
  previewDetach,
  previewSourceRemoval,
  sourceRegisterRows,
} from "@gap/engine";
import { ACTOR, DOC_A, DOC_B, OTHER_ACTOR, T1, content, kit } from "./helpers";

const { v, pair, same, base, run } = kit;

const VESSEL_S = "source.uo.compounding.equip.vessel.type";
const VESSEL_T = "target.uo.compounding.equip.vessel.type";
const MIXER_S = "source.uo.compounding.equip.mixer.operatingPrinciple";
const REVIEWER: Actor = { name: "A. Reviewer (fictional)", role: "QA", at: T1 };

const interviewId = (p: Project, ref: string) => getEntry(p, ref)!.sourceIds.find((id) => p.sources.find((s) => s.id === id)!.type === "interview_answer")!;

/** Two compared values: the source vessel type is backed by DOC_A and an interview answer. */
function scenario(): Project {
  let p = base();
  p = v(p, "comp.vessel_type", "source", "stainless_tank", ACTOR, [DOC_A]);
  p = v(p, "comp.vessel_type", "target", "single_use_bag", ACTOR);
  p = v(p, "comp.mixer", "source", "top_entry_impeller", ACTOR);
  p = same(p, "comp.mixer");
  return p;
}

describe("addSource", () => {
  it("adds a document reference with the actor as responder, and logs it", () => {
    const { project, source } = addSource(base(), { type: "document_reference", docRef: DOC_A }, OTHER_ACTOR);
    expect(source).toMatchObject({ type: "document_reference", label: "TEST-DOC-001 Fictional study A", responder: { name: OTHER_ACTOR.name }, date: T1 });
    expect(project.sources.at(-1)).toEqual(source);
    expect(project.changeLog.at(-1)).toMatchObject({ action: "add_source", by: OTHER_ACTOR.name, after: { id: source.id } });
  });

  it("adds a free-text note", () => {
    const { source } = addSource(base(), { type: "user_entry", label: "  Confirmed by phone   (fictional) " }, ACTOR);
    expect(source).toMatchObject({ type: "user_entry", label: "Confirmed by phone (fictional)" });
  });

  it("rejects an empty identifier, an empty document type and an empty note", () => {
    expect(() => addSource(base(), { type: "document_reference", docRef: { ...DOC_A, identifier: "  " } }, ACTOR)).toThrow(/identifier/);
    expect(() => addSource(base(), { type: "document_reference", docRef: { ...DOC_A, docType: "" } }, ACTOR)).toThrow(/document type/);
    expect(() => addSource(base(), { type: "user_entry", label: " " }, ACTOR)).toThrow(SourceError);
  });

  it("rejects a duplicate of the same type, identifier and version (ignoring case and spacing) but allows a new version", () => {
    const { project } = addSource(base(), { type: "document_reference", docRef: DOC_A }, ACTOR);
    expect(() => addSource(project, { type: "document_reference", docRef: { ...DOC_A, identifier: "  test-doc-001 " } }, ACTOR)).toThrow(/already exists/);
    expect(() => addSource(project, { type: "document_reference", docRef: { ...DOC_A, version: "2.0" } }, ACTOR)).not.toThrow();
  });

  it("needs a responder name and does not mutate the project", () => {
    const p = base();
    const snap = JSON.stringify(p);
    expect(() => addSource(p, { type: "user_entry", label: "x" }, { name: " ", at: T1 })).toThrow(/responder/);
    addSource(p, { type: "user_entry", label: "x" }, ACTOR);
    expect(JSON.stringify(p)).toBe(snap);
  });
});

describe("updateSource", () => {
  const withDoc = () => addSource(base(), { type: "document_reference", docRef: DOC_A }, ACTOR);

  it("edits document metadata, keeps the label in step and logs before and after", () => {
    const { project, source } = withDoc();
    const next = updateSource(project, source.id, { title: "Fictional study A (corrected)", version: "1.1" }, OTHER_ACTOR);
    const s = next.sources.find((x) => x.id === source.id)!;
    expect(s.docRef).toMatchObject({ identifier: "TEST-DOC-001", title: "Fictional study A (corrected)", version: "1.1" });
    expect(s.label).toBe("TEST-DOC-001 Fictional study A (corrected)");
    const ev = next.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "update_source", by: OTHER_ACTOR.name });
    expect(ev.before).toMatchObject({ label: "TEST-DOC-001 Fictional study A" });
    expect(ev.after).toMatchObject({ label: "TEST-DOC-001 Fictional study A (corrected)" });
  });

  it("removes a title or version given as an empty string", () => {
    const { project, source } = withDoc();
    const next = updateSource(project, source.id, { title: "", version: "" }, ACTOR);
    expect(next.sources.find((x) => x.id === source.id)!.docRef).toEqual({ docType: "Study report", identifier: "TEST-DOC-001" });
  });

  it("rejects a change that would duplicate another document, a blank identifier and a no-op", () => {
    let { project, source } = withDoc();
    project = addSource(project, { type: "document_reference", docRef: DOC_B }, ACTOR).project;
    expect(() => updateSource(project, source.id, { identifier: "TEST-DOC-002", docType: "PPQ report", version: "2.0" }, ACTOR)).toThrow(/already exists/);
    expect(() => updateSource(project, source.id, { identifier: " " }, ACTOR)).toThrow(/identifier/);
    expect(() => updateSource(project, source.id, {}, ACTOR)).toThrow(/Nothing was changed/);
  });

  it("edits a note, and refuses to edit an interview answer", () => {
    const n = addSource(base(), { type: "user_entry", label: "Checked on site (fictional)" }, ACTOR);
    expect(updateSource(n.project, n.source.id, { label: "Checked on site, twice (fictional)" }, ACTOR).sources.find((x) => x.id === n.source.id)!.label).toBe("Checked on site, twice (fictional)");
    const p = scenario();
    expect(() => updateSource(p, interviewId(p, VESSEL_S), { label: "Changed" }, ACTOR)).toThrow(/Only document references and notes/);
  });

  it("does NOT withdraw a verification (the value and status are unchanged)", () => {
    let p = scenario();
    const docId = getEntry(p, VESSEL_S)!.sourceIds.find((id) => p.sources.find((s) => s.id === id)!.type === "document_reference")!;
    p = verifyEntry(p, VESSEL_S, REVIEWER);
    p = updateSource(p, docId, { title: "Fictional study A (corrected)" }, OTHER_ACTOR);
    expect(verificationState(p, VESSEL_S).state).toBe("verified");
  });
});

describe("attachSource and detachSource", () => {
  it("attaches an existing source, logs before and after, and keeps the value and verification", () => {
    let p = verifyEntry(scenario(), VESSEL_T, REVIEWER);
    const { project, source } = addSource(p, { type: "document_reference", docRef: DOC_B }, ACTOR);
    const before = getEntry(project, VESSEL_T)!;
    const next = attachSource(project, VESSEL_T, source.id, OTHER_ACTOR);
    const e = getEntry(next, VESSEL_T)!;
    expect(e.sourceIds).toEqual([...before.sourceIds, source.id]);
    expect(e.value).toBe(before.value);
    expect(e.revision).toBe(before.revision);
    expect(verificationState(next, VESSEL_T).state).toBe("verified");
    expect(next.changeLog.at(-1)).toMatchObject({ action: "attach_source", path: VESSEL_T, before: { sourceIds: before.sourceIds }, after: { sourceIds: e.sourceIds } });
  });

  it("refuses an unknown source, a duplicate and an entry with nothing recorded", () => {
    const p = scenario();
    const own = getEntry(p, VESSEL_S)!.sourceIds[0]!;
    expect(() => attachSource(p, VESSEL_S, own, ACTOR)).toThrow(/already cites/);
    expect(() => attachSource(p, VESSEL_S, "src-nope", ACTOR)).toThrow(/Unknown source/);
    const { project, source } = addSource(p, { type: "user_entry", label: "n" }, ACTOR);
    expect(() => attachSource(project, "source.uo.compounding.equip.vessel.capacity", source.id, ACTOR)).toThrow(/No entry/);
  });

  it("detaching one of several sources leaves the entry as it is", () => {
    const p = scenario();
    const iv = interviewId(p, VESSEL_S);
    const { project, reverted } = detachSource(p, VESSEL_S, iv, OTHER_ACTOR);
    expect(reverted).toBe(false);
    expect(getEntry(project, VESSEL_S)).toMatchObject({ status: "established", value: "stainless_tank" });
    expect(getEntry(project, VESSEL_S)!.sourceIds).not.toContain(iv);
    expect(project.changeLog.at(-1)).toMatchObject({ action: "detach_source", path: VESSEL_S });
  });

  it("detaching the LAST source reverts the entry like the cascade does, keeping the value only in the change log", () => {
    const p = scenario();
    const only = getEntry(p, VESSEL_T)!.sourceIds;
    expect(only).toHaveLength(1);
    const { project, reverted } = detachSource(p, VESSEL_T, only[0]!, OTHER_ACTOR);
    expect(reverted).toBe(true);
    const e = getEntry(project, VESSEL_T)!;
    expect(e.status).toBe("not_established");
    expect(e.sourceIds).toEqual([]);
    expect("value" in e).toBe(false);
    expect(e.revision).toBe(getEntry(p, VESSEL_T)!.revision + 1);
    const log = project.changeLog.slice(p.changeLog.length);
    expect(log.map((x) => x.action)).toEqual(["detach_source", "revert_on_source_detach"]);
    expect(log[1]).toMatchObject({ path: VESSEL_T, before: { status: "established", value: "single_use_bag" }, after: { status: "not_established" } });
    expect(JSON.stringify(project.processes)).not.toContain("single_use_bag");
  });

  it("the gap is recomputed after the last source is detached", () => {
    const p = scenario();
    const vessel = (a: ReturnType<typeof run>) => a.gaps.find((g) => g.path === "uo.compounding.equip.vessel.type")!;
    expect(vessel(run(p)).category).not.toBe("information_required");
    const { project } = detachSource(p, VESSEL_T, getEntry(p, VESSEL_T)!.sourceIds[0]!, ACTOR);
    expect(vessel(run(project)).category).toBe("information_required");
  });
});

describe("removeSource cascade", () => {
  it("reverts every entry whose only source it was, and only those", () => {
    const p = scenario();
    const iv = interviewId(p, VESSEL_S); // the source side's interview answer; the document also supports the entry
    const { project, reverted } = removeSource(p, iv, OTHER_ACTOR);
    expect(reverted).toEqual([]);
    expect(getEntry(project, VESSEL_S)).toMatchObject({ status: "established", value: "stainless_tank" });
    const only = getEntry(p, VESSEL_T)!.sourceIds[0]!;
    const r2 = removeSource(p, only, OTHER_ACTOR);
    expect(r2.reverted).toEqual([VESSEL_T]);
    expect(getEntry(r2.project, VESSEL_T)!.status).toBe("not_established");
  });

  it("a same-as-source target shows Not established when the source entry loses its only source", () => {
    let p = v(base(), "comp.mixer", "source", "top_entry_impeller", ACTOR);
    p = same(p, "comp.mixer");
    const { project } = removeSource(p, interviewId(p, MIXER_S), OTHER_ACTOR);
    expect(run(project).gaps.find((g) => g.path.endsWith("mixer.operatingPrinciple"))!.category).toBe("information_required");
  });

  it("withdraws the verification of an entry that reverted", () => {
    let p = verifyEntry(scenario(), VESSEL_T, REVIEWER);
    const { project } = removeSource(p, getEntry(p, VESSEL_T)!.sourceIds[0]!, OTHER_ACTOR);
    expect(verificationState(project, VESSEL_T).state).toBe("withdrawn");
  });
});

describe("sourceUsage and the register", () => {
  it("lists the entries that cite each source and flags unused ones", () => {
    const { project, source } = addSource(scenario(), { type: "document_reference", docRef: DOC_B }, ACTOR);
    const usage = sourceUsage(project);
    expect(usage.find((u) => u.source.id === source.id)).toMatchObject({ refs: [], unused: true });
    const docUse = usage.find((u) => u.source.docRef?.identifier === "TEST-DOC-001")!;
    expect(docUse.refs).toEqual([VESSEL_S]);
    expect(docUse.unused).toBe(false);
  });

  it("builds register rows with readable entry labels, state text and the responder", () => {
    const { project } = addSource(scenario(), { type: "document_reference", docRef: DOC_B }, OTHER_ACTOR);
    const rows = sourceRegisterRows(content, project);
    expect(rows).toHaveLength(project.sources.length);
    const doc = rows.find((r) => r.source.docRef?.identifier === "TEST-DOC-001")!;
    expect(doc).toMatchObject({ typeLabel: "Document reference", state: "in_use", stateText: "In use", responder: "Alex Example (fictional) (MSAT engineer)" });
    expect(doc.citing[0]).toMatchObject({ ref: VESSEL_S, active: true, display: expect.any(String) });
    expect(doc.citing[0]!.text).toMatch(/^Source: .*Vessel type/);
    const unused = rows.find((r) => r.source.docRef?.identifier === "TEST-DOC-002")!;
    expect(unused).toMatchObject({ state: "unused", stateText: "Unused", citing: [], responder: "Sam Sample (fictional)" });
  });

  it("filters by type, text and unused", () => {
    const { project } = addSource(scenario(), { type: "document_reference", docRef: DOC_B }, ACTOR);
    const rows = sourceRegisterRows(content, project);
    expect(filterSourceRows(rows, { type: "document_reference" })).toHaveLength(2);
    expect(filterSourceRows(rows, { type: "interview_answer" }).every((r) => r.source.type === "interview_answer")).toBe(true);
    expect(filterSourceRows(rows, { text: "test-doc-002" })).toHaveLength(1);
    expect(filterSourceRows(rows, { onlyUnused: true }).map((r) => r.source.docRef?.identifier)).toEqual(["TEST-DOC-002"]);
    expect(filterSourceRows(rows, { text: "no such text" })).toEqual([]);
  });
});

describe("previewSourceRemoval", () => {
  /** The gaps that really change when the source is removed, computed independently of the preview. */
  function actualChange(p: Project, sourceId: string) {
    const a0 = assess(content, p);
    const a1 = assess(content, removeSource(p, sourceId, OTHER_ACTOR).project);
    const m0 = new Map(a0.gaps.map((g) => [g.key, g.category]));
    const m1 = new Map(a1.gaps.map((g) => [g.key, g.category]));
    const changed: string[] = [];
    for (const [k, c] of m0) if (m1.get(k) !== c) changed.push(k);
    for (const k of m1.keys()) if (!m0.has(k)) changed.push(k);
    return { changed: changed.sort(), openBefore: a0.openItems.length, openAfter: a1.openItems.length };
  }

  it("matches the real removal for every source in the project", () => {
    const p = verifyEntry(scenario(), VESSEL_T, REVIEWER);
    for (const s of p.sources) {
      const prev = previewSourceRemoval(content, p, s.id);
      const real = actualChange(p, s.id);
      expect(prev.gapChanges.map((c) => c.key).sort(), s.label).toEqual(real.changed);
      expect(prev.openItemsBefore).toBe(real.openBefore);
      expect(prev.openItemsAfter).toBe(real.openAfter);
      expect(prev.reverting.map((r) => r.ref).sort()).toEqual(removeSource(p, s.id, OTHER_ACTOR).reverted.sort());
    }
  });

  it("describes consequences in plain language and lists reverting versus staying entries", () => {
    const p = verifyEntry(scenario(), VESSEL_T, REVIEWER);
    const only = getEntry(p, VESSEL_T)!.sourceIds[0]!;
    const prev = previewSourceRemoval(content, p, only);
    expect(prev.citing).toBe(1);
    expect(prev.reverting.map((r) => r.ref)).toEqual([VESSEL_T]);
    expect(prev.reverting[0]).toMatchObject({ verified: true, active: true, remaining: [] });
    expect(prev.verificationsWithdrawn).toBe(1);
    expect(prev.lines.join(" ")).toMatch(/become “Not established”|become “Not established”/);
    expect(prev.lines.join(" ")).toMatch(/kept only in the change log/);
    expect(prev.lines.join(" ")).toMatch(/1 verification will be withdrawn/);
    expect(prev.gapChanges[0]).toMatchObject({ kind: "changed", after: { category: "information_required" } });

    const shared = previewSourceRemoval(content, p, interviewId(p, VESSEL_S));
    expect(shared.reverting).toEqual([]);
    expect(shared.staying.map((s) => s.ref)).toEqual([VESSEL_S]);
    expect(shared.staying[0]!.remaining).toHaveLength(1);
    expect(shared.lines.join(" ")).toMatch(/keeps another source/);
  });

  it("says plainly when no entry cites the source, and does not change the project", () => {
    const { project, source } = addSource(scenario(), { type: "document_reference", docRef: DOC_B }, ACTOR);
    const snap = JSON.stringify(project);
    const prev = previewSourceRemoval(content, project, source.id);
    expect(prev.citing).toBe(0);
    expect(prev.lines).toEqual(["No entry cites this source. Removing it changes no value."]);
    expect(JSON.stringify(project)).toBe(snap);
  });

  it("rejects an unknown source", () => {
    expect(() => previewSourceRemoval(content, scenario(), "src-nope")).toThrow(/Unknown source/);
  });
});

describe("cell helpers used by the Builder", () => {
  it("lists attachable sources (not already cited by every entry) and attaches to every recorded entry", () => {
    const { project, source } = addSource(scenario(), { type: "document_reference", docRef: DOC_B }, ACTOR);
    const ids = attachableSources(project, [VESSEL_S]).map((s) => s.id);
    expect(ids).toContain(source.id);
    expect(ids).not.toContain(getEntry(project, VESSEL_S)!.sourceIds[0]);
    const next = attachToCell(project, [VESSEL_S, "source.uo.compounding.equip.vessel.capacity"], source.id, ACTOR);
    expect(getEntry(next, VESSEL_S)!.sourceIds).toContain(source.id);
    expect(() => attachToCell(next, [VESSEL_S], source.id, ACTOR)).toThrow(/Nothing to attach/);
  });

  it("warns before detaching the only source and detaches from the whole cell", () => {
    const p = scenario();
    const only = getEntry(p, VESSEL_T)!.sourceIds[0]!;
    const warn = previewDetach(p, [VESSEL_T], only);
    expect(warn.reverting).toEqual([VESSEL_T]);
    expect(warn.warning).toMatch(/only source/);
    expect(previewDetach(p, [VESSEL_S], interviewId(p, VESSEL_S)).warning).toBe("");
    const { project, reverted } = detachFromCell(p, [VESSEL_T], only, ACTOR);
    expect(reverted).toBe(1);
    expect(getEntry(project, VESSEL_T)!.status).toBe("not_established");
  });
});

describe("pair helper sanity", () => {
  it("builds a project the register can read", () => {
    expect(sourceRegisterRows(content, pair(base(), "comp.vessel_type", "glass", "stainless_tank")).length).toBeGreaterThan(0);
  });
});
