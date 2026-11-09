// M13 job 4A: the links of an excipient line (TRD, risk, gaps), the excipient assessment document, its gap-document section, the export ids,
// the source register and the version comparison. Engine and data only. Fictional data only.
import { describe, expect, it } from "vitest";
import { addSource, emptyProject, sourceUsage, type DocumentExport, type Project } from "@gap/process-model";
import {
  COMPARE_DOCS,
  ExcipientError,
  NOTICE_DOCUMENT,
  addExcipientLine,
  addSpecRow,
  updateSpecRow,
  addTrdItem,
  addWriteupFromLibrary,
  applyExcipientToTrd,
  buildDocument,
  buildExcipientAssessmentDocument,
  compareCounts,
  compareVersions,
  createAssessment,
  createExcipientAssessment,
  createTrd,
  documentFingerprint,
  excipientGapBlocks,
  excipientRiskOffers,
  excipientRiskSuggestions,
  excipientTableRows,
  excipientTableText,
  excipientsAssessedInTrd,
  excipientsAssessedText,
  hasExcipientLines,
  optionalSectionsFor,
  omittedSectionIds,
  recordExport,
  sectionChoicesFor,
  setExcipientFact,
  sourceRegisterRows,
  startRiskItemFromExcipient,
  trdMaterialChoices,
  trdUseState,
  updateExcipientLine,
  assess,
} from "@gap/engine";
import { renderHtml, renderMarkdown } from "../../renderers/src/index";
import { excipientClasses, excipientWording, failureModes, trdWriteups } from "../../../content/index";
import { ACTOR, content } from "./helpers";

const fresh = (): Project => emptyProject({ title: "Links test (fictional)", actor: ACTOR, contentRefs: content.versions });
const dilution = trdWriteups.find((w) => w.key === "dilution_buffer")!;
const EXA = "EXA-001";
const EXL = "EXL-001";

/** One excipient assessment with one line, a TRD with a buffer material and its Dilution buffer section, and one risk assessment. */
function world(opts: { section?: boolean } = {}): Project {
  let p = createExcipientAssessment(fresh(), { title: "Buffer excipients (fictional)" }, ACTOR).project;
  p = addExcipientLine(p, EXA, { name: "Polysorbate 80 (fictional grade)", classKey: "surfactant" }, ACTOR).project;
  p = addExcipientLine(p, EXA, { name: "Sucrose (fictional grade)", classKey: "stabiliser" }, ACTOR).project;
  const trd = createTrd(p, { title: "Drug product TRD (fictional)", start: { kind: "blank", steps: [{ label: "Buffer preparation", unitOp: "buffer_prep" }] } }, ACTOR);
  p = trd.project;
  const stepId = p.trd.documents[0]!.steps[0]!.id;
  p = addTrdItem(p, trd.trdId, stepId, { collection: "mat", label: "Diluent" }, ACTOR).project;
  if (opts.section !== false) p = addWriteupFromLibrary(p, trd.trdId, dilution, undefined, ACTOR).project;
  p = createAssessment(p, { title: "Process risk (fictional)", steps: [{ label: "Buffer preparation", unitOp: "buffer_prep" }] }, ACTOR).project;
  return p;
}

const linkToTrd = (p: Project, lineId = EXL): Project => {
  const c = trdMaterialChoices(p)[0]!;
  return updateExcipientLine(p, EXA, lineId, { trdItem: { trdId: c.trdId, stepKey: c.stepKey, itemKey: c.itemKey } }, ACTOR);
};
const line = (p: Project, id = EXL) => p.excipients!.assessments[0]!.lines.find((l) => l.id === id)!;

describe("the TRD link and Use in the TRD", () => {
  it("offers the materials of every TRD and nothing else", () => {
    const choices = trdMaterialChoices(world());
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ trdId: "TRD-001", itemLabel: "Diluent", stepLabel: "Buffer preparation" });
  });

  it("writes the two typed blanks through the TRD's own function, one change-log event each", () => {
    const p0 = linkToTrd(world());
    const before = p0.changeLog.length;
    const p1 = applyExcipientToTrd(p0, EXA, EXL, { document: "QA-DOC-0001 (fictional)", procedure: "SOP-0002 (fictional)" }, ACTOR);
    const events = p1.changeLog.slice(before);
    expect(events.map((e) => e.action)).toEqual(["trd_writeup_value", "trd_writeup_value"]);
    const s = trdUseState(p1, "TRD-001")!;
    expect(s.document).toBe("QA-DOC-0001 (fictional)");
    expect(s.procedure).toBe("SOP-0002 (fictional)");
  });

  it("a box left empty writes nothing and clears nothing", () => {
    let p = linkToTrd(world());
    p = applyExcipientToTrd(p, EXA, EXL, { document: "QA-DOC-0001 (fictional)", procedure: "SOP-0002 (fictional)" }, ACTOR);
    const before = p.changeLog.length;
    p = applyExcipientToTrd(p, EXA, EXL, { document: "", procedure: "SOP-0003 (fictional)" }, ACTOR);
    expect(p.changeLog.length - before).toBe(1);
    expect(trdUseState(p, "TRD-001")!.document).toBe("QA-DOC-0001 (fictional)");
    expect(trdUseState(p, "TRD-001")!.procedure).toBe("SOP-0003 (fictional)");
  });

  it("is refused in words, with nothing written, when there is no link, no section or no text", () => {
    const noLink = world();
    expect(() => applyExcipientToTrd(noLink, EXA, EXL, { document: "x" }, ACTOR)).toThrow(ExcipientError);
    const noSection = linkToTrd(world({ section: false }));
    expect(() => applyExcipientToTrd(noSection, EXA, EXL, { document: "x" }, ACTOR)).toThrow(/no "Dilution buffer" section/);
    const linked = linkToTrd(world());
    expect(() => applyExcipientToTrd(linked, EXA, EXL, { document: " ", procedure: "" }, ACTOR)).toThrow(/Nothing was written/);
  });

  it("gives the excipients of one TRD as text to copy, and counts them", () => {
    let p = linkToTrd(world());
    p = linkToTrd(p, "EXL-002");
    expect(excipientsAssessedInTrd(p, "TRD-001")).toBe(2);
    expect(excipientsAssessedText(2)).toBe("2 excipients assessed");
    expect(excipientsAssessedText(1)).toBe("1 excipient assessed");
    const rows = excipientTableRows(p, EXA, "TRD-001", { role: () => "Surfactant", composition: () => "Not established" });
    expect(rows).toEqual([
      ["Surfactant", "Polysorbate 80 (fictional grade)", "Not established"],
      ["Surfactant", "Sucrose (fictional grade)", "Not established"],
    ]);
    expect(excipientTableText(rows).split("\n")).toHaveLength(2);
    expect(excipientTableText(rows)).toContain("\t");
  });
});

describe("taking a link away needs a reason", () => {
  it("refuses removing a gap, a risk item or the TRD link without one, and keeps the reason in the log", () => {
    let p = linkToTrd(world());
    p = updateExcipientLine(p, EXA, EXL, { gapIds: ["G-001"] }, ACTOR);
    expect(() => updateExcipientLine(p, EXA, EXL, { gapIds: [] }, ACTOR)).toThrow(/reason/i);
    expect(() => updateExcipientLine(p, EXA, EXL, { trdItem: null }, ACTOR)).toThrow(/reason/i);
    const gone = updateExcipientLine(p, EXA, EXL, { gapIds: [], reason: "Linked by mistake" }, ACTOR);
    expect(line(gone).links.gapIds).toEqual([]);
    expect(gone.changeLog.at(-1)!.detail).toContain("Linked by mistake");
    const noTrd = updateExcipientLine(p, EXA, EXL, { trdItem: null, reason: "Moved to another TRD" }, ACTOR);
    expect(line(noTrd).links.trdItem).toBeUndefined();
  });
});

describe("start a risk item from an excipient", () => {
  it("offers the excipient suggestions only", () => {
    const keys = excipientRiskSuggestions(failureModes).map((s) => s.key);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(keys.every((k) => k.startsWith("excipient_"))).toBe(true);
  });

  it("makes a draft item with no score, names the excipient, stores the pair on the line, and does not repeat for the same excipient", () => {
    const p0 = world();
    const risk = p0.risk.assessments[0]!;
    const key = "excipient_grade_differs";
    const done = startRiskItemFromExcipient(p0, EXA, EXL, risk.id, key, failureModes, ACTOR);
    const item = done.project.risk.assessments[0]!.items.find((i) => i.id === done.itemId)!;
    expect(item.notes).toContain("EXL-001");
    expect(item.origin).toMatchObject({ kind: "catalog", suggestionKey: key });
    expect(JSON.stringify(item)).not.toMatch(/"(severity|occurrence|detection|rpn)"\s*:\s*[0-9]/);
    expect(line(done.project).links.riskItems).toEqual([{ assessmentId: risk.id, itemId: done.itemId }]);
    const offers = excipientRiskOffers(failureModes, done.project.risk.assessments[0]!, line(done.project));
    expect(offers.find((o) => o.key === key)).toMatchObject({ added: true, itemId: done.itemId });
    expect(() => startRiskItemFromExcipient(done.project, EXA, EXL, risk.id, key, failureModes, ACTOR)).toThrow(/already started/);
    // Another excipient may start the same suggestion.
    const other = startRiskItemFromExcipient(done.project, EXA, "EXL-002", risk.id, key, failureModes, ACTOR);
    expect(line(other.project, "EXL-002").links.riskItems).toHaveLength(1);
  });

  it("refuses a suggestion that is not about an excipient", () => {
    const p0 = world();
    const other = failureModes.suggestions.find((s) => !s.key.startsWith("excipient_"))!;
    expect(() => startRiskItemFromExcipient(p0, EXA, EXL, p0.risk.assessments[0]!.id, other.key, failureModes, ACTOR)).toThrow(ExcipientError);
  });
});

describe("the excipient assessment document", () => {
  const build = (p: Project, omit: readonly "change-log"[] = []) =>
    buildExcipientAssessmentDocument(content, p, p.excipients!.assessments[0]!, { generatedAt: ACTOR.at, wording: excipientWording, classes: excipientClasses, omit });

  it("carries the one shared notice, the permanent wording, every excipient, and no verdict", () => {
    const p = linkToTrd(world());
    const html = renderHtml(build(p));
    const md = renderMarkdown(build(p));
    for (const out of [html, md]) {
      expect(out).toContain(NOTICE_DOCUMENT);
      expect(out).toContain("Polysorbate 80 (fictional grade)");
      expect(out).toContain("Sucrose (fictional grade)");
      expect(out).toContain("Not established");
      expect(out).not.toMatch(/\b(approved for|acceptable)\b/i);
    }
  });

  it("states the assessment reference the TRD holds, so the two documents say the same", () => {
    let p = linkToTrd(world());
    p = applyExcipientToTrd(p, EXA, EXL, { document: "QA-DOC-0001 (fictional)" }, ACTOR);
    expect(renderMarkdown(build(p))).toContain("QA-DOC-0001 (fictional)");
  });

  it("leaves the change log extract out when asked, and the fingerprint follows the content", () => {
    const p = world();
    const withLog = build(p);
    const without = build(p, ["change-log"]);
    expect(documentFingerprint(withLog)).not.toBe(documentFingerprint(without));
    expect(renderMarkdown(without)).not.toMatch(/Change log extract/);
  });

  it("shows the regulatory sentence only as the fixed wording when a difference calls for it", () => {
    let p = world();
    p = setExcipientFact(p, EXA, EXL, "origin", "sending", { kind: "value", value: "plant" }, ACTOR);
    p = setExcipientFact(p, EXA, EXL, "origin", "receiving", { kind: "value", value: "animal" }, ACTOR);
    const md = renderMarkdown(build(p));
    expect(md).toContain("Requires regulatory affairs assessment");
    expect(md).not.toMatch(/(minor|major) change|Type I[AB]|prior approval/i);
  });
});

describe("the optional section of the gap document", () => {
  it("is absent without excipient lines and present with them, under the same optional-section mechanism", () => {
    const empty = fresh();
    expect(hasExcipientLines(empty)).toBe(false);
    expect(excipientGapBlocks(empty)).toBeUndefined();
    expect(optionalSectionsFor(empty).some((s) => s.id === "excipient-assessment")).toBe(false);
    expect(sectionChoicesFor(empty).some((s) => s.id === "excipient-assessment")).toBe(false);
    const p = world();
    expect(hasExcipientLines(p)).toBe(true);
    expect(excipientGapBlocks(p)).toBeDefined();
    expect(optionalSectionsFor(p).some((s) => s.id === "excipient-assessment")).toBe(true);
    const a = assess(content, p);
    const doc = buildDocument(content, p, a, ACTOR.at);
    expect(doc.sections.some((s) => s.id === "excipient-assessment")).toBe(true);
    const md = renderMarkdown(doc);
    expect(md).toContain("Excipient assessment");
    expect(md).toContain("Polysorbate 80 (fictional grade)");
  });

  it("a stored choice to leave it out removes it, and means nothing once the lines are gone", () => {
    const p = world();
    const left = structuredClone(p);
    left.document.omittedSections = ["excipient-assessment"];
    expect(omittedSectionIds(left)).toEqual(["excipient-assessment"]);
    expect(buildDocument(content, left, assess(content, left), ACTOR.at).sections.some((s) => s.id === "excipient-assessment")).toBe(false);
    const none = structuredClone(fresh());
    none.document.omittedSections = ["excipient-assessment"];
    expect(omittedSectionIds(none)).toEqual([]);
  });
});

describe("export ids and formats", () => {
  const rec = (format: DocumentExport["format"], fingerprint: string, documentId?: string): DocumentExport => ({
    at: ACTOR.at,
    by: "Tester",
    format,
    template: { name: "Built-in", version: "1", mode: "builtin" },
    fingerprint,
    tbdCount: 0,
    ...(documentId ? { documentId } : {}),
  });

  it("compares the three excipient formats with each other, and never with another kind of document", () => {
    let p = world();
    p = recordExport(p, rec("excipient-docx", "aaa", "EXA-001"));
    p = recordExport(p, rec("risk-assessment-html", "zzz", "RA-001"));
    p = recordExport(p, rec("excipient-markdown", "aaa", "EXA-001"));
    expect(p.document.exports.at(-1)!.changedSincePrevious).toBe(false);
    p = recordExport(p, rec("excipient-html", "ccc", "EXA-001"));
    expect(p.document.exports.at(-1)!.changedSincePrevious).toBe(true);
  });

  it("compares a download only with the previous download of the same document", () => {
    let p = world();
    p = recordExport(p, rec("excipient-html", "aaa", "EXA-001"));
    p = recordExport(p, rec("excipient-html", "bbb", "EXA-002"));
    p = recordExport(p, rec("excipient-html", "aaa", "EXA-001"));
    const last = p.document.exports.at(-1)!;
    const second = p.document.exports.at(-2)!;
    expect(second.changedSincePrevious).toBeUndefined();
    expect(last.changedSincePrevious).toBe(false);
    expect(last.documentId).toBe("EXA-001");
  });
});

describe("citations of the excipient lines", () => {
  it("counts a source cited by an excipient fact in the source usage and the register", () => {
    let p = addSource(world(), { type: "document_reference", docRef: { docType: "Specification", identifier: "SPEC-9 (fictional)" } }, ACTOR).project;
    const id = p.sources.find((s) => s.type === "document_reference")!.id;
    p = setExcipientFact(p, EXA, EXL, "supplier", "sending", { kind: "value", value: "Supplier North (fictional)" }, ACTOR, { sourceIds: [id] });
    expect(sourceUsage(p).find((u) => u.source.id === id)!.refs.length).toBeGreaterThan(0);
    const row = sourceRegisterRows(content, p).find((r) => r.source.id === id)!;
    expect(row.state).toBe("in_use");
    expect(row.citing.some((c) => c.side === "excipient")).toBe(true);
  });

  it("also counts a source cited for one site's side of a specification row", () => {
    let p = addSource(world(), { type: "document_reference", docRef: { docType: "Specification", identifier: "SPEC-10 (fictional)" } }, ACTOR).project;
    const id = p.sources.find((s) => s.type === "document_reference")!.id;
    p = addSpecRow(p, EXA, EXL, { test: "pH" }, ACTOR).project;
    p = updateSpecRow(p, EXA, EXL, "EXR-001", { receiving: { criterion: "5.5 - 7.5", sourceIds: [id] } }, ACTOR);
    const refs = sourceUsage(p).find((u) => u.source.id === id)!.refs;
    expect(refs).toContain("excipient.EXA-001.EXL-001.spec.EXR-001.receiving");
    expect(sourceRegisterRows(content, p).find((r) => r.source.id === id)!.citing[0]!.side).toBe("excipient");
  });
});

describe("saved versions carry the excipient assessments", () => {
  it("lists them as a changed part of the comparison", () => {
    const a = world();
    const b = updateExcipientLine(a, EXA, EXL, { name: "Polysorbate 80 (fictional, renamed)" }, ACTOR);
    const c = setExcipientFact(b, EXA, EXL, "supplier", "sending", { kind: "value", value: "Supplier North (fictional)" }, ACTOR);
    expect(COMPARE_DOCS).toContain("excipient");
    const rows = compareVersions(content, a, c);
    const ex = rows.filter((r) => r.doc === "excipient");
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.some((r) => /Supplier/.test(r.item) && r.kind === "added" && r.b === "Supplier North (fictional)")).toBe(true);
    expect(compareCounts(rows).excipient).toBe(ex.length);
    expect(compareVersions(content, a, a)).toEqual([]);
  });
});
