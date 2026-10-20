import { assess, buildDemoProject, buildDocument, CATEGORIES, gapsToCsv } from "@gap/engine";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it } from "vitest";
import { content, demos } from "../index";

const project = buildDemoProject(content, demos["arx-217"]);
const a = assess(content, project);

describe("ARX-217 demo (golden)", () => {
  it("builds through the interview path with a source on every established entry", () => {
    expect(project.meta.demo).toBe(true);
    expect(project.answers.length).toBeGreaterThan(100);
    for (const s of project.sources) expect(s.type === "interview_answer" || s.type === "document_reference").toBe(true);
  });

  it("answers only visible questions and leaves nothing inactive", () => {
    expect(a.inactive).toEqual([]);
    const visible = new Set(a.instances.map((i) => i.key));
    for (const ans of project.answers) expect(visible.has(`${ans.questionId}@${ans.side}`)).toBe(true);
  });

  it("has no unanswered visible questions", () => {
    const answered = new Set(project.answers.map((x) => `${x.questionId}@${x.side}`));
    expect(a.instances.filter((i) => !answered.has(i.key)).map((i) => i.key)).toEqual([]);
  });

  it("exercises all eight categories", () => {
    const cats = new Set(a.gaps.map((g) => g.category));
    for (const c of CATEGORIES) expect(cats, c).toContain(c);
  });

  it("classifies the scripted changes as intended", () => {
    const by = (key: string) => a.gaps.find((g) => g.key === key);
    expect(by("R-BATCH-SIZE:uo.compounding.param.batch_size")).toMatchObject({ category: "scale_change", severity: "high" });
    expect(by("R-MIXING-COVERAGE:uo.compounding.study.mixing.coverage")?.category).toBe("outside_validated_range");
    expect(by("R-HOLD-TIME:uo.compounding.param.max_hold_time.max")?.category).toBe("outside_validated_range");
    expect(by("R-PARAM-RANGE:uo.compounding.param.mixing_speed")).toMatchObject({ category: "within_validated_range", activities: ["procedure_update"] });
    expect(by("R-PARAM-RANGE:uo.aseptic_filling.param.fill_volume")?.category).toBe("equivalent");
    expect(by("R-PARAM-RANGE:uo.aseptic_filling.param.line_speed")).toMatchObject({ category: "outside_validated_range", severity: "medium" });
    expect(by("R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple")).toMatchObject({
      category: "different_principle",
      owner: "MSAT lead (fictional)",
      status: "in_progress",
      regulatoryNote: "Requires regulatory affairs assessment.",
    });
    expect(by("R-SUA-PRESENCE:uo.sterile_filtration.mat.sua.present")?.category).toBe("new_requirement");
    expect(by("R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests#pupsit")).toMatchObject({ category: "removed_element", severity: "high" });
    expect(by("R-APS-COVERAGE:uo.aseptic_filling.study.aps.coverage")?.category).toBe("outside_validated_range");
    expect(by("R-PARAM-RANGE:uo.capping.param.rsf")?.category).toBe("information_required");
    expect(by("R-SITE-BARRIER:site.barrier")?.category).toBe("equivalent");
  });

  it("lists target unknowns as open items", () => {
    const refs = a.openItems.map((o) => o.ref);
    expect(refs).toContain("target.uo.capping.param.rsf.setPoint");
    expect(refs).toContain("target.uo.capping.study.rsf_cci_correlation.status");
  });

  it("never flags equivalent or information-required rows for regulatory assessment", () => {
    for (const g of a.gaps) {
      if (g.category === "equivalent" || g.category === "information_required") expect(g.regulatoryNote).toBeUndefined();
    }
  });

  it("renders the document to Markdown, HTML and the register to CSV", () => {
    const doc = buildDocument(content, project, a, "2026-10-02T00:00:00.000Z");
    expect(doc.title).toBe("Gap assessment: ARX-217 — Site North (fictional), Line 2 to Site South (fictional), Line 4");
    expect(doc.sections.map((s) => s.id)).toHaveLength(11);
    const md = renderMarkdown(doc);
    expect(md).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(md).toContain("DEMO-PPQ-217-01");
    expect(md).not.toMatch(/undefined|NaN|\[object Object\]/);
    const html = renderHtml(doc);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    const csv = gapsToCsv(content, a.gaps);
    expect(csv.split("\n")[0]).toContain("Category");
  });
});
