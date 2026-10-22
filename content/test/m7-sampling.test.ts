// Milestone 7: the PPQ sampling plan. Suggestions (options only), the editing functions and their change log, the demo plan,
// the document, and the export history. All data are fictional.
import {
  acceptSuggestion,
  addBatch,
  addPoint,
  assess,
  buildDemoProject,
  demoSamplingTables,
  buildSamplingPlanDocument,
  changeLogView,
  createPlan,
  deletePlan,
  documentFingerprint,
  excludeStep,
  parseSamplingSuggestions,
  recordExport,
  removeBatch,
  removePoint,
  samplingBasisText,
  samplingOpenItems,
  SamplingError,
  suggestPoints,
  updateBatch,
  updatePlan,
  updatePoint,
  type DocModel,
} from "@gap/engine";
import { parseProject, type Actor, type Project, type TemplateRecord } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-06T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-07T10:00:00.000Z" };
const GENERATED = "2026-10-08T00:00:00.000Z";

const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
const plan = demo.sampling.plans[0]!;
const docOf = (p: Project = demo, pl = plan): DocModel => buildSamplingPlanDocument(content, p, pl, samplingSuggestions, { generatedAt: GENERATED });
const base = (): { project: Project; planId: string } => createPlan(buildDemoProject(content, demos["arx-217"]), { title: "Fresh plan (fictional)" }, ACTOR);

describe("the suggestions catalog is options only", () => {
  it("loads and every unit operation exists", () => {
    expect(samplingSuggestions.catalog).toEqual({ id: "ppq-suggestions", version: "1.1.0" });
    expect(samplingSuggestions.candidates.length).toBeGreaterThan(30);
  });

  it("refuses a sample size, a criterion or a method in a candidate", () => {
    const ok = { catalog: { id: "ppq-suggestions", version: "1.0.0" }, candidates: [{ uo: "none", key: "a", attribute: "A", type: "other", why: "Because." }], activityCandidates: [] };
    expect(() => parseSamplingSuggestions(ok)).not.toThrow();
    for (const extra of [{ sampleSize: 5 }, { acceptance: "x" }, { method: "fixed" }, { count: 3 }]) {
      const bad = { ...ok, candidates: [{ ...ok.candidates[0], ...extra }] };
      expect(() => parseSamplingSuggestions(bad)).toThrow(/invalid/);
    }
  });

  it("refuses an unknown step and a duplicate key", () => {
    const one = { uo: "nope", key: "a", attribute: "A", type: "other", why: "Because." };
    const raw = (c: unknown[]) => ({ catalog: { id: "ppq-suggestions", version: "1.0.0" }, candidates: c, activityCandidates: [] });
    expect(() => parseSamplingSuggestions(raw([one]), ["aseptic_filling"])).toThrow(/unknown unit operation/);
    expect(() => parseSamplingSuggestions(raw([{ ...one, uo: "none" }, { ...one, uo: "none" }]), [])).toThrow(/duplicate key/);
  });
});

describe("suggestions from the RU data", () => {
  const all = suggestPoints(content, demo, samplingSuggestions, plan);

  it("come from IPC items, critical parameters, the catalog and validation activities, with gap ids", () => {
    expect(new Set(all.map((s) => s.source))).toEqual(new Set(["ipc", "catalog", "activity"]));
    const ipc = all.find((s) => s.id === "ipc:uo.aseptic_filling.ipc.fill_check")!;
    expect(ipc.itemPath).toBe("uo.aseptic_filling.ipc.fill_check");
    expect(ipc.gapIds.length).toBeGreaterThan(0);
    expect(all.filter((s) => s.source === "activity").every((s) => s.validationActivity)).toBe(true);
  });

  it("offers a critical-process-parameter suggestion only when the seed carries that classification", () => {
    // The target questions of the current catalog do not ask for a classification, so the seed gives none and nothing is invented.
    expect(all.filter((s) => s.source === "cpp")).toEqual([]);
  });

  it("offers none for the lyophilizer of a liquid product", () => {
    expect(all.some((s) => s.uo === "lyophilization")).toBe(false);
  });

  it("offers none for a step left out of the scope, and the step's points get a warning", () => {
    const cut = excludeStep(content, demo, "capping", "Not part of this transfer (fictional)", ACTOR);
    const s = suggestPoints(content, cut, samplingSuggestions);
    expect(s.some((x) => x.uo === "capping")).toBe(false);
    expect(s.some((x) => x.uo === "aseptic_filling")).toBe(true);
    const warn = samplingOpenItems(content, cut, cut.sampling.plans[0]!).filter((i) => /left out of the assessment/.test(i.text));
    expect(warn.map((w) => w.ref)).toEqual(["SP-003"]);
  });

  it("marks accepted suggestions as added", () => {
    const fill = all.find((s) => s.id === "cat:fill_weight")!;
    expect(fill.added).toBe(true);
    expect(all.find((s) => s.id === "cat:release_potency")!.added).toBe(false);
  });

  it("accepting one makes an incomplete point with its origin, and nothing else is filled in", () => {
    const { project, planId } = base();
    const s = suggestPoints(content, project, samplingSuggestions).find((x) => x.id === "ipc:uo.aseptic_filling.ipc.fill_check")!;
    const r = acceptSuggestion(project, planId, s, ACTOR);
    const pt = r.project.sampling.plans[0]!.points[0]!;
    expect(pt.origin).toMatchObject({ kind: "seeded", itemPath: "uo.aseptic_filling.ipc.fill_check", suggestionKey: s.id });
    expect(pt.origin.kind === "seeded" && pt.origin.gapIds.length).toBeGreaterThan(0);
    expect(pt).toMatchObject({ rationale: "", appliesTo: "all", timing: { options: [] }, sampleSize: { inputs: {} } });
    expect(pt.locationsCount).toBeUndefined();
    expect(pt.acceptance).toBeUndefined();
    expect(() => acceptSuggestion(r.project, planId, s, ACTOR)).toThrow(SamplingError);
  });
});

describe("editing keeps the old values in the change log", () => {
  it("creates a plan with no batches and no batch count", () => {
    const { project, planId } = base();
    const p = project.sampling.plans.find((x) => x.id === planId)!;
    expect(p.batches).toEqual([]);
    expect(p.batchRationale).toBe("");
    expect(p.status).toBe("draft");
  });

  it("logs a point edit with before and after, and the log shows the field text", () => {
    const { project, planId } = base();
    const a = addPoint(project, planId, { unitOp: "aseptic_filling", type: "ipc", attribute: "Fill weight" }, ACTOR);
    const b = updatePoint(a.project, planId, a.pointId, { attribute: "Fill volume", rationale: "Routine" }, LATER);
    const ev = b.changeLog.at(-1)!;
    expect(ev.action).toBe("sampling_point_update");
    expect((ev.before as { attribute: string }).attribute).toBe("Fill weight");
    expect((ev.after as { attribute: string }).attribute).toBe("Fill volume");
    const row = changeLogView(content, b).find((r) => r.action === "sampling_point_update")!;
    expect(row.before).toContain("Fill weight");
    expect(row.after).toContain("Fill volume");
    expect(row.by).toBe(LATER.name);
  });

  it("an edit that changes nothing adds no event", () => {
    const { project, planId } = base();
    const a = addPoint(project, planId, { unitOp: "none", type: "supporting_study", attribute: "Hold" }, ACTOR);
    const same = updatePoint(a.project, planId, a.pointId, { attribute: "Hold" }, LATER);
    expect(same.changeLog.length).toBe(a.project.changeLog.length);
  });

  it("refuses report only for in-process, release and enhanced points, allows it for characterization", () => {
    const { project, planId } = base();
    const a = addPoint(project, planId, { unitOp: "aseptic_filling", type: "ipc", attribute: "Fill" }, ACTOR);
    expect(() => updatePoint(a.project, planId, a.pointId, { acceptance: { kind: "report_only" } }, ACTOR)).toThrow();
    const c = addPoint(a.project, planId, { unitOp: "finished_product", type: "characterization", attribute: "Extended" }, ACTOR);
    const ok = updatePoint(c.project, planId, c.pointId, { acceptance: { kind: "report_only" } }, ACTOR);
    expect(ok.sampling.plans[0]!.points[1]!.acceptance).toEqual({ kind: "report_only" });
  });

  it("never reuses an id, even after the item was removed", () => {
    const { project, planId } = base();
    const a = addPoint(project, planId, { unitOp: "none", type: "other", attribute: "One" }, ACTOR);
    const b = removePoint(a.project, planId, a.pointId, ACTOR);
    const c = addPoint(b, planId, { unitOp: "none", type: "other", attribute: "Two" }, ACTOR);
    expect(a.pointId).toBe("SP-001");
    expect(c.pointId).toBe("SP-002");
    const x = addBatch(c.project, planId, { label: "PPQ batch 1" }, ACTOR);
    const y = addBatch(removeBatch(x.project, planId, x.batchId, ACTOR), planId, { label: "PPQ batch 1 again" }, ACTOR);
    expect([x.batchId, y.batchId]).toEqual(["B-001", "B-002"]);
  });

  it("refuses to remove a batch a point depends on, and keeps the plan unchanged", () => {
    const { project, planId } = base();
    const b1 = addBatch(project, planId, { label: "B one", plannedLotSizeUnits: 100 }, ACTOR);
    const b2 = addBatch(b1.project, planId, { label: "B two", plannedLotSizeUnits: 100 }, ACTOR);
    const pt = addPoint(b2.project, planId, { unitOp: "none", type: "other", attribute: "Only one batch" }, ACTOR);
    const narrowed = updatePoint(pt.project, planId, pt.pointId, { appliesTo: [b1.batchId] }, ACTOR);
    expect(() => removeBatch(narrowed, planId, b1.batchId, ACTOR)).toThrow(SamplingError);
    expect(removeBatch(narrowed, planId, b2.batchId, ACTOR).sampling.plans[0]!.batches.length).toBe(1);
  });

  it("saves the arithmetic of the point and refreshes it when the batch changes", () => {
    const { project, planId } = base();
    const b = addBatch(project, planId, { label: "B one", plannedLotSizeUnits: 400 }, ACTOR);
    const a = addPoint(b.project, planId, { unitOp: "none", type: "other", attribute: "Fixed" }, ACTOR);
    const u = updatePoint(a.project, planId, a.pointId, { sampleSize: { method: "conf-rel", inputs: { confidence: 0.95, reliability: 0.95, allowedFailures: 0 } } }, ACTOR);
    expect(u.sampling.plans[0]!.points[0]!.sampleSize.result?.perBatch[0]?.sampleSize).toBe(59);
    const l = updateBatch(u, planId, b.batchId, { plannedLotSizeUnits: 40 }, LATER);
    expect(l.sampling.plans[0]!.points[0]!.sampleSize.result?.statsVersion).toBeTruthy();
  });

  it("plan and batch edits are logged; deleting a plan keeps what it said", () => {
    const { project, planId } = base();
    const u = updatePlan(project, planId, { batchRationale: "Site rule (fictional)" }, LATER);
    expect(u.changeLog.at(-1)).toMatchObject({ action: "sampling_plan_update" });
    const d = deletePlan(u, planId, LATER);
    expect(d.sampling.plans).toEqual([]);
    const ev = d.changeLog.at(-1)!;
    expect(ev.action).toBe("sampling_plan_remove");
    expect((ev.before as { batchRationale: string }).batchRationale).toBe("Site rule (fictional)");
  });
});

describe("the demo plan", () => {
  it("has three batches and uses every sampling method", () => {
    expect(plan.batches.map((b) => b.plannedLotSizeUnits)).toEqual([4200, 4200, 3000]);
    expect(new Set(plan.points.map((p) => p.sampleSize.method))).toEqual(new Set(["company-table", "fixed", "conf-rel", "aql-105e", "var-414", undefined]) /* undefined: stability and retain are worked out, not sampled */);
  });

  it("has exactly one incomplete point so that open items show, and a report-only characterization point", () => {
    const open = samplingOpenItems(content, demo, plan);
    expect([...new Set(open.map((o) => o.ref))]).toEqual(["SP-007"]);
    expect(plan.points.find((p) => p.acceptance?.kind === "report_only")?.type).toBe("characterization");
  });

  it("reads each batch's lot size for the company table", () => {
    const sp1 = plan.points[0]!.sampleSize.result!.perBatch.map((r) => r.sampleSize);
    expect(sp1).toEqual([20, 20, 13]);
  });

  it("is built through the change log and survives a save and load", () => {
    expect(demo.changeLog.filter((e) => e.action === "sampling_point_add").length).toBe(15);
    expect(parseProject(JSON.parse(JSON.stringify(demo))).sampling.plans[0]!.points.length).toBe(15);
  });

  it("is left out when the caller has no suggestions catalog (older callers)", () => {
    expect(buildDemoProject(content, demos["arx-217"]).sampling.plans).toEqual([]);
  });
});

describe("the sampling plan document", () => {
  const doc = docOf();
  const md = renderMarkdown(doc);

  it("has the title, the banner and the not-approved line", () => {
    expect(doc.title).toBe("PPQ sampling plan — draft");
    expect(doc.banner).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(md).toContain(samplingBasisText(demo.meta.id));
    expect(samplingBasisText("P-1")).toBe("Draft sampling plan generated from project P-1. Not approved.");
  });

  it("has the planned sections in order", () => {
    expect(doc.sections.map((s) => s.title)).toEqual([
      "Purpose and scope",
      "Product, presentation and receiving site",
      "PPQ batches",
      "Process flow",
      "Statistical bases used",
      "In-process control (IPC)",
      "Release testing",
      "PPQ enhanced sampling",
      "Mixing / homogeneity",
      "Hold time",
      "Filter study",
      "Stability",
      "Retain / reserve",
      "Characterization",
      "Supporting study",
      "Regulatory commitment",
      "Other",
      "Sample totals per batch",
      "Open items",
      "Agency requests and commitments",
      "Traceability",
      "Source register",
      "Versions",
    ]);
  });

  it("shows the working and a citation for each method used, the table rows, and the report-only wording", () => {
    for (const phrase of ["MIL-STD-105E", "MIL-STD-414", "QC-SAMP-001 (fictional)", "Report only", "Confidence", "Code letter"]) {
      expect(md.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("lists the open items of the incomplete point and counts them", () => {
    expect(doc.tbdCount).toBe(samplingOpenItems(content, demo, plan).length);
    expect(md).toContain("SP-007");
  });

  it("never claims approval, adequacy or a filing category", () => {
    expect(md).not.toMatch(/\bis approved\b|\bwas approved\b|\badequate\b(?! for the process)/i);
    expect(md).not.toMatch(/\b(Prior Approval|CBE-30|CBE-0|annual report)\b/i);
  });

  it("renders to HTML and has a stable fingerprint that ignores the generation time", () => {
    expect(renderHtml(doc)).toContain("PPQ sampling plan");
    const again = docOf();
    expect(documentFingerprint(again)).toBe(documentFingerprint(doc));
    const other = buildSamplingPlanDocument(content, demo, plan, samplingSuggestions, { generatedAt: "2027-01-01T00:00:00.000Z" });
    expect(documentFingerprint(other)).toBe(documentFingerprint(doc));
  });

  it("changing a point changes the fingerprint", () => {
    const p2 = updatePoint(demo, plan.id, "SP-002", { rationale: "A different reason" }, LATER);
    expect(documentFingerprint(docOf(p2, p2.sampling.plans[0]!))).not.toBe(documentFingerprint(doc));
  });
});

describe("export history of the sampling plan", () => {
  const template: TemplateRecord = { mode: "builtin", name: "Built-in default", version: "1.0.0" };
  const rec = (p: Project, format: "sampling-plan-docx" | "sampling-plan-html" | "docx", at: string, fp: string): Project =>
    recordExport(p, { at, by: "Pat", format, template, fingerprint: fp, tbdCount: 2, versions: { processModel: "1.2.0", catalog: "x", format: "1.0.0", stats: "0.1.0", suggestions: "1.0.0" } });

  it("keeps the versions and compares only with the previous export of the same family", () => {
    let p = rec(demo, "sampling-plan-docx", "2026-10-08T10:00:00.000Z", "aaa");
    p = rec(p, "docx", "2026-10-08T10:05:00.000Z", "bbb");
    p = rec(p, "sampling-plan-html", "2026-10-08T10:10:00.000Z", "ccc");
    const ex = p.document.exports.filter((e) => e.format.startsWith("sampling-plan-"));
    expect(ex.length).toBe(2);
    expect(ex[1]!.versions).toMatchObject({ stats: "0.1.0", suggestions: "1.0.0" });
    // The gap document export in between is not "the previous download" of the plan: the plan's second export is compared with its first.
    expect(ex[1]!.changedSincePrevious).toBe(true);
    expect(ex[0]!.omittedSections ?? []).toEqual([]);
    expect(assess(content, p).gaps.length).toBeGreaterThan(0);
  });
});

describe("traceability and wording of the demo document", () => {
  const doc = docOf();
  const tableOf = (id: string) => {
    const t = doc.sections.find((s) => s.id === id)!.blocks.find((b) => b.type === "table") as { columns: string[]; rows: string[][] };
    return t;
  };

  it("seeded demo points carry their RU item, gap ids, validation activity and cited sources", () => {
    const traced = plan.points.filter((p) => p.origin.kind === "seeded" && p.origin.itemPath && p.origin.gapIds.length > 0 && p.sourceIds.length > 0);
    expect(traced.length).toBeGreaterThanOrEqual(3);
    const fill = plan.points.find((p) => p.attribute === "Fill weight or fill volume")!;
    expect(fill.origin).toMatchObject({ kind: "seeded", suggestionKey: "cat:fill_weight", itemPath: "uo.aseptic_filling.ipc.fill_check" });
    const cci = plan.points.find((p) => p.attribute === "Container closure integrity")!;
    expect(cci.origin).toMatchObject({ kind: "seeded", validationActivity: "cci_study" });
    // The gap ids are those the RU item has in this project's own assessment (the seed), not invented ones.
    const offered = suggestPoints(content, demo, samplingSuggestions);
    for (const p of traced) {
      const o = p.origin as { itemPath?: string; validationActivity?: string; gapIds: string[] };
      const src = offered.find((s) => (o.itemPath ? s.itemPath === o.itemPath : s.validationActivity === o.validationActivity));
      expect(src?.gapIds, p.id).toEqual(o.gapIds);
    }
    for (const p of plan.points) for (const id of p.sourceIds) expect(demo.sources.some((s) => s.id === id)).toBe(true);
  });

  it("Appendix A shows those values, and a catalog-only point shows its suggestion key", () => {
    const t = tableOf("traceability");
    const row = (id: string) => t.rows[plan.points.findIndex((p) => p.id === id)]!;
    const fillRow = row(plan.points.find((p) => p.attribute === "Fill weight or fill volume")!.id);
    expect(fillRow[1]).toBe("Suggestion: cat:fill_weight");
    expect(fillRow[2]).toBe("uo.aseptic_filling.ipc.fill_check");
    expect(fillRow[3]).not.toBe("");
    expect(fillRow[5]).not.toBe("");
    const ec = row(plan.points.find((p) => p.attribute === "Extended characterization")!.id);
    expect(ec[1]).toBe("Suggestion: cat:extended_characterization");
    // Appendix B lists the cited documents.
    const reg = tableOf("source-register");
    expect(reg.rows.length).toBeGreaterThanOrEqual(2);
    expect(reg.rows.flat().join(" ")).toContain("DEMO-PPQ-217-01");
  });

  it("never doubles a full stop where a typed basis already ends in one", () => {
    const md = renderMarkdown(doc);
    expect(md).not.toMatch(/[.!?]\.(?!\.)/);
    expect(md).toMatch(/per filtration\. Result: n = 3\./);
  });

  it("the demo company table cites a document reference that differs from its name", () => {
    const t = demoSamplingTables(demos["arx-217"])[0]!;
    expect(t.documentRef).toBeTruthy();
    expect(t.documentRef).not.toBe(t.name);
  });
});
