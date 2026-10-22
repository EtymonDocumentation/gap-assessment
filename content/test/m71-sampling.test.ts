// Milestone 7.1: study types, reporting instructions, agency requests, plan subsections, the optional mixing design with
// load-outs, the CMO export, and the demo that exercises all of it. All data are fictional.
import {
  addAgencyRequest,
  addPoint,
  addSubsection,
  applyDesignLoadout,
  buildCmoInstructionsDocument,
  buildDemoProject,
  buildSamplingPlanDocument,
  changeLogView,
  createPlan,
  documentFingerprint,
  moveSubsection,
  recordExport,
  removeAgencyRequest,
  removePoint,
  removeSubsection,
  SamplingError,
  samplingOpenItems,
  updatePoint,
  updateSubsection,
} from "@gap/engine";
import { SAMPLING_TYPES, type Actor, type Project, type TemplateRecord } from "@gap/process-model";
import { agencyCoverage, checkPoint, planTotals, reportingInstructions, stabilityDerivation } from "@gap/sampling";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, samplingSuggestions } from "../index";

const ACTOR: Actor = { name: "Pat Placeholder (fictional)", role: "MSAT engineer", at: "2026-10-06T09:00:00.000Z" };
const LATER: Actor = { name: "Sam Sample (fictional)", role: "QA", at: "2026-10-07T10:00:00.000Z" };
const GENERATED = "2026-10-08T00:00:00.000Z";

const demo = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts);
const plan = demo.sampling.plans[0]!;
const planDoc = (p: Project = demo) => buildSamplingPlanDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, { generatedAt: GENERATED });
const cmoDoc = (p: Project = demo) => buildCmoInstructionsDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, { generatedAt: GENERATED });
const bare = (): { project: Project; planId: string } => createPlan(buildDemoProject(content, demos["arx-217"]), { title: "Fresh plan (fictional)" }, ACTOR);
const loadout = (id: string) => designLoadouts.loadouts.find((l) => l.id === id)!;

describe("the demo plan covers every study type", () => {
  it("has at least one point of every type and exactly one incomplete point", () => {
    expect(new Set(plan.points.map((p) => p.type))).toEqual(new Set(SAMPLING_TYPES));
    expect([...new Set(samplingOpenItems(content, demo, plan).map((o) => o.ref))]).toEqual(["SP-007"]);
  });

  it("links an agency request to a regulatory commitment point and has the stability, hold and retain shapes asked for", () => {
    const ar = plan.agencyRequests[0]!;
    expect(ar.reference).toBe("IR-DEMO-01 (fictional)");
    expect(plan.points.filter((p) => p.agencyRequestIds?.includes(ar.id)).map((p) => p.type)).toEqual(["regulatory_commitment"]);
    const stab = plan.points.find((p) => p.type === "stability")!;
    expect(stab.detail?.stability?.conditions).toHaveLength(2);
    expect(stab.detail?.stability?.timePoints).toHaveLength(4);
    expect(stabilityDerivation(stab)).toMatchObject({ pulls: 8, units: 48 });
    expect(plan.points.find((p) => p.type === "hold_time")!.detail?.hold?.durations).toHaveLength(2);
    expect(plan.points.find((p) => p.type === "retain_reserve")!.detail?.retain?.unitsPerBatch).toBe(40);
  });

  it("totals count stability and retain units in their own columns", () => {
    const t = planTotals(plan);
    expect(t.stabilityUnits).toBe(48 * 3);
    expect(t.retainUnits).toBe(40 * 3);
    expect(t.allUnits).toBe(t.units + t.stabilityUnits + t.retainUnits);
  });

  it("has three custom subsections, one from the library with its version kept, tokens filled in the document", () => {
    expect(plan.subsections).toHaveLength(3);
    expect(plan.subsections[0]!.origin).toMatchObject({ kind: "library", version: "1.0" });
    expect(plan.subsections.filter((s) => s.includeInCmo)).toHaveLength(2);
    const md = renderMarkdown(planDoc());
    expect(md).toContain("3 PPQ batches: PPQ batch 1, PPQ batch 2, PPQ batch 3. Site: Site South (fictional).");
    expect(md).not.toMatch(/\{(planId|productName|batchCount|batchList|ruSite|pointId|pointTest)\}/);
  });
});

describe("the optional mixing study design", () => {
  const mixing = plan.points.find((p) => p.type === "mixing_homogeneity")!;

  it("the demo mixing point holds the bracketing load-out with fictional values", () => {
    const d = mixing.detail?.mixing?.design;
    expect(d?.approach).toBe("Worst-case bracketing");
    expect(d?.runs).toHaveLength(2);
    expect(d?.runs?.[0]?.batchSize).toEqual({ value: 21, unit: "L", tag: "max" });
    expect(d?.rangeSupport?.[0]).toMatchObject({ parameter: "Batch size", rangeKind: "PAR" });
  });

  it("the design never adds a problem: removing it changes nothing about completeness", () => {
    const before = checkPoint(plan, mixing).problems;
    const bareMixing = { ...mixing, detail: { mixing: { ...mixing.detail!.mixing!, design: undefined } } };
    expect(checkPoint(plan, bareMixing as never).problems).toEqual(before);
    expect(before.join(" ")).not.toMatch(/design|\bruns?\b|worst|\b(PAR|NOR)\b/);
  });

  it("applying a load-out replaces or appends, and the change log keeps the old design", () => {
    const { project, planId } = bare();
    const a = addPoint(project, planId, { unitOp: "compounding", type: "mixing_homogeneity", attribute: "Blend" }, ACTOR);
    const one = applyDesignLoadout(a.project, planId, a.pointId, loadout("three-at-target"), "replace", ACTOR);
    expect(one.sampling.plans[0]!.points[0]!.detail?.mixing?.design?.runs).toHaveLength(3);
    const appended = applyDesignLoadout(one, planId, a.pointId, loadout("worst-case-bracketing"), "append", LATER);
    expect(appended.sampling.plans[0]!.points[0]!.detail?.mixing?.design?.runs).toHaveLength(5);
    const replaced = applyDesignLoadout(appended, planId, a.pointId, loadout("worst-case-bracketing"), "replace", LATER);
    const design = replaced.sampling.plans[0]!.points[0]!.detail?.mixing?.design;
    expect(design?.runs).toHaveLength(2);
    const ev = replaced.changeLog.at(-1)!;
    expect(ev.action).toBe("sampling_point_update");
    expect(JSON.stringify(ev.before)).toContain("Batch 1");
  });

  it("refuses a load-out on a point that is not a mixing study", () => {
    const { project, planId } = bare();
    const a = addPoint(project, planId, { unitOp: "none", type: "ipc", attribute: "x" }, ACTOR);
    expect(() => applyDesignLoadout(a.project, planId, a.pointId, loadout("three-at-target"), "replace", ACTOR)).toThrow(SamplingError);
  });

  it("prints the design when there is one and nothing when there is not", () => {
    const md = renderMarkdown(planDoc());
    expect(md).toContain("| Run | Batch size | Mixing speed | Mix time | Challenges |");
    expect(md).toContain("21 L (maximum)");
    expect(md).toContain("Range for Batch size (PAR): Batch size 12 to 21 L (fictional values).");
    const { project, planId } = bare();
    const a = addPoint(project, planId, { unitOp: "compounding", type: "mixing_homogeneity", attribute: "Blend" }, ACTOR);
    const empty = renderMarkdown(planDoc(a.project));
    expect(empty).not.toMatch(/Study design|Range for/);
  });

  it("the catalog of load-outs is valid and offers no numbers", () => {
    expect(designLoadouts.loadouts.map((l) => l.id)).toEqual(["three-at-target", "worst-case-bracketing"]);
    expect(JSON.stringify(designLoadouts)).not.toMatch(/"value"/);
  });
});

describe("reporting instructions read on their own", () => {
  it("every block names its point, test, step, batches and criterion, and never points elsewhere", () => {
    for (const p of plan.points) {
      const ri = reportingInstructions(plan, p, { unitOpLabel: (k) => k });
      const text = ri.paragraphs.join("\n");
      expect(ri.id).toBe(`RI-${p.id}`);
      expect(text).toContain(p.id);
      expect(text).toContain(p.attribute);
      expect(text).toContain("PPQ batch 1");
      expect(text).toMatch(/Acceptance:/);
      expect(text).not.toMatch(/see above|as above|as in the plan|see the plan/i);
    }
  });

  it("the plan document prints one RI block per point, right after the point", () => {
    const md = renderMarkdown(planDoc());
    for (const p of plan.points) expect(md).toContain(`Reporting instructions RI-${p.id}`);
    // Points are grouped by study type, so test "right after" as: the next point heading comes after the block.
    for (const p of plan.points) {
      const start = md.indexOf(`### ${p.id}:`);
      const ri = md.indexOf(`Reporting instructions RI-${p.id}`, start);
      const next = md.indexOf("\n### SP-", start + 1);
      expect(start).toBeGreaterThan(-1);
      expect(ri).toBeGreaterThan(start);
      if (next > -1 && !md.slice(start + 1, next).includes(`RI-${p.id}`)) throw new Error(`${p.id}: its block is not before the next point`);
    }
  });

  it("an incomplete point keeps its block with the gaps written out", () => {
    const ri = reportingInstructions(plan, plan.points.find((p) => p.id === "SP-007")!, { unitOpLabel: (k) => k });
    expect(ri.missing).toContain("what to report");
    expect(ri.paragraphs.join("\n")).toContain("not given yet");
  });
});

describe("the CMO reporting instructions export", () => {
  const doc = cmoDoc();
  const md = renderMarkdown(doc);

  it("has the intro, one block per point, the marked subsections and the linked agency requests", () => {
    expect(doc.sections.map((s) => s.id)).toEqual(["cmo-intro", "cmo-blocks", "cmo-subsections", "cmo-agency"]);
    for (const p of plan.points) expect(md).toContain(`Reporting instructions RI-${p.id}`);
    expect(md).toContain("Sample handling after collection (fictional) (CS-001)");
    expect(md).not.toContain("Batches covered by this plan");
    expect(md).toContain("IR-DEMO-01 (fictional)");
  });

  it("states the plan version it belongs to and that the plan still has open items", () => {
    expect(doc.meta.find(([k]) => k === "Plan version")![1]).toContain(documentFingerprint(planDoc()).slice(0, 12));
    expect(md).toContain("The plan still has 12 open items");
    expect(md).toContain("SP-007 is incomplete in the plan");
  });

  it("has the banner, a stable fingerprint, and changes when an instruction changes", () => {
    expect(doc.banner).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(documentFingerprint(cmoDoc())).toBe(documentFingerprint(doc));
    const p2 = updatePoint(demo, plan.id, "SP-001", { reporting: { what: ["mean"] } }, LATER);
    expect(documentFingerprint(cmoDoc(p2))).not.toBe(documentFingerprint(doc));
    expect(renderHtml(doc)).toContain("CMO reporting instructions");
  });

  it("never uses filing wording", () => {
    expect(md).not.toMatch(/\b(Prior Approval|CBE-30|CBE-0|annual report)\b/i);
  });

  it("has its own export family: a plan download is not the previous download of the instructions", () => {
    const template: TemplateRecord = { mode: "builtin", name: "Built-in default", version: "1.0.0" };
    const rec = (p: Project, format: "sampling-plan-docx" | "sampling-cmo-instructions-docx" | "sampling-cmo-instructions-html", at: string, fp: string) =>
      recordExport(p, { at, by: "Pat", format, template, fingerprint: fp, tbdCount: 1, versions: { processModel: "1.2.0", catalog: "x", format: "1.1.0", stats: "0.1.0", suggestions: "1.1.0" } });
    let p = rec(demo, "sampling-cmo-instructions-docx", "2026-10-08T10:00:00.000Z", "aaa");
    p = rec(p, "sampling-plan-docx", "2026-10-08T10:01:00.000Z", "bbb");
    p = rec(p, "sampling-cmo-instructions-html", "2026-10-08T10:02:00.000Z", "aaa");
    const cmo = p.document.exports.filter((e) => e.format.startsWith("sampling-cmo-"));
    expect(cmo).toHaveLength(2);
    expect(cmo[1]!.changedSincePrevious).toBe(false);
    expect(p.document.exports.find((e) => e.format === "sampling-plan-docx")!.changedSincePrevious).toBeUndefined();
  });
});

describe("agency requests", () => {
  it("coverage lists the points linked to each request", () => {
    expect(agencyCoverage(plan)[0]!.text).toMatch(/^Linked to SP-014/);
  });

  it("cannot be removed while a point links it, and an id is never reused", () => {
    expect(() => removeAgencyRequest(demo, plan.id, plan.agencyRequests[0]!.id, LATER)).toThrow(SamplingError);
    const { project, planId } = bare();
    const a = addAgencyRequest(project, planId, { agency: "Example Agency (fictional)", question: "One?", sourceIds: [] } as never, ACTOR);
    const gone = removeAgencyRequest(a.project, planId, a.requestId, ACTOR);
    const b = addAgencyRequest(gone, planId, { agency: "Example Agency (fictional)", question: "Two?", sourceIds: [] } as never, ACTOR);
    expect([a.requestId, b.requestId]).toEqual(["AR-001", "AR-002"]);
  });

  it("a request nobody answers is an open item, not a hidden one", () => {
    const { project, planId } = bare();
    const a = addAgencyRequest(project, planId, { agency: "Example Agency (fictional)", question: "Why?", status: "open", sourceIds: [] } as never, ACTOR);
    expect(samplingOpenItems(content, a.project, a.project.sampling.plans[0]!).some((o) => o.kind === "agency" && /no sampling point is linked/.test(o.text))).toBe(true);
  });
});

describe("plan subsections", () => {
  it("get stable ids that are never reused, keep their order and refuse a removed point", () => {
    const { project, planId } = bare();
    const a = addSubsection(project, planId, { title: "One", blocks: [{ type: "paragraph", text: "Text for {planId}." }], placement: "appendix" }, ACTOR);
    const b = addSubsection(a.project, planId, { title: "Two", blocks: [], placement: "appendix" }, ACTOR);
    const moved = moveSubsection(b.project, planId, b.subsectionId, "up", ACTOR);
    expect(moved.sampling.plans[0]!.subsections.map((s) => [s.id, s.order]).sort()).toEqual([["CS-001", 1], ["CS-002", 0]]);
    const gone = removeSubsection(moved, planId, a.subsectionId, ACTOR);
    const c = addSubsection(gone, planId, { title: "Three", blocks: [], placement: "appendix" }, ACTOR);
    expect(c.subsectionId).toBe("CS-003");
    expect(() => addSubsection(project, planId, { title: "Bad", blocks: [], placement: "somewhere" }, ACTOR)).toThrow(SamplingError);
  });

  it("an unknown token is an open item and is shown in the document, never hidden", () => {
    const { project, planId } = bare();
    const a = addSubsection(project, planId, { title: "Tokens", blocks: [{ type: "paragraph", text: "Hello {nobody}." }], placement: "appendix" }, ACTOR);
    const items = samplingOpenItems(content, a.project, a.project.sampling.plans[0]!);
    expect(items.some((o) => o.kind === "subsection" && o.ref === "CS-001")).toBe(true);
    expect(renderMarkdown(planDoc(a.project))).toContain("CS-001");
  });

  it("edits are change-logged with the old text, and a point with a subsection placed in it cannot be removed", () => {
    const { project, planId } = bare();
    const pt = addPoint(project, planId, { unitOp: "none", type: "ipc", attribute: "Held" }, ACTOR);
    const sub = addSubsection(pt.project, planId, { title: "In point", blocks: [], placement: `in_point:${pt.pointId}` }, ACTOR);
    expect(() => removePoint(sub.project, planId, pt.pointId, ACTOR)).toThrow(SamplingError);
    const edited = updateSubsection(sub.project, planId, sub.subsectionId, { title: "Renamed" }, LATER);
    const row = changeLogView(content, edited).find((r) => r.action === "sampling_subsection_update")!;
    expect(row.before).toContain("In point");
    expect(row.after).toContain("Renamed");
  });
});
