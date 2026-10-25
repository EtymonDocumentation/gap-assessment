/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { buildDemoProject, buildTrdDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { buildDocumentTagData, importTemplateFile, renderDocx } from "../src/index";
import { BANNER, GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** M9.1: process descriptions in Word and HTML. Samples go to the temp folder for a look at the pages. */
describe("Word and HTML process descriptions (M9.1)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const d = project.trd.documents[0]!;
  const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content });
  const dir = join(tmpdir(), "gap-docx-samples", "m91b");

  it("the built-in look has the overview with numbered sub-sections, lettered steps, highlighted open blanks and the banner", async () => {
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    const xml = new PizZip(out.bytes).file("word/document.xml")!.asText();
    const n = doc.sections.find((s) => s.id === "manufacturing-overview")!.number;
    expect(text).toContain(BANNER);
    expect(text).toContain("Manufacturing process overview");
    expect(text).toContain(`${n}.1 `);
    expect(text).toContain(`${n}.2 `);
    // Open blanks are highlighted, with their label in square brackets so colour is not the only cue.
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(text).toMatch(/\[[A-Z][^\]]+\]/);
    // Lettered sub-steps are written as "a." with a tab, in a hanging indent.
    expect(xml).toMatch(/<w:t[^>]*>a\.<\/w:t>/);
    // A note keeps its own look (italic with a left border).
    expect(xml).toContain("<w:pBdr><w:left");
    expect(text).not.toMatch(/filing category/i);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-writeups.docx"), out.bytes);
    writeFileSync(join(dir, "trd-writeups.html"), renderHtml(doc));
    writeFileSync(join(dir, "trd-writeups.txt"), text);
  });

  it("works with a library template in tags mode: {@body} carries the overview", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const P = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@body}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: tagged.sha256, fileName: "sample", bytes: tagged.bytes, analysis: tagged.analysis };
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Manufacturing process overview");
    expect(text).toContain(BANNER);
  });

  it("a section tag reaches the overview on its own", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const P = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@section_manufacturing_overview}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: tagged.sha256, fileName: "sample", bytes: tagged.bytes, analysis: tagged.analysis };
    void t;
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    expect(plainText(strictDocx(out.bytes))).toContain("Manufacturing process overview");
  });
});
