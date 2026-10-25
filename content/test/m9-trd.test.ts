import {
  addTrdItem,
  addTrdStep,
  applyTrdUpdate,
  buildDemoProject,
  buildTrdDocument,
  buildTrdSeed,
  clearOverride,
  copyPulledValue,
  createTrd,
  deleteTrd,
  diffTrdAgainstSeed,
  effectiveField,
  finishTrdReview,
  moveTrdStep,
  pickAllUnprotected,
  removeTrdItem,
  removeTrdStep,
  setLimits,
  setOverride,
  trdOpenItems,
  trdOverrides,
  trdSeedContentFingerprint,
  trdSourceChanged,
  updateTrd,
  updateTrdStep,
  TrdError,
  NO_REASON_RECORDED,
} from "@gap/engine";
import { parseProject, parseTrdSeed, TrdSeedError, type Project, type TrdDocument, type TrdSeed } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const T0 = "2026-10-23T09:00:00.000Z";
const T1 = "2026-10-24T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T1 };
const full = buildDemoProject(content, demos["arx-217"]);
/** The demo project without its demo TRD, so the tests below start from a project that has none. */
const base: Project = { ...full, trd: { documents: [] }, changeLog: full.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
const seed0 = buildTrdSeed(content, base, { exportedAt: T0 });

/** A project with one TRD started from the demo project's seed, and that TRD. */
function started(): { project: Project; id: string } {
  const r = createTrd(base, { title: "Test TRD (fictional)", start: { kind: "project", seed: seed0 } }, { ...who, at: T0 });
  return { project: r.project, id: r.trdId };
}
const doc = (p: Project, id: string): TrdDocument => p.trd.documents.find((d) => d.id === id)!;
const ref = (d: TrdDocument, uo: string, item: string) => {
  const step = d.steps.find((s) => s.key === uo)!;
  const [collection, key] = item.split(".");
  return { stepId: step.id, collection: collection as "param", key: key! };
};
const clone = (s: TrdSeed): TrdSeed => structuredClone(s);
const seedField = (s: TrdSeed, uo: string, item: string, field: string) => {
  const [collection, key] = item.split(".");
  return s.unitOperations.find((u) => u.key === uo)!.items.find((i) => i.collection === collection && i.key === key)!.fields.find((f) => f.field === field)!;
};

describe("starting a TRD", () => {
  it("from the project: steps in process order, details and fields as they came in, nothing invented", () => {
    const { project, id } = started();
    const d = doc(project, id);
    expect(d.origin.kind).toBe("project");
    expect(d.origin.seed?.fingerprint).toBe(trdSeedContentFingerprint(seed0));
    expect(d.steps.map((s) => s.key)).toEqual([...seed0.scope.included].sort((a, b) => a.sequence - b.sequence).map((u) => u.key));
    expect(d.steps.map((s) => s.id)).toEqual(d.steps.map((_, i) => `TS-${String(i + 1).padStart(2, "0")}`));
    expect(d.details.map((f) => f.key)).toEqual(["program", "modality", "dosageForm", "presentation", "site", "line", "programStage"]);
    expect(effectiveField(d.details[0]!).text).toBe("ARX-217");
    // No override, no limit, no description until the user writes one.
    expect(trdOverrides(d)).toEqual([]);
    expect(d.steps.every((s) => !s.description && s.items.every((i) => !i.limits))).toBe(true);
    // The pulled fields are the seed fields untouched (the SU value stays under reference.su).
    const temp = d.steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!;
    expect(temp.fields.find((f) => f.key === "setPoint")!.pulled).toMatchObject({ status: "established", display: "20 °C", reference: { su: { display: expect.any(String) } } });
    expect(project.changeLog.at(-1)).toMatchObject({ action: "trd_add", path: `trd.${id}` });
    expect(parseProject(JSON.parse(JSON.stringify(project))).trd.documents).toHaveLength(1);
  });

  it("from an imported seed file: the same content, and the file's sources travel with the TRD", () => {
    const parsed = parseTrdSeed(JSON.stringify(seed0));
    const r = createTrd(base, { title: "From a file (fictional)", start: { kind: "seed-import", seed: parsed } }, who);
    const d = doc(r.project, r.trdId);
    expect(d.origin.kind).toBe("seed-import");
    expect(d.steps.length).toBe(doc(started().project, "TRD-001").steps.length);
    expect(d.origin.seedSources?.length).toBe(seed0.sources.length);
  });

  it("blank: every detail reads Not established and is open; no pulled value anywhere", () => {
    const r = createTrd(base, { title: "Blank (fictional)", start: { kind: "blank", steps: [{ unitOp: "sterile_filtration", label: "Sterile filtration" }, { label: "Special hold (fictional)" }] } }, who);
    const d = doc(r.project, r.trdId);
    expect(d.origin).toEqual({ kind: "blank", importedAt: who.at });
    expect(d.details.every((f) => !f.pulled && effectiveField(f).text === "Not established")).toBe(true);
    expect(d.steps.map((s) => [s.label, s.custom, s.entered])).toEqual([["Sterile filtration", false, true], ["Special hold (fictional)", true, true]]);
    expect(trdOpenItems(d).filter((o) => o.kind === "not_established")).toHaveLength(7);
  });

  it("refuses a blank title and refuses what is not a seed", () => {
    expect(() => createTrd(base, { title: "  ", start: { kind: "blank" } }, who)).toThrow(TrdError);
    expect(() => parseTrdSeed("not json")).toThrow("The file is not valid JSON.");
    expect(() => parseTrdSeed({ meta: { format: "something-else" } })).toThrow(/Not a TRD seed/);
    const other = clone(seed0);
    other.meta.formatVersion = "2.0.0";
    expect(() => parseTrdSeed(JSON.stringify(other))).toThrow("This reader supports TRD seed format 1.x; the file is 2.0.0.");
    const bad = clone(seed0);
    seedField(bad, "compounding", "param.temperature", "setPoint").status = "not_established";
    expect(() => parseTrdSeed(bad)).toThrow(TrdSeedError);
    expect(() => parseTrdSeed(bad)).toThrow(/must not carry a value/);
  });

  it("several TRDs per project, ids never reused", () => {
    let { project } = started();
    project = createTrd(project, { title: "Second (fictional)", start: { kind: "blank" } }, who).project;
    expect(project.trd.documents.map((d) => d.id)).toEqual(["TRD-001", "TRD-002"]);
    project = deleteTrd(project, "TRD-002", who);
    expect(project.changeLog.at(-1)).toMatchObject({ action: "trd_remove" });
    project = createTrd(project, { title: "Third (fictional)", start: { kind: "blank" } }, who).project;
    expect(project.trd.documents.map((d) => d.id)).toEqual(["TRD-001", "TRD-003"]);
  });
});

describe("overrides", () => {
  it("keeps the project value beside the entered one and logs before and after", () => {
    const { project, id } = started();
    const r = ref(doc(project, id), "compounding", "param.temperature");
    const p2 = setOverride(project, id, { part: "item", ...r, field: "setPoint" }, { status: "established", display: "21", unit: "°C", reason: "Engineering run (fictional)" }, who);
    const f = doc(p2, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.fields.find((x) => x.key === "setPoint")!;
    expect(effectiveField(f)).toMatchObject({ text: "21 °C", overridden: true, pulledText: "20 °C", reason: "Engineering run (fictional)" });
    expect(f.pulled?.display).toBe("20 °C");
    const ev = p2.changeLog.at(-1)!;
    expect(ev).toMatchObject({ action: "trd_override_set", before: null, after: { display: "21", unit: "°C", by: who.name } });
    expect(ev.detail).toContain("overridden (project: 20 °C)");
    expect(trdOverrides(doc(p2, id))).toMatchObject([{ projectValue: "20 °C", trdValue: "21 °C", reason: "Engineering run (fictional)", overridesProject: true }]);
  });

  it("shows 'No reason recorded' when no reason is given, and changes nothing when the same value is entered again", () => {
    const { project, id } = started();
    const addr = { part: "details", field: "line" } as const;
    const p2 = setOverride(project, id, addr, { status: "established", display: "Line 9 (fictional)" }, who);
    expect(trdOverrides(doc(p2, id))[0]!.reason).toBe(NO_REASON_RECORDED);
    expect(effectiveField(doc(p2, id).details.find((f) => f.key === "line")!).reason).toBe(NO_REASON_RECORDED);
    expect(setOverride(p2, id, addr, { status: "established", display: "Line 9 (fictional)" }, { ...who, at: "2026-11-01T00:00:00.000Z" })).toBe(p2);
  });

  it("removes an override, keeps it in the log, and refuses a value-less established entry", () => {
    const { project, id } = started();
    const addr = { part: "details", field: "line" } as const;
    const p2 = setOverride(project, id, addr, { status: "established", display: "Line 9 (fictional)", reason: "x" }, who);
    const p3 = clearOverride(p2, id, addr, who);
    expect(effectiveField(doc(p3, id).details.find((f) => f.key === "line")!)).toMatchObject({ text: "Line 4", overridden: false });
    expect(p3.changeLog.at(-1)).toMatchObject({ action: "trd_override_clear", before: { display: "Line 9 (fictional)" }, after: null });
    expect(clearOverride(p3, id, addr, who)).toBe(p3);
    expect(() => setOverride(project, id, addr, { status: "established" }, who)).toThrow(/needs the value/);
  });

  it("a value entered over a blank field is an entry, not an override of the project", () => {
    const r0 = createTrd(base, { title: "Blank (fictional)", start: { kind: "blank" } }, who);
    const p2 = setOverride(r0.project, r0.trdId, { part: "details", field: "program" }, { status: "established", display: "ARX-999 (fictional)" }, who);
    expect(trdOverrides(doc(p2, r0.trdId))[0]).toMatchObject({ overridesProject: false, projectValue: "" });
    // The standard TRD has no Overrides appendix when nothing was overridden; the evidence record still states that.
    const std = buildTrdDocument(p2, doc(p2, r0.trdId), { generatedAt: T1 });
    expect(std.sections.find((s) => s.id === "overrides")).toBeUndefined();
    const out = buildTrdDocument(p2, doc(p2, r0.trdId), { generatedAt: T1, variant: "evidence" });
    expect(out.sections.find((s) => s.id === "overrides")!.blocks[0]).toMatchObject({ text: "No value that came in from the project has been overridden." });
  });

  it("a TBD override with a value is labelled provisional; it is an open item", () => {
    const { project, id } = started();
    const p2 = setOverride(project, id, { part: "details", field: "line" }, { status: "tbd", display: "Line 7 (fictional)" }, who);
    const f = doc(p2, id).details.find((x) => x.key === "line")!;
    expect(effectiveField(f)).toMatchObject({ status: "tbd", provisional: true });
    expect(trdOpenItems(doc(p2, id)).some((o) => o.where === "Details, Filling line" && o.kind === "provisional")).toBe(true);
  });
});

describe("PAR / NOR / set point entry", () => {
  const cite = { sourceIds: ["src-x"], locations: { "src-x": { section: "5.1", page: "12" } } };

  it("stores the limits with their sources, logs the old and new, and a second identical call changes nothing", () => {
    const { project, id } = started();
    const r = ref(doc(project, id), "compounding", "param.temperature");
    const limits = { setPoint: { value: 20, unit: "°C", ...cite }, nor: { min: 18, max: 22, unit: "°C", basis: "Internal technical report", ...cite }, par: { min: 15, max: 25, unit: "°C", ...cite } };
    const p2 = setLimits(project, id, r, limits, who);
    expect(doc(p2, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.limits!.nor).toMatchObject({ min: 18, max: 22, basis: "Internal technical report", locations: { "src-x": { page: "12" } } });
    expect(p2.changeLog.at(-1)).toMatchObject({ action: "trd_limits_update", before: null });
    expect(setLimits(p2, id, r, limits, who)).toBe(p2);
    const p3 = setLimits(p2, id, r, {}, who);
    expect(doc(p3, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.limits).toBeUndefined();
    expect(p3.changeLog.at(-1)).toMatchObject({ before: { nor: { min: 18 } }, after: null });
  });

  it("refuses a range with neither end and refuses limits on equipment", () => {
    const { project, id } = started();
    const d = doc(project, id);
    expect(() => setLimits(project, id, ref(d, "compounding", "param.temperature"), { nor: { sourceIds: [] } }, who)).toThrow(/minimum, a maximum or both/);
    const equip = d.steps.find((s) => s.key === "compounding")!.items.find((i) => i.collection === "equip")!;
    expect(() => setLimits(project, id, { stepId: d.steps.find((s) => s.key === "compounding")!.id, collection: "equip", key: equip.key }, { setPoint: { value: 1, sourceIds: [] } }, who)).toThrow(/belong to parameters/);
  });

  it("allows limits on an in-process control", () => {
    const { project, id } = started();
    const d = doc(project, id);
    const ipc = d.steps.find((s) => s.key === "bbr_filtration")!.items.find((i) => i.collection === "ipc")!;
    const p2 = setLimits(project, id, { stepId: d.steps.find((s) => s.key === "bbr_filtration")!.id, collection: "ipc", key: ipc.key }, { nor: { max: 100, unit: "CFU/100 mL", sourceIds: [] } }, who);
    expect(trdOpenItems(doc(p2, id)).some((o) => o.kind === "limit_open" && o.text === "NOR has no source cited")).toBe(true);
  });

  it("copies a project value only when asked, with its sources, and never assumes what it is", () => {
    const { project, id } = started();
    const temp = doc(project, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!;
    const nor = temp.fields.find((f) => f.key === "nor")!;
    expect(copyPulledValue(nor, "nor")).toMatchObject({ min: 18, max: 22, unit: "°C", sourceIds: nor.pulled!.sourceIds });
    expect(copyPulledValue(temp.fields.find((f) => f.key === "setPoint")!, "setPoint")).toMatchObject({ value: 20, unit: "°C" });
    // A single quantity is not a range; a "max" field can only be the top of an open-ended one.
    expect(copyPulledValue(temp.fields.find((f) => f.key === "setPoint")!, "nor")).toBeUndefined();
    const hold = doc(project, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "max_hold_time")!.fields[0]!;
    expect(copyPulledValue(hold, "par")).toMatchObject({ max: 36, unit: "h" });
    // Nothing was written by copying.
    expect(temp.limits).toBeUndefined();
    expect(copyPulledValue({ key: "x", label: "x" }, "nor")).toBeUndefined();
  });
});

describe("steps and items", () => {
  it("adds a catalog step and a custom step, moves and removes them, never reuses a step id", () => {
    let { project, id } = started();
    const r1 = addTrdStep(project, id, { label: "Special hold (fictional)" }, who);
    project = r1.project;
    expect(doc(project, id).steps.at(-1)).toMatchObject({ label: "Special hold (fictional)", custom: true, entered: true });
    project = moveTrdStep(project, id, r1.stepId, -1, who);
    expect(doc(project, id).steps.at(-2)!.id).toBe(r1.stepId);
    project = removeTrdStep(project, id, r1.stepId, who);
    expect(project.changeLog.at(-1)).toMatchObject({ action: "trd_step_remove", before: { label: "Special hold (fictional)" } });
    const r2 = addTrdStep(project, id, { label: "Another (fictional)" }, who);
    expect(r2.stepId).not.toBe(r1.stepId);
    expect(() => addTrdStep(r2.project, id, { unitOp: "compounding", label: "Compounding" }, who)).toThrow(/already a step/);
  });

  it("a step from the project keeps its name; the description is the user's", () => {
    const { project, id } = started();
    const step = doc(project, id).steps[0]!;
    expect(() => updateTrdStep(project, id, step.id, { label: "Renamed" }, who)).toThrow(/keeps its name/);
    const p2 = updateTrdStep(project, id, step.id, { description: "  Our own words (fictional)  " }, who);
    expect(doc(p2, id).steps[0]!.description).toBe("Our own words (fictional)");
    expect(p2.changeLog.at(-1)).toMatchObject({ action: "trd_step_update", before: { description: "" }, after: { description: "Our own words (fictional)" } });
    expect(updateTrdStep(p2, id, step.id, { description: "Our own words (fictional)" }, who)).toBe(p2);
  });

  it("adds, renames and removes a typed item; a typed parameter starts with no classification value", () => {
    let { project, id } = started();
    const stepId = doc(project, id).steps.find((s) => s.key === "sterile_filtration")!.id;
    const r = addTrdItem(project, id, stepId, { collection: "param", label: "Soak time (fictional)" }, who);
    project = r.project;
    const item = doc(project, id).steps.find((s) => s.id === stepId)!.items.find((i) => i.key === r.ref.key)!;
    expect(item).toMatchObject({ custom: true, entered: true });
    expect(effectiveField(item.fields[0]!).text).toBe("Not established");
    expect(trdOpenItems(doc(project, id)).some((o) => o.where.endsWith("Soak time (fictional), Classification"))).toBe(true);
    project = removeTrdItem(project, id, r.ref, who);
    expect(project.changeLog.at(-1)).toMatchObject({ action: "trd_item_remove" });
    expect(() => addTrdItem(project, id, stepId, { collection: "param", label: " " }, who)).toThrow(TrdError);
  });

  it("edits the title, reference, version, purpose and approvals, one log event", () => {
    const { project, id } = started();
    const p2 = updateTrd(project, id, { docRef: "TRD-123", version: "0.1", purpose: "Purpose (fictional)", approvals: [{ role: "QA", name: "" }, { role: " " }] }, who);
    expect(doc(p2, id)).toMatchObject({ docRef: "TRD-123", version: "0.1", purpose: "Purpose (fictional)", approvals: [{ role: "QA" }] });
    expect(p2.changeLog.at(-1)).toMatchObject({ action: "trd_update", before: { docRef: "" } });
    expect(updateTrd(p2, id, { docRef: "TRD-123" }, who)).toBe(p2);
    expect(() => updateTrd(p2, id, { title: " " }, who)).toThrow(/needs a title/);
  });
});

describe("update from the project or a newer seed", () => {
  it("the demo TRD has no differing row against the demo project, so the page can show no change notice", () => {
    const seed = buildTrdSeed(content, full, { exportedAt: T1 });
    expect(diffTrdAgainstSeed(full.trd.documents[0]!, clone(seed))).toEqual([]);
  });

  it("finds no difference right after the TRD is started, and no notice", () => {
    const { project, id } = started();
    expect(diffTrdAgainstSeed(doc(project, id), clone(seed0))).toEqual([]);
    expect(trdSourceChanged(doc(project, id), clone(seed0))).toBe(false);
  });

  it("starting the TRD (a change log entry, a new document) does not make the project look changed", () => {
    // The gap document fingerprint inside a seed moves with the change log; the notice must not depend on it.
    const { project, id } = started();
    const again = buildTrdSeed(content, project, { exportedAt: T0 });
    expect(again.meta.gapAssessment.documentFingerprint).not.toBe(seed0.meta.gapAssessment.documentFingerprint);
    expect(trdSourceChanged(doc(project, id), again)).toBe(false);
  });

  it("lists a changed value, accepts it, logs the old value, and marks the TRD up to date", () => {
    const { project, id } = started();
    const next = clone(seed0);
    const f = seedField(next, "compounding", "param.temperature", "setPoint");
    f.value = { value: 21, unit: "°C" };
    f.display = "21 °C";
    expect(trdSourceChanged(doc(project, id), next)).toBe(true);
    const rows = diffTrdAgainstSeed(doc(project, id), next);
    expect(rows).toMatchObject([{ kind: "field_changed", where: "Pooling, compounding and dilution, Compounding temperature, Set point", projectNow: "21 °C", trdNow: "20 °C", overridden: false, protectedRow: false, statusChanged: false }]);
    const p2 = applyTrdUpdate(project, id, next, pickAllUnprotected(rows), who);
    const field = doc(p2, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.fields.find((x) => x.key === "setPoint")!;
    expect(effectiveField(field).text).toBe("21 °C");
    expect(p2.changeLog.filter((e) => e.action === "trd_update_accept")).toHaveLength(1);
    expect(p2.changeLog.find((e) => e.action === "trd_update_accept")!.detail).toContain("the TRD said 20 °C");
    expect(p2.changeLog.at(-1)).toMatchObject({ action: "trd_origin_update" });
    expect(trdSourceChanged(doc(p2, id), next)).toBe(false);
    expect(doc(p2, id).origin.updatedFromAt).toBe(who.at);
    expect(diffTrdAgainstSeed(doc(p2, id), next)).toEqual([]);
  });

  it("NEVER replaces an overridden field on its own: 'accept all not overridden' leaves it, with the project value shown beside", () => {
    let { project, id } = started();
    const r = ref(doc(project, id), "compounding", "param.temperature");
    project = setOverride(project, id, { part: "item", ...r, field: "setPoint" }, { status: "established", display: "19", unit: "°C" }, who);
    const next = clone(seed0);
    const f = seedField(next, "compounding", "param.temperature", "setPoint");
    f.value = { value: 25, unit: "°C" };
    f.display = "25 °C";
    // A second, unrelated change that may be accepted in bulk.
    seedField(next, "aseptic_filling", "param.line_speed", "setPoint").display = "300 units/min (updated)";
    const rows = diffTrdAgainstSeed(doc(project, id), next);
    expect(rows).toHaveLength(2);
    const over = rows.find((x) => x.overridden)!;
    expect(over).toMatchObject({ projectNow: "25 °C", trdNow: "19 °C", protectedRow: true });
    const picks = pickAllUnprotected(rows);
    expect(picks.map((x) => x.rowId)).not.toContain(over.id);
    const p2 = applyTrdUpdate(project, id, next, picks, who);
    const field = doc(p2, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.fields.find((x) => x.key === "setPoint")!;
    expect(effectiveField(field)).toMatchObject({ text: "19 °C", overridden: true, pulledText: "20 °C" });
    // The review is not complete, so the TRD is not marked up to date.
    expect(trdSourceChanged(doc(p2, id), next)).toBe(true);
    expect(diffTrdAgainstSeed(doc(p2, id), next)).toHaveLength(1);

    // "Keep my override": the project value moves next to it, the override stays.
    const kept = applyTrdUpdate(p2, id, next, [{ rowId: over.id, choice: "keep" }], who);
    const kf = doc(kept, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.fields.find((x) => x.key === "setPoint")!;
    expect(effectiveField(kf)).toMatchObject({ text: "19 °C", overridden: true, pulledText: "25 °C" });
    expect(kept.changeLog.some((e) => e.action === "trd_update_keep_override")).toBe(true);
    expect(trdSourceChanged(doc(kept, id), next)).toBe(false);

    // "Take the project value": the override goes, and the log keeps it.
    const taken = applyTrdUpdate(p2, id, next, [{ rowId: over.id, choice: "take" }], who);
    expect(effectiveField(doc(taken, id).steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "temperature")!.fields.find((x) => x.key === "setPoint")!)).toMatchObject({ text: "25 °C", overridden: false });
  });

  it("lists a status change (established to TBD) and an added or removed item and step; protects the user's own work", () => {
    let { project, id } = started();
    const d0 = doc(project, id);
    const comp = d0.steps.find((s) => s.key === "compounding")!;
    // The user wrote a PAR on a parameter and a description on a step.
    project = setLimits(project, id, ref(d0, "compounding", "param.mixing_speed"), { par: { min: 100, max: 160, unit: "rpm", sourceIds: [] } }, who);
    project = updateTrdStep(project, id, d0.steps.find((s) => s.key === "bbr_filtration")!.id, { description: "Our words (fictional)" }, who);
    const next = clone(seed0);
    const f = seedField(next, "compounding", "param.temperature", "setPoint");
    delete f.value;
    delete f.display;
    delete f.unit;
    f.status = "tbd";
    f.tbd = { owner: "Alex" };
    // Remove the mixing speed item (has the user's PAR) and a whole step (has the description); add a step and an item.
    const uo = next.unitOperations.find((u) => u.key === "compounding")!;
    uo.items = uo.items.filter((i) => i.key !== "mixing_speed");
    uo.items.push({ collection: "param", key: "x_new", label: "New parameter (fictional)", custom: true, fields: [] });
    next.scope.included = next.scope.included.filter((u) => u.key !== "bbr_filtration");
    next.unitOperations = next.unitOperations.filter((u) => u.key !== "bbr_filtration");
    next.scope.included.push({ key: "stoppering", label: "Stoppering (stand-alone)", sequence: 8.5, custom: false });
    const rows = diffTrdAgainstSeed(doc(project, id), next);
    const byKind = (k: string) => rows.filter((r) => r.kind === k);
    expect(byKind("field_changed")[0]).toMatchObject({ statusChanged: true, projectNow: expect.stringContaining("To be determined") });
    expect(byKind("item_removed")).toMatchObject([{ where: expect.stringContaining("Mixing speed"), protectedRow: true }]);
    expect(byKind("step_removed")).toMatchObject([{ where: "Bioburden reduction (BBR) filtration", protectedRow: true }]);
    expect(byKind("item_added")).toMatchObject([{ where: expect.stringContaining("New parameter (fictional)"), protectedRow: false }]);
    expect(byKind("step_added")).toMatchObject([{ where: "Stoppering (stand-alone)", protectedRow: false }]);
    // The bulk pick leaves the two protected removals, and the user's PAR and description are still there.
    const p2 = applyTrdUpdate(project, id, next, pickAllUnprotected(rows), who);
    const d2 = doc(p2, id);
    expect(d2.steps.find((s) => s.key === "bbr_filtration")!.description).toBe("Our words (fictional)");
    expect(d2.steps.find((s) => s.key === "compounding")!.items.find((i) => i.key === "mixing_speed")!.limits!.par!.max).toBe(160);
    expect(d2.steps.find((s) => s.key === "compounding")!.items.some((i) => i.key === "x_new")).toBe(true);
    // The added step lands in process order (after the filling-side steps that come before it).
    const keys = d2.steps.map((s) => s.key);
    expect(keys.indexOf("stoppering")).toBe(1);
    expect(d2.steps.find((s) => s.key === "stoppering")!.id).toMatch(/^TS-\d{2}$/);
    // Taking the protected removals on purpose removes them and keeps what they held in the log.
    const remaining = diffTrdAgainstSeed(d2, next);
    expect(remaining.every((r) => r.protectedRow)).toBe(true);
    const p3 = applyTrdUpdate(p2, id, next, remaining.map((r) => ({ rowId: r.id, choice: "take" as const })), who);
    expect(doc(p3, id).steps.some((s) => s.key === "bbr_filtration")).toBe(false);
    expect(p3.changeLog.some((e) => e.action === "trd_update_accept" && JSON.stringify(e.before).includes("bbr_filtration"))).toBe(true);
    expect(diffTrdAgainstSeed(doc(p3, id), next)).toEqual([]);
    void comp;
  });

  it("never touches a step or item the user typed, and 'finish review' clears the notice without changing the TRD", () => {
    let { project, id } = started();
    project = addTrdStep(project, id, { label: "Special hold (fictional)" }, who).project;
    const stepId = doc(project, id).steps.find((s) => s.key === "sterile_filtration")!.id;
    project = addTrdItem(project, id, stepId, { collection: "equip", label: "Extra tank (fictional)" }, who).project;
    const next = clone(seed0);
    next.meta.generator = { name: "x", version: "9" };
    next.sources = next.sources.slice(1);
    // The typed step and item are not in the seed and are not reported as removed.
    expect(diffTrdAgainstSeed(doc(project, id), next)).toEqual([]);
    const changed = clone(seed0);
    seedField(changed, "compounding", "param.temperature", "setPoint").display = "20 degC";
    expect(trdSourceChanged(doc(project, id), changed)).toBe(true);
    const before = JSON.stringify(doc(project, id).steps);
    const p2 = finishTrdReview(project, id, changed, who);
    expect(JSON.stringify(doc(p2, id).steps)).toBe(before);
    expect(trdSourceChanged(doc(p2, id), changed)).toBe(false);
    expect(p2.changeLog.at(-1)).toMatchObject({ action: "trd_origin_update" });
    expect(p2.changeLog.at(-1)!.detail).toContain("1 differences left as they are");
  });

  it("a newer seed file is read the same way and the TRD keeps pointing at its sources", () => {
    const r = createTrd(base, { title: "From a file (fictional)", start: { kind: "seed-import", seed: parseTrdSeed(JSON.stringify(seed0)) } }, who);
    const newer = clone(seed0);
    newer.meta.exportedAt = "2026-11-01T00:00:00.000Z";
    seedField(newer, "compounding", "param.temperature", "setPoint").display = "20.5 °C";
    const rows = diffTrdAgainstSeed(doc(r.project, r.trdId), parseTrdSeed(JSON.stringify(newer)));
    expect(rows).toHaveLength(1);
    expect(trdSourceChanged(doc(r.project, r.trdId), newer)).toBe(true);
  });
});

describe("the demo TRD", () => {
  const d = full.trd.documents[0]!;

  it("starts from the project, with a few descriptions, overrides (one without reason), limits and the two fictional documents", () => {
    expect(d.origin.kind).toBe("project");
    expect(d.steps.filter((s) => s.description).length).toBe(3);
    const o = trdOverrides(d);
    expect(o).toHaveLength(3);
    expect(o.filter((x) => x.reason === NO_REASON_RECORDED)).toHaveLength(1);
    const types = full.sources.filter((s) => s.docRef).map((s) => s.docRef!.docType);
    expect(types).toContain("PPQ summary report");
    expect(types).toContain("Process development report");
    expect(d.steps.flatMap((s) => s.items).filter((i) => i.limits?.par || i.limits?.nor)).toHaveLength(6);
  });

  it("shows the check: a NOR above its PAR and units that differ; the other cases read clean", () => {
    const out = buildTrdDocument(full, d, { generatedAt: T1, variant: "evidence" });
    const check = out.sections.find((s) => s.id === "par-nor")!;
    const table = check.blocks.find((b) => b.type === "table") as { rows: string[][] };
    expect(table.rows.map((r) => r[3])).toEqual(expect.arrayContaining(["NOR max 170 rpm is above PAR max 160 rpm.", "NOR and PAR: cannot compare: units differ (min vs h)."]));
    expect(table.rows.some((r) => r[3] === "Set point has no source cited.")).toBe(true);
  });
});

describe("the TRD document", () => {
  const d = full.trd.documents[0]!;
  const out = buildTrdDocument(full, d, { generatedAt: T1, variant: "evidence", appVersion: "9.9.9", catalogVersion: content.versions.catalog });
  const flat = (o: typeof out) =>
    o.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "table" ? b.rows.flat() : b.type === "list" ? b.items : b.type === "figure" || b.type === "picture" ? [b.alt] : b.type === "rich" ? [b.runs.map((r) => r.text).join("")] : b.type === "rich-list" ? b.items.map((i) => i.map((r) => r.text).join("")) : [b.text]))).join("\n");

  it("has the sections the spec lists, in order, then the appendices", () => {
    const ids = out.sections.map((s) => s.id);
    expect(ids.slice(0, 4)).toEqual(["purpose-scope", "product", "site", "overview"]);
    expect(ids.filter((i) => i.startsWith("step-"))).toHaveLength(d.steps.length);
    expect(ids.slice(-6)).toEqual(["par-nor", "open-items", "overrides", "source-register", "traceability", "versions"]);
    expect(out.title).toBe("Technical requirements document: evidence record");
    expect(out.meta).toContainEqual(["Document reference", "DEMO-TRD-217-01"]);
    expect(out.banner).toBe("Proof of concept. Not validated. Not for GMP use.");
  });

  it("uses the parameter table columns of the spec", () => {
    const sec = out.sections.find((s) => s.title === "Pooling, compounding and dilution")!;
    const table = sec.blocks.find((b) => b.type === "table" && b.columns[0] === "Parameter" && b.columns.includes("PAR")) as { columns: string[]; rows: string[][] };
    expect(table.columns).toEqual(["Parameter", "Set point", "NOR", "PAR", "Unit", "Classification", "Basis", "Sources", "Status"]);
    const speed = table.rows.find((r) => r[0] === "Mixing speed")!;
    expect(speed.slice(1, 5)).toEqual(["140", "110 to 170", "100 to 160", "rpm"]);
    expect(speed[6]).toContain("NOR: Proposed from process development");
    // Units that differ are written out in the cells, not hidden behind one unit.
    const time = table.rows.find((r) => r[0] === "Mixing time")!;
    expect(time.slice(2, 5)).toEqual(["25 to 35 min", "0.4 to 0.7 h", "See cells"]);
  });

  it("lists every override with the project value beside it and 'No reason recorded'", () => {
    const sec = out.sections.find((s) => s.id === "overrides")!;
    const t = sec.blocks.find((b) => b.type === "table") as { rows: string[][] };
    expect(t.rows).toHaveLength(3);
    expect(t.rows.find((r) => r[0]!.includes("Batch size"))!.slice(1, 4)).toEqual(["150 L", "140 L", NO_REASON_RECORDED]);
    expect(flat(out)).toContain("140 L (overridden; project: 150 L)");
  });

  it("labels the project's own range answers as project values, so they are not read as the TRD's NOR or PAR", () => {
    expect(flat(out)).toContain("Project value: Normal operating range (NOR)");
    expect(flat(out)).toContain("Project value: Set point");
  });

  it("fills the Set point column only from a set point the team entered with the TRD limits", () => {
    const sec = out.sections.find((s) => s.title === "Pooling, compounding and dilution")!;
    const table = sec.blocks.find((b) => b.type === "table" && b.columns[0] === "Parameter" && b.columns.includes("PAR")) as { rows: string[][] };
    const withLimits = d.steps.flatMap((s) => s.items).find((i) => i.label === "Mixing speed")!;
    expect(withLimits.limits?.setPoint).toBeDefined();
    expect(table.rows.find((r) => r[0] === "Mixing speed")![1]).toBe("140");
    // A parameter with a project set point but no TRD set point shows an empty cell, never the project value.
    const none = d.steps.flatMap((s) => s.items).find((i) => i.collection === "param" && !i.limits?.setPoint && i.fields.some((f) => f.key === "setPoint" && f.pulled));
    if (none) {
      const row = out.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === "table" && b.columns[0] === "Parameter" ? b.rows : [])).find((r) => r[0] === none.label);
      if (row) expect(row[1]).toBe("");
    }
  });

  it("counts the open items it lists, says so, and never states a filing category or approval", () => {
    const open = trdOpenItems(d);
    expect(out.tbdCount).toBe(open.length);
    expect(open.length).toBeGreaterThan(0);
    expect(flat(out)).toContain(`This draft lists ${open.length} open item`);
    expect(flat(out)).not.toMatch(/filing category|\bapproved by\b/i);
    expect(flat(out)).toContain("Requires regulatory affairs assessment");
  });

  it("keeps the SU value out of the TRD sections and shows it, as reference, only in the traceability appendix", () => {
    expect(out.sections.find((s) => s.id === "traceability")!.blocks[0]).toMatchObject({ text: expect.stringContaining("reference only") });
  });

  it("leaves out the sections the person unticks, but never the overrides or open items", () => {
    const less = buildTrdDocument(full, d, { generatedAt: T1, variant: "evidence", omit: ["overview", "source-register", "traceability"] });
    const ids = less.sections.map((s) => s.id);
    expect(ids).not.toContain("overview");
    expect(ids).not.toContain("source-register");
    expect(ids).not.toContain("traceability");
    expect(ids).toEqual(expect.arrayContaining(["overrides", "open-items", "par-nor", "versions"]));
  });

  it("traceability is for a project-origin TRD only", () => {
    const r = createTrd(base, { title: "From a file (fictional)", start: { kind: "seed-import", seed: seed0 } }, who);
    expect(buildTrdDocument(r.project, doc(r.project, r.trdId), { generatedAt: T1, variant: "evidence" }).sections.map((s) => s.id)).not.toContain("traceability");
  });

  it("a blank TRD says what is missing instead of filling it", () => {
    const r = createTrd(base, { title: "Blank (fictional)", start: { kind: "blank", steps: [{ label: "Hold (fictional)" }] } }, who);
    const o = buildTrdDocument(r.project, doc(r.project, r.trdId), { generatedAt: T1, variant: "evidence" });
    expect(o.tbdCount).toBe(7);
    const text = flat(o);
    expect(text).toContain("No purpose has been entered");
    expect(text).toContain("No description has been entered for this step.");
    expect(text).toContain("No set point, NOR or PAR has been entered.");
    expect(o.cover.program).toBe("Not established");
  });

  it("is deterministic for the same content", () => {
    expect(JSON.stringify(buildTrdDocument(full, d, { generatedAt: T1 }))).toBe(JSON.stringify(buildTrdDocument(full, d, { generatedAt: T1 })));
  });
});

describe("the standard TRD document", () => {
  const d = full.trd.documents[0]!;
  const std = buildTrdDocument(full, d, { generatedAt: T1, appVersion: "9.9.9", catalogVersion: content.versions.catalog });
  const evi = buildTrdDocument(full, d, { generatedAt: T1, appVersion: "9.9.9", catalogVersion: content.versions.catalog, variant: "evidence" });
  const flat = (o: typeof std) =>
    o.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "table" ? [...b.columns, ...b.rows.flat()] : b.type === "list" ? b.items : b.type === "figure" || b.type === "picture" ? [b.alt] : b.type === "rich" ? [b.runs.map((r) => r.text).join("")] : b.type === "rich-list" ? b.items.map((i) => i.map((r) => r.text).join("")) : b.type === "heading" ? [b.text] : [b.text]))).join("\n");

  it("has no appendix of values, no source register, no traceability and no PAR/NOR check section", () => {
    const ids = std.sections.map((s) => s.id);
    for (const gone of ["par-nor", "writeup-values", "source-register", "traceability", "versions"]) expect(ids).not.toContain(gone);
    // Overrides are never hidden, so they stay in the standard document too.
    expect(ids).toContain("overrides");
    expect(ids).toContain("open-items");
    expect(ids.at(-2)).toBe("references");
    expect(std.title).toBe("Technical requirements document");
  });

  it("has one compact parameter table per step: five columns, no basis, sources, status or classification, no 'Other recorded values'", () => {
    const tables = std.sections.flatMap((s) => s.blocks).flatMap((b) => (b.type === "table" ? [b] : []));
    const params = tables.filter((t) => t.columns[0] === "Parameter");
    expect(params.length).toBeGreaterThan(0);
    for (const t of params) expect(t.columns).toEqual(["Parameter", "Set point", "NOR", "PAR", "Unit"]);
    const text = flat(std);
    for (const gone of ["Other recorded values", "Basis", "Sources", "Classification", "Status"]) expect(tables.flatMap((t) => t.columns).concat(tables.map((t) => t.caption ?? "")), gone).not.toContain(gone);
    expect(text).not.toMatch(/\[\d+\]/);
    const speed = params.flatMap((t) => t.rows).find((r) => r[0] === "Mixing speed")!;
    expect(speed).toEqual(["Mixing speed", "140", "110 to 170", "100 to 160", "rpm"]);
  });

  it("is much shorter than the evidence record, which still carries everything the standard one leaves out", () => {
    expect(JSON.stringify(std).length).toBeLessThan(JSON.stringify(evi).length * 0.6);
    const ids = evi.sections.map((s) => s.id);
    for (const kept of ["par-nor", "source-register", "traceability", "versions", "overrides", "open-items"]) expect(ids).toContain(kept);
    expect(JSON.stringify(evi)).toContain("Basis");
    expect(JSON.stringify(evi)).toContain("Other recorded values");
    expect(evi.title).toBe("Technical requirements document: evidence record");
    expect(flat(evi)).toMatch(/not for approval/i);
  });

  it("lists the documents it relies on at the end, one line each, with identifier and version", () => {
    const refs = std.sections.find((s) => s.id === "references")!.blocks[0] as { type: "list"; items: string[] };
    expect(refs.items.length).toBeGreaterThan(0);
    for (const line of refs.items) expect(line).toMatch(/^\S+/);
    expect(new Set(refs.items).size).toBe(refs.items.length);
  });

  it("fills the document control from the TRD's own reference, version and roles", () => {
    expect(std.control?.documentId).toBe("DEMO-TRD-217-01");
    expect(std.control?.people.map((p) => p.role)).toEqual((d.approvals ?? []).map((a) => a.role));
  });

  it("says shipping is outside the document only when the TRD has no shipping step", () => {
    const noShipping = { ...d, steps: d.steps.filter((s) => !/shipping/i.test(s.label) && !(s.key ?? "").includes("shipping")) };
    expect(flat(buildTrdDocument(full, noShipping, { generatedAt: T1 }))).toContain("EHS or shipping");
    const withShipping = { ...noShipping, steps: [...noShipping.steps, { ...d.steps[0]!, id: "step-ship", key: "storage_shipping", label: "Storage and shipping" }] };
    const t = buildTrdDocument(full, withShipping, { generatedAt: T1 });
    expect(flat(t)).toContain("including the shipping steps");
    expect(flat(t)).not.toContain("EHS or shipping");
  });
});
