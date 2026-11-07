import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glossary, tours } from "../index";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..", "..", "apps", "web", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}
const files = sourceFiles(webSrc).filter((f) => /\.tsx?$/.test(f));
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

/** True when the page source writes the anchor as data-tour="id", tour="id" (the Tabs component) or tour: "id" (a tab definition). */
const anchorInSource = (id: string) => new RegExp(String.raw`\btour\w*\s*[=:]\s*\{?[^"\n]*"` + id + `"`).test(source);

describe("tours (content/help/tours.yaml)", () => {
  it("has a tour for each main page, with 3 to 5 steps", () => {
    expect(tours.map((t) => t.path).sort()).toEqual(["/", "/gap", "/interview", "/mbr", "/risk", "/sampling", "/trd"]);
    for (const t of tours) {
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.steps.length, t.id).toBeLessThanOrEqual(5);
    }
  });

  it("points every step at an anchor that exists in the page source", () => {
    for (const t of tours) for (const s of t.steps) expect(anchorInSource(s.anchor), `${t.id}: ${s.anchor}`).toBe(true);
  });

  it("uses no anchor twice within one tour and keeps each step short", () => {
    for (const t of tours) {
      expect(new Set(t.steps.map((s) => s.anchor)).size, t.id).toBe(t.steps.length);
      for (const s of t.steps) {
        expect(s.title.length, `${t.id}: ${s.title}`).toBeLessThanOrEqual(40);
        // Two plain sentences (three where a step must say what is not hidden or blocked).
        const sentences = s.text.split(/(?<=[.?!])\s+/).length;
        expect(sentences, `${t.id}: ${s.anchor}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("has no template markers and no filing-category decision", () => {
    const all = JSON.stringify(tours);
    expect(all).not.toContain("{{");
    expect(all).not.toMatch(/\bmajor change\b|\bprior approval\b|\bCBE\b/i);
  });
});

describe("glossary (content/help/glossary.yaml)", () => {
  it("is alphabetical with unique ids and links that resolve", () => {
    const names = glossary.map((t) => t.term);
    expect([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))).toEqual(names);
    expect(new Set(glossary.map((t) => t.id)).size).toBe(glossary.length);
    const ids = new Set(glossary.map((t) => t.id));
    for (const t of glossary) for (const s of t.see) expect(ids.has(s), `${t.id} -> ${s}`).toBe(true);
  });

  it("defines every term the brief names", () => {
    const text = glossary.map((t) => `${t.term} ${t.id}`).join(" | ").toLowerCase();
    for (const w of [
      "trd", "nor", "par", "set point", "hold time", "time limit", "ppq", "cpv", "engineering run", "clinical batch", "commercial", "project stage",
      "sending unit", "receiving unit", "cmo", "batch record", "sampling point", "study point", "ppq-only item", "include anyway", "bracketing",
      "in-process control", "release testing", "cci", "bioburden", "design review", "open item", "gap", "risk rating", "drafting aid",
      // The terms the TRD interview hints link to.
      "tbd", "cqa", "unit operation", "write-up",
    ]) expect(text, w).toContain(w);
  });

  it("explains all four project stages and says nothing is hidden or blocked", () => {
    const stage = glossary.find((t) => t.id === "project-stage")!.short;
    for (const w of ["Engineering / development", "Clinical", "PPQ", "Commercial", "Nothing is hidden or blocked"]) expect(stage).toContain(w);
  });

  it("states the PPQ hold rules the documents use", () => {
    const par = glossary.find((t) => t.id === "par")!.short;
    expect(par).toMatch(/most conservative \(lowest\)/);
    const hold = glossary.find((t) => t.id === "hold-time")!.short;
    expect(hold).toMatch(/every PPQ lot/);
    expect(hold).toMatch(/more than N h/);
  });

  it("covers every abbreviation the app expands", () => {
    // Abbreviations written as "ABC (long form)" or "long form (ABC)" in the app source, apart from standards bodies and file types that need no entry.
    const skip = new Set(["ICH", "GMP", "PDF", "HTML", "JSON", "FDA", "EMA", "EU", "ID", "UI", "SU", "RU", "MBR", "CFU", "WCAG", "ISO", "USP", "PDA", "AQL", "RPN", "FMEA", "IP", "MODEL"]);
    const found = new Set<string>();
    for (const m of source.matchAll(/\b([A-Z]{2,5})\b \(([a-z][a-z -]{4,})\)/g)) found.add(m[1]!);
    for (const m of source.matchAll(/[a-z] \(([A-Z]{2,5})\)/g)) found.add(m[1]!);
    const text = glossary.map((t) => `${t.term} ${t.id}`).join(" | ");
    const missing = [...found].filter((a) => !skip.has(a) && !new RegExp(String.raw`\b` + a + String.raw`\b`).test(text));
    expect(missing).toEqual([]);
    // The abbreviations the page headers expand, named in the brief, plus the units.
    for (const a of ["PPQ", "TRD", "CMO", "NOR", "PAR", "QA", "SU", "RU", "MBR", "IPC", "CCI", "CPV", "TBD"]) expect(text, a).toMatch(new RegExp(String.raw`\b` + a + String.raw`\b`));
  });

  it("has no template markers, no email-like text and no filing-category decision", () => {
    const all = JSON.stringify(glossary);
    expect(all).not.toContain("{{");
    expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(all).not.toMatch(/\bmajor change\b|\bprior approval\b|\bCBE\b/i);
    // The one allowed wording about a filing category.
    expect(glossary.find((t) => t.id === "gap")!.short).toContain("Requires regulatory affairs assessment");
  });
});
