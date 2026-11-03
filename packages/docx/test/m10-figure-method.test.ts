/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { expectNoPrivateTerms } from "../../../test-support/private-terms";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { nodeRasteriser } from "./figure-rasteriser";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 120000 });

/**
 * How each sample is taken, drawn in the PPQ flow figures, through the whole Word path: the figure SVG (dashed lines, rings, text)
 * is rasterised to a PNG, the words go into the picture's description, and the sample table row says the same in text. Files are
 * written to the temp folder (gap-docx-samples/smp-method-c) so a person can open the Word files and the figure pages as PNG.
 */
describe("Word flow figures show how each sample is taken", () => {
  const dir = join(tmpdir(), "gap-docx-samples", "smp-method-c");
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const demoProjects = {
    "syr-305": buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }),
    "arx-217": buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts),
  };

  for (const [name, project] of Object.entries(demoProjects)) {
    for (const style of ["time_scale", "step_cards"] as const) {
      it(`${name}, ${style}: pictures carry the glyphs, the description and the table row say it in words`, async () => {
        const plan = project.sampling.plans[0]!;
        const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { ...opts, figureStyle: style });
        const figs = doc.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "figure" ? [b] : [])));
        const svg = figs.flatMap((f) => f.pages.map((p) => p.svg)).join("\n");
        const answered = plan.points.filter((p) => p.method?.access || p.method?.flush);
        expect(answered.length).toBeGreaterThan(0);
        // The drawing: glyph lines, and at least one stated flush written as "N mL to waste".
        expect(svg).toContain("<polyline");
        expect(svg).toMatch(/>\d+(\.\d+)? (mL|L) to waste</);
        // Dashes and text survive the rasteriser: it must not fail or warn, and every page becomes a PNG.
        const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, rasteriser: nodeRasteriser });
        expect(out.warnings).toEqual([]);
        const zip = new PizZip(out.bytes);
        const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && n.endsWith(".png"));
        expect(media).toHaveLength(figs.reduce((n, f) => n + f.pages.length, 0));
        const text = plainText(strictDocx(out.bytes));
        // The same facts in words, in the sample table row of an answered point.
        expect(text).toContain("How the sample is taken");
        expect(text).toContain("Sample taken through:");
        // The picture description (alt text) names the method of each sample that states one.
        const xml = zip.file("word/document.xml")!.asText();
        // And as a visible line under the picture, in Word and in the HTML export.
        expect(plainText(strictDocx(out.bytes))).toContain("How the sample is taken, as the plan states it:");
        expect(renderHtml(doc)).toContain('data-testid="figure-method-note"');
        expect(xml).toMatch(/descr="[^"]*How the sample is taken, as the plan states it: SP-\d+/);
        // Nothing from a real client in the Word XML.
        expect(xml).not.toMatch(/CTP\d{4}|QC\d{4}/);

        expectNoPrivateTerms(xml);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}-${style}.docx`), out.bytes);
        writeFileSync(join(dir, `${name}-${style}.html`), renderHtml(doc));
        // The figure pages as pictures, for a person to look at.
        let k = 0;
        for (const f of figs) {
          for (const pg of f.pages) {
            const png = await nodeRasteriser({ svg: pg.svg, widthPt: pg.width, heightPt: pg.height }, 150);
            writeFileSync(join(dir, `${name}-${style}-fig${f.number}-p${++k}.png`), png);
          }
        }
      });
    }
  }

  it("a plan whose points state no method gets the same figure as before (nothing added)", async () => {
    const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
    for (const p of project.sampling.plans[0]!.points) delete p.method;
    const doc = buildSamplingPlanDocument(content, project, project.sampling.plans[0]!, samplingSuggestions, opts);
    const figs = doc.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "figure" ? [b] : [])));
    const svg = figs.flatMap((f) => f.pages.map((p) => p.svg)).join("\n");
    expect(svg).not.toContain("to waste<");
    expect(svg).not.toContain("How taken");
    expect(figs.every((f) => !f.alt.includes("How the sample is taken"))).toBe(true);
  });
});
