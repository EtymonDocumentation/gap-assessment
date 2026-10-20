/// <reference types="node" />
import { DOCUMENT_SECTION_IDS } from "@gap/engine";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { TAG_REFERENCE, TemplateError, buildTagData, importTemplateFile, renderDocx, tagReferenceMarkdown } from "../src/index";
import { BANNER, GENERATED_AT, buildModel, buildModelWithComments, fixture } from "./fixtures";
import { countElements, plainText, strictDocx } from "./strict";

// Rendering and strictly checking whole documents takes several seconds on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const model = buildModel();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

/** The Brightwater look with the body replaced by the given paragraphs. */
function tagDoc(...paragraphs: string[]): Uint8Array {
  const zip = new PizZip(fixture("brightwater-template.docx"));
  const xml = zip.file("word/document.xml")!.asText();
  const out = xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${paragraphs.join("")}$1`);
  zip.file("word/document.xml", out);
  return zip.generate({ type: "uint8array" });
}

async function renderTags(bytes: Uint8Array, tagData = model.tagData, doc = model.doc) {
  const t = await importTemplateFile("t.docx", bytes);
  const out = await renderDocx({ doc, tagData, mode: "tags", generatedAt: GENERATED_AT, template: { name: "Tags test (fictional)", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis } });
  const res = strictDocx(out.bytes);
  return { out, res, text: plainText(res), analysis: t.analysis };
}

describe("checking tags in a template", () => {
  it("lists tags found, unknown tags, and recommended tags that are missing", async () => {
    const t = await importTemplateFile("t.docx", tagDoc(P("{title} {nonsense}"), P("{#gaps}"), P("{id} {madeUpField}"), P("{/gaps}")));
    const tags = t.analysis.tags!;
    expect(tags.errors).toEqual([]);
    expect(tags.found).toEqual(expect.arrayContaining(["title", "nonsense", "gaps", "gaps.id", "gaps.madeUpField"]));
    expect(tags.unknown).toEqual(expect.arrayContaining(["nonsense", "gaps.madeUpField"]));
    expect(tags.unknown).not.toContain("title");
    expect(tags.missingRecommended).toContain("banner");
    expect(tags.missingRecommended).not.toContain("gaps");
  });

  it("reports a loop that is not closed, an unclosed brace and a stray closing brace in plain language", async () => {
    const a = (await importTemplateFile("a.docx", tagDoc(P("{#gaps}"), P("{id}")))).analysis.tags!;
    expect(a.errors.length).toBeGreaterThan(0);
    expect(a.errors.join(" ")).toMatch(/loop|closed/i);
    const b = (await importTemplateFile("b.docx", tagDoc(P("Hello {title")))).analysis.tags!;
    expect(b.errors.join(" ")).toMatch(/never closed|opened/i);
    const c = (await importTemplateFile("c.docx", tagDoc(P("Hello title}")))).analysis.tags!;
    expect(c.errors.join(" ")).toMatch(/closing|\}/);
    const d = (await importTemplateFile("d.docx", tagDoc(P("{#gaps}{id}{/openItems}")))).analysis.tags!;
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it("refuses to fill a template with tag errors, and the message says what is wrong", async () => {
    const t = await importTemplateFile("a.docx", tagDoc(P("{#gaps}"), P("{id}")));
    await expect(
      renderDocx({ doc: model.doc, tagData: model.tagData, mode: "tags", generatedAt: GENERATED_AT, template: { name: "x", version: "1", sha256: t.sha256, bytes: t.bytes, analysis: t.analysis } }),
    ).rejects.toThrow(TemplateError);
  });

  it("shows [not available] for unknown tags and warns about them", async () => {
    const { out, text } = await renderTags(tagDoc(P("A: {nonsense}"), P("{title}")));
    expect(text).toContain("A: [not available]");
    expect(out.warnings.join(" ")).toMatch(/nonsense/);
    expect(text).toContain(BANNER);
  });

  it("does not offer the tags option for a template with no tags, and refuses to fill it", async () => {
    const t = await importTemplateFile("t.docx", tagDoc(P("Just words, no tags.")));
    expect(t.analysis.usableModes).not.toContain("tags");
    await expect(renderTags(tagDoc(P("Just words, no tags.")))).rejects.toThrow(TemplateError);
  });
});

describe("raw tags", () => {
  it("{@body} writes all sections with the template's own styles, and all gap rows", async () => {
    const { res, text, out } = await renderTags(tagDoc(P("{banner}"), P("{@body}")));
    for (const s of model.doc.sections) expect(text).toContain(s.title.replace(/^[A-Z0-9]+\.\s*/, ""));
    expect(res.text("word/document.xml")).toContain("BBHeading");
    expect(text).toContain("Requires regulatory affairs assessment");
    expect(out.warnings.join(" ")).not.toMatch(/could not be placed/);
  });

  it("{@section_<id>} writes just that section", async () => {
    const { text, res } = await renderTags(tagDoc(P("{banner}"), P("{@section_purpose}")));
    const purpose = model.doc.sections.find((s) => s.id === "purpose")!;
    expect(text).toContain(purpose.title.replace(/^[A-Z0-9]+\.\s*/, ""));
    expect(countElements(res, "tbl")).toBe(0);
    expect(text).not.toContain("Requires regulatory affairs assessment");
  });

  it("anchors reviewer comments in the section they belong to", async () => {
    const withComments = buildModelWithComments();
    const { res, out } = await renderTags(tagDoc(P("{banner}"), P("{@body}")), withComments.tagData, withComments.doc);
    expect(countElements(res, "comment", "word/comments.xml")).toBe(withComments.doc.comments.length);
    expect(out.warnings.join(" ")).not.toMatch(/could not be placed/);
  });

  it("explains a raw tag that shares its paragraph with other text", async () => {
    const t = await importTemplateFile("r.docx", tagDoc(P("Before {@body} after")));
    expect(t.analysis.tags!.errors.join(" ")).toMatch(/alone in its own paragraph/);
  });

  it("without a raw tag, comments go to a note at the end with a warning", async () => {
    const withComments = buildModelWithComments();
    const { res, out, text } = await renderTags(tagDoc(P("{banner}"), P("{title}")), withComments.tagData, withComments.doc);
    expect(out.warnings.join(" ")).toMatch(/could not be placed/);
    expect(countElements(res, "comment", "word/comments.xml")).toBe(withComments.doc.comments.length);
    expect(text).toMatch(/reviewer comment/i);
  });
});

describe("hostile tags and hostile values", () => {
  const evil = [
    "{constructor}",
    "{__proto__}",
    "{toString}",
    "{hasOwnProperty}",
    "{prototype}",
    "{constructor.constructor}",
    "{__proto__.polluted}",
    '{this.constructor.constructor("return process.env.PATH")()}',
    "{process.env.PATH}",
    "{globalThis}",
    "{require('fs')}",
    "{ 1+1 }",
  ];

  it("never runs code, never reaches built-in properties, and never changes Object.prototype", async () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort().join();
    const { text, res } = await renderTags(tagDoc(...evil.map((e) => P(`x ${e} y`)), P("{title}")));
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(text).not.toMatch(/function|\[native|\[object|PATH|Path=|C:\\|=>/i);
    expect(text).not.toMatch(/\b2\b.*\by\b/);
    expect(text).toContain(model.tagData.title);
    strictDocx(res.zip.generate({ type: "uint8array" }));
  });

  it("puts values in the file as text, whatever characters they hold", async () => {
    const BAD = '<w:p>&amp; ]]> "q" \u0001 <script>x</script> {title} {#gaps}';
    const data = { ...model.tagData, program: BAD, title: `T ${BAD}`, gaps: model.tagData.gaps.map((g) => ({ ...g, attribute: BAD })) };
    const { text, res } = await renderTags(tagDoc(P("{title}"), P("Program: {program}"), P("{#gaps}"), P("{attribute}"), P("{/gaps}")), data);
    expect(text).toContain("<w:p>&amp; ]]>");
    expect(text).not.toContain("\u0001");
    expect(res.text("word/document.xml")).not.toContain("<script>");
    // A value that looks like a tag is not filled again.
    expect(text).toContain("{title}");
  });
});

describe("tag reference", () => {
  it("lists every document section as a raw tag, plus {@body}", () => {
    const raw = TAG_REFERENCE.filter((t) => t.kind === "raw").map((t) => t.tag);
    expect(raw).toContain("body");
    expect(raw.filter((t) => t.startsWith("section_")).length).toBe(DOCUMENT_SECTION_IDS.length);
    expect(raw).toContain("section_gap_details");
  });
  it("renders as Markdown with the banner rule", () => {
    const md = tagReferenceMarkdown();
    expect(md).toContain("{@body}");
    expect(md).toContain("{#gaps}");
    expect(md).toContain(BANNER);
  });
  it("builds data from the document tables so counts agree", () => {
    const gt = model.doc.sections.find((s) => s.id === "gap-table")!.blocks.find((b) => b.type === "table");
    expect(gt && gt.type === "table" && model.tagData.gaps.length).toBe(gt && gt.type === "table" ? gt.rows.length : -1);
    expect(model.tagData.banner).toBe(BANNER);
    void buildTagData;
  });
});
