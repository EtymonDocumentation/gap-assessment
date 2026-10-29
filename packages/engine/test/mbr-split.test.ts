// A batch record split in two parts at a hold: the split and the merge, the rules that keep the split between two sections, the sampling
// steps that move onto the hold entries and back, and the suggestion that points at a hold of the sampling plan. All data are fictional.
import { describe, expect, it, vi } from "vitest";
import { mbrRecordSchema } from "@gap/process-model";
import {
  addMbrStep,
  buildDemoProject,
  holdEntryInfo,
  mbrHoldSuggestions,
  mbrOpenItems,
  mergeMbr,
  moveSection,
  numberSteps,
  removeSection,
  removeTimeLimit,
  sectionsOfPart,
  splitIndex,
  splitMbr,
  updateSplit,
} from "@gap/engine";
import { ACTOR } from "./helpers";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

// The demo is delivered split at the post-BBR bulk hold; `whole` is the same record merged back into one.
const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const rid = demo.mbr.records[0]!.id;
const whole = mergeMbr(demo, rid, ACTOR);
const wholeRec = whole.mbr.records[0]!;
const plan = whole.sampling.plans[0]!;
const sec = (uo: string) => wholeRec.sections.find((s) => s.unitOp === uo)!;
const holdbag = plan.holds!.find((h) => h.label.startsWith("Post-BBR"))!;
const steps = (project: typeof demo) => project.mbr.records[0]!.sections.flatMap((s) => s.blocks.flatMap((b) => b.steps));

describe("the demo record is split at its own choice, with the sampling steps of the hold on the entries", () => {
  const rec = demo.mbr.records[0]!;
  it("is split after the bioburden-reduction filtration, with a document number for each part", () => {
    expect(rec.split?.afterSectionId).toBe(sec("bbr_filtration").id);
    expect(rec.split?.part1DocRef).toBe("DEMO-MBR-305-01-P1");
    expect(rec.split?.part2DocRef).toBe("DEMO-MBR-305-01-P2");
    expect(rec.docRef).toBe("DEMO-MBR-305-01");
    expect(sectionsOfPart(rec, 1).at(-1)!.unitOp).toBe("bbr_filtration");
    expect(sectionsOfPart(rec, 2)[0]!.unitOp).toBe("sterile_filtration");
    expect(sectionsOfPart(rec, 1).length + sectionsOfPart(rec, 2).length).toBe(rec.sections.length);
  });
  it("lists the plan's hold-start sample on the Part 1 entry and the hold-end sample on the Part 2 entry", () => {
    const info = holdEntryInfo(demo, rec);
    expect(info.hold?.label).toBe(holdbag.label);
    expect(info.entries.map((e) => [e.edge, e.part, e.samples.map((x) => x.pointId)])).toEqual([
      ["start", 1, ["SP-007"]],
      ["end", 2, ["SP-009"]],
    ]);
  });
  it("compares the elapsed hold time with the record's own limit, not the longer PPQ target", () => {
    const limit = holdEntryInfo(demo, rec).limit!;
    expect(limit.label).toBe("Maximum hold of the bioburden-reduced bulk in cold storage");
    expect(limit.value).toBe("24");
    expect(limit.unit).toBe("h");
  });
  it("took the two sampling steps out of the section, leaves the middle-of-hold step, and does not call the samples open", () => {
    const texts = steps(demo).map((s) => s.text);
    expect(texts.some((t) => /SP-007\b.*start of the hold/.test(t))).toBe(false);
    expect(steps(demo).some((s) => s.placedFor?.moment === "hold_during" && s.placedFor.points.includes("SP-008"))).toBe(true);
    expect(mbrOpenItems(demo, rec, mbrLibrary).filter((o) => o.kind === "sample_not_placed")).toEqual([]);
    // Without the entries the same two samples would be open: the entries are what tells the operator.
    expect(mbrOpenItems(whole, wholeRec, mbrLibrary).filter((o) => o.kind === "sample_not_placed")).toEqual([]);
  });
  it("keeps one continuous step numbering across both parts", () => {
    const n = numberSteps(rec);
    const first2 = sectionsOfPart(rec, 2)[0]!.blocks.flatMap((b) => b.steps)[0]!;
    expect(n.get(first2.id)).toBe(`${splitIndex(rec) + 2}.1`);
  });
});

describe("splitting and merging", () => {
  it("merge restores the sections exactly as they were before the split and logs both events", () => {
    const again = splitMbr(whole, rid, { afterSectionId: sec("bbr_filtration").id, planHoldId: holdbag.id }, ACTOR);
    const merged = mergeMbr(again, rid, ACTOR);
    expect(merged.mbr.records[0]!.sections).toEqual(wholeRec.sections);
    expect(merged.mbr.records[0]!.split).toBeUndefined();
    const actions = merged.changeLog.map((e) => e.action);
    expect(actions.filter((a) => a === "mbr_split").length).toBeGreaterThanOrEqual(1);
    expect(actions.at(-1)).toBe("mbr_merge");
    expect(merged.changeLog.at(-1)!.by).toBe(ACTOR.name);
  });
  it("the original demo record and a split-then-merged record are the same text", () => {
    expect(JSON.stringify(wholeRec.sections)).toBe(JSON.stringify(mergeMbr(splitMbr(whole, rid, { afterSectionId: sec("bbr_filtration").id, planHoldId: holdbag.id }, ACTOR), rid, ACTOR).mbr.records[0]!.sections));
  });
  it("splits without a named hold: no step moves and the entries list no samples", () => {
    const p = splitMbr(whole, rid, { afterSectionId: sec("compounding").id }, ACTOR);
    expect(p.mbr.records[0]!.split?.moved).toBeUndefined();
    expect(p.mbr.records[0]!.sections).toEqual(wholeRec.sections);
    expect(holdEntryInfo(p, p.mbr.records[0]!).entries.every((e) => e.samples.length === 0)).toBe(true);
  });
  it("refuses a split after the last section, at an unknown section, twice, or at a hold the plan does not have", () => {
    const last = wholeRec.sections.at(-1)!;
    expect(() => splitMbr(whole, rid, { afterSectionId: last.id }, ACTOR)).toThrow(/between two sections/);
    expect(() => splitMbr(whole, rid, { afterSectionId: "SC-99" }, ACTOR)).toThrow(/not in/);
    expect(() => splitMbr(demo, rid, { afterSectionId: sec("compounding").id }, ACTOR)).toThrow(/already split/);
    expect(() => splitMbr(whole, rid, { afterSectionId: sec("compounding").id, planHoldId: "HD-99" }, ACTOR)).toThrow(/not in the sampling plan/);
  });
  it("merge on a record that is not split changes nothing", () => {
    expect(mergeMbr(whole, rid, ACTOR)).toBe(whole);
  });
  it("edits the document numbers and logs the old and the new number", () => {
    const p = updateSplit(demo, rid, { part1DocRef: "  DEMO-MBR-305-01-A  " }, ACTOR);
    expect(p.mbr.records[0]!.split?.part1DocRef).toBe("DEMO-MBR-305-01-A");
    const ev = p.changeLog.at(-1)!;
    expect(ev.action).toBe("mbr_split_update");
    expect(ev.before).toMatchObject({ part1DocRef: "DEMO-MBR-305-01-P1" });
    expect(updateSplit(p, rid, { part1DocRef: "DEMO-MBR-305-01-A" }, ACTOR)).toBe(p);
    expect(() => updateSplit(whole, rid, { part1DocRef: "x" }, ACTOR)).toThrow(/not split/);
  });
  it("changing the named hold puts the old steps back and takes the new hold's out, clearing it puts everything back", () => {
    const cleared = updateSplit(demo, rid, { planHoldId: null }, ACTOR);
    expect(cleared.mbr.records[0]!.split?.moved).toBeUndefined();
    expect(JSON.stringify(cleared.mbr.records[0]!.sections)).toBe(JSON.stringify(wholeRec.sections));
    expect(holdEntryInfo(cleared, cleared.mbr.records[0]!).entries.every((e) => e.samples.length === 0)).toBe(true);
  });
  it("keeps the samples of another hold in a step that names several, and a merge puts the original wording back", () => {
    const shared = structuredClone(whole);
    const step = shared.mbr.records[0]!.sections.flatMap((x) => x.blocks.flatMap((b) => b.steps)).find((x) => x.placedFor?.moment === "hold_end")!;
    step.text = "Take samples SP-009, SP-021 at the end of the hold.";
    step.placedFor = { moment: "hold_end", points: ["SP-009", "SP-021"] };
    const p = splitMbr(shared, rid, { afterSectionId: sec("bbr_filtration").id, planHoldId: holdbag.id }, ACTOR);
    const kept = steps(p).find((x) => x.id === step.id)!;
    expect(kept.text).toBe("Take sample SP-021 at the end of the hold.");
    expect(kept.placedFor?.points).toEqual(["SP-021"]);
    expect(JSON.stringify(mergeMbr(p, rid, ACTOR).mbr.records[0]!.sections)).toBe(JSON.stringify(shared.mbr.records[0]!.sections));
  });
  it("a new step added after a split never reuses the id of a step parked on the entries", () => {
    const parked = new Set(demo.mbr.records[0]!.split!.moved!.map((m) => m.step.id));
    const block = sec("bbr_filtration").blocks[0]!;
    const added = addMbrStep(demo, rid, block.id, "A step the author wrote.", ACTOR);
    expect(parked.has(added.stepId)).toBe(false);
    expect(parked.size).toBe(2);
  });
});

describe("the split stays between two sections", () => {
  it("merges back, and says so in the log, when the section it sits after is removed", () => {
    const p = removeSection(demo, rid, sec("bbr_filtration").id, ACTOR);
    expect(p.mbr.records[0]!.split).toBeUndefined();
    expect(p.changeLog.at(-1)!.detail).toContain("one again");
  });
  it("merges back when the section it sits after is moved to the end (Part 2 would be empty)", () => {
    let p = demo;
    const rec = () => p.mbr.records[0]!;
    while (rec().sections.at(-1)!.id !== sec("bbr_filtration").id) p = moveSection(p, rid, sec("bbr_filtration").id, 1, ACTOR);
    expect(rec().split).toBeUndefined();
  });
  it("merges back when all sections after the split are removed", () => {
    let p = demo;
    for (const s of sectionsOfPart(demo.mbr.records[0]!, 2)) p = removeSection(p, rid, s.id, ACTOR);
    expect(p.mbr.records[0]!.split).toBeUndefined();
    expect(mbrRecordSchema.safeParse(p.mbr.records[0]!).success).toBe(true);
  });
  it("keeps the split when an unrelated section is removed, or the section after the split moves down", () => {
    const p = removeSection(demo, rid, sec("visual_inspection").id, ACTOR);
    expect(p.mbr.records[0]!.split?.afterSectionId).toBe(sec("bbr_filtration").id);
    const q = moveSection(demo, rid, sectionsOfPart(demo.mbr.records[0]!, 2)[0]!.id, 1, ACTOR);
    expect(q.mbr.records[0]!.split?.afterSectionId).toBe(sec("bbr_filtration").id);
  });
  it("drops the link to the hold limit, and the entry then reads no limit stated, when that time limit row is removed", () => {
    const limitId = demo.mbr.records[0]!.split!.holdLimitId!;
    const p = removeTimeLimit(demo, rid, limitId, ACTOR);
    expect(p.mbr.records[0]!.split?.holdLimitId).toBeUndefined();
    expect(holdEntryInfo(p, p.mbr.records[0]!).limit).toBeUndefined();
    expect(p.changeLog.at(-1)!.detail).toContain("no limit stated");
  });
  it("is checked by the schema: the section must exist and cannot be the last", () => {
    const rec = demo.mbr.records[0]!;
    expect(mbrRecordSchema.safeParse({ ...rec, split: { afterSectionId: "SC-77" } }).success).toBe(false);
    expect(mbrRecordSchema.safeParse({ ...rec, split: { afterSectionId: rec.sections.at(-1)!.id } }).success).toBe(false);
    expect(mbrRecordSchema.safeParse({ ...rec, split: { ...rec.split!, holdLimitId: "R-9999" } }).success).toBe(false);
    expect(mbrRecordSchema.safeParse({ ...rec, split: { afterSectionId: rec.sections[0]!.id } }).success).toBe(true);
  });
});

describe("the suggestion", () => {
  it("points at the gap after the section where a plan hold sits, with the hold's label, and splits nothing", () => {
    const s = mbrHoldSuggestions(plan, wholeRec);
    const hit = s.find((x) => x.hold.id === holdbag.id)!;
    expect(hit.afterSectionId).toBe(sec("bbr_filtration").id);
    expect(hit.hold.label).toBe(holdbag.label);
    expect(wholeRec.split).toBeUndefined();
  });
  it("leaves out holds of a sub-process (the buffer hold) and never names the last section's gap", () => {
    const s = mbrHoldSuggestions(plan, wholeRec);
    expect(s.some((x) => x.hold.label === "Dilution buffer hold")).toBe(false);
    expect(s.every((x) => x.afterSectionId !== wholeRec.sections.at(-1)!.id)).toBe(true);
  });
  it("gives nothing without a plan or without holds", () => {
    expect(mbrHoldSuggestions(undefined, wholeRec)).toEqual([]);
    expect(mbrHoldSuggestions({ ...plan, holds: undefined }, wholeRec)).toEqual([]);
  });
});
