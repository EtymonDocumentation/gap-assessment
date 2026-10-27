/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCmoInstructionsDocument, buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { nodeRasteriser } from "./figure-rasteriser";
import { BANNER, GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 120000 });

/**
 * The SYR-305 PPQ sampling plan (Table 4 samples 1 to 17, three batches), its CMO instructions and the flow figure in Word and HTML.
 * Samples go to the temp folder (gap-docx-samples/syr305i-ppq) so a person can read them; a plain-text dump is written too.
 */
describe("SYR-305 PPQ sampling plan in Word and HTML", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const plan = project.sampling.plans[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const dir = join(tmpdir(), "gap-docx-samples", "syr305i-ppq");
  const flat = (t: string) => t.replace(/[ \t]+/g, " ");

  it("writes the plan with the process flow figure, all 17 points and the three batches", async () => {
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT, rasteriser: nodeRasteriser });
    expect(out.warnings).toEqual([]);
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    for (const n of ["SP-001", "SP-009", "SP-017"]) expect(text, n).toContain(n);
    for (const b of ["PPQ 1", "PPQ 2", "PPQ 3"]) expect(text, b).toContain(b);
    expect(text).toContain("Figure 1");
    expect(text).not.toMatch(/filing category/i);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sampling-plan.docx"), out.bytes);
    writeFileSync(join(dir, "sampling-plan.html"), renderHtml(doc));
    writeFileSync(join(dir, "sampling-plan.txt"), flat(text));
  });

  it("writes the CMO instructions", async () => {
    const doc = buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    expect(text).toContain("Reporting instructions per sampling point");
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cmo-instructions.docx"), out.bytes);
    writeFileSync(join(dir, "cmo-instructions.html"), renderHtml(doc));
    writeFileSync(join(dir, "cmo-instructions.txt"), flat(text));
  });
});
