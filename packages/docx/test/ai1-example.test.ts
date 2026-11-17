import { AI_EVIDENCE_PREFIX, aiCardsOf, aiCountText, aiCounts, applyImport, buildDemoProject, importCounts, isExact, overlayAiReading, sessionFromOther, type ImportDecisions } from "@gap/engine";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdImportSynonyms } from "../../../content/index";
import { exampleTrdReading } from "../../../content/ai-reading/index";
import { readTrdUpload } from "../src/index";
import { exampleTrdDocx, EXAMPLE_TRD_FILE_NAME } from "../src/example-trd";
import { GENERATED_AT } from "./fixtures";

vi.setConfig({ testTimeout: 60000 });

// Job AI1: the example finished TRD (Word) and its PRE-RECORDED AI reading. No AI runs here: the suggestions are a fixed list.
const SHIPPED = join(__dirname, "../../../apps/web/public/examples", EXAMPLE_TRD_FILE_NAME);

// "WRITE_EXAMPLE_TRD=1 npx vitest run packages/docx/test/ai1-example.test.ts" rewrites the shipped file from the generator.
if (process.env.WRITE_EXAMPLE_TRD === "1") writeFileSync(SHIPPED, exampleTrdDocx());

const P = (uo: string, key: string, part: string) => `trd.step.${uo}.param.${key}.${part}`;
const actor = { name: "Test reviewer", at: GENERATED_AT };
const read = () => readTrdUpload(exampleTrdDocx(), EXAMPLE_TRD_FILE_NAME);
const rules = () => sessionFromOther(read(), content.catalog, trdImportSynonyms);
const withAi = () => overlayAiReading(rules(), exampleTrdReading);

/** All the text of the file as read: paragraphs and table cells. */
const allText = (): string[] =>
  read().blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat().map((c) => c.text) : b.kind === "para" || b.kind === "heading" ? [b.text] : []));

describe("the shipped example Word file", () => {
  it("is exactly what the generator makes (so the file and the recording cannot drift apart)", () => {
    expect(existsSync(SHIPPED)).toBe(true);
    const a = new PizZip(readFileSync(SHIPPED));
    const b = new PizZip(exampleTrdDocx());
    expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
    // Compared part by part, not byte for byte: zip stores file dates in LOCAL time, so the same fixed date gives
    // different bytes on a laptop and on the UTC build server, while every part's content is identical.
    for (const name of Object.keys(b.files)) expect(a.file(name)!.asText(), name).toBe(b.file(name)!.asText());
  });

  it("reads as a foreign document: level 3, no hidden data part, no content controls", () => {
    const zip = new PizZip(exampleTrdDocx());
    expect(Object.keys(zip.files).some((n) => /customXml|\.json$/i.test(n))).toBe(false);
    expect(zip.file("word/document.xml")!.asText()).not.toContain("<w:sdt");
    const r = read();
    expect(r.dataKind).toBeUndefined();
    expect(sessionFromOther(r, content.catalog, trdImportSynonyms).level).toBe(3);
  });

  it("is fictional and carries no private terms", () => {
    const xml = new PizZip(exampleTrdDocx()).file("word/document.xml")!.asText();
    expect(xml).toContain("(fictional)");
    expect(xml).not.toMatch(/myers|@gmail|CTP\d{4}|QC\d{4}/i);
  });
});

describe("the fixed rules on the example file", () => {
  const s = rules();
  it("find a handful of fields (5 to 12), all 'matched', none exact", () => {
    const found = s.fields.filter((f) => f.value !== "");
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found.length).toBeLessThanOrEqual(12);
    expect(found.every((f) => f.confidence === "matched")).toBe(true);
    expect(s.fields.filter(isExact)).toHaveLength(0);
  });
});

describe("the recorded AI reading", () => {
  const found = new Set(
    rules()
      .fields.filter((f) => f.value !== "")
      .map((f) => f.id),
  );
  const ids = new Set(rules().fields.map((f) => f.id));
  const text = allText();

  it("has 20 to 30 suggestions as a person sees them (a parameter once) and at least one a careful reviewer should reject", () => {
    const cards = aiCardsOf(withAi().session.fields);
    expect(cards.length).toBeGreaterThanOrEqual(20);
    expect(cards.length).toBeLessThanOrEqual(30);
    expect(exampleTrdReading.suggestions.filter((x) => x.reject).length).toBeGreaterThanOrEqual(1);
    expect(exampleTrdReading.suggestions.filter((x) => x.reject).every((x) => /unsure/i.test(x.why))).toBe(true);
  });

  it("every field id exists in the catalogue and no field is suggested twice", () => {
    for (const s of exampleTrdReading.suggestions) expect(ids.has(s.field), s.field).toBe(true);
    expect(new Set(exampleTrdReading.suggestions.map((s) => s.field)).size).toBe(exampleTrdReading.suggestions.length);
  });

  it("never overlaps with a field the fixed rules found", () => {
    for (const s of exampleTrdReading.suggestions) expect(found.has(s.field), s.field).toBe(false);
  });

  it("every quote appears word for word in the text read from the shipped file", () => {
    const shipped = readTrdUpload(new Uint8Array(readFileSync(SHIPPED)), EXAMPLE_TRD_FILE_NAME);
    const shippedText = shipped.blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat().map((c) => c.text) : [b.text]));
    for (const s of exampleTrdReading.suggestions) {
      expect(shippedText.some((t) => t.includes(s.quote)), s.quote).toBe(true);
      expect(text.some((t) => t.includes(s.quote))).toBe(true);
    }
  });

  it("never invents a value: every value (and the unit as written) is in its quote", () => {
    for (const s of exampleTrdReading.suggestions) expect(s.quote.includes(s.value), `${s.field}: ${s.value}`).toBe(true);
  });

  it("values are in the field's own format: a plain number for a limit part, text for a unit, no unit inside a number", () => {
    for (const s of exampleTrdReading.suggestions) {
      if (/\.(set|nor_low|nor_high|par_low|par_high)$/.test(s.field)) expect(s.value, s.field).toMatch(/^-?\d+(\.\d+)?$/);
      if (s.field.endsWith(".unit")) expect(s.value, s.field).toMatch(/^[^\d\s]+$/);
    }
  });

  it("the overlay adds every suggestion, as 'AI suggestion', with quote, place and reason, and skips none", () => {
    const r = withAi();
    expect(r.skipped).toEqual([]);
    expect(r.added).toBe(exampleTrdReading.suggestions.length);
    expect(r.session.aiExample).toBe(true);
    for (const sg of exampleTrdReading.suggestions) {
      const f = r.session.fields.find((x) => x.id === sg.field)!;
      expect(f).toMatchObject({ value: sg.value, confidence: "ai_suggested", source: `${AI_EVIDENCE_PREFIX}${sg.quote}` });
      expect(f.ai).toEqual({ quote: sg.quote, where: sg.where, why: sg.why });
      expect(r.session.fieldCells[f.id]?.length).toBeGreaterThan(0);
    }
    // The rules' own fields are untouched, and the base session was not changed.
    for (const id of found) expect(r.session.fields.find((x) => x.id === id)!.confidence).toBe("matched");
    expect(rules().fields.some((f) => f.confidence === "ai_suggested")).toBe(false);
  });

  it("AI suggestions are never 'exact' and never taken by the bulk rules", () => {
    const r = withAi();
    expect(r.session.fields.filter(isExact)).toHaveLength(0);
    expect(r.session.fields.filter((f) => f.confidence === "ai_suggested").every((f) => !isExact(f))).toBe(true);
  });

  it("the count line comes from the session: rules found N, AI suggests M more", () => {
    const r = withAi();
    const c = aiCounts(r.session);
    const cards = aiCardsOf(r.session.fields);
    // Both numbers count what a person sees: a parameter once, not once per part.
    const key = (id: string) => /^(trd.step.[^.]+.param.[^.]+).[a-z_]+$/.exec(id)?.[1] ?? id;
    expect(c).toEqual({ rules: new Set([...found].map(key)).size, ai: cards.length });
    expect(aiCountText(c)).toBe(`Rules found ${c.rules}. AI suggests ${cards.length} more.`);
    expect(cards.length).toBeLessThan(exampleTrdReading.suggestions.length);
  });

  it("one card per parameter: its parts are grouped, the value reads like the parameter, the shared quote shows once", () => {
    const cards = aiCardsOf(withAi().session.fields);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
    const hold = cards.find((c) => c.key === "trd.step.compounding.param.max_hold_time")!;
    expect(hold.fields.map((f) => f.id)).toEqual([P("compounding", "max_hold_time", "par_high"), P("compounding", "max_hold_time", "unit")]);
    expect(hold.title).toBe("Formulated bulk hold time");
    expect(hold.valueText).toBe("PAR up to 24 h");
    expect(hold.quotes).toHaveLength(1);
    expect(cards.find((c) => c.key === "trd.step.compounding.param.temperature")!.valueText).toBe("Set point 20 °C");
    const modality = cards.find((c) => c.key === "trd.detail.modality")!;
    expect(modality.fields).toHaveLength(1);
    expect(modality.valueText).toBe("humanized monoclonal antibody");
  });

  it("a suggestion whose quote is not in the file, or whose field the rules filled, is skipped (never shown without its source)", () => {
    const base = rules();
    const bad = {
      ...exampleTrdReading,
      suggestions: [
        { field: "trd.detail.modality", value: "x", quote: "A sentence that is not in the file.", where: "nowhere", why: "test" },
        { field: "trd.docRef", value: "ORV-TRD-0118", quote: "ORV-TRD-0118", where: "Table 1", why: "test" },
        { field: "trd.nothing", value: "x", quote: "ORV-TRD-0118", where: "Table 1", why: "test" },
      ],
    };
    const r = overlayAiReading(base, bad);
    expect(r.added).toBe(0);
    expect(r.skipped.map((s) => s.reason)).toEqual(["the quote is not in the file", "the fixed rules already found a value", "the field is not in the catalogue"]);
  });
});

describe("accepting AI suggestions makes a TRD with the AI evidence", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const sg = (field: string) => exampleTrdReading.suggestions.find((x) => x.field === field)!;

  it("accepted AI values are written like accepted matched values, the log says where each came from, and rejected ones stay open", () => {
    const s = withAi().session;
    const take = [P("compounding", "max_hold_time", "par_high"), P("compounding", "max_hold_time", "unit"), "trd.detail.modality", "trd.title"];
    const rejected = P("sterile_filtration", "max_filtration_time", "par_high");
    const decisions: ImportDecisions = Object.fromEntries(take.map((id) => [id, { value: s.fields.find((f) => f.id === id)!.value }]));
    // Rules' own matched values are accepted too, as they would be on the screen.
    for (const f of s.fields.filter((x) => x.confidence === "matched")) decisions[f.id] = { value: f.value };
    const r = applyImport(project, s, decisions, { actor, target: { kind: "new", title: "ORV-118 example" } });
    const d = r.project.trd.documents.find((x) => x.id === r.trdId)!;
    // The accepted hold limit is in the TRD with the unit the passage states.
    const step = d.steps.find((x) => x.key === "compounding")!;
    const item = step.items.find((i) => i.key === "max_hold_time")!;
    expect(item.limits?.par).toMatchObject({ max: 24, unit: "h" });
    const modality = d.details.find((x) => x.key === "modality")!;
    expect(modality.override).toMatchObject({ status: "established", display: sg("trd.detail.modality").value });
    // The rejected value is not in the TRD: the field stays not established.
    expect(d.steps.find((x) => x.key === "sterile_filtration")?.items.find((i) => i.key === "max_filtration_time")?.limits?.par).toBeUndefined();
    // The change log keeps the evidence with the AI words and the quote.
    const ev = (r.project.changeLog.find((e) => e.action === "trd_import")!.after as { evidence: { field: string; value: string; source: string }[] }).evidence;
    const hold = ev.find((e) => e.field === P("compounding", "max_hold_time", "par_high"))!;
    expect(hold.value).toBe("24");
    expect(hold.source).toBe(`${AI_EVIDENCE_PREFIX}${sg(P("compounding", "max_hold_time", "par_high")).quote}`);
    expect(ev.find((e) => e.field === "trd.detail.modality")!.source.startsWith(AI_EVIDENCE_PREFIX)).toBe(true);
    expect(ev.some((e) => e.field === rejected)).toBe(false);
    // Rule-found values keep their own evidence (no AI words).
    expect(ev.find((e) => e.field === "trd.docRef")!.source).not.toContain("AI suggestion");
    const c = importCounts(s, decisions);
    expect(c.taken).toBe(Object.keys(decisions).length);
  });
});
