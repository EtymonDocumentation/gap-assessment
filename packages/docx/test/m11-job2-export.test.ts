/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCmoInstructionsDocument, buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** M11 job 2: the plan's "Design review" appendix and the study-only equipment reach the HTML and the Word file. Samples go to the temp folder. */
describe("plan and CMO exports: design review appendix and study-only equipment", () => {
  it("writes valid Word files that carry the appendix and the equipment", async () => {
    const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
    const plan = project.sampling.plans[0]!;
    const planDoc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const cmoDoc = buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const planHtml = renderHtml(planDoc);
    for (const t of ["Design review", "Not answered yet", "Look again", "Equipment used only for sampling"]) expect(planHtml).toContain(t);
    const planOut = await renderDocx({ doc: planDoc, mode: "builtin", generatedAt: GENERATED_AT });
    const planText = plainText(strictDocx(planOut.bytes));
    expect(planText).toContain("Design review questions and answers");
    expect(planText).toContain("Single-use tubing set with sterile bottles");
    const cmoOut = await renderDocx({ doc: cmoDoc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(plainText(strictDocx(cmoOut.bytes))).toContain("Small peristaltic pump");
    const dir = join(tmpdir(), "gap-docx-samples", "m11-j2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sampling-plan-with-design-review.docx"), planOut.bytes);
    writeFileSync(join(dir, "sampling-plan-with-design-review.html"), planHtml);
    writeFileSync(join(dir, "cmo-instructions.docx"), cmoOut.bytes);
    writeFileSync(join(dir, "cmo-instructions.html"), renderHtml(cmoDoc));
  });
});
