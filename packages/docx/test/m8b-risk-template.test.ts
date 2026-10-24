/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildRiskAssessmentDocument, documentFingerprint } from "@gap/engine";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { buildDocumentTagData, importTemplateFile, renderDocx, TAG_REFERENCE, TemplateError, type ImportedTemplate, type RenderDocxInput } from "../src/index";
import { BANNER, GENERATED_AT, fixture } from "./fixtures";
import { customProps, plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * M8 follow-up: the risk assessment Word output goes through the user's Templates library the way the gap document does. The kinds
 * that can work for any document are offered ("their look", "placeholder tags"); "map to their headings" is a gap-document feature
 * (the saved mapping names gap sections), so it is not offered for the risk assessment. Samples are written to the temp folder.
 */
describe("risk assessment Word output with a template from the library (M8 follow-up)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const a = project.risk.assessments[0]!;
  const doc = buildRiskAssessmentDocument(content, project, a, failureModes, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
  const dir = join(tmpdir(), "gap-docx-samples", "m8b");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  /** The fictional Brightwater look with its body replaced by the given paragraphs (a tagged template). */
  function tagDoc(...paragraphs: string[]): Uint8Array {
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${paragraphs.join("")}$1`));
    return zip.generate({ type: "uint8array" });
  }
  const input = (mode: RenderDocxInput["mode"], t?: ImportedTemplate): RenderDocxInput => ({
    doc,
    tagData: buildDocumentTagData(doc),
    mode,
    generatedAt: GENERATED_AT,
    ...(t ? { template: { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis } } : {}),
  });
  const save = (name: string, bytes: Uint8Array) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), bytes);
  };

  it("builds the built-in sample for comparison", async () => {
    const out = await renderDocx(input("builtin"));
    const res = strictDocx(out.bytes);
    expect(plainText(res)).toContain(BANNER);
    expect(out.templateRecord.mode).toBe("builtin");
    save("risk-builtin.docx", out.bytes);
  });

  it("their look: the risk sections are written in the template's styles, header, footer and page setup, with the banner", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const out = await renderDocx(input("their_look", t));
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    expect(res.text("word/styles.xml")).toContain('w:styleId="BBHeading1"');
    expect(res.text("word/document.xml")).toContain('w:val="BBHeading1"');
    const hdr = res.names.find((n) => /^word\/header\d*\.xml$/.test(n))!;
    expect(plainText(res, hdr)).toContain("Brightwater Biologics (fictional)");
    expect(text).toContain(BANNER);
    for (const h of ["Purpose and scope", "Risk method", "Risk register", "Open items"]) expect(text).toContain(h);
    expect(text).not.toMatch(/filing category/i);
    // The export record: the template used and the document's fingerprint travel with the file, as for the gap document.
    expect(out.templateRecord).toEqual({ mode: "their_look", name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample" });
    const p = customProps(res);
    expect(p.templateMode).toBe("their_look");
    expect(p.templateSha256).toBe(t.sha256);
    expect(p.documentFingerprint).toBe(documentFingerprint(doc));
    save("risk-their-look.docx", out.bytes);
  });

  it("placeholder tags: {title}, {generated}, {@body} and one section tag are filled; gap-only tags stay empty", async () => {
    const bytes = tagDoc(P("{banner}"), P("Title: {title}"), P("Generated: {generated}"), P("Program: {program}"), P("{#gaps}"), P("GAPVALUE {id}"), P("{/gaps}"), P("{@section_register}"));
    const t = await importTemplateFile("risk-tags.docx", bytes);
    // The risk-only section tag is in the reference, so the template is not reported as using an unknown tag.
    expect(t.analysis.tags!.unknown).not.toContain("section_register");
    const out = await renderDocx(input("tags", t));
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    expect(text).toContain("Title: Risk assessment — draft");
    expect(text).toContain("Risk register");
    expect(text).toContain("RA-001");
    expect(text).toContain("Program: [not available]");
    expect(text).not.toContain("GAPVALUE");
    expect(text).toContain(BANNER);
    expect(customProps(res).templateMode).toBe("tags");
    save("risk-tags.docx", out.bytes);
  });

  it("placeholder tags: {@body} brings the whole risk document in the template's heading and table styles", async () => {
    const t = await importTemplateFile("risk-body.docx", tagDoc(P("{banner}"), P("{@body}")));
    const out = await renderDocx(input("tags", t));
    const res = strictDocx(out.bytes);
    const text = plainText(res);
    for (const s of doc.sections) expect(text).toContain(s.title.replace(/^[A-Z0-9]+\.\s*/, ""));
    expect(res.text("word/document.xml")).toContain("BBHeading");
  });

  it("lists every risk-only section as a raw tag in the tag reference", () => {
    const raw = TAG_REFERENCE.filter((r) => r.kind === "raw").map((r) => r.tag);
    for (const id of ["purpose_scope", "method", "register", "heat", "actions", "traceability", "versions"]) expect(raw).toContain(`section_${id}`);
  });

  it("refuses a template mode that has no template, in plain words", async () => {
    await expect(renderDocx(input("their_look"))).rejects.toThrow(TemplateError);
  });

  it("the document tag data holds only what every document has", () => {
    expect(Object.keys(buildDocumentTagData(doc)).sort()).toEqual(["activities", "approvals", "banner", "ccParties", "equipment", "fromParties", "gaps", "generated", "meta", "openItems", "parties", "risks", "sections", "sources", "status", "title", "toParties"]);
  });
});

