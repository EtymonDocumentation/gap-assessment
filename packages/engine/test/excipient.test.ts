// M13 job 1: the excipient assessment's edit functions, the specification comparison, the change-risk markers and the open items.
// Engine and data only (no screens). Fictional data only.
import { describe, expect, it } from "vitest";
import { addSource, emptyProject, getEntry, parseProject, removeSource, resolveEntry, type ExcipientAssessment, type Project } from "@gap/process-model";
import {
  ACTION_LABELS,
  EXCIPIENT_MARKERS,
  ExcipientError,
  addExcipientLine,
  addSpecRow,
  applicableFacts,
  compareSpecRow,
  createExcipientAssessment,
  deleteExcipientAssessment,
  deleteExcipientLine,
  deleteSpecRow,
  excipientMarkers,
  excipientOpenItems,
  excipientRegulatory,
  parseCriterion,
  setExcipientFact,
  specCounts,
  specCountsText,
  updateExcipientAssessment,
  updateExcipientLine,
  updateSpecRow,
} from "@gap/engine";
import { ACTOR, OTHER_ACTOR, content } from "./helpers";

const fresh = (): Project => emptyProject({ title: "Excipient test (fictional)", actor: ACTOR, contentRefs: content.versions });
const at = (n: number) => ({ ...ACTOR, at: `2026-11-09T10:${String(n).padStart(2, "0")}:00.000Z` });

/** One assessment (EXA-001) with one line (EXL-001). */
function withLine(): Project {
  let p = createExcipientAssessment(fresh(), { title: "Buffer excipients (fictional)" }, ACTOR).project;
  p = addExcipientLine(p, "EXA-001", { name: "Polysorbate 80 (fictional grade)", classKey: "surfactant" }, ACTOR).project;
  return p;
}
/** A document reference in the source register (a specification or a CoA). */
const addDoc = (p: Project, label: string): Project => addSource(p, { type: "document_reference", docRef: { docType: "Specification", identifier: label } }, ACTOR).project;
const a = (p: Project): ExcipientAssessment => p.excipients!.assessments[0]!;
const line = (p: Project) => a(p).lines[0]!;
const val = (p: Project, key: string, side: "sending" | "receiving" | undefined, value: string | string[]) => setExcipientFact(p, "EXA-001", "EXL-001", key, side, { kind: "value", value }, ACTOR);

describe("assessments and lines", () => {
  it("a new project has an empty excipient part; creating an assessment logs one event and invents nothing", () => {
    const p0 = fresh();
    expect(p0.excipients).toEqual({ assessments: [] });
    const { project, assessmentId } = createExcipientAssessment(p0, { title: "  Buffer excipients  ", scopeNote: "  Context  " }, ACTOR);
    expect(assessmentId).toBe("EXA-001");
    expect(a(project)).toMatchObject({ id: "EXA-001", title: "Buffer excipients", status: "draft", scopeNote: "Context", lines: [] });
    expect(project.changeLog.at(-1)).toMatchObject({ action: "excipient_assessment_add", path: "excipient.EXA-001", by: ACTOR.name });
    expect(p0.excipients!.assessments).toHaveLength(0);
  });

  it("a new line holds a name and nothing else: no class, no facts, no rows, no links", () => {
    const p = addExcipientLine(createExcipientAssessment(fresh(), { title: "T" }, ACTOR).project, "EXA-001", { name: "Sodium chloride (fictional)" }, ACTOR).project;
    expect(line(p)).toMatchObject({ id: "EXL-001", name: "Sodium chloride (fictional)", facts: {}, specs: [], links: { gapIds: [], riskItems: [] } });
    expect(line(p).classKey).toBeUndefined();
    expect(line(p).classLabel).toBeUndefined();
  });

  it("refuses an empty name, a missing assessment, both a class and own words, and a class that is not on the list", () => {
    const p = createExcipientAssessment(fresh(), { title: "T" }, ACTOR).project;
    expect(() => createExcipientAssessment(p, { title: " " }, ACTOR)).toThrow(ExcipientError);
    expect(() => addExcipientLine(p, "EXA-009", { name: "X" }, ACTOR)).toThrow(/does not exist/);
    expect(() => addExcipientLine(p, "EXA-001", { name: " " }, ACTOR)).toThrow(/needs a name/);
    expect(() => addExcipientLine(p, "EXA-001", { name: "X", classKey: "surfactant", classLabel: "mine" }, ACTOR)).toThrow(/not both/);
    expect(() => addExcipientLine(p, "EXA-001", { name: "X", classKey: "made_up" }, ACTOR, { classKeys: ["surfactant"] })).toThrow(/not on the class list/);
  });

  it("choosing a class clears the person's own words and the other way round, and both are logged", () => {
    let p = addExcipientLine(createExcipientAssessment(fresh(), { title: "T" }, ACTOR).project, "EXA-001", { name: "X", classLabel: "my own role" }, ACTOR).project;
    p = updateExcipientLine(p, "EXA-001", "EXL-001", { classKey: "sugar", classLabel: null }, at(1));
    expect(line(p).classKey).toBe("sugar");
    expect(line(p).classLabel).toBeUndefined();
    expect(p.changeLog.at(-1)).toMatchObject({ action: "excipient_line_update", before: { classKey: null, classLabel: "my own role" }, after: { classKey: "sugar", classLabel: null } });
    p = updateExcipientLine(p, "EXA-001", "EXL-001", { classLabel: "another role" }, at(2));
    expect(line(p).classKey).toBeUndefined();
    expect(line(p).classLabel).toBe("another role");
  });

  it("saving the same values again changes nothing and logs nothing", () => {
    const p = withLine();
    const same = updateExcipientLine(p, "EXA-001", "EXL-001", { name: "Polysorbate 80 (fictional grade)", classKey: "surfactant", gapIds: [] }, at(3));
    expect(same).toBe(p);
    expect(updateExcipientAssessment(p, "EXA-001", { title: "Buffer excipients (fictional)" }, at(3))).toBe(p);
  });

  it("keeps the links on the line: gaps, risk items, the TRD item and the regulatory reference", () => {
    let p = withLine();
    p = updateExcipientLine(p, "EXA-001", "EXL-001", { gapIds: ["G1", "G1", " G2 "], riskItems: [{ assessmentId: "RA-001", itemId: "RI-001" }], trdItem: { trdId: "TRD-001", stepKey: "buffer_prep", itemKey: "diluent" }, regulatoryReference: " RA-DOC-1 " }, at(4));
    expect(line(p).links).toEqual({ gapIds: ["G1", "G2"], riskItems: [{ assessmentId: "RA-001", itemId: "RI-001" }], trdItem: { trdId: "TRD-001", stepKey: "buffer_prep", itemKey: "diluent" }, regulatoryReference: "RA-DOC-1" });
    p = updateExcipientLine(p, "EXA-001", "EXL-001", { trdItem: null, regulatoryReference: "", reason: "Wrong document (fictional)" }, at(5));
    expect(line(p).links.trdItem).toBeUndefined();
    expect(line(p).links.regulatoryReference).toBeUndefined();
  });

  it("ids are never reused: a deleted line's number stays taken, found in the change log", () => {
    let p = withLine();
    p = deleteExcipientLine(p, "EXA-001", "EXL-001", "Entered twice", at(6));
    p = addExcipientLine(p, "EXA-001", { name: "B" }, at(7)).project;
    expect(line(p).id).toBe("EXL-002");
    p = deleteExcipientAssessment(p, "EXA-001", "Wrong project", at(8));
    expect(createExcipientAssessment(p, { title: "Next" }, at(9)).assessmentId).toBe("EXA-002");
  });

  it("deleting needs a reason, and the reason and what was removed stay in the change log", () => {
    const p = val(withLine(), "supplier", "sending", "Supplier One (fictional)");
    expect(() => deleteExcipientLine(p, "EXA-001", "EXL-001", "  ", at(1))).toThrow(/Say why/);
    expect(() => deleteExcipientAssessment(p, "EXA-001", "", at(1))).toThrow(/Say why/);
    const q = deleteExcipientLine(p, "EXA-001", "EXL-001", "Not used in this product", at(2));
    expect(a(q).lines).toHaveLength(0);
    const ev = q.changeLog.at(-1)!;
    expect(ev.action).toBe("excipient_line_remove");
    expect(ev.detail).toMatch(/Not used in this product/);
    expect((ev.before as { name: string }).name).toBe("Polysorbate 80 (fictional grade)");
    expect((ev.after as { reason: string }).reason).toBe("Not used in this product");
    // The earlier answer's own source is still in the register: nothing outside the assessment is deleted.
    expect(q.sources.length).toBe(p.sources.length);
  });

  it("every excipient action has a plain label", () => {
    for (const k of ["assessment_add", "assessment_update", "assessment_remove", "line_add", "line_update", "line_remove", "fact_set", "spec_add", "spec_update", "spec_remove"]) {
      expect(ACTION_LABELS[`excipient_${k}`], k).toMatch(/^[A-Z][a-z]+ [a-z ]+$/);
    }
  });

  it("the project still parses and equals itself after a round trip", () => {
    const p = val(withLine(), "supplier", "sending", "Supplier One (fictional)");
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe("facts", () => {
  it("records a fact with the person's own source and one change-log event; the fact stays where it was put", () => {
    const p = val(withLine(), "supplier", "sending", " Supplier One (fictional) ");
    const e = line(p).facts["excipient.EXA-001.EXL-001.supplier.sending"]!;
    expect(e).toMatchObject({ status: "established", value: "Supplier One (fictional)", recordedBy: ACTOR.name });
    expect(e.sourceIds).toHaveLength(1);
    expect(p.sources.find((s) => s.id === e.sourceIds[0])!.type).toBe("user_entry");
    expect(p.changeLog.at(-1)).toMatchObject({ action: "excipient_fact_set", path: "excipient.EXA-001.EXL-001.supplier.sending" });
    expect(getEntry(p, e.path)).toBe(e);
    expect(resolveEntry(p, e.path)).toMatchObject({ status: "established", value: "Supplier One (fictional)" });
  });

  it("the same answer again writes nothing; a different one supersedes the earlier source and keeps the old value in the log", () => {
    const p1 = val(withLine(), "supplier", "sending", "Supplier One (fictional)");
    expect(val(p1, "supplier", "sending", "Supplier One (fictional)")).toBe(p1);
    const p2 = setExcipientFact(p1, "EXA-001", "EXL-001", "supplier", "sending", { kind: "value", value: "Supplier Two (fictional)" }, at(1));
    const ev = p2.changeLog.at(-1)!;
    expect((ev.before as { value: string }).value).toBe("Supplier One (fictional)");
    expect((ev.after as { value: string }).value).toBe("Supplier Two (fictional)");
    const first = line(p1).facts["excipient.EXA-001.EXL-001.supplier.sending"]!;
    expect(p2.sources.find((s) => s.id === first.sourceIds[0])!.supersededBy).toBeDefined();
  });

  it("asks a two-sided fact for a side and a whole-product fact for none", () => {
    const p = withLine();
    expect(() => val(p, "supplier", undefined, "X")).toThrow(/each site/);
    expect(() => val(p, "nitrosamine", "sending", "evaluated")).toThrow(/whole product/);
    expect(() => val(p, "not_a_fact", undefined, "X")).toThrow(/not a fact/);
  });

  it("refuses a value that cannot be stored, and never invents one", () => {
    const p = withLine();
    expect(() => val(p, "origin", "sending", "made_up")).toThrow(/one of the options/);
    expect(() => val(p, "supplier", "sending", "   ")).toThrow(/Type an answer/);
    expect(() => setExcipientFact(p, "EXA-001", "EXL-001", "amount", undefined, { kind: "value", value: { value: Number.NaN, unit: "mg/mL" } }, ACTOR)).toThrow(/number/);
    expect(() => setExcipientFact(p, "EXA-001", "EXL-001", "amount", undefined, { kind: "value", value: { value: 1, unit: "furlong" } }, ACTOR)).toThrow(/unit/);
    expect(() => val(p, "grade", "sending", [])).toThrow(/at least one/);
    // A refused answer leaves the project as it was.
    expect(line(p).facts).toEqual({});
  });

  it("a number with a unit is stored as one; a multi-choice keeps the order of the option list", () => {
    let p = setExcipientFact(withLine(), "EXA-001", "EXL-001", "amount", undefined, { kind: "value", value: { value: 0.02, unit: "%" } }, ACTOR);
    expect(resolveEntry(p, "excipient.EXA-001.EXL-001.amount").value).toEqual({ value: 0.02, unit: "%" });
    p = val(p, "grade", "sending", ["usp_nf", "ph_eur"]);
    expect(resolveEntry(p, "excipient.EXA-001.EXL-001.grade.sending").value).toEqual(["ph_eur", "usp_nf"]);
  });

  it("not applicable needs a reason; TBD keeps the best guess, owner, due date and note, and a due date must be a date", () => {
    const p = withLine();
    expect(() => setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "not_applicable", justification: " " }, ACTOR)).toThrow(/why/);
    const na = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "not_applicable", justification: "Held by the supplier" }, ACTOR);
    expect(resolveEntry(na, "excipient.EXA-001.EXL-001.storage.sending")).toMatchObject({ status: "not_applicable", justification: "Held by the supplier" });
    expect(() => setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "tbd", due: "next week" }, ACTOR)).toThrow(/year-month-day/);
    const t = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "tbd", bestGuess: "2-8 C", owner: "QA", due: "2026-12-01", note: "Ask the supplier" }, ACTOR);
    // A TBD with a best guess is shown as provisional (the project's rule); it never counts as an answer.
    expect(resolveEntry(t, "excipient.EXA-001.EXL-001.storage.sending")).toMatchObject({ provisional: true, tbd: { bestGuess: "2-8 C", owner: "QA", due: "2026-12-01", note: "Ask the supplier" } });
  });

  it("'same as the sending site' is only for the receiving side and reads the sending site's fact live", () => {
    let p = withLine();
    expect(() => setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "sending", { kind: "same_as_sending" }, ACTOR)).toThrow(/receiving site/);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "receiving", { kind: "same_as_sending" }, ACTOR);
    const rec = "excipient.EXA-001.EXL-001.supplier.receiving";
    // Nothing is known at the sending site yet: the receiving site's fact reads as not established, never as a guessed value.
    expect(resolveEntry(p, rec).status).toBe("not_established");
    p = val(p, "supplier", "sending", "Supplier One (fictional)");
    expect(resolveEntry(p, rec)).toMatchObject({ status: "established", value: "Supplier One (fictional)", sameAsSource: true });
    p = val(p, "supplier", "sending", "Supplier Two (fictional)");
    expect(resolveEntry(p, rec).value).toBe("Supplier Two (fictional)");
  });

  it("removing a source reverts the facts that cited only it, and drops it from a comparison side", () => {
    let p = addDoc(withLine(), "SP-1 (fictional)");
    const docId = p.sources.at(-1)!.id;
    p = setExcipientFact(p, "EXA-001", "EXL-001", "grade", "sending", { kind: "value", value: ["ph_eur"] }, ACTOR, { sourceIds: [docId], locations: { [docId]: { section: "3", page: "2" } } });
    p = addSpecRow(p, "EXA-001", "EXL-001", { test: "Water content" }, ACTOR).project;
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { criterion: "<= 1", unit: "%", sourceIds: [docId], sourceLocations: { [docId]: { section: "4.1" } } } }, ACTOR);
    const fact = line(p).facts["excipient.EXA-001.EXL-001.grade.sending"]!;
    expect(fact.sourceIds).toContain(docId);
    // The answer also has the person's own source, so the fact keeps its value when only the document goes.
    const r = removeSource(p, docId, at(8));
    expect(line(r.project).facts["excipient.EXA-001.EXL-001.grade.sending"]!.sourceIds).not.toContain(docId);
    expect(line(r.project).specs[0]!.sending.sourceIds).toEqual([]);
    expect(line(r.project).specs[0]!.sending.criterion).toBe("<= 1");
  });
});

describe("the specification comparison", () => {
  const side = (state: "open" | "stated" | "not_tested", criterion?: string, unit?: string) => ({ state, ...(criterion ? { criterion } : {}), ...(unit ? { unit } : {}), sourceIds: [] });
  const row = (s: ReturnType<typeof side>, r: ReturnType<typeof side>) => ({ id: "EXR-001", test: "T", sending: s, receiving: r });

  it("a new row has both sides open and so is 'Not compared yet'", () => {
    const { project, rowId } = addSpecRow(withLine(), "EXA-001", "EXL-001", { test: " Endotoxin ", promptKey: "endotoxin" }, ACTOR);
    expect(rowId).toBe("EXR-001");
    expect(line(project).specs[0]).toMatchObject({ test: "Endotoxin", promptKey: "endotoxin", sending: { state: "open" }, receiving: { state: "open" } });
    expect(compareSpecRow(line(project).specs[0]!)).toBe("not_compared");
  });

  it("is open on one side: not compared; the tool never guesses", () => {
    expect(compareSpecRow(row(side("stated", "<= 1", "%"), side("open")))).toBe("not_compared");
    expect(compareSpecRow(row(side("open"), side("not_tested")))).toBe("not_compared");
  });

  it("same text is the same, ignoring case and spacing; different text is different", () => {
    expect(compareSpecRow(row(side("stated", "Complies with the monograph"), side("stated", "complies  with the Monograph")))).toBe("same");
    expect(compareSpecRow(row(side("stated", "Clear, colourless"), side("stated", "Clear, slightly yellow")))).toBe("different");
  });

  it("numbers are compared after unit conversion and with their relation", () => {
    expect(compareSpecRow(row(side("stated", "<= 0.5", "g/L"), side("stated", "NMT 0.5", "mg/mL")))).toBe("same");
    expect(compareSpecRow(row(side("stated", "0.5", "g/L"), side("stated", "500", "mg/L")))).toBe("different"); // an unknown unit is compared as written
    expect(compareSpecRow(row(side("stated", "<= 0,25", "%"), side("stated", "≤ 0.25", "%")))).toBe("same");
    expect(compareSpecRow(row(side("stated", "<= 0.25", "%"), side("stated", "< 0.25", "%")))).toBe("different");
    expect(compareSpecRow(row(side("stated", "10", "mL"), side("stated", "10", "g")))).toBe("different"); // not the same kind of unit
    expect(compareSpecRow(row(side("stated", "10", "mL"), side("stated", "0.01", "L")))).toBe("same");
  });

  it("a test stated at one site and not in the other site's specification is 'only at' that site", () => {
    expect(compareSpecRow(row(side("stated", "<= 1", "%"), side("not_tested")))).toBe("only_sending");
    expect(compareSpecRow(row(side("not_tested"), side("stated", "<= 1", "%")))).toBe("only_receiving");
    expect(compareSpecRow(row(side("not_tested"), side("not_tested")))).toBe("same");
  });

  it("never says which side is stricter: the result names no side except for 'only at'", () => {
    const wider = compareSpecRow(row(side("stated", "<= 1", "%"), side("stated", "<= 5", "%")));
    const narrower = compareSpecRow(row(side("stated", "<= 5", "%"), side("stated", "<= 1", "%")));
    expect(wider).toBe("different");
    expect(narrower).toBe("different");
  });

  it("parses plain numbers only, and leaves a thousands separator as text", () => {
    expect(parseCriterion("<= 0.25")).toEqual({ relation: "<=", value: 0.25 });
    expect(parseCriterion("NLT 98")).toEqual({ relation: ">=", value: 98 });
    expect(parseCriterion("7.4")).toEqual({ relation: "", value: 7.4 });
    expect(parseCriterion("1,000")).toBeUndefined();
    expect(parseCriterion("clear")).toBeUndefined();
  });

  it("counts, and says so in words; an empty table says 'No tests entered yet'", () => {
    expect(specCountsText(specCounts({ specs: [] }))).toBe("No tests entered yet");
    const specs = [
      row(side("stated", "1", "%"), side("stated", "1", "%")),
      row(side("stated", "1", "%"), side("stated", "2", "%")),
      row(side("stated", "1", "%"), side("not_tested")),
      row(side("open"), side("open")),
      row(side("open"), side("stated", "1", "%")),
    ];
    expect(specCounts({ specs })).toEqual({ rows: 5, compared: 3, same: 1, different: 1, onlyAtOneSite: 1, notCompared: 2 });
    expect(specCountsText(specCounts({ specs }))).toBe("3 tests compared, 1 same, 1 different, 1 only at one site, 2 not compared yet");
  });

  it("editing a side: typing a criterion states it, a state change drops the criterion, a stated side needs one, and a source must exist", () => {
    let p = addSpecRow(withLine(), "EXA-001", "EXL-001", { test: "Assay" }, ACTOR).project;
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { criterion: "98 - 102", unit: "%", method: "HPLC" } }, at(1));
    expect(line(p).specs[0]!.sending).toMatchObject({ state: "stated", criterion: "98 - 102", unit: "%", method: "HPLC" });
    expect(() => updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { receiving: { state: "stated" } }, at(2))).toThrow(/acceptance criterion/);
    expect(() => updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { receiving: { state: "open", sourceIds: ["src_missing"] } }, at(2))).toThrow(/source register/);
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { state: "not_tested" } }, at(3));
    expect(line(p).specs[0]!.sending.criterion).toBeUndefined();
    expect(line(p).specs[0]!.sending.state).toBe("not_tested");
    // Typing the same thing again changes nothing and logs nothing.
    expect(updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { state: "not_tested" } }, at(4))).toBe(p);
  });

  it("deleting a row needs a reason, kept with the row in the change log; the row's number is not reused", () => {
    let p = addSpecRow(withLine(), "EXA-001", "EXL-001", { test: "Assay" }, ACTOR).project;
    expect(() => deleteSpecRow(p, "EXA-001", "EXL-001", "EXR-001", "", at(1))).toThrow(/Say why/);
    p = deleteSpecRow(p, "EXA-001", "EXL-001", "EXR-001", "Test not relevant", at(2));
    expect(line(p).specs).toHaveLength(0);
    expect((p.changeLog.at(-1)!.before as { test: string }).test).toBe("Assay");
    expect(addSpecRow(p, "EXA-001", "EXL-001", { test: "Again" }, at(3)).rowId).toBe("EXR-002");
  });
});

describe("change-risk markers and the regulatory sentence", () => {
  const keys = (p: Project) => excipientMarkers(p, "EXA-001", line(p)).map((m) => m.key);

  it("a new line has no marker and no sentence: an open fact never raises one", () => {
    const p = withLine();
    expect(keys(p)).toEqual([]);
    expect(excipientRegulatory(p, "EXA-001", line(p))).toEqual({ required: false });
  });

  it("different supplier, site, grade and origin raise their own marker and the sentence, and only when both sites have answered", () => {
    let p = val(withLine(), "supplier", "sending", "Supplier One (fictional)");
    expect(keys(p)).toEqual([]);
    p = val(p, "supplier", "receiving", "supplier  two (fictional)");
    expect(keys(p)).toEqual(["different_supplier"]);
    p = val(val(p, "manufacturingSite", "sending", "Site A"), "manufacturingSite", "receiving", "Site B");
    p = val(val(p, "grade", "sending", ["ph_eur"]), "grade", "receiving", ["ph_eur", "usp_nf"]);
    p = val(val(p, "origin", "sending", "plant"), "origin", "receiving", "synthetic");
    expect(keys(p)).toEqual(["different_supplier", "different_site", "different_grade", "different_origin"]);
    expect(excipientRegulatory(p, "EXA-001", line(p))).toEqual({ required: true, sentence: "Requires regulatory affairs assessment" });
  });

  it("the same text with other case or spacing, and 'same as the sending site', are not a difference", () => {
    let p = val(withLine(), "supplier", "sending", "Supplier One (fictional)");
    p = val(p, "supplier", "receiving", "SUPPLIER   one (fictional)");
    expect(keys(p)).toEqual([]);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "supplier", "receiving", { kind: "same_as_sending" }, ACTOR);
    expect(keys(p)).toEqual([]);
  });

  it("a different specification raises its marker and the sentence", () => {
    let p = addSpecRow(withLine(), "EXA-001", "EXL-001", { test: "Water" }, ACTOR).project;
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { criterion: "<= 1", unit: "%" }, receiving: { criterion: "<= 2", unit: "%" } }, ACTOR);
    expect(keys(p)).toEqual(["different_specification"]);
    expect(excipientRegulatory(p, "EXA-001", line(p)).required).toBe(true);
  });

  it("origin not known, a supplier not yet qualified and a single source at the receiving site are markers without the sentence", () => {
    let p = val(withLine(), "origin", "sending", "not_known");
    p = val(p, "supplierStatus", "receiving", "not_yet");
    p = val(p, "sourcesOfSupply", "receiving", "one");
    expect(keys(p)).toEqual(["origin_not_known", "supplier_not_qualified", "single_source"]);
    expect(excipientRegulatory(p, "EXA-001", line(p))).toEqual({ required: false });
    // The same answers at the sending site raise neither of the two receiving-site markers.
    const q = val(val(withLine(), "supplierStatus", "sending", "not_yet"), "sourcesOfSupply", "sending", "one");
    expect(keys(q)).toEqual([]);
  });

  it("the regulatory reference only adds a line: the sentence stays with or without it", () => {
    let p = val(val(withLine(), "supplier", "sending", "A"), "supplier", "receiving", "B");
    p = updateExcipientLine(p, "EXA-001", "EXL-001", { regulatoryReference: "RA assessment 12 (fictional)" }, ACTOR);
    expect(excipientRegulatory(p, "EXA-001", line(p))).toEqual({ required: true, sentence: "Requires regulatory affairs assessment", reference: "RA assessment 12 (fictional)" });
  });

  it("the marker list is the eight spec markers, the first five carrying the sentence, and names no filing category", () => {
    expect(EXCIPIENT_MARKERS.map((m) => m.regulatory)).toEqual([true, true, true, true, true, false, false, false]);
    for (const m of EXCIPIENT_MARKERS) expect(m.label).not.toMatch(/minor|major|moderate|prior[- ]approval|annual report|CBE|variation/i);
  });
});

describe("which facts apply, and the open items", () => {
  const paths = (p: Project) => applicableFacts(p, "EXA-001", line(p)).map((f) => `${f.def.key}${f.side ? "." + f.side : ""}`);

  it("asks the animal details only when the origin is animal or mixed, and the place of an evaluation only when the topic was looked at", () => {
    let p = withLine();
    expect(paths(p)).not.toContain("animalDetail.sending");
    expect(paths(p)).not.toContain("nitrosamineRef");
    p = val(p, "origin", "sending", "animal");
    expect(paths(p)).toContain("animalDetail.sending");
    expect(paths(p)).toContain("tseEvidence.sending");
    expect(paths(p)).not.toContain("animalDetail.receiving");
    p = val(p, "origin", "receiving", "mixed");
    expect(paths(p)).toContain("animalStatement.receiving");
    p = val(p, "nitrosamine", undefined, "evaluated");
    expect(paths(p)).toContain("nitrosamineRef");
    expect(paths(p)).not.toContain("elementalRef");
  });

  it("an answer is never dropped or hidden because another answer changed", () => {
    let p = val(withLine(), "origin", "sending", "animal");
    p = val(p, "animalDetail", "sending", "Bovine, country stated by the supplier");
    p = val(p, "origin", "sending", "plant");
    expect(paths(p)).toContain("animalDetail.sending");
  });

  it("a new line lists every applicable fact as not established, every row not compared, and the missing document", () => {
    let p = withLine();
    p = addSpecRow(p, "EXA-001", "EXL-001", { test: "Water" }, ACTOR).project;
    const items = excipientOpenItems(p, a(p));
    const n = paths(p).length;
    expect(items.filter((i) => i.kind === "not_established")).toHaveLength(n);
    expect(items.filter((i) => i.kind === "not_compared")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "no_sources")).toHaveLength(1);
    expect(items.find((i) => i.kind === "not_established")!.where).toMatch(/Buffer excipients \(fictional\), Polysorbate 80/);
  });

  it("an answered fact is not open; a TBD is open and says who and when; a not-applicable answer is not open", () => {
    let p = val(withLine(), "supplier", "sending", "A");
    p = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "sending", { kind: "tbd", owner: "QA", due: "2026-12-01" }, ACTOR);
    p = setExcipientFact(p, "EXA-001", "EXL-001", "storage", "receiving", { kind: "not_applicable", justification: "Held by the supplier" }, ACTOR);
    const items = excipientOpenItems(p, a(p));
    expect(items.find((i) => i.factKey === "supplier" && i.side === "sending")).toBeUndefined();
    expect(items.find((i) => i.factKey === "storage" && i.side === "receiving")).toBeUndefined();
    expect(items.find((i) => i.factKey === "storage" && i.side === "sending")).toMatchObject({ kind: "tbd", text: "TBD (owner QA, due 2026-12-01)" });
    // A TBD with a best guess is still open, and a best guess never raises a marker.
    const q = setExcipientFact(val(p, "supplier", "receiving", "B"), "EXA-001", "EXL-001", "supplier", "sending", { kind: "tbd", bestGuess: "B" }, ACTOR);
    expect(excipientOpenItems(q, a(q)).find((i) => i.factKey === "supplier" && i.side === "sending")).toMatchObject({ kind: "tbd" });
    expect(excipientMarkers(q, "EXA-001", line(q))).toEqual([]);
  });

  it("a document cited anywhere on the line ends the 'no document' item; the person's own entry source does not", () => {
    let p = val(withLine(), "supplier", "sending", "A");
    expect(excipientOpenItems(p, a(p)).some((i) => i.kind === "no_sources")).toBe(true);
    p = addDoc(p, "CoA lot 1 (fictional)");
    const docId = p.sources.at(-1)!.id;
    p = setExcipientFact(p, "EXA-001", "EXL-001", "grade", "sending", { kind: "value", value: ["ph_eur"] }, ACTOR, { sourceIds: [docId] });
    expect(excipientOpenItems(p, a(p)).some((i) => i.kind === "no_sources")).toBe(false);
  });

  it("a receiving fact set to 'same as the sending site' is open while the sending site is open", () => {
    let p = setExcipientFact(withLine(), "EXA-001", "EXL-001", "supplier", "receiving", { kind: "same_as_sending" }, ACTOR);
    expect(excipientOpenItems(p, a(p)).some((i) => i.factKey === "supplier" && i.side === "receiving")).toBe(true);
    p = val(p, "supplier", "sending", "A");
    expect(excipientOpenItems(p, a(p)).some((i) => i.factKey === "supplier" && i.side === "receiving")).toBe(false);
  });

  it("a second actor's edit is attributed to them in the change log", () => {
    const p = setExcipientFact(withLine(), "EXA-001", "EXL-001", "supplier", "sending", { kind: "value", value: "A" }, OTHER_ACTOR);
    expect(p.changeLog.at(-1)).toMatchObject({ by: OTHER_ACTOR.name, at: OTHER_ACTOR.at });
  });
});
