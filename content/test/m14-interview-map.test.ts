// M14 job 1: the interview map (packages/engine/src/interview-map.ts), the facility area edits (facility.ts) and the two content files
// (content/interview-map/). Engine and data only (no screens). Fictional data only.
import {
  FacilityError,
  addFacilityArea,
  addWriteupFromLibrary,
  buildAreaMap,
  buildDemoProject,
  buildProcessMap,
  confirmFacilityExampleArea,
  createTrd,
  deriveTrdQuestions,
  excludeStep,
  facilityAreaOf,
  firstOpenQuestion,
  gapMapInput,
  mapAlsoDoneInText,
  mapBackOnMapText,
  mapCountsText,
  mapEndOfNodeText,
  mapMoreDetailText,
  mapNodeName,
  mapStatusStyle,
  mapStatusText,
  nestFacilityArea,
  parseExampleLayout,
  parseInterviewMapWording,
  progress,
  removeFacilityArea,
  renameFacilityArea,
  setFacilityAreaGrade,
  setFacilityAreaSteps,
  setPartIncluded,
  trdInterviewProgress,
  trdMapInput,
  updateFacilityArea,
  useFacilityExample,
  visibleInstances,
  writeupsAvailable,
  type InterviewQuestion,
  type MapCounts,
  type MapInput,
  type MapNode,
} from "@gap/engine";
import { facilityAreas, parseProject, type Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { expectNoPrivateTerms } from "../../test-support/private-terms";
import { content, demos, interviewMapExample, interviewMapWording as W, trdInterviewWording, trdWriteups } from "../index";
import exampleRaw from "../interview-map/example-layout.yaml";
import wordingRaw from "../interview-map/wording.yaml";

// Each case builds a whole TRD from the library; the machine can be busy when the full suite runs.
vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-10T09:00:00.000Z";
const T2 = "2026-11-10T10:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const later = { name: "Sam Sample (fictional)", at: T2 };

function baseProject(): Project {
  const p = buildDemoProject(content, demos["arx-217"] as never);
  return { ...p, trd: { documents: [] }, changeLog: p.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
}

/** A blank TRD with every step and every write-up: the widest set of questions there is. */
function fullTrd(): { project: Project; trdId: string } {
  const steps = content.catalog.unitOperations.map((u) => ({ unitOp: u.key, label: u.label }));
  let { project: p, trdId } = createTrd(baseProject(), { title: "Map TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  for (const o of writeupsAvailable(p.trd.documents[0]!, trdWriteups)) p = addWriteupFromLibrary(p, trdId, o.lib, o.step?.id, who).project;
  for (const w of p.trd.documents[0]!.writeups ?? []) for (const part of w.parts) if (part.optional) p = setPartIncluded(p, trdId, w.id, part.id, true, who);
  return { project: p, trdId };
}

const trdQuestions = (p: Project, id: string): InterviewQuestion[] => deriveTrdQuestions(p, id, { content, wording: trdInterviewWording });
const events = (a: Project, b: Project) => b.changeLog.slice(a.changeLog.length);
const c = (total: number, answered: number, tbd = 0, toConfirm = 0): MapCounts => ({ total, answered, open: total - answered, tbd, toConfirm });
const blank = (): Project => baseProject();
const stepsInput = (...keys: string[]): MapInput => ({ questions: [], steps: keys.map((k) => ({ key: k, label: `Step ${k}` })), wholeLabel: "Whole" });

// ------------------------------------------------------------------ words

describe("the counts words (one function for the tile, the list and the banner)", () => {
  it("says every state in words", () => {
    expect(mapCountsText(c(9, 9), W)).toBe("All 9 answered");
    expect(mapCountsText(c(9, 3), W)).toBe("3 of 9 answered, 6 open");
    expect(mapCountsText(c(9, 3, 1), W)).toBe("3 of 9 answered, 6 open (1 to be decided)");
    expect(mapCountsText(c(9, 3, 1, 2), W)).toBe("3 of 9 answered, 6 open (1 to be decided, 2 to confirm)");
    expect(mapCountsText(c(0, 0), W)).toBe("No questions here");
  });

  it("gives each state its own icon and border, so colour is never the only cue", () => {
    const style = (status: MapNode["status"], kind: MapNode["kind"] = "step") => mapStatusStyle({ status, kind });
    expect(style("all_answered")).toEqual({ icon: "check", border: "solid" });
    expect(style("open")).toEqual({ icon: "circle", border: "dashed" });
    expect(style("to_be_decided")).toEqual({ icon: "half-circle", border: "dashed" });
    expect(style("nothing_to_ask")).toEqual({ icon: "dash", border: "dotted" });
    expect(style("left_out")).toEqual({ icon: "dash", border: "dotted" });
    expect(style("open", "unplaced")).toEqual({ icon: "question", border: "dashed" });
  });
});

// ------------------------------------------------------------------ TRD adapter

describe("the process map of the TRD interview", () => {
  const { project, trdId } = fullTrd();
  const qs = trdQuestions(project, trdId);
  const kept = new Set(qs.filter((q) => q.state === "from_project").slice(0, 2).map((q) => q.key));

  it("has the Document and details node first, then one node per step in process order", () => {
    const m = buildProcessMap(trdMapInput(content, project, qs, W, kept));
    expect(m.nodes[0]).toMatchObject({ id: "whole", kind: "whole", label: "Document and details" });
    const steps = m.nodes.filter((n) => n.kind === "step");
    expect(steps.map((n) => n.number)).toEqual(steps.map((_, i) => i + 1));
    const seq = steps.map((n) => content.catalog.unitOperations.find((u) => `step:${u.key}` === n.id)!.sequence);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });

  it("counts equal trdInterviewProgress at the Essentials level and at the All level", () => {
    const p = trdInterviewProgress(qs, kept);
    const input = trdMapInput(content, project, qs, W, kept);
    for (const includeDetail of [false, true]) {
      const m = buildProcessMap(input, { includeDetail });
      for (const s of p.steps) {
        const want = includeDetail ? { total: s.essentials.total + s.moreDetail.total, answered: s.essentials.answered + s.moreDetail.answered, open: s.essentials.open + s.moreDetail.open, tbd: s.essentials.tbd + s.moreDetail.tbd, toConfirm: s.essentials.toConfirm + s.moreDetail.toConfirm } : s.essentials;
        const node = m.nodes.find((n) => (s.stepKey === "document" ? n.id === "whole" : n.id === `step:${s.stepKey}`));
        expect(node?.counts, `${s.stepKey} detail=${includeDetail}`).toEqual(want);
      }
      const o = p.overall;
      expect(m.totals).toEqual(includeDetail ? { total: o.essentials.total + o.moreDetail.total, answered: o.essentials.answered + o.moreDetail.answered, open: o.essentials.open + o.moreDetail.open, tbd: o.essentials.tbd + o.moreDetail.tbd, toConfirm: o.essentials.toConfirm + o.moreDetail.toConfirm } : o.essentials);
    }
  });

  it("says how many More detail questions are still open when the level in view is Essentials, and nothing when it is All", () => {
    const input = trdMapInput(content, project, qs, W, kept);
    const ess = buildProcessMap(input);
    const withDetail = ess.nodes.find((n) => n.moreDetail && n.moreDetail.open > 0)!;
    expect(withDetail).toBeDefined();
    expect(mapMoreDetailText(withDetail, W)).toBe(`plus ${withDetail.moreDetail!.open} more in More detail`);
    expect(buildProcessMap(input, { includeDetail: true }).nodes.some((n) => n.moreDetail)).toBe(false);
  });

  it("lists a step left out of the project as a node with its reason, no questions and no link into a run", () => {
    // A step the TRD no longer asks about (no questions left) and the project leaves out is a left-out node.
    const left = excludeStep(content, project, "capping", "Not part of this fictional process", who);
    const asked = qs.filter((q) => q.stepKey !== "capping");
    const m = buildProcessMap(trdMapInput(content, left, asked, W, kept));
    const n = m.nodes.find((x) => x.id === "step:capping")!;
    expect(n).toMatchObject({ status: "left_out", reason: "Not part of this fictional process", leftOutCause: "scope", questionKeys: [] });
    expect(n.counts).toEqual(c(0, 0));
    expect(mapStatusText(n, W)).toBe("Left out of this project: Not part of this fictional process");
    expect(mapStatusStyle(n)).toEqual({ icon: "dash", border: "dotted" });
    expect(m.totals.total).toBe(buildProcessMap(trdMapInput(content, project, asked, W, kept)).totals.total);
  });

  it("keeps the real counts of a left-out step the TRD still asks about, so the map agrees with the list, and carries the reason", () => {
    const left = excludeStep(content, project, "capping", "Capped elsewhere (fictional)", who);
    const n = buildProcessMap(trdMapInput(content, left, qs, W, kept)).nodes.find((x) => x.id === "step:capping")!;
    expect(n.status).not.toBe("left_out");
    expect(n.counts.total).toBeGreaterThan(0);
    expect(n).toMatchObject({ reason: "Capped elsewhere (fictional)", leftOutCause: "scope" });
  });

  it("shows a step that an answer puts out as left out too, with the answer in words and the question that decides it", () => {
    const asked = qs.filter((q) => q.stepKey !== "stoppering");
    const n = buildProcessMap(trdMapInput(content, project, asked, W, kept)).nodes.find((x) => x.id === "step:stoppering")!;
    expect(n).toMatchObject({ status: "left_out", leftOutCause: "answer", reason: "Dosage form is Liquid solution", questionKeys: [] });
    expect(n.leftOutQuestionKey).toBeTruthy();
    expect(mapStatusText(n, W)).toBe("Left out of this project: Dosage form is Liquid solution");
  });

  it("names a tile like 'Sterile filtration, step 6, 3 of 9 answered, 6 open'", () => {
    const m = buildProcessMap(trdMapInput(content, project, qs, W, kept));
    const n = m.nodes.find((x) => x.id === "step:sterile_filtration")!;
    expect(mapNodeName(n, W)).toBe(`${n.label}, step ${n.number}, ${mapCountsText(n.counts, W)}`);
  });

  it("finds the first open question in process order, and nothing when everything in view is answered", () => {
    const input = trdMapInput(content, project, qs, W, kept);
    const first = firstOpenQuestion(input)!;
    expect(first.state).not.toBe("answered");
    const done: MapInput = { ...input, questions: input.questions.map((q) => ({ ...q, state: "answered" as const })) };
    expect(firstOpenQuestion(done)).toBeUndefined();
    // Whole questions come before any step's.
    const mixed: MapInput = { questions: [{ key: "a", stepKey: "compounding", state: "open" }, { key: "b", stepKey: null, state: "open" }], steps: [{ key: "compounding", label: "Compounding" }], wholeLabel: "Whole" };
    expect(firstOpenQuestion(mixed)?.key).toBe("b");
  });
});

// ------------------------------------------------------------------ gap adapter

describe("the process map of the gap interview", () => {
  const p = baseProject();
  const instances = visibleInstances(content, p, "paired");

  it("has Scope and site first and counts equal progress() per section: the same total, and answered plus to-be-decided", () => {
    const m = buildProcessMap(gapMapInput(content, p, instances, W));
    expect(m.nodes[0]).toMatchObject({ id: "whole", label: "Scope and site" });
    const prog = progress(content, p, instances);
    for (const s of prog) {
      const node = s.section.kind === "uo" ? m.nodes.find((n) => n.id === `step:${s.section.uo}`) : undefined;
      if (!node) continue;
      expect(node.counts.total, s.section.id).toBe(s.total);
      expect(node.counts.answered + node.counts.tbd, s.section.id).toBe(s.answered);
      expect(node.counts.tbd, s.section.id).toBe(s.tbd);
    }
    const whole = prog.filter((s) => s.section.kind !== "uo");
    expect(m.nodes[0]!.counts.total).toBe(whole.reduce((a, s) => a + s.total, 0));
    expect(m.totals.total).toBe(instances.length);
  });

  it("counts a to-be-decided answer as open and says so apart, where progress() calls it answered", () => {
    const m = buildProcessMap(gapMapInput(content, p, instances, W));
    const tbdTotal = m.totals.tbd;
    expect(m.totals.answered + m.totals.open).toBe(m.totals.total);
    expect(m.totals.tbd).toBe(tbdTotal);
    if (tbdTotal > 0) expect(m.nodes.some((n) => n.status === "to_be_decided")).toBe(true);
  });

  it("shows a step left out in Scope as a node with the reason and a step that an answer puts out as left out too", () => {
    const left = excludeStep(content, p, "capping", "Capped elsewhere (fictional)", who);
    const m = buildProcessMap(gapMapInput(content, left, visibleInstances(content, left, "paired"), W));
    const n = m.nodes.find((x) => x.id === "step:capping")!;
    expect(n.status).toBe("left_out");
    expect(n.leftOutCause).toBe("scope");
    expect(n.reason).toBe("Capped elsewhere (fictional)");
    expect(n.questionKeys).toEqual([]);
    // The demo is a liquid product, so its answers put stoppering out too; the gap interview does not ask about it.
    const na = m.nodes.find((x) => x.id === "step:stoppering")!;
    expect(na).toMatchObject({ status: "left_out", leftOutCause: "answer", reason: "Dosage form is Liquid solution" });
  });
});

// ------------------------------------------------------------------ facility edits

describe("facility area edits", () => {
  it("adds an area with no grade and no steps unless given, ids AR-01 up, one change-log event each, ids never reused", () => {
    const p0 = blank();
    const a = addFacilityArea(content, p0, "ru", { name: "  Filling room (fictional) " }, who);
    expect(a.areaId).toBe("AR-01");
    expect(facilityAreas(a.project, "ru")).toEqual([{ id: "AR-01", name: "Filling room (fictional)", stepKeys: [], createdAt: T, updatedAt: T }]);
    expect(events(p0, a.project)).toHaveLength(1);
    expect(events(p0, a.project)[0]).toMatchObject({ action: "facility_area_add", path: "facility.AR-01" });
    const b = addFacilityArea(content, a.project, "su", { name: "Other room", grade: "C", stepKeys: ["compounding"] }, who);
    expect(b.areaId).toBe("AR-02");
    expect(facilityAreas(b.project, "su")[0]).toMatchObject({ grade: "C", stepKeys: ["compounding"] });
    // Remove the last one: its number is still taken because the change log remembers it.
    const gone = removeFacilityArea(b.project, "AR-02", "Not used any more", who);
    expect(addFacilityArea(content, gone, "su", { name: "Third" }, who).areaId).toBe("AR-03");
  });

  it("refuses an empty name and a step that does not exist, and leaves the project as it was", () => {
    const p0 = blank();
    expect(() => addFacilityArea(content, p0, "ru", { name: "   " }, who)).toThrow(FacilityError);
    expect(() => addFacilityArea(content, p0, "ru", { name: "Room", stepKeys: ["no_such_step"] }, who)).toThrow(/not a process step/);
    expect(p0.facility).toBeUndefined();
  });

  it("accepts a custom step of the project as a step of an area", () => {
    const p0 = blank();
    const custom = { ...p0, custom: { ...p0.custom, unitOperations: [{ key: "custom_wash", label: "Extra wash (fictional)", sequence: 55, createdBy: "x", createdAt: T }] } };
    const r = addFacilityArea(content, custom, "ru", { name: "Wash room", stepKeys: ["custom_wash"] }, who);
    expect(facilityAreas(r.project, "ru")[0]!.stepKeys).toEqual(["custom_wash"]);
  });

  it("renames, grades and nests; one event each, the old content is kept; the same value again changes nothing and logs nothing", () => {
    let p = addFacilityArea(content, blank(), "ru", { name: "Filling room" }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Isolator" }, who).project;
    const before = p;
    p = renameFacilityArea(p, "AR-01", "Filling suite", later);
    p = setFacilityAreaGrade(p, "AR-01", "B", later);
    p = nestFacilityArea(p, "AR-02", "AR-01", later);
    p = setFacilityAreaGrade(p, "AR-02", "A", later);
    const ev = events(before, p);
    expect(ev.map((e) => e.action)).toEqual(["facility_area_update", "facility_area_update", "facility_area_update", "facility_area_update"]);
    expect((ev[0]!.before as { name: string }).name).toBe("Filling room");
    expect((ev[0]!.after as { name: string }).name).toBe("Filling suite");
    expect(facilityAreaOf(p, "AR-01")).toMatchObject({ name: "Filling suite", grade: "B", updatedAt: T2 });
    expect(facilityAreaOf(p, "AR-02")).toMatchObject({ grade: "A", insideAreaId: "AR-01" });
    const again = setFacilityAreaGrade(renameFacilityArea(p, "AR-01", "Filling suite", later), "AR-01", "B", later);
    expect(again).toBe(p);
    expect(again.changeLog).toHaveLength(p.changeLog.length);
  });

  it("clears a grade and a parent with null, so unknown stays visible", () => {
    let p = addFacilityArea(content, blank(), "ru", { name: "A room", grade: "D" }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "In it", insideAreaId: "AR-01" }, who).project;
    p = updateFacilityArea(p, "AR-01", { grade: null }, who);
    p = nestFacilityArea(p, "AR-02", null, who);
    expect(facilityAreaOf(p, "AR-01").grade).toBeUndefined();
    expect(facilityAreaOf(p, "AR-02").insideAreaId).toBeUndefined();
    expect(() => parseRoundTrip(p)).not.toThrow();
  });

  it("refuses an area inside itself, inside the other unit's area, and a cycle", () => {
    let p = addFacilityArea(content, blank(), "ru", { name: "One" }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Two", insideAreaId: "AR-01" }, who).project;
    p = addFacilityArea(content, p, "su", { name: "Sending room" }, who).project;
    expect(() => nestFacilityArea(p, "AR-01", "AR-01", who)).toThrow(/inside itself/);
    expect(() => nestFacilityArea(p, "AR-01", "AR-03", who)).toThrow(/same unit/);
    expect(() => nestFacilityArea(p, "AR-01", "AR-02", who)).toThrow(/inside/); // AR-02 already sits inside AR-01
    expect(() => updateFacilityArea(p, "AR-01", { name: "  " }, who)).toThrow(FacilityError);
    expect(() => renameFacilityArea(p, "AR-77", "x", who)).toThrow(/does not exist/);
  });

  it("places steps; one step can be in several areas, and placing it in one never takes it out of another", () => {
    let p = addFacilityArea(content, blank(), "ru", { name: "Thaw room 1" }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Thaw room 2" }, who).project;
    p = setFacilityAreaSteps(content, p, "AR-01", ["ds_receipt_thaw", "buffer_prep", "ds_receipt_thaw"], who); // a repeat is kept once
    const before = p;
    p = setFacilityAreaSteps(content, p, "AR-02", ["ds_receipt_thaw"], who);
    expect(facilityAreaOf(p, "AR-01").stepKeys).toEqual(["ds_receipt_thaw", "buffer_prep"]);
    expect(facilityAreaOf(p, "AR-02").stepKeys).toEqual(["ds_receipt_thaw"]);
    expect(events(before, p)).toHaveLength(1);
    expect(events(before, p)[0]).toMatchObject({ action: "facility_area_steps", before: { stepKeys: [] }, after: { stepKeys: ["ds_receipt_thaw"] } });
    expect(setFacilityAreaSteps(content, p, "AR-02", ["ds_receipt_thaw"], who)).toBe(p);
    expect(() => setFacilityAreaSteps(content, p, "AR-02", ["nope"], who)).toThrow(/not a process step/);
  });

  it("removes only with a reason, keeps the old area and the reason in the log, frees its steps and takes no answer with it", () => {
    let p = addFacilityArea(content, blank(), "ru", { name: "Filling room", stepKeys: ["stoppering"] }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Isolator", insideAreaId: "AR-01", stepKeys: ["aseptic_filling", "stoppering"] }, who).project;
    expect(() => removeFacilityArea(p, "AR-01", "", who)).toThrow(/Say why/);
    expect(() => removeFacilityArea(p, "AR-01", "   ", who)).toThrow(FacilityError);
    expect(() => removeFacilityArea(p, "AR-09", "Reason", who)).toThrow(/does not exist/);
    const q = removeFacilityArea(p, "AR-01", "Room was merged into the isolator suite", later);
    expect(facilityAreas(q, "ru").map((a) => a.id)).toEqual(["AR-02"]);
    expect(facilityAreaOf(q, "AR-02").insideAreaId).toBeUndefined(); // an area inside it becomes a top-level area
    expect(events(p, q)).toHaveLength(1);
    const ev = events(p, q)[0]!;
    expect(ev).toMatchObject({ action: "facility_area_remove", path: "facility.AR-01", after: { reason: "Room was merged into the isolator suite" } });
    expect(ev.detail).toContain("Room was merged into the isolator suite");
    expect(ev.before).toMatchObject({ id: "AR-01", name: "Filling room", stepKeys: ["stoppering"], areasInsideIt: ["AR-02"] });
    expect(q.processes).toEqual(p.processes); // no answer is touched
    expect(q.answers).toEqual(p.answers);
  });

  it("keeps the two units apart: each has its own list, and ids are unique across both", () => {
    let p = addFacilityArea(content, blank(), "su", { name: "Sending room" }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Receiving room" }, who).project;
    expect(facilityAreas(p, "su").map((a) => a.id)).toEqual(["AR-01"]);
    expect(facilityAreas(p, "ru").map((a) => a.id)).toEqual(["AR-02"]);
    expect(() => parseRoundTrip(p)).not.toThrow();
  });

  it("never writes into another document: a project with areas has the same TRD, plan, risk and records as one without", () => {
    const base = blank();
    const p = addFacilityArea(content, base, "ru", { name: "Room", stepKeys: ["compounding"] }, who).project;
    for (const part of ["trd", "mbr", "risk", "sampling", "processes", "excipients", "stepScope"] as const) expect(p[part], part).toEqual(base[part]);
  });
});

/** The whole project must still parse (the facility part obeys its schema) and come back equal. */
const parseRoundTrip = (p: Project): Project => parseProject(JSON.parse(JSON.stringify(p)));

// ------------------------------------------------------------------ example layout

describe("the example layout", () => {
  it("is offered, never applied by itself: names and steps only, no grade, every step a real unit operation", () => {
    const keys = content.catalog.unitOperations.map((u) => u.key);
    expect(interviewMapExample.areas.length).toBeGreaterThanOrEqual(5);
    for (const a of interviewMapExample.areas) {
      expect(Object.keys(a).sort()).toEqual(a.inside ? ["inside", "name", "steps"] : ["name", "steps"]);
      for (const s of a.steps) expect(keys).toContain(s);
    }
    expect(JSON.stringify(exampleRaw)).not.toMatch(/grade/i);
    expect(interviewMapExample.note).toBe(W.explain.exampleNote);
    expect(interviewMapExample.areas.some((a) => a.inside)).toBe(true); // the isolator inside a room
  });

  it("copies into a unit as the person's own draft: marked from the example, no grade, nesting kept, one event", () => {
    const p0 = blank();
    const p = useFacilityExample(content, p0, "ru", interviewMapExample, who);
    const areas = facilityAreas(p, "ru");
    expect(areas).toHaveLength(interviewMapExample.areas.length);
    expect(areas.every((a) => a.fromExample === true && a.grade === undefined)).toBe(true);
    const inner = interviewMapExample.areas.find((a) => a.inside)!;
    const innerArea = areas.find((a) => a.name === inner.name)!;
    expect(areas.find((a) => a.id === innerArea.insideAreaId)?.name).toBe(inner.inside);
    expect(events(p0, p)).toHaveLength(1);
    expect(events(p0, p)[0]!.action).toBe("facility_example_use");
    expect(facilityAreas(p, "su")).toEqual([]);
  });

  it("can be used for both units, with ids that do not clash, but not on top of a unit's own list", () => {
    const p = useFacilityExample(content, useFacilityExample(content, blank(), "ru", interviewMapExample, who), "su", interviewMapExample, who);
    const ids = [...facilityAreas(p, "su"), ...facilityAreas(p, "ru")].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => useFacilityExample(content, p, "ru", interviewMapExample, who)).toThrow(/no areas yet/);
  });

  it("is checked by the person one area at a time: editing or confirming ends the mark; confirming twice logs once", () => {
    const p = useFacilityExample(content, blank(), "ru", interviewMapExample, who);
    const one = confirmFacilityExampleArea(p, "AR-01", later);
    expect(facilityAreaOf(one, "AR-01").fromExample).toBeUndefined();
    expect(events(p, one)).toHaveLength(1);
    expect(confirmFacilityExampleArea(one, "AR-01", later)).toBe(one);
    const edited = setFacilityAreaGrade(p, "AR-02", "C", later);
    expect(facilityAreaOf(edited, "AR-02").fromExample).toBeUndefined();
    expect(facilityAreaOf(edited, "AR-03").fromExample).toBe(true);
    const stepped = setFacilityAreaSteps(content, p, "AR-03", ["compounding"], later);
    expect(facilityAreaOf(stepped, "AR-03").fromExample).toBeUndefined();
  });

  it("refuses an example with a grade, an unknown step, an unknown parent or a repeated name", () => {
    const keys = content.catalog.unitOperations.map((u) => u.key);
    const ok = { version: "1.0.0", note: "n", areas: [{ name: "A", steps: ["compounding"] }] };
    expect(() => parseExampleLayout(ok, keys)).not.toThrow();
    expect(() => parseExampleLayout({ ...ok, areas: [{ name: "A", grade: "B", steps: [] }] }, keys)).toThrow();
    expect(() => parseExampleLayout({ ...ok, areas: [{ name: "A", steps: ["nope"] }] }, keys)).toThrow(/unknown unit operation/);
    expect(() => parseExampleLayout({ ...ok, areas: [{ name: "A", inside: "B", steps: [] }] }, keys)).toThrow(/not another area/);
    expect(() => parseExampleLayout({ ...ok, areas: [{ name: "A", steps: [] }, { name: "A", steps: [] }] }, keys)).toThrow(/twice/);
  });
});

// ------------------------------------------------------------------ area map

describe("the facility-areas map", () => {
  const { project, trdId } = fullTrd();
  const qs = trdQuestions(project, trdId);
  const input = trdMapInput(content, project, qs, W);

  function withAreas(): Project {
    let p = project;
    p = addFacilityArea(content, p, "ru", { name: "Compounding room", grade: "D", stepKeys: ["buffer_prep", "compounding"] }, who).project; // AR-01
    p = addFacilityArea(content, p, "ru", { name: "Filling room", grade: "B", stepKeys: ["capping"] }, who).project; // AR-02
    p = addFacilityArea(content, p, "ru", { name: "Filling isolator", grade: "A", insideAreaId: "AR-02", stepKeys: ["aseptic_filling", "capping"] }, who).project; // AR-03
    p = addFacilityArea(content, p, "ru", { name: "Spare room" }, who).project; // AR-04: no steps
    return p;
  }

  it("is empty when the unit has no areas: nothing is filled in", () => {
    const m = buildAreaMap(input, [], W);
    expect(m).toMatchObject({ view: "areas", nodes: [], empty: true });
  });

  it("makes a card per area in the user's order, nests an area inside its parent, and says a room with no steps has none", () => {
    const p = withAreas();
    const m = buildAreaMap(input, facilityAreas(p, "ru"), W);
    expect(m.nodes[0]).toMatchObject({ id: "whole", label: "About the whole site" });
    const areaNodes = m.nodes.filter((n) => n.kind === "area");
    expect(areaNodes.map((n) => n.label)).toEqual(["Compounding room", "Filling room", "Filling isolator", "Spare room"]);
    expect(areaNodes[2]).toMatchObject({ parentId: "area:AR-02", depth: 1, grade: "A" });
    expect(areaNodes[1]).toMatchObject({ depth: 0 });
    const spare = areaNodes[3]!;
    expect(spare.steps).toEqual([]);
    expect(spare.status).toBe("nothing_to_ask");
    expect(mapStatusText(spare, W)).toBe("No questions here");
    expect(mapNodeName(areaNodes[0]!, W)).toBe(`Compounding room, Grade D, ${mapCountsText(areaNodes[0]!.counts, W)}`);
    expect(mapNodeName({ ...spare, grade: undefined }, W)).toContain("Grade not stated");
  });

  it("gathers exactly the steps that are in no area in 'Not placed in an area yet', so every question stays reachable", () => {
    const p = withAreas();
    const m = buildAreaMap(input, facilityAreas(p, "ru"), W);
    const unplaced = m.nodes.find((n) => n.kind === "unplaced")!;
    expect(unplaced.label).toBe("Not placed in an area yet");
    const placed = new Set(facilityAreas(p, "ru").flatMap((a) => a.stepKeys));
    const wantKeys = input.steps.filter((s) => !placed.has(s.key)).map((s) => s.key);
    expect(unplaced.steps!.map((s) => s.key).sort()).toEqual([...wantKeys].sort());
    expect(mapStatusStyle(unplaced)).toEqual({ icon: "question", border: "dashed" });
    // Every question of the interview is reachable from some node.
    const reachable = new Set(m.nodes.flatMap((n) => n.questionKeys));
    const out = new Set(input.steps.filter((s) => s.leftOut).map((s) => s.key));
    for (const q of input.questions.filter((x) => !x.detail && !(x.stepKey && out.has(x.stepKey)))) expect(reachable.has(q.key), q.key).toBe(true);
  });

  it("counts a step done in two areas once in the totals, and shows it under both with 'also done in'", () => {
    const p = withAreas();
    const areas = facilityAreas(p, "ru");
    const m = buildAreaMap(input, areas, W);
    const room = m.nodes.find((n) => n.id === "area:AR-02")!;
    const isolator = m.nodes.find((n) => n.id === "area:AR-03")!;
    const cappingInRoom = room.steps!.find((s) => s.key === "capping")!;
    expect(cappingInRoom.alsoIn).toEqual(["Filling isolator"]);
    expect(mapAlsoDoneInText(cappingInRoom, W)).toBe("also done in Filling isolator");
    expect(isolator.steps!.find((s) => s.key === "capping")!.alsoIn).toEqual(["Filling room"]);
    const cappingCount = buildProcessMap(input).nodes.find((n) => n.id === "step:capping")!.counts.total;
    expect(cappingCount).toBeGreaterThan(0);
    // The two cards both show the step's questions...
    expect(room.counts.total).toBe(cappingCount);
    expect(isolator.counts.total).toBe(buildProcessMap(input).nodes.find((n) => n.id === "step:aseptic_filling")!.counts.total + cappingCount);
    // ...and the totals are the same as the process map's: every question once.
    expect(m.totals).toEqual(buildProcessMap(input).totals);
  });

  it("frees the steps of a removed area, and the totals do not change", () => {
    const p = withAreas();
    const q = removeFacilityArea(p, "AR-01", "Room closed", who);
    const m = buildAreaMap(input, facilityAreas(q, "ru"), W);
    const unplaced = m.nodes.find((n) => n.kind === "unplaced")!;
    expect(unplaced.steps!.map((s) => s.key)).toEqual(expect.arrayContaining(["buffer_prep", "compounding"]));
    expect(m.totals).toEqual(buildProcessMap(input).totals);
  });

  it("shows a left-out step under its area as left out, with no questions, and an area of only left-out steps as left out", () => {
    const left = project; // the demo is a liquid product, so its answers already put stoppering out of the process
    const withLeft = trdMapInput(content, left, qs.filter((q) => q.stepKey !== "stoppering"), W);
    let p = addFacilityArea(content, left, "ru", { name: "Filling room", stepKeys: ["stoppering"] }, who).project;
    p = addFacilityArea(content, p, "ru", { name: "Compounding room", stepKeys: ["compounding"] }, who).project;
    const m = buildAreaMap(withLeft, facilityAreas(p, "ru"), W);
    const room = m.nodes.find((n) => n.id === "area:AR-01")!;
    expect(room.steps![0]).toMatchObject({ key: "stoppering", leftOut: true });
    expect(room.status).toBe("left_out");
    expect(room.questionKeys).toEqual([]);
    expect(m.nodes.find((n) => n.id === "area:AR-02")!.status).not.toBe("left_out");
  });

  it("works for the gap interview too, and for the sending unit's own list", () => {
    const p = baseProject();
    const gap = gapMapInput(content, p, visibleInstances(content, p, "paired"), W);
    let q = addFacilityArea(content, p, "su", { name: "Sending filling room", stepKeys: ["aseptic_filling"] }, who).project;
    q = addFacilityArea(content, q, "ru", { name: "Receiving filling room", stepKeys: ["sterile_filtration"] }, who).project;
    const su = buildAreaMap(gap, facilityAreas(q, "su"), W);
    const ru = buildAreaMap(gap, facilityAreas(q, "ru"), W);
    expect(su.nodes.find((n) => n.kind === "area")!.label).toBe("Sending filling room");
    expect(ru.nodes.find((n) => n.kind === "area")!.label).toBe("Receiving filling room");
    expect(su.totals).toEqual(ru.totals);
    expect(su.nodes[0]).toMatchObject({ id: "whole", label: "About the whole site" });
  });

  it("names the areas a step is done in on the process map, for the tile's accessible name", () => {
    const p = withAreas();
    const m = buildProcessMap(input, { areas: facilityAreas(p, "ru") });
    const n = m.nodes.find((x) => x.id === "step:capping")!;
    expect(n.areaNames).toEqual(["Filling room", "Filling isolator"]);
    expect(mapNodeName(n, W)).toContain("in Filling room, Filling isolator");
  });

  it("builds the run messages from the same words", () => {
    const n = buildProcessMap(input).nodes.find((x) => x.id === "step:sterile_filtration")!;
    expect(mapBackOnMapText(n, W)).toBe(`Back on the map. ${n.label}: ${mapCountsText(n.counts, W)}.`);
    expect(mapEndOfNodeText(n, W)).toBe(`That was the last question in ${n.label}. ${n.counts.open} left open.`);
  });

  it("lists a step with no question as 'No questions here'", () => {
    const m = buildProcessMap({ ...stepsInput("a"), questions: [] });
    expect(m.nodes[0]!.status).toBe("nothing_to_ask");
    expect(m.nodes[0]!.number).toBe(1);
  });
});

// ------------------------------------------------------------------ content

describe("content/interview-map", () => {
  const strings = (o: unknown, path = ""): [string, string][] =>
    typeof o === "string" ? [[path, o]] : Array.isArray(o) || typeof o !== "object" || o === null ? [] : Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  const all = strings({ ...W, changelog: undefined });

  it("keeps every text short (140 characters, 260 for the explain block) and plain", () => {
    for (const [k, v] of all) expect(v.length, k).toBeLessThanOrEqual(k.startsWith("explain.") ? 260 : 140);
  });

  it("uses none of the banned words, names no filing category and uses no private term", () => {
    const text = JSON.stringify(wordingRaw) + JSON.stringify(exampleRaw);
    expect(text).not.toMatch(/\b(wizard|validate|validates|validated|required|requires|must|error|errors|non-?compliant)\b/i);
    expect(text).not.toMatch(/\b(variation|supplement|notification|type i[ab]?|prior approval)\b/i);
    expectNoPrivateTerms(text);
  });

  it("holds exactly the placeholders each template needs, and the reader refuses a wrong one", () => {
    expect(() => parseInterviewMapWording(wordingRaw)).not.toThrow();
    const bad = JSON.parse(JSON.stringify(wordingRaw));
    bad.status.someOpen = "{answered} of {total} answered";
    expect(() => parseInterviewMapWording(bad)).toThrow(/missing \{open\}/);
    bad.status.someOpen = "{answered} of {total} answered, {open} open, {nope}";
    expect(() => parseInterviewMapWording(bad)).toThrow(/\{nope\}/);
    const extra = JSON.parse(JSON.stringify(wordingRaw));
    extra.status.unknownKey = "x";
    expect(() => parseInterviewMapWording(extra)).toThrow();
  });

  it("uses the words of the spec: view names, status words and the empty state", () => {
    expect([W.views.list, W.views.process, W.views.areas]).toEqual(["List", "Process steps", "Facility areas"]);
    expect(W.views.groupLabel).toBe("Show the questions as");
    expect(W.status.leftOut).toBe("Left out of this project");
    expect(W.status.notPlaced).toBe("Not placed in an area yet");
    expect(W.areas.noStepsHere).toBe("No steps placed here yet");
    expect(W.areas.fromExample).toBe("From the example, please check");
    expect(W.explain.emptyAreas).toContain("This is optional");
    expect([W.explain.addFirst, W.explain.startExample]).toEqual(["Add the first area", "Start from an example layout"]);
  });

  it("has the words of the TRD map screens (job 2): the legend says every mark in words, the run line, the template headings view", () => {
    expect(W.legend.title).toBe("What the marks mean");
    for (const t of [W.legend.allAnswered, W.legend.someOpen, W.legend.tbd, W.legend.none, W.legend.notPlaced]) expect(t, t).toMatch(/border/);
    expect(W.views.processHeadings).toBe("Your template's headings");
    expect(W.areas.inside).toContain("{area}");
    for (const t of [W.run.showingAll, W.run.showingOpen, W.run.showingConfirm]) expect(t).toContain("{label}");
    const bad = JSON.parse(JSON.stringify(wordingRaw));
    bad.run.showingOpen = "Showing only the questions still open";
    expect(() => parseInterviewMapWording(bad)).toThrow(/missing {label}/);
  });
});
