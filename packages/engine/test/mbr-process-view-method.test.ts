// The Process view reads "how the sample is taken" live from the linked sampling plan: a summary per sample, liquid flushed to waste as its
// own line of the fluid tracker, and one reminder note per sample. Nothing is guessed. All data are fictional.
import { describe, expect, it, vi } from "vitest";
import { mbrRecordSchema, type SampleMethod } from "@gap/process-model";
import { buildDemoProject, buildProcessView } from "@gap/engine";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";

vi.setConfig({ testTimeout: 60000 });

const demo = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
const NOW = "2026-01-01T00:00:00Z";
const [P1, P2, P3] = demo.sampling.plans[0]!.points.map((p) => p.id) as [string, string, string];

/** A record with three sample rows at three steps, linked to the plan whose first three points carry the given methods. */
function viewWith(methods: [SampleMethod | undefined, SampleMethod | undefined, SampleMethod | undefined], opts: { askAll?: boolean; type?: string } = {}) {
  const project = structuredClone(demo);
  const plan = project.sampling.plans[0]!;
  [P1, P2, P3].forEach((id, i) => {
    const pt = plan.points.find((p) => p.id === id)!;
    if (methods[i]) pt.method = methods[i]!;
    else delete pt.method;
  });
  for (const p of plan.points) if (![P1, P2, P3].includes(p.id)) delete p.method;
  if (opts.askAll) plan.askSampleMethod = true;
  if (opts.type) plan.points.find((p) => p.id === P1)!.type = opts.type as never;
  const row = (id: string, pointId: string) => ({ id, planId: plan.id, pointId, test: "Assay", quantity: "2 × 10 mL" });
  const step = (n: number, text: string) => ({ id: `ST-000${n}`, text });
  const r = mbrRecordSchema.parse({
    id: "MBR-009",
    title: "Hand-made record (fictional)",
    status: "draft",
    planId: plan.id,
    createdAt: NOW,
    updatedAt: NOW,
    sections: [
      {
        id: "SC-01",
        title: "Mixing",
        blocks: [
          {
            id: "BL-001",
            title: "Mix",
            steps: [step(1, `Take sample ${P1} at the bottom sampling port.`), step(2, `Take sample ${P2}.`), step(3, `Take sample ${P3}.`)],
            params: [{ id: "R-0001", label: "Batch volume", mbrValue: "1", mbrUnit: "L" }],
            samples: [row("R-0002", P1), row("R-0003", P2), row("R-0004", P3)],
            timeLimits: [],
            cmoFields: [],
          },
        ],
      },
    ],
  });
  return buildProcessView({ ...project, mbr: { records: [r] } }, r);
}

describe("the method summary of a sample", () => {
  it("is taken from the linked plan point and keeps the step's port name beside the access", () => {
    const v = viewWith([{ access: "added_y_connector", added: { forStudyOnly: true, inCommercialAssembly: false, removedAfter: true }, closedSystem: "closed" }, undefined, undefined]);
    const m = v.samples[0]!.method!;
    expect(m.access).toBe("added_y_connector");
    expect(m.addedForStudy).toBe(true);
    expect(m.inCommercialAssembly).toBe(false);
    expect(m.removedAfter).toBe(true);
    expect(m.closedSystem).toBe("closed");
    expect(m.text).toContain("Y-connector");
    expect(m.text).toContain("not in the commercial assembly");
    expect(v.samples[0]!.port).toMatch(/port/i);
  });
  it("is absent for a point with no answer, and a point with only empty groups", () => {
    const v = viewWith([undefined, { added: {}, shared: {} }, undefined]);
    expect(v.samples.every((s) => s.method === undefined)).toBe(true);
  });
  it("names a shared port with its partners and whether it is flushed between samples", () => {
    const v = viewWith([{ access: "shared_port", shared: { pointIds: [P2], order: "first", flushBetween: true }, flush: { practice: "flush_volume", volume: { value: 30, unit: "mL" }, discardTo: "waste bag" } }, undefined, undefined]);
    const m = v.samples[0]!.method!;
    expect(m.sharedWith).toEqual([P2]);
    expect(m.flushBetween).toBe(true);
    expect(m.text).toBe(`shared port, shared with ${P2}, flushed between samples, flush 30 mL to waste bag`);
  });
  it("tags an added part of a PPQ point 'PPQ only' and any other 'study only'", () => {
    const added: SampleMethod = { access: "dedicated_port", added: { forStudyOnly: true } };
    expect(viewWith([added, undefined, undefined], { type: "ppq_enhanced" }).samples[0]!.method!.studyTag).toBe("PPQ only");
    expect(viewWith([added, undefined, undefined], { type: "ipc" }).samples[0]!.method!.studyTag).toBe("study only");
  });
});

describe("flushed liquid in the fluid tracker", () => {
  it("counts a stated flush in mL as liquid lost to waste, apart from the sample volume", () => {
    const v = viewWith([{ access: "dedicated_port", flush: { practice: "flush_volume", volume: { value: 30, unit: "mL" } } }, undefined, undefined]);
    expect(v.samples[0]!.flushMl).toBe(30);
    expect(v.samples[0]!.volumeMl).toBe(20);
    const after = v.momentVolumes[v.samples[0]!.momentIndex]!;
    // The three samples share one block, so they sit on one moment: 3 x 20 mL of samples, 30 mL flushed (only the first states a flush).
    expect(after.withdrawnL).toBeCloseTo(0.06, 6);
    expect(after.flushedL).toBeCloseTo(0.03, 6);
    expect(after.remainingL).toBeCloseTo(1 - 0.06 - 0.03, 6);
    expect(v.volumeSections[0]!.sampleMl).toBe(60);
    expect(v.volumeSections[0]!.flushMl).toBe(30);
  });
  it("turns litres into mL and counts a first-draw discard the same way", () => {
    const v = viewWith([{ access: "dedicated_port", flush: { practice: "first_draw_discard", volume: { value: 0.05, unit: "L" } } }, undefined, undefined]);
    expect(v.samples[0]!.flushMl).toBeCloseTo(50, 6);
  });
  it("counts nothing for an unstated volume, a unit that is not mL or L, or no flush", () => {
    const v = viewWith([
      { access: "dedicated_port", flush: { practice: "flush_volume", discardTo: "waste bag" } },
      { access: "dedicated_port", flush: { practice: "flush_volume", volume: { value: 3, unit: "sample volumes" } } },
      { access: "dedicated_port", flush: { practice: "none_stated_reason", reason: "closed loop" } },
    ]);
    expect(v.samples.every((s) => s.flushMl === undefined)).toBe(true);
    expect(v.momentVolumes.every((m) => m.flushedL === 0)).toBe(true);
    // The unit-less flush is still said in words, with its volume text, so a reader sees what the plan wrote.
    expect(v.samples[1]!.method!.text).toContain("3 sample volumes");
  });
  it("counts the flush once for each sample that states it (a shared port flushed between samples)", () => {
    const flush = { practice: "flush_volume" as const, volume: { value: 10, unit: "mL" } };
    const v = viewWith([
      { access: "shared_port", shared: { pointIds: [P2], flushBetween: true }, flush },
      { access: "shared_port", shared: { pointIds: [P1], flushBetween: true }, flush },
      undefined,
    ]);
    expect(v.volumeSections[0]!.flushMl).toBe(20);
  });
});

describe("reminders as notes in the Samples checks", () => {
  it("lists one compact line per sample and never blocks", () => {
    const v = viewWith([{ access: "shared_port" }, undefined, undefined]);
    const c = v.checks.find((x) => x.id === "S6")!;
    expect(c.group).toBe("Samples");
    expect(c.status).toBe("finding");
    const f = v.findings.filter((x) => x.checkId === "S6");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("note");
    expect(f[0]!.detail).toContain(`${P1}: `);
    expect(f[0]!.detail).not.toContain(`${P2}: `);
  });
  it("is not applicable when the plan asks nothing about these samples", () => {
    const v = viewWith([undefined, undefined, undefined]);
    expect(v.checks.find((x) => x.id === "S6")!.status).toBe("na");
    expect(v.samples.every((s) => s.method === undefined)).toBe(true);
  });
  it("covers every sample when the plan switch asks every point", () => {
    const v = viewWith([undefined, undefined, undefined], { askAll: true });
    const f = v.findings.find((x) => x.checkId === "S6")!;
    for (const id of [P1, P2, P3]) expect(f.detail).toContain(`${id}: `);
  });
});
