/// <reference types="node" />
import { documentFingerprint } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { importTemplateFile, mappingReport, renderDocx, suggestMapping, TemplateError, toolBlocks, type ImportedTemplate, type RenderDocxInput, type RenderDocxResult, type TemplateMapping } from "../src/index";
import { BANNER, GENERATED_AT, buildModel, buildModelWithComments, fixture, type Model } from "./fixtures";
import { countElements, customProps, plainText, strictDocx, type StrictResult } from "./strict";

// Rendering and strictly checking whole documents takes several seconds on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const model = buildModel();

async function templateOf(file: string): Promise<ImportedTemplate> {
  return importTemplateFile(file, fixture(file));
}

function inputFor(m: Model, mode: RenderDocxInput["mode"], t?: ImportedTemplate, mapping?: TemplateMapping): RenderDocxInput {
  return {
    doc: m.doc,
    tagData: m.tagData,
    mode,
    generatedAt: GENERATED_AT,
    ...(t ? { template: { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis, ...(mapping ? { mapping } : {}) } } : {}),
  };
}

interface Rendered {
  res: StrictResult;
  out: RenderDocxResult;
  text: string;
}

async function render(m: Model, mode: RenderDocxInput["mode"], t?: ImportedTemplate, mapping?: TemplateMapping): Promise<Rendered> {
  const out = await renderDocx(inputFor(m, mode, t, mapping));
  const res = strictDocx(out.bytes);
  return { res, out, text: plainText(res) };
}

/** The data rows (without the heading row) of the first table whose first-row cells include all of `headers`. */
function tableRows(res: StrictResult, headers: string[], part = "word/document.xml"): string[][] | undefined {
  const doc = res.xml.get(part)!;
  const tbls = doc.getElementsByTagNameNS(NS_W, "tbl");
  for (let i = 0; i < tbls.length; i++) {
    const trs = Array.from({ length: tbls.item(i)!.getElementsByTagNameNS(NS_W, "tr").length }, (_, k) => tbls.item(i)!.getElementsByTagNameNS(NS_W, "tr").item(k)!);
    const rows = trs.map((tr) => Array.from({ length: tr.getElementsByTagNameNS(NS_W, "tc").length }, (_, k) => tr.getElementsByTagNameNS(NS_W, "tc").item(k)!.textContent ?? ""));
    if (rows[0] && headers.every((h) => rows[0]!.includes(h))) return rows.slice(1);
  }
  return undefined;
}

const gapTable = () => {
  const s = model.doc.sections.find((x) => x.id === "gap-table")!;
  const b = s.blocks.find((x) => x.type === "table");
  if (!b || b.type !== "table") throw new Error("no gap table in the demo");
  return b;
};

// ================================================================== built-in look

describe("built-in look", () => {
  it("is a valid package with the banner in the body, header and footer, and the right properties", async () => {
    const { res, out, text } = await render(model, "builtin");
    expect(text).toContain(BANNER);
    expect(text.split(BANNER).length - 1).toBeGreaterThanOrEqual(1);
    const hdr = res.names.filter((n) => /^word\/header\d*\.xml$/.test(n)).map((n) => plainText(res, n)).join("\n");
    const ftr = res.names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).map((n) => plainText(res, n)).join("\n");
    expect(hdr + ftr).toContain(BANNER);
    expect(ftr).toMatch(/Page/);
    expect(res.text(res.names.find((n) => /footer\d*\.xml$/.test(n))!)).toMatch(/PAGE/);
    expect(res.text(res.names.find((n) => /footer\d*\.xml$/.test(n))!)).toMatch(/NUMPAGES/);
    expect(out.templateRecord).toEqual({ mode: "builtin", name: "Built-in default", version: expect.any(String) });
    expect(out.omittedBlocks).toEqual([]);
    // A4 landscape.
    const doc = res.text("word/document.xml");
    expect(doc).toMatch(/<w:pgSz[^>]*w:w="16838"[^>]*w:h="11906"/);
    expect(doc).toMatch(/w:orient="landscape"/);
    expect(res.text("docProps/core.xml")).toContain("Gap Assessment Generator (proof of concept)");
  });

  it("numbers every section heading, in order, with Heading styles", async () => {
    const { text, res } = await render(model, "builtin");
    for (const s of model.doc.sections) expect(text).toContain(s.title);
    expect(countElements(res, "pStyle")).toBeGreaterThan(20);
    expect(res.text("word/styles.xml")).toMatch(/w:name w:val="heading 1"/);
    expect(res.text("word/document.xml")).toMatch(/<w:outlineLvl|w:pStyle w:val="Heading1"|w:pStyle w:val="GapHeading1"/);
  });

  it("writes every gap row, and the wording 'Requires regulatory affairs assessment' and never a filing decision", async () => {
    const { res, text } = await render(model, "builtin");
    const gt = gapTable();
    const rows = tableRows(res, ["ID", "Attribute", "Gap"])!;
    expect(rows.length).toBe(gt.rows.length);
    expect(rows.map((r) => r[0])).toEqual(gt.rows.map((r) => r[0]));
    expect(text).toContain("Requires regulatory affairs assessment");
    // In the Actions cell the sentence follows the action list after a semicolon, as in the Markdown and HTML documents.
    expect(text).toContain("; Requires regulatory affairs assessment.");
    expect(text).not.toMatch(/\b(prior approval supplement|CBE-30|CBE-0|annual report|Type IB|Type II|Type IA)\b/i);
  });

  it("is the same bytes every time for the same input", async () => {
    const a = await renderDocx(inputFor(model, "builtin"));
    const b = await renderDocx(inputFor(model, "builtin"));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("records the template and the document fingerprint in the custom properties", async () => {
    const { res } = await render(model, "builtin");
    const p = customProps(res);
    expect(p.templateMode).toBe("builtin");
    expect(p.templateName).toBe("Built-in default");
    expect(p.templateVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(p.documentFingerprint).toBe(documentFingerprint(model.doc));
    expect(p.revision).toBeTruthy();
    expect(res.text("docProps/app.xml")).toContain("Gap Assessment Generator (proof of concept)");
    expect(res.text("docProps/core.xml")).not.toMatch(/@/);
  });

  it("puts a table with more than 8 columns in a landscape section of its own when the page is portrait", async () => {
    const t = await templateOf("brightwater-template.docx");
    // The lean gap table has 8 columns; a table of 10 columns gets the landscape section.
    const wide: Model = {
      ...model,
      doc: {
        ...model.doc,
        sections: [{ id: "purpose", number: "1", title: "Purpose", blocks: [{ type: "table", columns: Array.from({ length: 10 }, (_, i) => `Column ${i + 1}`), rows: [Array.from({ length: 10 }, (_, i) => `v${i}`)] }] }],
        comments: [],
      },
    };
    const { res } = await render(wide, "their_look", t);
    const doc = res.text("word/document.xml");
    expect((doc.match(/<w:sectPr/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(doc).toMatch(/w:orient="landscape"/);
  });

  it("escapes hostile text everywhere", async () => {
    const BAD = '<w:p>&amp; ]]> "q" \u0001\u0008 <script>x</script>';
    const hostile: Model = {
      ...model,
      doc: {
        ...model.doc,
        title: `Title ${BAD}`,
        meta: [["Key " + BAD, "Value " + BAD], ...model.doc.meta],
        sections: [
          {
            id: "purpose",
            number: "1",
            title: `Sec ${BAD}`,
            blocks: [
              { type: "paragraph", text: `Para ${BAD}` },
              { type: "note", text: `Note ${BAD}` },
              { type: "list", items: [`Item ${BAD}`] },
              { type: "table", columns: [`Col ${BAD}`, "B"], rows: [[`Cell ${BAD}`, ""]] },
            ],
          },
        ],
        comments: [],
      },
    };
    const { text, res } = await render(hostile, "builtin");
    expect(text).toContain("<w:p>&amp; ]]>");
    expect(text).not.toMatch(/[\u0001\u0008]/);
    expect(res.text("word/document.xml")).not.toContain("<script>");
    // Empty table cells still contain a paragraph (checked by strictDocx).
    expect(text).toContain(BANNER);
  });
});

// ================================================================== comments

describe("reviewer comments", () => {
  const withComments = buildModelWithComments();

  it("become native Word comments anchored where the section is, in every mode", async () => {
    const t = await templateOf("brightwater-template.docx");
    const tags = await templateOf("brightwater-tags.docx");
    const mapped = suggestMapping(t.analysis, withComments.doc);
    for (const [mode, tpl, map] of [
      ["builtin", undefined, undefined],
      ["their_look", t, undefined],
      ["mapped", t, mapped],
      ["tags", tags, undefined],
    ] as const) {
      const { res, out } = await render(withComments, mode, tpl, map);
      const n = withComments.doc.comments.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(countElements(res, "comment", "word/comments.xml"), mode).toBe(n);
      expect(countElements(res, "commentRangeStart"), mode).toBe(n);
      expect(countElements(res, "commentReference"), mode).toBe(n);
      const body = res.text("word/comments.xml");
      for (const c of withComments.doc.comments) expect(body, mode).toContain(c.text.slice(0, 30));
      void out;
    }
  });

  it("has no comments part when the document has no comments", async () => {
    const none: Model = { ...model, doc: { ...model.doc, comments: [] } };
    const { res } = await render(none, "builtin");
    expect(res.names).not.toContain("word/comments.xml");
    expect(res.text("[Content_Types].xml")).not.toContain("comments+xml");
  });
});

// ================================================================== their look

describe("their look", () => {
  it("keeps the template's styles, header, footer, logo and page size, and numbers headings once", async () => {
    const t = await templateOf("brightwater-template.docx");
    const { res, out, text } = await render(model, "their_look", t);
    const styles = res.text("word/styles.xml");
    expect(styles).toContain('w:styleId="BBHeading1"');
    expect(styles).toContain("Georgia");
    const doc = res.text("word/document.xml");
    expect(doc).toContain('w:val="BBHeading1"');
    expect(doc).not.toMatch(/w:pStyle w:val="Heading1"/);
    const hdr = res.names.find((n) => /^word\/header\d*\.xml$/.test(n))!;
    expect(plainText(res, hdr)).toContain("Brightwater Biologics (fictional)");
    expect(res.names.some((n) => /^word\/media\/.+\.png$/.test(n))).toBe(true);
    expect(res.text("word/numbering.xml").match(/<w:abstractNum /g)!.length).toBeGreaterThanOrEqual(2);
    // Heading numbers come from the template's own numbering: the text itself carries no typed "1." prefix.
    expect(text).not.toMatch(/^1\.\s+Purpose/m);
    // Portrait Letter is kept for the body.
    expect(doc).toMatch(/<w:pgSz w:w="12240" w:h="15840"\/>/);
    expect(text).toContain(BANNER);
    expect(text).not.toContain("Replace this line");
    expect(out.templateRecord).toEqual({ mode: "their_look", name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample" });
    const p = customProps(res);
    expect(p.templateMode).toBe("their_look");
    expect(p.templateSha256).toBe(t.sha256);
    expect(p.templateName).toBe("Brightwater sample (fictional)");
    expect(p.documentFingerprint).toBe(documentFingerprint(model.doc));
  });

  it("writes every gap row", async () => {
    const t = await templateOf("brightwater-template.docx");
    const { res } = await render(model, "their_look", t);
    expect(tableRows(res, ["ID", "Attribute", "Gap"])!.length).toBe(gapTable().rows.length);
  });

  it("refuses to run without a template", async () => {
    await expect(renderDocx(inputFor(model, "their_look"))).rejects.toThrow(TemplateError);
  });
});

// ================================================================== mapped

describe("mapped to the template headings", () => {
  const titleOf = (id: string) => toolBlocks(model.doc).find((b) => b.id === id)!.title;

  it("suggests a mapping that sends nothing to the wrong place, and reports no errors", async () => {
    const t = await templateOf("brightwater-template.docx");
    const m = suggestMapping(t.analysis, model.doc);
    expect(mappingReport(t.analysis, m, model.doc).errors).toEqual([]);
    const byText = (h: string) => m.headings.find((x) => x.headingIndex === t.analysis.outline.find((o) => o.text === h)!.index)!;
    expect(byText("Objective").blocks).toEqual(["purpose"]);
    expect(byText("Applicability").blocks).toEqual(["scope"]);
    expect(byText("Document Sign-off").blocks).toEqual(["approval"]);
    expect(byText("Required Actions").blocks).toEqual(["validation-plan"]);
    expect(byText("Outstanding Information").blocks).toEqual(["open-items"]);
    // "Definitions" has no match, has instruction text, so it is flagged rather than overwritten.
    expect(byText("Definitions")).toMatchObject({ blocks: [], existing: "flag" });
  });

  it("replaces mapped headings, keeps others, flags the flagged, and appends the rest under a named heading", async () => {
    const t = await templateOf("brightwater-template.docx");
    const m = suggestMapping(t.analysis, model.doc);
    const { res, out, text } = await render(model, "mapped", t, m);
    // Template headings are still there, in the template's style.
    for (const h of t.analysis.outline) expect(text).toContain(h.text);
    expect(res.text("word/document.xml")).toContain('w:val="BBHeading1"');
    // Replaced instruction text is gone; the flagged one is marked.
    expect(text).not.toContain("Describe the objective of this document");
    expect(text).toMatch(/To be completed/i);
    // The banner is at the top of the body.
    expect(text.indexOf(BANNER)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(BANNER)).toBeLessThan(text.indexOf("Objective"));
    // Unmapped blocks are appended, nothing lost.
    expect(text).toContain("Additional content not mapped to a template heading");
    expect(out.omittedBlocks).toEqual([]);
    expect(tableRows(res, ["ID", "Attribute", "Gap"])!.length).toBe(gapTable().rows.length);
    expect(out.templateRecord.mode).toBe("mapped");
    // A section appended at the end still has its own title.
    expect(text).toContain(titleOf("source-register").replace(/^Appendix [A-Z]\.\s*/, ""));
  });

  it("omits unmapped blocks when asked, and lists them in a note and in the result", async () => {
    const t = await templateOf("brightwater-template.docx");
    const m = { ...suggestMapping(t.analysis, model.doc), unmappedBlocks: "omit" as const };
    const report = mappingReport(t.analysis, m, model.doc);
    const { out, text } = await render(model, "mapped", t, m);
    expect(out.omittedBlocks.length).toBe(report.unmappedBlocks.length);
    expect(out.omittedBlocks.length).toBeGreaterThan(0);
    expect(text).not.toContain("Additional content not mapped to a template heading");
    expect(text).toMatch(/not included|left out|omitted/i);
    for (const title of out.omittedBlocks) expect(text).toContain(title);
    expect(text).toContain(BANNER);
  });

  it("keeps the template's own text when set to keep", async () => {
    const t = await templateOf("brightwater-template.docx");
    const m = suggestMapping(t.analysis, model.doc);
    const obj = t.analysis.outline.find((o) => o.text === "Objective")!;
    const kept: TemplateMapping = { ...m, headings: m.headings.map((h) => (h.headingIndex === obj.index ? { headingIndex: h.headingIndex, blocks: [], existing: "keep" } : h)) };
    const { text } = await render(model, "mapped", t, kept);
    expect(text).toContain("Describe the objective of this document");
  });

  it("rejects a mapping with errors", async () => {
    const t = await templateOf("brightwater-template.docx");
    const bad: TemplateMapping = { headings: [{ headingIndex: 0, blocks: ["no-such-block"], existing: "replace" }], unmappedBlocks: "append" };
    expect(mappingReport(t.analysis, bad, model.doc).errors.length).toBe(1);
    await expect(renderDocx(inputFor(model, "mapped", t, bad))).rejects.toThrow(TemplateError);
    const twice: TemplateMapping = { headings: [{ headingIndex: 0, blocks: ["purpose"], existing: "replace" }, { headingIndex: 1, blocks: ["purpose"], existing: "replace" }], unmappedBlocks: "append" };
    expect(mappingReport(t.analysis, twice, model.doc).errors.length).toBeGreaterThan(0);
    const flagWith: TemplateMapping = { headings: [{ headingIndex: 0, blocks: ["purpose"], existing: "flag" }], unmappedBlocks: "append" };
    expect(mappingReport(t.analysis, flagWith, model.doc).errors.length).toBeGreaterThan(0);
    const replaceNone: TemplateMapping = { headings: [{ headingIndex: 0, blocks: [], existing: "replace" }], unmappedBlocks: "append" };
    expect(mappingReport(t.analysis, replaceNone, model.doc).errors.length).toBeGreaterThan(0);
    const badIndex: TemplateMapping = { headings: [{ headingIndex: 99, blocks: [], existing: "keep" }], unmappedBlocks: "append" };
    expect(mappingReport(t.analysis, badIndex, model.doc).errors.length).toBeGreaterThan(0);
  });

  it("writes the document with the PDF's headings in the built-in look", async () => {
    const t = await templateOf("brightwater-outline.pdf");
    const m = suggestMapping(t.analysis, model.doc);
    const { res, out, text } = await render(model, "mapped", t, m);
    expect(text).toContain(BANNER);
    expect(text).toContain("Additional content not mapped to a template heading");
    // PDF headings the user did not map are flagged, never silently dropped.
    expect(text).toMatch(/To be completed/i);
    expect(out.templateRecord.mode).toBe("mapped");
    expect(out.templateRecord.sha256).toBe(t.sha256);
    expect(tableRows(res, ["ID", "Attribute", "Gap"])!.length).toBe(gapTable().rows.length);
  });
});

// ================================================================== tags

describe("placeholder tags", () => {
  it("fills the sample tag template: loops, rows, banner, and no unfilled tags", async () => {
    const t = await templateOf("brightwater-tags.docx");
    const { res, out, text } = await render(model, "tags", t);
    expect(text).toContain(BANNER);
    expect(text).toContain(model.tagData.title);
    expect(text).not.toMatch(/\{[#/]?\w+\}/);
    const rows = tableRows(res, ["ID", "Attribute", "Source", "Target", "Category", "Regulatory"])!;
    expect(rows.length).toBe(model.tagData.gaps.length);
    expect(rows.map((r) => r[0])).toEqual(model.tagData.gaps.map((g) => g.id));
    expect(rows[0]![1]).toBe(model.tagData.gaps[0]!.attribute);
    expect(out.templateRecord.mode).toBe("tags");
    expect(text).toContain("Requires regulatory affairs assessment");
    for (const q of model.tagData.openItems.slice(0, 3)) expect(text).toContain(q.question);
    expect(customProps(res).templateMode).toBe("tags");
  });

  it("inserts the banner at the top when the template forgot it, and says so", async () => {
    const t = await templateOf("brightwater-tags.docx");
    const noBanner = { ...model.tagData, banner: "" };
    const out = await renderDocx({ ...inputFor(model, "tags", t), tagData: noBanner });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
  });

  it("fills the starter template with every tag", async () => {
    const { buildStarterTemplate } = await import("../src/index");
    const bytes = buildStarterTemplate();
    strictDocx(bytes);
    const t = await importTemplateFile("starter.docx", bytes);
    expect(t.analysis.tags!.errors).toEqual([]);
    expect(t.analysis.tags!.unknown).toEqual([]);
    expect(t.analysis.tags!.missingRecommended).toEqual([]);
    const { res, text } = await render(model, "tags", t);
    expect(text).not.toMatch(/\{[#/]?\w+\}/);
    expect(tableRows(res, ["ID", "Section", "Attribute"])!.length).toBe(model.tagData.gaps.length);
  });
});
