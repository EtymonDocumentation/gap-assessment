import {
  AI_EVIDENCE_PREFIX,
  aiRowFields,
  aiRowsOf,
  applySamplingImport,
  buildDemoProject,
  overlaySamplingAiReading,
  samplingAiCounts,
  samplingAiCountText,
  samplingCounts,
  samplingSessionFromOther,
  type SamplingDecisions,
  type SamplingImportSession,
} from "@gap/engine";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingImportSynonyms, samplingSuggestions } from "../../../content/index";
import { exampleSamplingReading } from "../../../content/ai-reading/index";
import { readUpload } from "../src/index";
import { EXAMPLE_SAMPLING_FILE_NAME, exampleSamplingDocx } from "../src/example-sampling-plan";
import { GENERATED_AT } from "./fixtures";

vi.setConfig({ testTimeout: 60000 });

// Job AI2: the example finished sampling plan (Word) and its PRE-RECORDED AI reading. No AI runs here: the points are a fixed list.
const SHIPPED = join(__dirname, "../../../apps/web/public/examples", EXAMPLE_SAMPLING_FILE_NAME);

// "WRITE_EXAMPLE_SAMPLING=1 npx vitest run packages/docx/test/ai2-example.test.ts" rewrites the shipped file from the generator.
if (process.env.WRITE_EXAMPLE_SAMPLING === "1") writeFileSync(SHIPPED, exampleSamplingDocx());

const actor = { name: "Test reviewer", at: GENERATED_AT };
const syn = samplingImportSynonyms;
const stepLabels = [...content.catalog.unitOperations.map((u) => u.label), "Finished product"];
const ctx = { syn, steps: content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), tests: samplingSuggestions.candidates };
const read = () => readUpload(exampleSamplingDocx(), EXAMPLE_SAMPLING_FILE_NAME);
const rules = () => samplingSessionFromOther(read(), ctx);
const withAi = () => overlaySamplingAiReading(rules(), exampleSamplingReading, { syn, stepLabels });
const textOf = (r: ReturnType<typeof read>): string[] => r.blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat().map((c) => c.text) : [b.text]));
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

describe("the shipped example sampling plan (Word)", () => {
  it("is exactly what the generator makes, part by part (zip dates are local time, so never byte for byte)", () => {
    expect(existsSync(SHIPPED)).toBe(true);
    const a = new PizZip(readFileSync(SHIPPED));
    const b = new PizZip(exampleSamplingDocx());
    expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
    for (const name of Object.keys(b.files)) expect(a.file(name)!.asText(), name).toBe(b.file(name)!.asText());
  });

  it("reads as a foreign document: level 3, no hidden data part, no content controls", () => {
    const zip = new PizZip(exampleSamplingDocx());
    expect(Object.keys(zip.files).some((n) => /customXml|\.json$/i.test(n))).toBe(false);
    expect(zip.file("word/document.xml")!.asText()).not.toContain("<w:sdt");
    expect(read().dataKind).toBeUndefined();
    expect(rules().level).toBe(3);
  });

  it("is fictional and carries no private terms", () => {
    const xml = new PizZip(exampleSamplingDocx()).file("word/document.xml")!.asText();
    expect(xml).toContain("(fictional)");
    expect(xml).not.toMatch(/@gmail|CTP\d{4}|QC\d{4}/i);
  });

  it("says the PPQ habits of the project: every lot, every hold at T0 and at the end, nothing after the sterile filter", () => {
    const all = textOf(read()).join(" ");
    expect(all).toContain("each of the three PPQ lots");
    expect(all).toContain("Every hold is sampled at T0 and at the end of the hold");
    expect(all).toContain("No sample is taken after the sterile filter");
  });
});

describe("the fixed rules on the example file", () => {
  it("find 4 to 8 points, all 'matched', none exact", () => {
    const s = rules();
    expect(s.rows.length).toBeGreaterThanOrEqual(4);
    expect(s.rows.length).toBeLessThanOrEqual(8);
    expect(s.fields.filter((f) => f.value !== "" && f.id !== "sampling.title").every((f) => f.confidence === "matched")).toBe(true);
    // The two-column table is not recognised: the rules say so.
    expect(s.notUsed.some((n) => /Table 3|Table 2/.test(n) && /was not used/.test(n))).toBe(true);
  });
});

describe("the recorded AI reading", () => {
  const ruleRows = rules().rows;

  it("has 15 to 25 points and at least one a careful reviewer should reject, with a why that says the AI was unsure", () => {
    expect(exampleSamplingReading.points.length).toBeGreaterThanOrEqual(15);
    expect(exampleSamplingReading.points.length).toBeLessThanOrEqual(25);
    const rej = exampleSamplingReading.points.filter((p) => p.reject);
    expect(rej.length).toBeGreaterThanOrEqual(1);
    expect(rej.every((p) => /unsure/i.test(p.why))).toBe(true);
  });

  it("the overlay adds every point and skips none", () => {
    const r = withAi();
    expect(r.skipped).toEqual([]);
    expect(r.added).toBe(exampleSamplingReading.points.length);
    expect(r.session.aiExample).toBe(true);
    expect(aiRowsOf(r.session)).toHaveLength(exampleSamplingReading.points.length);
    expect(rules().fields.some((f) => f.confidence === "ai_suggested")).toBe(false);
  });

  it("every quote appears word for word in the text read from the SHIPPED file", () => {
    const shipped = textOf(readUpload(new Uint8Array(readFileSync(SHIPPED)), EXAMPLE_SAMPLING_FILE_NAME)).map(squash);
    for (const p of exampleSamplingReading.points) for (const q of p.quotes) expect(shipped.some((t) => t.includes(squash(q))), q).toBe(true);
  });

  it("never invents or converts: attribute, test, amount and timing are the words of a quote, unit as written", () => {
    for (const p of exampleSamplingReading.points) {
      const quotes = p.quotes.map(squash);
      for (const v of [p.attribute, p.test, p.amount, p.timing]) if (v) expect(quotes.some((q) => q.includes(squash(v))), `${p.step}: ${v}`).toBe(true);
    }
  });

  it("columns and values are valid for the session: step in the catalogue, amount reads, type resolves, timing is kept as written", () => {
    const s = withAi().session;
    for (const row of aiRowsOf(s)) {
      const f = aiRowFields(s, row);
      expect(f.map((x) => x.column)).toEqual(["step", "attribute", "test", "amount", "timing", "type"]);
      expect(stepLabels).toContain(f[0]!.value);
      for (const x of f) expect(x.unreadable, `${row.label} ${x.column}`).toBeUndefined();
      expect(f.filter((x) => x.value !== "").every((x) => x.confidence === "ai_suggested")).toBe(true);
      if (f[3]!.value) expect(f[3]!.value).toMatch(/^\d+(\.\d+)? [A-Za-z]+( [A-Za-z]+)?$/);
      expect(f[5]!.value).not.toBe("");
    }
  });

  it("no point overlaps a point the rules found (not the same passage, not the same step and attribute)", () => {
    const base = rules();
    const keys = new Set(ruleRows.map((r) => `${squash(base.fields.find((f) => f.row === r.n && f.column === "step")!.value)}|${squash(base.fields.find((f) => f.row === r.n && f.column === "attribute")!.value)}`));
    const s = withAi().session;
    for (const row of aiRowsOf(s)) {
      const f = aiRowFields(s, row);
      expect(keys.has(`${squash(f[0]!.value)}|${squash(f[1]!.value)}`)).toBe(false);
      for (const x of f) for (const cell of s.fieldCells[x.id] ?? []) expect(base.cellFields[cell] ?? [], `${row.label} ${cell}`).toEqual([]);
    }
  });

  it("each AI field carries its quote, place and reason, and a passage to show in the document", () => {
    const s = withAi().session;
    for (const row of aiRowsOf(s)) {
      for (const f of aiRowFields(s, row).filter((x) => x.value !== "")) {
        expect(f.source.startsWith(AI_EVIDENCE_PREFIX)).toBe(true);
        expect(f.ai!.quote.length).toBeGreaterThan(0);
        expect(s.fieldCells[f.id]?.length).toBeGreaterThan(0);
      }
      expect(row.ai!.why.length).toBeGreaterThan(0);
    }
  });

  it("the count line comes from the session: rules found N, AI suggests M more, both counting points", () => {
    const r = withAi();
    const c = samplingAiCounts(r.session);
    expect(c).toEqual({ rules: ruleRows.length, ai: exampleSamplingReading.points.length });
    expect(samplingAiCountText(c)).toBe(`Rules found ${c.rules}. AI suggests ${c.ai} more.`);
  });

  it("a point whose quote is not in the file, whose step is unknown, or that the rules already found is skipped", () => {
    const base = rules();
    const first = base.fields.find((f) => f.row === 1 && f.column === "attribute")!.value;
    const bad = {
      ...exampleSamplingReading,
      points: [
        { step: "Sterile filtration", attribute: "x", quotes: ["A sentence that is not in the file."], where: "nowhere", why: "test" },
        { step: "No such step", attribute: "pH", quotes: ["In each lot, 2 mL is taken for pH by potentiometry at T0 and at the end of the hold."], where: "x", why: "test" },
        { step: "Pooling, compounding and dilution", attribute: first, quotes: ["Potentiometry"], where: "Table 1", why: "test" },
        { step: "Sterile filtration", attribute: "bioburden", amount: "10 mL", quotes: ["A bioburden sample of 100 mL is drawn from the formulated bulk before the filter, at the end of the hold."], where: "x", why: "test" },
        { step: "Sterile filtration", attribute: "bioburden", amount: "100 mL", type: "Not a type", quotes: ["A bioburden sample of 100 mL is drawn from the formulated bulk before the filter, at the end of the hold."], where: "x", why: "test" },
      ],
    };
    const r = overlaySamplingAiReading(base, bad, { syn, stepLabels });
    expect(r.added).toBe(0);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "a quote is not in the file",
      "the step is not a step of the catalogue",
      "the fixed rules already read that passage",
      "the amount is not in the quote",
      "the type is not a study type of the tool",
    ]);
  });
});

describe("the PPQ habits hold for the plan with every AI point accepted (the two to reject left out)", () => {
  const s = withAi().session;
  const rejectAt = new Set(exampleSamplingReading.points.map((p, i) => (p.reject ? i : -1)).filter((i) => i >= 0));
  const accepted = aiRowsOf(s).filter((_r, i) => !rejectAt.has(i));

  it("nothing is sampled after the sterile filter: no point on the filtrate", () => {
    for (const row of accepted) {
      const f = aiRowFields(s, row);
      expect(row.ai!.quotes.join(" ")).not.toMatch(/filtrate|sterile bag/i);
      // Sterile filtration points are before the filter or about the filter itself.
      if (f[0]!.value === "Sterile filtration") expect(row.ai!.quotes.join(" ")).toMatch(/before the filter|Filter integrity/);
    }
    // The product is tested on filled vials.
    expect(accepted.some((r) => aiRowFields(s, r)[1]!.value === "Sterility" && /filled vials/.test(aiRowFields(s, r)[3]!.value))).toBe(true);
  });

  it("every hold point is sampled at T0 and at the end of the hold, or at the end of the hold with T0 taken by the table", () => {
    const holds = accepted.filter((r) => aiRowFields(s, r)[5]!.value === "Hold time");
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const r of holds) expect(aiRowFields(s, r)[4]!.value).toMatch(/T0 and at the end of the hold/);
    // The bulk hold's bioburden: the end of the hold here, T0 in Table 1 (read by the rules).
    const bulkBio = accepted.find((r) => aiRowFields(s, r)[3]!.value === "100 mL")!;
    expect(aiRowFields(s, bulkBio)[4]!.value).toBe("at the end of the hold");
    expect(s.fields.some((f) => f.confidence === "matched" && f.column === "timing" && f.value === "At T0")).toBe(true);
  });

  it("the two rejects are the filtrate sample and the engineering-run-only sample", () => {
    const rej = exampleSamplingReading.points.filter((p) => p.reject);
    expect(rej).toHaveLength(2);
    expect(rej[0]!.quotes[0]).toMatch(/filtrate/);
    expect(rej[1]!.quotes[0]).toMatch(/engineering run only/);
  });
});

describe("accepting AI points makes a sampling plan with the AI evidence", () => {
  const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
  const target = { kind: "new", title: "ORV-118 example" } as const;
  const idx = (needle: string) => exampleSamplingReading.points.findIndex((p) => p.quotes[0]!.includes(needle));
  const rowOf = (s: SamplingImportSession, i: number) => aiRowsOf(s)[i]!;
  const takeRow = (s: SamplingImportSession, row: { n: number }, d: SamplingDecisions) => {
    for (const f of s.fields.filter((x) => x.row === row.n && x.value !== "")) d[f.id] = { value: f.value };
  };

  it("accepted points are written like accepted rule rows; the log says where each came from; a rejected point is not added", () => {
    const s = withAi().session;
    const d: SamplingDecisions = {};
    // The rules' own matched values are accepted as they would be on the screen.
    for (const f of s.fields.filter((x) => x.confidence === "matched" && x.value && !x.unreadable && x.id !== "sampling.title")) d[f.id] = { value: f.value };
    const hold = rowOf(s, idx("In each lot, 2 mL is taken for pH"));
    const bulk = rowOf(s, idx("A bioburden sample of 100 mL"));
    const rejected = rowOf(s, idx("If the receiving site wants an extra check"));
    takeRow(s, hold, d);
    takeRow(s, bulk, d);
    const r = applySamplingImport(project, s, d, { actor, target, content, syn });
    const plan = r.project.sampling.plans.find((p) => p.id === r.planId)!;
    const find = (attr: string, amount: string) => plan.points.find((p) => p.attribute.toLowerCase() === attr.toLowerCase() && p.quantity && `${p.quantity.value} ${p.quantity.unit}` === amount);
    expect(find("pH", "2 mL")).toBeTruthy();
    expect(find("pH", "2 mL")!.type).toBe("hold_time");
    // The attribute is kept exactly as accepted: "pH", never "PH".
    expect(find("pH", "2 mL")!.attribute).toBe("pH");
    expect(find("bioburden", "100 mL")).toBeTruthy();
    expect(find("bioburden", "100 mL")!.type).toBe("ipc");
    // The rejected point (never accepted) is not in the plan.
    expect(plan.points.some((p) => p.quantity?.value === 20 && p.quantity.unit === "mL")).toBe(false);
    expect(aiRowFields(s, rejected).every((f) => d[f.id] === undefined)).toBe(true);
    // The change log keeps the evidence with the AI words and the quote.
    const ev = (r.project.changeLog.find((e) => e.action === "sampling_import")!.after as { evidence: { field: string; source: string }[] }).evidence;
    const mine = ev.filter((e) => e.source.startsWith(AI_EVIDENCE_PREFIX));
    expect(mine.length).toBeGreaterThanOrEqual(8);
    expect(mine.some((e) => e.source === `${AI_EVIDENCE_PREFIX}A bioburden sample of 100 mL is drawn from the formulated bulk before the filter, at the end of the hold.`)).toBe(true);
    expect(ev.some((e) => !e.source.startsWith(AI_EVIDENCE_PREFIX))).toBe(true); // the rule rows keep their own evidence
    expect(ev.filter((e) => !e.source.startsWith(AI_EVIDENCE_PREFIX)).every((e) => !e.source.includes("AI suggestion"))).toBe(true);
    expect(samplingCounts(s, d).taken).toBe(Object.keys(d).length);
  });

  it("every AI point can be made into a plan point (all accepted, the two rejects included, none refused by the plan)", () => {
    const s = withAi().session;
    const d: SamplingDecisions = {};
    for (const row of aiRowsOf(s)) takeRow(s, row, d);
    const r = applySamplingImport(project, s, d, { actor, target, content, syn });
    expect(r.warnings).toEqual([]);
    expect(r.added).toBe(exampleSamplingReading.points.length);
  });
});
