// Life stage, job L2: the chain after the gap assessment adapts to the project stage (TRD, sampling plan, batch record, risk line,
// activity notes) and every document renders for every sending-site x project stage with no leftover marker. Fictional data only.
import {
  buildDemoProject,
  buildMbrDocument,
  buildRiskAssessmentDocument,
  buildSamplingPlanDocument,
  buildTrdDocument,
  genericActivityStageNote,
  leftOutSentence,
  mbrPpqOnlyItems,
  mbrStageView,
  partIsIn,
  pointStageReminder,
  PROGRAM_STAGES,
  riskStageLine,
  samplingStageWording,
  setIncludeAnyway,
  stageText,
  trdRangeIntro,
  type ProgramStage,
} from "@gap/engine";
import type { Actor, Project } from "@gap/process-model";
import { renderMarkdown } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions } from "../index";

vi.setConfig({ testTimeout: 120_000 });

const NOW = "2026-11-03T09:00:00.000Z";
const ACTOR: Actor = { name: "A. Tester (fictional)", role: "QA", at: NOW };
const opts = { generatedAt: NOW, appVersion: "0.0.0-test" };
const base = buildDemoProject(content, demos["arx-217"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary });
type Stage = ProgramStage | undefined;

/** The demo with both stages set (undefined = the answer is removed, so the stage is not established). */
function withStages(source: Stage, target: Stage): Project {
  const p = structuredClone(base);
  for (const [side, v] of [["source", source], ["target", target]] as const) {
    const f = p.processes[side].site.fields as Record<string, { value?: unknown }>;
    if (v === undefined) delete f.programStage;
    else f.programStage = { ...(f.programStage ?? {}), value: v } as never;
  }
  return p;
}

const trdMd = (p: Project) => renderMarkdown(buildTrdDocument(p, p.trd.documents[0]!, opts));
const planMd = (p: Project) => renderMarkdown(buildSamplingPlanDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, opts));
const mbrMd = (p: Project) => renderMarkdown(buildMbrDocument(p, p.mbr.records[0]!, opts));
const riskMd = (p: Project) => renderMarkdown(buildRiskAssessmentDocument(content, p, p.risk.assessments[0]!, failureModes, opts));
const allDocs = (p: Project) => [trdMd(p), planMd(p), mbrMd(p), riskMd(p)];
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("every document, every sending-site x project stage", () => {
  const stages: Stage[] = [...PROGRAM_STAGES, undefined];
  for (const s of stages)
    for (const t of stages)
      it(`renders cleanly: sending ${s ?? "not set"}, project ${t ?? "not set"}`, () => {
        for (const md of allDocs(withStages(s, t))) {
          expect(md).not.toContain("{{");
          expect(md).not.toMatch(/undefined|NaN|\[object Object\]/);
        }
      });
});

describe("validated-claim guard", () => {
  // The receiving site's process is called validated only at a Commercial project. Wording that denies it, or names a validated
  // range as a future result, is fine; anything else that says the receiving process "is validated" fails.
  for (const t of PROGRAM_STAGES.filter((x) => x !== "commercial"))
    it(`never calls the receiving process validated at a ${t} project`, () => {
      for (const md of allDocs(withStages("development", t))) {
        const bad = [...flat(md).matchAll(/[^.]{0,60}\b(?:RU|receiving)\b[^.]{0,40}\b(?:is|are) validated\b[^.]{0,30}/gi)].map((m) => m[0]);
        expect(bad).toEqual([]);
      }
    });
});

describe("TRD", () => {
  it("states what the ranges mean at each stage, and nothing when the stage is not set", () => {
    for (const s of PROGRAM_STAGES) expect(flat(trdMd(withStages("commercial", s)))).toContain(trdRangeIntro(s)!);
    expect(trdRangeIntro(undefined)).toBeUndefined();
  });
  it("says a hold is more than N h before PPQ and the PAR is the most conservative PPQ lot value", () => {
    expect(trdRangeIntro("clinical")).toMatch(/more than N h/);
    expect(trdRangeIntro("ppq")).toMatch(/every hold and time is run in every PPQ lot/);
    expect(trdRangeIntro("commercial")).toMatch(/most conservative/);
  });
  it("an optional part follows its stages unless the author switched it, and the author's switch wins", () => {
    const part = { optional: { condition: "x", stages: ["commercial"] }, included: undefined } as never as Parameters<typeof partIsIn>[0];
    expect(partIsIn(part, "commercial")).toBe(true);
    expect(partIsIn(part, "ppq")).toBe(false);
    expect(partIsIn(part, undefined)).toBe(false);
    expect(partIsIn({ ...part, included: false } as never, "commercial")).toBe(false);
    expect(partIsIn({ ...part, included: true } as never, "ppq")).toBe(true);
  });
  it("resolves a stage marker when shown and leaves the stored text alone", () => {
    const src = "{{@stage clinical: A ;; ppq: B ;; else: C}}";
    expect(stageText({ project: withStages("commercial", "clinical") }, src)).toBe("A");
    expect(stageText({ project: withStages("commercial", undefined) }, src)).toBe("C");
  });
});

describe("sampling plan", () => {
  it("is titled for the stage, with a neutral title when the stage is not set", () => {
    for (const t of [...PROGRAM_STAGES, undefined] as Stage[]) {
      const p = withStages("commercial", t);
      expect(buildSamplingPlanDocument(content, p, p.sampling.plans[0]!, samplingSuggestions, opts).title).toBe(samplingStageWording(t).title);
    }
    expect(samplingStageWording("clinical").title).toMatch(/Clinical batch sampling plan/);
    expect(samplingStageWording(undefined).title).toBe("Sampling plan — draft");
  });
  it("tags PPQ points for a non-PPQ stage and removes none", () => {
    expect(pointStageReminder("clinical", { type: "ppq_enhanced" })).toMatch(/usually don't need it/);
    expect(pointStageReminder("commercial", { afterPpq: "ppq_only" })).toBe("Not part of routine sampling.");
    expect(pointStageReminder("commercial", { afterPpq: "continues" })).toBe("Part of the routine set.");
    expect(pointStageReminder("ppq", { afterPpq: "ppq_only" })).toBeUndefined();
    const ids = (t: Stage) => new Set(planMd(withStages("commercial", t)).match(/\b[A-Z]{2}-\d{2,}\b/g));
    expect(ids("clinical")).toEqual(ids("ppq"));
  });
  it("does not word a clinical plan as PPQ", () => {
    const md = flat(planMd(withStages("commercial", "clinical")));
    expect(md).toContain("Project stage: Clinical");
    expect(md).not.toContain("Run type: PPQ");
  });
});

describe("batch record", () => {
  it("has PPQ-only items (the demo hold challenge at least)", () => {
    expect(mbrPpqOnlyItems(base, base.mbr.records[0]!).some((i) => i.kind === "parameter")).toBe(true);
  });
  it("includes everything when the stage is not set or is PPQ", () => {
    for (const t of [undefined, "ppq"] as Stage[]) {
      const p = withStages("commercial", t);
      expect(mbrStageView(p, p.mbr.records[0]!).leftOut).toEqual([]);
    }
  });
  it("leaves PPQ-only items out at other stages, lists them, and Include anyway puts one back without deleting anything", () => {
    for (const t of ["development", "clinical", "commercial"] as ProgramStage[]) {
      const p = withStages("commercial", t);
      const r = p.mbr.records[0]!;
      const v = mbrStageView(p, r);
      expect(v.leftOut.length).toBeGreaterThan(0);
      expect(v.sentence).toBe(leftOutSentence(t, v.leftOut.length));
      const md = flat(mbrMd(p));
      expect(md).toContain(v.sentence);
      for (const i of v.leftOut) expect(md).toContain(`${i.id}: ${i.text}`);
      const before = JSON.stringify(r.sections);
      const id = v.leftOut[0]!.id;
      const on = setIncludeAnyway(p, r.id, [id], true, ACTOR);
      const r2 = on.mbr.records[0]!;
      expect(r2.includeAnyway).toEqual([id]);
      expect(JSON.stringify(r2.sections)).toBe(before);
      expect(mbrStageView(on, r2).leftOut.map((i) => i.id)).not.toContain(id);
      expect(on.changeLog.at(-1)?.detail).toContain(id);
      expect(setIncludeAnyway(on, r.id, [id], false, ACTOR).mbr.records[0]!.includeAnyway).toBeUndefined();
      expect(() => setIncludeAnyway(p, r.id, ["ST-9999"], true, ACTOR)).toThrow();
    }
  });
});

describe("risk line and activity notes", () => {
  it("says which stage the ratings reflect", () => {
    expect(riskStageLine("ppq")).toBe("Ratings reflect the PPQ stage; review them when the stage changes.");
    expect(riskStageLine(undefined)).toMatch(/not set/);
    expect(flat(riskMd(withStages("commercial", "clinical")))).toContain(riskStageLine("clinical"));
  });
  it("gives qualification, study and paperwork activities a note at every stage, none when the stage is not set", () => {
    for (const k of ["equipment_qualification", "mixing_study", "training"]) {
      for (const s of PROGRAM_STAGES) expect(genericActivityStageNote(k, s)).toBeTruthy();
      expect(genericActivityStageNote(k, undefined)).toBeUndefined();
    }
  });
});
