// Sampling steps at their moment in the batch record: the moment of a plan point, the library slots that name the place for it, the
// steps placed when a section is built, and the open item for a sample that no step names. All data are fictional.
import { describe, expect, it, vi } from "vitest";
import type { SamplingPoint } from "@gap/process-model";
import { MBR_SAMPLE_MOMENTS } from "@gap/process-model";
import { buildDemoProject, mbrOpenItems, sampleMomentKey, unplacedSamples, updateMbrStep } from "@gap/engine";
import { ACTOR } from "./helpers";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const rec = project.mbr.records[0]!;
const plan = project.sampling.plans[0]!;
const point = (id: string) => plan.points.find((p) => p.id === id)!;
const section = (uo: string) => rec.sections.find((s) => s.unitOp === uo)!;
const withTiming = (p: SamplingPoint, options: string[], holdId?: string): SamplingPoint =>
  ({ ...p, timing: { ...p.timing, options: options as never }, flow: holdId ? { ...(p.flow ?? { stepId: "ST-001", at: "during" }), holdId } : p.flow }) as SamplingPoint;

describe("the moment of a sample", () => {
  const base = point("SP-001");
  it("is the timing choice when the library knows a slot for it", () => {
    for (const m of ["beginning", "middle", "end", "after_stoppage", "after_intervention", "interval"]) expect(sampleMomentKey(withTiming(base, [m]))).toBe(m);
  });
  it("has no moment for 'other' or no choice, so the sample stays an open item", () => {
    expect(sampleMomentKey(withTiming(base, ["other"]))).toBeUndefined();
    expect(sampleMomentKey(withTiming(base, []))).toBeUndefined();
  });
  it("reads a sample of a hold as the start, the middle or the end of the hold", () => {
    expect(sampleMomentKey(withTiming(base, ["beginning"], "HOLD-1"))).toBe("hold_start");
    expect(sampleMomentKey(withTiming(base, ["end"], "HOLD-1"))).toBe("hold_end");
    expect(sampleMomentKey(withTiming(base, ["middle"], "HOLD-1"))).toBe("hold_during");
    expect(sampleMomentKey(withTiming(base, ["other"], "HOLD-1"))).toBeUndefined();
  });
});

describe("sample slots of the block library", () => {
  it("name a known moment and a place inside the block's own steps", () => {
    const withSlots = mbrLibrary.filter((b) => b.sampleSlots?.length);
    expect(withSlots.length).toBeGreaterThanOrEqual(3);
    for (const b of withSlots) {
      for (const s of b.sampleSlots!) {
        expect(MBR_SAMPLE_MOMENTS, `${b.id} ${s.moment}`).toContain(s.moment);
        expect(s.afterStep, b.id).toBeGreaterThanOrEqual(0);
        expect(s.afterStep, b.id).toBeLessThanOrEqual(b.steps.length);
        expect(s.text, b.id).toContain("{samples}");
      }
    }
  });
});

describe("sampling steps in the SYR-305 record", () => {
  it("puts the mixing samples T0, T1 and T2 in the mixing steps, in time order, before the mixer is stopped", () => {
    const steps = section("compounding").blocks.find((b) => b.libraryId === "dilution_and_mixing")!.steps.map((s) => s.text);
    const at = (id: string) => steps.findIndex((t) => t.includes(id));
    const stop = steps.findIndex((t) => t.startsWith("Stop mixing"));
    expect(stop).toBeGreaterThan(0);
    for (const id of ["SP-001", "SP-003", "SP-005"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    expect(at("SP-001")).toBeLessThan(at("SP-003"));
    expect(at("SP-003")).toBeLessThan(at("SP-005"));
    expect(at("SP-005")).toBeLessThan(stop);
    // The top and bottom samples of one moment share one step.
    expect(steps[at("SP-001")]).toContain("SP-002");
  });

  it("names every sample of the plan in exactly one step of its section", () => {
    for (const s of rec.sections) {
      const texts = s.blocks.flatMap((b) => b.steps.map((st) => st.text));
      for (const r of s.blocks.flatMap((b) => b.samples)) expect(texts.filter((t) => new RegExp(`(^|[^\\w-])${r.pointId}(?![\\w-])`).test(t)).length, r.pointId).toBeGreaterThanOrEqual(1);
      expect(unplacedSamples(s), s.title).toEqual([]);
    }
    expect(mbrOpenItems(project, rec, mbrLibrary).filter((o) => o.kind === "sample_not_placed")).toEqual([]);
  });

  it("does not take SP-1 for SP-10 and shows a sample as not placed when its step is rewritten without the number", () => {
    const sec = section("compounding");
    const block = sec.blocks.find((b) => b.libraryId === "dilution_and_mixing")!;
    const stepWith = block.steps.find((s) => s.text.includes("SP-005"))!;
    const edited = updateMbrStep(project, rec.id, stepWith.id, "Take the end-of-mixing samples.", ACTOR);
    const sec2 = edited.mbr.records[0]!.sections.find((s) => s.unitOp === "compounding")!;
    const missing = unplacedSamples(sec2).map((u) => u.pointId);
    expect(missing).toContain("SP-005");
    expect(missing).not.toContain("SP-001");
    const open = mbrOpenItems(edited, edited.mbr.records[0]!, mbrLibrary).filter((o) => o.kind === "sample_not_placed");
    expect(open.length).toBeGreaterThan(0);
  });
});

describe("study points in the SYR-305 record", () => {
  const rows = rec.sections.flatMap((s) => s.blocks.flatMap((b) => b.params)).filter((r) => r.studyPoint);
  it("has the PPQ challenges beyond the limits of the record as study points, each with a value and its reason", () => {
    expect(rows).toHaveLength(13);
    for (const r of rows) {
      expect(r.mbrValue, r.label).toBeTruthy();
      expect(r.reason, r.label).toBeTruthy();
    }
    expect(rows.map((r) => r.label)).toContain("Study point: filling line speed (PPQ 2)");
  });
});
