// M15 job 1: the "template first" start path of the TRD, engine and data. The stored Word template choice (schema 1.34.0), the interview that
// follows the project's process-steps checklist, and where an answer lands in the document. Fictional data only.
import {
  TrdError,
  addCheckedSteps,
  applyTrdAnswer,
  buildProcessMap,
  buildDemoProject,
  clearTrdTemplateChoice,
  createTrd,
  deriveTrdQuestions,
  excludeStep,
  includeStep,
  mapStatusText,
  setTrdTemplateChoice,
  trdAnswerPlaces,
  trdFollowsChecklist,
  trdInterviewProgress,
  trdLeftOutSteps,
  trdMapInput,
  trdStepsToAdd,
  trdTemplateChoiceText,
  type InterviewQuestion,
} from "@gap/engine";
import { SCHEMA_VERSION, parseProject, trdTemplateChoiceSchema, type Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, interviewMapWording as W, trdInterviewWording, trdWriteups } from "../index";

vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-10T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const later = { name: "Sam Sample (fictional)", at: "2026-11-10T10:00:00.000Z" };

function baseProject(): Project {
  const p = buildDemoProject(content, demos["arx-217"] as never);
  return { ...p, trd: { documents: [] }, changeLog: p.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
}
/** A blank TRD made the way the start path makes it: no steps yet, the library's prose write-ups, and a Word template choice. */
function started(choice: Parameters<typeof setTrdTemplateChoice>[2] = { kind: "later" }): { project: Project; trdId: string } {
  const r = createTrd(baseProject(), { title: "Start path TRD (fictional)", start: { kind: "blank" }, library: trdWriteups }, who);
  return { project: setTrdTemplateChoice(r.project, r.trdId, choice, who), trdId: r.trdId };
}
const ctx = { content, library: trdWriteups };
const qsOf = (p: Project, id: string): InterviewQuestion[] => deriveTrdQuestions(p, id, { content, wording: trdInterviewWording });
const presence = (qs: InterviewQuestion[]) => qs.filter((q) => q.target.kind === "presence");
const doc = (p: Project, id: string) => p.trd.documents.find((d) => d.id === id)!;

describe("schema 1.34.0: the stored Word template choice", () => {
  it("is schema 1.34.0 and a 1.33.0 project opens with only the version changed", () => {
    expect(SCHEMA_VERSION).toBe("1.34.0");
    const base = JSON.parse(JSON.stringify(baseProject()));
    const old = { ...base, schemaVersion: "1.33.0" };
    const once = parseProject(old);
    expect(once.schemaVersion).toBe("1.34.0");
    expect(once.trd).toEqual(base.trd);
    expect(parseProject(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("a TRD made before has no choice recorded, and the schema takes the five kinds only", () => {
    const r = createTrd(baseProject(), { title: "Old TRD (fictional)", start: { kind: "blank" }, library: trdWriteups }, who);
    expect(doc(r.project, r.trdId).templateChoice).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(r.project))).trd.documents[0]!.templateChoice).toBeUndefined();
    const ok = { chosenAt: T, chosenBy: "A" };
    for (const kind of ["later", "builtin", "their_look", "mapped", "tags"]) expect(trdTemplateChoiceSchema.safeParse({ kind, ...ok }).success).toBe(true);
    expect(trdTemplateChoiceSchema.safeParse({ kind: "other", ...ok }).success).toBe(false);
  });
});

describe("editing the stored choice", () => {
  it("remembers who chose, and when, and survives a save and open", () => {
    const { project, trdId } = started({ kind: "builtin" });
    expect(doc(project, trdId).templateChoice).toEqual({ kind: "builtin", chosenAt: T, chosenBy: who.name });
    expect(parseProject(JSON.parse(JSON.stringify(project))).trd.documents[0]!.templateChoice?.kind).toBe("builtin");
    expect(trdTemplateChoiceText(doc(project, trdId).templateChoice)).toBe("Built-in default");
  });

  it("Decide later is a choice that stays visible as open, never a default", () => {
    const { project, trdId } = started({ kind: "later" });
    expect(trdTemplateChoiceText(doc(project, trdId).templateChoice)).toBe("Decide later (still open)");
    expect(trdTemplateChoiceText(undefined)).toBe("Not chosen yet");
  });

  it("a kind that uses a template must name it, and keeps its name and version", () => {
    const { project, trdId } = started();
    expect(() => setTrdTemplateChoice(project, trdId, { kind: "tags" }, who)).toThrow(TrdError);
    const p = setTrdTemplateChoice(project, trdId, { kind: "their_look", templateId: "tpl-1", templateName: "Site layout (fictional)", templateVersion: "2" }, later);
    expect(trdTemplateChoiceText(doc(p, trdId).templateChoice)).toBe("A template's look: Site layout (fictional) (version 2)");
    expect(doc(p, trdId).templateChoice).toMatchObject({ templateId: "tpl-1", chosenBy: later.name });
  });

  it("the same pick twice changes nothing and logs nothing; a change keeps the old choice in the log", () => {
    const { project, trdId } = started({ kind: "builtin" });
    expect(setTrdTemplateChoice(project, trdId, { kind: "builtin" }, later)).toBe(project);
    const p = setTrdTemplateChoice(project, trdId, { kind: "later" }, later);
    const ev = p.changeLog.at(-1)!;
    expect(ev.action).toBe("trd_template_set");
    expect(ev.before).toMatchObject({ kind: "builtin" });
    expect(ev.after).toMatchObject({ kind: "later" });
  });

  it("can be removed, with a reason in the change log", () => {
    const { project, trdId } = started({ kind: "builtin" });
    const p = clearTrdTemplateChoice(project, trdId, "Picked the wrong one", later);
    expect(doc(p, trdId).templateChoice).toBeUndefined();
    const ev = p.changeLog.at(-1)!;
    expect(ev.action).toBe("trd_template_clear");
    expect(ev.detail).toContain("Picked the wrong one");
    expect(ev.before).toMatchObject({ kind: "builtin" });
    expect(clearTrdTemplateChoice(p, trdId, "again", later)).toBe(p);
  });
});

describe("the interview follows the project's process-steps checklist", () => {
  const allOps = content.catalog.unitOperations;

  it("a TRD with no recorded choice behaves as before: every step is asked about", () => {
    const r = createTrd(baseProject(), { title: "Old TRD (fictional)", start: { kind: "blank" }, library: trdWriteups }, who);
    expect(trdFollowsChecklist(doc(r.project, r.trdId))).toBe(false);
    const left = excludeStep(content, r.project, "capping", "Capped elsewhere (fictional)", who);
    expect(presence(qsOf(left, r.trdId)).length).toBe(allOps.length);
    expect(trdLeftOutSteps(content, left, r.trdId)).toEqual([]);
    expect(trdStepsToAdd(content, left, r.trdId)).toEqual([]);
  });

  it("a ticked step is performed: its 'performed' question is not asked, and its steps are added once", () => {
    const { project, trdId } = started();
    expect(trdFollowsChecklist(doc(project, trdId))).toBe(true);
    expect(presence(qsOf(project, trdId))).toEqual([]);
    // Steps the answers put out of scope (not applicable) are not added.
    const toAdd = trdStepsToAdd(content, project, trdId);
    expect(toAdd.length).toBeGreaterThan(0);
    expect(toAdd.length).toBeLessThanOrEqual(allOps.length);
    const p = addCheckedSteps(project, trdId, who, ctx);
    expect(doc(p, trdId).steps.map((s) => s.key)).toEqual(toAdd);
    expect(trdStepsToAdd(content, p, trdId)).toEqual([]);
    expect(addCheckedSteps(p, trdId, later, ctx)).toBe(p); // nothing to add: nothing changes and nothing is logged
    const qs = qsOf(p, trdId);
    expect(presence(qs)).toEqual([]);
    // The other questions of a ticked step do show.
    expect(qs.some((q) => q.stepKey === "capping")).toBe(true);
    // Presence is never written as an answer: the tick is the statement.
    expect(doc(p, trdId).steps.every((s) => !s.fields.some((f) => f.key === "presence"))).toBe(true);
  });

  it("a step left out has no questions, is listed with its reason, and keeps what was answered", () => {
    const { project, trdId } = started();
    let p = addCheckedSteps(project, trdId, who, ctx);
    const target = qsOf(p, trdId).find((q) => q.stepKey === "capping" && q.input === "text");
    expect(target, "a question to answer in the capping step").toBeDefined();
    const answered = applyTrdAnswer(p, trdId, target!, { kind: "value", value: "A fictional answer" }, who, ctx);
    expect(answered.error).toBeUndefined();
    p = answered.project;
    const before = JSON.stringify(doc(p, trdId).steps);
    const total = qsOf(p, trdId).length;

    p = excludeStep(content, p, "capping", "Capped elsewhere (fictional)", later);
    const qs = qsOf(p, trdId);
    expect(qs.some((q) => q.stepKey === "capping")).toBe(false);
    expect(qs.length).toBeLessThan(total);
    // Steps the answers put out of scope are listed too, with their own cause.
    expect(trdLeftOutSteps(content, p, trdId).find((s) => s.key === "capping")).toEqual({ key: "capping", label: expect.any(String), cause: "scope", reason: "Capped elsewhere (fictional)", hasAnswers: true });
    // Nothing is deleted: the TRD still holds the step and its answer.
    expect(JSON.stringify(doc(p, trdId).steps)).toBe(before);

    // Ticked again: the questions come back, with the answer that was given.
    p = includeStep(content, p, "capping", later);
    const back = qsOf(p, trdId);
    expect(back.length).toBe(total);
    expect(back.find((q) => q.key === target!.key)?.state).toBe("answered");
    expect(trdLeftOutSteps(content, p, trdId).some((s) => s.key === "capping")).toBe(false);
  });

  it("a left-out step is not re-added, and the progress counts and the process map agree with the list", () => {
    const { project, trdId } = started();
    let p = excludeStep(content, project, "capping", "Capped elsewhere (fictional)", who);
    expect(trdStepsToAdd(content, p, trdId)).not.toContain("capping");
    p = addCheckedSteps(p, trdId, who, ctx);
    expect(doc(p, trdId).steps.some((s) => s.key === "capping")).toBe(false);
    const qs = qsOf(p, trdId);
    const progress = trdInterviewProgress(qs);
    expect(progress.overall.essentials.total + progress.overall.moreDetail.total).toBe(qs.length);
    const map = buildProcessMap(trdMapInput(content, p, qs, W));
    const node = map.nodes.find((n) => n.id === "step:capping");
    expect(node?.status).toBe("left_out");
    expect(mapStatusText(node!, W)).toBe("Left out of this project: Capped elsewhere (fictional)");
    expect(map.nodes.filter((n) => n.kind === "step" && n.status !== "left_out").every((n) => n.counts.total > 0 || n.status === "nothing_to_ask")).toBe(true);
  });

  it("a TRD that itself says 'not performed' keeps that question, so a tick never overrides what was written", () => {
    const { project, trdId } = started();
    let p = addCheckedSteps(project, trdId, who, ctx);
    const step = doc(p, trdId).steps.find((s) => s.key === "capping")!;
    p = applyTrdAnswer(p, trdId, { key: "step:capping.presence", target: { kind: "presence", unitOp: "capping" }, stepKey: "capping", stepLabel: step.label } as never, { kind: "presence", performed: false }, who, ctx).project;
    expect(presence(qsOf(p, trdId)).map((q) => q.stepKey)).toEqual(["capping"]);
  });
});

describe("where an answer lands in the document", () => {
  it("names the section as the document numbers it, and has none for the cover page details", () => {
    const { project, trdId } = started();
    const p = addCheckedSteps(project, trdId, who, ctx);
    const qs = qsOf(p, trdId);
    const places = trdAnswerPlaces(p, doc(p, trdId), qs, content);
    const some = qs.find((q) => q.stepKey === "capping" && q.usedIn.length > 0)!;
    const place = places.get(some.key)!;
    expect(place.number).toMatch(/^\d+(\.\d+)?$/);
    expect(place.heading.length).toBeGreaterThan(0);
    expect(place.sectionId.length).toBeGreaterThan(0);
    for (const q of qs.filter((x) => x.target.kind === "detail" || x.target.kind === "document")) expect(places.has(q.key)).toBe(false);
  });
});