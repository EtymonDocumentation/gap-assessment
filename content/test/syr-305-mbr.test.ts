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
    // The sample tables list the PPQ points of the sections they belong to; sterile filtration, inspection and packing pull none.
    const bySection = (uo: string) => rec.sections.find((s) => s.unitOp === uo)!.blocks.flatMap((b) => b.samples);
    expect(bySection("compounding").map((x) => x.pointId)).toEqual(["SP-001", "SP-002", "SP-003", "SP-004", "SP-005", "SP-006", "SP-021"]);
    expect(bySection("ds_receipt_thaw").map((x) => x.pointId)).toEqual(["SP-018", "SP-019"]);
    expect(bySection("buffer_prep").map((x) => x.pointId)).toEqual(["SP-020"]);
    expect(bySection("bbr_filtration").map((x) => x.pointId)).toEqual(["SP-007", "SP-008", "SP-009"]);
    expect(bySection("aseptic_filling")).toHaveLength(8);
    expect(blocks.flatMap((b) => b.samples)).toHaveLength(21);
    for (const uo of ["sterile_filtration", "visual_inspection", "bulk_packaging"]) expect(bySection(uo), uo).toEqual([]);
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
    expect(JSON.stringify(blocks.map((b) => ({ ...b, samples: [] })))).not.toMatch(/filtered bulk hold|sterile bulk vessel|sterile holding vessel/i);
    // Sterile filtration runs in line with filling into a small surge bag at the filler: there is no vessel between filter and filler.
    expect(blocks.map((b) => b.libraryId)).toContain("sterile_filtration_inline");
    // The TRD item for a filtered hold is answered "not applicable", so it is not a requirement either.
    expect(trdRequirementsWithoutStep(rec, doc, mbrLibrary).map((r) => r.itemKey)).not.toContain("max_filtered_hold");
  });

  it("uses no vial wording", () => {
    expect(JSON.stringify(rec)).not.toMatch(/\bvials?\b|crimp|capping|lyophili/i);
  });

  it("has mostly 'same as TRD', one tightened with a reason, study points for the PPQ challenges and none 'not decided'", () => {
    const same = rows.filter((r) => r.choice === "same_as_trd");
    const tightened = rows.filter((r) => r.choice === "tightened_by_cmo");
    expect(same.length).toBeGreaterThan(tightened.length * 10);
    expect(tightened).toHaveLength(1);
    expect(tightened[0]!.key).toBe("stopper_position_range");
    expect(tightened[0]!.reason).toBeTruthy();
    expect(paramNote(tightened[0]!)).toBe(NOTE_TIGHTER);
    const undecided = rows.filter((r) => !r.choice && !r.studyPoint);
    // The ranges the TRD holds are adopted; a row would stay undecided only where the TRD holds no value for it, and there is none in this demo.
    expect(undecided).toHaveLength(0);
    const study = rows.filter((r) => r.studyPoint);
    // The inspection rate challenge plus the 12 PPQ challenges beyond the limits of the record (holds, batch sizes, speed, line stop).
    expect(study).toHaveLength(13);
    for (const s of study) {
      expect(s.reason, s.label).toBeTruthy();
      expect(s.mbrValue, s.label).toBeTruthy();
      // A study point beyond the TRD range is a challenge, not a limit, so it gets no note.
      expect(paramNote(s), s.label).toBeUndefined();
    }
    expect(study.map((s) => s.label)).toContain("Study point: planned line stop (all PPQ batches)");
    expect(study.map((s) => s.label)).toContain("Study point: filling line speed (PPQ 2)");
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
    for (const l of ["Visual inspection (per portion)", "Bulk packaging (per portion)", "Labelling and packaging (per portion)"]) {
      expect(textOf(byLabel(l).fromStepId!), l).toMatch(/leaves? refrigerated storage/);
      expect(textOf(byLabel(l).toStepId!), l).toMatch(/returns? to refrigerated storage/);
    }
    // Filling has no out/return pair (the units are in the isolator): its range is the start of filling to the step that puts the filled
    // portion into refrigerated storage.
    expect(textOf(byLabel("Filling (per portion)").fromStepId!)).toMatch(/^Start the filling/);
    expect(textOf(byLabel("Filling (per portion)").toStepId!)).toMatch(/^Repeat this step for every portion in turn.*put them into refrigerated storage \(2 to 8 °C\) at once/);
    expect([byLabel("Visual inspection (per portion)"), byLabel("Bulk packaging (per portion)"), byLabel("Labelling and packaging (per portion)")].map((t) => `${nums.get(t.fromStepId!)}-${nums.get(t.toStepId!)}`)).toEqual(["8.2-8.6", "9.2-9.6", "10.3-10.6"]);
  });

  it("filters in line with filling into a surge bag: the end of the filtration and the integrity test after use come after the end of filling", () => {
    const nums = numberSteps(rec);
    const num = (id: string) => nums.get(id)!.split(".").map(Number);
    const inline = blocks.find((b) => b.libraryId === "sterile_filtration_inline")!;
    const end = blocks.find((b) => b.libraryId === "sterile_filtration_inline_end")!;
    const filling = blocks.find((b) => b.libraryId === "filling_run")!;
    expect(inline.steps.map((s) => s.text).join(" ")).toContain("surge bag");
    // Wetting, the integrity test before use and the bioburden sample come before the filtration starts, in that order.
    expect(inline.steps.map((s) => s.text.slice(0, 20))).toEqual(["Assemble the sterili", "Wet the filter as de", "The bioburden sample"]);
    // The start of the filtration is its own block in the filling section: the bioburden sample (SP-009, the end sample of the holding-bag
    // hold) is taken first, the holding bag leaves cold storage only then, and the filtration starts last. The holding bag is never out
    // of cold storage while the line is still being set up.
    const start = blocks.find((b) => b.libraryId === "sterile_filtration_inline_start")!;
    expect(start.steps.map((s) => s.text.slice(0, 24))).toEqual(["Take sample SP-009, the ", "Take the holding bag out", "Start the filtration int"]);
    const order = blocks.map((b) => b.libraryId);
    expect(order.indexOf("stopper_placement_setup")).toBeLessThan(order.indexOf("sterile_filtration_inline_start"));
    expect(order.indexOf("sterile_filtration_inline_start")).toBeLessThan(order.indexOf("filling_run"));
    // The end of the filtration is recorded in the filling section, after the end of filling, with the filtration time against the limit.
    const endOfFilling = filling.steps.find((s) => s.text.startsWith("Record the end of filling"))!;
    expect(num(end.steps[0]!.id)[0]).toBe(num(endOfFilling.id)[0]);
    expect(num(end.steps[0]!.id)[1]).toBeGreaterThan(num(endOfFilling.id)[1]!);
    expect(end.steps[0]!.text).toContain("filtration time");
    expect(end.steps[1]!.text).toMatch(/integrity test after use/);
    // The sterilizing filtration time limit covers the filling run (tied to the 8 h filling limit).
    expect(limitOf("sterile_filtration", "filtration_time").value).toBe("up to 8");
    expect(limitOf("aseptic_filling", "fill_duration").value).toBe("8");
  });

  it("places every sample at its moment in the steps and names SP-014 and SP-015 in the filling record", () => {
    const fill = rec.sections.find((s) => s.unitOp === "aseptic_filling")!;
    const texts = fill.blocks.flatMap((b) => b.steps.map((s) => s.text));
    for (const id of ["SP-010", "SP-011", "SP-012", "SP-013", "SP-014", "SP-015", "SP-016", "SP-017"]) expect(texts.filter((t) => t.includes(id)).length, id).toBe(id === "SP-012" ? 2 : 1); // SP-012 is also named as the T0 of the line stop
    // SP-014 follows the line stop, which is made in every PPQ batch (a batch without the challenge would count as a 0 h hold); the routine
    // record has no planned line stop.
    expect(texts.find((t) => t.includes("SP-014"))).toContain("In every PPQ batch");
    expect(texts.find((t) => t.includes("SP-014"))).not.toMatch(/only/);
    expect(rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.samples)).find((x) => x.pointId === "SP-014")!.test).not.toMatch(/only/);
    // The mixing samples are taken during the mix, in the order T0, T1, T2, before the mixer is stopped.
    const mix = rec.sections.find((s) => s.unitOp === "compounding")!.blocks.find((b) => b.libraryId === "dilution_and_mixing")!.steps.map((s) => s.text);
    const at = (id: string) => mix.findIndex((t) => t.includes(id));
    const stop = mix.findIndex((t) => t.startsWith("Stop mixing"));
    expect(at("SP-001")).toBeLessThan(at("SP-003"));
    expect(at("SP-003")).toBeLessThan(at("SP-005"));
    expect(at("SP-005")).toBeLessThan(stop);
    expect(mbrOpenItems(project, rec, mbrLibrary).filter((o) => o.kind === "sample_not_placed")).toEqual([]);
  });

  it("takes every end-of-hold sample in the step that ends the hold (never at a fixed hour) and names a T0 for each hold", () => {
    const all = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => x.text)));
    // SP-019 thawed DS, SP-020 buffer, SP-021 formulated bulk, SP-009 holding bag, SP-017 total time out of refrigeration.
    for (const id of ["SP-009", "SP-019", "SP-020", "SP-021"]) {
      const t = all.find((x) => x.startsWith("Take") && x.includes(id))!;
      expect(t, id).toMatch(/at the end of the (cold |formulated bulk |buffer )?hold/);
      expect(t, id).toMatch(/in the step that ends/);
      expect(t, id).not.toMatch(/\bafter \d+ ?h\b|at \d+ ?h\b/);
    }
    expect(all.find((x) => x.includes("SP-018"))).toMatch(/T0 of the cold hold/);
    expect(all.find((x) => x.includes("SP-011") && x.includes("T0"))).toBeTruthy();
    expect(all.find((x) => x.includes("SP-017"))).toMatch(/end/i);
  });

  it("defines a portion and records it at every out and return step, with a step that puts each filled portion into cold storage", () => {
    const text = (id: string) => blocks.find((b) => b.libraryId === id)!.steps.map((s) => s.text).join(" ");
    // The record itself defines the portion (demo: 70 tubs of 100 syringes = 7 000 syringes); the library block leaves the sizes to fill in.
    expect(text("portion_definition")).toContain("70 tubs of 100 syringes, so 7 000 syringes");
    expect(mbrLibrary.find((x) => x.id === "portion_definition")!.steps.join(" ")).toContain("{tubs per portion}");
    for (const id of ["visual_inspection_run", "bulk_packing", "labeling_run"]) expect(text(id), id).toContain("{portion ID}");
    // Each portion goes into cold storage in the per-portion step of the filling run itself (the separate cold storage block is not used:
    // it came after the whole run and so could not give the time each portion was put into storage).
    expect(blocks.map((b) => b.libraryId)).not.toContain("portion_cold_storage");
    expect(text("filling_run")).toContain("storage unit");
    expect(text("filling_run")).toContain("{portion start}");
    expect(blocks.map((b) => b.libraryId).indexOf("portion_definition")).toBeLessThan(blocks.map((b) => b.libraryId).indexOf("filling_run"));
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

  it("has a step for every TRD requirement (the compounding in-process controls are a step), and shows the not-decided rows as open items", () => {
    const missing = trdRequirementsWithoutStep(rec, doc, mbrLibrary);
    expect(missing).toHaveLength(0);
    const open = mbrOpenItems(project, rec, mbrLibrary);
    expect(open.filter((o) => o.kind === "no_step")).toHaveLength(0);
    // Every range the TRD holds is adopted; the demo leaves no row undecided (the not-decided rows are tested with the engine, not here).
    expect(open.filter((o) => o.kind === "not_decided")).toHaveLength(0);
    expect(trdNotices(project, rec)).toHaveLength(0);
  });

  it("uses current library blocks, and a record made from an earlier version is offered the update", () => {
    for (const b of blocks) expect(blockLibraryStatus(b, mbrLibrary).kind, b.libraryId).not.toBe("newer");
    // A block whose text changed is a new version that keeps version 1 in full; a record made from version 1 reads it unchanged and is offered the update.
    const sterile = mbrLibrary.find((b) => b.id === "sterile_filtration_run")!;
    expect(sterile.version).toBe(3);
    expect(blockLibraryStatus({ libraryId: sterile.id, libraryVersion: 1 }, mbrLibrary).kind).toBe("newer");
    expect(blockLibraryStatus({ libraryId: sterile.id, libraryVersion: 2 }, mbrLibrary).kind).toBe("newer");
    expect(sterile.history!.map((h) => h.version)).toEqual([1, 2]);
    expect(sterile.history![0]!.steps.join(" ")).toContain("sterile holding vessel");
    expect(sterile.history![1]!.steps.join(" ")).toContain("sterile bulk vessel");
    expect(sterile.steps.join(" ")).not.toContain("holding vessel");
    expect(sterile.steps.join(" ")).not.toContain("bulk vessel");
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

// The operator walk-through of the demo record (29 findings). These tests keep the answers from drifting back: every hold ends in the step
// that takes its end sample, every cross-reference points at a real step, and the setup comes before the product leaves its hold.
describe("SYR-305 batch record after the operator walk-through", () => {
  const nums = numberSteps(rec);
  const steps = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => ({ ...x, section: s.unitOp, block: b.libraryId, number: nums.get(x.id)! }))));
  const rendered = (re: RegExp) => steps.filter((x) => re.test(renderStepText(x.text, nums)));
  const stepWith = (re: RegExp, section?: string) => steps.find((x) => re.test(x.text) && (!section || x.section === section))!;
  const order = (a: { number: string }, b: { number: string }) => {
    const [pa, pb] = [a.number, b.number].map((n) => n.split(".").map(Number));
    return pa![0] !== pb![0] ? pa![0]! - pb![0]! : pa![1]! - pb![1]!;
  };

  it("has no cross-reference that points at a missing step, and no leftover word 'step' before a reference", () => {
    for (const x of steps) {
      expect(renderStepText(x.text, nums), x.number).not.toMatch(/step removed|\{ref\}|\(see \)/);
      expect(renderStepText(x.text, nums), x.number).not.toMatch(/\bstep Step\b/i);
    }
    expect(steps.filter((x) => stepRefsIn(x.text).length).length).toBeGreaterThan(20);
  });

  it("starts the record with the batch identification and keeps one hold start for the formulated bulk", () => {
    expect(steps[0]!.block).toBe("batch_identification");
    expect(steps[0]!.text).toContain("{batch number}");
    expect(steps.filter((x) => x.section === "compounding" && /the start of the formulated bulk hold/.test(x.text))).toHaveLength(1);
    // The final weight and volume step is still there (an earlier override replaced it by mistake).
    expect(steps.filter((x) => x.section === "compounding" && /^Weigh the formulated bulk|final weight/i.test(x.text)).length).toBeGreaterThan(0);
  });

  it("takes the end samples of the thawed drug substance, the buffer and the formulated bulk where each hold ends", () => {
    const sp19 = stepWith(/^Take sample SP-019/, "compounding");
    const outOfCold = stepWith(/^Take the thawed containers out of cold storage/, "compounding");
    expect(order(sp19, outOfCold)).toBeLessThan(0); // sampled first, then the containers come out
    const sp20 = stepWith(/^Take sample SP-020/, "compounding");
    const bufferEnd = stepWith(/^Record the time the buffer is taken for use/, "compounding");
    const addBuffer = stepWith(/^Add the buffer/, "compounding");
    expect(order(sp20, bufferEnd)).toBeLessThan(0);
    expect(order(bufferEnd, addBuffer)).toBeLessThan(0);
    const sp21 = stepWith(/^Take sample SP-021/, "bbr_filtration");
    const bulkEnd = stepWith(/^Record the time the formulated bulk is taken from its hold/, "bbr_filtration");
    expect(order(sp21, bulkEnd)).toBeLessThan(0);
    // No end sample is left as an orphan in the buffer or receipt section.
    expect(steps.filter((x) => x.section === "buffer_prep" && /^Take sample SP-020/.test(x.text))).toHaveLength(0);
  });

  it("does not take the holding bag out of cold storage before the setup of the filling line is done, and samples SP-009 first", () => {
    const sp9 = stepWith(/^Take sample SP-009/, "aseptic_filling");
    const out = stepWith(/^Take the holding bag out of cold storage only now/, "aseptic_filling");
    const start = stepWith(/^Start the filtration into the surge bag/, "aseptic_filling");
    const setup = stepWith(/^Set the stopper placement unit/, "aseptic_filling");
    expect(order(setup, sp9)).toBeLessThan(0);
    expect(order(sp9, out)).toBeLessThan(0);
    expect(order(out, start)).toBeLessThan(0);
    // The BBR section no longer takes the bag out of cold storage; it points to the filling section.
    expect(stepWith(/^Keep the holding bag in cold storage/, "bbr_filtration").text).toContain("[[step:");
  });

  it("makes the PPQ buffer at least 57 h before the thaw, and says so where the buffer is made and where the thaw starts", () => {
    expect(stepWith(/do not start the thaw until the buffer/, "ds_receipt_thaw").text).toContain("at least 57 h");
    expect(stepWith(/^Record the buffer volume and the storage vessel/, "buffer_prep").text).toContain("at least 57 h before the thaw");
  });

  it("marks the PPQ challenges as study points where the operator reads them, never as a deviation", () => {
    for (const re of [/^Put the thawed containers into cold storage/, /^Put the holding bag with the filtrate into cold storage/, /^Take the holding bag out of cold storage only now/, /^Record the time the formulated bulk is taken from its hold/, /^Record the time the buffer is taken for use/]) {
      const t = stepWith(re).text;
      expect(t, String(re)).toMatch(/study point/);
      expect(t, String(re)).toContain("is not a deviation");
    }
    expect(stepWith(/^PPQ batches only \(study point: the filter contact time/).text).toContain("24 h");
    expect(stepWith(/^In every PPQ batch \(the 60-minute line stop is a study point/).text).toContain("60 minutes");
  });

  it("gives both buffer batch sizes in every component step and a volume balance that adds up for the three PPQ batches", () => {
    const balance = stepWith(/^Volume balance \(fictional\)/, "compounding").text;
    for (const part of ["49.70 L of 50 L", "87.10 L of 100 L", "8.945 L of 9 L"]) expect(balance).toContain(part);
    expect(46.2 + 0.5 + 3.0).toBeCloseTo(49.7, 6);
    expect(83.6 + 0.5 + 3.0).toBeCloseTo(87.1, 6);
    expect(4950 * 0.0011 + 0.5 + 3.0).toBeCloseTo(8.945, 6);
    expect(8.945).toBeLessThanOrEqual(9);
  });

  it("checks the fill by hand at a set interval per head, takes SP-014 after a purge, and keeps the PPQ hold to the shorter limit", () => {
    expect(stepWith(/^Check the fill\./).text).toContain("{syringes per head}");
    expect(stepWith(/^Check the fill\./).text).toContain("multiplied by the density of the formulated bulk");
    expect(stepWith(/^In every PPQ batch \(the 60-minute/).text).toContain("{restart purge volume}");
    expect(stepWith(/^PPQ batches only \(study point of this record\): when about 1 L/).text).toContain("[[step:");
    expect(stepWith(/^Set the stopper placement unit/).text).toContain("60 kPa below atmospheric pressure");
  });

  it("states the limits that were missing: the sampling check of 315 of 7 000 units, the reconciliation window and the storage ranges", () => {
    expect(stepWith(/^Apply the sampling check/).text).toMatch(/315 units.*7 000 units|7 000 units.*315 units/);
    expect(stepWith(/^Calculate the reconciliation/).text).toContain("99.5 % to 100.5 %");
    expect(stepWith(/^Record the location and the conditions of storage/).text).toContain("{shipping temperature range}");
    expect(stepWith(/^Calculate from the temperature record/, "storage_shipping").text).toContain("2 to 8 °C");
  });

  it("copies the post-use filter reading into the filter record instead of testing the filter again", () => {
    const fr = steps.filter((x) => x.block === "filter_records").map((x) => x.text).join(" ");
    expect(fr).toContain("Do not test the filter again for this table");
    expect(mbrLibrary.find((b) => b.id === "filter_records")!.version).toBe(2);
  });
});

// Review of the demo record by walking the fluid through it (volumes, waits, temperatures, sample tables). These tests keep the fixes in place.
describe("SYR-305 batch record after the fluid walk-through", () => {
  const nums = numberSteps(rec);
  const texts = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps.map((x) => x.text)));
  const stepWith = (re: RegExp) => texts.find((x) => re.test(x))!;

  it("records the vessel, temperature, start and end of the bulk and the filtrate that wait during the filter pause", () => {
    const pause = stepWith(/^PPQ batches only \(study point: the filter contact time/);
    expect(pause).toContain("at 2 to 8 °C from the stop time to the restart time");
    expect(pause).toContain("{unfiltered bulk temperature}");
    expect(pause).toContain("{first filtrate time}");
    // The filter contact time is defined once, the same way as the samples (start and end of the filtration).
    expect(pause).toContain("from the start of the filtration (the time of sample SP-021");
    expect(stepWith(/^Take sample SP-021/)).toContain("counted from the start of the filtration to its end");
  });

  it("states a temperature range for the filling-room waits and the line stops", () => {
    for (const re of [/^Take the holding bag out of cold storage/, /^In every PPQ batch \(the 60-minute line stop/, /^PPQ batches only \(study point of this record\): when about 1 L/]) {
      expect(stepWith(re), String(re)).toContain("15 to 25 °C");
    }
  });

  it("subtracts only the samples taken after the filtrate was weighed and compares with the downstream hold-up, with a limit", () => {
    const r = stepWith(/^Reconcile the volume of the batch/);
    expect(r).toContain("minus only the bulk samples taken after the holding bag was weighed");
    expect(r).toContain("holding bag 0.4 L + sterile filter and tubing 0.5 L + surge bag 0.3 L = 1.2 L");
    expect(r).toContain("0.20 L either side");
    expect(r).not.toContain("{reconciliation limit}");
  });

  it("says where the 12.90 L of PPQ 2 go and uses a unit-count trigger for the surge bag hold", () => {
    const balance = stepWith(/^Volume balance \(fictional\)/);
    expect(balance).toContain("PPQ 2 is the one batch that is not filled to the end of the bulk");
    expect(83.6 + 0.5 + 3.0 + 12.9).toBeCloseTo(100, 6);
    expect(stepWith(/^PPQ batches only \(study point of this record\): when about 1 L/)).toContain("when the planned units less about 900 syringes have been filled (PPQ 2");
  });

  it("keeps the formulated bulk in the compounding vessel and takes the challenge syringes from one named portion", () => {
    expect(stepWith(/^Record the time the formulated bulk is placed in hold/)).toContain("The bulk stays in the compounding vessel for the whole hold");
    expect(stepWith(/^Take sample SP-013/)).toContain("from the challenge portion, which is the last portion filled");
    expect(stepWith(/^PPQ batches only \(study point of this record\): keep the stability/)).toContain("counted from the start of filling of the challenge portion");
    expect(nums.size).toBeGreaterThan(0);
  });

  it("lists the 100 mL bioburden bottle in the sample tables of SP-021 and SP-009", () => {
    const rows = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.samples)).filter((x) => x.pointId === "SP-021" || x.pointId === "SP-009");
    expect(rows).toHaveLength(2);
    for (const x of rows) {
      expect(x.container).toContain("100 mL");
      expect(x.storage).toContain("bioburden bottle 2 to 8 °C");
    }
  });
});
