/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { buildDemoProject, buildMbrDocument, CMO_PLACEHOLDER } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { buildDocumentTagData, importTemplateFile, renderDocx } from "../src/index";
import { BANNER, GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** M11: the master batch record goes through the same Word and HTML renderers and the Templates library. Samples go to the temp folder. */
describe("Word and HTML master batch record (M11)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
  const rec = project.mbr.records[0]!;
  const doc = buildMbrDocument(project, rec, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
  const dir = join(tmpdir(), "gap-docx-samples", "m11");

  it("renders the demo batch record with banner, numbered steps, tables and CMO placeholders, and writes samples", async () => {
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    expect(text).toContain("Master batch record");
    expect(text).toContain(CMO_PLACEHOLDER);
    expect(text).toContain("Tighter than the TRD");
    expect(text).toContain("Requires regulatory affairs assessment");
    expect(text).not.toMatch(/filing category/i);
    expect(text).not.toMatch(/\b(violation|non-compliant)\b/i);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mbr.docx"), out.bytes);
    writeFileSync(join(dir, "mbr.html"), renderHtml(doc));
    writeFileSync(join(dir, "mbr.txt"), text);
  });

  it("html carries the banner and the CMO placeholder", () => {
    const html = renderHtml(doc);
    expect(html).toContain(BANNER);
    expect(html).toContain(CMO_PLACEHOLDER);
  });

  it("their look and placeholder tags work for the batch record, including a per-section tag", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis };
    const look = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "their_look", generatedAt: GENERATED_AT, template: tmpl });
    expect(plainText(strictDocx(look.bytes))).toContain(BANNER);

    const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@section_basis}")}${P("{@section_section_SC_01}")}$1`));
    const bytes = zip.generate({ type: "uint8array" });
    const tagged = await importTemplateFile("tagged.docx", bytes);
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "tags", generatedAt: GENERATED_AT, template: { ...tmpl, sha256: tagged.sha256, bytes: tagged.bytes, analysis: tagged.analysis } });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Basis and how to read this draft");
    expect(text).toContain(BANNER);
  });
});
