import { assess, buildDemoProject, buildDocument, CATEGORIES, commentDisplayId, DOCUMENT_SECTION_IDS, documentFingerprint, gapsToCsv, revisionState, tbdItems, tbdSummary, verificationSummary } from "@gap/engine";
import { getEntry, removeSource, sourceUsage, verificationState } from "@gap/process-model";
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

  it("carries two TBD values: one with a best guess (a provisional gap) and one overdue without", () => {
    const items = tbdItems(content, project, a);
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.bestGuess !== undefined)).toHaveLength(1);
    expect(tbdSummary(items, "2026-10-21")).toMatchObject({ total: 2, overdue: 1 });
    expect(a.gaps.filter((g) => g.provisional)).toHaveLength(1);
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
    expect(by("R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status")).toMatchObject({ category: "removed_element", severity: "high" });
    expect(by("R-APS-COVERAGE:uo.aseptic_filling.study.aps.coverage")?.category).toBe("outside_validated_range");
    expect(by("R-PARAM-RANGE:uo.capping.param.rsf")?.category).toBe("information_required");
    expect(by("R-SITE-BARRIER:site.barrier")?.category).toBe("equivalent");
  });

  it("shows the dilution, buffer and BBR story of the new sections", () => {
    const by = (key: string) => a.gaps.find((g) => g.key === key);
    expect(getEntry(project, "scope.dilution")?.value).toBe(true);
    expect(getEntry(project, "source.uo.buffer_prep.mat.buffer.supplyRoute")?.value).toBe("prepared_on_site");
    expect(getEntry(project, "target.uo.buffer_prep.mat.buffer.supplyRoute")?.value).toBe("received_rtu");
    expect(by("R-BUFFER-ROUTE:uo.buffer_prep.mat.buffer.supplyRoute")).toMatchObject({ category: "different_principle", severity: "high" });
    expect(by("R-EV-BUFFER-SUPPLIER:uo.buffer_prep.mat.buffer.supplierQualification")?.category).toBe("outside_validated_range");
    expect(getEntry(project, "source.uo.bbr_filtration.presence")?.value).toBe(true);
    expect(getEntry(project, "target.uo.bbr_filtration.presence")?.value).toBe(true);
    expect(by("R-BBR-AREA:uo.bbr_filtration.mat.bbr_filter.area")?.category).toBe("scale_change");
    expect(by("R-BUFFER-BBR-PRESENCE:uo.buffer_prep.mat.buffer_bbr_filter.present")?.category).toBe("removed_element");
  });

  it("is a vial product, so the plunger stopper position questions stay hidden", () => {
    expect(a.instances.some((i) => i.question.id.startsWith("fill.stopper_") || i.question.id === "fill.headspace")).toBe(false);
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
    expect(doc.sections.map((s) => s.id)).toHaveLength(18);
    const md = renderMarkdown(doc);
    expect(md).toContain("Proof of concept. Not validated. Not for GMP use.");
    expect(md).toContain("DEMO-PPQ-217-01");
    expect(md).not.toMatch(/undefined|NaN|\[object Object\]/);
    const html = renderHtml(doc);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
    const csv = gapsToCsv(content, a.gaps, project);
    expect(csv.split("\n")[0]).toContain("Category");
  });

  describe("traceability (M4)", () => {
    const doc = buildDocument(content, project, a, "2026-10-02T00:00:00.000Z");
    const md = renderMarkdown(doc);
    const vs = verificationSummary(content, project);

    it("shows verified entries with the verifier, role and date", () => {
      expect(vs.all.verified).toBeGreaterThan(0);
      expect(md).toContain("Verified by A. Reviewer (fictional) (QA) on 2026-10-03");
    });

    it("has exactly one withdrawn verification, with its reason, and one self-verification", () => {
      expect(vs.all.withdrawn).toBe(1);
      expect(md).toContain("Verification withdrawn (value changed after verification); was verified by A. Reviewer (fictional) (QA) on 2026-10-03");
      expect(md).toContain("(same person as recorder)");
      expect(md.match(/same person as recorder/g)!.length).toBeGreaterThanOrEqual(2); // the entry row and the listing
    });

    it("carries the free-text identity statement and never claims electronic signatures", () => {
      expect(md).toMatch(/no login, authentication or electronic signature/);
      expect(md).toMatch(/not attributable in a GMP sense/);
    });

    it("has a Verification status section and appendices A to E after the approval section", () => {
      const ids = doc.sections.map((x) => x.id);
      expect(ids).toContain("verification-status");
      expect(ids.indexOf("verification-status")).toBeLessThan(ids.indexOf("source-register"));
      expect(doc.sections.filter((x) => x.appendix).map((x) => x.number)).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("lists the unused document reference in the source register", () => {
      const unused = sourceUsage(project).filter((u) => u.unused && u.source.type === "document_reference");
      expect(unused.length).toBeGreaterThanOrEqual(1);
      expect(md).toMatch(/DEMO-SOP-217-09.*\| Unused \|/);
    });

    it("adds verification columns to the gap register CSV", () => {
      const header = gapsToCsv(content, a.gaps, project).split(/\r?\n/)[0]!;
      expect(header).toContain("SU verification");
      expect(header).toContain("RU verification");
      expect(header).toContain("Notes");
    });

    it("removing the only source of a verified value reverts it and logs the revert", () => {
      const ref = project.changeLog.find((c) => c.action === "verify" && verificationState(project, c.path!).state === "verified" && getEntry(project, c.path!)!.sourceIds.length === 1)!.path!;
      const sid = getEntry(project, ref)!.sourceIds[0]!;
      const { project: after } = removeSource(project, sid, { name: "Sam Sample (fictional)", at: "2026-10-05T09:00:00.000Z" });
      expect(getEntry(after, ref)!.status).toBe("not_established");
      expect(verificationState(after, ref).state).not.toBe("verified");
      expect(after.changeLog.some((c) => c.action === "revert_on_source_removal" && c.path === ref)).toBe(true);
    });
  });

  describe("revision history and reviewer comments (M5)", () => {
    const doc = buildDocument(content, project, a, "2026-10-02T00:00:00.000Z");
    const md = renderMarkdown(doc);

    it("has revision 1 as a draft by the reviewer, still current because comments do not change the fingerprint", () => {
      expect(project.document.revisions).toHaveLength(1);
      expect(project.document.revisions[0]).toMatchObject({
        number: 1,
        status: "draft",
        summary: "First draft for internal review",
        by: "A. Reviewer (fictional)",
        role: "MSAT lead (fictional)",
        at: "2026-10-05T09:00:00.000Z",
      });
      const st = revisionState(project, doc);
      expect(st.latest?.number).toBe(1);
      expect(st.changedSinceIssue).toBe(false);
      expect(project.document.revisions[0]!.fingerprint).toBe(documentFingerprint(doc));
      expect(doc.meta.find(([k]) => k === "Revision")![1]).toBe("1 (Draft, 2026-10-05)");
      expect(md).toContain("- **Revision:** 1 (Draft, 2026-10-05)");
    });

    it("has three comments by the checker: one on a regulatory gap, one resolved on scope, one answered on the validation plan", () => {
      const cs = project.document.comments;
      expect(cs.map((c) => [commentDisplayId(c.seq), c.anchor.sectionId, c.status, c.replies.length])).toEqual([
        ["C-001", "gap-table", "open", 0],
        ["C-002", "scope", "resolved", 1],
        ["C-003", "validation-plan", "open", 1],
      ]);
      for (const c of cs) expect(c.by).toBe("B. Checker (fictional)");
      expect(cs[0]!.anchor.gapKey).toBe("R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple");
      expect(a.gaps.find((g) => g.key === cs[0]!.anchor.gapKey)?.regulatoryNote).toBe("Requires regulatory affairs assessment.");
      expect(cs[1]!.replies[0]).toMatchObject({ kind: "resolution", by: "A. Reviewer (fictional)" });
      expect(cs[2]!.replies[0]!.kind).toBe("reply");
    });

    it("shows the comments with their locations, including the gap's current ID", () => {
      const gapId = a.gaps.find((g) => g.key === project.document.comments[0]!.anchor.gapKey)!.displayId;
      expect(doc.comments.map((c) => c.anchorText)).toEqual([`6. Detailed gap table, ${gapId}`, "2. Scope", "7. Validation plan"]);
      expect(doc.comments[0]!.gapDisplayId).toBe(gapId);
      expect(md).toContain(`| C-001 | 6. Detailed gap table, ${gapId} |`);
      expect(md).toContain("| C-002 | 2. Scope |");
      expect(md).toContain("Resolution by A. Reviewer (fictional), 2026-10-06:");
      expect(md).toContain("Reply by Alex Example (fictional), 2026-10-06:");
      expect(md).toMatch(/revision is not an approval/);
    });

    it("lists the review events in the full change log but not in the document's change log summary", () => {
      const actions = project.changeLog.map((c) => c.action);
      expect(actions.filter((x) => x === "issue_revision")).toHaveLength(1);
      expect(actions.filter((x) => x === "add_comment")).toHaveLength(3);
      expect(actions).toContain("resolve_comment");
      expect(actions).toContain("reply_comment");
      const appendixB = doc.sections.find((s) => s.id === "change-log-summary")!;
      expect(JSON.stringify(appendixB)).not.toMatch(/Revision issued|Comment added/);
    });

    it("keeps the section id list in step with the sections the document builds", () => {
      expect(doc.sections.map((s) => s.id)).toEqual([...DOCUMENT_SECTION_IDS]);
    });
  });
});
