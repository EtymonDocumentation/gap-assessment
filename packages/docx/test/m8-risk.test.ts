/// <reference types="node" />
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemoProject, buildRiskAssessmentDocument, setMethod, updateItem } from "@gap/engine";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../../../content/index";
import { renderDocx } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { plainText, strictDocx } from "./strict";

vi.setConfig({ testTimeout: 60000 });

/** Milestone 8: the risk assessment goes through the same Word and HTML renderers. Samples and a text dump are written to the temp folder. */
describe("Word and HTML risk assessment (M8)", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const a = project.risk.assessments[0]!;
  const opts = { generatedAt: GENERATED_AT, appVersion: "0.0.0-test" };
  const dir = join(tmpdir(), "gap-docx-samples", "m8");
  const who = { name: "Alex Example (fictional)", at: "2026-10-07T09:00:00.000Z" };

  it("renders the demo assessment, with banner, method, register and open items, and writes samples", async () => {
    const doc = buildRiskAssessmentDocument(content, project, a, failureModes, opts);
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    const text = plainText(strictDocx(out.bytes));
    expect(text).toContain("Proof of concept. Not validated. Not for GMP use.");
    for (const h of ["Purpose and scope", "Risk method", "Risk register", "Action list", "Open items", "Traceability"]) expect(text).toContain(h);
    expect(text).toContain("No bands defined by the user");
    expect(text).not.toMatch(/filing category/i);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "risk-assessment.docx"), out.bytes);
    writeFileSync(join(dir, "risk-assessment.html"), renderHtml(doc));
    writeFileSync(join(dir, "risk-assessment.txt"), text);
  });

  it("renders a matrix assessment with the heat table", async () => {
    const m = riskLoadouts.loadouts.find((l) => l.id === "matrix-3x3")!;
    let p = setMethod(project, a.id, structuredClone(m.config), who, { clearScores: true });
    const first = p.risk.assessments[0]!.items[0]!;
    p = updateItem(p, a.id, first.id, { initial: { values: { likelihood: 2, severity: 3 } } }, who);
    const doc = buildRiskAssessmentDocument(content, p, p.risk.assessments[0]!, failureModes, opts);
    expect(doc.sections.map((s) => s.id)).toContain("heat");
    const out = await renderDocx({ doc, mode: "builtin", generatedAt: GENERATED_AT });
    expect(plainText(strictDocx(out.bytes))).toContain("Items per matrix cell");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "risk-matrix.docx"), out.bytes);
  });
});
