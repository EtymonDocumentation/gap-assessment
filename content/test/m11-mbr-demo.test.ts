import { describe, expect, it, vi } from "vitest";
import { buildDemoProject, mbrOpenItems, paramNote, trdNotices, trdRequirementsWithoutStep, NOTE_TIGHTER } from "@gap/engine";
import { content, demos, designLoadouts, mbrLibrary, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 60000 });

const build = () => buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, undefined, { library: mbrLibrary });

describe("M11 demo batch record", () => {
  const project = build();
  const rec = project.mbr.records[0]!;
  const rows = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.params));

  it("is built from the demo TRD and sampling plan", () => {
    expect(project.mbr.records).toHaveLength(1);
    expect(rec.id).toBe("MBR-001");
    expect(rec.trdId).toBe(project.trd.documents[0]!.id);
    expect(rec.planId).toBe(project.sampling.plans[0]!.id);
    expect(rec.sections.length).toBeGreaterThan(8);
  });

  it("is not added when the caller gives no library", () => {
    expect(buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts).mbr.records).toHaveLength(0);
  });

  it("has mostly 'same as TRD', one tightened with a reason, one study point and several 'not decided'", () => {
    const same = rows.filter((r) => r.choice === "same_as_trd");
    const tightened = rows.filter((r) => r.choice === "tightened_by_cmo");
    const undecided = rows.filter((r) => !r.choice);
    expect(same.length).toBeGreaterThan(tightened.length * 3);
    expect(tightened).toHaveLength(1);
    expect(tightened[0]!.reason).toBeTruthy();
    expect(paramNote(tightened[0]!)).toBe(NOTE_TIGHTER);
    expect(undecided.length).toBeGreaterThanOrEqual(5);
    const study = rows.filter((r) => r.studyPoint);
    expect(study).toHaveLength(1);
    // A study point beyond the TRD range gets no note: it is a challenge, not a limit.
    expect(paramNote(study[0]!)).toBeUndefined();
  });

  it("has a time limit with two targets tied to step ranges", () => {
    const limits = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.timeLimits)).filter((t) => t.targets.length > 0);
    expect(limits).toHaveLength(1);
    expect(limits[0]!.targets).toHaveLength(2);
    expect(limits[0]!.targets.every((t) => t.fromStepId && t.toStepId)).toBe(true);
  });

  it("shows a TRD requirement without a step, sample rows from the plan, and no TRD-changed notice", () => {
    const trd = project.trd.documents[0]!;
    expect(trdRequirementsWithoutStep(rec, trd, mbrLibrary).length).toBeGreaterThan(0);
    expect(rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.samples)).length).toBeGreaterThan(0);
    expect(trdNotices(project, rec)).toHaveLength(0);
    expect(mbrOpenItems(project, rec, mbrLibrary).length).toBeGreaterThan(0);
  });

  it("is fictional and names no real company", () => {
    expect(JSON.stringify(rec)).not.toMatch(/\b(must|violation|non-compliant)\b/i);
  });
});
