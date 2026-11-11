// M15 job 3A: the TRD interview in the order of a person's own Word template (packages/engine/src/trd-heading-interview.ts), the unit a
// question lands in (trd-answer-place.ts) and the map adapter (interview-map.ts). Engine only; the screens are tested in the web e2e.
// Fictional data only: a made-up 15-heading template against a narrow and the widest TRD.
import {
  addTrdAddedBack,
  addWriteupFromLibrary,
  buildDemoProject,
  buildProcessMap,
  buildTrdDocument,
  createTrd,
  deriveTrdQuestions,
  draftFromSuggestions,
  headingInterviewKeys,
  headingMapInput,
  headingWritingMatches,
  mappingFromDraft,
  setPartIncluded,
  setTrdHeadingText,
  suggestTrdMatch,
  trdAnswerLandings,
  trdAnswerPlaces,
  trdHeadingInterview,
  trdUnitHints,
  trdUnitModel,
  trdUnitsOf,
  trdWriteupUnitIds,
  writeupsAvailable,
  HEADING_ABOUT_TITLE,
  HEADING_ADDITIONAL_TITLE,
  type HeadingInterview,
  type InterviewQuestion,
  type MatchHeading,
  type TrdMapping,
} from "@gap/engine";
import type { Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, interviewMapWording as W, trdInterviewWording, trdWriteups } from "../index";

// Each case builds a whole TRD from the library; the machine can be busy when the full suite runs.
vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-11T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };

const h = (index: number, text: string, level = 1, hasBody = true, number?: string): MatchHeading => ({ index, level, text, hasBody, ...(number ? { number } : {}) });
/** A made-up site template: 15 headings. Some a TRD can fill, two with text of their own, one empty. */
const HEADINGS: MatchHeading[] = [
  h(0, "Purpose", 1, false, "1"),
  h(1, "Scope", 1, false, "2"),
  h(2, "Abbreviations", 1, false, "3"),
  h(3, "Introduction", 1, false, "4"),
  h(4, "Batch Size", 1, false, "5"),
  h(5, "Process Description", 1, false, "6"),
  h(6, "Buffer Preparation", 2, false, "6.1"),
  h(7, "Sterile Filtration", 2, false, "6.2"),
  h(8, "Filling", 2, false, "6.3"),
  h(9, "Container Closure", 1, false, "7"),
  h(10, "Open Items", 1, false, "8"),
  h(11, "References", 1, false, "9"),
  h(12, "Document Sign-off", 1, true, "10"),
  h(13, "Company Confidentiality Statement", 1, true),
  h(14, "Revision History Table", 1, false),
];

function baseProject(): Project {
  const p = buildDemoProject(content, demos["arx-217"] as never);
  return { ...p, trd: { documents: [] }, changeLog: p.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
}

/** Two steps and nothing else: the narrowest TRD. */
function narrowTrd(): { project: Project; trdId: string } {
  const steps = content.catalog.unitOperations.slice(0, 2).map((u) => ({ unitOp: u.key, label: u.label }));
  const { project, trdId } = createTrd(baseProject(), { title: "Narrow TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  return { project, trdId };
}

/** Every step, every write-up of the library and every optional part: about 500 questions. */
function wideTrd(): { project: Project; trdId: string } {
  const steps = content.catalog.unitOperations.map((u) => ({ unitOp: u.key, label: u.label }));
  let { project: p, trdId } = createTrd(baseProject(), { title: "Wide TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  for (const o of writeupsAvailable(p.trd.documents[0]!, trdWriteups)) p = addWriteupFromLibrary(p, trdId, o.lib, o.step?.id, who).project;
  for (const w of p.trd.documents[0]!.writeups ?? []) for (const part of w.parts) if (part.optional) p = setPartIncluded(p, trdId, w.id, part.id, true, who);
  return { project: p, trdId };
}

function setup(p: Project, trdId: string) {
  const d = p.trd.documents.find((x) => x.id === trdId)!;
  const questions = deriveTrdQuestions(p, trdId, { content, wording: trdInterviewWording });
  const landings = trdAnswerLandings(p, d, questions, content);
  const unitOf = new Map([...landings].flatMap(([k, l]) => (l.unitId ? [[k, l.unitId] as const] : [])));
  const model = buildTrdDocument(p, d, { generatedAt: T, appVersion: "0.0.0-test", content });
  const units = trdUnitsOf(trdUnitModel(model, d));
  const suggestions = suggestTrdMatch(HEADINGS, units, trdUnitHints(d, content));
  // Every suggestion confirmed, with the pick "replace" (a person makes both choices on the match screen).
  const mapping = mappingFromDraft(draftFromSuggestions(HEADINGS, suggestions).map((r) => (r.units.length ? { ...r, existing: "replace" as const } : r)), undefined, new Set(units.map((u) => u.id)));
  const run = (over: Partial<Parameters<typeof trdHeadingInterview>[0]> = {}) => trdHeadingInterview({ questions, unitOf, units, headings: HEADINGS, mapping, headingTexts: d.headingTexts, addedBack: d.addedBack, ...over });
  return { d, questions, landings, unitOf, units, mapping, run };
}

const asked = (hi: HeadingInterview): InterviewQuestion[] => hi.groups.flatMap((g) => g.subGroups.flatMap((s) => s.questions));

for (const [name, make] of [
  ["a narrow TRD", narrowTrd],
  ["the widest TRD", wideTrd],
] as const) {
  describe(`the interview in the order of a template: ${name}`, () => {
    const { project, trdId } = make();
    const s = setup(project, trdId);
    const hi = s.run();

    it("every question is in exactly one group or in the not-asked list: nothing lost, nothing twice", () => {
      const keys = [...asked(hi), ...hi.notAsked].map((q) => q.key);
      expect(keys.length).toBe(s.questions.length);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(keys)).toEqual(new Set(s.questions.map((q) => q.key)));
    });

    it("Details of this TRD is first, the headings follow in the template's order, with the heading's number and words as in the file", () => {
      expect(hi.groups[0]).toMatchObject({ id: "about", kind: "about", title: HEADING_ABOUT_TITLE });
      const headingGroups = hi.groups.filter((g) => g.kind === "heading");
      expect(headingGroups.map((g) => g.headingIndex)).toEqual(HEADINGS.map((x) => x.index));
      expect(headingGroups.map((g) => g.title).slice(5, 9)).toEqual(["6 Process Description", "6.1 Buffer Preparation", "6.2 Sterile Filtration", "6.3 Filling"]);
      expect(headingGroups[13]!.title).toBe("Company Confidentiality Statement");
    });

    it("document fields and details are always asked, in Details of this TRD", () => {
      const about = hi.groups[0]!;
      const aboutQs = about.subGroups.flatMap((x) => x.questions);
      for (const q of s.questions.filter((x) => x.target.kind === "document" || x.target.kind === "detail")) expect(aboutQs.map((x) => x.key)).toContain(q.key);
      expect(hi.aboutKinds.document).toBeGreaterThan(0);
      expect(hi.aboutKinds.document + hi.aboutKinds.detail + hi.aboutKinds.noPlace).toBe(aboutQs.length);
    });

    it("inside a heading the interview's own order is kept: Essentials then More detail of each step, steps in checklist order", () => {
      for (const g of hi.groups) {
        const flat = g.subGroups.flatMap((x) => x.questions);
        expect(flat.map((q) => q.order)).toEqual([...flat.map((q) => q.order)].sort((a, b) => a - b));
        for (const sub of g.subGroups) {
          expect(sub.questions.every((q) => q.stepKey === sub.stepKey)).toBe(true);
          const firstMore = sub.questions.findIndex((q) => !q.essential);
          if (firstMore >= 0) expect(sub.questions.slice(firstMore).every((q) => !q.essential)).toBe(true);
        }
      }
    });

    it("a heading with no Cascade content and no template text is one writing box, open; one whose own text stays is not open", () => {
      const empty = hi.groups.find((g) => g.headingIndex === 14)!;
      expect(empty.state).toBe("writing");
      expect(empty.writing).toMatchObject({ key: "heading-text:14", headingIndex: 14, headingText: "Revision History Table", text: "" });
      expect(empty.subGroups).toEqual([]);
      expect(empty.counts.essentials).toMatchObject({ total: 1, answered: 0, open: 1 });
      const keptText = hi.groups.find((g) => g.headingIndex === 13)!;
      expect(keptText.state).toBe("kept_text");
      expect(keptText.writing).toBeUndefined();
      expect(keptText.counts.essentials.total).toBe(0);
      expect(keptText.counts.moreDetail.total).toBe(0);
    });

    it("a heading that holds content but no question is shown as such", () => {
      const nothing = hi.groups.filter((g) => g.kind === "heading" && g.state === "nothing");
      for (const g of nothing) {
        expect(g.units.length).toBeGreaterThan(0);
        expect(g.subGroups).toEqual([]);
      }
      // References and Open items hold content that nothing is asked about.
      expect(hi.groups.find((g) => g.headingIndex === 11)!.state).toBe("nothing");
    });

    it("content with no heading that was not added back is not asked, and its answers are not touched", () => {
      const leftOut = new Set(hi.leftOut.map((u) => u.id));
      expect(leftOut.size).toBeGreaterThan(0);
      for (const q of hi.notAsked) expect(leftOut.has(s.unitOf.get(q.key)!)).toBe(true);
      for (const q of asked(hi)) expect(leftOut.has(s.unitOf.get(q.key) ?? "")).toBe(false);
    });

    it("placing a left-out piece brings its questions back; changing the match only regroups (answers byte-identical)", () => {
      const before = JSON.stringify(project);
      const stateBefore = new Map(s.questions.map((q) => [q.key, JSON.stringify({ s: q.state, c: q.current, r: q.reason })]));
      const target = hi.notAsked[0];
      if (!target) return;
      const unit = s.unitOf.get(target.key)!;
      const more: TrdMapping = { ...s.mapping, headings: s.mapping.headings.map((e) => (e.headingIndex === 14 ? { ...e, units: [...e.units, unit] } : e)) };
      if (!more.headings.some((e) => e.headingIndex === 14)) more.headings.push({ headingIndex: 14, headingText: "Revision History Table", units: [unit], existing: "replace" });
      const after = s.run({ mapping: more });
      expect(asked(after).map((q) => q.key)).toContain(target.key);
      expect(after.notAsked.map((q) => q.key)).not.toContain(target.key);
      expect(after.groups.find((g) => g.headingIndex === 14)!.subGroups.flatMap((x) => x.questions.map((q) => q.key))).toContain(target.key);
      // Same questions, same stored state, whatever the grouping.
      const all = [...asked(after), ...after.notAsked];
      expect(all.length).toBe(s.questions.length);
      for (const q of all) expect(JSON.stringify({ s: q.state, c: q.current, r: q.reason })).toBe(stateBefore.get(q.key));
      expect(JSON.stringify(project)).toBe(before);
    });

    it("pieces added back are asked last, in Additional content, and only when no heading holds them", () => {
      const target = hi.notAsked[0];
      if (!target) return;
      const unit = s.unitOf.get(target.key)!;
      const after = s.run({ addedBack: [unit] });
      const last = after.groups[after.groups.length - 1]!;
      expect(last).toMatchObject({ id: "additional", kind: "additional", title: HEADING_ADDITIONAL_TITLE });
      expect(last.units.map((u) => u.id)).toEqual([unit]);
      expect(last.subGroups.flatMap((x) => x.questions.map((q) => q.key))).toContain(target.key);
      expect(after.landing.get(target.key)).toEqual({ groupId: "additional", title: HEADING_ADDITIONAL_TITLE });
      expect(after.leftOut.map((u) => u.id)).not.toContain(unit);
      // A piece a heading holds is asked there, not twice.
      const placedUnit = s.mapping.headings[0]!.units[0]!;
      const twice = s.run({ addedBack: [placedUnit] });
      expect(twice.groups.some((g) => g.id === "additional")).toBe(false);
      // An id the TRD does not have is ignored.
      expect(s.run({ addedBack: ["writeup-nothing-like-it"] }).groups.some((g) => g.id === "additional")).toBe(false);
    });

    it("says where each asked question lands, by the heading's number and words", () => {
      for (const g of hi.groups.filter((x) => x.kind === "heading")) {
        for (const q of g.subGroups.flatMap((x) => x.questions)) expect(hi.landing.get(q.key)).toEqual({ groupId: g.id, title: g.title, headingIndex: g.headingIndex });
      }
      for (const q of hi.groups[0]!.subGroups.flatMap((x) => x.questions)) expect(hi.landing.has(q.key)).toBe(false);
      expect(hi.landing.get("heading-text:14")).toMatchObject({ title: "Revision History Table", headingIndex: 14 });
    });

    it("counts per group add up to the overall counts and match trdInterviewProgress over the asked questions", () => {
      const sum = hi.groups.reduce((n, g) => n + g.counts.essentials.total + g.counts.moreDetail.total, 0);
      expect(hi.overall.essentials.total + hi.overall.moreDetail.total).toBe(sum);
      const writing = hi.groups.filter((g) => g.writing).length;
      expect(hi.overall.essentials.total + hi.overall.moreDetail.total).toBe(asked(hi).length + writing);
    });

    it("the map adapter counts the same as the groups", () => {
      const m = buildProcessMap(headingMapInput(hi), { includeDetail: true });
      expect(m.totals.total).toBe(hi.overall.essentials.total + hi.overall.moreDetail.total);
      expect(m.totals.answered).toBe(hi.overall.essentials.answered + hi.overall.moreDetail.answered);
      // One node per heading, in the template's order, and a whole node for Details of this TRD.
      expect(m.nodes[0]).toMatchObject({ id: "whole", label: HEADING_ABOUT_TITLE });
      expect(m.nodes.filter((n) => n.kind === "step").map((n) => n.label)).toEqual(HEADINGS.map((x) => (x.number ? `${x.number} ${x.text}` : x.text)));
      const empty = m.nodes.find((n) => n.id === "step:heading-14")!;
      expect(empty.counts).toMatchObject({ total: 1, answered: 0, open: 1 });
      expect(m.nodes.find((n) => n.id === "step:heading-13")!.status).toBe("nothing_to_ask");
      expect(W.nodes.wholeTrd).toBeTruthy();
    });

    it("lists every card of the interview once, in order, for the sequence", () => {
      const keys = headingInterviewKeys(hi);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain("heading-text:14");
      expect(keys.length).toBe(asked(hi).length + hi.groups.filter((g) => g.writing).length);
    });
  });
}

describe("a template that changed, and text written under a heading", () => {
  const { project, trdId } = narrowTrd();
  const s = setup(project, trdId);

  it("a heading that is no longer in the template is listed to match again; its content is not asked meanwhile", () => {
    const renamed = HEADINGS.map((x) => (x.index === 4 ? { ...x, text: "Batch Volume" } : x));
    const hi = s.run({ headings: renamed });
    expect(hi.again.map((p) => p.headingText)).toEqual(["Batch Size"]);
    expect(hi.needMatching).toBe(1);
    // Nothing is lost: every question is still in a group or the not-asked list.
    expect(asked(hi).length + hi.notAsked.length).toBe(s.questions.length);
    // The renamed heading holds nothing now and, with no text of its own in the file, gets a writing box.
    expect(hi.groups.find((g) => g.headingIndex === 4)!.state).toBe("writing");
  });

  it("a heading moved in the file keeps its content (found again by its words)", () => {
    const moved = [...HEADINGS].reverse().map((x, i) => ({ ...x, index: i }));
    const hi = s.run({ headings: moved });
    expect(hi.again).toEqual([]);
    expect(hi.needMatching).toBe(0);
    // Every heading that held content before still holds the same content, wherever it is in the file now.
    const before = s.run().groups.filter((g) => g.kind === "heading" && g.units.length > 0);
    expect(before.length).toBeGreaterThan(0);
    for (const g of before) expect(hi.groups.find((x) => x.title === g.title)!.units.map((u) => u.id)).toEqual(g.units.map((u) => u.id));
  });

  it("text written under a heading shows in its box and counts as answered; text whose heading is gone is listed apart", () => {
    const p1 = setTrdHeadingText(project, trdId, { headingIndex: 14, headingText: "Revision History Table" }, "Rev A: first issue (fictional).", who);
    const p2 = setTrdHeadingText(p1, trdId, { headingIndex: 14, headingText: "Document Control Table" }, "Written under a heading the template no longer has.", who);
    const d2 = p2.trd.documents.find((x) => x.id === trdId)!;
    const hi = s.run({ headingTexts: d2.headingTexts });
    const g = hi.groups.find((x) => x.headingIndex === 14)!;
    expect(g.writing!.text).toBe("Rev A: first issue (fictional).");
    expect(g.counts.essentials).toMatchObject({ total: 1, answered: 1, open: 0 });
    expect(hi.textsAgain.map((t) => t.headingText)).toEqual(["Document Control Table"]);
    expect(hi.needMatching).toBe(1);
  });

  it("text written earlier stays in view when its heading now holds content or keeps its own text", () => {
    const withText = [{ headingIndex: 13, headingText: "Company Confidentiality Statement", text: "Written before the template text was kept." }];
    const hi = s.run({ headingTexts: withText });
    const g = hi.groups.find((x) => x.headingIndex === 13)!;
    expect(g.state).toBe("kept_text");
    expect(g.writing!.text).toBe("Written before the template text was kept.");
    const onContent = s.run({ headingTexts: [{ headingIndex: 0, headingText: "Purpose", text: "Words that will print under Purpose." }] });
    expect(onContent.groups.find((x) => x.headingIndex === 0)!.writing!.text).toContain("print under Purpose");
  });

  it("the writing box follows the Show filters", () => {
    const w = { key: "heading-text:1", headingIndex: 1, headingText: "Scope", text: "" };
    expect(headingWritingMatches(w, {})).toBe(true);
    expect(headingWritingMatches(w, { show: "open" })).toBe(true);
    expect(headingWritingMatches({ ...w, text: "x" }, { show: "open" })).toBe(false);
    expect(headingWritingMatches(w, { show: "confirm" })).toBe(false);
    expect(headingWritingMatches(w, { level: "essentials" })).toBe(true);
    expect(headingWritingMatches(w, { search: "scope" })).toBe(true);
    expect(headingWritingMatches(w, { search: "valve" })).toBe(false);
  });

  it("no template match yet: every question is asked in the groups' About part or left unplaced, never lost", () => {
    const hi = s.run({ mapping: undefined });
    expect(asked(hi).length + hi.notAsked.length).toBe(s.questions.length);
    expect(hi.groups.filter((g) => g.kind === "heading").every((g) => g.state === "writing" || g.state === "kept_text")).toBe(true);
  });

  it("adding a piece back writes only to addedBack (the helper is the one from job 2)", () => {
    const left = s.run().leftOut[0]!;
    const p = addTrdAddedBack(project, trdId, left.id, who);
    expect(p.trd.documents.find((x) => x.id === trdId)!.addedBack).toEqual([left.id]);
    expect(project.trd.documents.find((x) => x.id === trdId)!.addedBack).toBeUndefined();
  });
});

describe("where an answer lands", () => {
  const { project, trdId } = wideTrd();
  const d = project.trd.documents.find((x) => x.id === trdId)!;
  const questions = deriveTrdQuestions(project, trdId, { content, wording: trdInterviewWording });
  const landings = trdAnswerLandings(project, d, questions, content);

  it("trdAnswerPlaces gives exactly the sections it gave before", () => {
    const places = trdAnswerPlaces(project, d, questions, content);
    for (const [k, l] of landings) if (l.place) expect(places.get(k)).toEqual(l.place);
    expect(places.size).toBe([...landings.values()].filter((l) => l.place).length);
  });

  it("a question read by a process description lands in that description's own unit", () => {
    const ids = trdWriteupUnitIds(d);
    const q = questions.find((x) => x.usedIn.length && d.writeups!.find((w) => w.id === x.usedIn[0]!.writeupId)?.kind === "unitOp")!;
    expect(landings.get(q.key)!.unitId).toBe(ids.get(q.usedIn[0]!.writeupId));
    expect(landings.get(q.key)!.unitId).toMatch(/^overview:/);
  });

  it("a prose question lands in its own section's unit; a value with no description lands in the parameters section; document fields have no unit", () => {
    const prose = questions.find((x) => x.target.kind === "blank" && x.usedIn.length && d.writeups!.find((w) => w.id === x.usedIn[0]!.writeupId)?.kind === "section")!;
    expect(landings.get(prose.key)!.unitId).toMatch(/^(writeup-|overview:|manufacturing-overview)/);
    const params = questions.filter((x) => (x.target.kind === "field" || x.target.kind === "limits") && x.usedIn.length === 0);
    expect(params.length).toBeGreaterThan(0);
    for (const q of params.slice(0, 20)) expect(["writeup-process_parameters", "process-parameters"]).toContain(landings.get(q.key)!.unitId);
    for (const q of questions.filter((x) => x.target.kind === "document" || x.target.kind === "detail")) expect(landings.has(q.key)).toBe(false);
  });

  it("how many questions have no landing place (the ones that go to Details of this TRD without being a field of the document)", () => {
    const s = setup(project, trdId);
    const hi = s.run();
    // The watch point of the job: a question with no landing place would pile into Details of this TRD. On the widest TRD (499 questions) there is none:
    // 5 document fields and 6 details are the only ones there, as before.
    expect(hi.aboutKinds).toEqual({ document: 5, detail: 6, noPlace: 0 });
  });
});
