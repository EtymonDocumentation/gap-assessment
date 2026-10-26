import { blockLibraryStatus, buildDemoProject, buildMbrDocument, mbrOpenItems, NOTE_TIGHTER, numberSteps, paramNote, renderStepText, stepRefsIn, targetSum, trdNotices, trdRequirementsWithoutStep } from "@gap/engine";
import { mbrChoiceText } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

// The SYR-305 demo master batch record (MBR), built from its approved TRD. The TRD numbers are final, so these tests read them from the
// TRD record and check the MBR agrees; none of them is typed a second time here except where the test states the TRD's own figure.
const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const doc = project.trd.documents[0]!;
const rec = project.mbr.records[0]!;
const blocks = rec.sections.flatMap((s) => s.blocks);
const rows = blocks.flatMap((b) => b.params);
const limits = blocks.flatMap((b) => b.timeLimits);

/** The established TRD figure of a time-limit item, by unit operation and TRD item. */
const trdMax = (uo: string, item: string) => {
  const it = doc.steps.find((s) => s.key === uo)!.items.find((i) => i.key === item)!;
  return it.limits?.setPoint && "value" in it.limits.setPoint ? it.limits.setPoint.value : NaN;
};
const limitOf = (uo: string, key: string) => rec.sections.find((s) => s.unitOp === uo)!.blocks.flatMap((b) => b.timeLimits).find((t) => t.key === key)!;

describe("SYR-305 demo batch record", () => {
  it("is built from the TRD record and linked to the PPQ sampling plan", () => {
    expect(project.mbr.records).toHaveLength(1);
    expect(rec.id).toBe("MBR-001");
    expect(rec.docRef).toBe("DEMO-MBR-305-01");
    expect(rec.trdId).toBe(doc.id);
    expect(rec.planId).toBe("SPL-001");
    // The sample tables list the PPQ points of the sections they belong to; thaw, buffer, sterile filtration, inspection and packing pull none.
    const bySection = (uo: string) => rec.sections.find((s) => s.unitOp === uo)!.blocks.flatMap((b) => b.samples);
    expect(bySection("compounding").map((x) => x.pointId)).toEqual(["SP-001", "SP-002", "SP-003", "SP-004", "SP-005", "SP-006"]);
    expect(bySection("bbr_filtration").map((x) => x.pointId)).toEqual(["SP-007", "SP-008", "SP-009"]);
    expect(bySection("aseptic_filling")).toHaveLength(8);
    expect(blocks.flatMap((b) => b.samples)).toHaveLength(17);
    for (const uo of ["ds_receipt_thaw", "buffer_prep", "sterile_filtration", "visual_inspection", "bulk_packaging"]) expect(bySection(uo), uo).toEqual([]);
  });

  it("is not added when the caller gives no library", () => {
    expect(buildDemoProject(content, demos["syr-305"], undefined, undefined, undefined, undefined, { writeups: trdWriteups }).mbr.records).toHaveLength(0);
  });

  it("has one section per selected unit operation, in process order, and a final review section", () => {
    const uos = rec.sections.filter((s) => s.unitOp).map((s) => s.unitOp);
    expect(uos).toEqual(doc.steps.map((s) => s.key));
    expect(rec.sections.at(-1)!.unitOp).toBeUndefined();
    // Out of scope for a prefilled syringe: no capping, no freeze drying.
    expect(uos).not.toContain("capping");
    expect(uos).not.toContain("lyophilization");
    expect(rec.sections.every((s) => s.blocks.length > 0)).toBe(true);
  });

  it("has no sterile-filtrate hold and no needle-clog block: the TRD supports neither", () => {
    expect(blocks.map((b) => b.libraryId)).not.toContain("filtered_hold");
    expect(blocks.map((b) => b.libraryId)).not.toContain("needle_clog_check");
    // The PPQ plan's own hold (filtered bulk in the single-use holding bag, before sterile filtration) is a sample hold name, not a block.
    expect(JSON.stringify(blocks.map((b) => ({ ...b, samples: [] })))).not.toMatch(/filtered bulk hold|holding vessel/i);
    // The TRD item for a filtered hold is answered "not applicable", so it is not a requirement either.
    expect(trdRequirementsWithoutStep(rec, doc, mbrLibrary).map((r) => r.itemKey)).not.toContain("max_filtered_hold");
  });

  it("uses no vial wording", () => {
    expect(JSON.stringify(rec)).not.toMatch(/\bvials?\b|crimp|capping|lyophili/i);
  });

  it("has mostly 'same as TRD', one tightened with a reason, one study point and several 'not decided'", () => {
    const same = rows.filter((r) => r.choice === "same_as_trd");
    const tightened = rows.filter((r) => r.choice === "tightened_by_cmo");
    expect(same.length).toBeGreaterThan(tightened.length * 10);
    expect(tightened).toHaveLength(1);
    expect(tightened[0]!.key).toBe("stopper_position_range");
    expect(tightened[0]!.reason).toBeTruthy();
    expect(paramNote(tightened[0]!)).toBe(NOTE_TIGHTER);
    const undecided = rows.filter((r) => !r.choice && !r.studyPoint);
    expect(undecided.length).toBeGreaterThanOrEqual(5);
    const study = rows.filter((r) => r.studyPoint);
    expect(study).toHaveLength(1);
    expect(study[0]!.reason).toBeTruthy();
    // A study point beyond the TRD range is a challenge, not a limit, so it gets no note.
    expect(paramNote(study[0]!)).toBeUndefined();
  });

  it("holds the TRD figures: 12 h out of refrigeration = filling 6 + inspection 3 + bulk packing 1 + labelling 2", () => {
    const total = limitOf("storage_shipping", "total_out_of_refrigeration");
    expect(total.value).toBe("12");
    expect(total.unit).toBe("h");
    expect(total.trd?.status).toBe("established");
    expect(trdMax("storage_shipping", "max_total_time_out_of_refrigeration")).toBe(12);
    const stages = [
      trdMax("aseptic_filling", "max_fill_duration"),
      trdMax("visual_inspection", "max_time_out_of_refrigeration"),
      trdMax("bulk_packaging", "max_time_out_of_refrigeration"),
      trdMax("labeling_packaging", "max_time_out_of_refrigeration"),
    ];
    expect(stages).toEqual([6, 3, 1, 2]);
    expect(total.targets.map((t) => Number(t.value))).toEqual(stages);
    expect(targetSum(total).sum).toBe(12);
    // The stage rows of the sections show the same figures as the TRD. The filling row is the 8 h the media fill supports (the TRD proven
    // acceptable range); the 6 h stage target above is its budget inside the 12 h total, which stays the binding limit.
    expect(limitOf("aseptic_filling", "fill_duration").value).toBe("8");
    expect(limitOf("visual_inspection", "out_of_refrigeration").value).toBe("3");
    expect(limitOf("bulk_packaging", "out_of_refrigeration").value).toBe("1");
    expect(limitOf("labeling_packaging", "out_of_refrigeration").value).toBe("2");
  });

  it("has exactly one time limit with targets, each tied to a step range inside one section, in process order", () => {
    const withTargets = limits.filter((t) => t.targets.length > 0);
    expect(withTargets).toHaveLength(1);
    const nums = numberSteps(rec);
    const sectionOfStep = (id: string) => Number(nums.get(id)!.split(".")[0]);
    const targets = withTargets[0]!.targets;
    expect(targets.every((t) => t.fromStepId && t.toStepId)).toBe(true);
    const starts = targets.map((t) => sectionOfStep(t.fromStepId!));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
    for (const t of targets) expect(sectionOfStep(t.fromStepId!)).toBe(sectionOfStep(t.toStepId!));
  });

  it("records the time out before the packing step and the time back as the last step, in bulk packaging and labelling", () => {
    const texts = (uo: string) => rec.sections.find((s) => s.unitOp === uo)!.blocks.flatMap((b) => b.steps.map((s) => s.text));
    for (const [uo, packing] of [["bulk_packaging", /^Pack the accepted units/], ["labeling_packaging", /^Run the label and print checks/]] as const) {
      const steps = texts(uo);
      const out = steps.findIndex((t) => /leaves? refrigerated storage/.test(t) && t.includes("{out time}"));
      const work = steps.findIndex((t) => packing.test(t));
      expect(out, uo).toBeGreaterThanOrEqual(0);
      expect(out, uo).toBeLessThan(work);
      const back = steps.findIndex((t) => /returns? to refrigerated storage/.test(t) && t.includes("{return time}"));
      expect(back, uo).toBeGreaterThan(work);
      // The block's own last step; reconciliation of units (a separate block) follows it in the bulk packaging section.
      const own = rec.sections.find((s) => s.unitOp === uo)!.blocks.find((b) => b.libraryId === (uo === "bulk_packaging" ? "bulk_packing" : "labeling_run"))!;
      expect(own.steps.at(-1)!.text).toContain("{return time}");
      expect(own.cmoFields).toContain("Times out of and back in refrigerated storage");
    }
  });

  it("points each stage target at the stage's out-time step and return-time step", () => {
    const nums = numberSteps(rec);
    const textOf = (id: string) => blocks.flatMap((b) => b.steps).find((s) => s.id === id)!.text;
    const targets = limitOf("storage_shipping", "total_out_of_refrigeration").targets;
    const byLabel = (l: string) => targets.find((t) => t.label === l)!;
    for (const l of ["Visual inspection", "Bulk packaging", "Labelling and packaging"]) {
      expect(textOf(byLabel(l).fromStepId!), l).toMatch(/leaves? refrigerated storage/);
      expect(textOf(byLabel(l).toStepId!), l).toMatch(/returns? to refrigerated storage/);
    }
    // Filling has no out/return pair (the units are in the isolator): its range is the start to the end of filling.
    expect(textOf(byLabel("Filling").fromStepId!)).toMatch(/^Start the filling/);
    expect(textOf(byLabel("Filling").toStepId!)).toMatch(/^Record the end of filling/);
    expect([byLabel("Visual inspection"), byLabel("Bulk packaging"), byLabel("Labelling and packaging")].map((t) => `${nums.get(t.fromStepId!)}-${nums.get(t.toStepId!)}`)).toEqual(["8.2-8.6", "9.2-9.6", "10.3-10.6"]);
  });

  it("refers from sterile filtration to the integrity test steps by an automatic reference", () => {
    const nums = numberSteps(rec);
    const run = blocks.find((b) => b.libraryId === "sterile_filtration_run")!;
    const integrity = blocks.find((b) => b.libraryId === "filter_integrity_test")!;
    const pre = run.steps[1]!;
    expect(stepRefsIn(pre.text)).toEqual([integrity.steps[1]!.id]);
    expect(pre.text).not.toMatch(/filter integrity block/);
    expect(renderStepText(pre.text, nums)).toMatch(/^Run the filter integrity test \(Step 6\.\d+\) before use/);
    expect(stepRefsIn(run.steps[3]!.text)).toEqual([integrity.steps[2]!.id]);
    // No step number is typed into the text: the stored text holds ids only.
    expect(pre.text).not.toMatch(/Step d/);
  });

  it("reads a study point as 'Study point (not a limit)' in the Choice column and does not count it as not decided", () => {
    const study = rows.find((r) => r.studyPoint)!;
    expect(mbrChoiceText(study)).toBe("Study point (not a limit)");
    expect(mbrChoiceText({})).toBe("Not decided");
    const model = JSON.stringify(buildMbrDocument(project, rec, { generatedAt: "2026-10-25T09:00:00.000Z" }));
    expect(model).toContain("Study point (not a limit)");
    expect(model).not.toContain("Not decided; study point");
    expect(model).not.toMatch(/; study point/);
    expect(mbrOpenItems(project, rec, mbrLibrary).filter((o) => o.kind === "not_decided").every((o) => o.rowId !== study.id)).toBe(true);
  });

  it("counts the total time out of refrigeration from the start of filling, in the question bank and in the batch record", () => {
    const q = content.questions.find((x) => x.id === "ss.total_tor")!;
    expect(q.prompt).toContain("from the start of filling until the product is back in refrigerated storage");
    expect(JSON.stringify(q)).not.toMatch(/end of thaw/);
    const block = mbrLibrary.find((b) => b.id === "time_out_of_refrigeration_total")!;
    expect(block.steps[0]).toContain("from the start of filling of that portion until its units are back in refrigerated storage");
    expect(block.steps[0]).toContain("tracked for each portion of the batch separately");
    expect(block.cmoFields[0]).toBe("Portion IDs");
    const total = rec.sections.find((s) => s.unitOp === "storage_shipping")!.blocks.find((b) => b.libraryId === "time_out_of_refrigeration_total")!;
    expect(total.steps[0]!.text).toContain("start of filling");
    // The batch record document carries the same words.
    expect(JSON.stringify(buildMbrDocument(project, rec, { generatedAt: "2026-10-25T09:00:00.000Z" }))).toContain("from the start of filling of that portion until its units are back in refrigerated storage");
  });

  it("keeps the other approved figures", () => {
    expect(limitOf("ds_receipt_thaw", "cold_hold").value).toBe("24");
    expect(limitOf("bbr_filtration", "cold_hold").value).toBe("24");
    // 100 % in-line fill check, PUPSIT used, interventions counted per batch.
    expect(rows.find((r) => r.key === "fill_check")!.trd?.text).toMatch(/100 % in-line/);
    expect(rows.find((r) => r.key === "pupsit")!.trd?.text).toBe("Performed");
    expect(rows.find((r) => r.key === "max_interventions")!.label).toBe("Interventions per batch");
    expect(rows.find((r) => r.key === "max_interventions")!.trd?.text).toBe("12");
  });

  it("shows one TRD requirement without a step, and the not-decided rows, as open items", () => {
    const missing = trdRequirementsWithoutStep(rec, doc, mbrLibrary);
    expect(missing).toHaveLength(1);
    expect(`${missing[0]!.unitOp}.${missing[0]!.itemKey}`).toBe("compounding.panel");
    const open = mbrOpenItems(project, rec, mbrLibrary);
    expect(open.filter((o) => o.kind === "no_step")).toHaveLength(1);
    expect(open.filter((o) => o.kind === "not_decided").length).toBeGreaterThanOrEqual(5);
    expect(trdNotices(project, rec)).toHaveLength(0);
  });

  it("uses current library blocks, and a record made from an earlier version is offered the update", () => {
    for (const b of blocks) expect(blockLibraryStatus(b, mbrLibrary).kind, b.libraryId).not.toBe("newer");
    // A block whose text changed is a new version that keeps version 1 in full; a record made from version 1 reads it unchanged and is offered the update.
    const sterile = mbrLibrary.find((b) => b.id === "sterile_filtration_run")!;
    expect(sterile.version).toBe(2);
    expect(blockLibraryStatus({ libraryId: sterile.id, libraryVersion: 1 }, mbrLibrary).kind).toBe("newer");
    expect(sterile.history![0]!.steps.join(" ")).toContain("sterile holding vessel");
    expect(sterile.steps.join(" ")).not.toContain("holding vessel");
  });

  it("leaves the ARX-217 batch record building as before", () => {
    const arx = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });
    expect(arx.mbr.records).toHaveLength(1);
    expect(arx.mbr.records[0]!.sections.flatMap((s) => s.blocks).map((b) => b.libraryId)).toContain("filtered_hold");
    // Building the vial demo with its sampling plan is slow under a full parallel run, so this test gets a longer limit than the 5 s default.
  }, 60000);

  it("is fictional and carries no client code or forbidden word", () => {
    const text = JSON.stringify(rec) + JSON.stringify(demos["syr-305"]);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    expect(JSON.stringify(rec)).not.toMatch(/\b(must|violation|non-compliant)\b/i);
  });
});
