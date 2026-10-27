// What the PDA technical reports expect, applied to the TRD, the PPQ sampling plan and the batch record (MBR): filtration limits,
// parameter classification and data map, limits-ladder wording, bioburden-load wording, hold qualification, optional sections,
// the PPQ design and readiness, the PPQ-only flag, and the MBR intervention log and filter records. All data are fictional.
import {
  buildDemoProject,
  buildMbrDocument,
  buildSamplingPlanDocument,
  buildTrdDocument,
  setControl,
  setReadiness,
  updatePlanDesign,
  type Block,
  type DocModel,
} from "@gap/engine";
import { PPQ_READINESS_ITEMS } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const trd = project.trd.documents[0]!;
const plan = project.sampling.plans[0]!;
const rec = project.mbr.records[0]!;
const ACTOR = { name: "Test (fictional)", at: "2026-10-27T09:00:00.000Z" };

/** All text of a document model, tables included, as one string. */
function textOf(doc: DocModel): string {
  const out: string[] = [];
  const walk = (b: Block) => {
    const any = b as unknown as { text?: string; items?: unknown[]; columns?: string[]; rows?: string[][]; caption?: string };
    if (any.text) out.push(any.text);
    if (any.caption) out.push(any.caption);
    if (any.columns) out.push(...any.columns);
    if (any.rows) for (const r of any.rows) out.push(...r);
    const runs = (b as unknown as { runs?: { text: string }[]; items?: unknown }).runs;
    if (runs) out.push(runs.map((r) => r.text).join(""));
    if (any.items) for (const i of any.items) out.push(typeof i === "string" ? i : Array.isArray(i) ? (i as { text: string }[]).map((r) => r.text).join("") : JSON.stringify(i));
  };
  for (const s of doc.sections) {
    out.push(s.title);
    s.blocks.forEach(walk);
  }
  return out.join("\n");
}
const build = (variant: "standard" | "evidence" = "standard") => buildTrdDocument(project, trd, { variant, generatedAt: "2026-10-27T09:00:00.000Z", content });

describe("TRD: classification table and data map (T2)", () => {
  it("is generated from the parameters and reads Not established where nothing was entered", () => {
    const text = textOf(build());
    expect(text).toContain("Parameter classification and data map");
    expect(text).toContain("Quality attribute protected");
    expect(text).toContain("Operator instruction in the batch record");
    expect(text).toContain("Protein quality (aggregates)");
    // A parameter without an entry is listed, and its cells say so; nothing is filled in.
    expect(text).toContain("Not established");
  });

  it("is also a section of the evidence record, and an export can leave it out", () => {
    expect(build("evidence").sections.some((s) => s.id === "classification")).toBe(true);
    const omitted = buildTrdDocument(project, trd, { variant: "standard", generatedAt: "2026-10-27T09:00:00.000Z", content, omit: ["classification"] });
    expect(textOf(omitted)).not.toContain("Quality attribute protected");
  });

  it("is not printed for a TRD where no parameter has an entry", () => {
    const copy = structuredClone(project);
    for (const s of copy.trd.documents[0]!.steps) for (const i of s.items) delete i.control;
    expect(textOf(buildTrdDocument(copy, copy.trd.documents[0]!, { variant: "standard", generatedAt: "2026-10-27T09:00:00.000Z", content }))).not.toContain("Quality attribute protected");
  });

  it("setControl trims, removes an emptied entry, logs the change and refuses a non-parameter", () => {
    const step = trd.steps.find((s) => s.key === "sterile_filtration")!;
    const ref = { part: "item" as const, stepId: step.id, collection: "param" as const, key: "differential_pressure" };
    const a = setControl(project, trd.id, ref, { cqa: "  Sterility  ", controlledBy: "automated_control" }, ACTOR);
    const item = a.trd.documents[0]!.steps.find((s) => s.key === "sterile_filtration")!.items.find((i) => i.key === "differential_pressure")!;
    expect(item.control).toEqual({ cqa: "Sterility", controlledBy: "automated_control" });
    expect(a.changeLog.at(-1)!.action).toBe("trd_control_update");
    // No change: the same project comes back and nothing is logged.
    expect(setControl(a, trd.id, ref, { cqa: "Sterility", controlledBy: "automated_control" }, ACTOR)).toBe(a);
    const cleared = setControl(a, trd.id, ref, {}, ACTOR);
    expect(cleared.trd.documents[0]!.steps.find((s) => s.key === "sterile_filtration")!.items.find((i) => i.key === "differential_pressure")!.control).toBeUndefined();
    const equip = step.items.find((i) => i.collection !== "param")!;
    expect(() => setControl(project, trd.id, { ...ref, collection: equip.collection, key: equip.key }, { cqa: "x" }, ACTOR)).toThrow(/parameters/);
  });
});

describe("TRD wording from the technical reports (T1, T3, T4a, T4b, T5)", () => {
  const text = textOf(build());

  it("states the filtration limits of the sterilizing and the bioburden-reduction filtration, with serial filters as one unit (T1)", () => {
    for (const label of ["Filter type and membrane", "Pore size", "Effective filtration area", "Scale at which the flux was proven", "Maximum filtration time", "Maximum differential pressure", "Temperature range", "Flush or priming volume", "Reference to the bacterial-retention validation"]) {
      expect(text, label).toContain(label);
    }
    expect(text).toContain("counted as one sterilizing unit");
    expect(text).toContain("every filter of the unit is integrity tested after use");
  });

  it("leaves the filtration limits blank in the library until the team fills them (no defaults)", () => {
    const lib = trdWriteups.find((w) => w.id === "wu_sterile_filtration")!;
    const table = lib.parts.find((p) => p.id === "filtration_limits")!;
    expect(table.optional).toBeDefined();
    expect((table.rows ?? []).every((r) => /^\{\{trd\.sterile_filtration\./.test(r[1]!))).toBe(true);
  });

  it("defines the alert, action and specification levels (T3)", () => {
    expect(text).toContain("An alert limit is a limit that triggers a defined follow-up in the site procedure; it is not an investigation.");
    expect(text).toContain("An action limit is a limit that triggers an investigation.");
    expect(text).toContain("A specification is a binding limit");
  });

  it("says the bioburden figure is the load on the final sterilizing filter, not a general bulk limit (T4a)", () => {
    expect(text).toContain("limit on the load that reaches the final sterilizing filter");
    expect(text).toContain("not a general limit for the bulk");
  });

  it("does not let the media fill qualify the holds alone (T4b)", () => {
    expect(text).toContain("A media fill (aseptic process simulation) does not on its own qualify a hold");
    expect(text).toContain("periodically includes material that was held for the maximum qualified time");
    expect(text).not.toMatch(/media fill[^.]*covers the longest hold/i);
    const ppq = textOf(buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: "2026-10-27T09:00:00.000Z" }));
    expect(ppq).not.toMatch(/media fill[^.]*(which )?also covers the longest hold/i);
    expect(ppq).toContain("The holds are not qualified by the media fill");
  });

  it("has the optional sections Tacit knowledge and Process history (T5)", () => {
    expect(text).toContain("Tacit knowledge");
    expect(text).toContain("Process history");
    expect(trdWriteups.find((w) => w.id === "sec_tacit_knowledge")!.autoAdd).toBe(false);
    expect(trdWriteups.find((w) => w.id === "sec_process_history")!.autoAdd).toBe(false);
  });
});

describe("PPQ plan: design, readiness, statistics, after PPQ (P1 to P4)", () => {
  const doc = buildSamplingPlanDocument(content, project, plan, samplingSuggestions, { generatedAt: "2026-10-27T09:00:00.000Z" });
  const text = textOf(doc);

  it("prints the number-of-lots rationale, the bracketing, rework, engineering batch and freeze rule (P1)", () => {
    expect(plan.design?.rework).toMatch(/No rework/);
    expect(plan.design?.engineeringBatch?.decision).toBe("planned");
    for (const h of ["PPQ design decisions", "Bracketing rationale", "Rework and reprocessing", "Engineering batch", "Freeze rule"]) expect(text, h).toContain(h);
    expect(text).toContain("risk to the patient");
  });

  it("prints a readiness checklist where an item with no status is unknown (P2)", () => {
    expect(text).toContain("Readiness before PPQ starts");
    for (const i of PPQ_READINESS_ITEMS) expect(text, i.label).toContain(i.label);
    expect(plan.readiness!.length).toBeLessThan(PPQ_READINESS_ITEMS.length);
    expect(text).toContain("Unknown");
  });

  it("keeps the confidence a hint: it is only printed where the team entered it, plus the AQL note (P3)", () => {
    expect(text).toContain("Statistical justification per attribute");
    expect(text).toContain("95%");
    expect(text).toContain("is not an argument that the process is capable");
    const withBasis = plan.points.filter((p) => p.statisticalBasis);
    expect(withBasis.length).toBeGreaterThan(0);
    expect(plan.points.length).toBeGreaterThan(withBasis.length);
  });

  it("flags each sample PPQ only or continuing, and closes with the statement on sampling after PPQ (P4)", () => {
    expect(text).toContain("Sampling after PPQ");
    expect(text).toContain("PPQ only");
    expect(text).toContain("Continues into routine / CPV");
    expect(text).toContain("Enhanced sampling");
  });

  it("is unchanged for a plan that never used the new fields", () => {
    const copy = structuredClone(project);
    const p = copy.sampling.plans[0]!;
    delete p.design;
    delete p.readiness;
    for (const pt of p.points) {
      delete pt.afterPpq;
      delete pt.statisticalBasis;
    }
    const plain = textOf(buildSamplingPlanDocument(content, copy, p, samplingSuggestions, { generatedAt: "2026-10-27T09:00:00.000Z" }));
    expect(plain).not.toContain("PPQ design decisions");
    expect(plain).not.toContain("Readiness before PPQ starts");
  });

  it("updatePlanDesign and setReadiness trim, log and refuse unknown items", () => {
    const a = updatePlanDesign(project, plan.id, { rework: "  None.  " }, ACTOR);
    expect(a.sampling.plans[0]!.design?.rework).toBe("None.");
    expect(updatePlanDesign(a, plan.id, { rework: "None." }, ACTOR)).toBe(a);
    const b = setReadiness(project, plan.id, "protocols", { status: "open" }, ACTOR);
    expect(b.sampling.plans[0]!.readiness!.find((e) => e.key === "protocols")!.status).toBe("open");
    const c = setReadiness(b, plan.id, "protocols", {}, ACTOR);
    expect(c.sampling.plans[0]!.readiness!.some((e) => e.key === "protocols")).toBe(false);
    expect(() => setReadiness(project, plan.id, "nonsense", { status: "open" }, ACTOR)).toThrow();
  });
});

describe("batch record: intervention log, filter records, draft mark, PPQ-only flag (M1 to M3)", () => {
  const doc = buildMbrDocument(project, rec, { generatedAt: "2026-10-27T09:00:00.000Z" });
  const text = textOf(doc);
  const blocks = rec.sections.flatMap((s) => s.blocks);

  it("has an intervention log in the filling section with the required columns and the qualified-list note (M1)", () => {
    const filling = rec.sections.find((s) => s.unitOp === "aseptic_filling")!;
    const log = filling.blocks.find((b) => b.libraryId === "intervention_log")!;
    const form = log.forms!.find((f) => f.key === "intervention_log")!;
    expect(form.columns).toEqual(["Type (inherent or corrective)", "Description", "Start time", "Duration", "Operators", "Repetitions"]);
    expect(log.forms!.some((f) => f.key === "line_stops")).toBe(true);
    expect(text).toContain("Only interventions on the qualified intervention list may be performed. Any other intervention is a deviation and is reported to the quality unit.");
  });

  it("has filter records for each filtration, serial filters as one unit, all tested after use (M2)", () => {
    const withRecords = rec.sections.filter((s) => s.blocks.some((b) => b.libraryId === "filter_records")).map((s) => s.unitOp);
    expect(withRecords).toEqual(["bbr_filtration", "sterile_filtration"]);
    const form = blocks.find((b) => b.libraryId === "filter_records")!.forms![0]!;
    for (const c of ["Filter ID", "Filter lot", "Pre-use test value", "Limit", "Pass or fail", "Post-use test value", "Post-use pass or fail"]) expect(form.columns, c).toContain(c);
    expect(text).toContain("are one sterilizing unit");
    expect(text).toContain("Do not discard a filter before its post-use test is recorded");
  });

  it("prints empty rows for the operators, and fills nothing in", () => {
    const form = blocks.find((b) => b.libraryId === "intervention_log")!.forms![0]!;
    const table = doc.sections.flatMap((s) => s.blocks).find((b) => b.type === "table" && (b as { caption?: string }).caption === form.title) as unknown as { rows: string[][] };
    expect(table.rows).toHaveLength(form.blankRows);
    expect(table.rows.every((r) => r.every((c) => c === ""))).toBe(true);
  });

  it("is marked as a draft for receiving-unit adaptation (M3)", () => {
    expect(doc.status).toBe("DRAFT FOR RECEIVING-UNIT ADAPTATION");
  });

  it("shows the PPQ-only flag on the sample rows, read from the plan (M3)", () => {
    const tables = doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table" && (b as { columns?: string[] }).columns?.includes("After PPQ")) as unknown as { columns: string[]; rows: string[][] }[];
    const col = tables[0]!.columns.indexOf("After PPQ");
    const cells = tables.flatMap((t) => t.rows.map((r) => r[col]));
    expect(cells).toContain("PPQ only");
    expect(cells).toContain("Continues into routine / CPV");
    // A point the plan does not flag reads Not stated.
    const copy = structuredClone(project);
    for (const pt of copy.sampling.plans[0]!.points) delete pt.afterPpq;
    const d2 = buildMbrDocument(copy, copy.mbr.records[0]!, { generatedAt: "2026-10-27T09:00:00.000Z" });
    const t2 = d2.sections.flatMap((s) => s.blocks).filter((b) => b.type === "table" && (b as { columns?: string[] }).columns?.includes("After PPQ")) as unknown as { rows: string[][] }[];
    expect(t2.flatMap((t) => t.rows).every((r) => r[col] === "Not stated")).toBe(true);
  });
});
