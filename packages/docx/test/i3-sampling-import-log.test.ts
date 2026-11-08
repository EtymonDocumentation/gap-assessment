import {
  applySamplingImport,
  buildDemoProject,
  samplingSessionFromOther,
  type SamplingDecisions,
  type SamplingImportSession,
} from "@gap/engine";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingImportSynonyms, samplingSuggestions } from "../../../content/index";
import { readUpload } from "../src/index";
import { GENERATED_AT } from "./fixtures";
import { foreignDocx } from "./i2-foreign";
import { foreignSamplingBodyXml } from "./i3-foreign";

// CR-08: the change log of a sampling upload lists a value only when it really went into the plan. Fictional data only.

// A switch for the "point fails to add after its step was added" case, which the real checks hardly ever reach. Off by default.
const forced = vi.hoisted(() => ({ failUpdate: false }));
vi.mock("../../engine/src/sampling", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../engine/src/sampling")>();
  return {
    ...real,
    updatePoint: (...args: Parameters<typeof real.updatePoint>) => {
      if (forced.failUpdate) throw new real.SamplingError("forced for the test");
      return real.updatePoint(...args);
    },
  };
});

vi.setConfig({ testTimeout: 60000 });

const actor = { name: "Test reviewer", at: GENERATED_AT };
const project = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes });
const syn = samplingImportSynonyms;
const [stepA, stepB] = content.catalog.unitOperations.slice(0, 2).map((u) => u.label) as [string, string];
const ctx3 = { syn, steps: content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label })), tests: samplingSuggestions.candidates };
const word = (): SamplingImportSession => samplingSessionFromOther(readUpload(foreignDocx(foreignSamplingBodyXml(stepA, stepB)), "foreign.docx"), ctx3);
// The matched cells of the points tables (not the document title: a new plan takes the title typed for it, not the one in the file).
const matched = (s: SamplingImportSession): SamplingDecisions =>
  Object.fromEntries(s.fields.filter((f) => f.confidence === "matched" && f.value && !f.unreadable && !f.change && f.id !== "sampling.title").map((f) => [f.id, { value: f.value }]));
const target = { kind: "new", title: "From another layout" } as const;
const evidenceOf = (p: typeof project) => (p.changeLog.at(-1)!.after as { evidence: { field: string }[] }).evidence;
const planOf = (p: typeof project, id: string) => p.sampling.plans.find((x) => x.id === id)!;

describe("sampling upload: what the change log says was put in (CR-08)", () => {
  it("leaves out the values of a row that was refused, and does not count them as taken", () => {
    const s = word();
    const dec = matched(s);
    // Row 2 keeps only its process step: that is not enough to make a sample point, so the row is refused.
    for (const id of Object.keys(dec)) if (id.startsWith("sampling.row.2.") && !id.endsWith(".step")) delete dec[id];
    expect(dec["sampling.row.2.step"]).toBeDefined();
    const r = applySamplingImport(project, s, dec, { actor, content, syn, target });
    expect(r.warnings.join(" ")).toMatch(/Row 2 was not added/);
    const ev = evidenceOf(r.project);
    expect(ev.some((e) => e.field.startsWith("Row 2"))).toBe(false);
    expect(ev.some((e) => e.field.startsWith("Row 1"))).toBe(true);
    // Every value in the count is a value in the log, and the refused one is open again.
    expect(r.counts.taken).toBe(ev.length);
    expect(r.counts.taken).toBeLessThan(samplingCountOf(dec));
    expect(r.project.changeLog.at(-1)!.detail).toContain(`${r.counts.taken} values taken`);
  });

  it("rolls a row back when its point fails after its step was added: no empty step, no evidence", () => {
    const s = word();
    const dec = matched(s);
    const none = applySamplingImport(project, s, {}, { actor, content, syn, target });
    forced.failUpdate = true;
    try {
      const r = applySamplingImport(project, s, dec, { actor, content, syn, target });
      const made = planOf(r.project, r.planId);
      expect(r.added).toBe(0);
      expect(made.points).toHaveLength(0);
      // The steps are the ones the new plan started with: a step added for a refused row did not stay behind.
      expect(made.steps.map((x) => x.label)).toEqual(planOf(none.project, none.planId).steps.map((x) => x.label));
      expect(r.warnings.join(" ")).toMatch(/was not applied: forced for the test/);
      expect(evidenceOf(r.project)).toEqual([]);
      expect(r.counts.taken).toBe(0);
    } finally {
      forced.failUpdate = false;
    }
  });
});

const samplingCountOf = (dec: SamplingDecisions) => Object.values(dec).filter((d) => d.value.trim() !== "").length;
