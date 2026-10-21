import { optionsFor } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos, guidance, rawContent } from "../index";

/**
 * M5.6: TBD (to be determined) is the one not-known answer. No question may offer a not-known choice of its own, and
 * no text may call the not-known answer "Unknown" or "to be confirmed". Two answers for the same state would split one
 * open information item into two lists and let a reviewer read "unknown" and "TBD" as different commitments.
 */

/** Wording that makes an option (or any content text) a second way of saying "not known". */
const NOT_KNOWN = /\bunknown\b|\bnot (yet )?(known|decided|sure)\b|\bto be (confirmed|decided|advised)\b|\bundecided\b|\bunsure\b|\bdon'?t know\b|\bTBC\b|\bnot_decided\b|\bnot_known\b/i;

/** Every string in a parsed YAML tree with the path it sits at. */
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

const catalogOptionSets = () => ((rawContent.catalog as { optionSets?: Record<string, { value: string; label: string }[]> }).optionSets ?? {});

describe("no question offers a not-known choice", () => {
  it("scans something (guards against the test passing on an empty bundle)", () => {
    expect(content.questions.length).toBeGreaterThan(100);
    expect(Object.keys(catalogOptionSets()).length).toBeGreaterThan(10);
  });

  it("no option of any question reads as unknown, not known, not decided or to be confirmed", () => {
    const hits: string[] = [];
    for (const q of content.questions) {
      for (const o of optionsFor(content, q)) {
        if (NOT_KNOWN.test(o.value) || NOT_KNOWN.test(o.label)) hits.push(`${q.id}: ${o.value} / ${o.label}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no option set in the catalog has such a choice, used by a question or not", () => {
    const hits: string[] = [];
    for (const [name, opts] of Object.entries(catalogOptionSets())) {
      for (const o of opts) if (NOT_KNOWN.test(o.value) || NOT_KNOWN.test(o.label)) hits.push(`${name}: ${o.value} / ${o.label}`);
    }
    expect(hits).toEqual([]);
  });

  it("question text, help, rules and templates never call the not-known answer Unknown or 'to be confirmed'", () => {
    const hits: string[] = [];
    for (const [file, tree] of Object.entries(rawContent.questionFiles)) for (const [p, s] of strings(tree, file)) if (NOT_KNOWN.test(s)) hits.push(`${p}: ${s}`);
    for (const [p, s] of strings(rawContent.catalog, "catalog")) if (NOT_KNOWN.test(s)) hits.push(`${p}: ${s}`);
    for (const [p, s] of strings(rawContent.ruleFiles, "rules")) if (NOT_KNOWN.test(s)) hits.push(`${p}: ${s}`);
    for (const [p, s] of strings(rawContent.templates, "templates")) if (NOT_KNOWN.test(s)) hits.push(`${p}: ${s}`);
    for (const [p, s] of strings(guidance, "guidance")) if (NOT_KNOWN.test(s)) hits.push(`${p}: ${s}`);
    expect(hits).toEqual([]);
  });

  it("the demo answers no question with unknown, only with TBD", () => {
    const text = JSON.stringify(demos);
    expect(text).not.toMatch(/"unknown"/);
  });

  it("the detector itself catches the wordings it is meant to catch", () => {
    for (const s of ["Unknown", "unknown", "Not yet known", "not known", "Not decided", "not_decided", "To be confirmed", "TBC", "Don't know", "Unsure"]) {
      expect(NOT_KNOWN.test(s), s).toBe(true);
    }
    for (const s of ["TBD (to be determined)", "Known", "Confirmed", "Single-use bag", "Not applicable"]) expect(NOT_KNOWN.test(s), s).toBe(false);
  });
});
