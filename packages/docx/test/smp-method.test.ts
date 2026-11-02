/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTICE_DOCUMENT, buildCmoInstructionsDocument, buildDemoProject, buildMbrDocument, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * How each sample is taken: the answers and the open reminders reach the Word sampling plan, the CMO instructions and the batch record.
 * The files are also written to the temp folder so a person can open and read them.
 */
describe("Word documents carry how each sample is taken", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
  const plan = project.sampling.plans[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const dir = join(tmpdir(), "gap-docx-samples", "smp-method");
  mkdirSync(dir, { recursive: true });

  it("sampling plan", async () => {
    const out = await renderDocx({ doc: buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("How the sample is taken");
    expect(text).toContain("Sampling method reminders");
    expect(text).toContain(NOTICE_DOCUMENT);
    writeFileSync(join(dir, "sampling-plan.docx"), out.bytes);
  });

  it("CMO instructions", async () => {
    const out = await renderDocx({ doc: buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, opts), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("How the sample is taken:");
    expect(text).toMatch(/Flush 50 mL from the port to/);
    writeFileSync(join(dir, "cmo-instructions.docx"), out.bytes);
  });

  it("batch record", async () => {
    const out = await renderDocx({ doc: buildMbrDocument(project, project.mbr.records[0]!, opts), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toMatch(/Flush \d+ mL from the port to|Discard the first/);
    writeFileSync(join(dir, "mbr.docx"), out.bytes);
    writeFileSync(join(dir, "mbr.html"), renderHtml(buildMbrDocument(project, project.mbr.records[0]!, opts)));
  });
});
