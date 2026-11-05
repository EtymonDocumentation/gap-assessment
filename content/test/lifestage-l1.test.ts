// Life stage, job L1: one project stage (four values), the stage check, the 1.29.0 migration, setProjectStage, the {{@stage}} resolver and
// its lint, appliesAtStage, the demo stages and the cover/stage wording. The chain that adapts to the stage is job L2, not tested here.
import {
  appliesAtStage,
  assess,
  buildDemoProject,
  buildTrdSeed,
  createTrd,
  buildDocument,
  coverStage,
  parseStageMarker,
  PROGRAM_STAGES,
  projectStage,
  resolveStageMarkers,
  setProjectStage,
  STAGE_COVER_NOT_ESTABLISHED,
  STAGE_LABEL,
  STAGE_MEANING,
  STAGE_OWN_TEXT_NOTE,
  STAGE_SHORT,
  stageCheckOf,
  stagedContent,
  stageOpenItems,
  stageShort,
  type ProgramStage,
} from "@gap/engine";
import { BLANK_PATTERN, parseProject, SCHEMA_VERSION, SYSTEM_ACTOR, type Actor, type Project } from "@gap/process-model";
import { describe, expect, it, vi } from "vitest";
import { content, demos, trdWriteups } from "../index";

// Each case parses and rebuilds a whole demo project, which is slow when the machine runs the full suite.
vi.setConfig({ testTimeout: 60_000 });

const NOW = "2026-11-03T09:00:00.000Z";
const ACTOR: Actor = { name: "A. Tester (fictional)", role: "QA", at: NOW };
const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The arx-217 demo written the way a 1.28.0 build stored it, with the given RU stage (undefined = unanswered) and optional old TRD text. */
function oldFile(ruStage: string | undefined, trdText?: string): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = json(buildDemoProject(content, demos["arx-217"]));
  const fields = raw.processes.target.site.fields;
  if (ruStage === undefined) delete fields.programStage;
  else fields.programStage.value = ruStage;
  raw.schemaVersion = "1.28.0";
  delete raw.meta.stageCheck;
  // A real TRD (started from the demo's seed), given the "Program stage" detail a 1.28.0 TRD form had.
  const bare: Project = { ...buildDemoProject(content, demos["arx-217"]), trd: { documents: [] } };
  if (trdText === undefined) raw.trd = { documents: [] };
  else {
    const made = createTrd(bare, { title: "Test TRD (fictional)", start: { kind: "project", seed: buildTrdSeed(content, bare, { exportedAt: NOW }) } }, { ...ACTOR, at: NOW });
    const trd = json(made.project.trd);
    const pulled = trdText ? { status: "established", display: trdText, value: trdText, sourceIds: [] } : { status: "not_established", sourceIds: [] };
    trd.documents[0].details.push({ key: "programStage", label: "Program stage", pulled });
    raw.trd = trd;
  }
  for (const plan of raw.sampling?.plans ?? []) plan.runType = "ppq";
  return raw;
}
const stageLog = (p: Project) => p.changeLog.filter((e) => e.action === "migrate_stage");

describe("the four stages", () => {
  it("are development, clinical, PPQ, commercial, each with a label, a short form and a one-line meaning", () => {
    expect([...PROGRAM_STAGES]).toEqual(["development", "clinical", "ppq", "commercial"]);
    expect(content.catalog.optionSets.programStage!.map((o) => o.label)).toEqual(PROGRAM_STAGES.map((s) => STAGE_LABEL[s]));
    expect(PROGRAM_STAGES.map((s) => STAGE_SHORT[s])).toEqual(["Engineering", "Clinical", "PPQ", "Commercial"]);
    for (const s of PROGRAM_STAGES) expect(STAGE_MEANING[s].length).toBeGreaterThan(20);
    expect(stageShort(undefined)).toBe("not set");
    expect(STAGE_OWN_TEXT_NOTE).toBe("Your own text is not changed or deleted.");
  });

  it("word the receiving-site question as the next batches, with nothing preselected", () => {
    const q = content.questionById.get("site.stage")!;
    expect(q.sideLabels?.target).toBe("What will the receiving site's next batches be?");
    expect(q.sideLabels?.source).toContain("Sending-site stage");
    expect(JSON.stringify(q)).not.toMatch(/"default"/);
  });

  it("print on the cover as the long label, or [not established]", () => {
    expect(coverStage("ppq")).toEqual({ targetStage: STAGE_LABEL.ppq, stageShort: "PPQ" });
    expect(coverStage(undefined)).toEqual({ targetStage: STAGE_COVER_NOT_ESTABLISHED, stageShort: "not set" });
  });
});

describe("the demos", () => {
  it("both run PPQ batches at the receiving site, keep their sending stage, and have no stage check", () => {
    const arx = buildDemoProject(content, demos["arx-217"]);
    const syr = buildDemoProject(content, demos["syr-305"]);
    expect(projectStage(arx)).toBe("ppq");
    expect(projectStage(syr)).toBe("ppq");
    expect(arx.processes.source.site.fields.programStage).toMatchObject({ value: "commercial" });
    expect(syr.processes.source.site.fields.programStage).toMatchObject({ value: "clinical" });
    expect(stageCheckOf(arx)).toBeUndefined();
    expect(stageCheckOf(syr)).toBeUndefined();
    expect(arx.meta.stageCheck).toBeUndefined();
  });
});

describe("migration 1.28.0 -> 1.29.0", () => {
  it("is the current schema", () => {
    expect(SCHEMA_VERSION).toBe("1.30.0");
  });

  it("keeps a saved Commercial project stage, marks it for a check and logs it (no silent re-mapping)", () => {
    const p = parseProject(oldFile("commercial"), { now: NOW });
    expect(projectStage(p)).toBe("commercial");
    expect(p.meta.stageCheck).toBe("commercial-before-ppq");
    expect(stageCheckOf(p)).toBe("commercial-before-ppq");
    const rec = stageLog(p);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ by: SYSTEM_ACTOR, at: NOW, after: { value: "commercial", stageCheck: "commercial-before-ppq" } });
    expect(stageOpenItems(p).join(" ")).toContain("Check the project stage");
  });

  it("puts no check on a Clinical or Engineering project stage", () => {
    for (const v of ["clinical", "development"]) {
      const p = parseProject(oldFile(v), { now: NOW });
      expect(projectStage(p)).toBe(v);
      expect(p.meta.stageCheck).toBeUndefined();
      expect(stageLog(p)).toHaveLength(0);
    }
  });

  it("leaves a project stage that was never answered not established, with no check", () => {
    const p = parseProject(oldFile(undefined), { now: NOW });
    expect(projectStage(p)).toBeUndefined();
    expect(p.meta.stageCheck).toBeUndefined();
  });

  it("drops the TRD form's stage when it says what the project says, or nothing", () => {
    for (const text of ["", "Clinical (GMP, not process validated)", "clinical"]) {
      const p = parseProject(oldFile("clinical", text), { now: NOW });
      expect(p.trd.documents[0]!.details.map((f) => f.key)).toEqual(["program", "modality", "dosageForm", "presentation", "site", "line"]);
      expect(stageLog(p)).toHaveLength(0);
      expect(p.meta.stageCheck).toBeUndefined();
    }
  });

  it("moves the TRD form's stage into the project when the project had none, with its provenance said", () => {
    const p = parseProject(oldFile(undefined, "Development / engineering runs"), { now: NOW });
    expect(projectStage(p)).toBe("development");
    const entry = p.processes.target.site.fields.programStage!;
    expect(entry.recordedBy).toBe(SYSTEM_ACTOR);
    expect(p.sources.find((s) => entry.sourceIds.includes(s.id))?.label).toContain("Moved from the TRD form");
    expect(stageLog(p)).toHaveLength(1);
  });

  it("keeps the project's own answer when the TRD form differed, logs the old text and marks a check", () => {
    const p = parseProject(oldFile("clinical", "Commercial (process validated)"), { now: NOW });
    expect(projectStage(p)).toBe("clinical");
    expect(p.meta.stageCheck).toBe("trd-differed");
    const rec = stageLog(p);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.detail).toContain("Commercial (process validated)");
    expect(rec[0]!.before).toEqual({ text: "Commercial (process validated)" });
  });

  it("removes the sampling plans' run type with a record each", () => {
    const raw = oldFile("clinical");
    const plans = raw.sampling?.plans ?? [];
    const p = parseProject(raw, { now: NOW });
    for (const plan of p.sampling?.plans ?? []) expect("runType" in plan).toBe(false);
    expect(p.changeLog.filter((e) => e.action === "migrate_sampling_runtype")).toHaveLength(plans.length);
  });

  it("changes nothing the second time", () => {
    const once = parseProject(oldFile("commercial", "Clinical (GMP, not process validated)"), { now: NOW });
    const twice = parseProject(json(once), { now: "2026-11-04T09:00:00.000Z" });
    expect(json(twice)).toEqual(json(once));
  });
});

describe("setProjectStage", () => {
  const checked = () => parseProject(oldFile("commercial"), { now: NOW });

  it("writes the receiving-site answer like the interview does: provenance, history and a change-log record", () => {
    const p0 = buildDemoProject(content, demos["arx-217"]);
    const r = setProjectStage(p0, content, "clinical", ACTOR);
    expect(r.changed).toBe(true);
    expect(projectStage(r.project)).toBe("clinical");
    expect(r.adapts.length).toBeGreaterThan(0);
    const e = r.project.processes.target.site.fields.programStage!;
    expect(e.recordedBy).toBe(ACTOR.name);
    expect(e.revision).toBe((p0.processes.target.site.fields.programStage!.revision ?? 1) + 1);
    expect(r.project.changeLog.length).toBeGreaterThan(p0.changeLog.length);
    expect(r.project.processes.source.site.fields.programStage).toEqual(p0.processes.source.site.fields.programStage);
  });

  it("writes nothing when the stage is already this one and no check is waiting", () => {
    const p0 = buildDemoProject(content, demos["arx-217"]);
    const r = setProjectStage(p0, content, "ppq", ACTOR);
    expect(r.changed).toBe(false);
    expect(r.project).toBe(p0);
  });

  it("clears the stage check when the same stage is chosen again, and keeps a record of the confirmation", () => {
    const p0 = checked();
    const r = setProjectStage(p0, content, "commercial", ACTOR);
    expect(r.changed).toBe(true);
    expect(r.project.meta.stageCheck).toBeUndefined();
    expect(projectStage(r.project)).toBe("commercial");
    expect(r.project.changeLog.some((e) => e.action === "clear_stage_check")).toBe(true);
  });

  it("clears the check when another stage is chosen", () => {
    const r = setProjectStage(checked(), content, "ppq", ACTOR);
    expect(projectStage(r.project)).toBe("ppq");
    expect(r.project.meta.stageCheck).toBeUndefined();
  });

  it("does not touch text the person wrote", () => {
    const p0 = buildDemoProject(content, demos["arx-217"]);
    const r = setProjectStage(p0, content, "development", ACTOR);
    expect(r.project.processes.target.unitOperations).toEqual(p0.processes.target.unitOperations);
    expect(r.project.trd).toEqual(p0.trd);
  });
});

describe("appliesAtStage", () => {
  it("is true with no list, true for a listed stage, false for another, and true when the stage is not established", () => {
    expect(appliesAtStage({}, "ppq")).toBe(true);
    expect(appliesAtStage({ stages: [] }, "ppq")).toBe(true);
    expect(appliesAtStage({ stages: ["ppq", "commercial"] }, "ppq")).toBe(true);
    expect(appliesAtStage({ stages: ["ppq", "commercial"] }, "clinical")).toBe(false);
    expect(appliesAtStage({ stages: ["ppq"] }, undefined)).toBe(true);
  });
});

describe("{{@stage ...}} markers", () => {
  const M = "{{@stage development, clinical: early ;; ppq: validation ;; else: unknown}}";

  it("parse into branches, and need a known stage and an else branch", () => {
    const ok = parseStageMarker(" development, clinical: early ;; ppq: validation ;; else: unknown");
    expect("branches" in ok && ok.branches.map((b) => b.stages)).toEqual([["development", "clinical"], ["ppq"], "else"]);
    expect(parseStageMarker(" ppq: x")).toEqual({ error: "no else branch" });
    expect("error" in parseStageMarker(" gold: x ;; else: y")).toBe(true);
    expect("error" in parseStageMarker(" no colon here")).toBe(true);
  });

  it("resolve per stage, and take the else branch when the stage is not established", () => {
    const at = (s: ProgramStage | undefined) => resolveStageMarkers(`A ${M} B`, s);
    expect(at("development")).toBe("A early B");
    expect(at("clinical")).toBe("A early B");
    expect(at("ppq")).toBe("A validation B");
    expect(at("commercial")).toBe("A unknown B");
    expect(at(undefined)).toBe("A unknown B");
  });

  it("leave a marker that does not parse as written, so the lint can see it", () => {
    const bad = "{{@stage ppq: x}}";
    expect(resolveStageMarkers(bad, "ppq")).toBe(bad);
  });

  it("are not mistaken for a TRD blank or a two-way marker", () => {
    expect(M.match(BLANK_PATTERN)).toBeNull();
    expect(/\{\{([^{}|]*)\|([^{}]*)\}\}/.test(M)).toBe(false);
    expect(resolveStageMarkers("{{key|Fallback}} and {{validated|other}}", "ppq")).toBe("{{key|Fallback}} and {{validated|other}}");
  });

  it("stage a content bundle by validated claim and project stage, and the bundle is memoised", () => {
    const a = stagedContent(content, true, "ppq");
    expect(a.projectStage).toBe("ppq");
    expect(stagedContent(content, true, "ppq")).toBe(a);
    expect(stagedContent(content, true, "clinical")).not.toBe(a);
  });

  it("lint: every marker in the content parses, and none is left after resolving for any stage or none", () => {
    const stages: (ProgramStage | undefined)[] = [...PROGRAM_STAGES, undefined];
    const text = JSON.stringify({ q: content.questions, s: content.sections, r: content.rules, t: content.templates, c: content.catalog });
    for (const m of text.matchAll(/\{\{@stage([^{}]*)\}\}/g)) {
      const inner = m[1]!.replace(/\\"/g, '"');
      expect("branches" in parseStageMarker(inner), `marker ${m[0].slice(0, 80)}`).toBe(true);
    }
    for (const validated of [true, false]) {
      for (const s of stages) {
        const staged = JSON.stringify({ q: stagedContent(content, validated, s).questions, t: stagedContent(content, validated, s).templates });
        expect(staged, `${validated} ${s}`).not.toContain("{{@stage");
      }
    }
  });

  it("staging the content leaves the TRD blanks and both demos byte-identical", () => {
    const stages: (ProgramStage | undefined)[] = [...PROGRAM_STAGES, undefined];
    // The write-up library holds the TRD blanks {{key|Fallback}}; resolving stage markers must neither alter nor swallow one.
    const lib = JSON.stringify(trdWriteups);
    const base = lib.match(BLANK_PATTERN) ?? [];
    expect(base.length).toBeGreaterThan(0);
    // Since job L2 the library holds {{@stage}} markers (the TRD range wording). Resolving them must leave every blank as it was.
    for (const s of stages) {
      const out = resolveStageMarkers(lib, s);
      expect(out).not.toContain("{{@stage");
      expect(out.match(BLANK_PATTERN) ?? []).toEqual(base);
    }
    for (const id of ["arx-217", "syr-305"] as const) {
      // The raw demo data is shared; staging the content must not write into it.
      const before = JSON.stringify(demos[id]);
      for (const s of stages) stagedContent(content, false, s);
      expect(JSON.stringify(demos[id])).toBe(before);
    }
  });
});

describe("the gap assessment and the stage", () => {
  it("lists the stage check as an open item and names both stages", () => {
    const p = parseProject(oldFile("commercial"), { now: NOW });
    const doc = buildDocument(content, p, assess(content, p), NOW);
    const open = JSON.stringify(doc.sections.find((s) => s.id === "open-items"));
    expect(open).toContain("Check the project stage");
    expect(doc.cover.targetStage).toBe(STAGE_LABEL.commercial);
    expect(doc.cover.stageShort).toBe("Commercial");
  });

  it("lists no check for a demo", () => {
    const p = buildDemoProject(content, demos["arx-217"]);
    const doc = buildDocument(content, p, assess(content, p), NOW);
    expect(JSON.stringify(doc.sections.find((s) => s.id === "open-items"))).not.toContain("Check the project stage");
    expect(doc.cover.stageShort).toBe("PPQ");
  });
});
