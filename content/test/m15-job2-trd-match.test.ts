// M15 job 2: the TRD under the headings of a person's own Word template. Engine and data: the model (schema 1.35.0), the units, the suggested
// matches, a template that changed, the screen's working copy and the edits with their logged reasons. Fictional data only.
import {
  TRD_FRONT_UNIT,
  TrdError,
  addTrdAddedBack,
  buildDemoProject,
  buildTrdDocument,
  clearTrdHeadingText,
  draftFromMapping,
  draftFromSuggestions,
  draftMissingPicks,
  headingKey,
  mappingFromDraft,
  parseTrdMapping,
  rematchTrdMapping,
  removeTrdAddedBack,
  resolveHeadingTexts,
  setTrdHeadingText,
  suggestTrdMatch,
  trdLeftOut,
  trdLibraryUnits,
  trdMatchCountLine,
  trdMatchCounts,
  trdUnitHints,
  trdUnitModel,
  trdUnitsOf,
  type MatchHeading,
  type TrdMapping,
} from "@gap/engine";
import { PROCESS_MODEL_VERSION, SCHEMA_VERSION, parseProject, trdHeadingTextSchema, type Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-11T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const later = { name: "Sam Sample (fictional)", at: "2026-11-11T10:00:00.000Z" };

const project: Project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
const d = project.trd.documents[0]!;
const model = buildTrdDocument(project, d, { generatedAt: T, appVersion: "0.0.0-test", content });
const unitModel = trdUnitModel(model, d);
const units = trdUnitsOf(unitModel);
const hints = trdUnitHints(d, content);

const h = (index: number, text: string, level = 1, hasBody = true): MatchHeading => ({ index, level, text, hasBody });
/** A fictional site template's headings: 13 that a TRD can fill and two (the last) that nothing in it fits. */
const HEADINGS: MatchHeading[] = [
  h(0, "1 Purpose"),
  h(1, "2 Scope"),
  h(2, "3 Abbreviations"),
  h(3, "4 Introduction"),
  h(4, "5 Batch Size"),
  h(5, "6 Process Description"),
  h(6, "6.1 Buffer Preparation", 2),
  h(7, "6.2 Sterile Filtration", 2),
  h(8, "6.3 Filling", 2),
  h(9, "7 Container Closure"),
  h(10, "8 Open Items"),
  h(11, "9 References"),
  h(12, "Document Sign-off"),
  h(13, "Company Confidentiality Statement"),
  h(14, "Revision History Table", 1, false),
];

describe("schema 1.35.0: text under a template heading, and sections added at the end", () => {
  it("a 1.34.0 project opens with only the version changed", () => {
    expect(SCHEMA_VERSION).toBe("1.35.0");
    expect(PROCESS_MODEL_VERSION).toBe("1.21.0");
    const base = JSON.parse(JSON.stringify(project));
    const once = parseProject({ ...base, schemaVersion: "1.34.0" });
    expect(once.schemaVersion).toBe("1.35.0");
    expect(once.trd).toEqual(base.trd);
    expect(once.trd.documents[0]!.headingTexts).toBeUndefined();
    expect(once.trd.documents[0]!.addedBack).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("the stored text names its heading by index and words, and takes no empty text", () => {
    const ok = { headingIndex: 3, headingText: "Comparison", text: "Written by the person.", setAt: T, setBy: "A" };
    expect(trdHeadingTextSchema.safeParse(ok).success).toBe(true);
    expect(trdHeadingTextSchema.safeParse({ ...ok, headingIndex: -1 }).success).toBe(false);
    expect(trdHeadingTextSchema.safeParse({ ...ok, text: "" }).success).toBe(false);
  });
});

describe("the pieces of the TRD that can be placed (units)", () => {
  it("each has a stable id that is not a section number, in document order, and the title block is the first", () => {
    expect(units[0]).toMatchObject({ id: TRD_FRONT_UNIT });
    const ids = units.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of units) expect(u.id).not.toMatch(/^\d/);
    expect(ids).toEqual(expect.arrayContaining(["writeup-purpose", "overview:wu_buffer_prep", "overview:wu_sterile_filtration", "open-items", "approval", "references"]));
  });

  it("the process overview is split into one unit per process description, and Cascade's own numbers are taken out of the text", () => {
    const overview = unitModel.sections.find((s) => s.id === "overview:wu_buffer_prep")!;
    expect(overview.number).toBe("");
    expect(overview.blocks.some((b) => b.type === "heading" && /^\d+\.\d+/.test(b.text))).toBe(false);
    for (const s of unitModel.sections) {
      expect(s.number).toBe("");
      expect(s.appendix).toBeFalsy();
    }
    // Nothing is dropped: the words of the document are all still there.
    const words = (blocks: readonly { type: string; text?: string }[]) => blocks.filter((b) => b.type === "paragraph").length;
    expect(words(unitModel.sections.flatMap((s) => [...s.blocks]))).toBe(words(model.sections.flatMap((s) => [...s.blocks])));
  });

  it("the library list (no TRD open) holds the built-in sections and the process descriptions", () => {
    const lib = trdLibraryUnits(trdWriteups);
    const ids = lib.map((u) => u.id);
    expect(ids[0]).toBe(TRD_FRONT_UNIT);
    expect(ids).toEqual(expect.arrayContaining(["writeup-purpose", "manufacturing-overview", "open-items", "approval", "references"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("suggested matches", () => {
  const found = suggestTrdMatch(HEADINGS, units, hints);
  const of = (index: number) => found.find((s) => s.headingIndex === index)?.units;

  it("suggests the plain names and nothing for the two headings that match nothing", () => {
    expect(of(0)).toContain("writeup-purpose");
    expect(of(1)).toContain("writeup-scope");
    expect(of(2)).toContain("writeup-acronyms");
    expect(of(3)).toContain("writeup-introduction");
    expect(of(4)).toContain("writeup-batch_size");
    expect(of(5)).toContain("manufacturing-overview");
    expect(of(6)).toContain("overview:wu_buffer_prep");
    expect(of(7)).toContain("overview:wu_sterile_filtration");
    expect(of(8)).toContain("overview:wu_aseptic_filling");
    expect(of(9)).toContain("writeup-container_closure");
    expect(of(10)).toContain("open-items");
    expect(of(11)).toContain("references");
    expect(of(12)).toContain("approval");
    // Two headings fit nothing: they get no suggestion (never a default).
    expect(of(13)).toBeUndefined();
    expect(of(14)).toBeUndefined();
  });

  it("puts each piece under one heading only, and suggests nothing that is not in the list", () => {
    const all = found.flatMap((s) => s.units);
    expect(new Set(all).size).toBe(all.length);
    const known = new Set(units.map((u) => u.id));
    for (const id of all) expect(known.has(id)).toBe(true);
  });

  const steps = units.filter((u) => u.id.startsWith("overview:")).map((u) => u.id);

  it("one heading for the whole process ('Process description'): the overview and every process-step description are suggested under it, in process order", () => {
    expect(steps.length).toBeGreaterThan(10);
    const one = suggestTrdMatch([h(0, "3 Process Description"), h(1, "Open Items")], units, hints);
    const process = one.find((s) => s.headingIndex === 0)!.units;
    expect(process[0]).toBe("manufacturing-overview");
    expect(process.slice(1)).toEqual(steps);
    // The rest of the TRD is untouched: Open Items still gets its own piece only.
    expect(one.find((s) => s.headingIndex === 1)!.units).toEqual(["open-items"]);
    // Still only a suggestion: the draft has no pick and nothing is stored.
    expect(draftMissingPicks(draftFromSuggestions([h(0, "3 Process Description"), h(1, "Open Items")], one))).toEqual(["3 Process Description", "Open Items"]);
  });

  it("a heading per step: a step goes under the heading that is its own name, and only the steps without one follow the overview", () => {
    // HEADINGS has "Buffer Preparation", "Sterile Filtration" and "Filling" of their own, under the overview heading.
    expect(of(5)![0]).toBe("manufacturing-overview");
    expect(of(6)).toContain("overview:wu_buffer_prep");
    expect(of(7)).toContain("overview:wu_sterile_filtration");
    expect(of(8)).toContain("overview:wu_aseptic_filling");
    const own = new Set([...of(6)!, ...of(7)!, ...of(8)!]);
    const underOverview = of(5)!.filter((id) => id.startsWith("overview:"));
    // Every other step follows the overview, in process order, and none is placed twice.
    expect(underOverview).toEqual(steps.filter((id) => !own.has(id)));
    for (const id of own) expect(underOverview).not.toContain(id);
    expect(steps.every((id) => found.some((s) => s.units.includes(id)))).toBe(true);
  });

  it("with no heading for the process at all, the steps are not pulled anywhere by guesswork", () => {
    const none = suggestTrdMatch([h(0, "Purpose"), h(1, "Open Items")], units, hints);
    expect(none.flatMap((s) => s.units).filter((id) => id.startsWith("overview:"))).toEqual([]);
  });

  it("uses the TRD's own step names and the catalog's names as other names of a process description", () => {
    const only = [{ id: "overview:wu_x", title: "Some library title" }];
    expect(suggestTrdMatch([h(0, "Cell Wash")], only, {})).toEqual([]);
    expect(suggestTrdMatch([h(0, "Cell Wash")], only, { "overview:wu_x": ["Cell wash"] })).toEqual([{ headingIndex: 0, headingText: "Cell Wash", units: ["overview:wu_x"] }]);
    // The demo TRD's steps give names of their own.
    expect(Object.values(hints).some((names) => names.length > 0)).toBe(true);
  });

  it("a suggestion is a draft row without a pick: the person still has to choose what happens to their own text", () => {
    const rows = draftFromSuggestions(HEADINGS, found);
    expect(rows).toHaveLength(HEADINGS.length);
    expect(rows.every((r) => r.existing === undefined)).toBe(true);
    expect(draftMissingPicks(rows)).toEqual(rows.filter((r) => r.units.length > 0).map((r) => r.headingText));
    expect(draftMissingPicks(rows)).not.toContain("Company Confidentiality Statement");
  });
});

describe("a template that changed", () => {
  const stored: TrdMapping = {
    templateVersion: "1",
    headings: [
      { headingIndex: 0, headingText: "1 Purpose", units: ["writeup-purpose"], existing: "replace" },
      { headingIndex: 1, headingText: "2 Scope", units: ["writeup-scope"], existing: "keep" },
      { headingIndex: 2, headingText: "Gone Heading", units: ["writeup-acronyms"], existing: "replace" },
    ],
  };

  it("an unchanged template comes back unchanged", () => {
    const r = rematchTrdMapping(HEADINGS, stored);
    expect(r.again.map((p) => p.headingText)).toEqual(["Gone Heading"]);
    expect(r.mapping.headings.map((p) => [p.headingIndex, p.existing])).toEqual([[0, "replace"], [1, "keep"]]);
    expect(r.mapping.templateVersion).toBe("1");
  });

  it("finds a heading again by its words when its place or numbering changed, and lists the one that is gone", () => {
    const moved = [h(7, "Scope"), h(8, "Purpose"), h(9, "Other")];
    const r = rematchTrdMapping(moved, stored);
    expect(r.mapping.headings.map((p) => [p.headingIndex, p.units[0]])).toEqual([[7, "writeup-scope"], [8, "writeup-purpose"]]);
    expect(r.again.map((p) => p.headingText)).toEqual(["Gone Heading"]);
    expect(headingKey("3.1  Purpose!")).toBe(headingKey("purpose"));
  });

  it("text written under a heading is found again the same way", () => {
    const texts = [
      { headingIndex: 0, headingText: "1 Purpose", text: "kept" },
      { headingIndex: 3, headingText: "Gone", text: "lost heading" },
    ];
    const r = resolveHeadingTexts([h(5, "Purpose"), h(6, "Other")], texts);
    expect(r.byIndex.get(5)?.text).toBe("kept");
    expect(r.again.map((x) => x.text)).toEqual(["lost heading"]);
  });
});

describe("the match screen's working copy", () => {
  it("starts from the stored match, drops content this TRD does not have, and keeps the picks", () => {
    const stored: TrdMapping = { headings: [{ headingIndex: 0, headingText: "1 Purpose", units: ["writeup-purpose", "overview:not_in_this_trd"], existing: "keep" }] };
    const known = new Set(units.map((u) => u.id));
    const rows = draftFromMapping(HEADINGS, stored, known);
    expect(rows[0]).toEqual({ headingIndex: 0, headingText: "1 Purpose", units: ["writeup-purpose"], existing: "keep" });
    expect(rows[1]).toEqual({ headingIndex: 1, headingText: "2 Scope", units: [] });
  });

  it("saving from this TRD keeps placements of content only another TRD has, and stores only headings that have content and a pick", () => {
    const known = new Set(units.map((u) => u.id));
    const stored: TrdMapping = { headings: [{ headingIndex: 0, headingText: "1 Purpose", units: ["writeup-purpose", "overview:from_another_trd"], existing: "keep" }] };
    const rows = draftFromMapping(HEADINGS, stored, known);
    rows[1] = { ...rows[1]!, units: ["writeup-scope"], existing: "replace" };
    rows[2] = { ...rows[2]!, units: ["writeup-acronyms"] };
    expect(draftMissingPicks(rows)).toEqual(["3 Abbreviations"]);
    const m = mappingFromDraft(rows.filter((r) => r.headingIndex !== 2), stored, known, "2.1");
    expect(m.templateVersion).toBe("2.1");
    expect(m.headings.map((p) => p.headingIndex)).toEqual([0, 1]);
    expect(m.headings[0]).toMatchObject({ units: ["writeup-purpose", "overview:from_another_trd"], existing: "keep" });
    // Taking the piece out of the heading in this TRD removes it; the other TRD's piece stays.
    const cleared = rows.filter((r) => r.headingIndex !== 2).map((r) => (r.headingIndex === 0 ? { ...r, units: [] as string[], existing: undefined } : r));
    const m2 = mappingFromDraft(cleared, stored, known);
    expect(m2.headings[0]).toMatchObject({ headingIndex: 0, units: ["overview:from_another_trd"], existing: "keep" });
  });

  it("counts the headings with and without content and lists what the template has no heading for, without the title block", () => {
    const rows = [
      { headingIndex: 0, units: ["writeup-purpose"] },
      { headingIndex: 1, units: ["writeup-scope", "writeup-acronyms"] },
    ];
    const c = trdMatchCounts(HEADINGS, rows, units);
    expect(c).toMatchObject({ headings: 15, withContent: 2, withoutContent: 13, placed: 3 });
    expect(c.notInTemplate.some((u) => u.id === TRD_FRONT_UNIT)).toBe(false);
    expect(c.notInTemplate.some((u) => u.id === "open-items")).toBe(true);
    expect(trdMatchCountLine(c)).toBe(`Your template has 15 headings. Cascade content is placed under 2 of them. ${c.notInTemplate.length} sections not in your template yet.`);
    expect(trdMatchCountLine({ headings: 1, withContent: 1, withoutContent: 0, placed: 1, notInTemplate: [{ id: "a", title: "A" }] })).toBe("Your template has 1 heading. Cascade content is placed under 1 of them. 1 section not in your template yet.");
  });

  it("what is left out is what is neither placed nor added at the end, and never the title block", () => {
    const mapping: TrdMapping = { headings: [{ headingIndex: 0, headingText: "1 Purpose", units: ["writeup-purpose"], existing: "replace" }] };
    const out = trdLeftOut(units, mapping, ["references"]).map((u) => u.id);
    expect(out).not.toContain("writeup-purpose");
    expect(out).not.toContain("references");
    expect(out).not.toContain(TRD_FRONT_UNIT);
    expect(out).toContain("approval");
    expect(trdLeftOut(units, undefined).length).toBe(units.length - 1);
  });

  it("a stored match that is not shaped like one is ignored; a good one is read back", () => {
    expect(parseTrdMapping(null)).toBeUndefined();
    expect(parseTrdMapping({})).toBeUndefined();
    expect(parseTrdMapping("x")).toBeUndefined();
    const m: TrdMapping = { templateVersion: "3", headings: [{ headingIndex: 2, headingText: "Scope", units: ["writeup-scope"], existing: "keep" }] };
    expect(parseTrdMapping(JSON.parse(JSON.stringify(m)))).toEqual(m);
    // Entries without a pick or with the wrong kinds of values are not invented into something else.
    const odd = parseTrdMapping({ headings: [{ headingIndex: "x", headingText: 1, units: [3] }, { headingIndex: 1, headingText: "Scope", units: ["a", 2, ""], existing: "keep" }] });
    expect(odd?.headings.every((e) => e.units.every((u) => typeof u === "string" && u.length > 0))).toBe(true);
  });
});

describe("editing the TRD: text under a heading and sections added at the end", () => {
  const ref = { headingIndex: 3, headingText: "Comparison of Source and Receiving Processes" };

  it("writes text under a heading, remembers who and when, and the same text again changes nothing", () => {
    const p = setTrdHeadingText(project, d.id, ref, "  Written by the person.  ", who);
    const t = p.trd.documents[0]!.headingTexts!;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ ...ref, text: "Written by the person.", setBy: who.name, setAt: T });
    expect(setTrdHeadingText(p, d.id, ref, "Written by the person.", later)).toBe(p);
    expect(parseProject(JSON.parse(JSON.stringify(p))).trd.documents[0]!.headingTexts).toEqual(t);
    expect(() => setTrdHeadingText(project, d.id, ref, "   ", who)).toThrow(TrdError);
    expect(() => setTrdHeadingText(project, d.id, { headingIndex: 1, headingText: " " }, "x", who)).toThrow(TrdError);
  });

  it("a change keeps the earlier text in the log", () => {
    const p1 = setTrdHeadingText(project, d.id, ref, "First.", who);
    const p2 = setTrdHeadingText(p1, d.id, ref, "Second.", later);
    const ev = p2.changeLog.at(-1)!;
    expect(ev.action).toBe("trd_heading_text_set");
    expect(ev.before).toMatchObject({ text: "First." });
    expect(ev.after).toMatchObject({ text: "Second." });
    expect(p2.trd.documents[0]!.headingTexts).toHaveLength(1);
  });

  it("removing the text asks for a reason, logs it with the removed text, and leaves no empty list behind", () => {
    const p = setTrdHeadingText(project, d.id, ref, "To be removed.", who);
    const q = clearTrdHeadingText(p, d.id, ref, "Written under the wrong heading.", later);
    expect(q.trd.documents[0]!.headingTexts).toBeUndefined();
    const ev = q.changeLog.at(-1)!;
    expect(ev.action).toBe("trd_heading_text_clear");
    expect(ev.detail).toContain("Written under the wrong heading.");
    expect(ev.before).toMatchObject({ text: "To be removed." });
    // Nothing to remove: nothing changes.
    expect(clearTrdHeadingText(project, d.id, ref, "x", later)).toBe(project);
  });

  it("adds a section at the end by its stable id, once, and takes it out again with a logged reason", () => {
    const p = addTrdAddedBack(project, d.id, "references", who);
    expect(p.trd.documents[0]!.addedBack).toEqual(["references"]);
    expect(addTrdAddedBack(p, d.id, "references", later)).toBe(p);
    expect(() => addTrdAddedBack(project, d.id, " ", who)).toThrow(TrdError);
    const two = addTrdAddedBack(p, d.id, "approval", who);
    const q = removeTrdAddedBack(two, d.id, "references", "Not wanted at the end.", later);
    expect(q.trd.documents[0]!.addedBack).toEqual(["approval"]);
    const ev = q.changeLog.at(-1)!;
    expect(ev.action).toBe("trd_added_back_clear");
    expect(ev.detail).toContain("Not wanted at the end.");
    expect(removeTrdAddedBack(removeTrdAddedBack(q, d.id, "approval", "x", later), d.id, "approval", "x", later).trd.documents[0]!.addedBack).toBeUndefined();
    expect(parseProject(JSON.parse(JSON.stringify(two))).trd.documents[0]!.addedBack).toEqual(["references", "approval"]);
  });

  it("leaves the open items count and the other documents alone", () => {
    const p = addTrdAddedBack(setTrdHeadingText(project, d.id, ref, "Text.", who), d.id, "references", who);
    expect(p.document).toEqual(project.document);
    expect(p.trd.documents[0]!.steps).toEqual(project.trd.documents[0]!.steps);
  });
});
