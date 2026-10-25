/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { addPart, buildDemoProject, buildTrdDocument, placeholderPng, setPartImage, setPartText, setTableRows } from "@gap/engine";
import { readTrdImage } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { buildDocumentTagData, importTemplateFile, renderDocx } from "../src/index";
import { GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

const who = { name: "Alex Example (fictional)", at: "2026-10-25T09:00:00.000Z" };

/** The smallest byte string the picture reader accepts as a JPEG: start, a frame header with the size, end. Enough for the package; Word is not asked to draw it. */
const fakeJpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

/** M9.1 gap closure: pictures in figures and rows in tables, in every Word mode. Samples go to the temp folder for a look at the pages. */
describe("Word figures with pictures and tables with rows (M9.1)", () => {
  const base = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const d0 = base.trd.documents[0]!;
  const stopper = d0.writeups!.find((w) => w.libraryId === "sec_stopper_position")!;
  const fig = stopper.parts.find((p) => p.kind === "figure")!;
  // A second figure with a JPEG, a third with no picture, and a big PNG that must be scaled down to the text width.
  let project = base;
  const big = readTrdImage(placeholderPng(1000, 500), { name: "big.png" });
  project = setPartImage(project, d0.id, stopper.id, fig.id, big, who);
  const added = addPart(project, d0.id, stopper.id, { kind: "figure", text: "", caption: "A second picture", alt: "Second picture" }, who);
  project = setPartImage(added.project, d0.id, stopper.id, added.partId, readTrdImage(fakeJpeg(300, 200), { name: "photo.jpg" }), who);
  project = addPart(project, d0.id, stopper.id, { kind: "figure", text: "", caption: "Not yet drawn" }, who).project;
  const d = project.trd.documents[0]!;
  const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content });
  const dir = join(tmpdir(), "gap-docx-samples", "m91g");

  it("the built-in look carries a numbered picture scaled to the text width, a jpeg and a note for the figure with no picture", async () => {
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const zip = new PizZip(out.bytes);
    const xml = zip.file("word/document.xml")!.asText();
    const text = plainText(strictDocx(out.bytes));
    expect(Object.keys(zip.files).filter((n) => n.startsWith("word/media/")).sort()).toEqual(["word/media/gapfigure1.png", "word/media/gapfigure2.jpg"]);
    const types = zip.file("[Content_Types].xml")!.asText();
    expect(types).toMatch(/Extension="png"/);
    expect(types).toMatch(/Extension="jpg"[^>]*image\/jpeg/);
    expect(text).toContain("Figure 1. Stopper position measured from the barrel flange (fictional placeholder)");
    expect(text).toContain("Figure 2. A second picture");
    expect(text).toContain("Figure to be added: Not yet drawn");
    // The big picture is scaled down to fit the text width and keeps its 2:1 shape.
    const ext = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(ext).toHaveLength(2);
    const [cx, cy] = ext[0]!;
    // The built-in look is landscape (about 10 inches of text); the natural width of 1000 pixels would be 10.4 inches.
    expect(cx).toBeLessThan(750 * 12700);
    expect(cx).toBeLessThanOrEqual(11 * 914400);
    expect(cx / cy).toBeCloseTo(2, 1);
    // The small jpeg is not blown up: 300 by 200 pixels at 96 per inch is 225 by 150 points.
    expect(ext[1]).toEqual([225 * 12700, 150 * 12700]);
    // The alternative text travels with the picture.
    expect(xml).toContain('descr="Placeholder panel standing in for a schematic');
    expect(xml).toContain('descr="Second picture"');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "trd-figures-builtin.docx"), out.bytes);
    writeFileSync(join(dir, "trd-figures.html"), renderHtml(doc));
    writeFileSync(join(dir, "trd-figures.md"), renderMarkdown(doc));
  });

  it("HTML and markdown embed the picture and number the caption the same way", () => {
    const html = renderHtml(doc);
    const md = renderMarkdown(doc);
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain("<figcaption>Figure 1. Stopper position measured from the barrel flange (fictional placeholder)</figcaption>");
    expect(html).toContain("<figcaption>Figure 2. A second picture</figcaption>");
    expect(md).toContain("![Placeholder panel standing in for a schematic");
    expect(md).toContain("**Figure 1. Stopper position measured from the barrel flange (fictional placeholder)**");
    expect(md).toContain("**Figure to be added**: Not yet drawn");
  });

  it("works in tags mode: {@body} carries the picture and its media part", async () => {
    const P = (s: string) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
    const zip = new PizZip(fixture("brightwater-template.docx"));
    const xml = zip.file("word/document.xml")!.asText();
    zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*?(<w:sectPr)/, `<w:body>${P("{title}")}${P("{@body}")}$1`));
    const tagged = await importTemplateFile("tagged.docx", zip.generate({ type: "uint8array" }));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: tagged.sha256, fileName: "sample", bytes: tagged.bytes, analysis: tagged.analysis };
    const out = await renderDocx({ doc, tagData: buildDocumentTagData(doc), mode: "tags", generatedAt: GENERATED_AT, template: tmpl });
    const z = new PizZip(out.bytes);
    expect(Object.keys(z.files).some((n) => n.startsWith("word/media/gapfigure"))).toBe(true);
    expect(z.file("word/_rels/document.xml.rels")!.asText()).toContain("rIdFig1");
    expect(plainText(strictDocx(out.bytes))).toContain("Figure 1. Stopper position measured from the barrel flange (fictional placeholder)");
    writeFileSync(join(dir, "trd-figures-tags.docx"), out.bytes);
  });

  it("works in a customer's look (their-look mode)", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const tmpl = { name: "Brightwater sample (fictional)", version: "2.1", sha256: t.sha256, fileName: "sample", bytes: t.bytes, analysis: t.analysis };
    const out = await renderDocx({ doc, mode: "their_look", generatedAt: GENERATED_AT, template: tmpl });
    expect(Object.keys(new PizZip(out.bytes).files).some((n) => n.startsWith("word/media/gapfigure"))).toBe(true);
    expect(plainText(strictDocx(out.bytes))).toContain("Figure 2. A second picture");
  });
});

describe("Word tables with rows (M9.1)", () => {
  const base = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const d0 = base.trd.documents[0]!;
  const w = d0.writeups!.find((x) => x.libraryId === "sec_dilution_buffer")!;
  const table = w.parts.find((p) => p.kind === "table")!;

  it("the header row comes first, the typed rows follow, and an empty cell stays empty", async () => {
    const project = setTableRows(base, d0.id, w.id, table.id, [["Excipient Z", "Material Z (fictional)", "2 % w/v", ""]], who);
    const d = project.trd.documents[0]!;
    const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content });
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const xml = new PizZip(out.bytes).file("word/document.xml")!.asText();
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Excipient Z");
    expect(text).toContain("Material Z (fictional)");
    // The first row of a table is marked as its header row so it repeats on the next page.
    expect(xml).toContain("<w:tblHeader/>");
    const html = renderHtml(doc);
    expect(html).toContain("<td>Excipient Z</td><td>Material Z (fictional)</td><td>2 % w/v</td><td></td>");
    expect(renderMarkdown(doc)).toContain("| Excipient Z | Material Z (fictional) | 2 % w/v |  |");
    mkdirSync(join(tmpdir(), "gap-docx-samples", "m91g"), { recursive: true });
    writeFileSync(join(tmpdir(), "gap-docx-samples", "m91g", "trd-table-rows.docx"), out.bytes);
  });

  it("a table cell with a blank shows the value when the TRD has one and the label in brackets when it has none", () => {
    const project = setPartText(setTableRows(base, d0.id, w.id, table.id, [["A", "B", "C", "{{trd.nothing.known|Quantity to be decided}}"]], who), d0.id, w.id, table.id, {}, who);
    const d = project.trd.documents[0]!;
    const doc = buildTrdDocument(project, d, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test", content });
    expect(renderMarkdown(doc)).toContain("[Quantity to be decided]");
  });
});
