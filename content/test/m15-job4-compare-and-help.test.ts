// M15 job 4: a changed Word template choice and a changed heading match each give one plain line in the version comparison (rows and CSV), and the
// glossary and tour name the feature in the words the screens use. Fictional data only.
import {
  addTrdAddedBack,
  buildDemoProject,
  buildTrdDocument,
  compareSummary,
  compareToCsv,
  compareVersions,
  createTrd,
  setTrdHeadingText,
  setTrdTemplateChoice,
  trdHeadingsToComplete,
  trdUnitModel,
  trdUnitsOf,
  type MatchHeading,
} from "@gap/engine";
import type { Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, glossary, tours, trdWriteups } from "../index";

vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-11T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const MAPPED = { kind: "mapped" as const, templateId: "tpl-1", templateName: "Harbourlight SOP (fictional)", templateVersion: "1" };

function base(): { project: Project; trdId: string } {
  const demo = buildDemoProject(content, demos["arx-217"] as never);
  const p: Project = { ...demo, trd: { documents: [] }, changeLog: demo.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
  const steps = content.catalog.unitOperations.slice(0, 2).map((u) => ({ unitOp: u.key, label: u.label }));
  const made = createTrd(p, { title: "Narrow TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  return { project: made.project, trdId: made.trdId };
}

const trdRows = (rows: ReturnType<typeof compareVersions>) => rows.filter((r) => r.doc === "trd");
const matchLine = (rows: ReturnType<typeof compareVersions>) => trdRows(rows).find((r) => r.item.startsWith("Heading match"));

describe("version compare: the Word template choice", () => {
  it("shows a changed choice as one line in the words every screen uses, also in the CSV", () => {
    const { project, trdId } = base();
    const after = setTrdTemplateChoice(project, trdId, MAPPED, who);
    const rows = compareVersions(content, project, after);
    const row = trdRows(rows).find((r) => r.item === "Word template");
    expect(row).toMatchObject({ kind: "changed", b: "A template's headings: Harbourlight SOP (fictional) (version 1)" });
    expect(compareSummary(rows)).toContain("TRD");
    const csv = compareToCsv(rows, "v1", "Working copy");
    expect(csv).toContain("Word template");
    expect(csv).toContain("A template's headings: Harbourlight SOP (fictional) (version 1)");
  });

  it("shows nothing when the choice did not change, and a same row only when unchanged items are asked for", () => {
    const { project, trdId } = base();
    const chosen = setTrdTemplateChoice(project, trdId, { kind: "later" }, who);
    expect(trdRows(compareVersions(content, chosen, structuredClone(chosen)))).toEqual([]);
    const same = trdRows(compareVersions(content, chosen, structuredClone(chosen), { includeSame: true })).find((r) => r.item === "Word template");
    expect(same).toMatchObject({ kind: "same", a: "Decide later (still open)", b: "Decide later (still open)" });
  });
});

describe("version compare: the heading match kept on the TRD", () => {
  const withMapped = () => {
    const { project, trdId } = base();
    return { trdId, project: setTrdTemplateChoice(project, trdId, MAPPED, who) };
  };

  it("counts written heading text and an add-back as headings changed, in one line", () => {
    const { project, trdId } = withMapped();
    let after = setTrdHeadingText(project, trdId, { headingIndex: 4, headingText: "Distribution list" }, "Sending and receiving sites (fictional).", who);
    after = setTrdHeadingText(after, trdId, { headingIndex: 5, headingText: "Training records" }, "Kept by the site (fictional).", who);
    const d = after.trd.documents.find((x) => x.id === trdId)!;
    const unit = trdUnitsOf(trdUnitModel(buildTrdDocument(after, d, { generatedAt: T, appVersion: "0.0.0-test", content }), d))[0]!;
    after = addTrdAddedBack(after, trdId, unit.id, who);
    const rows = compareVersions(content, project, after);
    expect(matchLine(rows)).toMatchObject({ item: "Heading match: 3 headings changed", kind: "changed", a: "none", b: "2 headings with your own text, 1 section added back" });
    expect(compareToCsv(rows, "v1", "Working copy")).toContain("Heading match: 3 headings changed");
  });

  it("says one heading in the singular, and nothing when the match is the same", () => {
    const { project, trdId } = withMapped();
    const after = setTrdHeadingText(project, trdId, { headingIndex: 4, headingText: "Distribution list" }, "Text (fictional).", who);
    expect(matchLine(compareVersions(content, project, after))?.item).toBe("Heading match: 1 heading changed");
    expect(matchLine(compareVersions(content, after, structuredClone(after)))).toBeUndefined();
  });

  it("a changed text under the same heading counts once", () => {
    const { project, trdId } = withMapped();
    const one = setTrdHeadingText(project, trdId, { headingIndex: 4, headingText: "Distribution list" }, "First (fictional).", who);
    const two = setTrdHeadingText(one, trdId, { headingIndex: 4, headingText: "Distribution list" }, "Second (fictional).", who);
    expect(matchLine(compareVersions(content, one, two))?.item).toBe("Heading match: 1 heading changed");
  });
});

describe("glossary and tour for the template-driven TRD", () => {
  const by = (id: string) => glossary.find((t) => t.id === id);

  it("defines the five words the screens use, with the exact strings", () => {
    const terms = glossary.map((t) => t.term);
    for (const w of ["A template's headings", "Match your headings", "Not in your template", "Additional content", "[To be completed.]"]) expect(terms, w).toContain(w);
    for (const id of ["to-be-completed", "template-headings", "additional-content", "match-your-headings", "not-in-your-template"]) {
      expect(by(id), id).toBeTruthy();
      expect(JSON.stringify(by(id)), id).not.toMatch(/\b(wizard|validate|required|error|must|mapping)\b/i);
    }
  });

  it("points the TRD tour's start step at the template's headings", () => {
    const step = tours.find((t) => t.id === "trd")!.steps.find((s) => s.anchor === "trd-new")!;
    expect(step.text).toContain("A template's headings");
    expect(step.text).toContain("headings of your own Word file");
  });
});

describe("a heading emptied only by an unticked section", () => {
  // A heading with template text of its own keeps that text when its content goes, so it is not empty: the headings here have none. The Document tab names these headings (TrdOutput: emptiedByOmit). They are the ones that are to complete in the shown document but not among the
  // headings counted over every section of the TRD, so the count (which ignores the choice) is never changed by the line.
  const outline: MatchHeading[] = [
    { index: 0, level: 1, text: "Purpose and scope", hasBody: false },
    { index: 1, level: 1, text: "Process description", hasBody: false },
  ];
  const mapping = {
    headings: [
      { headingIndex: 0, headingText: "Purpose and scope", units: ["purpose-scope"], existing: "replace" as const },
      { headingIndex: 1, headingText: "Process description", units: ["overview:wu_a"], existing: "replace" as const },
    ],
  };
  it("lists the heading whose only section is unticked, and only that one", () => {
    const counted = new Set(trdHeadingsToComplete({ headings: outline, mapping, unitIds: ["purpose-scope", "overview:wu_a"] }).map((h) => h.headingIndex));
    const shown = trdHeadingsToComplete({ headings: outline, mapping, unitIds: ["purpose-scope"] });
    expect(shown.filter((h) => !counted.has(h.headingIndex)).map((h) => h.text)).toEqual(["Process description"]);
    expect(counted.size).toBe(0);
  });
});
