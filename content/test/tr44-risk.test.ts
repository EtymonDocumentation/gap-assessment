// The optional PDA TR 44 FMEA load-out, the action threshold, review history and the intervention / confidence helps.
// Fictional data only. Nothing here may become a default: every answer below is typed by a test "team member".
import {
  addItem,
  addReview,
  buildDemoProject,
  buildRiskAssessmentDocument,
  createAssessment,
  linkedConfidence,
  projectScopeSteps,
  removeReview,
  riskOpenItems,
  setMethod,
  thresholdReading,
  evaluateItem,
  updateAssessment,
  updateItem,
} from "@gap/engine";
import { parseProject, type Actor, type RiskConfig } from "@gap/process-model";
import { aboveThreshold, interventionTally, isTr44, severityConfidenceText, TR44_DETECTION_TEXT, TR44_GUIDANCE, TR44_THRESHOLD_HINT } from "@gap/risk";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "QA", at: "2026-10-27T09:00:00.000Z" };
const opts = { generatedAt: "2026-10-27T10:00:00.000Z", appVersion: "0.0.0-test" };
// Building a demo project is slow under load (the full suite runs many files at once), so the demo is built once and the timeout is generous.
vi.setConfig({ testTimeout: 60000 });
const BASE = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
const tr44cfg = (): RiskConfig => structuredClone(riskLoadouts.loadouts.find((l) => l.id === "fmea-pda-tr44")!.config);

function fresh() {
  const base = BASE;
  let p = createAssessment(base, { title: "TR 44 test (fictional)", steps: projectScopeSteps(content, base) }, ACTOR).project;
  const id = p.risk.assessments.at(-1)!.id;
  p = setMethod(p, id, tr44cfg(), ACTOR);
  return { p, id };
}
const asmOf = (p: ReturnType<typeof fresh>["p"], id: string) => p.risk.assessments.find((a) => a.id === id)!;

describe("PDA TR 44 load-out (catalog)", () => {
  const cfg = tr44cfg();
  it("is an FMEA with the tr44 layout, three 1-10 scales and nothing preselected", () => {
    expect(isTr44(cfg)).toBe(true);
    if (cfg.method !== "fmea") throw new Error("not fmea");
    for (const s of [cfg.severity, cfg.occurrence, cfg.detection]) {
      expect(s.min).toBe(1);
      expect(s.max).toBe(10);
    }
    expect(cfg.bands).toEqual([]);
    expect(JSON.stringify(cfg.detection)).toMatch(/revers/i);
  });
  it("is not imposed: the other load-outs stay plain FMEA or other methods", () => {
    const others = riskLoadouts.loadouts.filter((l) => l.id !== "fmea-pda-tr44");
    expect(others.some((l) => isTr44(l.config))).toBe(false);
  });
});

describe("scoring, threshold and reversed detection", () => {
  it("multiplies S x O x D; detection counts as typed (a high number is poor detection)", () => {
    const { p, id } = fresh();
    let q = addItem(p, id, { failureMode: "Leak (fictional)" }, ACTOR).project;
    const itemId = asmOf(q, id).items[0]!.id;
    q = updateItem(q, id, itemId, { initial: { values: { severity: 10, occurrence: 2, detection: 9 } } }, ACTOR);
    const a = asmOf(q, id);
    const ev = evaluateItem(a, a.items[0]!);
    expect(ev.initial.scored && ev.initial.score).toBe(180);
  });
  it("aboveThreshold is strict and stays unknown without a threshold or a score", () => {
    expect(aboveThreshold(101, 100)).toBe(true);
    expect(aboveThreshold(100, 100)).toBe(false);
    expect(aboveThreshold(undefined, 100)).toBeUndefined();
    expect(aboveThreshold(50, undefined)).toBeUndefined();
  });
  it("the threshold is blank until the team types it; then rows are compared", () => {
    const { p, id } = fresh();
    expect(asmOf(p, id).actionThreshold).toBeUndefined();
    let q = addItem(p, id, { failureMode: "A (fictional)" }, ACTOR).project;
    const itemId = asmOf(q, id).items[0]!.id;
    q = updateItem(q, id, itemId, { initial: { values: { severity: 10, occurrence: 4, detection: 5 } } }, ACTOR);
    let a = asmOf(q, id);
    expect(thresholdReading(a, evaluateItem(a, a.items[0]!)).above).toBeUndefined();
    q = updateAssessment(q, id, { actionThreshold: 100 }, ACTOR);
    a = asmOf(q, id);
    expect(thresholdReading(a, evaluateItem(a, a.items[0]!))).toMatchObject({ priority: 200, above: true });
  });
  it("rejects a threshold that is not above zero", () => {
    const { p, id } = fresh();
    expect(() => updateAssessment(p, id, { actionThreshold: 0 }, ACTOR)).toThrow();
  });
});

describe("open items of the TR 44 layout", () => {
  it("lists the missing threshold, each unanswered 'risk accepted?' and an above-threshold row without an action", () => {
    const { p, id } = fresh();
    let q = addItem(p, id, { failureMode: "A (fictional)" }, ACTOR).project;
    const itemId = asmOf(q, id).items[0]!.id;
    q = updateItem(q, id, itemId, { initial: { values: { severity: 10, occurrence: 4, detection: 5 } } }, ACTOR);
    let kinds = riskOpenItems(q, asmOf(q, id)).map((o) => o.kind);
    expect(kinds).toContain("threshold-missing");
    expect(kinds).toContain("accepted-missing");
    q = updateAssessment(q, id, { actionThreshold: 100 }, ACTOR);
    kinds = riskOpenItems(q, asmOf(q, id)).map((o) => o.kind);
    expect(kinds).not.toContain("threshold-missing");
    expect(kinds).toContain("action-missing");
    q = updateItem(q, id, itemId, { accepted: "no" }, ACTOR);
    expect(riskOpenItems(q, asmOf(q, id)).map((o) => o.kind)).not.toContain("accepted-missing");
  });
  it("does not add the TR 44 open items to other methods", () => {
    const base = BASE;
    let p = createAssessment(base, { title: "Plain FMEA (fictional)" }, ACTOR).project;
    const id = p.risk.assessments.at(-1)!.id;
    p = setMethod(p, id, structuredClone(riskLoadouts.loadouts.find((l) => l.id === "fmea-1-10")!.config), ACTOR);
    p = addItem(p, id, { failureMode: "A (fictional)" }, ACTOR).project;
    const kinds = riskOpenItems(p, asmOf(p, id)).map((o) => o.kind);
    expect(kinds).not.toContain("threshold-missing");
    expect(kinds).not.toContain("accepted-missing");
  });
});

describe("review triggers and history", () => {
  it("keeps triggers and next review as typed and numbers the reviews", () => {
    const { p, id } = fresh();
    let q = updateAssessment(p, id, { reviewTriggers: ["investigation", "periodic"], nextReview: "2027-05-01" }, ACTOR);
    const r1 = addReview(q, id, { date: "2026-10-27", note: "First look (fictional)", trigger: "new_risk" }, ACTOR);
    q = addReview(r1.project, id, { date: "2026-11-02", note: "Second look (fictional)" }, ACTOR).project;
    const a = asmOf(q, id);
    expect(a.reviewTriggers).toEqual(["investigation", "periodic"]);
    expect(a.nextReview).toBe("2027-05-01");
    expect(a.reviews!.map((r) => r.id)).toEqual(["RV-001", "RV-002"]);
    q = removeReview(q, id, "RV-001", ACTOR);
    expect(asmOf(q, id).reviews!.map((r) => r.id)).toEqual(["RV-002"]);
  });
  it("needs a date and a note", () => {
    const { p, id } = fresh();
    expect(() => addReview(p, id, { date: "", note: "x" }, ACTOR)).toThrow();
    expect(() => addReview(p, id, { date: "2026-10-27", note: "" }, ACTOR)).toThrow();
  });
});

describe("helps from PDA TR 60 and TR 22 (hints only)", () => {
  it("states the reversed detection scale and the guidance without choosing a score", () => {
    expect(TR44_DETECTION_TEXT).toMatch(/REVERSED/);
    expect(TR44_GUIDANCE.join(" ")).toMatch(/loss of sterility/i);
    expect(TR44_GUIDANCE.join(" ")).toMatch(/once an hour/);
    expect(TR44_THRESHOLD_HINT).toContain("100");
  });
  it("shows the severity to confidence link as text (99 / 95 / 90)", () => {
    const t = severityConfidenceText();
    expect(t).toMatch(/high severity 99 %/);
    expect(t).toMatch(/medium severity 95 %/);
    expect(t).toMatch(/low severity 90 %/);
  });
  it("counts intervention answers but never derives the overall level", () => {
    const t = interventionTally({ complexity: "high", duration: "low", proximity: "high" });
    expect(t).toMatchObject({ high: 2, low: 1, medium: 0 });
    expect(t.missing).toEqual(["Frequency", "Disruption of the airflow"]);
    expect(interventionTally({ complexity: "high" })).not.toHaveProperty("level");
  });
});

describe("old files migrate with only a version change", () => {
  it("is a version-only step", () => {
    const base = BASE;
    const old = structuredClone(base) as unknown as Record<string, unknown>;
    old.schemaVersion = "1.23.0";
    const p = parseProject(old);
    expect(p.schemaVersion).toBe("1.24.0");
    expect(p.risk.assessments).toEqual(base.risk.assessments);
  });
});

describe("SYR-305 demo FMEA", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const a = project.risk.assessments[0]!;
  it("has a TR 44 FMEA of ten rows with the team's own threshold", () => {
    expect(isTr44(a.config)).toBe(true);
    expect(a.items).toHaveLength(10);
    expect(a.actionThreshold).toBe(100);
  });
  it("has rows above the threshold with actions and after-scores, and exactly one 'risk accepted?' left blank", () => {
    const readings = a.items.map((i) => ({ id: i.id, r: thresholdReading(a, evaluateItem(a, i)), i }));
    const above = readings.filter((x) => x.r.above);
    expect(above.length).toBeGreaterThanOrEqual(3);
    for (const x of above) {
      expect(x.i.residual).toBeDefined();
      expect(a.actions.some((act) => act.itemId === x.id)).toBe(true);
    }
    expect(a.items.filter((i) => !i.accepted)).toHaveLength(1);
    expect(a.items.some((i) => i.accepted === "no")).toBe(true);
  });
  it("reports the blank answer as an open item, and has intervention scoring that the team chose", () => {
    const open = riskOpenItems(project, a);
    expect(open.filter((o) => o.kind === "accepted-missing")).toHaveLength(1);
    expect(open.some((o) => o.kind === "threshold-missing")).toBe(false);
    const iv = a.items.filter((i) => i.intervention);
    expect(iv.length).toBeGreaterThanOrEqual(2);
    expect(iv.every((i) => i.intervention!.level)).toBe(true);
  });
  it("links to sampling points whose confidence can be read", () => {
    const linked = a.items.flatMap((i) => linkedConfidence(project, i));
    expect(linked.length).toBeGreaterThan(3);
  });
  it("the Word document has the 13 columns, the threshold text, interventions, confidence and review sections", () => {
    const doc = buildRiskAssessmentDocument(content, project, a, failureModes, opts);
    const ids = doc.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["register", "interventions", "confidence", "review"]));
    const reg = doc.sections.find((s) => s.id === "register")!.blocks.find((b) => b.type === "table") as { columns: string[]; rows: string[][] };
    expect(reg.columns).toHaveLength(13);
    expect(reg.columns).toContain("Detection (reversed: high = poor)");
    expect(reg.rows.some((r) => r[8]!.includes("above the action threshold (100)"))).toBe(true);
    expect(reg.rows.filter((r) => r[9] === "Not answered")).toHaveLength(1);
    const text = JSON.stringify(doc);
    expect(text).toContain("PDA TR 44 s4.1");
    expect(text).not.toMatch(/filing category/i);
  });
  it("carries no client names, client codes or supplier brands", () => {
    const text = JSON.stringify(a) + JSON.stringify(buildRiskAssessmentDocument(content, project, a, failureModes, opts));
    expect(text).not.toMatch(/\b(CTP|QC)\d{3,}|VV-IOPS|C2P2/);
  });
});
