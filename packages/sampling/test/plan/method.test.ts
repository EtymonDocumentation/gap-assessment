import { samplingPlanSchema, samplingPointSchema, type SampleMethod, type SamplingPlan, type SamplingPoint } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { isBagSample, methodDocumentLines, methodInstructionLines, methodStarted, planMethodReminders, samplingMethodReminders } from "../../src/index";

const at = "2026-10-01T00:00:00.000Z";
const point = (id: string, method?: SampleMethod, extra: Partial<SamplingPoint> = {}): SamplingPoint =>
  ({
    id,
    origin: { kind: "manual" },
    type: "ipc",
    unitOp: "compounding",
    attribute: "Bioburden (fictional)",
    timing: { options: ["end"] },
    sampleSize: { inputs: {} },
    rationale: "Fictional.",
    appliesTo: "all",
    sourceIds: [],
    createdAt: at,
    updatedAt: at,
    ...(method ? { method } : {}),
    ...extra,
  }) as SamplingPoint;
const planOf = (points: SamplingPoint[], on = false): SamplingPlan =>
  ({ id: "SPL-001", title: "Plan", runType: "ppq", status: "draft", steps: [], batches: [], batchRationale: "", parties: [], agencyRequests: [], points, subsections: [], createdAt: at, updatedAt: at, ...(on ? { askSampleMethod: true } : {}) }) as SamplingPlan;

describe("sampling method (plan format 1.6.0)", () => {
  it("is optional: a point and a plan without it are valid, and nothing is preselected", () => {
    expect(samplingPointSchema.safeParse(point("SP-001")).success).toBe(true);
    expect(samplingPlanSchema.safeParse(planOf([point("SP-001")])).success).toBe(true);
    expect(methodStarted(undefined)).toBe(false);
    expect(methodStarted({})).toBe(false);
    expect(methodStarted({ added: {}, flush: { discardTo: "  " } })).toBe(false);
    expect(methodStarted({ closedSystem: "closed" })).toBe(true);
  });

  it("rejects a shared-port link to a point that is not in the plan, or to the point itself", () => {
    const shared = (ids: string[]) => planOf([point("SP-001", { access: "shared_port", shared: { pointIds: ids } }), point("SP-002")]);
    expect(samplingPlanSchema.safeParse(shared(["SP-002"])).success).toBe(true);
    expect(samplingPlanSchema.safeParse(shared(["SP-009"])).success).toBe(false);
    expect(samplingPlanSchema.safeParse(shared(["SP-001"])).success).toBe(false);
  });

  it("gives no reminder when nothing was asked: switch off and the section untouched", () => {
    const p = point("SP-001");
    expect(samplingMethodReminders(p, planOf([p]))).toEqual([]);
    expect(planMethodReminders(planOf([p]))).toEqual([]);
  });

  it("with the plan switch on, an untouched point is asked how the sample is taken and whether it is open or closed", () => {
    const p = point("SP-001");
    const r = samplingMethodReminders(p, planOf([p], true));
    expect(r.map((x) => x.field)).toEqual(["how the sample is taken", "closed or open"]);
    expect(r.every((x) => x.severity === "open")).toBe(true);
  });

  it("once the person answers anything, the point asks the rest (switch off)", () => {
    const p = point("SP-001", { access: "added_y_connector" });
    const texts = samplingMethodReminders(p, planOf([p])).map((x) => x.text);
    expect(texts).toContain("State whether the added connector is in the commercial assembly.");
    expect(texts.some((t) => t.includes("modified assembly is covered"))).toBe(true);
    expect(texts.some((t) => t.includes("removed after the study"))).toBe(true);
    expect(texts).toContain("State the flush or first-draw discard volume and where it goes.");
    expect(texts.some((t) => t.includes("closed system or open"))).toBe(true);
  });

  it("a shared port without order, partners or flush-between is flagged; answering clears it", () => {
    const open = point("SP-001", { access: "shared_port", added: { forStudyOnly: false }, flush: { practice: "flush_volume", volume: { value: 20, unit: "mL" }, discardTo: "waste" }, closedSystem: "closed" });
    const f = samplingMethodReminders(open, planOf([open])).map((x) => x.field);
    expect(f).toEqual(["samples sharing the port", "order on the shared port", "flush between samples"]);
    const done = point("SP-001", { ...open.method!, shared: { pointIds: ["SP-002"], order: "A then B", flushBetween: false } });
    expect(samplingMethodReminders(done, planOf([done, point("SP-002")]))).toEqual([]);
  });

  it("a bag sample asks about mixing; a hold point counts as a bag sample", () => {
    const hold = point("SP-001", { closedSystem: "closed" }, { flow: { stepId: "S-1", holdId: "H-1" } });
    expect(isBagSample(hold)).toBe(true);
    expect(samplingMethodReminders(hold, planOf([hold])).map((x) => x.field)).toContain("bag mixed first");
    const mixed = point("SP-001", { closedSystem: "closed", bag: { fromBag: true, mixedFirst: true } });
    expect(samplingMethodReminders(mixed, planOf([mixed])).map((x) => x.field)).toContain("mixing time");
  });

  it("access other needs text, an open sample needs a class, no flush needs a reason", () => {
    const p = point("SP-001", { access: "other", closedSystem: "open" });
    const f = samplingMethodReminders(p, planOf([p])).map((x) => x.field);
    expect(f).toContain("room or hood class");
    expect(f).toContain("how the sample is taken");
    const q = point("SP-001", { access: "dedicated_port", flush: { practice: "none_stated_reason" } });
    expect(samplingMethodReminders(q, planOf([q])).map((x) => x.field)).toContain("reason for no flush");
  });

  it("writes instruction lines from the answers, with a write-in line where a detail is missing, and never guesses", () => {
    const p = point("SP-001", {
      access: "bag_sample_manifold",
      flush: { practice: "flush_volume", volume: { value: 50, unit: "mL" }, discardTo: "waste" },
      bag: { fromBag: true, mixedFirst: true, mixingTime: "10 min" },
      closedSystem: "closed",
    });
    const lines = methodInstructionLines(p);
    expect(lines).toContain("Flush 50 mL from the port to waste before drawing.");
    expect(lines).toContain("Mix the bag 10 min before sampling.");
    expect(lines).toContain("Closed sample.");
    const q = point("SP-001", { access: "dedicated_port", flush: { practice: "flush_volume" } });
    expect(methodInstructionLines(q)).toContain("Flush ______ from the port to ______ before drawing.");
    expect(methodDocumentLines(q, planOf([q])).some((l) => l.open && l.text.startsWith("[not stated:"))).toBe(true);
    expect(methodInstructionLines(point("SP-001"))).toEqual([]);
  });
});
