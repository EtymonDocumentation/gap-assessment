// Milestone 8: the risk assessment document. Fictional data only.
import { addItem, buildDemoProject, buildRiskAssessmentDocument, createAssessment, projectScopeSteps, RISK_OPTIONAL_SECTIONS, setMethod, updateItem } from "@gap/engine";
import type { Actor, RiskConfig } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "QA", at: "2026-10-22T09:00:00.000Z" };
const opts = { generatedAt: "2026-10-22T10:00:00.000Z", appVersion: "0.0.0-test" };
const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
const asm = demo.risk.assessments[0]!;
type Doc = ReturnType<typeof buildRiskAssessmentDocument>;
const section = (doc: Doc, id: string) => doc.sections.find((s) => s.id === id);
const table = (doc: Doc, id: string) => section(doc, id)!.blocks.find((b) => b.type === "table") as { columns: string[]; rows: string[][] };
const cfg = (id: string): RiskConfig => structuredClone(riskLoadouts.loadouts.find((l) => l.id === id)!.config);

describe("risk assessment document", () => {
  const doc = buildRiskAssessmentDocument(content, demo, asm, failureModes, opts);

  it("carries the banner, the draft status and the sections of the contract in order", () => {
    expect(doc.banner).toBe("Proof of concept. Not validated. Not for GMP use.");
    expect(doc.status).toBe("DRAFT");
    expect(doc.sections.map((s) => s.id)).toEqual(["purpose-scope", "method", "register", "actions", "open-items", "traceability", "versions"]);
  });

  it("counts the open items it lists (the unscored item)", () => {
    expect(doc.tbdCount).toBe(1);
    expect(table(doc, "open-items").rows[0]![1]).toContain("not scored");
  });

  it("says plainly that no bands were defined and judges nothing", () => {
    const text = JSON.stringify(doc);
    expect(text).toContain("No bands defined by the user");
    expect(text).toContain("No band defined");
    expect(text).not.toMatch(/filing category/i);
  });

  it("shows residual columns only when some item has a residual score, and leaves them out on request", () => {
    expect(table(doc, "register").columns).toContain("Residual score");
    const without = buildRiskAssessmentDocument(content, demo, asm, failureModes, { ...opts, omit: ["residual"] });
    expect(table(without, "register").columns).not.toContain("Residual score");
    let p = createAssessment(demo, { title: "x", steps: projectScopeSteps(content, demo) }, ACTOR).project;
    const id = p.risk.assessments.at(-1)!.id;
    p = setMethod(p, id, cfg("fmea-1-10"), ACTOR);
    p = addItem(p, id, { failureMode: "Leak" }, ACTOR).project;
    const bare = buildRiskAssessmentDocument(content, p, p.risk.assessments.at(-1)!, failureModes, opts);
    expect(table(bare, "register").columns).not.toContain("Residual score");
  });

  it("writes the answers and the RPN per item", () => {
    const row = table(doc, "register").rows.find((r) => r[0] === "RA-001")!;
    expect(row[6]).toBe("S 9, O 2, D 3");
    expect(row[7]).toBe("54");
  });

  it("leaves out optional sections only when asked, never the method or the open items", () => {
    const lean = buildRiskAssessmentDocument(content, demo, asm, failureModes, { ...opts, omit: RISK_OPTIONAL_SECTIONS.map((s) => s.id) });
    expect(lean.sections.map((s) => s.id)).toEqual(["purpose-scope", "method", "register", "open-items", "versions"]);
  });

  it("shows the gap severity in the traceability appendix as reference only", () => {
    const t = table(doc, "traceability");
    expect(t.columns).toContain("Gap severity (reference only)");
    const gapRow = t.rows.find((r) => r[1] === "From the gap assessment")!;
    expect(gapRow[3]).toMatch(/^G-\d{3}: (high|medium|low|none)/i);
  });

  it("a document with no method says so and counts it as open", () => {
    let p = createAssessment(demo, { title: "No method (fictional)" }, ACTOR).project;
    const id = p.risk.assessments.at(-1)!.id;
    p = addItem(p, id, { failureMode: "Leak" }, ACTOR).project;
    const d = buildRiskAssessmentDocument(content, p, p.risk.assessments.at(-1)!, failureModes, opts);
    expect(JSON.stringify(section(d, "method"))).toContain("No risk method has been chosen yet");
    expect(d.tbdCount).toBeGreaterThanOrEqual(2);
  });

  it("qualitative method: the register shows the level and the reason, and flags a missing reason", () => {
    let p = createAssessment(demo, { title: "Qualitative (fictional)" }, ACTOR).project;
    const id = p.risk.assessments.at(-1)!.id;
    p = setMethod(p, id, cfg("qualitative-hml"), ACTOR);
    const lvl = (cfg("qualitative-hml") as { levels: { label: string }[] }).levels[0]!.label;
    p = addItem(p, id, { failureMode: "Leak" }, ACTOR).project;
    p = updateItem(p, id, "RA-001", { initial: { values: {}, level: lvl } }, ACTOR);
    const d = buildRiskAssessmentDocument(content, p, p.risk.assessments.at(-1)!, failureModes, opts);
    const t = table(d, "register");
    expect(t.columns).toContain("Reason");
    expect(t.rows[0]![6]).toBe(lvl);
    expect(t.rows[0]![7]).toBe("Missing");
    expect(d.tbdCount).toBe(1);
  });
});
