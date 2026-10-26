import { buildDemoProject, buildTrdDocument } from "@gap/engine";
import { listText, plainOfSegments, segmentsOf, type ResolvedBlank } from "../../packages/engine/src/trd-writeup";
import { blanksOf } from "../../packages/process-model/src/trd-writeups";
import { renderHtml } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

/**
 * Answer labels read as English in the prose of a TRD: lists, articles, Yes/No answers, units, blank sign-off cells. The sentences are
 * checked in isolation (the helpers) and in the SYR-305 sample (the shipped wording and demo data together).
 */
const filled = (value: string, extra: Partial<ResolvedBlank> = {}): ResolvedBlank => ({ key: "k", label: "L", filled: true, value, ...extra } as ResolvedBlank);
const text = (src: string, r: ResolvedBlank) => plainOfSegments(segmentsOf(src, () => r));

describe("choice lists and blank modifiers", () => {
  it("joins choices as an English list", () => {
    expect(listText(["a"])).toBe("a");
    expect(listText(["a", "b"])).toBe("a and b");
    expect(listText(["a", "b", "c"])).toBe("a, b and c");
    // A choice that holds a comma would be read as two, so semicolons separate the items.
    expect(listText(["a, x", "b", "c"])).toBe("a, x; b; and c");
  });

  it("lowers the extra choices of a list but keeps acronyms and units", () => {
    const r = filled("Visual check; Weight check; pH test; USP chapter", { choice: true, items: ["Visual check", "Weight check", "pH test", "USP chapter"] });
    expect(text("checked by {{x|L}}.", r)).toBe("checked by visual check, weight check, pH test and USP chapter.");
    expect(text("{{x|L}} are checked.", r)).toBe("Visual check, weight check, pH test and USP chapter are checked.");
  });

  it("puts an article in front of a value only when the label asks for it", () => {
    expect(text("in {{x|Vessel ~a}}.", filled("Single-use bag", { choice: true }))).toBe("in a single-use bag.");
    expect(text("in {{x|Vessel ~a}}.", filled("Automated line", { choice: true }))).toBe("in an automated line.");
    expect(text("by {{x|Vessel ~a}}.", filled("Unit-dose set", { choice: true }))).toBe("by a unit-dose set.");
    expect(text("is {{x|Mixing ~a}}.", filled("No mixing after thaw", { choice: true }))).toBe("is no mixing after thaw.");
    expect(text("in {{x|Vessel}}.", filled("Single-use bag", { choice: true }))).toBe("in single-use bag.");
  });

  it("replaces a Yes or No answer with the author's wording for it", () => {
    const src = "{{x|Redundant filter used ~A second filter is used. ~No second filter is used.}}";
    expect(text(src, filled("Yes"))).toBe("A second filter is used.");
    expect(text(src, filled("No"))).toBe("No second filter is used.");
    // An unanswered blank stays visible under its plain label, without the modifiers.
    expect(blanksOf(src)[0]!.label).toBe("Redundant filter used");
  });

  it("uses an before a vowel sound and a digit that is read with one", () => {
    expect(text("in {{x|Size ~a}}.", filled("1 mL long syringe", { choice: true }))).toBe("in a 1 mL long syringe.");
    expect(text("in {{x|Size ~a}}.", filled("8 mL vial", { choice: true }))).toBe("in an 8 mL vial.");
    expect(text("in {{x|Size ~a}}.", filled("11 mL vial", { choice: true }))).toBe("in an 11 mL vial.");
  });

  it("words a qualification status as a clause and an excursion approach with by", () => {
    expect(text("The shipper is {{x|Status ~qualified}}.", filled("Qualified (performance qualification complete)", { choice: true }))).toBe(
      "The shipper is qualified (performance qualification complete).");
    expect(text("The shipper is {{x|Status ~qualified}}.", filled("Qualification planned", { choice: true }))).toBe("The shipper is not yet qualified (qualification planned).");
    expect(text("handled {{x|Approach ~by}}.", filled("Documented assessment", { choice: true }))).toMatch(/^handled by a documented assessment/);
  });

  it("writes one business day in the singular", () => {
    expect(text("within {{x|Days}} business days of receipt", filled("1"))).toBe("within 1 business day of receipt");
    expect(text("within {{x|Days}} business days of receipt", filled("2"))).toBe("within 2 business days of receipt");
  });
});

describe("the SYR-305 standard TRD reads as prose", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const d = project.trd.documents[0]!;
  const standard = buildTrdDocument(project, d, { generatedAt: "2026-10-25T09:00:00.000Z", appVersion: "0.0.0-test", content });
  const html = renderHtml(standard);
  const plain = html.replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  it("has no label leftovers, bracket placeholders or unit-less values", () => {
    for (const gone of ["(s)", ": Yes", "Available and applicable", "[placeholder]", "[date]", "crimp", "Labeling", "single sterile filter"]) expect(plain, gone).not.toContain(gone);
    expect(plain).toContain("Product density: 1.03 g/mL");
    expect(plain).toContain("tolerance of ±0.5 mm");
    expect(plain).toContain("The batch size for this bulk drug product program is 50 L.");
    // The impeller point of the 100 L single-use mixing bag is stated next to the batch size.
    expect(plain).toContain("The impeller of the bag is covered from a volume of 9 L");
  });

  it("states maximum-only limits as up to, never as max in the set point cell", () => {
    expect(html).not.toMatch(/<td>max \d/);
    expect(html).toMatch(/Formulated bulk hold time<\/td><td>24<\/td><td>up to 24<\/td><td>up to 30<\/td><td>h<\/td>/);
    expect(html).toMatch(/Filtration duration<\/td><td>4<\/td><td>up to 4<\/td><td>up to 6<\/td><td>h<\/td>/);
  });

  it("leaves the sign-off cells empty and lists each cited document once", () => {
    const row = /Author \(MSAT, receiving unit\)<\/td><td>Alex Example \(fictional\)<\/td><td><\/td><td><\/td>/;
    expect(html).toMatch(row);
    expect((plain.match(/DEMO-SHIP-305-01:/g) ?? []).length).toBe(1);
    expect(plain).not.toMatch(/DEMO-(SHS|FVS|VIS|EXP)-305-01/);
  });

  it("prints the parameter tables inside the overall process parameters section and has no separate section for them", () => {
    const ids = standard.sections.map((s) => s.id);
    expect(ids).toContain("writeup-process_parameters");
    expect(ids).not.toContain("process-parameters");
    const sec = standard.sections.find((s) => s.id === "writeup-process_parameters")!;
    const tables = sec.blocks.filter((b) => b.type === "table");
    expect(tables.length).toBeGreaterThan(5);
    expect(JSON.stringify(tables[0])).toContain("Set point");
    // The Overrides appendix appears only when something from the project was overridden.
    expect(ids).not.toContain("overrides");
    // Section 1 no longer repeats the product table, and the project line stays.
    expect(plain).not.toContain("Product and receiving site");
    expect(plain).toContain("Technical requirements document");
    expect(plain).not.toContain("Technical Requirements Document");
  });

  it("reads Interventions with a unit and the filling duration as up to 6 h with a PAR of 8 h", () => {
    expect(html).toMatch(/Interventions<\/td><td>12<\/td><td>up to 12<\/td><td>up to 16<\/td><td>per batch<\/td>/);
    expect(html).toMatch(/Filling duration<\/td><td>6<\/td><td>up to 6<\/td><td>up to 8<\/td><td>h<\/td>/);
    expect(plain).not.toContain("Filtered (sterile) bulk hold time");
    expect(plain).toContain("Filling starts directly after sterile filtration.");
    expect(plain).toContain("Where this section says drug substance, the same applies to bulk placebo.");
  });

  it("keeps the time values of the demo consistent", () => {
    // The total time out of refrigeration is the sum of the per-step budgets, all read from structured parameter items.
    // Time out of refrigeration is tracked per portion, from the start of filling of that portion.
    expect(plain).toContain("tracked for each portion of the batch separately");
    expect(plain).toContain("The total for a portion must not exceed 12 h");
    expect(plain).toContain("filling up to 6 h, visual inspection up to 3 h, bulk packing up to 1 h, and labelling and packaging up to 2 h");
    // Bioburden reduction filtration: the filter contact time is 4 h in normal operation (the proven range, 24 h, is in the parameter table).
    expect(plain).toMatch(/takes no more than 4 h/);
  });
});
