/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { buildDemoProject, buildTrdDocument, NO_REASON_RECORDED } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { buildDocumentTagData, importTemplateFile, renderDocx } from "../src/index";
import { BANNER, GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** M9: the TRD goes through the same Word and HTML renderers and the Templates library. Samples and a text dump go to the temp folder. */
describe("Word and HTML TRD (M9)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const d = project.trd.documents[0]!;
  // The evidence record holds the PAR/NOR check, the per-step sections and the sources (the standard document is tested in trd-standard.test.ts).
  const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", variant: "evidence" });
  const standard = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
  const dir = join(tmpdir(), "gap-docx-samples", "m9");

  it("renders the demo TRD with banner, headings, the override list and the check, and writes samples", async () => {
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    for (const h of ["Purpose and scope", "Product", "Site", "Process overview", "PAR and NOR check", "Open items", "Overrides", "Version"]) expect(text).toContain(h);
    expect(text).toContain(NO_REASON_RECORDED);
    expect(text).toContain("overridden; project:");
    expect(text).toContain("Requires regulatory affairs assessment");
    expect(text).not.toMatch(/filing category/i);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd.docx"), out.bytes);
    writeFileSync(join(dir, "trd.html"), renderHtml(doc));
    writeFileSync(join(dir, "trd.txt"), text);
  });

  it("html carries the banner and the same override text", () => {
    const html = renderHtml(doc);
    expect(html).toContain(BANNER);
    expect(html).toContain(NO_REASON_RECORDED);
  });

  it("their look and placeholder tags work for the TRD, including a per-step section tag", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis };
    const look = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "their_look", generatedAt: GENERATED_AT, template: tmpl });
    const lookText = plainText(strictDocx(look.bytes));
    expect(lookText).toContain(BANNER);
    expect(lookText).toContain("PAR and NOR check");

    const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@section_par_nor}")}${P("{@section_step_TS_01}")}$1`));
    const bytes = zip.generate({ type: "uint8array" });
    const tagged = await importTemplateFile("tagged.docx", bytes);
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "tags", generatedAt: GENERATED_AT, template: { ...tmpl, sha256: tagged.sha256, bytes: tagged.bytes, analysis: tagged.analysis } });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Technical requirements document");
    expect(text).toContain("PAR and NOR check");
    expect(text).toContain(BANNER);
  });

  it("a section tag reaches the standard document's process steps and parameters", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis };
    const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@section_process_parameters}")}${P("{@section_references}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const out = await renderDocx({ doc: standard, tagData: buildDocumentTagData(standard), mode: "tags", generatedAt: GENERATED_AT, template: { ...tmpl, sha256: tagged.sha256, bytes: tagged.bytes, analysis: tagged.analysis } });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Process steps and parameters");
    expect(text).toContain("References");
    expect(text).not.toContain("PAR and NOR check");
    expect(text).toContain(BANNER);
  });
});
