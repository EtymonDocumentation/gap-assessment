// M12 job 1: the TRD interview's question model and engine (packages/engine/src/trd-interview.ts) and its wording file.
// No screens here: the tests derive the questions from a TRD, write answers through applyTrdAnswer and check the TRD, the change log and the counts.
import {
  addWriteupFromLibrary,
  applyTrdAnswer,
  buildDemoProject,
  buildTrdSeed,
  createTrd,
  deriveTrdQuestions,
  effectiveField,
  ensureCatalogItem,
  filterInterviewQuestions,
  parseStageMarker,
  parseTrdInterviewWording,
  resolveBlank,
  setPartIncluded,
  STAGE_QUESTION_ID,
  trdInterviewProgress,
  trdOpenItems,
  writeupsAvailable,
  writeupsInOrder,
  type InterviewAnswer,
  type InterviewQuestion,
  type ProgramStage,
} from "@gap/engine";
import type { Project, TrdDocument } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { expectNoPrivateTerms } from "../../test-support/private-terms";
import { content, demos, glossary, trdInterviewWording, trdWriteups } from "../index";

// Each case builds a whole TRD from the library; the machine can be busy when the full suite runs.
vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-05T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const ctx = { content, library: trdWriteups };
const opts = { content, wording: trdInterviewWording };
const NO_WORDING = { version: "0", questions: {} };

/** The demo project with the given receiving-unit stage and no TRD of its own. */
function baseProject(stage?: ProgramStage): Project {
  const raw = demos["arx-217"] as { answers: { q: string; side: string; value?: unknown }[] };
  const answers = stage ? raw.answers.map((x) => (x.q === STAGE_QUESTION_ID && x.side === "target" ? { ...x, value: stage } : x)) : raw.answers;
  const p = buildDemoProject(content, { ...raw, answers });
  return { ...p, trd: { documents: [] }, changeLog: p.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
}

/** A blank TRD with all 15 steps, every write-up of the library and every optional part switched on: the widest set of questions there is. */
function fullTrd(stage?: ProgramStage, allOptional = true): { project: Project; trdId: string } {
  const steps = content.catalog.unitOperations.map((u) => ({ unitOp: u.key, label: u.label }));
  let { project: p, trdId } = createTrd(baseProject(stage), { title: "Interview TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  for (const o of writeupsAvailable(p.trd.documents[0]!, trdWriteups)) p = addWriteupFromLibrary(p, trdId, o.lib, o.step?.id, who).project;
  // Switching a part on by hand overrides its stages, so the stage test leaves the optional parts as the stage decides.
  if (allOptional) for (const w of p.trd.documents[0]!.writeups ?? []) for (const part of w.parts) if (part.optional) p = setPartIncluded(p, trdId, w.id, part.id, true, who);
  return { project: p, trdId };
}

/** A TRD started from the project: its values are pulled, so the questions are from-project. */
function projectTrd(): { project: Project; trdId: string } {
  const b = baseProject();
  const r = createTrd(b, { title: "From the project (fictional)", start: { kind: "project", seed: buildTrdSeed(content, b, { exportedAt: T }) }, library: trdWriteups }, who);
  return { project: r.project, trdId: r.trdId };
}

const doc = (p: Project, id: string): TrdDocument => p.trd.documents.find((d) => d.id === id)!;
const questions = (p: Project, id: string, wording = trdInterviewWording) => deriveTrdQuestions(p, id, { content, wording });
const byKey = (qs: InterviewQuestion[], key: string) => {
  const q = qs.find((x) => x.key === key);
  if (!q) throw new Error(`no question ${key}`);
  return q;
};
const events = (a: Project, b: Project) => b.changeLog.slice(a.changeLog.length);
const ans = (value: string, extra: Record<string, unknown> = {}): InterviewAnswer => ({ kind: "value", value, ...extra }) as InterviewAnswer;
const itemField = (p: Project, id: string, uo: string, coll: string, item: string, field: string) =>
  doc(p, id).steps.find((s) => s.key === uo)?.items.find((i) => i.collection === coll && i.key === item)?.fields.find((f) => f.key === field);

describe("TRD interview wording file", () => {
  const entries = Object.entries(trdInterviewWording.questions);

  it("has its own version and a changelog that names it", () => {
    expect(trdInterviewWording.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(trdInterviewWording.changelog?.map((c) => c.version)).toContain(trdInterviewWording.version);
  });

  it("keeps prompts short and the reasons to one sentence of the allowed length", () => {
    for (const [k, w] of entries) {
      expect(w.prompt.length, `${k} prompt`).toBeLessThanOrEqual(140);
      expect(w.why.length, `${k} why`).toBeLessThanOrEqual(220);
      expect(w.prompt.trim().length, `${k} prompt`).toBeGreaterThan(8);
      expect(w.why.trim().length, `${k} why`).toBeGreaterThan(8);
    }
  });

  it("uses no scolding words and never names a filing category", () => {
    const banned = /\b(wizard|validate|validates|validated|required|requires|error|errors|must|non-?compliant)\b/i;
    const filing = /\b(minor|major|moderate|prior[- ]approval|annual report|CBE-?30|changes being effected|notification)\b/i;
    for (const [k, w] of entries) {
      for (const text of [w.prompt, w.why, w.hint ?? ""]) {
        expect(text, k).not.toMatch(banned);
        expect(text, k).not.toMatch(filing);
      }
    }
  });

  it("links only to glossary entries that exist", () => {
    const ids = new Set(glossary.map((g) => g.id));
    for (const [k, w] of entries) for (const g of w.glossary ?? []) expect(ids.has(g), `${k} -> ${g}`).toBe(true);
  });

  it("has stage markers that parse, each with an else branch", () => {
    let markers = 0;
    for (const [k, w] of entries) {
      for (const text of [w.prompt, w.why, w.hint ?? ""]) {
        for (const m of text.matchAll(/\{\{@stage([^{}|]*)\}\}/g)) {
          markers += 1;
          const r = parseStageMarker(m[1]!);
          expect("error" in r, `${k}: ${m[0]}`).toBe(false);
        }
      }
    }
    expect(markers).toBeGreaterThan(0);
  });

  it("rejects an entry with an unknown key", () => {
    expect(() => parseTrdInterviewWording({ version: "1.0.0", questions: { a: { prompt: "p", why: "w", surprise: true } } })).toThrow(/wording\.yaml/);
  });

  it("carries no client names, codes or supplier brands", () => {
    const all = JSON.stringify(trdInterviewWording);
    expect(all).not.toMatch(/CTP\d|QC\d{3}/);
    expectNoPrivateTerms(all);
  });
});

describe("deriving the questions", () => {
  const { project, trdId } = fullTrd();
  const qs = questions(project, trdId);

  it("asks the document fields and details first, then the steps in catalog order, Essentials before More detail", () => {
    expect(qs.slice(0, 11).map((q) => q.key)).toEqual(["doc:title", "doc:docRef", "doc:purpose", "doc:version", "doc:scopeNote", "detail:program", "detail:modality", "detail:dosageForm", "detail:presentation", "detail:site", "detail:line"]);
    const order = ["document", ...content.catalog.unitOperations.map((u) => u.key)];
    const stepIdx = qs.map((q) => order.indexOf(q.stepKey));
    expect(stepIdx.every((n) => n >= 0)).toBe(true);
    expect([...stepIdx]).toEqual([...stepIdx].sort((a, b) => a - b));
    for (const step of order) {
      const own = qs.filter((q) => q.stepKey === step);
      const firstMore = own.findIndex((q) => !q.essential);
      if (firstMore >= 0) expect(own.slice(firstMore).every((q) => !q.essential), step).toBe(true);
    }
    expect(qs.map((q) => q.order)).toEqual(qs.map((_, i) => i));
  });

  it("puts the presence question first in each step", () => {
    for (const u of content.catalog.unitOperations) {
      const own = qs.filter((q) => q.stepKey === u.key);
      expect(own[0]!.key, u.key).toBe(`step:${u.key}.presence`);
      expect(own[0]!.input).toBe("yes_no");
    }
  });

  it("has unique keys and no pre-filled answers on a blank TRD", () => {
    expect(new Set(qs.map((q) => q.key)).size).toBe(qs.length);
    // What is already known comes from the user's own steps (title, steps in the TRD) or from the project, and says so.
    const known = qs.filter((q) => q.state !== "open");
    for (const q of known) expect(q.key.startsWith("step:") || q.key === "doc:title" || (q.state === "from_project" && q.source), q.key).toBeTruthy();
    for (const q of qs.filter((x) => x.state === "open")) expect(q.current, q.key).toBeUndefined();
    // The catalog supplies options, never answers: no choice is marked as chosen.
    expect(JSON.stringify(qs)).not.toMatch(/"default"/);
  });

  it("derives the same questions every time and never changes the TRD", () => {
    const before = JSON.stringify(project);
    expect(questions(project, trdId).map((q) => q.key)).toEqual(qs.map((q) => q.key));
    expect(JSON.stringify(project)).toBe(before);
  });

  it("asks a collapsed limits question for a parameter and keeps the three parts together", () => {
    const q = byKey(qs, "limits:aseptic_filling.param.fill_volume");
    expect(q.target).toMatchObject({ kind: "limits", unitOp: "aseptic_filling", collection: "param", itemKey: "fill_volume" });
    expect(q.input).toBe("limits");
    expect(q.essential).toBe(true);
  });

  it("maps the details to detail questions and the typed sentences to blank questions", () => {
    expect(byKey(qs, "detail:modality").choices.length).toBeGreaterThan(1);
    const b = byKey(qs, "blank:trd.scope.dsItemNumber");
    expect(b.target).toEqual({ kind: "blank", blankKey: "trd.scope.dsItemNumber" });
    expect(b.usedIn.length).toBeGreaterThan(0);
    expect(b.blankLabel).toBeTruthy();
  });

  it("reuses the choices of the gap assessment but never its wording", () => {
    const q = byKey(qs, "field:buffer_prep.equip.dispensing.operatingPrinciple");
    const gap = content.questions.find((x) => x.binds === "uo.buffer_prep.equip.dispensing.operatingPrinciple");
    expect(q.choices.length).toBeGreaterThan(1);
    if (gap) {
      expect(q.prompt).not.toBe(gap.prompt);
      expect(q.why).not.toBe(gap.why);
    }
  });

  it("gives the exact number of questions per step", () => {
    const counts: Record<string, [number, number]> = {};
    for (const q of qs) {
      const c = (counts[q.stepKey] ??= [0, 0]);
      c[q.essential ? 0 : 1] += 1;
    }
    // [Essentials, More detail] on the widest TRD (every step, every write-up, every optional part).
    expect(counts).toEqual(EXPECTED_COUNTS);
    expect(qs.length).toBe(Object.values(EXPECTED_COUNTS).reduce((n, [e, m]) => n + e + m, 0));
  });

  it("filters by step, by Essentials and by open state without changing the questions", () => {
    const ess = filterInterviewQuestions(qs, { level: "essentials" });
    expect(ess.every((q) => q.essential)).toBe(true);
    expect(ess.length).toBeLessThan(qs.length);
    const step = filterInterviewQuestions(qs, { search: "capping" });
    expect(step.length).toBeGreaterThan(0);
    const open = filterInterviewQuestions(qs, { show: "open" });
    expect(open.every((q) => q.state === "open" || q.state === "tbd")).toBe(true);
    expect(filterInterviewQuestions(qs, { level: "more" }).every((q) => !q.essential)).toBe(true);
    expect(filterInterviewQuestions(qs, { show: "confirm" }).every((q) => q.state === "from_project")).toBe(true);
  });
});

describe("starting from the project", () => {
  const { project, trdId } = projectTrd();
  const qs = questions(project, trdId);

  it("shows the project's values as from-project, with their source, until the user keeps them", () => {
    const pulled = qs.filter((q) => q.state === "from_project");
    expect(pulled.length).toBeGreaterThan(10);
    for (const q of pulled) {
      expect(q.current, q.key).toBeTruthy();
      expect(q.source?.kind, q.key).toBe("gap assessment");
    }
    const p0 = trdInterviewProgress(qs);
    expect(p0.overall.essentials.toConfirm + p0.overall.moreDetail.toConfirm).toBe(pulled.length);
    const kept = new Set(pulled.map((q) => q.key));
    const p1 = trdInterviewProgress(qs, kept);
    expect(p1.overall.essentials.answered + p1.overall.moreDetail.answered).toBeGreaterThan(p0.overall.essentials.answered + p0.overall.moreDetail.answered);
  });

  it("writes nothing for Keep and for Don't know yet", () => {
    const q = qs.find((x) => x.state === "from_project")!;
    for (const a of [{ kind: "keep" }, { kind: "dont_know" }] as InterviewAnswer[]) {
      const r = applyTrdAnswer(project, trdId, q, a, who, ctx);
      expect(r.changed).toBe(false);
      expect(r.project).toBe(project);
    }
    expect(applyTrdAnswer(project, trdId, q, { kind: "keep" }, who, ctx).kept).toBe(true);
  });

  it("keeps the project value next to a changed one (pulled) and records one event", () => {
    const q = qs.find((x) => x.target.kind === "field" && x.state === "from_project" && (x.input === "text" || x.input === "choice"))!;
    const t = q.target as Extract<InterviewQuestion["target"], { kind: "field" }>;
    const before = itemField(project, trdId, t.unitOp, t.collection, t.itemKey, t.field)!;
    const value = q.input === "choice" ? q.choices.find((o) => o.label !== q.current)!.value : "Changed by the interview (fictional)";
    const r = applyTrdAnswer(project, trdId, q, ans(value), who, ctx);
    expect(r.error).toBeUndefined();
    expect(r.changed).toBe(true);
    const after = itemField(r.project, trdId, t.unitOp, t.collection, t.itemKey, t.field)!;
    expect(after.pulled).toEqual(before.pulled);
    expect(after.override?.status).toBe("established");
    expect(events(project, r.project)).toHaveLength(1);
    expect(events(project, r.project)[0]!.action).toBe("trd_override_set");
  });

  it("compares with trdOpenItems and differs on purpose", () => {
    const open = trdOpenItems(doc(project, trdId));
    const prog = trdInterviewProgress(qs);
    // The interview also counts unconfirmed project values, items and fields the TRD does not hold yet, and the typed sentences (trd.*)
    // as open; trdOpenItems counts only what the TRD already holds and is not established. So the interview never has fewer open.
    expect(prog.overall.essentials.open + prog.overall.moreDetail.open).toBeGreaterThanOrEqual(open.length);
  });
});

describe("a part that is switched off or a stage change", () => {
  it("drops the blanks of a part that is switched off", () => {
    const { project, trdId } = fullTrd();
    const d = doc(project, trdId);
    const all = questions(project, trdId);
    let p = project;
    let touched = 0;
    for (const w of d.writeups ?? []) for (const part of w.parts) if (part.optional && touched < 3) { p = setPartIncluded(p, trdId, w.id, part.id, false, who); touched += 1; }
    const fewer = questions(p, trdId);
    expect(touched).toBeGreaterThan(0);
    expect(fewer.length).toBeLessThan(all.length);
    expect(fewer.map((q) => q.key).every((k) => all.some((q) => q.key === k))).toBe(true);
  });

  it("adds and removes questions when the project stage changes, and resolves the stage wording", () => {
    const stages: ProgramStage[] = ["development", "clinical", "ppq", "commercial"];
    const sets = stages.map((s) => {
      const { project, trdId } = fullTrd(s, false);
      return { s, qs: questions(project, trdId) };
    });
    const sizes = new Set(sets.map((x) => x.qs.length));
    expect(sizes.size).toBeGreaterThan(1);
    const staged = sets.flatMap((x) => x.qs).filter((q) => q.stages?.length);
    expect(staged.length).toBeGreaterThan(0);
    const purpose = sets.map((x) => byKey(x.qs, "doc:purpose").hint);
    expect(new Set(purpose).size).toBeGreaterThan(1);
    for (const h of purpose) expect(h).not.toContain("{{");
    // A question that exists only for some stages lists them.
    for (const x of sets) for (const q of x.qs.filter((y) => y.stages?.length)) expect(q.stages, q.key).toContain(x.s);
  });
});

describe("wording coverage", () => {
  const { project, trdId } = fullTrd();
  const withWording = questions(project, trdId);
  const without = questions(project, trdId, NO_WORDING);

  it("has written wording for every Essentials question", () => {
    const missing = withWording.filter((q) => q.essential && !q.wordingWritten).map((q) => q.key);
    expect(missing).toEqual([]);
  });

  it("has no wording for a question the TRD can never ask", () => {
    const universe = new Set<string>(without.map((q) => q.key));
    // A step the TRD does not hold yet shows only its presence question, so every wording key must exist on the widest TRD or be a step presence.
    const orphans = Object.keys(trdInterviewWording.questions).filter((k) => !universe.has(k));
    expect(orphans).toEqual([]);
  });

  it("has written wording for every More detail question too, so none falls back to the generated sentence", () => {
    // M12 job 3 wrote them all: the generated sentence stays in the engine only as a safety net for a catalog item added later.
    const generated = withWording.filter((q) => !q.wordingWritten).map((q) => q.key);
    expect(generated).toEqual([]);
    for (const q of withWording) expect(q.why, q.key).not.toMatch(/^Needed for the TRD section /);
  });

  it("gives every question a prompt and a reason, written or generated", () => {
    for (const q of withWording) {
      expect(q.prompt.length, q.key).toBeGreaterThan(8);
      expect(q.why.length, q.key).toBeGreaterThan(8);
    }
  });
});

describe("answers", () => {
  const { project: p0, trdId } = fullTrd();
  const qs = questions(p0, trdId);

  it("writes the document fields through updateTrd with one event", () => {
    const r = applyTrdAnswer(p0, trdId, byKey(qs, "doc:title"), ans("Renamed (fictional)"), who, ctx);
    expect(doc(r.project, trdId).title).toBe("Renamed (fictional)");
    expect(events(p0, r.project)).toHaveLength(1);
    expect(applyTrdAnswer(r.project, trdId, byKey(qs, "doc:title"), ans("Renamed (fictional)"), who, ctx).changed).toBe(false);
  });

  it("writes a detail as an established override with one event, and a choice as its label", () => {
    const q = byKey(qs, "detail:modality");
    const opt = q.choices[1]!;
    const r = applyTrdAnswer(p0, trdId, q, ans(opt.value), who, ctx);
    const f = doc(r.project, trdId).details.find((x) => x.key === "modality")!;
    expect(effectiveField(f)).toMatchObject({ status: "established", text: opt.label });
    expect(events(p0, r.project)).toHaveLength(1);
  });

  it("answers presence: yes adds the step and its process description, no records the step as not performed", () => {
    const empty = createTrd(baseProject(), { title: "Empty (fictional)", start: { kind: "blank", steps: [] }, library: trdWriteups }, who);
    const eqs = questions(empty.project, empty.trdId);
    const q = byKey(eqs, "step:capping.presence");
    const yes = applyTrdAnswer(empty.project, empty.trdId, q, { kind: "presence", performed: true }, who, ctx);
    expect(doc(yes.project, empty.trdId).steps.map((s) => s.key)).toContain("capping");
    expect(yes.project.changeLog.length).toBeGreaterThan(empty.project.changeLog.length);
    expect((doc(yes.project, empty.trdId).writeups ?? []).some((w) => w.key === "capping")).toBe(true);
    const no = applyTrdAnswer(empty.project, empty.trdId, q, { kind: "presence", performed: false, reason: "Done elsewhere (fictional)" }, who, ctx);
    const step = doc(no.project, empty.trdId).steps.find((s) => s.key === "capping")!;
    expect(effectiveField(step.fields.find((f) => f.key === "presence")!)).toMatchObject({ status: "not_applicable" });
    // Saying yes twice changes nothing the second time.
    const again = applyTrdAnswer(yes.project, empty.trdId, q, { kind: "presence", performed: true }, who, ctx);
    expect(again.changed).toBe(false);
  });

  it("a step that is not in the TRD shows only its presence question", () => {
    const empty = createTrd(baseProject(), { title: "Empty (fictional)", start: { kind: "blank", steps: [] }, library: trdWriteups }, who);
    const own = questions(empty.project, empty.trdId).filter((q) => q.stepKey === "capping");
    expect(own.map((q) => q.key)).toEqual(["step:capping.presence"]);
  });

  it("writes a field through setOverride; creating the item first logs its own event, the second answer is one event", () => {
    const q1 = byKey(qs, "field:buffer_prep.param.max_hold_time.max");
    const r1 = applyTrdAnswer(p0, trdId, q1, ans("8", { unit: "h" }), who, ctx);
    expect(r1.error).toBeUndefined();
    const f = itemField(r1.project, trdId, "buffer_prep", "param", "max_hold_time", "max")!;
    expect(effectiveField(f)).toMatchObject({ status: "established" });
    const log1 = events(p0, r1.project).map((e) => e.action);
    expect(log1.at(-1)).toBe("trd_override_set");
    expect(log1.filter((a) => a === "trd_item_add")).toHaveLength(1);
    // The item now exists, so a second answer on the same item is exactly one event.
    const q2 = questions(r1.project, trdId).find((q) => q.target.kind === "field" && q.target.unitOp === "buffer_prep" && q.target.itemKey === "max_hold_time" && q.key !== q1.key);
    if (q2) {
      const r2 = applyTrdAnswer(r1.project, trdId, q2, q2.choices.length ? ans(q2.choices[0]!.value) : ans("Note (fictional)"), who, ctx);
      expect(events(r1.project, r2.project)).toHaveLength(1);
    }
    expect(applyTrdAnswer(r1.project, trdId, questions(r1.project, trdId).find((q) => q.key === q1.key)!, ans("8", { unit: "h" }), who, ctx).changed).toBe(false);
  });

  it("writes a limits answer through setLimits, with sources, and merges parts", () => {
    const q = byKey(qs, "limits:aseptic_filling.param.fill_volume");
    const r = applyTrdAnswer(p0, trdId, q, { kind: "limits", setPoint: { value: 5, unit: "mL" }, sourceIds: [] }, who, ctx);
    expect(r.error).toBeUndefined();
    const item = doc(r.project, trdId).steps.find((s) => s.key === "aseptic_filling")!.items.find((i) => i.key === "fill_volume")!;
    expect(item.limits?.setPoint?.value).toBe(5);
    expect(events(p0, r.project).at(-1)!.action).toBe("trd_limits_update");
    const q2 = questions(r.project, trdId).find((x) => x.key === q.key)!;
    const r2 = applyTrdAnswer(r.project, trdId, q2, { kind: "limits", nor: { min: 4.5, max: 5.5, unit: "mL", basis: "Development runs (fictional)" } }, who, ctx);
    const l2 = doc(r2.project, trdId).steps.find((s) => s.key === "aseptic_filling")!.items.find((i) => i.key === "fill_volume")!.limits!;
    expect(l2.setPoint?.value).toBe(5);
    expect(l2.nor).toMatchObject({ min: 4.5, max: 5.5 });
    expect(events(r.project, r2.project)).toHaveLength(1);
    expect(applyTrdAnswer(r2.project, trdId, questions(r2.project, trdId).find((x) => x.key === q.key)!, { kind: "limits", nor: { min: 4.5, max: 5.5, unit: "mL", basis: "Development runs (fictional)" } }, who, ctx).changed).toBe(false);
  });

  it("keeps a part's own citation (sources and places) from the card, and an existing one when the answer names none", () => {
    const q = byKey(qs, "limits:aseptic_filling.param.fill_volume");
    const cited = { sourceIds: ["src-fict-1"], locations: { "src-fict-1": { section: "4.2", page: "7" } } };
    const r = applyTrdAnswer(p0, trdId, q, { kind: "limits", nor: { min: 4.5, max: 5.5, unit: "mL", ...cited } }, who, ctx);
    const get = (p: Project) => doc(p, trdId).steps.find((s) => s.key === "aseptic_filling")!.items.find((i) => i.key === "fill_volume")!.limits!;
    expect(r.error).toBeUndefined();
    expect(get(r.project).nor).toMatchObject(cited);
    expect(events(p0, r.project).at(-1)!.action).toBe("trd_limits_update");
    // A later answer for another part, with no citation of its own, leaves the first part's citation alone.
    const q2 = questions(r.project, trdId).find((x) => x.key === q.key)!;
    const r2 = applyTrdAnswer(r.project, trdId, q2, { kind: "limits", setPoint: { value: 5, unit: "mL" } }, who, ctx);
    expect(get(r2.project).nor).toMatchObject(cited);
  });

  it("returns the engine's own message when it refuses, and nothing is written", () => {
    const q = byKey(qs, "limits:aseptic_filling.param.fill_volume");
    const r = applyTrdAnswer(p0, trdId, q, { kind: "limits", setPoint: { value: Number.NaN } }, who, ctx);
    expect(r.changed).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.project).toBe(p0);
    const text = applyTrdAnswer(p0, trdId, byKey(qs, "field:buffer_prep.param.max_hold_time.max"), ans("not a number"), who, ctx);
    expect(text.error).toBeTruthy();
    expect(text.project).toBe(p0);
  });

  it("writes a control through setControl", () => {
    const q = qs.find((x) => x.target.kind === "control");
    if (!q) return;
    const r = applyTrdAnswer(p0, trdId, q, { kind: "control", control: { cqa: "Sterility (fictional)" } }, who, ctx);
    expect(r.error).toBeUndefined();
    expect(events(p0, r.project).at(-1)!.action).toBe("trd_control_update");
  });

  it("writes a typed sentence through setBlankValue and the write-up then reads it", () => {
    const q = byKey(qs, "blank:trd.scope.dsItemNumber");
    const r = applyTrdAnswer(p0, trdId, q, ans("DS-0001 (fictional)"), who, ctx);
    expect(events(p0, r.project)).toHaveLength(1);
    const d = doc(r.project, trdId);
    const holder = writeupsInOrder(d).find((w) => q.usedIn.some((u) => u.writeupId === w.id))!;
    expect(resolveBlank({ project: r.project, doc: d, content }, holder, "trd.scope.dsItemNumber", "Drug substance item number").value).toBe("DS-0001 (fictional)");
    expect(applyTrdAnswer(r.project, trdId, q, ans("DS-0001 (fictional)"), who, ctx).changed).toBe(false);
    const after = questions(r.project, trdId).find((x) => x.key === q.key)!;
    expect(after.state).toBe("answered");
    expect(after.current).toBe("DS-0001 (fictional)");
  });

  it("Don't know yet writes nothing and the question stays open", () => {
    for (const key of ["doc:purpose", "detail:program", "limits:aseptic_filling.param.fill_volume", "blank:trd.scope.dsItemNumber", "field:buffer_prep.param.max_hold_time.max"]) {
      const r = applyTrdAnswer(p0, trdId, byKey(qs, key), { kind: "dont_know" }, who, ctx);
      expect(r.project).toBe(p0);
      expect(r.changed).toBe(false);
      expect(questions(r.project, trdId).find((q) => q.key === key)!.state).toBe("open");
    }
  });

  it("TBD writes the tbd status, keeps the best guess visible and counts as open", () => {
    const q = byKey(qs, "field:buffer_prep.param.max_hold_time.max");
    const r = applyTrdAnswer(p0, trdId, q, { kind: "tbd", bestGuess: "8", unit: "h", owner: "Process engineering", due: "2026-12-01", note: "Waiting for the study" }, who, ctx);
    expect(r.error).toBeUndefined();
    const f = itemField(r.project, trdId, "buffer_prep", "param", "max_hold_time", "max")!;
    expect(f.override?.status).toBe("tbd");
    expect(f.override?.reason).toContain("Waiting for the study");
    const after = questions(r.project, trdId).find((x) => x.key === q.key)!;
    expect(after.state).toBe("tbd");
    const prog = trdInterviewProgress(questions(r.project, trdId));
    expect(prog.overall.essentials.tbd).toBe(1);
  });

  it("Not applicable here writes not_applicable with an optional reason and counts as answered", () => {
    const q = byKey(qs, "field:buffer_prep.param.max_hold_time.max");
    const r = applyTrdAnswer(p0, trdId, q, { kind: "not_applicable", reason: "No hold in this process (fictional)" }, who, ctx);
    const f = itemField(r.project, trdId, "buffer_prep", "param", "max_hold_time", "max")!;
    expect(f.override?.status).toBe("not_applicable");
    expect(f.override?.reason).toBe("No hold in this process (fictional)");
    expect(f.override?.display).toBeUndefined();
    const after = questions(r.project, trdId).find((x) => x.key === q.key)!;
    expect(after.state).toBe("not_applicable");
    const noReason = applyTrdAnswer(p0, trdId, q, { kind: "not_applicable" }, who, ctx);
    expect(itemField(noReason.project, trdId, "buffer_prep", "param", "max_hold_time", "max")!.override?.status).toBe("not_applicable");
  });

  it("a number question takes only a number", () => {
    const q = qs.find((x) => x.input === "number" || x.input === "quantity")!;
    const r = applyTrdAnswer(p0, trdId, q, ans("abc"), who, ctx);
    expect(r.error).toMatch(/number/);
    expect(r.project).toBe(p0);
  });

  // CR-13: JavaScript's Number() reads "0x10" as 16 and "1e3" as 1000. A typed hex or exponent form is refused instead of being saved as a value
  // nobody meant; ordinary decimals (with a sign or a leading or trailing point) are still read, and a number that is already a number is kept.
  it("refuses hex and exponent forms but reads plain decimals", () => {
    const q = qs.find((x) => x.input === "number" || x.input === "quantity")!;
    for (const bad of ["0x10", "1e3", "1E-3", "0b11", "0o7", "Infinity", "12,5", "1 000", "", "  "]) {
      const r = applyTrdAnswer(p0, trdId, q, ans(bad), who, ctx);
      expect(r.changed, bad).toBe(false);
      expect(r.project, bad).toBe(p0);
      if (bad.trim()) expect(r.error, bad).toMatch(/number/);
    }
    for (const good of ["12.5", " 12.5 ", "-3", "+3", ".5", "7."]) {
      const r = applyTrdAnswer(p0, trdId, q, ans(good), who, ctx);
      expect(r.error, good).toBeUndefined();
    }
  });
});

describe("ensureCatalogItem", () => {
  const { project, trdId } = fullTrd();
  const step = doc(project, trdId).steps.find((s) => s.key === "aseptic_filling")!;

  it("adds the item under its catalog key, entered and not custom, once", () => {
    const r = ensureCatalogItem(project, content, trdId, step.id, "param", "fill_volume", who);
    expect(r.added).toBe(true);
    const item = doc(r.project, trdId).steps.find((s) => s.key === "aseptic_filling")!.items.find((i) => i.key === "fill_volume")!;
    expect(item.custom).toBe(false);
    expect(item.entered).toBe(true);
    expect(events(project, r.project).map((e) => e.action)).toEqual(["trd_item_add"]);
    const again = ensureCatalogItem(r.project, content, trdId, step.id, "param", "fill_volume", who);
    expect(again.added).toBe(false);
    expect(again.project).toBe(r.project);
  });

  it("refuses a key that is not in the catalog for the step", () => {
    expect(() => ensureCatalogItem(project, content, trdId, step.id, "param", "no_such_item", who)).toThrow();
  });

  it("is only called on a write: deriving questions adds nothing", () => {
    const before = doc(project, trdId).steps.reduce((n, s) => n + s.items.length, 0);
    questions(project, trdId);
    expect(doc(project, trdId).steps.reduce((n, s) => n + s.items.length, 0)).toBe(before);
  });

  it("makes the uo.* blanks of a write-up resolve once the item is answered", () => {
    const q = byKey(questions(project, trdId), "field:buffer_prep.param.max_hold_time.max");
    const r = applyTrdAnswer(project, trdId, q, ans("12", { unit: "h" }), who, ctx);
    const d = doc(r.project, trdId);
    const holder = writeupsInOrder(d).find((w) => q.usedIn.some((u) => u.writeupId === w.id))!;
    const blank = holder.parts.flatMap((p) => p.text.match(/\{\{(uo\.buffer_prep\.param\.max_hold_time\.max)[|}]/g) ?? []);
    if (blank.length) expect(resolveBlank({ project: r.project, doc: d, content }, holder, "uo.buffer_prep.param.max_hold_time.max", "Buffer hold time").value).toMatch(/12/);
    expect(questions(r.project, trdId).find((x) => x.key === q.key)!.state).toBe("answered");
  });
});

describe("progress", () => {
  const { project, trdId } = fullTrd();
  const qs = questions(project, trdId);

  it("counts every question once, per step and overall", () => {
    const p = trdInterviewProgress(qs);
    expect(p.overall.essentials.total + p.overall.moreDetail.total).toBe(qs.length);
    expect(p.steps.map((s) => s.stepKey)).toEqual(["document", ...content.catalog.unitOperations.map((u) => u.key)]);
    expect(p.steps.reduce((n, s) => n + s.essentials.total, 0)).toBe(p.overall.essentials.total);
    // Nothing is answered for the user: what counts as answered is the title, the steps already in the TRD, and nothing else.
    const answered = qs.filter((q) => q.essential && (q.state === "answered" || q.state === "not_applicable"));
    expect(answered.every((q) => q.key.startsWith("step:") || q.key === "doc:title")).toBe(true);
    expect(p.overall.essentials.answered).toBe(answered.length);
    expect(p.overall.essentials.open).toBe(p.overall.essentials.total - answered.length);
    expect(p.overall.essentials.toConfirm).toBe(qs.filter((q) => q.essential && q.state === "from_project").length);
  });

  it("moves a question from open to answered after the answer", () => {
    const q = byKey(qs, "doc:purpose");
    const r = applyTrdAnswer(project, trdId, q, ans("To move filling (fictional)"), who, ctx);
    const p = trdInterviewProgress(questions(r.project, trdId));
    const doc0 = p.steps.find((s) => s.stepKey === "document")!;
    expect(doc0.essentials.answered).toBe(trdInterviewProgress(qs).steps.find((s) => s.stepKey === "document")!.essentials.answered + 1);
    expect(p.overall.essentials.open).toBe(trdInterviewProgress(qs).overall.essentials.open - 1);
  });

  it("agrees with trdOpenItems on what the TRD holds, and differs on purpose elsewhere", () => {
    const r = applyTrdAnswer(project, trdId, byKey(qs, "field:buffer_prep.param.max_hold_time.max"), { kind: "tbd", note: "Pending study" }, who, ctx);
    const open = trdOpenItems(doc(r.project, trdId));
    const entry = open.find((o) => o.where.includes("Buffer") && /TBD|tbd|decided/i.test(o.text));
    expect(entry).toBeTruthy();
    expect(trdInterviewProgress(questions(r.project, trdId)).overall.essentials.tbd).toBe(1);
    // An item the TRD does not hold yet is open in the interview and absent from trdOpenItems.
    expect(trdInterviewProgress(qs).overall.essentials.open).toBeGreaterThan(trdOpenItems(doc(project, trdId)).length);
  });
});

describe("the wording keeps the document consistent", () => {
  it("parses again to the same object", () => {
    expect(parseTrdInterviewWording(JSON.parse(JSON.stringify(trdInterviewWording)))).toEqual(trdInterviewWording);
  });
});

/** [Essentials, More detail] per step on the widest TRD. Filled from the first green run; a change here is a change of the question set. */
const EXPECTED_COUNTS: Record<string, [number, number]> = {
  document: [44, 0],
  ds_shipping_inbound: [12, 9],
  ds_receipt_thaw: [18, 22],
  buffer_prep: [24, 26],
  compounding: [14, 26],
  bbr_filtration: [21, 10],
  sterile_filtration: [26, 26],
  aseptic_filling: [24, 40],
  stoppering: [7, 8],
  lyophilization: [14, 21],
  capping: [6, 10],
  visual_inspection: [9, 10],
  bulk_packaging: [11, 10],
  labeling_packaging: [10, 11],
  storage_shipping: [13, 17],
};
