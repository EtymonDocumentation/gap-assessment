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

/**
 * The TRD is two documents: the short standard one sent for approval, and the evidence record for audit and inspection. The standard
 * one must stay short (about 15 pages for SYR-305) and the evidence record must still hold everything the standard one leaves out.
 * Samples go to the temp folder (gap-docx-samples/syr305d) for a look at the pages.
 */
describe("Standard TRD and evidence record in Word", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const d = project.trd.documents[0]!;
  const standard = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content });
  const evidence = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content, variant: "evidence" });
  const dir = join(tmpdir(), "gap-docx-samples", "syr305d");

  it("writes the standard TRD without appendices, other recorded values or source columns", async () => {
    const out = await renderDocx({ doc: standard, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    for (const gone of ["Other recorded values", "Process description values", "Traceability", "Source register", "PAR and NOR check", "Basis", "Classification"]) expect(text, gone).not.toContain(gone);
    // Sources are named once, in a sentence, and no source column or register is printed.
    expect(text).toContain("Sources are listed under References and in the TRD evidence record.");
    expect(text).not.toContain("Source register");
    expect(text).not.toContain("Section 18");
    // One parameter table per step with the five columns of a TRD reader.
    expect(text).toContain("Set point");
    expect(text).toContain("References");
    // The document control page carries the TRD's own reference and roles, not placeholders.
    expect(text).not.toContain("[to be assigned]");
    expect(text).toContain(d.docRef!);
    expect(text).not.toMatch(/\b1 hours\b/);
    expect(text).not.toMatch(/[–-]-\d/);
    // Answer labels read as sentences, never as "label: value" leftovers, and the sign-off cells are empty to write in.
    for (const gone of ["(s)", ": Yes", ": No", "Available and applicable", "[placeholder]", "[date]", "crimp", "Labeling", "single sterile filter"]) expect(text, gone).not.toContain(gone);
    expect(text).not.toMatch(/; [A-Z]/);
    expect(text).not.toMatch(/\bmax \d/);
    expect(text.match(/\(\w[^()]*\([^()]*\)\)/)?.[0]).toBeUndefined();
    expect(text).toContain("within 1 business day of receipt");
    expect(text).toContain("Product density: 1.03 g/mL");
    expect(text).toContain("tolerance of ±0.5 mm");
    expect(text).toContain("A second, redundant sterilizing-grade filter is used in series.");
    // Acronym list: the abbreviations the text uses are in, the ones it never uses are out.
    const list = text.slice(text.indexOf("Common abbreviations"), text.indexOf("Common abbreviations") + 900);
    for (const a of ["AVI", "NOR", "PAR", "PFS", "MSAT"]) expect(list, a).toContain(a);
    // The References list names each source once.
    expect((text.match(/DEMO-SHIP-305-01:/g) ?? []).length).toBe(1);
    expect(text).not.toContain("DEMO-SHS-305-01");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd.docx"), out.bytes);
    writeFileSync(join(dir, "trd.html"), renderHtml(standard));
    writeFileSync(join(dir, "trd.txt"), text);
  });

  it("the evidence record still carries everything", async () => {
    const out = await renderDocx({ doc: evidence, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("evidence record");
    expect(text).toContain("not for approval");
    for (const kept of ["Other recorded values", "Process description values", "Source register", "Traceability", "PAR and NOR check", "Basis", "Sources", "Status"]) expect(text, kept).toContain(kept);
    expect(text).not.toContain("[to be assigned]");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-evidence.docx"), out.bytes);
    writeFileSync(join(dir, "trd-evidence.html"), renderHtml(evidence));
    writeFileSync(join(dir, "trd-evidence.txt"), text);
  });

  it("tags mode works for the standard TRD", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const P = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@body}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: tagged.sha256, fileName: "sample", bytes: tagged.bytes, analysis: tagged.analysis };
    const out = await renderDocx({ doc: standard, tagData: buildDocumentTagData(standard), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Manufacturing process overview");
    expect(text).toContain(BANNER);
    expect(text).toContain("References");
    void t;
  });
});
