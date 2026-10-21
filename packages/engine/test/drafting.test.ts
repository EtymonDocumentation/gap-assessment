import { addSource, getEntry, resolveEntry, verificationProblem, type Actor, type Project, type Source } from "@gap/process-model";
import {
  answeringFrom,
  assess,
  autoCiteAnswer,
  buildDocument,
  citeEntries,
  clearAnsweringFrom,
  DraftingError,
  filterLinkCandidates,
  gapsToCsv,
  hasCitableValue,
  linkCandidates,
  locationText,
  PROVISIONAL_LABEL,
  buildValidationPlan,
  validationPlanToCsv,
  isOverdue,
  localDate,
  setAnsweringFrom,
  tbdItems,
  tbdSummary,
  tbdSummaryText,
  undoCitations,
  AnswerError,
  isIsoDate,
} from "@gap/engine";
import { describe, expect, it } from "vitest";
import { ACTOR, content, kit } from "./helpers";

const { base, ask, v, inst, pair } = kit;

const GEN = "2026-10-20T08:00:00.000Z";
const PUMP = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";
const PUMP_SU = "source.uo.aseptic_filling.equip.filler.operatingPrinciple";
const PUMP_RU = "target.uo.aseptic_filling.equip.filler.operatingPrinciple";
const A2: Actor = { ...ACTOR, at: "2026-10-02T09:00:00.000Z" };

/** A project with one register document and a pump answered as a TBD on the receiving unit. */
function withDoc(p: Project = base()): { project: Project; doc: Source } {
  const r = addSource(p, { type: "document_reference", docRef: { identifier: "DEMO-DOC-1", docType: "Report", title: "Fictional report" } }, ACTOR);
  return { project: r.project, doc: r.source };
}

describe("TBD comparison", () => {
  it("a TBD without a best guess behaves like not known: information required, not provisional, an open item", () => {
    let p = v(base(), "fill.pump", "source", "rotary_piston");
    p = ask(p, "fill.pump", "target", { kind: "tbd", owner: "Process lead (fictional)", due: "2026-12-01" });
    const e = getEntry(p, PUMP_RU)!;
    expect(e.status).toBe("tbd");
    expect(e.value).toBeUndefined();
    expect(resolveEntry(p, PUMP_RU)).toMatchObject({ status: "tbd" });
    const a = assess(content, p);
    const g = a.gaps.find((x) => x.key === PUMP)!;
    expect(g.category).toBe("information_required");
    expect(g.provisional).toBeUndefined();
    const item = tbdItems(content, p, a).find((i) => i.ref === PUMP_RU)!;
    expect(item).toMatchObject({ owner: "Process lead (fictional)", due: "2026-12-01", sideText: "RU" });
    expect(item.bestGuess).toBeUndefined();
  });

  it("a TBD with a best guess is compared as if established and the gap is provisional", () => {
    const established = assess(content, pair(base(), "fill.pump", "rotary_piston", "peristaltic")).gaps.find((x) => x.key === PUMP)!;
    let p = v(base(), "fill.pump", "source", "rotary_piston");
    p = ask(p, "fill.pump", "target", { kind: "tbd", bestGuess: "peristaltic", owner: "Process lead (fictional)" });
    // Stored as a TBD, never as the entry's value; read as an established, provisional value.
    expect(getEntry(p, PUMP_RU)).toMatchObject({ status: "tbd", tbd: { bestGuess: "peristaltic" } });
    expect(getEntry(p, PUMP_RU)!.value).toBeUndefined();
    expect(resolveEntry(p, PUMP_RU)).toMatchObject({ status: "established", value: "peristaltic", provisional: true });
    const g = assess(content, p).gaps.find((x) => x.key === PUMP)!;
    expect(g.category).toBe(established.category);
    expect(g.severity).toBe(established.severity);
    expect(g.provisional).toBe(true);
    expect(g.targetDisplay).toContain("TBD best guess, provisional");
  });

  it("a TBD cannot be verified, with or without a best guess", () => {
    for (const input of [{ kind: "tbd" as const }, { kind: "tbd" as const, bestGuess: "peristaltic" }]) {
      const p = ask(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", input);
      expect(verificationProblem(p, PUMP_RU)).toMatch(/TBD|to be determined/i);
    }
  });

  it("refuses a best guess that is not a valid value, a made-up date, and a parameter guess given for the whole question", () => {
    expect(() => ask(base(), "fill.pump", "target", { kind: "tbd", bestGuess: "not_an_option" })).toThrow(AnswerError);
    expect(() => ask(base(), "fill.pump", "target", { kind: "tbd", due: "2026-02-31" })).toThrow(/real date/);
    expect(() => ask(base(), "comp.mixing_speed", "target", { kind: "tbd", bestGuess: { value: 1, unit: "rpm" } })).toThrow(/per field/);
    expect(isIsoDate("2026-10-21")).toBe(true);
    expect(isIsoDate("21/10/2026")).toBe(false);
  });

  it("every TBD change is change-logged with the best guess, owner, due date and note", () => {
    const p = ask(base(), "fill.pump", "target", { kind: "tbd", bestGuess: "peristaltic", owner: "O", due: "2026-12-01", note: "N" });
    const rec = p.changeLog.filter((c) => c.path === PUMP_RU).at(-1)!;
    expect(rec.after).toMatchObject({ status: "tbd", tbd: { bestGuess: "peristaltic", owner: "O", due: "2026-12-01", note: "N" } });
    const p2 = v(p, "fill.pump", "target", "peristaltic");
    const rec2 = p2.changeLog.filter((c) => c.path === PUMP_RU).at(-1)!;
    expect(rec2.before).toMatchObject({ status: "tbd", tbd: { bestGuess: "peristaltic" } });
    expect(getEntry(p2, PUMP_RU)).toMatchObject({ status: "established", value: "peristaltic" });
    expect(getEntry(p2, PUMP_RU)!.tbd).toBeUndefined();
  });

  it("a per-field TBD on a parameter keeps the other fields as values", () => {
    const U = { kind: "tbd" as const };
    const p = ask(base(), "comp.mixing_speed", "target", {
      kind: "composite",
      fields: {
        classification: { kind: "value", value: "KPP" },
        setPoint: { kind: "tbd", bestGuess: { value: 150, unit: "rpm" }, owner: "O" },
        nor: U,
        par: U,
        rangeBasis: U,
      },
    });
    const root = "target.uo.compounding.param.mixing_speed";
    expect(getEntry(p, `${root}.nor`)).toMatchObject({ status: "tbd" });
    expect(getEntry(p, `${root}.setPoint`)).toMatchObject({ status: "tbd" });
    expect(resolveEntry(p, `${root}.setPoint`)).toMatchObject({ status: "established", provisional: true, value: { value: 150, unit: "rpm" } });
  });
});

describe("provisional label reaches the validation plan, document and CSV", () => {
  const p = ask(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", { kind: "tbd", bestGuess: "peristaltic" });
  const a = assess(content, p);

  it("marks the validation plan rows and the plan CSV", () => {
    const plan = buildValidationPlan(content, p, a);
    const rows = plan.filter((r) => r.provisional);
    expect(rows.length).toBeGreaterThan(0);
    const csv = validationPlanToCsv(plan);
    expect(csv.split("\r\n")[0]).toContain("Provisional");
    expect(csv).toContain(PROVISIONAL_LABEL);
  });

  it("labels the gap in the document (differences list, gap table, risk ranking) and lists the TBD in the open items", () => {
    const doc = buildDocument(content, p, a, GEN);
    const text = JSON.stringify(doc.sections);
    expect(text).toContain(PROVISIONAL_LABEL);
    expect(doc.tbdCount).toBe(1);
    expect(doc.meta.find(([k]) => k === "TBD values")).toEqual(["TBD values", "1"]);
    const open = doc.sections.find((s) => s.id === "open-items")!;
    expect(JSON.stringify(open)).toContain("Best guess:");
  });

  it("adds the Provisional column to the gap CSV", () => {
    const csv = gapsToCsv(content, a.gaps, p);
    const lines = csv.split("\n");
    expect(lines[0]).toMatch(/Provisional/);
    expect(csv).toContain(PROVISIONAL_LABEL);
    // A project with no TBD leaves the column empty.
    const none = pair(base(), "fill.pump", "rotary_piston", "peristaltic");
    expect(gapsToCsv(content, assess(content, none).gaps, none)).not.toContain(PROVISIONAL_LABEL);
  });

  it("does not put the overdue status in the document, so the document does not change from day to day", () => {
    const past = ask(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", { kind: "tbd", due: "2000-01-01" });
    const doc = buildDocument(content, past, assess(content, past), GEN);
    expect(JSON.stringify(doc)).not.toMatch(/overdue/i);
    expect(JSON.stringify(doc)).toContain("Due: 2000-01-01");
  });
});

describe("overdue", () => {
  it("is a due date before today; today itself and a missing date are not overdue", () => {
    expect(isOverdue("2026-10-20", "2026-10-21")).toBe(true);
    expect(isOverdue("2026-10-21", "2026-10-21")).toBe(false);
    expect(isOverdue("2026-10-22", "2026-10-21")).toBe(false);
    expect(isOverdue(undefined, "2026-10-21")).toBe(false);
  });

  it("uses the local calendar date", () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("summarises 'N TBD (M overdue)'", () => {
    let p = ask(base(), "fill.pump", "target", { kind: "tbd", due: "2026-10-01" });
    p = ask(p, "fill.pump", "source", { kind: "tbd", due: "2026-12-01", bestGuess: "rotary_piston" });
    const items = tbdItems(content, p, assess(content, p));
    expect(tbdSummaryText(tbdSummary(items, "2026-10-21"))).toBe("2 TBD (1 overdue)");
    expect(tbdSummary(items, "2026-10-21").withBestGuess).toBe(1);
  });
});

describe("citation location", () => {
  it("renders section and page without doubling the symbols", () => {
    expect(locationText({ section: "4.2", page: "12" })).toBe("§4.2 p.12");
    expect(locationText({ section: "§4.2", page: "p.12" })).toBe("§4.2 p.12");
    expect(locationText({ section: "4.2" })).toBe("§4.2");
    expect(locationText({ page: "12" })).toBe("p.12");
    expect(locationText(undefined)).toBe("");
    expect(locationText({})).toBe("");
  });

  it("shows the location in the document's source text, the register's citing list and the change log", () => {
    const { project, doc } = withDoc(v(base(), "fill.pump", "source", "rotary_piston"));
    const r = citeEntries(project, [PUMP_SU], doc.id, { section: "4.2", page: "12" }, ACTOR);
    const e = getEntry(r.project, PUMP_SU)!;
    expect(e.sourceLocations).toEqual({ [doc.id]: { section: "4.2", page: "12" } });
    expect(r.project.changeLog.at(-1)).toMatchObject({ action: "attach_source", path: PUMP_SU });
    const d = buildDocument(content, r.project, assess(content, r.project), GEN);
    expect(JSON.stringify(d.sections)).toContain("§4.2 p.12");
  });
});

describe("the Answering from bar", () => {
  const start = () => {
    const { project, doc } = withDoc();
    return { project, doc };
  };

  it("turns on, persists in the project, is change-logged, and turns off", () => {
    const { project, doc } = start();
    const on = setAnsweringFrom(project, { sourceId: doc.id, sides: "both", section: "4.2", page: "12" }, ACTOR);
    expect(answeringFrom(on)).toMatchObject({ sourceId: doc.id, sides: "both", section: "4.2", page: "12" });
    expect(on.changeLog.at(-1)?.action).toBe("set_answering_from");
    // Setting the same thing again changes nothing.
    expect(setAnsweringFrom(on, { sourceId: doc.id, sides: "both", section: "4.2", page: "12" }, ACTOR)).toBe(on);
    const off = clearAnsweringFrom(on, ACTOR);
    expect(answeringFrom(off)).toBeUndefined();
    expect(off.changeLog.at(-1)?.action).toBe("clear_answering_from");
    expect(clearAnsweringFrom(off, ACTOR)).toBe(off);
  });

  it("refuses something that is not a document in the register", () => {
    const { project } = start();
    expect(() => setAnsweringFrom(project, { sourceId: "src-nope", sides: "both" }, ACTOR)).toThrow(DraftingError);
    const note = addSource(project, { type: "user_entry", label: "A note (fictional)" }, ACTOR);
    expect(() => setAnsweringFrom(note.project, { sourceId: note.source.id, sides: "both" }, ACTOR)).toThrow(DraftingError);
  });

  /** Saves an answer the way the Interview page does: the answer, then the automatic citation. */
  const save = (p: Project, qid: string, side: "source" | "target" | "shared", input: Parameters<typeof ask>[3]) => {
    const answered = ask(p, qid, side, input);
    return autoCiteAnswer(answered, inst(qid, side), A2);
  };

  it("SU cites only the SU side of a paired card, RU only the RU side, Both each side", () => {
    const { project, doc } = start();
    const cases = [
      ["source", { su: true, ru: false }],
      ["target", { su: false, ru: true }],
      ["both", { su: true, ru: true }],
    ] as const;
    for (const [sides, want] of cases) {
      let p = setAnsweringFrom(project, { sourceId: doc.id, sides }, ACTOR);
      const su = save(p, "fill.pump", "source", { kind: "value", value: "rotary_piston" });
      p = su.project;
      const ru = save(p, "fill.pump", "target", { kind: "value", value: "peristaltic" });
      expect(getEntry(su.project, PUMP_SU)!.sourceIds.includes(doc.id), `${sides} SU`).toBe(want.su);
      expect(getEntry(ru.project, PUMP_RU)!.sourceIds.includes(doc.id), `${sides} RU`).toBe(want.ru);
    }
  });

  it("'Both' also covers a scoping answer; SU only or RU only does not", () => {
    const { project, doc } = start();
    const both = setAnsweringFrom(project, { sourceId: doc.id, sides: "both" }, ACTOR);
    expect(save(both, "scope.program", "shared", { kind: "value", value: "TST-9" }).cited).toHaveLength(1);
    const su = setAnsweringFrom(project, { sourceId: doc.id, sides: "source" }, ACTOR);
    expect(save(su, "scope.program", "shared", { kind: "value", value: "TST-9" }).cited).toHaveLength(0);
  });

  it("cites a value, not applicable and a TBD with a best guess; never unknown, a TBD without a guess, or same as SU", () => {
    const { project, doc } = start();
    const bar = setAnsweringFrom(v(project, "fill.pump", "source", "rotary_piston"), { sourceId: doc.id, sides: "both" }, ACTOR);
    const cites = (input: Parameters<typeof ask>[3]) => save(bar, "fill.pump", "target", input).cited.length;
    expect(cites({ kind: "value", value: "peristaltic" })).toBe(1);
    expect(cites({ kind: "not_applicable", justification: "Not used (fictional)" })).toBe(1);
    expect(cites({ kind: "tbd", bestGuess: "peristaltic" })).toBe(1);
    expect(cites({ kind: "tbd" })).toBe(0);
    expect(cites({ kind: "tbd", owner: "O" })).toBe(0);
    expect(cites({ kind: "same_as_source" })).toBe(0);
  });

  it("keeps the previous source list exactly when undone, and logs the removal", () => {
    const { project, doc } = start();
    const bar = setAnsweringFrom(project, { sourceId: doc.id, sides: "both", section: "4.2", page: "12" }, ACTOR);
    const answered = ask(bar, "fill.pump", "source", { kind: "value", value: "rotary_piston" });
    const before = structuredClone(getEntry(answered, PUMP_SU)!.sourceIds);
    const cited = autoCiteAnswer(answered, inst("fill.pump", "source"), A2);
    expect(getEntry(cited.project, PUMP_SU)!.sourceIds).toEqual([...before, doc.id]);
    const undone = undoCitations(cited.project, cited.cited, A2);
    expect(undone.undone).toEqual([PUMP_SU]);
    const e = getEntry(undone.project, PUMP_SU)!;
    expect(e.sourceIds).toEqual(before);
    expect(e.sourceLocations).toBeUndefined();
    expect(undone.project.changeLog.at(-1)).toMatchObject({ path: PUMP_SU });
    expect(undone.project.changeLog.length).toBeGreaterThan(cited.project.changeLog.length);
  });

  it("does not undo a citation on an entry that was answered again since", () => {
    const { project, doc } = start();
    const bar = setAnsweringFrom(project, { sourceId: doc.id, sides: "both" }, ACTOR);
    const first = save(bar, "fill.pump", "source", { kind: "value", value: "rotary_piston" });
    const reanswered = ask(first.project, "fill.pump", "source", { kind: "value", value: "peristaltic" });
    const undone = undoCitations(reanswered, first.cited, A2);
    expect(undone.undone).toEqual([]);
    expect(undone.project).toBe(reanswered);
  });

  it("keeps the recorded place of a document that is ticked again when the same value is saved", () => {
    const { project, doc } = start();
    const withLoc = citeEntries(v(project, "fill.pump", "source", "rotary_piston"), [PUMP_SU], doc.id, { section: "3", page: "7" }, ACTOR).project;
    const ref = { identifier: "DEMO-DOC-1", docType: "Report", title: "Fictional report" };
    const again = ask(withLoc, "fill.pump", "source", { kind: "value", value: "rotary_piston" }, ACTOR, [ref]);
    expect(getEntry(again, PUMP_SU)!.sourceLocations).toEqual({ [doc.id]: { section: "3", page: "7" } });
  });
});

describe("bulk cite (Link values)", () => {
  function scene() {
    const { project, doc } = withDoc(v(v(base(), "fill.pump", "source", "rotary_piston"), "fill.pump", "target", "peristaltic"));
    // One valueless entry (unknown) and one TBD without a guess, which must never be cited.
    let p = ask(project, "fill.container", "source", { kind: "tbd" });
    p = ask(p, "fill.container", "target", { kind: "tbd", owner: "O" });
    return { project: p, doc };
  }

  it("lists only entries that hold a value", () => {
    const { project, doc } = scene();
    const rows = linkCandidates(content, project, doc.id);
    expect(rows.some((r) => r.ref === PUMP_SU)).toBe(true);
    expect(rows.every((r) => hasCitableValue(getEntry(project, r.ref)))).toBe(true);
    expect(rows.some((r) => r.ref.includes("fill.container") || r.ref.includes("container.type"))).toBe(false);
  });

  it("cites the valued entries with one change-log record each, and skips the valueless ones", () => {
    const { project, doc } = scene();
    const valueless = ["source.uo.aseptic_filling.mat.container.type", "target.uo.aseptic_filling.mat.container.type"].filter((r) => getEntry(project, r));
    const refs = [PUMP_SU, PUMP_RU, ...valueless];
    const logBefore = project.changeLog.length;
    const r = citeEntries(project, refs, doc.id, { section: "6.1", page: "9" }, ACTOR);
    expect(r.cited.map((c) => c.ref).sort()).toEqual([PUMP_RU, PUMP_SU].sort());
    expect(r.skipped.filter((s) => s.reason === "no_value").map((s) => s.ref).sort()).toEqual([...valueless].sort());
    expect(r.project.changeLog.length - logBefore).toBe(2);
    for (const c of ["attach_source"]) expect(r.project.changeLog.slice(logBefore).every((x) => x.action === c)).toBe(true);
    for (const ref of valueless) expect(getEntry(r.project, ref)!.sourceIds.includes(doc.id)).toBe(false);
  });

  it("is idempotent: citing again changes nothing and reports them as already cited", () => {
    const { project, doc } = scene();
    const once = citeEntries(project, [PUMP_SU, PUMP_RU], doc.id, { page: "3" }, ACTOR);
    const twice = citeEntries(once.project, [PUMP_SU, PUMP_RU], doc.id, { page: "4" }, ACTOR);
    expect(twice.cited).toHaveLength(0);
    expect(twice.skipped.map((s) => s.reason)).toEqual(["already_cited", "already_cited"]);
    expect(twice.project).toBe(once.project);
    expect(getEntry(twice.project, PUMP_SU)!.sourceLocations![doc.id]).toEqual({ page: "3" });
    const rows = linkCandidates(content, twice.project, doc.id);
    expect(rows.find((r) => r.ref === PUMP_SU)).toMatchObject({ citedHere: true, location: "p.3" });
  });

  it("filters by side, section, text and 'not yet cited to any document'", () => {
    const { project, doc } = scene();
    const other = addSource(project, { type: "document_reference", docRef: { identifier: "DEMO-DOC-9", docType: "Report" } }, ACTOR);
    const cited = citeEntries(other.project, [PUMP_SU], other.source.id, undefined, ACTOR).project;
    const rows = linkCandidates(content, cited, doc.id);
    expect(filterLinkCandidates(rows, { side: "source" }).every((r) => r.label.side === "source")).toBe(true);
    expect(filterLinkCandidates(rows, { side: "target" }).every((r) => r.label.side === "target")).toBe(true);
    const uncited = filterLinkCandidates(rows, { onlyUncited: true });
    expect(uncited.some((r) => r.ref === PUMP_SU)).toBe(false);
    expect(uncited.some((r) => r.ref === PUMP_RU)).toBe(true);
    const sec = rows.find((r) => r.ref === PUMP_RU)!.label.sectionId!;
    expect(filterLinkCandidates(rows, { sectionId: sec }).every((r) => r.label.sectionId === sec)).toBe(true);
    expect(filterLinkCandidates(rows, { text: "pump" }).length).toBeGreaterThan(0);
    expect(filterLinkCandidates(rows, { text: "zzzz-no-such" })).toHaveLength(0);
  });
});
