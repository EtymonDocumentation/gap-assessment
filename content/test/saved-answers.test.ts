// Saved answer sets: save from a project, review against another, apply with provenance (schema 1.26.0).
import {
  applyAnswer,
  applySavedSet,
  buildDemoProject,
  buildSavedSet,
  reviewSavedSet,
  savedSetOf,
  visibleInstances,
  type AnswerInput,
  type QuestionInstance,
} from "@gap/engine";
import { emptyProject, getEntry, parseProject, parseSavedAnswerSet, SCHEMA_VERSION, type Actor, type Project } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const T0 = "2026-10-31T09:00:00.000Z";
const actor: Actor = { name: "Test Person (fictional)", at: T0 };
// Built once: the functions under test never change the project they are given (they return a copy), and building the demo is slow.
const DEMO = buildDemoProject(content, demos["arx-217"]);
const demo = (): Project => DEMO;
const blank = (): Project => emptyProject({ title: "Blank (fictional)", actor, contentRefs: content.versions });

const insts = (p: Project) => visibleInstances(content, p, "paired");
/** The first visible yes/no question on the given side that the demo has answered with a plain value. */
function answeredInst(p: Project, side: "source" | "target"): QuestionInstance {
  const i = insts(p).find((x) => x.side === side && x.question.input.type === "yes_no" && getEntry(p, `${side}.${x.question.binds}`)?.status === "established");
  if (!i) throw new Error("the demo has no answered yes/no question");
  return i;
}

describe("saved answer sets", { timeout: 60_000 }, () => {
  it("is schema 1.26.0", () => {
    expect(SCHEMA_VERSION).toBe("1.26.0");
    expect(demo().schemaVersion).toBe("1.26.0");
  });

  it("saves only the chosen unit, and only real statements (no TBD, no 'same as SU', no open questions)", () => {
    const p = demo();
    const su = buildSavedSet(content, p, { name: "SU only", sides: "source", savedAt: T0, id: "a" });
    expect(su.set.answers.length).toBeGreaterThan(10);
    expect(su.set.answers.every((a) => a.side === "source")).toBe(true);
    const both = buildSavedSet(content, p, { name: "Both", sides: "both", savedAt: T0, id: "b" });
    expect(both.set.answers.some((a) => a.side === "target")).toBe(true);
    expect(both.set.answers.length).toBeGreaterThan(su.set.answers.length);
    // Every saved answer is a value or a justified "not applicable"; TBD cannot be in a set.
    const kinds = new Set(both.set.answers.flatMap((a) => (a.input.kind === "composite" ? Object.values(a.input.fields).map((f) => f.kind) : [a.input.kind])));
    expect([...kinds].every((k) => k === "value" || k === "not_applicable")).toBe(true);
    // A blank project has nothing to save.
    expect(buildSavedSet(content, blank(), { name: "Empty", sides: "both", savedAt: T0, id: "c" }).set.answers).toEqual([]);
    expect(() => buildSavedSet(content, p, { name: "  ", sides: "both", savedAt: T0, id: "d" })).toThrow(/name/);
  });

  it("leaves a TBD answer out and counts it", () => {
    let p = demo();
    const i = answeredInst(p, "source");
    p = applyAnswer(p, content, i, { kind: "tbd", note: "to be confirmed" } as AnswerInput, actor);
    const r = buildSavedSet(content, p, { name: "x", sides: "source", savedAt: T0, id: "e" });
    expect(r.skipped.tbd).toBeGreaterThanOrEqual(1);
    expect(r.set.answers.some((a) => a.questionId === i.question.id)).toBe(false);
  });

  it("reviews against another project: asked rows are ready, the rest are 'not asked'; a different answer is flagged with both values", () => {
    const src = demo();
    const set = buildSavedSet(content, src, { name: "Review set", sides: "source", savedAt: T0, id: "f" }).set;
    // The blank project only asks the scoping questions of the first section, so most saved answers are not asked there.
    const rows = reviewSavedSet(content, blank(), set);
    expect(rows.length).toBe(set.answers.length);
    expect(rows.filter((r) => r.state === "not_asked").length).toBeGreaterThan(0);
    expect(rows.every((r) => r.existing === "none")).toBe(true);

    // A project that holds the opposite yes/no answer shows it as different, and the same answer as same.
    const target = demo();
    const i = answeredInst(target, "source");
    const saved = set.answers.find((a) => a.questionId === i.question.id && a.side === "source")!;
    const flipped = applyAnswer(target, content, i, { kind: "value", value: saved.input.kind === "value" && saved.input.value === true ? "no" : "yes" }, actor);
    const row = reviewSavedSet(content, flipped, set).find((r) => r.key === `${i.question.id}@source`)!;
    expect(row.state).toBe("ready");
    expect(row.existing).toBe("different");
    expect(row.existingText).toBeTruthy();
    expect(reviewSavedSet(content, target, set).find((r) => r.key === row.key)!.existing).toBe("same");
  });

  it("applies only the ticked rows, records where each came from, and a hand-typed answer ends the note", () => {
    const set = buildSavedSet(content, demo(), { name: "Site A answers (fictional)", sides: "source", savedAt: "2026-10-30T10:00:00.000Z", id: "g" }).set;
    // Apply to a project that asks the same questions but has none answered: the demo with its answers cleared is not available, so
    // use the demo itself with one answer flipped, which is a realistic "different answer" case.
    const target = demo();
    const i = answeredInst(target, "source");
    const flipped = applyAnswer(target, content, i, { kind: "value", value: "no" }, actor);
    const rows = reviewSavedSet(content, flipped, set).filter((r) => r.state === "ready");
    const keys = new Set(rows.map((r) => r.key));
    const unticked = rows.find((r) => r.key !== `${i.question.id}@source`)!;
    keys.delete(unticked.key);
    const res = applySavedSet(flipped, content, set, keys, { ...actor, at: "2026-10-31T11:00:00.000Z" });
    expect(res.failed).toEqual([]);
    expect(res.applied).toBe(keys.size);

    const inst = insts(res.project).find((x) => x.key === `${i.question.id}@source`)!;
    expect(savedSetOf(res.project, inst)).toEqual({ name: "Site A answers (fictional)", savedAt: "2026-10-30T10:00:00.000Z" });
    // The unticked row got no note and no new record.
    const other = insts(res.project).find((x) => x.key === unticked.key)!;
    expect(savedSetOf(res.project, other)).toBeUndefined();
    // Change log: the answer record says where it came from, and a summary record is added.
    const logged = res.project.changeLog.filter((e) => e.action === "answer" && (e.detail ?? "").startsWith("From saved answers: Site A answers (fictional), 2026-10-30"));
    expect(logged.length).toBeGreaterThanOrEqual(keys.size);
    expect(res.project.changeLog.at(-1)).toMatchObject({ action: "apply_saved_answers" });
    // The answer is back to the saved one and the applied project still reads under the current schema.
    expect(getEntry(res.project, `source.${i.question.binds}`)?.value).toBe(getEntry(demo(), `source.${i.question.binds}`)?.value);
    expect(parseProject(JSON.parse(JSON.stringify(res.project))).answers.some((a) => a.fromSavedSet?.name === "Site A answers (fictional)")).toBe(true);

    // Typing a different answer by hand writes a record without a set: the note goes away.
    const edited = applyAnswer(res.project, content, inst, { kind: "value", value: "no" }, actor);
    expect(savedSetOf(edited, inst)).toBeUndefined();
  });

  it("does not apply an answer that does not fit this catalog, and never an unticked or not-asked row", () => {
    const set = buildSavedSet(content, demo(), { name: "Bad", sides: "source", savedAt: T0, id: "h" }).set;
    const target = demo();
    const i = answeredInst(target, "source");
    const bad = { ...set, answers: set.answers.map((a) => (a.questionId === i.question.id ? { ...a, input: { kind: "value" as const, value: "maybe-not-an-option" } } : a)) };
    const row = reviewSavedSet(content, target, bad).find((r) => r.key === `${i.question.id}@source`)!;
    expect(row.state).toBe("cannot");
    expect(row.problem).toBeTruthy();
    const r = applySavedSet(target, content, bad, new Set([row.key]), actor);
    expect(r.applied).toBe(0);
    expect(r.project).toBe(target);
    // Nothing ticked: nothing applied, nothing logged.
    const none = applySavedSet(target, content, set, new Set(), actor);
    expect(none.applied).toBe(0);
    expect(none.project.changeLog.length).toBe(target.changeLog.length);
  });
});

describe("saved set files", () => {
  const good = () => buildSavedSet(content, demo(), { name: "File set", sides: "both", savedAt: T0, id: "i" }).set;
  it("round-trips through JSON", () => {
    const r = parseSavedAnswerSet(JSON.parse(JSON.stringify(good())));
    expect(r.ok).toBe(true);
  });
  it("refuses other files with a plain message", () => {
    for (const bad of [null, [], "x", { format: "something-else" }, { ...good(), format: "gap-saved-answers", name: "" }, { ...good(), formatVersion: 99 }, { ...good(), answers: [{ questionId: "q", side: "source", input: { kind: "tbd" } }] }, { ...good(), sides: "source" }]) {
      const r = parseSavedAnswerSet(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
  });
});
