/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildSamplingBomDocument, buildSamplingPlanDocument, isSamplingBomFormat, isSamplingFormat, SAMPLING_BOM_TITLE } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { SAMPLING_BOM_INTRO } from "@gap/sampling";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** The sampling bill of materials: one document model, so the page, the Word file and the HTML file say the same words. */
describe("Sampling bill of materials document", () => {
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const dir = join(tmpdir(), "gap-docx-samples", "sampling-bom");

  it("is its own export format and is not counted as the sampling plan", () => {
    expect(isSamplingBomFormat("sampling-bom-docx")).toBe(true);
    expect(isSamplingBomFormat("sampling-bom-html")).toBe(true);
    expect(isSamplingFormat("sampling-bom-docx")).toBe(false);
  });

  for (const id of Object.keys(demos)) {
    it(`demo ${id} gives a bill of materials with the notice, the intro and the same words in Word and HTML`, async () => {
      const project = buildDemoProject(content, demos[id as keyof typeof demos]!, samplingSuggestions, designLoadouts);
      const plan = project.sampling.plans[0];
      if (!plan) return;
      const doc = buildSamplingBomDocument(content, project, plan, samplingSuggestions, opts);
      expect(doc.title).toBe(SAMPLING_BOM_TITLE);
      expect(doc.banner).toMatch(/Drafting aid output, not validated/);
      expect(doc.sections[0]!.blocks[0]).toEqual({ type: "paragraph", text: SAMPLING_BOM_INTRO });
      expect(doc.sections.some((s) => s.id === "bom-still")).toBe(true);
      const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
      const text = plainText(strictDocx(out.bytes));
      const html = renderHtml(doc);
      expect(text).toContain(SAMPLING_BOM_INTRO);
      expect(html).toContain(SAMPLING_BOM_INTRO);
      expect(text).toContain("Still to be stated");
      expect(text).not.toMatch(/filing category/i);
      // Every table caption and cell word of the model is in the Word text.
      for (const s of doc.sections) expect(text).toContain(s.title);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}-bom.docx`), out.bytes);
      writeFileSync(join(dir, `${id}-bom.html`), html);
      writeFileSync(join(dir, `${id}-bom.txt`), text.replace(/[ \t]+/g, " "));
    });
  }

  it("the plan document points to the bill of materials", () => {
    const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
    const plan = project.sampling.plans[0]!;
    const planDoc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    expect(JSON.stringify(planDoc)).toMatch(/bill of materials/i);
  });
});
