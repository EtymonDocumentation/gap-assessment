/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** Unanswered design review questions get their own line in the plan's HTML and Word export, apart from the open-item number. Samples go to the temp folder. */
describe("sampling plan export: design review line", () => {
  it("carries the unanswered-question line in HTML and Word, and writes samples", async () => {
    const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
    const doc = buildSamplingPlanDocument(content, project, project.sampling.plans[0]!, samplingSuggestions, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const html = renderHtml(doc);
    expect(html).toMatch(/\d+ design review questions not answered yet/);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(plainText(strictDocx(out.bytes))).toMatch(/\d+ design review questions not answered yet/);
    const dir = join(tmpdir(), "gap-docx-samples", "fix2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sampling-plan.docx"), out.bytes);
    writeFileSync(join(dir, "sampling-plan.html"), html);
  });
});
