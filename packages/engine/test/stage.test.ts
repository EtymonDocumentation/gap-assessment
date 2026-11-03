import {
  activityStageNote,
  adaptText,
  assess,
  PROGRAM_STAGES,
  programStage,
  sourceValidated,
  stageBasis,
  stagedContent,
  stagedFor,
  stageLabel,
  stageWording,
  stageWordingFor,
  type ProgramStage,
} from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, kit } from "./helpers";

describe("adaptText", () => {
  it("takes the first variant for a validated source and the second otherwise", () => {
    expect(adaptText("Within {{validated|source}} range", true)).toBe("Within validated range");
    expect(adaptText("Within {{validated|source}} range", false)).toBe("Within source range");
  });

  it("allows an empty second variant and several markers in one text", () => {
    expect(adaptText("qualified{{ and validated|}} and {{in PPQ|at the source}}.", true)).toBe("qualified and validated and in PPQ.");
    expect(adaptText("qualified{{ and validated|}} and {{in PPQ|at the source}}.", false)).toBe("qualified and at the source.");
  });

  it("leaves a text without markers alone", () => {
    expect(adaptText("Plain text.", false)).toBe("Plain text.");
  });
});

describe("stored stage", () => {
  const p0 = kit.newProject();

  it("has no stage and no default in a new project", () => {
    expect(programStage(p0, "source")).toBeUndefined();
    expect(programStage(p0, "target")).toBeUndefined();
    expect(sourceValidated(p0)).toBe(false);
    expect(stageLabel(undefined)).toBe("[TBD]");
  });

  it.each(PROGRAM_STAGES.flatMap((s) => PROGRAM_STAGES.map((t) => [s, t] as const)))("reads source %s and target %s independently", (s, t) => {
    const p = kit.base({ sourceStage: s, targetStage: t });
    expect(programStage(p, "source")).toBe(s);
    expect(programStage(p, "target")).toBe(t);
    expect(sourceValidated(p)).toBe(s === "commercial");
    const w = stageWording(p);
    expect(w.sourceValidated).toBe(s === "commercial");
    expect(w.sourceSummaryHeading).toBe(s === "commercial" ? "Sending unit program summary (validated state)" : "Sending unit program summary (current state)");
    expect(w.sourceStateColumn).toBe(s === "commercial" ? "Validated state" : "Current state");
    expect(w.sourceSideText).toBe(s === "commercial" ? "SU — validated state" : "SU — current state");
    expect(w.targetSummaryHeading).toBe("Receiving unit summary (planned state)");
    expect(w.rangeShort).toBe(s === "commercial" ? "Validated range" : "Demonstrated range");
  });

  it("does not let the target stage change the source wording", () => {
    for (const t of PROGRAM_STAGES) expect(stageWordingFor("clinical", t).sourceValidated).toBe(false);
    for (const t of PROGRAM_STAGES) expect(stageWordingFor("commercial", t).sourceValidated).toBe(true);
  });
});

describe("stagedFor", () => {
  it("picks the bundle from the project's source stage", () => {
    // The kit's base project has a commercial project (receiving-site) stage, so the bundle is staged for that too.
    expect(stagedFor(content, kit.base({ sourceStage: "commercial" }))).toBe(stagedContent(content, true, "commercial"));
    expect(stagedFor(content, kit.base({ sourceStage: "clinical" }))).toBe(stagedContent(content, false, "commercial"));
    expect(stagedFor(content, kit.base({ sourceStage: "development" }))).toBe(stagedContent(content, false, "commercial"));
    expect(stagedFor(content, kit.base({ sourceStage: "commercial", targetStage: "ppq" }))).toBe(stagedContent(content, true, "ppq"));
    expect(stagedFor(content, kit.newProject())).toBe(stagedContent(content, false));
  });

  it("does not change which gaps are found", () => {
    const keys = (s: ProgramStage) => assess(content, kit.base({ sourceStage: s })).gaps.map((g) => `${g.key}:${g.category}`);
    expect(keys("clinical")).toEqual(keys("commercial"));
    expect(keys("development")).toEqual(keys("commercial"));
  });
});

describe("validation expectations", () => {
  const basis = (s: ProgramStage | undefined, t: ProgramStage | undefined) => stageBasis(stageWordingFor(s, t));

  it("names both stages in the statement", () => {
    expect(basis("clinical", "commercial").statement).toBe(
      "Sending-site stage: Clinical batches (GMP, not process-validated). Project stage: Commercial batches (process validated).",
    );
    expect(basis(undefined, undefined).statement).toBe("Sending-site stage: [TBD]. Project stage: [TBD].");
  });

  it("offers no SU PPQ to leverage from a clinical or development source", () => {
    expect(basis("clinical", "commercial").sourcePoint).toContain("no SU PPQ or process validation evidence to leverage");
    expect(basis("clinical", "commercial").sourcePoint).toContain("Aseptic process simulation");
    expect(basis("development", "commercial").sourcePoint).toContain("no GMP evidence to leverage");
    expect(basis("commercial", "commercial").sourcePoint).toContain("can be leveraged");
  });

  it("expects PPQ at a commercial target, typically a full PPQ from a source that is not validated", () => {
    expect(basis("clinical", "commercial").targetPoint).toContain("typically a full PPQ");
    expect(basis("development", "commercial").targetPoint).toContain("typically a full PPQ");
    expect(basis("commercial", "commercial").targetPoint).not.toContain("typically a full PPQ");
  });

  it("expects phase-appropriate evidence for a clinical target and engineering runs for a development target", () => {
    for (const s of PROGRAM_STAGES) {
      expect(basis(s, "clinical").targetPoint).toContain("phase-appropriate");
      expect(basis(s, "clinical").targetPoint).toContain("full process validation (PPQ) is not expected");
      expect(basis(s, "development").targetPoint).toContain("not for GMP supply");
    }
  });

  it("says what is missing when a stage is TBD", () => {
    expect(basis(undefined, "commercial").sourcePoint).toContain("is TBD");
    expect(basis("commercial", undefined).targetPoint).toContain("is TBD");
  });

  it("phrases everything as expectations to confirm with QA and never names a filing category", () => {
    for (const s of [...PROGRAM_STAGES, undefined]) {
      for (const t of [...PROGRAM_STAGES, undefined]) {
        const b = basis(s, t);
        expect(b.closing).toContain("expectations to confirm with QA");
        expect(`${b.statement} ${b.sourcePoint} ${b.targetPoint} ${b.closing}`).not.toMatch(/variation|prior[- ]approval|\bCBE\b|filing category/i);
      }
    }
  });

  it("gives a PPQ note per target stage, each to confirm with QA", () => {
    const note = (s: ProgramStage | undefined, t: ProgramStage | undefined) => activityStageNote("ppq", stageWordingFor(s, t));
    expect(note("clinical", "commercial")).toContain("typically a full PPQ");
    expect(note("commercial", "commercial")).toContain("depends on SU PPQ coverage");
    expect(note("commercial", "clinical")).toContain("not expected at a clinical RU");
    expect(note("commercial", "development")).toContain("not expected for development");
    expect(note("commercial", undefined)).toContain("which is TBD");
    for (const s of [...PROGRAM_STAGES, undefined]) for (const t of [...PROGRAM_STAGES, undefined]) expect(note(s, t)).toMatch(/Confirm with QA\.$/);
  });

  it("gives a process study its generic stage note (job L2: every activity is covered), and none when the stage is not set", () => {
    expect(activityStageNote("hold_time_study", stageWordingFor("clinical", "commercial"))).toMatch(/validated file/);
    expect(activityStageNote("hold_time_study", stageWordingFor("clinical", undefined))).toBeUndefined();
  });
});
