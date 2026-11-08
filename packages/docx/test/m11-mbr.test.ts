/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { emptyProject } from "@gap/process-model";
import { buildDemoProject, buildMbrDocument, CMO_PLACEHOLDER } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { buildDocumentTagData, buildStarterTemplate, importTemplateFile, renderDocx } from "../src/index";
import { BANNER, GENERATED_AT, buildModel, fixture } from "./fixtures";
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

  it("the parameter table gives the reason column its share, in Word and in HTML (samples go to m11b)", async () => {
    // A long reason, as a CMO would write one, to see that it reads well in the wider column.
    const long = "The CMO's filter validation covers 0.45 to 1.8 bar only for this filter family, and the shorter hold time was agreed with quality assurance after the second engineering batch; confirm again before the PPQ campaign starts.";
    const rec2 = structuredClone(rec);
    const param = rec2.sections.flatMap((s) => s.blocks).flatMap((b) => b.params)[0]!;
    param.choice = "tightened_by_cmo";
    param.reason = long;
    const doc2 = buildMbrDocument(project, rec2, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const out = await renderDocx({ doc: doc2, mode: "builtin", generatedAt: GENERATED_AT });
    const xml = strictDocx(out.bytes).text("word/document.xml");
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!;
    const tbl = tables.find((t) => t.includes("Reason and notes"))!;
    const grid = [...tbl.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)![0].matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    const total = grid.reduce((a, b) => a + b, 0);
    expect(grid).toHaveLength(4);
    const share = grid.map((g) => Math.round((g / total) * 100));
    // 22 / 34 / 14 / 30 percent, give or take the rounding and the room the longest words need.
    expect(share[3]).toBeGreaterThanOrEqual(28);
    expect(share[3]).toBeLessThanOrEqual(32);
    expect(share[0]).toBeGreaterThanOrEqual(20);
    expect(share[1]).toBeGreaterThanOrEqual(32);
    expect(plainText(strictDocx(out.bytes))).toContain("The CMO's filter validation");

    const html = renderHtml(doc2);
    const cols = [...html.match(/<colgroup>(?:<col style="width:[\d.]+%">){4}<\/colgroup><thead><tr><th scope="col">Parameter</)![0].matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(cols).toEqual([22, 34, 14, 30]);

    const dir2 = join(tmpdir(), "gap-docx-samples", "m11b");
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, "mbr.docx"), out.bytes);
    writeFileSync(join(dir2, "mbr.html"), html);
  });

  it("html carries the banner and the CMO placeholder", () => {
    const html = renderHtml(doc);
    expect(html).toContain(BANNER);
    expect(html).toContain(CMO_PLACEHOLDER);
  });

  it("their look and placeholder tags work for the batch record, including a per-section tag", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis };
    const look = await renderDocx({ doc, tagData: buildDocumentTagData(doc, content, project), mode: "their_look", generatedAt: GENERATED_AT, template: tmpl });
    expect(plainText(strictDocx(look.bytes))).toContain(BANNER);

    const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@section_basis}")}${P("{@section_section_SC_01}")}$1`));
    const bytes = zip.generate({ type: "uint8array" });
    const tagged = await importTemplateFile("tagged.docx", bytes);
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc, content, project), mode: "tags", generatedAt: GENERATED_AT, template: { ...tmpl, sha256: tagged.sha256, bytes: tagged.bytes, analysis: tagged.analysis } });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Basis and how to read this draft");
    expect(text).toContain(BANNER);
  });

  it("fills the project's own tags ({program}, {modality}, the sites) in the batch record, not [not available]", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("PROG={program}")}${P("MOD={modality}")}${P("SRC={sourceSite}")}${P("TGT={receivingSite}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: tagged.sha256, fileName: "sample", bytes: tagged.bytes, analysis: tagged.analysis };
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc, content, project), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    const text = plainText(strictDocx(out.bytes));
    const gap = buildModel().tagData;
    expect(gap.program).not.toBe("[TBD]");
    expect(text).toContain(`PROG=${gap.program}`);
    expect(text).toContain(`MOD=${gap.modality}`);
    expect(text).toContain(`SRC=${gap.sourceSite}`);
    expect(text).toContain(`TGT=${gap.targetSite}`);
    expect(text).not.toContain("[not available]");
    void t;
  });

  it("the starter placeholder-tag template gets {program} and {modality} filled in the batch record; a sample goes to the temp folder", async () => {
    const starter = await importTemplateFile("starter-tag-template.docx", buildStarterTemplate());
    const tmpl = { name: "Starter tags (fictional)", version: "1", sha256: starter.sha256, fileName: "starter", bytes: starter.bytes, analysis: starter.analysis };
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc, content, project), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    const wdir = join(tmpdir(), "gap-docx-samples", "wfix");
    mkdirSync(wdir, { recursive: true });
    writeFileSync(join(wdir, "mbr-starter-tags.docx"), out.bytes);
    const xml = plainText(strictDocx(out.bytes));
    const gap = buildModel().tagData;
    expect(xml).toContain(gap.program);
    expect(xml).toContain(gap.modality);
    // The project's own rows are filled. The gap counts (differences, open items) stay "[not available]" outside the gap assessment, on purpose.
    for (const row of ["Program", "Modality", "Sending unit (SU) site", "Receiving unit (RU) site"]) expect(xml.replace(/\s+/g, " "), row).not.toContain(`${row} [not available]`);
  });

  it("an unknown project value reads the usual unknown wording, never invented text", () => {
    const blank = emptyProject({ title: "Blank (fictional)", actor: { name: "Pat Placeholder (fictional)", at: GENERATED_AT }, contentRefs: content.versions });
    const data = buildDocumentTagData(doc, content, blank);
    expect(data.program).toBe("[TBD]");
    expect(data.sourceSite).toBe("[site TBD]");
  });
});
