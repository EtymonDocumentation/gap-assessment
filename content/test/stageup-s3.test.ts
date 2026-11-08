// STAGEUP job S3: comparing two versions, and the version stamp every document carries. Fictional data only.
import {
  buildDemoProject,
  changeProjectStage,
  COMPARE_LEFT_OUT,
  compareChangeWord,
  compareCounts,
  compareSummary,
  compareToCsv,
  compareVersions,
  documentHeaderLine,
  ensureStartVersion,
  loggedBetween,
  NO_VERSION_HISTORY,
  openSide,
  projectStage,
  recordExport,
  saveVersion,
  savedVersionStamp,
  stampDocument,
  WORKING_COPY_LABEL,
  workingCopyStamp,
  buildDocument,
  assess,
  type CompareRow,
} from "@gap/engine";
import { emptyProject, type Actor, type Project } from "@gap/process-model";
import { renderHtml } from "@gap/renderers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 180_000 });

const ACTOR: Actor = { name: "A. Tester (fictional)", at: "2026-11-04T09:00:00.000Z" };
const at = (n: number): Actor => ({ ...ACTOR, at: `2026-11-04T09:${String(n).padStart(2, "0")}:00.000Z` });

let demo: Project;
beforeAll(() => {
  demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
}, 120_000);

describe("compareVersions", () => {
  it("finds nothing between identical projects, with and without unchanged items", () => {
    expect(compareVersions(content, demo, structuredClone(demo))).toEqual([]);
    const withSame = compareVersions(content, demo, structuredClone(demo), { includeSame: true });
    expect(withSame.length).toBeGreaterThan(50);
    expect(withSame.every((r) => r.kind === "same" && r.a === r.b)).toBe(true);
    expect(compareSummary(withSame)).toBe("No differences between these two.");
  });

  it("shows the project stage as a gap row, with the words the documents use", async () => {
    const before = await ensureStartVersion(demo, ACTOR);
    const to = projectStage(before) === "clinical" ? "ppq" : "clinical";
    const after = (await changeProjectStage(before, content, to, at(1), "Stage moved for the test")).project;
    const rows = compareVersions(content, before, after);
    const stage = rows.find((r) => r.doc === "gap" && /stage/i.test(r.item));
    expect(stage, "the stage answer").toBeTruthy();
    expect(stage!.kind).toBe("changed");
    expect(stage!.a).not.toBe(stage!.b);
    expect(compareChangeWord("changed", "v2")).toBe("Changed");
  });

  it("reports changed, added and removed items in the TRD, sampling plan, batch record and risk", () => {
    const b = structuredClone(demo);
    // TRD: a text, a step description.
    b.trd.documents[0]!.purpose = "New purpose text (fictional).";
    // Sampling plan: one point's rationale changed, one point removed, one added.
    const plan = b.sampling.plans[0]!;
    const first = plan.points[0]!;
    first.rationale = "Changed rationale (fictional).";
    const removed = plan.points.pop()!;
    plan.points.push({ ...structuredClone(first), id: "SP-999", attribute: "Added attribute (fictional)" });
    // Batch record: a step text.
    const step = b.mbr.records[0]!.sections.flatMap((s) => s.blocks).flatMap((x) => x.steps)[0]!;
    step.text = "Changed step text (fictional).";
    // Risk: the scope note.
    b.risk.assessments[0]!.scopeNote = "Changed scope (fictional).";
    const rows = compareVersions(content, demo, b);
    const by = (doc: string) => rows.filter((r) => r.doc === doc);
    expect(by("trd").some((r) => r.item === "Purpose" && r.kind !== "same" && r.b === "New purpose text (fictional).")).toBe(true);
    expect(by("sampling").some((r) => r.kind === "changed" && r.item === "Rationale" && r.b === "Changed rationale (fictional).")).toBe(true);
    expect(by("sampling").some((r) => r.kind === "removed" && r.item.includes(removed.id))).toBe(true);
    const added = by("sampling").find((r) => r.kind === "added" && r.item.includes("SP-999"));
    expect(added, "the added point").toBeTruthy();
    expect(added!.a).toBe("");
    expect(by("mbr").some((r) => r.kind === "changed" && r.b === "Changed step text (fictional).")).toBe(true);
    expect(by("risk").some((r) => /scope/i.test(r.item) && r.kind === "changed")).toBe(true);
    const counts = compareCounts(rows);
    expect(counts.trd + counts.sampling + counts.mbr + counts.risk).toBeGreaterThanOrEqual(6);
    expect(compareSummary(rows)).toMatch(/^\d+ changes: /);
    // The other direction turns added into removed.
    const back = compareVersions(content, b, demo);
    expect(back.some((r) => r.kind === "added" && r.item.includes(removed.id))).toBe(true);
    expect(back.some((r) => r.kind === "removed" && r.item.includes("SP-999"))).toBe(true);
  });

  it("uses the working copy as a side and reads a saved version back", async () => {
    let p = await ensureStartVersion(demo, ACTOR);
    p = (await saveVersion(p, at(2), "before")).project;
    const label = p.versionHistory!.entries.at(-1)!.label;
    const edited = structuredClone(p);
    edited.risk.assessments[0]!.scopeNote = "Edited after the version (fictional).";
    const saved = await openSide(edited, label);
    const working = await openSide(edited, WORKING_COPY_LABEL);
    expect(working).toBe(edited);
    expect(saved).not.toBeNull();
    const rows = compareVersions(content, saved!, working!);
    expect(rows.filter((r) => r.kind !== "same")).toHaveLength(1);
    expect(rows[0]!.b).toBe("Edited after the version (fictional).");
    expect(await openSide(edited, "v99")).toBeNull();
    expect(loggedBetween(saved!, working!)).toBe(0);
    expect(compareChangeWord("added", WORKING_COPY_LABEL)).toBe("Added in the working copy");
    expect(compareChangeWord("removed", "v2.1")).toBe("Removed in v2.1");
  });

  it("writes a CSV where every cell is quoted and formulas are neutralised", () => {
    const rows: CompareRow[] = [{ doc: "trd", area: "TRD", item: "Purpose", kind: "changed", a: "=SUM(1)", b: 'say "hi"' }];
    const csv = compareToCsv(rows, "v2", "Working copy");
    expect(csv.split("\r\n")[0]).toBe('"Document","Area","Item","Change","v2","Working copy"');
    expect(csv).toContain(`"'=SUM(1)"`);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"Changed"');
  });

  it("counts the changes logged between two versions", () => {
    const a = emptyProject({ title: "A (fictional)", actor: ACTOR, contentRefs: content.versions });
    const b = structuredClone(a);
    b.changeLog.push({ at: ACTOR.at, by: ACTOR.name, action: "answer", detail: "x" } as never);
    expect(loggedBetween(a, b)).toBe(1);
    expect(loggedBetween(b, a)).toBe(1);
  });

  // Code review CR-02: the comparison used to read the TRD's details, steps and limits only, so a changed hold time in a write-up, a
  // typed blank or a sign-off line gave "No differences between these two."
  describe("the TRD write-ups and approvals", () => {
    const stamp = { by: "A. Tester (fictional)", at: "2026-11-04T09:00:00.000Z" };
    /** The demo TRD with one write-up of our own (fixed id, so it is the same item on both sides). */
    const withWriteup = (text: string, hold?: string): Project => {
      const p = structuredClone(demo);
      const d = p.trd.documents[0]!;
      d.writeups = [
        ...(d.writeups ?? []).filter((w) => w.id !== "WU-90"),
        {
          id: "WU-90",
          kind: "section",
          key: "compare_test_section",
          title: "Hold section (fictional)",
          parts: [{ id: "intro", kind: "paragraph", text }],
          ...(hold ? { values: { holdTime: { value: hold, ...stamp } } } : {}),
        },
      ];
      return p;
    };
    const trdRows = (a: Project, b: Project) => compareVersions(content, a, b).filter((r) => r.doc === "trd");

    it("shows a changed write-up text", () => {
      const rows = trdRows(withWriteup("Hold for {{holdTime|Hold time}} before filling."), withWriteup("Hold for {{holdTime|Hold time}} before filling and filtering."));
      const r = rows.find((x) => x.item === "Text");
      expect(r, "the part text").toBeTruthy();
      expect(r!.kind).toBe("changed");
      expect(r!.a).toContain("before filling.");
      expect(r!.b).toContain("and filtering");
      expect(compareSummary(compareVersions(content, withWriteup("a"), withWriteup("b")))).not.toBe("No differences between these two.");
    });

    it("shows a changed value typed for a blank, labelled by its key", () => {
      const rows = trdRows(withWriteup("Hold {{holdTime|Hold time}}.", "4 h"), withWriteup("Hold {{holdTime|Hold time}}.", "24 h"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.item).toMatch(/hold ?time/i);
      expect([rows[0]!.a, rows[0]!.b]).toEqual(["4 h", "24 h"]);
    });

    it("shows a write-up that was added or removed, by its id and title", () => {
      const before = structuredClone(demo);
      const after = withWriteup("Text (fictional).");
      const added = trdRows(before, after).filter((x) => x.kind === "added");
      expect(added.some((x) => x.item.includes("WU-90") && x.item.includes("Hold section (fictional)"))).toBe(true);
      const removed = trdRows(after, before).filter((x) => x.kind === "removed");
      expect(removed.some((x) => x.item.includes("WU-90"))).toBe(true);
    });

    it("shows a table row, the not-applicable switch and an optional part's switch", () => {
      const mk = (cell: string, na: boolean, on?: boolean): Project => {
        const p = withWriteup("x");
        const w = p.trd.documents[0]!.writeups!.find((q) => q.id === "WU-90")!;
        w.parts.push({ id: "tbl", kind: "table", text: "", columns: ["Item", "Limit"], rows: [["Hold", cell]] }, { id: "opt", kind: "paragraph", text: "Optional text.", optional: { condition: "when needed (fictional)" }, ...(on === undefined ? {} : { included: on }) });
        w.notApplicable = { condition: "done elsewhere (fictional)", text: "Not applicable here.", on: na };
        return p;
      };
      const rows = trdRows(mk("4 h", false), mk("24 h", true, true));
      expect(rows.some((x) => x.item === "Rows" && x.a === "Hold | 4 h" && x.b === "Hold | 24 h")).toBe(true);
      expect(rows.some((x) => x.item === "Marked not applicable" && x.a === "No" && x.b === "Yes")).toBe(true);
      expect(rows.some((x) => x.item === "Switched on" && x.a === "Not chosen" && x.b === "Yes")).toBe(true);
    });

    it("shows a changed approval name and date, and an approval that was added", () => {
      const mk = (name: string, date: string): Project => {
        const p = structuredClone(demo);
        p.trd.documents[0]!.approvals = [{ role: "Author", name, date }];
        return p;
      };
      const rows = trdRows(mk("A. Author (fictional)", "2026-11-01"), mk("B. Author (fictional)", "2026-11-02"));
      expect(rows.some((x) => x.item === "Approver" && x.b === "B. Author (fictional)")).toBe(true);
      expect(rows.some((x) => x.item === "Date" && x.a === "2026-11-01" && x.b === "2026-11-02")).toBe(true);
      const none = structuredClone(demo);
      none.trd.documents[0]!.approvals = [];
      expect(trdRows(none, mk("A. Author (fictional)", "2026-11-01")).some((x) => x.kind === "added" && x.item.includes("Approval, Author"))).toBe(true);
    });
  });

  // Code review CR-11: two fields with one label used to collapse into one, so a change in either went unseen.
  it("keeps two TRD fields with the same label apart", () => {
    const mk = (second: string): Project => {
      const p = structuredClone(demo);
      const step = p.trd.documents[0]!.steps[0]!;
      const field = (key: string, display: string) => ({ key, label: "Make (fictional)", override: { status: "established" as const, display, ...{ by: "A", at: "2026-11-04T09:00:00.000Z" } } });
      step.fields = [field("makeA", "First maker (fictional)"), field("makeB", second)];
      return p;
    };
    const rows = compareVersions(content, mk("Second maker (fictional)"), mk("Other maker (fictional)")).filter((r) => r.doc === "trd");
    expect(rows).toHaveLength(1);
    expect([rows[0]!.a, rows[0]!.b]).toEqual(["Second maker (fictional)", "Other maker (fictional)"]);
    expect(rows[0]!.item).toMatch(/make ?B/); // told apart from the first by the field's own key
  });

  it("says on the page what the comparison leaves out", () => {
    expect(COMPARE_LEFT_OUT).toMatch(/source/i);
    expect(COMPARE_LEFT_OUT).not.toMatch(/\b(wizard|validate|required|error|must)\b/i);
  });
});

describe("the version stamp", () => {
  it("says a saved version, the working copy before and after a change, and no history", async () => {
    const none = emptyProject({ title: "No history (fictional)", actor: ACTOR, contentRefs: content.versions });
    expect(workingCopyStamp(none)).toEqual({ row: NO_VERSION_HISTORY, label: "", saved: "" });

    let p = await ensureStartVersion(none, ACTOR);
    p = (await saveVersion(p, at(3), "x")).project;
    expect(workingCopyStamp(p)).toEqual({ row: "Working copy after v1.1 (no changes since it was saved)", label: "Working copy after v1.1", saved: "2026-11-04" });
    const changed = structuredClone(p);
    changed.meta.title = "Changed (fictional)";
    expect(workingCopyStamp(changed).row).toBe("Working copy after v1.1 (changes since not saved as a version)");
    expect(workingCopyStamp(changed).saved).toBe("");

    expect(savedVersionStamp({ label: "v2", at: "2026-11-04T09:00:00.000Z", stage: "clinical" })).toEqual({ row: "v2 (saved 2026-11-04), project stage Clinical", label: "v2", saved: "2026-11-04" });
    expect(savedVersionStamp({ label: "v1", at: "2026-11-04T09:00:00.000Z" }).row).toBe("v1 (saved 2026-11-04), project stage not set");
  });

  it("goes on the cover data, the header line and the HTML preview, and never changes the content", () => {
    const doc = buildDocument(content, demo, assess(content, demo), "2026-11-04T09:00:00.000Z");
    expect(doc.cover.version).toBeUndefined();
    const stamped = stampDocument(doc, savedVersionStamp({ label: "v2", at: "2026-11-04T09:00:00.000Z", stage: "ppq" }));
    expect(stamped.sections).toBe(doc.sections);
    expect(documentHeaderLine(stamped)).toBe(`${doc.title} · Project stage: ${doc.cover.stageShort} · v2`);
    expect(documentHeaderLine(doc)).toBe(`${doc.title} · Project stage: ${doc.cover.stageShort}`);
    const html = renderHtml(stamped);
    expect(html).toContain("Version: v2 (saved 2026-11-04), project stage PPQ");
    expect(html).toContain(`Project stage: ${doc.cover.stageShort} · v2`);
    expect(renderHtml(doc)).not.toContain("Version: ");
  });

  it("is written to the export record of a working copy, and a project without history records none", async () => {
    const record = (project: Project) =>
      recordExport(project, { at: ACTOR.at, by: ACTOR.name, format: "docx", template: { mode: "builtin", name: "Built-in default", version: "1.4.0" }, fingerprint: "abc" }).document.exports.at(-1)!;
    expect(record(demo).version).toBeUndefined();
    const p = await ensureStartVersion(demo, ACTOR);
    expect(record(p).version).toBe("Working copy after v1");
  });
});
