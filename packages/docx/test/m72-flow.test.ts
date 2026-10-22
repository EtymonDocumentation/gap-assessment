/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCmoInstructionsDocument, buildDemoProject, buildSamplingPlanDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/**
 * Milestone 7.2: the plan carries a "Process flow" section near the top (steps with their samples by position, then the samples that
 * are not on the diagram), the agency section comes last before the appendices, and the CMO instructions name step and position.
 * The files and a plain-text dump are written to the temp folder so a person can read them.
 */
describe("Word process flow (M7.2)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
  const plan = project.sampling.plans[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const dir = join(tmpdir(), "gap-docx-samples", "m72");

  it("renders the plan with a Process flow section and writes the Word file, the HTML file and a text dump", async () => {
    const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    const at = (h: string) => text.lastIndexOf(h);
    expect(at("Process flow")).toBeGreaterThan(-1);
    expect(at("Process flow")).toBeLessThan(at("Open items"));
    expect(at("Agency requests and commitments")).toBeGreaterThan(at("Open items"));
    expect(text).toContain("Not on the diagram");
    expect(text).not.toMatch(/filing category/i);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sampling-plan.docx"), out.bytes);
    writeFileSync(join(dir, "sampling-plan.html"), renderHtml(doc));
    writeFileSync(join(dir, "sampling-plan.txt"), text.replace(/[ \t]+/g, " "));
  });

  it("names step and position in the CMO instructions", async () => {
    const doc = buildCmoInstructionsDocument(content, project, plan, samplingSuggestions, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toMatch(/Sterile filtration, (before|after) the step/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cmo-instructions.docx"), out.bytes);
    writeFileSync(join(dir, "cmo-instructions.txt"), text.replace(/[ \t]+/g, " "));
  });
});
