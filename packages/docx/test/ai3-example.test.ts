import {
  AI_EVIDENCE_PREFIX,
  aiGapRowFields,
  aiGapRowsOf,
  applyGapImport,
  checkGapValue,
  gapAiCounts,
  gapAiCountText,
  gapCounts,
  gapSessionFromOther,
  overlayGapAiReading,
  projectAnswerOf,
  visibleInstances,
  type GapDecisions,
  type GapImportSession,
} from "@gap/engine";
import { emptyProject } from "@gap/process-model";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, gapImportSynonyms as syn } from "../../../content/index";
import { exampleGapReading } from "../../../content/ai-reading/index";
import { readUpload } from "../src/index";
import { EXAMPLE_GAP_FILE_NAME, exampleGapDocx } from "../src/example-gap";
import { GENERATED_AT } from "./fixtures";

vi.setConfig({ testTimeout: 60000 });

// Job AI3: the example finished gap assessment (Word) and its PRE-RECORDED AI reading. No AI runs here: the items are a fixed list.
const SHIPPED = join(__dirname, "../../../apps/web/public/examples", EXAMPLE_GAP_FILE_NAME);

// "WRITE_EXAMPLE_GAP=1 npx vitest run packages/docx/test/ai3-example.test.ts" rewrites the shipped file from the generator.
if (process.env.WRITE_EXAMPLE_GAP === "1") writeFileSync(SHIPPED, exampleGapDocx());

const actor = { name: "Test reviewer", at: GENERATED_AT };
const read = () => readUpload(exampleGapDocx(), EXAMPLE_GAP_FILE_NAME);
const rules = () => gapSessionFromOther(read(), content, syn);
const withAi = () => overlayGapAiReading(rules(), exampleGapReading, { content, syn });
const textOf = (r: ReturnType<typeof read>): string[] => r.blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat().map((c) => c.text) : [b.text]));
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const newProject = () => emptyProject({ title: "ORV-118 example", actor, contentRefs: content.versions });
const q = (id: string) => content.questionById.get(id)!;

describe("the shipped example gap assessment (Word)", () => {
  it("is exactly what the generator makes, part by part (zip dates are local time, so never byte for byte)", () => {
    expect(existsSync(SHIPPED)).toBe(true);
    const a = new PizZip(readFileSync(SHIPPED));
    const b = new PizZip(exampleGapDocx());
    expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
    for (const name of Object.keys(b.files)) expect(a.file(name)!.asText(), name).toBe(b.file(name)!.asText());
  });

  it("reads as a foreign document: level 3, no hidden data part, no content controls", () => {
    const zip = new PizZip(exampleGapDocx());
    expect(Object.keys(zip.files).some((n) => /customXml|\.json$/i.test(n))).toBe(false);
    expect(zip.file("word/document.xml")!.asText()).not.toContain("<w:sdt");
    expect(read().dataKind).toBeUndefined();
    expect(rules().level).toBe(3);
  });

  it("is fictional and carries no private terms", () => {
    const xml = new PizZip(exampleGapDocx()).file("word/document.xml")!.asText();
    expect(xml).toContain("(fictional)");
    expect(xml).not.toMatch(/@gmail|CTP\d{4}|QC\d{4}/i);
  });
});

describe("the fixed rules on the example file", () => {
  it("find 4 to 8 gap items, all 'matched', none exact", () => {
    const s = rules();
    expect(s.rows.length).toBeGreaterThanOrEqual(4);
    expect(s.rows.length).toBeLessThanOrEqual(8);
    expect(s.fields.filter((f) => f.value !== "").every((f) => f.confidence === "matched")).toBe(true);
  });
});

describe("the recorded AI reading", () => {
  const ruleRows = rules().rows;

  it("has 15 to 35 items and at least one a careful reviewer should reject, with a why that says the AI was unsure", () => {
    expect(exampleGapReading.items.length).toBeGreaterThanOrEqual(15);
    expect(exampleGapReading.items.length).toBeLessThanOrEqual(35);
    const rej = exampleGapReading.items.filter((i) => i.reject);
    expect(rej.length).toBeGreaterThanOrEqual(1);
    expect(rej.every((i) => /unsure/i.test(i.why))).toBe(true);
  });

  it("the overlay adds every item and skips none", () => {
    const r = withAi();
    expect(r.skipped).toEqual([]);
    expect(r.added).toBe(exampleGapReading.items.length);
    expect(r.session.aiExample).toBe(true);
    expect(aiGapRowsOf(r.session)).toHaveLength(exampleGapReading.items.length);
    expect(rules().fields.some((f) => f.confidence === "ai_suggested")).toBe(false);
  });

  it("every quote appears word for word in the text read from the SHIPPED file", () => {
    const shipped = textOf(readUpload(new Uint8Array(readFileSync(SHIPPED)), EXAMPLE_GAP_FILE_NAME)).map(squash);
    for (const i of exampleGapReading.items) for (const quote of i.quotes) expect(shipped.some((t) => t.includes(squash(quote))), quote).toBe(true);
  });

  it("never invents: numbers and units are in a quote, a choice shares its words with the quote, a text answer is in the quote", () => {
    for (const i of exampleGapReading.items) {
      if (i.reject) continue; // a reject is an inferred rating: exactly what the reviewer must catch
      const quote = squash(i.quotes.join(" "));
      const qq = q(i.question);
      for (const side of ["source", "target", "shared"] as const) {
        const v = i[side];
        if (v === undefined) continue;
        if (qq.input.type === "yes_no") continue;
        if (qq.input.type === "quantity" || qq.input.type === "parameter") {
          expect(quote.includes(squash(v)), `${i.question} ${side}: ${v}`).toBe(true);
        } else if (qq.input.type === "text") {
          expect(quote.includes(squash(v)), `${i.question} ${side}: ${v}`).toBe(true);
        } else {
          // A choice: at least half of the words of 4 letters or more match a word of the quote (compared by their first 5 letters).
          const words = squash(v).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
          const hit = words.filter((w) => quote.includes(w.slice(0, 5)));
          expect(hit.length * 2 >= words.length, `${i.question} ${side}: ${v}`).toBe(true);
        }
      }
    }
  });

  it("values are valid for the session: each reads exactly like a typed answer, and only the sides the question has are filled", () => {
    const s = withAi().session;
    for (const row of aiGapRowsOf(s)) {
      const fields = aiGapRowFields(s, row);
      expect(fields.map((f) => f.side)).toEqual(row.sides);
      for (const f of fields) {
        expect(f.unreadable, `${row.label} ${f.side}`).toBeUndefined();
        if (f.value !== "") {
          expect(f.confidence).toBe("ai_suggested");
          expect(checkGapValue(content, q(row.questionId), f.side, f.value, syn)).toBeUndefined();
        } else expect(f.confidence).toBe("not_found");
      }
    }
  });

  it("no item overlaps what the rules found (not the same question, not the same passage)", () => {
    const base = rules();
    const ruleQuestions = new Set(ruleRows.map((r) => r.questionId));
    const s = withAi().session;
    for (const row of aiGapRowsOf(s)) {
      expect(ruleQuestions.has(row.questionId), row.label).toBe(false);
      for (const f of aiGapRowFields(s, row)) for (const cell of s.fieldCells[f.id] ?? []) expect(base.cellFields[cell] ?? [], `${row.label} ${cell}`).toEqual([]);
    }
  });

  it("each AI field carries its quote, place and reason, and a passage to show in the document", () => {
    const s = withAi().session;
    for (const row of aiGapRowsOf(s)) {
      for (const f of aiGapRowFields(s, row).filter((x) => x.value !== "")) {
        expect(f.source.startsWith(AI_EVIDENCE_PREFIX)).toBe(true);
        expect(f.ai!.quote.length).toBeGreaterThan(0);
        expect(s.fieldCells[f.id]?.length).toBeGreaterThan(0);
      }
      expect(row.ai!.why.length).toBeGreaterThan(0);
    }
  });

  it("the tool decides nothing: no filing category and no rating appears in the recording", () => {
    const all = JSON.stringify(exampleGapReading);
    expect(all).not.toMatch(/major change|minor change|prior approval|variation type|type (ia|ib|ii)\b|risk rating|high risk|low risk/i);
  });

  it("the count line comes from the session: rules found N, AI suggests M more, both counting gap items", () => {
    const r = withAi();
    const c = gapAiCounts(r.session);
    expect(c).toEqual({ rules: ruleRows.length, ai: exampleGapReading.items.length });
    expect(gapAiCountText(c)).toBe(`Rules found ${c.rules}. AI suggests ${c.ai} more.`);
  });

  it("an item whose quote is not in the file, whose question is unknown, whose side is wrong or that the rules already read is skipped", () => {
    const base = rules();
    const ruled = base.rows[0]!.questionId;
    const bad = {
      ...exampleGapReading,
      items: [
        { question: "rt.thaw_principle", source: "Circulating water bath", quotes: ["A sentence that is not in the file."], where: "nowhere", why: "test" },
        { question: "no.such_question", source: "x", quotes: ["After thawing, the drug substance may stay at ambient temperature for no more than 4 h at both sites."], where: "x", why: "test" },
        { question: ruled, source: "x", quotes: ["After thawing, the drug substance may stay at ambient temperature for no more than 4 h at both sites."], where: "x", why: "test" },
        { question: "rt.cold_hold", source: "72 h", quotes: ["At Northfield the thawed drug substance may be held at 2-8 °C for up to 72 h before pooling."], where: "x", why: "test" },
        { question: "rt.ambient_time", source: "4 h", quotes: ["Polyethersulfone (PES)"], where: "x", why: "test" },
        { question: "rt.ambient_time", source: "a long time", quotes: ["After thawing, the drug substance may stay at ambient temperature for no more than 4 h at both sites."], where: "x", why: "test" },
      ],
    };
    const r = overlayGapAiReading(base, bad, { content, syn });
    expect(r.added).toBe(0);
    expect(r.skipped.map((s) => s.reason).slice(0, 5)).toEqual([
      "a quote is not in the file",
      "the question is not in the catalogue",
      "the fixed rules already read this question",
      "the question is not asked of Sending unit (SU)",
      "the fixed rules already read that passage",
    ]);
  });
});

describe("accepting AI items makes answers with the AI evidence", () => {
  const takeRow = (s: GapImportSession, questionId: string, d: GapDecisions) => {
    for (const f of s.fields.filter((x) => x.row === questionId && x.value !== "")) d[f.id] = { value: f.value };
  };

  it("accepted items are written like accepted rule rows; the log says where each came from; a rejected item adds nothing", () => {
    const s = withAi().session;
    const d: GapDecisions = {};
    // The rules' own matched values are accepted as they would be on the screen.
    for (const f of s.fields.filter((x) => x.confidence === "matched" && x.value && !x.unreadable)) d[f.id] = { value: f.value };
    const rejects = new Set(exampleGapReading.items.filter((i) => i.reject).map((i) => i.question));
    for (const row of aiGapRowsOf(s)) if (!rejects.has(row.questionId)) takeRow(s, row.questionId, d);
    const r = applyGapImport(newProject(), s, d, { actor, content, syn });
    // Every accepted answer was put in; the only warnings allowed are questions this project does not ask (none expected here).
    expect(r.warnings).toEqual([]);
    const ev = (r.project.changeLog.find((e) => e.action === "gap_import")!.after as { evidence: { field: string; source: string }[] }).evidence;
    const mine = ev.filter((e) => e.source.startsWith(AI_EVIDENCE_PREFIX));
    expect(mine.length).toBeGreaterThanOrEqual(15);
    expect(mine.some((e) => e.source === `${AI_EVIDENCE_PREFIX}At Northfield the bioburden limit before the BBR filter is 10 CFU/100 mL.`)).toBe(true);
    expect(ev.some((e) => !e.source.startsWith(AI_EVIDENCE_PREFIX))).toBe(true); // the rule rows keep their own evidence
    expect(ev.filter((e) => !e.source.startsWith(AI_EVIDENCE_PREFIX)).every((e) => !e.source.includes("AI suggestion"))).toBe(true);
    expect(gapCounts(s, d).taken).toBe(Object.keys(d).length);
    // A rejected item (the shipper rating the text does not state, the item already closed) is not an answer of the project.
    const asked = new Map(visibleInstances(content, r.project, "paired").map((i) => [i.key, i]));
    for (const id of rejects) for (const side of ["source", "target"] as const) {
      const inst = asked.get(`${id}@${side}`);
      if (inst) expect(projectAnswerOf(content, r.project, inst)).toBeUndefined();
    }
  });
});
