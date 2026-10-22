/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCmoInstructionsDocument, buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * Milestone 7.1: the plan (a section per study type with a reporting-instructions block after each point) and the CMO
 * reporting instructions go through the same Word renderer. The files are also written to the temp folder so a person can open
 * and read them (Word, then PDF and text through LibreOffice).
 */
describe("Word sampling plan and CMO instructions (M7.1)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
  const plan = project.sampling.plans[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };

  it("renders the plan with study-type sections and reporting-instructions blocks, and writes a sample", async () => {
    const out = await renderDocx({ doc: buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(text).toContain("Reporting instructions RI-SP-001");
    expect(text).not.toMatch(/filing category/i);
    const dir = join(tmpdir(), "gap-docx-samples", "m71");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sampling-plan.docx"), out.bytes);
  });

  it("renders the CMO instructions and writes a sample", async () => {
    const out = await renderDocx({ doc: buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, opts), mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    for (const h of ["About these instructions", "Reporting instructions per sampling point"]) expect(text).toContain(h);
    expect(text).toContain("Proof of concept. Not validated. Not for GMP use.");
    const dir = join(tmpdir(), "gap-docx-samples", "m71");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cmo-instructions.docx"), out.bytes);
  });
});
