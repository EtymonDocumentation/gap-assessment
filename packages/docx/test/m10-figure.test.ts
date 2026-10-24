/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../../../content/index";
import { FIGURE_DPI, importTemplateFile, renderDocx } from "../src/index";
import { nodeRasteriser } from "./figure-rasteriser";
import { GENERATED_AT, fixture } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 120000 });

/**
 * Milestone 10: the PPQ flow figures in the Word export. Landscape pages, a PNG of at least 200 dpi per figure page, a numbered
 * caption, the legend inside every picture, and the long sample table after the figures. Files are written to the temp folder
 * (gap-docx-samples/m10) so a person can open them.
 */
describe("Word flow figures (M10)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
  const plan = project.sampling.plans[0]!;
  const dir = join(tmpdir(), "gap-docx-samples", "m10");
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const pngSize = (b: Uint8Array) => ({ w: new DataView(b.buffer, b.byteOffset).getUint32(16), h: new DataView(b.buffer, b.byteOffset).getUint32(20) });

  for (const style of ["time_scale", "step_cards"] as const) {
    it(`writes the demo plan with the ${style} figures as pictures`, async () => {
      const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { ...opts, figureStyle: style });
      const figs = doc.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "figure" ? [b] : [])));
      expect(figs.length).toBe(2); // the buffer sub-process first, then the main process
      expect(figs[0]!.caption).toContain("Buffer");
      const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, rasteriser: nodeRasteriser });
      expect(out.warnings).toEqual([]);
      const res = strictDocx(out.bytes);
      const text = plainText(res);
      expect(text).toContain("Figure 1: ");
      expect(text).toContain("Figure 2 (page 1 of");
      expect(text.indexOf("Figure 1: ")).toBeLessThan(text.indexOf("Sampling points per process step and position"));
      const zip = new PizZip(out.bytes);
      const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && n.endsWith(".png"));
      const pages = figs.reduce((n, f) => n + f.pages.length, 0);
      expect(media).toHaveLength(pages);
      const first = zip.file(media[0]!)!.asUint8Array();
      expect([...first.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      // At least 200 dpi: pixels = printed points * dpi / 72.
      const wPt = figs[0]!.pages[0]!.width;
      expect(pngSize(first).w).toBeGreaterThanOrEqual(Math.floor((wPt * 200) / 72));
      expect(FIGURE_DPI).toBeGreaterThanOrEqual(200);
      expect(zip.file("[Content_Types].xml")!.asText()).toContain('Extension="png"');
      expect(zip.file("word/_rels/document.xml.rels")!.asText()).toContain("media/gapfigure1.png");
      const docXml = zip.file("word/document.xml")!.asText();
      expect(docXml).toContain("<wp:docPr");
      expect(docXml).toMatch(/descr="Figure 1: [^"]+"/);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `sampling-plan-${style}.docx`), out.bytes);
      writeFileSync(join(dir, `sampling-plan-${style}.html`), renderHtml(doc));
    });
  }

  it("a portrait template gets a landscape section around each figure page and back", async () => {
    const t = await importTemplateFile("brightwater-template.docx", fixture("brightwater-template.docx"));
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "their_look", generatedAt: GENERATED_AT, rasteriser: nodeRasteriser, template: { name: "Fictional template", version: "1.0", sha256: t.sha256, fileName: "brightwater-template.docx", bytes: t.bytes, analysis: t.analysis } });
    strictDocx(out.bytes);
    const xml = new PizZip(out.bytes).file("word/document.xml")!.asText();
    const landscapes = xml.match(/<w:pgSz[^>]*w:orient="landscape"/g) ?? [];
    expect(landscapes.length).toBeGreaterThanOrEqual(2);
    const sizes = [...xml.matchAll(/<w:pgSz[^>]*>/g)].map((m) => (m[0].match(/w:w="(\d+)"/)?.[1] ?? "0") < (m[0].match(/w:h="(\d+)"/)?.[1] ?? "0") && Number(m[0].match(/w:w="(\d+)"/)?.[1]) < Number(m[0].match(/w:h="(\d+)"/)?.[1]));
    expect(sizes).toContain(true); // the portrait pages around the figures are kept
  });

  it("without a rasteriser the figure is its caption and a text description, with a warning", async () => {
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(out.warnings.join(" ")).toContain("flow figures");
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Figure 2");
    expect(text).toContain("Steps in order:");
  });

  it("figure style none leaves the process-flow section as it was; HTML embeds the SVG; markdown keeps the description", () => {
    const none = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { ...opts, figureStyle: "none" });
    expect(none.sections.some((s) => s.blocks.some((b) => b.type === "figure"))).toBe(false);
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const html = renderHtml(doc);
    expect(html).toContain("<figure");
    expect(html).toContain('role="img"');
    expect(html).toContain("Figure 1: ");
    expect(renderMarkdown(doc)).toContain("**Figure 1: ");
  });
});
