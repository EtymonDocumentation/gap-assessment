import { buildDemoProject, buildTrdDocument, buildTrdSeed, createMbr, createTrd, mbrOpenItems, progress, visibleInstances } from "@gap/engine";
import { emptyProject, type Project } from "@gap/process-model";
import { renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, failureModes, riskLoadouts, samplingSuggestions, trdWriteups } from "../../../content/index";
import { ACTOR, kit } from "../../engine/test/helpers";

/**
 * Walk-through fixes (rows 4 to 7): a TRD must not state facts nobody entered, a record with nothing in it must not read "Nothing open",
 * the TRD header names both of its counts, and an interview of "to be decided" answers must not read "complete".
 */
const AT = { name: "Alex Example (fictional)", at: "2026-10-01T09:00:00.000Z" };
const GEN = "2026-10-02T00:00:00.000Z";

function newProjectTrd(answers?: (p: Project) => Project) {
  let p = emptyProject({ title: "New (fictional)", actor: AT, contentRefs: content.versions });
  if (answers) p = answers(p);
  const seed = buildTrdSeed(content, p, { exportedAt: AT.at, appVersion: "t" });
  const r = createTrd(p, { title: "TRD new", start: { kind: "project", seed }, library: trdWriteups }, AT);
  const trd = r.project.trd.documents[0]!;
  return { project: r.project, trd, doc: buildTrdDocument(r.project, trd, { generatedAt: GEN, appVersion: "t", content }) };
}

const FACTS = [
  /The material must be protected from light/,
  /Vacuum-assisted stoppering is required/i,
  /dry ice/i,
  /frozen bottles/i,
  /Grade C or better/i,
  /Syringes are filled and stoppered in line/i,
  /aluminium seal/i,
  /filled syringes/i,
  /water for injection/i,
];

describe("a TRD from a project with nothing entered (row 5)", () => {
  const { doc } = newProjectTrd();
  const text = renderMarkdown(doc);

  it("states none of the product or process facts nobody entered", () => {
    for (const f of FACTS) expect(text, String(f)).not.toMatch(f);
  });
  it("shows each of them as a visible blank instead", () => {
    expect(text).toContain("[Whether the material must be protected from light during storage]");
    expect(text).toContain("[Air quality and grade for open manipulations]");
    expect(text).toContain("[Flush medium]");
    expect(text).toContain("[How filling and stoppering follow each other]");
  });
  it("has neither the syringe text nor the vial text when the presentation is unknown", () => {
    expect(text).not.toMatch(/Vacuum-assisted stoppering is required|\n#+ [0-9.]* ?Stopper position/);
    expect(text).not.toMatch(/Ready-to-fill syringe/);
  });
  it("leaves out the dilution buffer section when dilution is not established", () => {
    expect(text).not.toMatch(/Dilution buffer/);
  });
});

describe("dosage-form text appears only when that form was entered", () => {
  const { v } = kit;
  it("a vial gets the capping text and not the syringe text", () => {
    const { trd } = newProjectTrd((p) => v(p, "scope.presentation", "shared", "vial"));
    const ids = (trd.writeups ?? []).map((w) => w.libraryId);
    expect(ids).toContain("wu_capping");
    expect(ids).not.toContain("sec_stopper_position");
    expect(ids).not.toContain("sec_rtu_components");
  });
  it("a prefilled syringe gets the stopper position and not the capping text", () => {
    const { trd } = newProjectTrd((p) => v(p, "scope.presentation", "shared", "prefilled_syringe"));
    const ids = (trd.writeups ?? []).map((w) => w.libraryId);
    expect(ids).toContain("sec_stopper_position");
    expect(ids).toContain("sec_rtu_components");
    expect(ids).not.toContain("wu_capping");
  });
});

describe("the SYR-305 demo keeps its text (row 5)", () => {
  const project = buildDemoProject(content, demos["syr-305"], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, undefined, { writeups: trdWriteups });
  const text = renderMarkdown(buildTrdDocument(project, project.trd.documents[0]!, { generatedAt: GEN, appVersion: "t", content }));
  it("still says what its team entered", () => {
    for (const s of [
      "The material must be protected from light during storage. Where a risk",
      "Vacuum-assisted stoppering is required for this drug product program because of the stopper coating used",
      "Take care, because the shipping box may contain dry ice pellets.",
      "HEPA-filtered air of Grade C or better.",
      "Syringes are filled and stoppered in line.",
      "The filled syringes are stoppered in line with filling, using",
      "the filters are flushed with water for injection",
      "the filtered bioburden-reduced product is protected from light, as described in the formulation and manufacturing precautions section.",
      "Process hold steps: the quality control results are required before dilution starts.",
    ])
      expect(text, s).toContain(s);
  });
});

describe("the TRD header names both counts (row 6)", () => {
  it("says how many open items and how many blank fields", () => {
    const { doc } = newProjectTrd();
    const row = doc.meta.find((m) => m[0] === "Open items")!;
    expect(row[1]).toMatch(/^\d+, and \d+ blank fields in the text$/);
    expect(renderMarkdown(doc)).toMatch(/\d+ blank fields in the process descriptions have no value yet/);
  });
});

describe("a batch record with nothing in it (row 4)", () => {
  it("counts the missing purpose, the missing steps and the open items of its TRD", () => {
    const { project, trd } = newProjectTrd();
    const r = createMbr(project, { title: "MBR new", trdId: trd.id, sections: [] }, ACTOR);
    const rec = r.project.mbr.records[0]!;
    const kinds = mbrOpenItems(r.project, rec).map((o) => o.kind);
    expect(kinds).toContain("no_purpose");
    expect(kinds).toContain("no_sections");
    expect(kinds).toContain("trd_open");
  });
  it("counts a step that says its value is entered before issue", async () => {
    const { project, trd } = newProjectTrd();
    const r = createMbr(project, { title: "MBR new", trdId: trd.id, sections: [] }, ACTOR);
    const { addSection, addCustomBlock, addMbrStep } = await import("@gap/engine");
    const s = addSection(r.project, r.recordId, { title: "Storage" }, ACTOR);
    const b = addCustomBlock(s.project, r.recordId, s.sectionId, { title: "Shipping" }, ACTOR);
    const st = addMbrStep(b.project, r.recordId, b.blockId, "The shipping range is entered before the record is issued: {range}.", ACTOR);
    const items = mbrOpenItems(st.project, st.project.mbr.records[0]!);
    expect(items.map((o) => o.kind + ":" + o.text), JSON.stringify(st.project.mbr.records[0]!.sections)).toContain("before_issue:To be entered before issue");
  });
});

describe("interview progress with every answer to be decided (row 7)", () => {
  it("counts the answers as answered but not as done", () => {
    const { unk, newProject } = kit;
    let p = newProject();
    const insts = visibleInstances(content, p, "paired");
    for (const i of insts.filter((x) => x.section.id === insts[0]!.section.id)) p = unk(p, i.question.id, i.side);
    const sec = progress(content, p, visibleInstances(content, p, "paired")).find((s) => s.section.id === insts[0]!.section.id)!;
    expect(sec.answered).toBeGreaterThan(0);
    expect(sec.tbd).toBe(sec.answered);
  });
});
