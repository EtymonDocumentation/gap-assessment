// Milestone 8: risk assessment. The catalogs (options only), the editing functions and their change log, scoring through the
// assessment, open items, seeding from gaps and from the failure-mode catalog, and traceability. All data are fictional.
import {
  addAction,
  addItem,
  addItemFromGap,
  addItemFromSuggestion,
  addRiskStep,
  assess,
  buildDemoProject,
  changeLogView,
  copyRiskStepsFromScope,
  createAssessment,
  deleteAssessment,
  evaluateItem,
  gapSeeds,
  hasResidual,
  moveRiskStep,
  openActions,
  parseFailureModes,
  parseRiskLoadouts,
  pointRef,
  projectScopeSteps,
  removeAction,
  removeItem,
  removeRiskStep,
  riskOpenItems,
  RiskError,
  risksForGap,
  risksForSamplingPoint,
  samplingPointExists,
  setMethod,
  suggestFailureModes,
  updateAction,
  updateAssessment,
  updateItem,
  updateRiskStep,
} from "@gap/engine";
import { parseProject, type Actor, type Project, type RiskConfig } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, guidance, riskLoadouts, samplingSuggestions } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "QA", at: "2026-10-22T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-23T10:00:00.000Z" };

const loadout = (id: string): RiskConfig => structuredClone(riskLoadouts.loadouts.find((l) => l.id === id)!.config);
const base = (): { project: Project; id: string } => {
  const r = createAssessment(buildDemoProject(content, demos["arx-217"]), { title: "Fill-finish risk (fictional)", steps: projectScopeSteps(content, buildDemoProject(content, demos["arx-217"])) }, ACTOR);
  return { project: r.project, id: r.assessmentId };
};
const asm = (p: Project, id: string) => p.risk.assessments.find((a) => a.id === id)!;

describe("the method load-outs are starting shapes, not answers", () => {
  it("has the five load-outs of the contract", () => {
    expect(riskLoadouts.loadouts.map((l) => l.title)).toEqual(["FMEA 1-10 (S, O, D)", "FMEA 1-5", "Matrix 3x3", "Matrix 5x5", "Qualitative H/M/L"]);
    expect(riskLoadouts.catalog.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("FMEA load-outs give scale ranges only: no level wording, no bands, no rule", () => {
    for (const id of ["fmea-1-10", "fmea-1-5"]) {
      const c = loadout(id);
      if (c.method !== "fmea") throw new Error("not fmea");
      expect(c.bands).toEqual([]);
      expect(c.severityTrigger).toBeUndefined();
      for (const s of [c.severity, c.occurrence, c.detection]) expect(s.levels).toEqual([]);
    }
    const c = loadout("fmea-1-5");
    expect(c.method === "fmea" && c.severity).toMatchObject({ min: 1, max: 5 });
  });

  it("matrix load-outs are complete grids of the right size", () => {
    const m3 = loadout("matrix-3x3");
    const m5 = loadout("matrix-5x5");
    if (m3.method !== "matrix" || m5.method !== "matrix") throw new Error("not matrix");
    expect(m3.cells).toHaveLength(9);
    expect(m5.cells).toHaveLength(25);
    expect(m5.likelihood).toHaveLength(5);
  });

  it("each load-out names itself in its config", () => {
    for (const l of riskLoadouts.loadouts) expect(l.config.loadoutId).toBe(l.id);
  });

  it("refuses an unknown key, a repeated id and a half-built method", () => {
    const good = structuredClone(riskLoadouts) as unknown as { loadouts: Record<string, unknown>[] };
    expect(parseRiskLoadouts(good).loadouts).toHaveLength(5);
    expect(() => parseRiskLoadouts({ ...good, loadouts: [{ ...good.loadouts[0], bonus: 1 }] })).toThrow(/invalid/);
    expect(() => parseRiskLoadouts({ ...good, loadouts: [good.loadouts[0], good.loadouts[0]] })).toThrow(/duplicate id/);
    const bad = structuredClone(good.loadouts[0]!) as { config: { bands: unknown[] } };
    bad.config.bands = [{ label: "A", minRpn: 1, maxRpn: 5 }];
    expect(() => parseRiskLoadouts({ ...good, loadouts: [bad] })).toThrow(/No band covers/);
  });
});

describe("the failure-mode catalog is options only", () => {
  it("is versioned, covers the filling steps and every entry has a rationale", () => {
    expect(failureModes.catalog).toEqual({ id: "risk-failure-modes", version: "1.0.0" });
    const ops = new Set(failureModes.suggestions.map((s) => s.unitOp));
    for (const uo of ["sterile_filtration", "aseptic_filling", "stoppering", "lyophilization", "capping", "visual_inspection"]) expect(ops.has(uo)).toBe(true);
    for (const s of failureModes.suggestions) expect(s.rationale.length).toBeGreaterThan(20);
  });

  it("carries no score: the schema is strict", () => {
    const one = { ...failureModes.suggestions[0]!, severity: 9 };
    expect(() => parseFailureModes({ ...failureModes, suggestions: [one] })).toThrow(/invalid/);
  });

  it("refuses an unknown unit operation, a repeated key and an unknown guidance entry", () => {
    const s = failureModes.suggestions[0]!;
    expect(() => parseFailureModes({ ...failureModes, suggestions: [{ ...s, unitOp: "nope" }] }, content.catalog.unitOperations.map((u) => u.key))).toThrow(/unknown unit operation/);
    expect(() => parseFailureModes({ ...failureModes, suggestions: [s, s] })).toThrow(/duplicate key/);
    expect(() => parseFailureModes({ ...failureModes, suggestions: [{ ...s, guidanceRef: "nope" }] }, [], guidance.items.map((g) => g.id))).toThrow(/unknown guidance/);
  });
});

describe("assessments", () => {
  it("starts with the project scope as its own steps and no method", () => {
    const { project, id } = base();
    const a = asm(project, id);
    expect(a.id).toBe("RAS-001");
    expect(a.method).toBeUndefined();
    expect(a.steps.length).toBeGreaterThan(3);
    expect(a.steps[0]!.id).toBe("ST-01");
    expect(project.changeLog.at(-1)).toMatchObject({ action: "risk_assessment_add", path: "risk.RAS-001" });
  });

  it("needs a title and edits keep the old value in the log", () => {
    const { project, id } = base();
    expect(() => createAssessment(project, { title: "  " }, ACTOR)).toThrow(RiskError);
    expect(() => updateAssessment(project, id, { title: "" }, LATER)).toThrow(/title/);
    const next = updateAssessment(project, id, { title: "New title", scopeNote: "Scope text", context: "Context text" }, LATER);
    const ev = next.changeLog.at(-1)!;
    expect(ev.action).toBe("risk_assessment_update");
    expect((ev.before as Record<string, unknown>).title).toBe("Fill-finish risk (fictional)");
    expect(asm(next, id)).toMatchObject({ title: "New title", scopeNote: "Scope text", context: "Context text" });
    expect(updateAssessment(next, id, { title: "New title" }, LATER)).toBe(next);
  });

  it("keeps optional approvals and drops blank rows", () => {
    const { project, id } = base();
    const next = updateAssessment(project, id, { approvals: [{ role: "QA", name: "Alex" }, { role: "  " }] }, LATER);
    expect(asm(next, id).approvals).toEqual([{ role: "QA", name: "Alex" }]);
    expect(asm(updateAssessment(next, id, { approvals: [] }, LATER), id).approvals).toBeUndefined();
  });

  it("removing an assessment keeps it whole in the log", () => {
    const { project, id } = base();
    const next = deleteAssessment(project, id, LATER);
    expect(next.risk.assessments).toHaveLength(0);
    expect(next.changeLog.at(-1)!.before).toMatchObject({ id });
    // The id is never reused.
    expect(createAssessment(next, { title: "Again" }, LATER).assessmentId).toBe("RAS-002");
  });
});

describe("method", () => {
  it("sets a load-out, keeps its name and logs the change", () => {
    const { project, id } = base();
    const next = setMethod(project, id, loadout("fmea-1-10"), ACTOR);
    expect(asm(next, id).method).toBe("fmea");
    expect(asm(next, id).config?.loadoutId).toBe("fmea-1-10");
    expect(next.changeLog.at(-1)).toMatchObject({ action: "risk_method_set" });
    expect(setMethod(next, id, loadout("fmea-1-10"), ACTOR)).toBe(next);
  });

  it("refuses a config that is not valid", () => {
    const { project, id } = base();
    expect(() => setMethod(project, id, { method: "fmea" } as never, ACTOR)).toThrow(RiskError);
  });

  it("refuses to switch method under scored items unless the scores are cleared, and logs them", () => {
    let { project } = base();
    const id = "RAS-001";
    project = setMethod(project, id, loadout("fmea-1-10"), ACTOR);
    const added = addItem(project, id, { failureMode: "Leak" }, ACTOR);
    project = updateItem(added.project, id, added.itemId, { initial: { values: { severity: 5, occurrence: 2, detection: 3 } } }, ACTOR);
    expect(() => setMethod(project, id, loadout("qualitative-hml"), LATER)).toThrow(/Choose to clear the scores/);
    const next = setMethod(project, id, loadout("qualitative-hml"), LATER, { clearScores: true });
    expect(asm(next, id).items[0]!.initial).toEqual({ values: {} });
    expect(next.changeLog.at(-1)!.before).toMatchObject({ scores: [{ id: added.itemId, initial: { values: { severity: 5 } } }] });
  });

  it("editing the same method keeps the scores; an answer that no longer fits becomes not scored", () => {
    let { project } = base();
    const id = "RAS-001";
    project = setMethod(project, id, loadout("fmea-1-10"), ACTOR);
    const added = addItem(project, id, { failureMode: "Leak" }, ACTOR);
    project = updateItem(added.project, id, added.itemId, { initial: { values: { severity: 9, occurrence: 2, detection: 3 } } }, ACTOR);
    const c = loadout("fmea-1-10");
    if (c.method !== "fmea") throw new Error();
    c.severity = { min: 1, max: 5, levels: [] };
    project = setMethod(project, id, c, LATER);
    const item = asm(project, id).items[0]!;
    expect(item.initial.values.severity).toBe(9);
    const ev = evaluateItem(asm(project, id), item);
    expect(ev.initial.scored).toBe(false);
    expect(ev.initial.problems).toEqual(["Severity 9 is outside the scale 1 to 5"]);
  });

  it("can remove the method again", () => {
    const { project, id } = base();
    const withM = setMethod(project, id, loadout("qualitative-hml"), ACTOR);
    const without = setMethod(withM, id, null, ACTOR);
    expect(asm(without, id).method).toBeUndefined();
    expect(asm(without, id).config).toBeUndefined();
  });
});

describe("steps", () => {
  it("adds, renames, moves and removes steps; removing leaves the items unplaced", () => {
    let { project } = base();
    const id = "RAS-001";
    const custom = addRiskStep(project, id, { label: "Intermediate hold (fictional)" }, ACTOR);
    project = custom.project;
    expect(asm(project, id).steps.at(-1)!.label).toBe("Intermediate hold (fictional)");
    project = updateRiskStep(project, id, custom.stepId, { label: "Hold (fictional)", notes: "n" }, LATER);
    expect(asm(project, id).steps.at(-1)).toMatchObject({ label: "Hold (fictional)", notes: "n" });
    const catalogStep = asm(project, id).steps[0]!;
    expect(() => updateRiskStep(project, id, catalogStep.id, { label: "x" }, LATER)).toThrow(/catalog name/);
    const moved = moveRiskStep(project, id, custom.stepId, "up", LATER);
    expect(asm(moved, id).steps.at(-2)!.id).toBe(custom.stepId);
    expect(moveRiskStep(project, id, asm(project, id).steps[0]!.id, "up", LATER)).toBe(project);
    const item = addItem(project, id, { stepId: custom.stepId, failureMode: "x" }, ACTOR);
    const removed = removeRiskStep(item.project, id, custom.stepId, LATER);
    expect(asm(removed, id).items[0]!.stepId).toBeUndefined();
    expect(removed.changeLog.at(-1)!.detail).toContain("no longer placed on a step");
    // A removed step id is never reused.
    expect(addRiskStep(removed, id, { label: "Again" }, LATER).stepId).not.toBe(custom.stepId);
  });

  it("refuses a catalog step twice and inserts a ticked catalog step in process order", async () => {
    const { project, id } = base();
    const a = asm(project, id);
    const first = a.steps[0]!;
    expect(() => addRiskStep(project, id, { unitOp: first.unitOp!, label: first.label }, ACTOR)).toThrow(/already a step/);
    const without = removeRiskStep(project, id, first.id, ACTOR);
    const { catalogInsertIndex } = await import("@gap/engine");
    const idx = catalogInsertIndex(content, asm(without, id).steps, first.unitOp!);
    expect(idx).toBe(0);
  });

  it("copies the project scope again on request (append and replace)", () => {
    let { project } = base();
    const id = "RAS-001";
    const scope = projectScopeSteps(content, project);
    const custom = addRiskStep(project, id, { label: "Custom (fictional)" }, ACTOR);
    project = custom.project;
    const held = addItem(project, id, { stepId: custom.stepId, failureMode: "x" }, ACTOR);
    project = copyRiskStepsFromScope(held.project, id, scope, "replace", LATER);
    expect(asm(project, id).steps.map((s) => s.unitOp)).toEqual(scope.map((s) => s.unitOp));
    expect(asm(project, id).items[0]!.stepId).toBeUndefined();
    expect(copyRiskStepsFromScope(project, id, scope, "append", LATER)).toBe(project);
  });
});

describe("items", () => {
  const withMethod = () => {
    const b = base();
    return { ...b, project: setMethod(b.project, b.id, loadout("fmea-1-10"), ACTOR) };
  };

  it("adds a draft item with stable ids and no score", () => {
    const { project, id } = withMethod();
    const a = addItem(project, id, { failureMode: "Seal leak (fictional)", stepId: asm(project, id).steps[0]!.id }, ACTOR);
    expect(a.itemId).toBe("RA-001");
    expect(asm(a.project, id).items[0]).toMatchObject({ id: "RA-001", initial: { values: {} }, gapIds: [], samplingPointIds: [], origin: { kind: "free" } });
    const gone = removeItem(a.project, id, "RA-001", LATER);
    expect(addItem(gone, id, { failureMode: "Next" }, LATER).itemId).toBe("RA-002");
    expect(gone.changeLog.at(-1)!.before).toMatchObject({ item: { id: "RA-001" } });
  });

  it("scores, edits, clears a residual, and logs the old value", () => {
    const { project, id } = withMethod();
    const a = addItem(project, id, { failureMode: "Seal leak" }, ACTOR);
    let p = updateItem(a.project, id, a.itemId, { effect: "Sterility lost", initial: { values: { severity: 9, occurrence: 3, detection: 4 } } }, LATER);
    let item = asm(p, id).items[0]!;
    expect(evaluateItem(asm(p, id), item).initial).toMatchObject({ scored: true, score: 108 });
    expect(evaluateItem(asm(p, id), item).residual).toBeUndefined();
    p = updateItem(p, id, a.itemId, { residual: { values: { severity: 9, occurrence: 1, detection: 2 } } }, LATER);
    item = asm(p, id).items[0]!;
    expect(evaluateItem(asm(p, id), item).residual).toMatchObject({ scored: true, score: 18 });
    expect((p.changeLog.at(-1)!.before as Record<string, unknown>).residual).toBeUndefined();
    p = updateItem(p, id, a.itemId, { residual: undefined }, LATER);
    expect(asm(p, id).items[0]!.residual).toBeUndefined();
    expect(updateItem(p, id, a.itemId, { effect: "Sterility lost" }, LATER)).toBe(p);
  });

  it("an empty residual score means no residual at all", () => {
    const { project, id } = withMethod();
    const a = addItem(project, id, { failureMode: "x" }, ACTOR);
    const p = updateItem(a.project, id, a.itemId, { residual: { values: {} } }, LATER);
    expect(asm(p, id).items[0]!.residual).toBeUndefined();
  });

  it("refuses an item on a step that is not in the assessment", () => {
    const { project, id } = withMethod();
    expect(() => addItem(project, id, { stepId: "ST-99", failureMode: "x" }, ACTOR)).toThrow(/not in assessment/);
  });

  it("round-trips through the project schema", () => {
    const { project, id } = withMethod();
    const a = addItem(project, id, { failureMode: "x" }, ACTOR);
    expect(parseProject(JSON.parse(JSON.stringify(a.project))).risk.assessments[0]!.items).toHaveLength(1);
  });
});

describe("actions", () => {
  it("adds, updates and removes actions; an item's actions go with it", () => {
    const b = base();
    const i = addItem(b.project, b.id, { failureMode: "x" }, ACTOR);
    const a = addAction(i.project, b.id, { itemId: i.itemId, text: "Add a second check" }, ACTOR);
    expect(a.actionId).toBe("AC-001");
    expect(asm(a.project, b.id).actions[0]).toEqual({ id: "AC-001", itemId: "RA-001", text: "Add a second check", status: "open" });
    expect(openActions(asm(a.project, b.id))).toHaveLength(1);
    const u = updateAction(a.project, b.id, a.actionId, { owner: "Alex", due: "2026-12-01", status: "done" }, LATER);
    expect(asm(u, b.id).actions[0]).toMatchObject({ owner: "Alex", due: "2026-12-01", status: "done" });
    expect(openActions(asm(u, b.id))).toHaveLength(0);
    expect(updateAction(u, b.id, a.actionId, { status: "done" }, LATER)).toBe(u);
    expect(() => addAction(u, b.id, { itemId: "RA-009", text: "x" }, ACTOR)).toThrow(/not in/);
    expect(() => addAction(u, b.id, { itemId: i.itemId, text: " " }, ACTOR)).toThrow(/description/);
    expect(asm(removeAction(u, b.id, a.actionId, LATER), b.id).actions).toHaveLength(0);
    const gone = removeItem(u, b.id, i.itemId, LATER);
    expect(asm(gone, b.id).actions).toHaveLength(0);
    expect(gone.changeLog.at(-1)!.before).toMatchObject({ actions: [{ id: "AC-001" }] });
  });
});

describe("open items: what is missing, said plainly", () => {
  it("lists a missing method, then unscored items, then problems", () => {
    const b = base();
    const i = addItem(b.project, b.id, { failureMode: "Leak" }, ACTOR);
    expect(riskOpenItems(i.project, asm(i.project, b.id)).map((o) => o.kind)).toEqual(["method", "not-scored"]);
    const m = setMethod(i.project, b.id, loadout("fmea-1-10"), ACTOR);
    const open = riskOpenItems(m, asm(m, b.id));
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "not-scored", itemId: "RA-001" });
    expect(open[0]!.text).toContain("Severity has no value");
  });

  it("flags a failure mode that is not described, a missing qualitative reason, and band problems", () => {
    const b = base();
    let p = setMethod(b.project, b.id, loadout("qualitative-hml"), ACTOR);
    const i = addItem(p, b.id, {}, ACTOR);
    p = updateItem(i.project, b.id, i.itemId, { initial: { values: {}, level: "High" } }, ACTOR);
    const kinds = riskOpenItems(p, asm(p, b.id)).map((o) => o.text);
    expect(kinds).toContain("RA-001: the failure mode is not described yet");
    expect(kinds).toContain("RA-001: The written reason is missing");
    const f = setMethod(p, b.id, { ...loadout("fmea-1-5"), bands: [{ label: "Low", minRpn: 1, maxRpn: 10 }] } as RiskConfig, ACTOR, { clearScores: true });
    expect(riskOpenItems(f, asm(f, b.id)).some((o) => o.kind === "method-problem" && o.text.includes("No band covers 11 to 125"))).toBe(true);
  });

  it("has no open item for a fully scored item with the user's own bands", () => {
    const b = base();
    const cfg = { ...loadout("fmea-1-5"), bands: [{ label: "All", minRpn: 1, maxRpn: 125 }] } as RiskConfig;
    let p = setMethod(b.project, b.id, cfg, ACTOR);
    const i = addItem(p, b.id, { failureMode: "x" }, ACTOR);
    p = updateItem(i.project, b.id, i.itemId, { initial: { values: { severity: 1, occurrence: 1, detection: 1 } } }, ACTOR);
    expect(riskOpenItems(p, asm(p, b.id))).toEqual([]);
    expect(evaluateItem(asm(p, b.id), asm(p, b.id).items[0]!).initial.label).toBe("All");
  });

  it("reports a cited sampling point or source that no longer exists", () => {
    const b = base();
    const i = addItem(b.project, b.id, { failureMode: "x", samplingPointIds: ["SPL-001.SP-009"], sourceIds: ["S-99"] }, ACTOR);
    const texts = riskOpenItems(i.project, asm(i.project, b.id)).filter((o) => o.kind === "dangling-link").map((o) => o.text);
    expect(texts).toHaveLength(2);
    expect(samplingPointExists(i.project, "SPL-001.SP-009")).toBe(false);
  });
});

describe("seeding from gaps", () => {
  it("offers the gaps with SU and RU values and the severity as reference only", () => {
    const { project, id } = base();
    const seeds = gapSeeds(content, project, asm(project, id));
    expect(seeds.length).toBeGreaterThan(3);
    const g = seeds[0]!;
    expect(g.gapId).toMatch(/^G-\d{3}$/);
    expect(g.attribute.length).toBeGreaterThan(0);
    expect(["high", "medium", "low", "none"]).toContain(g.severity);
    expect(seeds.every((s) => s.itemIds.length === 0)).toBe(true);
    expect(seeds.length).toBe(assess(content, project).gaps.filter((x) => x.displayId.startsWith("G-")).length);
  });

  it("adds a draft item: gap text in the notes, no failure mode, no score, severity never copied", () => {
    let { project } = base();
    const id = "RAS-001";
    project = setMethod(project, id, loadout("fmea-1-10"), ACTOR);
    const seed = gapSeeds(content, project, asm(project, id)).find((s) => s.stepId)!;
    const added = addItemFromGap(project, id, seed, ACTOR);
    const item = asm(added.project, id).items[0]!;
    expect(item.gapIds).toEqual([seed.gapId]);
    expect(item.stepId).toBe(seed.stepId);
    expect(item.origin).toEqual({ kind: "gap" });
    expect(item.failureMode).toBe("");
    expect(item.initial).toEqual({ values: {} });
    expect(item.notes).toContain(seed.gapId);
    expect(item.notes).toContain(seed.attribute);
    expect(JSON.stringify(item)).not.toContain(`"${seed.severity}"`);
    expect(gapSeeds(content, added.project, asm(added.project, id)).find((s) => s.gapId === seed.gapId)!.itemIds).toEqual([item.id]);
    expect(() => addItemFromGap(added.project, id, seed, ACTOR)).toThrow(/already added/);
  });

  it("traces a gap to its items and back", () => {
    const { project, id } = base();
    const seed = gapSeeds(content, project, asm(project, id))[0]!;
    const added = addItemFromGap(project, id, seed, ACTOR);
    expect(risksForGap(added.project, seed.gapId)).toEqual([{ assessmentId: id, itemId: added.itemId }]);
    expect(risksForGap(added.project, "G-999")).toEqual([]);
  });
});

describe("seeding from the failure-mode catalog", () => {
  it("offers suggestions only for the assessment's own steps, in step order, none added by itself", () => {
    const { project, id } = base();
    const offers = suggestFailureModes(failureModes, asm(project, id));
    expect(offers.length).toBeGreaterThan(5);
    expect(asm(project, id).items).toHaveLength(0);
    const stepOrder = asm(project, id).steps.map((s) => s.id);
    const idx = offers.map((o) => stepOrder.indexOf(o.stepId));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
    const fewer = removeRiskStep(project, id, asm(project, id).steps.find((s) => s.unitOp === "aseptic_filling")!.id, ACTOR);
    expect(suggestFailureModes(failureModes, asm(fewer, id)).some((o) => o.unitOp === "aseptic_filling")).toBe(false);
  });

  it("accepting one adds a draft item with the catalog wording, the catalog version and no score", () => {
    const { project, id } = base();
    const offer = suggestFailureModes(failureModes, asm(project, id)).find((o) => o.key === "sterile_filter_integrity")!;
    const added = addItemFromSuggestion(project, id, offer, failureModes.catalog.version, ACTOR);
    const item = asm(added.project, id).items[0]!;
    expect(item.failureMode).toBe(offer.failureMode);
    expect(item.stepId).toBe(offer.stepId);
    expect(item.origin).toEqual({ kind: "catalog", suggestionKey: "sterile_filter_integrity", catalogVersion: "1.0.0" });
    expect(item.initial).toEqual({ values: {} });
    expect(suggestFailureModes(failureModes, asm(added.project, id)).find((o) => o.key === offer.key)!.added).toBe(true);
    expect(() => addItemFromSuggestion(added.project, id, offer, "1.0.0", ACTOR)).toThrow(/already added/);
  });
});

describe("sampling point links", () => {
  it("qualifies a point id with its plan and finds the items that cite it", () => {
    const b = base();
    expect(pointRef("SPL-001", "SP-003")).toBe("SPL-001.SP-003");
    const i = addItem(b.project, b.id, { failureMode: "x", samplingPointIds: ["SPL-001.SP-003"] }, ACTOR);
    expect(risksForSamplingPoint(i.project, "SPL-001", "SP-003")).toEqual([{ assessmentId: b.id, itemId: i.itemId }]);
    expect(risksForSamplingPoint(i.project, "SPL-001", "SP-004")).toEqual([]);
  });
});

describe("change log", () => {
  it("reads in the Changes view with the field names in words", () => {
    const b = base();
    const i = addItem(b.project, b.id, { failureMode: "Seal leak (fictional)", effect: "Sterility lost" }, ACTOR);
    const u = updateItem(i.project, b.id, i.itemId, { effect: "Sterility lost, batch rejected" }, LATER);
    const rows = changeLogView(content, u, {});
    const edit = rows.find((r) => r.action === "risk_item_update")!;
    expect(edit.actionLabel).toBe("Risk item edited");
    expect(edit.before).toContain("Effect: Sterility lost");
    expect(edit.after).toContain("Effect: Sterility lost, batch rejected");
    expect(edit.before).not.toContain("Failure mode");
    const add = rows.find((r) => r.action === "risk_item_add")!;
    expect(add.after).toContain("Failure mode: Seal leak (fictional)");
  });
});

describe("the fictional demo risk assessment", () => {
  const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const a = demo.risk.assessments[0]!;

  it("is only built when the caller has the risk catalogs", () => {
    expect(buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts).risk.assessments).toEqual([]);
  });

  it("uses the FMEA 1-10 load-out with no bands and about ten items over several steps", () => {
    expect(a.method).toBe("fmea");
    expect(a.config?.loadoutId).toBe("fmea-1-10");
    expect(a.items).toHaveLength(10);
    expect(new Set(a.items.map((i) => i.stepId)).size).toBeGreaterThan(4);
  });

  it("mixes sources: gaps, catalog and by hand", () => {
    const kinds = a.items.map((i) => i.origin?.kind);
    expect(kinds).toContain("gap");
    expect(kinds).toContain("catalog");
    expect(kinds).toContain("free");
  });

  it("links items to existing sampling points and the link is found from the point", () => {
    const linked = a.items.filter((i) => i.samplingPointIds.length > 0);
    expect(linked.length).toBeGreaterThan(2);
    for (const i of linked) for (const ref of i.samplingPointIds) expect(samplingPointExists(demo, ref)).toBe(true);
    expect(risksForSamplingPoint(demo, "SPL-001", "SP-010")).toEqual([{ assessmentId: a.id, itemId: expect.any(String) }]);
  });

  it("has two to three residual scores and one item left unscored on purpose", () => {
    const residuals = a.items.filter((i) => i.residual && Object.keys(i.residual.values).length > 0);
    expect(hasResidual(a)).toBe(true);
    expect(residuals.length).toBeGreaterThanOrEqual(2);
    expect(residuals.length).toBeLessThanOrEqual(3);
    const open = riskOpenItems(demo, a);
    expect(open.filter((o) => o.kind === "not-scored")).toHaveLength(1);
    expect(open.some((o) => o.kind === "dangling-link")).toBe(false);
  });

  it("traces gaps both ways", () => {
    const fromGap = a.items.find((i) => i.gapIds.length > 0)!;
    expect(risksForGap(demo, fromGap.gapIds[0]!).map((r) => r.itemId)).toContain(fromGap.id);
  });
});
