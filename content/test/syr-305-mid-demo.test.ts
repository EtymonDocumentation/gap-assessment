import { assess, buildDemoProject, buildTrdDocument, mbrOpenItems, openBlankCount, riskOpenItems, samplingOpenItems, tbdItems, tbdSummary, trdOpenItems, writeupsInOrder } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { expectNoPrivateTerms } from "../../test-support/private-terms";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

// The third demo: SYR-305 part-way through the transfer. The same product, sites and numbers as the finished SYR-305 demo, with the kind of
// open items a receiving site really has at PPQ stage (studies not reported, documents in draft, a supplier answer awaited). The counts below
// are the ones the demo was designed to show; a change to the script that moves one has to change this test on purpose.
const build = (id: "syr-305" | "syr-305-mid") =>
  buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const project = build("syr-305-mid");
const done = build("syr-305");
const doc = project.trd.documents[0]!;
const TODAY = "2026-11-13";
const blanksOf = (p: typeof project) => writeupsInOrder(p.trd.documents[0]!).reduce((n, w) => n + openBlankCount({ project: p, doc: p.trd.documents[0]!, content }, w), 0);

describe("SYR-305 mid-transfer demo", () => {
  it("is its own demo with its own title, next to the finished SYR-305", () => {
    expect(Object.keys(demos)).toContain("syr-305-mid");
    expect(project.meta.demo).toBe(true);
    expect(project.meta.title).toContain("mid-transfer");
    expect(project.meta.title).not.toBe(done.meta.title);
    // Neither title is the start of the other, so opening one demo never finds the other's copy in My projects.
    expect(project.meta.title.startsWith(done.meta.title)).toBe(false);
    expect(done.meta.title.startsWith(project.meta.title)).toBe(false);
  });

  it("keeps the same product, sites and steps as the finished demo", () => {
    expect(doc.steps.map((s) => s.key)).toEqual(done.trd.documents[0]!.steps.map((s) => s.key));
    const text = (p: typeof project) => p.answers.filter((a) => ["site.name", "scope.program", "site.line"].includes(a.questionId)).map((a) => `${a.questionId}@${a.side}=${JSON.stringify(a.raw)}`);
    expect(text(project)).toEqual(text(done));
  });

  it("has nine gap questions still open: eleven entries (two parameters carry two fields), three with a best guess", () => {
    const a = assess(content, project);
    const tbd = tbdItems(content, project, a);
    expect(a.openItems).toHaveLength(11);
    expect(new Set(tbd.map((t) => t.questionId)).size).toBe(9);
    expect(tbdSummary(tbd, TODAY)).toEqual({ total: 11, overdue: 3, withBestGuess: 3 });
    // Every TBD says what is awaited and who owns it, with a date; no one is named (roles only, marked fictional).
    for (const t of tbd) {
      expect(t.note, t.questionId).toBeTruthy();
      expect(t.owner, t.questionId).toMatch(/\(fictional\)/);
      expect(t.due, t.questionId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("has three overdue items on the demo date and the rest due after it", () => {
    const tbd = tbdItems(content, project, assess(content, project));
    const late = tbd.filter((t) => t.due! < TODAY);
    expect(new Set(late.map((t) => t.questionId))).toEqual(new Set(["filt.sua_supplier", "filt.filtration_time", "rt.ambient_time"]));
    expect(tbd.filter((t) => t.due! >= TODAY).every((t) => t.due! > TODAY)).toBe(true);
  });

  it("shows every open gap answer as open in the TRD, and the TRD number is entries plus blanks", () => {
    const open = trdOpenItems(doc);
    expect(open).toHaveLength(11);
    expect(open.filter((o) => o.kind === "provisional")).toHaveLength(3);
    expect(open.filter((o) => o.kind === "tbd")).toHaveLength(8);
    expect(blanksOf(project)).toBe(10);
  });

  it("carries the open items on into the sampling plan, the batch record and the risk assessment", () => {
    const plan = samplingOpenItems(content, project, project.sampling.plans[0]!);
    expect(plan.filter((o) => o.kind === "point")).toHaveLength(2);
    expect(plan).toHaveLength(3);
    expect(project.sampling.plans[0]!.readiness?.filter((r) => r.status === "open").map((r) => r.key).sort()).toEqual(["batch_records", "equipment_qualified", "methods_ready", "training"]);
    const mbr = mbrOpenItems(project, project.mbr.records[0]!, mbrLibrary);
    expect(mbr).toHaveLength(6);
    expect(mbr.find((o) => o.kind === "trd_open")?.text).toContain("11 open items");
    expect(riskOpenItems(project, project.risk.assessments[0]!).filter((r) => r.kind === "accepted-missing")).toHaveLength(4);
  });

  it("leaves the finished SYR-305 demo with no open item, no open blank and no TBD", () => {
    expect(assess(content, done).openItems).toEqual([]);
    expect(trdOpenItems(done.trd.documents[0]!)).toEqual([]);
    expect(blanksOf(done)).toBe(0);
  });

  it("exports a TRD that lists its open items", () => {
    const text = JSON.stringify(buildTrdDocument(project, doc, { content, generatedAt: "2026-11-13T09:00:00.000Z" }));
    expect(text).toContain("To be decided (TBD)");
    expect(text).toContain("Single-use assembly supplier");
  });

  it("names only fictional people and companies and carries no client code or supplier brand", () => {
    const raw = JSON.stringify(demos["syr-305-mid"]);
    const text = JSON.stringify(project) + JSON.stringify(buildTrdDocument(project, doc)) + raw;
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}/);
    expectNoPrivateTerms(text);
    for (const n of ["Alex Example", "Sam Example", "Robin Example", "Example Biologics", "Example Fill Site"]) {
      for (const m of text.matchAll(new RegExp(`${n}.{0,50}`, "g"))) expect(m[0], m[0]).toContain("(fictional");
    }
  });
});
