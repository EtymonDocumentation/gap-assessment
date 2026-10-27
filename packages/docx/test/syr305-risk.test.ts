/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildRiskAssessmentDocument } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { BANNER, GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 120000 });

/**
 * The SYR-305 demo risk assessment (PDA TR 44 layout FMEA) in Word and HTML. Samples go to the temp folder
 * (gap-docx-samples/syr305k-risk) so a person can read them; a plain-text dump is written too.
 */
describe("SYR-305 PDA TR 44 FMEA in Word and HTML", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const a = project.risk.assessments[0]!;
  const dir = join(tmpdir(), "gap-docx-samples", "syr305k-risk");

  it("writes the register with the TR 44 columns, the threshold wording, interventions, confidence and review history", async () => {
    const doc = buildRiskAssessmentDocument(content, project, a, failureModes, { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" });
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(out.warnings).toEqual([]);
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain(BANNER);
    for (const s of ["Risk priority (S x O x D)", "Risk accepted?", "Detection (reversed: high = poor)", "above the action threshold (100)", "Intervention risk scoring", "Severity and sampling confidence", "Review triggers and history", "PDA TR 44 s4.1"]) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toMatch(/filing category/i);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "risk-assessment.docx"), out.bytes);
    writeFileSync(join(dir, "risk-assessment.html"), renderHtml(doc));
    writeFileSync(join(dir, "risk-assessment.txt"), text.replace(/[ \t]+/g, " "));
  });
});
