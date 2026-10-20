/// <reference types="node" />
import { assess, buildDocument, setOmittedSections, type DocModel } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content } from "../../../content/index";
import { buildStarterTemplate, buildTagData, importTemplateFile, renderDocx } from "../src/index";
import { BANNER, GENERATED_AT, buildModel, buildModelWithComments } from "./fixtures";
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
  it("default export: A to E are Gap details, Source register, Change log summary, Revision history, Reviewer comments", () => {
    expect(appendices(model.doc)).toEqual([
      ["A", "Gap details"],
      ["B", "Source register"],
      ["C", "Change log summary"],
      ["D", "Revision history"],
      ["E", "Reviewer comments"],
    ]);
    expect(model.tagData.sections.filter((s) => s.number.startsWith("Appendix")).map((s) => [s.number, s.title])).toEqual([
      ["Appendix A", "Gap details"],
      ["Appendix B", "Source register"],
      ["Appendix C", "Change log summary"],
      ["Appendix D", "Revision history"],
      ["Appendix E", "Reviewer comments"],
    ]);
  });

  it("the starter template of a complete document uses the real letters, with and without a document model", () => {
    for (const text of [starterText(), starterText(model.doc)]) {
      expect(text).toContain("Appendix B. Source register");
      expect(text).toContain("Appendix D. Revision history");
      expect(text).toContain("Appendix E. Reviewer comments");
      // The old hard-coded letters are gone.
      expect(text).not.toContain("Appendix A. Source register");
      expect(text).not.toContain("Appendix C. Revision history");
      expect(text).not.toContain("Appendix D. Reviewer comments");
    }
  });

  it("leaving an optional appendix out shifts the later letters in the tag data and in the starter template", () => {
    const m = modelWithout("gap-details", "change-log-summary");
    expect(appendices(m.doc)).toEqual([
      ["A", "Source register"],
      ["B", "Revision history"],
      ["C", "Reviewer comments"],
    ]);
    expect(m.tagData.sections.filter((s) => s.number.startsWith("Appendix")).map((s) => [s.number, s.title])).toEqual([
      ["Appendix A", "Source register"],
      ["Appendix B", "Revision history"],
      ["Appendix C", "Reviewer comments"],
    ]);
    const text = starterText(m.doc);
    expect(text).toContain("Appendix A. Source register");
    expect(text).toContain("Appendix B. Revision history");
    expect(text).toContain("Appendix C. Reviewer comments");
    expect(text).not.toContain("Appendix D.");
    expect(text).not.toContain("Appendix E.");
  });

  it("an appendix that is left out is not in the starter template at all", () => {
    const m = modelWithout("revision-history");
    expect(appendices(m.doc).map((a) => a[0])).toEqual(["A", "B", "C", "D"]);
    const text = starterText(m.doc);
    expect(text).toContain("Appendix B. Source register");
    expect(text).toContain("Appendix D. Reviewer comments");
    expect(text).not.toContain("Revision history");
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
    expect(text).toContain("Appendix C. Revision history");
    expect(text).toContain("Appendix D. Reviewer comments");
    expect(text).not.toMatch(/\{[#/]?\w+\}/);
  });
});

describe("a reviewer comment with no section", () => {
  /** The demo model with one more comment whose sectionId is missing, as an older or hand-made document model might have it. */
  function withUnanchored() {
    const base = buildModelWithComments();
    const first = base.doc.comments[0]!;
    const orphan = { ...first, id: "C-099", anchorText: "Risk ranking (section omitted from this export)" } as Record<string, unknown>;
    delete orphan.sectionId;
    delete orphan.gapDisplayId;
    const doc = { ...base.doc, comments: [...base.doc.comments, orphan as unknown as DocModel["comments"][number]] };
    return { ...base, doc };
  }

  it("does not throw, and the comment goes to the note at the end", async () => {
    const m = withUnanchored();
    const out = await renderDocx({ doc: m.doc, tagData: m.tagData, mode: "builtin", generatedAt: GENERATED_AT });
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    expect(text).toContain(BANNER);
    expect(text).toContain("Reviewer comments whose section is not in this document");
    // "ID — anchor": the anchor holds parentheses, so a dash is used rather than brackets.
    expect(text).toContain("C-099 — Risk ranking (section omitted from this export)");
    // Every comment, the unanchored one included, is in the Word comments part.
    expect(res.text("word/comments.xml")).toContain("C-099");
  });

  it("is also tolerated in a tag template, where it goes to the note about comments the template has no place for", async () => {
    const m = withUnanchored();
    const t = await importTemplateFile("starter.docx", buildStarterTemplate(m.doc));
    const out = await renderDocx({
      doc: m.doc,
      tagData: m.tagData,
      mode: "tags",
      generatedAt: GENERATED_AT,
      template: { name: "Starter (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis },
    });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    expect(text).toContain("C-099 — Risk ranking (section omitted from this export)");
  });
});
