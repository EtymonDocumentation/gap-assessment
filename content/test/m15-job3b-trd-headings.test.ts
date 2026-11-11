// M15 job 3B: one source for "which headings are still to complete" (trd-heading-plan.ts), the open items of a TRD that follows a template's
// headings (trdOpenItems with a context, trdOpenItemsFor) and the TRD document in the template's order (trd-template-document.ts).
// Fictional data only: a made-up 9-heading template against a narrow TRD.
import {
  addTrdAddedBack,
  buildDemoProject,
  buildTrdDocument,
  createTrd,
  deriveTrdQuestions,
  draftFromSuggestions,
  mappingFromDraft,
  setTrdHeadingText,
  setTrdTemplateChoice,
  suggestTrdMatch,
  trdAllUnitIds,
  trdAnswerLandings,
  trdHeadingInterview,
  trdHeadingPlan,
  trdHeadingsToComplete,
  trdOpenItems,
  trdOpenItemsFor,
  trdTemplateDocument,
  trdUnitHints,
  trdUnitModel,
  trdUnitsOf,
  TRD_ADDITIONAL_HEADING,
  TRD_KEPT_TEXT_NOTE,
  TRD_TO_COMPLETE_TEXT,
  type MatchHeading,
  type TrdMapping,
  type TrdTemplateSource,
} from "@gap/engine";
import type { Project } from "@gap/process-model";
import { renderHtmlBody, renderMarkdown } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, trdInterviewWording, trdWriteups } from "../index";

vi.setConfig({ testTimeout: 60_000 });

const T = "2026-11-11T09:00:00.000Z";
const who = { name: "Alex Example (fictional)", at: T };
const h = (index: number, text: string, level = 1, hasBody = true, number?: string): MatchHeading => ({ index, level, text, hasBody, ...(number ? { number } : {}) });
const HEADINGS: MatchHeading[] = [
  h(0, "Purpose", 1, false, "1"),
  h(1, "Scope", 1, false, "2"),
  h(2, "Abbreviations", 1, false, "3"),
  h(3, "Batch Size", 1, false, "4"),
  h(4, "Process Description", 1, false, "5"),
  h(5, "Open Items", 1, false, "6"),
  h(6, "Document Sign-off", 1, true, "7"),
  h(7, "Revision History Table", 1, false),
  h(8, "Glossary Of Site Terms", 1, false, "9"),
];
const titleOf = (x: MatchHeading) => (x.number ? `${x.number} ${x.text}` : x.text);

function trdProject(): { project: Project; trdId: string } {
  const base = buildDemoProject(content, demos["arx-217"] as never);
  const p: Project = { ...base, trd: { documents: [] }, changeLog: base.changeLog.filter((e) => !(e.path ?? "").startsWith("trd.")) };
  const steps = content.catalog.unitOperations.slice(0, 2).map((u) => ({ unitOp: u.key, label: u.label }));
  const made = createTrd(p, { title: "Narrow TRD (fictional)", start: { kind: "blank", steps }, library: trdWriteups }, who);
  return { project: setTrdTemplateChoice(made.project, made.trdId, { kind: "mapped", templateId: "tpl-1", templateName: "Site template (fictional)" }, who), trdId: made.trdId };
}

function setup() {
  const { project, trdId } = trdProject();
  const d = project.trd.documents.find((x) => x.id === trdId)!;
  const model = buildTrdDocument(project, d, { generatedAt: T, appVersion: "0.0.0-test", content });
  const units = trdUnitsOf(trdUnitModel(model, d));
  const suggestions = suggestTrdMatch(HEADINGS, units, trdUnitHints(d, content));
  const mapping = mappingFromDraft(draftFromSuggestions(HEADINGS, suggestions).map((r) => (r.units.length ? { ...r, existing: "replace" as const } : r)), undefined, new Set(units.map((u) => u.id)));
  const source: TrdTemplateSource = { name: "Site template (fictional)", headings: HEADINGS, mapping };
  return { project, trdId, d, units, mapping, source };
}

describe("one source for the headings still to complete", () => {
  const s = setup();
  const input = (over: Partial<Parameters<typeof trdHeadingsToComplete>[0]> = {}) => ({ headings: HEADINGS, mapping: s.mapping, unitIds: s.units.map((u) => u.id), headingTexts: s.d.headingTexts, addedBack: s.d.addedBack, ...over });

  it("lists a heading with no content, no written text and no kept template text, with its number and words", () => {
    const list = trdHeadingsToComplete(input());
    expect(list.find((x) => x.headingIndex === 7)).toMatchObject({ title: "Revision History Table", text: "Revision History Table" });
    expect(list.find((x) => x.headingIndex === 8)?.title).toBe("9 Glossary Of Site Terms");
    // The heading whose own text stays is not open.
    expect(list.some((x) => x.headingIndex === 6)).toBe(false);
  });

  it("is the same list the interview shows as open writing boxes (and written text takes a heading off it)", () => {
    const withText = setTrdHeadingText(s.project, s.trdId, { headingIndex: 8, headingText: "Glossary Of Site Terms" }, "Our own words.", who);
    for (const project of [s.project, withText]) {
      const d = project.trd.documents.find((x) => x.id === s.trdId)!;
      const questions = deriveTrdQuestions(project, s.trdId, { content, wording: trdInterviewWording });
      const landings = trdAnswerLandings(project, d, questions, content);
      const unitOf = new Map([...landings].flatMap(([k, l]) => (l.unitId ? [[k, l.unitId] as const] : [])));
      const hi = trdHeadingInterview({ questions, unitOf, units: s.units, headings: HEADINGS, mapping: s.mapping, headingTexts: d.headingTexts, addedBack: d.addedBack });
      const fromInterview = hi.groups.filter((g) => g.state === "writing" && !g.writing?.text.trim()).map((g) => ({ i: g.headingIndex, title: g.title }));
      const fromPlan = trdHeadingsToComplete(input({ headingTexts: d.headingTexts, addedBack: d.addedBack })).map((x) => ({ i: x.headingIndex, title: x.title }));
      expect(fromPlan).toEqual(fromInterview);
    }
    expect(trdHeadingsToComplete(input({ headingTexts: [{ headingIndex: 8, headingText: "Glossary Of Site Terms", text: "Our own words." }] })).some((x) => x.headingIndex === 8)).toBe(false);
  });

  it("does not count a heading to match again, and ignores content the TRD does not have", () => {
    const gone: TrdMapping = {
      headings: [
        { headingIndex: 7, headingText: "Gone heading", units: ["purpose-scope"], existing: "replace" },
        { headingIndex: 8, headingText: "Glossary Of Site Terms", units: ["no-such-unit"], existing: "replace" },
      ],
    };
    const list = trdHeadingsToComplete(input({ mapping: gone }));
    expect(list.some((x) => x.headingIndex === 8)).toBe(true);
    expect(list.some((x) => x.title === "Gone heading")).toBe(false);
  });

  it("puts a piece under the first heading in the file that holds it, and add-backs in the document's order", () => {
    const twice: TrdMapping = {
      headings: [
        { headingIndex: 0, headingText: "Purpose", units: ["purpose-scope"], existing: "replace" },
        { headingIndex: 1, headingText: "Scope", units: ["purpose-scope"], existing: "replace" },
      ],
    };
    const plan = trdHeadingPlan(input({ mapping: twice, addedBack: ["open-items", "purpose-scope"] }));
    expect(plan.slots[0]!.ids).toEqual(["purpose-scope"]);
    expect(plan.slots[1]!.ids).toEqual([]);
    expect(plan.back).toEqual(["open-items"]);
    expect(plan.leftOut).not.toContain("front");
  });
});

describe("open items of a TRD that follows a template's headings", () => {
  const s = setup();
  const empty = trdHeadingsToComplete({ headings: HEADINGS, mapping: s.mapping, unitIds: s.units.map((u) => u.id) });

  it("without a template the result is exactly what it was", () => {
    expect(trdOpenItemsFor(s.project, s.d)).toEqual(trdOpenItems(s.d));
    expect(trdOpenItems(s.d).some((o) => o.kind === "heading_empty")).toBe(false);
  });

  it("with a template there is one more open item per heading, after the TRD's own, worded with the heading's number and words", () => {
    const base = trdOpenItems(s.d);
    const items = trdOpenItemsFor(s.project, s.d, s.source);
    expect(empty.length).toBeGreaterThan(0);
    expect(items.length).toBe(base.length + empty.length);
    expect(items.slice(0, base.length)).toEqual(base);
    const extra = items.slice(base.length);
    expect(extra.every((o) => o.kind === "heading_empty" && o.text === "Nothing written under this heading yet.")).toBe(true);
    expect(extra.map((o) => o.where)).toEqual(empty.map((e) => e.title));
    expect(extra.map((o) => o.headingIndex)).toEqual(empty.map((e) => e.headingIndex));
  });

  it("a TRD that does not use a template's headings counts none, whatever template is passed", () => {
    const other = setTrdTemplateChoice(s.project, s.trdId, { kind: "later" }, who);
    const d = other.trd.documents.find((x) => x.id === s.trdId)!;
    expect(trdOpenItemsFor(other, d, s.source)).toEqual(trdOpenItems(d));
  });

  it("filling a heading takes one off; the document's own list and tbdCount say the same number", () => {
    const index = empty[0]!.headingIndex;
    const filled = setTrdHeadingText(s.project, s.trdId, { headingIndex: index, headingText: HEADINGS[index]!.text }, "Written here.", who);
    const d2 = filled.trd.documents.find((x) => x.id === s.trdId)!;
    expect(trdOpenItemsFor(filled, d2, s.source).length).toBe(trdOpenItemsFor(s.project, s.d, s.source).length - 1);
    const model = buildTrdDocument(s.project, s.d, { generatedAt: T, appVersion: "0.0.0-test", content, template: s.source });
    expect(model.tbdCount).toBe(trdOpenItemsFor(s.project, s.d, s.source).length);
    const text = JSON.stringify(model.sections.find((x) => x.id === "open-items")!.blocks);
    expect(text).toContain("Revision History Table");
    expect(text).toContain("Nothing written under this heading yet.");
  });

  it("a TRD with no template builds the same document as before (nothing in it changes)", () => {
    const a = buildTrdDocument(s.project, s.d, { generatedAt: T, appVersion: "0.0.0-test", content });
    const b = buildTrdDocument(s.project, s.d, { generatedAt: T, appVersion: "0.0.0-test", content, template: undefined });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("the piece list used for the count is the one the match screen offers", () => {
    expect(trdAllUnitIds(s.project, s.d, content)).toEqual(s.units.map((u) => u.id));
  });
});

describe("the TRD document in the template's order", () => {
  const s = setup();
  const model = buildTrdDocument(s.project, s.d, { generatedAt: T, appVersion: "0.0.0-test", content, template: s.source });
  const out = trdTemplateDocument(model, s.d, s.source);

  it("has one section per heading, in the template's order, titled as in the file (number and words)", () => {
    const heads = out.sections.filter((x) => x.id.startsWith("heading-"));
    expect(heads.map((x) => x.title)).toEqual(HEADINGS.map(titleOf));
    expect(heads.every((x) => x.exactTitle && x.number === "")).toBe(true);
    expect(out.title).toBe(model.title);
    expect(out.meta).toEqual(model.meta);
  });

  it("an empty heading says [To be completed.] as an open blank; a heading with the template's own text says so, and that is not open", () => {
    expect(out.sections.find((x) => x.id === "heading-7")!.blocks).toEqual([{ type: "rich", style: "paragraph", runs: [{ text: TRD_TO_COMPLETE_TEXT, bold: true, open: true }] }]);
    expect(out.sections.find((x) => x.id === "heading-6")!.blocks).toEqual([{ type: "note", text: TRD_KEPT_TEXT_NOTE }]);
  });

  it("written text goes under its heading, one paragraph per line", () => {
    const withText = setTrdHeadingText(s.project, s.trdId, { headingIndex: 7, headingText: "Revision History Table" }, "Line one.\n\nLine two.", who);
    const d2 = withText.trd.documents.find((x) => x.id === s.trdId)!;
    const o = trdTemplateDocument(buildTrdDocument(withText, d2, { generatedAt: T, appVersion: "0.0.0-test", content, template: s.source }), d2, s.source);
    expect(o.sections.find((x) => x.id === "heading-7")!.blocks).toEqual([
      { type: "paragraph", text: "Line one." },
      { type: "paragraph", text: "Line two." },
    ]);
  });

  it("one piece under a heading: the heading replaces Cascade's title; several: each keeps its title one level below", () => {
    const unitModel = trdUnitModel(model, s.d);
    const placed = s.mapping.headings.find((p) => p.units.length === 1)!;
    const sec = unitModel.sections.find((x) => x.id === placed.units[0])!;
    expect(out.sections.find((x) => x.id === `heading-${placed.headingIndex}`)!.blocks).toEqual(sec.blocks);
    const two = ["purpose-scope", "open-items"];
    const many: TrdMapping = { headings: [{ headingIndex: 4, headingText: "Process Description", units: two, existing: "replace" }] };
    const o = trdTemplateDocument(model, s.d, { ...s.source, mapping: many });
    const blocks = o.sections.find((x) => x.id === "heading-4")!.blocks;
    const titles = two.map((id) => unitModel.sections.find((x) => x.id === id)!.title);
    const at = titles.map((t) => blocks.findIndex((b) => b.type === "heading" && b.text === t));
    expect(at[0]).toBe(0);
    expect(at[1]).toBeGreaterThan(at[0]!);
    // The piece's own sub-headings move one level further down.
    const inner = blocks.filter((b) => b.type === "heading" && !titles.includes(b.text));
    expect(inner.every((b) => b.type === "heading" && (b.level === 2 || b.level === 3))).toBe(true);
  });

  it("add-backs go under Additional content, left-out pieces are not in the document, Cascade numbers are gone", () => {
    const placed = new Set(s.mapping.headings.flatMap((p) => p.units));
    const loose = s.units.map((u) => u.id).filter((id) => id !== "front" && !placed.has(id));
    expect(loose.length).toBeGreaterThan(0);
    const added = addTrdAddedBack(s.project, s.trdId, loose[0]!, who);
    const d2 = added.trd.documents.find((x) => x.id === s.trdId)!;
    const o = trdTemplateDocument(buildTrdDocument(added, d2, { generatedAt: T, appVersion: "0.0.0-test", content, template: s.source }), d2, s.source);
    const last = o.sections[o.sections.length - 1]!;
    expect(last.title).toBe(TRD_ADDITIONAL_HEADING);
    expect(last.blocks[0]).toMatchObject({ type: "heading" });
    // Without the add-back there is no such section, and no piece with no heading is in the document.
    expect(out.sections.map((x) => x.title)).not.toContain(TRD_ADDITIONAL_HEADING);
    expect(out.sections.length).toBe(HEADINGS.length);
    expect(JSON.stringify(out.sections)).not.toMatch(/"text":"\d+\.\d+ [A-Z]/);
  });

  it("HTML and Markdown print the template's headings as they are, in the template's order", () => {
    const md = renderMarkdown(out)
      .split("\n")
      .filter((l) => l.startsWith("## "));
    expect(md).toEqual(HEADINGS.map((x) => `## ${titleOf(x)}`));
    const html = renderHtmlBody(out);
    const at = HEADINGS.map((x) => html.indexOf(`<h2>${titleOf(x)}</h2>`));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('id="doc-heading-7"');
    expect(html).toContain(TRD_TO_COMPLETE_TEXT);
  });
});
