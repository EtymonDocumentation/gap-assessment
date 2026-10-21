/// <reference types="node" />
import { assess, buildDocument, setOmittedSections, type DocModel } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content } from "../../../content/index";
import { buildStarterTemplate, buildTagData, importTemplateFile, renderDocx } from "../src/index";
import { GENERATED_AT, buildModel } from "./fixtures";
import { plainText, strictDocx } from "./strict";

// Rendering and strictly checking whole documents takes several seconds on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const model = buildModel();

/** The same demo project with some optional sections left out. */
function modelWithout(...ids: string[]) {
  const project = setOmittedSections(model.project, ids);
  const a = assess(content, project);
  const doc = buildDocument(content, project, a, GENERATED_AT);
  return { project, doc, tagData: buildTagData(content, project, a, doc) };
}

const appendices = (doc: DocModel) => doc.sections.filter((s) => s.appendix).map((s) => [s.number, s.title]);
const starterText = (doc?: DocModel) => plainText(strictDocx(buildStarterTemplate(doc)));

describe("appendix letters in the starter template and the tag data", () => {
  it("default export: A to C are Gap details, Source register, Change log summary (there is no revision or comment appendix)", () => {
    expect(appendices(model.doc)).toEqual([
      ["A", "Gap details"],
      ["B", "Source register"],
      ["C", "Change log summary"],
    ]);
    expect(model.tagData.sections.filter((s) => s.number.startsWith("Appendix")).map((s) => [s.number, s.title])).toEqual([
      ["Appendix A", "Gap details"],
      ["Appendix B", "Source register"],
      ["Appendix C", "Change log summary"],
    ]);
  });

  it("the starter template of a complete document uses the real letters, with and without a document model", () => {
    for (const text of [starterText(), starterText(model.doc)]) {
      expect(text).toContain("Appendix B. Source register");
      expect(text).not.toMatch(/Revision history|Reviewer comments/);
      // The old hard-coded letters are gone.
      expect(text).not.toContain("Appendix A. Source register");
    }
  });

  it("leaving an optional appendix out shifts the later letters in the tag data and in the starter template", () => {
    const m = modelWithout("gap-details");
    expect(appendices(m.doc)).toEqual([
      ["A", "Source register"],
      ["B", "Change log summary"],
    ]);
    expect(m.tagData.sections.filter((s) => s.number.startsWith("Appendix")).map((s) => [s.number, s.title])).toEqual([
      ["Appendix A", "Source register"],
      ["Appendix B", "Change log summary"],
    ]);
    const text = starterText(m.doc);
    expect(text).toContain("Appendix A. Source register");
    expect(text).not.toContain("Appendix C.");
  });

  it("an appendix that is left out is not in the starter template at all", () => {
    const m = modelWithout("source-register");
    expect(appendices(m.doc).map((a) => a[0])).toEqual(["A", "B"]);
    const text = starterText(m.doc);
    expect(text).not.toContain("Source register");
  });

  it("the starter template still fills with a shifted document", async () => {
    const m = modelWithout("gap-details");
    const t = await importTemplateFile("starter.docx", buildStarterTemplate(m.doc));
    expect(t.analysis.tags!.errors).toEqual([]);
    const out = await renderDocx({
      doc: m.doc,
      tagData: m.tagData,
      mode: "tags",
      generatedAt: GENERATED_AT,
      template: { name: "Starter (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis },
    });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Appendix A. Source register");
    expect(text).toContain("Appendix B. Change log summary");
    expect(text).not.toMatch(/\{[#/]?\w+\}/);
  });
});
