/// <reference types="node" />
// M15 job 4: the fictional sample Word template for "A template's headings". It is what the "Add a sample template (fictional)" button adds, so its
// headings must be exactly the cases the feature shows (matching content, a writing box, kept template text) and nothing else.
import { suggestTrdMatch, trdHeadingsToComplete, type MatchHeading, type TrdMapping } from "@gap/engine";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { buildSampleHeadingsTemplate, importTemplateFile, SAMPLE_HEADINGS, SAMPLE_HEADINGS_FILE_NAME, SAMPLE_HEADINGS_NAME } from "../src/index";

describe("the fictional sample template", () => {
  it("is a valid Word file whose headings are the ones intended, in order", async () => {
    const imp = await importTemplateFile(SAMPLE_HEADINGS_FILE_NAME, buildSampleHeadingsTemplate());
    expect(imp.analysis.outline.map((h) => h.text)).toEqual(SAMPLE_HEADINGS.map(([h]) => h));
    expect(imp.analysis.outline.map((h) => h.level)).toEqual(SAMPLE_HEADINGS.map(() => 1));
    // The template's own text sits under the headings that have one in the list, and only there.
    expect(imp.analysis.outline.map((h) => h.hasBody)).toEqual(SAMPLE_HEADINGS.map(([, t]) => t !== ""));
    expect(imp.analysis.usableModes).toContain("mapped");
  });

  it("is labelled fictional in its name and in the file", () => {
    expect(SAMPLE_HEADINGS_NAME).toBe("Harbourlight SOP (fictional)");
    const xml = new PizZip(buildSampleHeadingsTemplate()).file("word/document.xml")!.asText();
    expect(xml).toContain("Harbourlight SOP (fictional)");
  });

  it("gives the same bytes every time, so adding it twice is recognised as one copy", () => {
    expect(Buffer.from(buildSampleHeadingsTemplate()).equals(Buffer.from(buildSampleHeadingsTemplate()))).toBe(true);
  });

  it("has exactly the cases the feature shows: content headings, writing boxes and one kept text", async () => {
    const imp = await importTemplateFile(SAMPLE_HEADINGS_FILE_NAME, buildSampleHeadingsTemplate());
    const outline: MatchHeading[] = imp.analysis.outline.map((h) => ({ index: h.index, level: h.level, text: h.text, hasBody: h.hasBody, ...(h.number ? { number: h.number } : {}) }));
    const units = [
      { id: "purpose-scope", title: "Purpose and scope" },
      { id: "process-parameters", title: "Process steps and parameters" },
      { id: "open-items", title: "Open items" },
      { id: "references", title: "References" },
    ];
    const suggestions = suggestTrdMatch(outline, units, {});
    const placed = new Set(suggestions.map((s) => s.headingIndex));
    // The three headings with no counterpart in a TRD get no suggestion at all.
    for (const text of ["Distribution list", "Training records", "Site notes"]) expect(placed.has(outline.findIndex((h) => h.text === text)), text).toBe(false);
    // With the matched ones confirmed, the two empty headings are the writing boxes; the one with the template's own text is kept, so it is not open.
    const mapping: TrdMapping = { headings: suggestions.map((s) => ({ headingIndex: s.headingIndex, headingText: outline[s.headingIndex]!.text, units: s.units, existing: "replace" as const })) };
    const open = trdHeadingsToComplete({ headings: outline, mapping, unitIds: units.map((u) => u.id) }).map((h) => h.text);
    expect(open).toEqual(expect.arrayContaining(["Distribution list", "Training records"]));
    expect(open).not.toContain("Site notes");
  });
});
