// M13 job 4C: the optional "Excipients used" table of a batch record (MBR format 1.3.0, schema 1.32.0).
// The copy, the offer (only TRD-linked lines), the "changed since" rule, a deleted source, removal with a reason, the printed document.
// Fictional data only.
import { describe, expect, it, vi } from "vitest";
import { parseProject, type MbrRecord, type Project } from "@gap/process-model";
import {
  MBR_EXCIPIENTS_CHANGED,
  MBR_EXCIPIENTS_GONE,
  MBR_EXCIPIENTS_NOT_ESTABLISHED,
  MBR_EXCIPIENTS_TITLE,
  MbrError,
  addExcipientLine,
  addExcipientsUsed,
  buildDemoProject,
  buildMbrDocument,
  createExcipientAssessment,
  deleteExcipientLine,
  excipientCopyOf,
  mbrExcipientNotices,
  mbrExcipientOffers,
  mbrExcipientStates,
  mbrExcipientTableRow,
  removeExcipientUsed,
  removeExcipientsUsedTable,
  setExcipientFact,
  updateExcipientLine,
  updateExcipientUsed,
  createMbr,
} from "@gap/engine";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "../../../content/index";
import { ACTOR } from "./helpers";

vi.setConfig({ testTimeout: 60000 });

const later = (n: number) => ({ ...ACTOR, at: `2027-01-01T10:${String(n).padStart(2, "0")}:00.000Z` });

/** The ARX-217 demo with one more excipient assessment whose lines are linked, or not, to the demo TRD. */
function setup() {
  let p: Project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
  const trd = p.trd.documents[0]!;
  const link = { trdId: trd.id, stepKey: "buffer", itemKey: "buffer_a" };
  const made = createExcipientAssessment(p, { title: "Test excipients (fictional)" }, ACTOR);
  p = made.project;
  const aId = made.assessmentId;
  const add = (name: string, linked: boolean) => {
    const r = addExcipientLine(p, aId, { name }, ACTOR);
    p = r.project;
    if (linked) p = updateExcipientLine(p, aId, r.lineId, { trdItem: link }, later(0));
    return r.lineId;
  };
  const linked = add("Linked salt (fictional)", true);
  const second = add("Second linked salt (fictional)", true);
  const unlinked = add("Unlinked sugar (fictional)", false);
  const r = createMbr(p, { title: "Excipients test record (fictional)", trdId: trd.id, sections: [{ unitOp: "compounding", title: "Compounding", blocks: [mbrLibrary.find((b) => b.id === "dilution_and_mixing")!] }] }, ACTOR);
  return { p: r.project, id: r.recordId, aId, linked, second, unlinked };
}
const rec = (p: Project, id: string): MbrRecord => p.mbr.records.find((r) => r.id === id)!;

describe("what can be added", () => {
  it("offers only lines linked to the TRD of the record, and nothing is in the table by itself", () => {
    const { p, id, aId, linked, second, unlinked } = setup();
    expect(rec(p, id).excipients).toBeUndefined();
    const offered = mbrExcipientOffers(p, rec(p, id)).offers.filter((o) => o.assessmentId === aId).map((o) => o.lineId);
    expect(offered).toEqual([linked, second]);
    expect(offered).not.toContain(unlinked);
  });

  it("says in one sentence why there is nothing: no linked lines, or all of them already added", () => {
    let p = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
    const trd = p.trd.documents[0]!;
    // Start from a project without any excipient link to this TRD.
    for (const a of p.excipients!.assessments) for (const l of a.lines) delete l.links.trdItem;
    p = createMbr(p, { title: "Bare record (fictional)", trdId: trd.id, sections: [] }, ACTOR).project;
    const bare = p.mbr.records.at(-1)!;
    const none = mbrExcipientOffers(p, bare);
    expect(none.offers).toEqual([]);
    expect(none.none).toBe(`No excipient lines are linked to ${trd.id} yet.`);

    const s = setup();
    const all = mbrExcipientOffers(s.p, rec(s.p, s.id)).offers.map((o) => ({ assessmentId: o.assessmentId, lineId: o.lineId }));
    const done = addExcipientsUsed(s.p, s.id, all, ACTOR);
    const again = mbrExcipientOffers(done, rec(done, s.id));
    expect(again.offers).toEqual([]);
    expect(again.none).toMatch(/is already in the table/);
  });

  it("a record without a TRD says it was not started from one", () => {
    const s = setup();
    const r = createMbr(s.p, { title: "No TRD (fictional)", sections: [] }, ACTOR);
    expect(mbrExcipientOffers(r.project, rec(r.project, r.recordId)).none).toMatch(/not started from a TRD/);
  });
});

describe("the copy", () => {
  it("keeps its own name, grade statement and specification reference, its origin and the line's updatedAt, and logs one event per row", () => {
    const s = setup();
    let p = setExcipientFact(s.p, s.aId, s.linked, "grade", "receiving", { kind: "value", value: ["ph_eur", "usp_nf"] }, ACTOR);
    p = setExcipientFact(p, s.aId, s.linked, "gradeEdition", "receiving", { kind: "value", value: "Edition 11" }, ACTOR);
    const lineAt = p.excipients!.assessments.find((a) => a.id === s.aId)!.lines.find((l) => l.id === s.linked)!.updatedAt;
    const before = p.changeLog.length;
    const next = addExcipientsUsed(p, s.id, [{ assessmentId: s.aId, lineId: s.linked }, { assessmentId: s.aId, lineId: s.second }], later(5));
    const rows = rec(next, s.id).excipients!;
    expect(rows.map((x) => x.id)).toEqual(["EU-001", "EU-002"]);
    expect(rows[0]).toMatchObject({ name: "Linked salt (fictional)", grade: "Ph. Eur., USP-NF. Monograph edition: Edition 11.", from: { assessmentId: s.aId, lineId: s.linked, updatedAt: lineAt }, copiedAt: later(5).at });
    // Nothing is filled in for a value the assessment does not hold.
    expect(rows[1]!.grade).toBeUndefined();
    expect(rows[1]!.specification).toBeUndefined();
    expect(mbrExcipientTableRow(rows[1]!)).toEqual(["Second linked salt (fictional)", MBR_EXCIPIENTS_NOT_ESTABLISHED, MBR_EXCIPIENTS_NOT_ESTABLISHED, `${s.aId}, ${s.second}`]);
    const events = next.changeLog.slice(before);
    expect(events.map((e) => e.action)).toEqual(["mbr_excipient_add", "mbr_excipient_add"]);
    expect(events[0]!.path).toBe(`mbr.${s.id}.excipients.EU-001`);
    expect(rec(next, s.id).updatedAt).toBe(later(5).at);
    expect(rec(s.p, s.id).excipients).toBeUndefined(); // the project it was given is untouched
  });

  it("refuses a line that is not linked to the TRD, one that is not there and a duplicate; nothing changes", () => {
    const s = setup();
    expect(() => addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.unlinked }], ACTOR)).toThrow(/not linked to the TRD/);
    expect(() => addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: "EXL-099" }], ACTOR)).toThrow(MbrError);
    const one = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], ACTOR);
    expect(() => addExcipientsUsed(one, s.id, [{ assessmentId: s.aId, lineId: s.linked }], ACTOR)).toThrow(/already in the table/);
  });

  it("the copy equals the live values at that moment (excipientCopyOf)", () => {
    const s = setup();
    expect(excipientCopyOf(s.p, s.aId, s.linked)).toEqual({ name: "Linked salt (fictional)", grade: "", specification: "" });
    expect(excipientCopyOf(s.p, s.aId, "EXL-099")).toBeUndefined();
  });
});

describe("changed since the copy", () => {
  it("is current until the line is edited, then 'changed'; only the Update brings it level, and the old values stay in the log", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    expect(mbrExcipientStates(p, rec(p, s.id)).get("EU-001")).toBe("current");
    p = updateExcipientLine(p, s.aId, s.linked, { name: "Linked salt, renamed (fictional)" }, later(2));
    expect(mbrExcipientStates(p, rec(p, s.id)).get("EU-001")).toBe("changed");
    const notice = mbrExcipientNotices(p, rec(p, s.id))[0]!;
    expect(notice).toMatchObject({ rowId: "EU-001", state: "changed", differs: ["name"], now: { name: "Linked salt, renamed (fictional)" } });
    expect(rec(p, s.id).excipients![0]!.name).toBe("Linked salt (fictional)"); // never changes by itself
    const before = p.changeLog.length;
    p = updateExcipientUsed(p, s.id, "EU-001", later(3));
    expect(rec(p, s.id).excipients![0]).toMatchObject({ name: "Linked salt, renamed (fictional)", copiedAt: later(3).at });
    expect(mbrExcipientStates(p, rec(p, s.id)).get("EU-001")).toBe("current");
    const ev = p.changeLog.slice(before);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "mbr_excipient_update", before: { name: "Linked salt (fictional)" }, after: { name: "Linked salt, renamed (fictional)" } });
  });

  it("a newer line with the same three values is not 'changed': the copy is still current and nothing is offered", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    p = setExcipientFact(p, s.aId, s.linked, "supplier", "receiving", { kind: "value", value: "Supplier One (fictional)" }, later(2));
    const notice = mbrExcipientNotices(p, rec(p, s.id))[0]!;
    expect(notice.state).toBe("current");
    expect(notice.differs).toEqual([]);
    expect(mbrExcipientStates(p, rec(p, s.id)).get("EU-001")).toBe("current");
  });

  it("a newer grade statement shows as a difference in the grade", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    p = setExcipientFact(p, s.aId, s.linked, "grade", "receiving", { kind: "value", value: ["jp"] }, later(2));
    expect(mbrExcipientNotices(p, rec(p, s.id))[0]).toMatchObject({ state: "changed", differs: ["grade"], now: { grade: "JP." } });
  });

  it("a line deleted from the assessment is said to be gone, the copy stays, and an update is refused", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    p = deleteExcipientLine(p, s.aId, s.linked, "Test removal", later(2));
    expect(mbrExcipientStates(p, rec(p, s.id)).get("EU-001")).toBe("gone");
    expect(mbrExcipientNotices(p, rec(p, s.id))[0]).toMatchObject({ state: "gone", differs: [] });
    expect(rec(p, s.id).excipients![0]!.name).toBe("Linked salt (fictional)");
    expect(() => updateExcipientUsed(p, s.id, "EU-001", later(3))).toThrow(/no longer in the excipient assessment/);
  });
});

describe("removing", () => {
  it("one row, with a reason that is kept; a missing reason is refused; ids are never reused", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }, { assessmentId: s.aId, lineId: s.second }], later(1));
    expect(() => removeExcipientUsed(p, s.id, "EU-001", "  ", later(2))).toThrow(/Say why/);
    expect(() => removeExcipientUsed(p, s.id, "EU-009", "Because", later(2))).toThrow(MbrError);
    const before = p.changeLog.length;
    p = removeExcipientUsed(p, s.id, "EU-001", "Not used in this batch", later(2));
    expect(rec(p, s.id).excipients!.map((x) => x.id)).toEqual(["EU-002"]);
    const ev = p.changeLog.slice(before);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "mbr_excipient_remove", before: { id: "EU-001", name: "Linked salt (fictional)" }, after: { reason: "Not used in this batch" } });
    expect(ev[0]!.detail).toContain("Not used in this batch");
    // The line can be added again; it gets a new id, never EU-001 again.
    p = addExcipientsUsed(p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(3));
    expect(rec(p, s.id).excipients!.map((x) => x.id)).toEqual(["EU-002", "EU-003"]);
  });

  it("removing the last row leaves no table, and the whole table can be removed in one logged event", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    p = removeExcipientUsed(p, s.id, "EU-001", "Not used", later(2));
    expect(rec(p, s.id).excipients).toBeUndefined();

    p = addExcipientsUsed(p, s.id, [{ assessmentId: s.aId, lineId: s.linked }, { assessmentId: s.aId, lineId: s.second }], later(3));
    expect(() => removeExcipientsUsedTable(p, s.id, "", later(4))).toThrow(/Say why/);
    const before = p.changeLog.length;
    p = removeExcipientsUsedTable(p, s.id, "Table not wanted", later(4));
    expect(rec(p, s.id).excipients).toBeUndefined();
    const ev = p.changeLog.slice(before);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "mbr_excipient_table_remove", path: `mbr.${s.id}.excipients`, after: { reason: "Table not wanted" } });
    expect((ev[0]!.before as unknown[]).length).toBe(2);
  });
});

describe("file format", () => {
  it("a record with the table survives a file round trip; a 1.31.0 file reads and moves only its version", () => {
    const s = setup();
    const p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }], later(1));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const raw = JSON.parse(JSON.stringify(s.p));
    raw.schemaVersion = "1.31.0";
    const old = parseProject(raw);
    expect(old.schemaVersion).toBe("1.34.0");
    expect(old.mbr).toEqual(s.p.mbr);
  });

  it("the demos SYR-305 and ARX-217 list the excipients their TRD links to, as many as the links give", () => {
    for (const key of ["syr-305", "arx-217"] as const) {
      const p = buildDemoProject(content, demos[key], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
      const r = p.mbr.records[0]!;
      const linked = p.excipients!.assessments.flatMap((a) => a.lines.filter((l) => l.links.trdItem?.trdId === r.trdId));
      expect(linked.length, key).toBeGreaterThan(0);
      expect(r.excipients?.length, key).toBe(linked.length);
      expect(mbrExcipientOffers(p, r).offers, key).toEqual([]);
    }
  });
});

describe("the printed document", () => {
  it("prints the table in the materials part with the same words, and notes a changed or gone row", () => {
    const s = setup();
    let p = addExcipientsUsed(s.p, s.id, [{ assessmentId: s.aId, lineId: s.linked }, { assessmentId: s.aId, lineId: s.second }], later(1));
    p = updateExcipientLine(p, s.aId, s.linked, { name: "Linked salt, renamed (fictional)" }, later(2));
    p = deleteExcipientLine(p, s.aId, s.second, "Test removal", later(3));
    const doc = JSON.stringify(buildMbrDocument(p, rec(p, s.id)));
    expect(doc).toContain(MBR_EXCIPIENTS_TITLE);
    expect(doc).toContain("Linked salt (fictional)");
    expect(doc).toContain(MBR_EXCIPIENTS_NOT_ESTABLISHED);
    expect(doc).toContain(MBR_EXCIPIENTS_CHANGED);
    expect(doc).toContain(MBR_EXCIPIENTS_GONE);
  });

  it("prints nothing about it when the table is empty", () => {
    const s = setup();
    expect(JSON.stringify(buildMbrDocument(s.p, rec(s.p, s.id)))).not.toContain(MBR_EXCIPIENTS_TITLE);
  });
});
