/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildTrdDocument, trdUnitModel, type DocModel, type TrdMapping } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { importTemplateFile, renderDocx, TemplateError, type ImportedTemplate, type RenderDocxResult, type TrdRenderInput } from "../src/index";
import { BANNER, GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

// M15 job 2: the TRD under the headings of a person's own Word template. The template is the fictional brightwater sample.
vi.setConfig({ testTimeout: 120000 });

const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
const d = project.trd.documents[0]!;
const unitDoc: DocModel = trdUnitModel(buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content }), d);
const dir = join(tmpdir(), "gap-docx-samples", "m15-job2");

// The headings of the sample, by index: 0 Objective, 1 Applicability, 2 Definitions, 3 Comparison of Source and Receiving Processes (no text of its
// own), 4 Process Description, 5 Identified Differences, 6 Required Actions, 7 Outstanding Information, 8 Document Sign-off.
const at = (headingIndex: number, headingText: string, units: string[], existing: "replace" | "keep") => ({ headingIndex, headingText, units, existing });
const BASE: TrdMapping = {
  templateVersion: "2.1",
  headings: [
    at(0, "Objective", ["writeup-purpose"], "replace"),
    at(1, "Applicability", ["writeup-scope"], "replace"),
    at(2, "Definitions", ["writeup-acronyms"], "keep"),
    at(4, "Process Description", ["overview:wu_buffer_prep", "overview:wu_compounding"], "replace"),
    at(7, "Outstanding Information", ["open-items"], "replace"),
    at(8, "Document Sign-off", ["approval"], "replace"),
  ],
};

async function tpl(): Promise<ImportedTemplate> {
  return importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
}

async function make(trd: TrdRenderInput, name: string, doc: DocModel = unitDoc): Promise<{ out: RenderDocxResult; text: string; xml: string }> {
  const t = await tpl();
  const out = await renderDocx({
    doc,
    tagData: {} as never,
    mode: "mapped",
    generatedAt: GENERATED_AT,
    template: { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis },
    trd,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.docx`), out.bytes);
  const res = strictDocx(out.bytes);
  return { out, text: plainText(res), xml: res.text("word/document.xml") };
}

describe("the TRD under a template's headings", () => {
  it("puts content after its heading, keeps the template's styles, and replaces or keeps the template's own text as picked", async () => {
    const { out, text, xml } = await make({ mapping: BASE }, "base");
    const lines = text.split("\n");
    // Banner first, then the template's own headings in their own order and style.
    expect(text.indexOf(BANNER)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(BANNER)).toBeLessThan(text.indexOf("Objective"));
    for (const h of ["Objective", "Applicability", "Definitions", "Process Description", "Document Sign-off"]) expect(lines).toContain(h);
    expect(xml).toContain('w:val="BBHeading1"');
    // "Replace it": the template's instruction text is gone. "Keep it above Cascade's content": it stays, and ours follows.
    expect(text).not.toContain("Describe the objective of this document");
    const defs = lines.findIndex((l) => l === "Definitions");
    expect(lines.slice(defs + 1, defs + 4).join(" ")).toMatch(/\S/);
    expect(out.warnings.some((w) => w.includes("Objective"))).toBe(true);
    // The title block is not placed and is not listed as left out.
    expect(out.omittedBlocks.join(";")).not.toMatch(/document details/i);
    expect(out.templateRecord.mode).toBe("mapped");
  });

  it("one section under a heading replaces Cascade's title; several keep their sub-headings, without Cascade's numbers", async () => {
    const { text } = await make({ mapping: BASE }, "base");
    const lines = text.split("\n");
    // One section ("Purpose" under "Objective"): its title is not written again as a heading.
    const objective = lines.indexOf("Objective");
    expect(lines[objective + 1]).not.toBe("Purpose");
    // Two sections under "Process Description": each keeps its own sub-heading, with no "5.1" style number in front.
    expect(lines).toContain("Buffer preparation");
    expect(lines).toContain("Pooling, compounding and dilution");
    expect(text).not.toMatch(/^\d+(\.\d+)+ (Buffer preparation|Pooling, compounding and dilution)/m);
    const pd = lines.indexOf("Process Description");
    expect(lines.indexOf("Buffer preparation")).toBeGreaterThan(pd);
    expect(lines.indexOf("Buffer preparation")).toBeLessThan(lines.indexOf("Pooling, compounding and dilution"));
  });

  it("keeps the order a person chose for several sections under one heading", async () => {
    const reversed: TrdMapping = { ...BASE, headings: BASE.headings.map((h) => (h.headingIndex === 4 ? { ...h, units: ["overview:wu_compounding", "overview:wu_buffer_prep"] } : h)) };
    const { text } = await make({ mapping: reversed }, "reversed");
    const lines = text.split("\n");
    expect(lines.indexOf("Pooling, compounding and dilution")).toBeLessThan(lines.indexOf("Buffer preparation"));
  });

  it("a heading with no content and no text of its own says [To be completed.] and is counted; written text takes its place", async () => {
    const plain = await make({ mapping: BASE }, "to-complete");
    expect(plain.text).toContain("[To be completed.]");
    expect(plain.out.toComplete).toEqual(["Comparison of Source and Receiving Processes"]);
    expect(plain.xml).toContain('w:val="yellow"');
    const written = await make({ mapping: BASE, headingTexts: [{ headingIndex: 3, headingText: "Comparison of Source and Receiving Processes", text: "First line written by the person.\n\nSecond line." }] }, "written");
    expect(written.text).toContain("First line written by the person.");
    expect(written.text).toContain("Second line.");
    expect(written.text).not.toContain("[To be completed.]");
    expect(written.out.toComplete).toEqual([]);
    // A heading that has text of its own keeps it (no "[To be completed.]" for "Identified Differences").
    expect(plain.text.split("[To be completed.]").length - 1).toBe(1);
  });

  it("leaves content out when the template has no heading for it, says so, and adds it under \"Additional content\" only when asked", async () => {
    const left = await make({ mapping: BASE }, "left-out");
    expect(left.out.omittedBlocks).toContain("References");
    expect(left.text).not.toContain("Additional content");
    expect(left.text).toMatch(/left out|not placed|not in the template/i);
    const back = await make({ mapping: BASE, addedBack: ["references"] }, "added-back");
    expect(back.text).toContain("Additional content");
    expect(back.out.omittedBlocks).not.toContain("References");
    const lines = back.text.split("\n");
    expect(lines.indexOf("References")).toBeGreaterThan(lines.indexOf("Additional content"));
  });

  it("finds its headings again by their words when the template changed, and lists the ones that are gone", async () => {
    // The stored index of "Applicability" is wrong now, its words are not: it is matched by its words. "Gone heading" is not in the template.
    const shifted: TrdMapping = {
      headings: [at(5, "Applicability", ["writeup-scope"], "replace"), at(6, "Gone heading", ["writeup-purpose"], "replace"), ...BASE.headings.filter((h) => h.headingIndex >= 7)],
    };
    const { out, text } = await make({ mapping: shifted }, "rematched");
    const lines = text.split("\n");
    expect(lines.indexOf("Applicability")).toBeGreaterThanOrEqual(0);
    // Purpose is not placed (its heading is gone), so it is listed as left out.
    expect(out.omittedBlocks).toContain("Purpose");
    expect(text).not.toContain("Gone heading");
  });

  it("does not write a section twice, and ignores content the TRD does not have", async () => {
    const twice: TrdMapping = { headings: [at(0, "Objective", ["writeup-purpose", "nothing:here"], "replace"), at(1, "Applicability", ["writeup-purpose"], "replace")] };
    const { text } = await make({ mapping: twice }, "twice");
    expect(text.split("\n").filter((l) => l === "Applicability").length).toBe(1);
  });

  it("refuses to make a file when nothing is matched yet", async () => {
    await expect(make({ mapping: { headings: [] } }, "empty")).rejects.toThrow(TemplateError);
    await expect(make({ mapping: { headings: [] } }, "empty")).rejects.toThrow(/Match your template's headings/);
  });
});
