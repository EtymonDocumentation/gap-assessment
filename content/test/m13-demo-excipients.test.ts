// M13 job 4B: the excipient assessment in each demo. The demos are built through the same edit functions a person uses; every count here
// is computed from the stored lines, never typed. Fictional data only.
import { buildDemoProject, compareSpecRow, excipientAssessmentSummary, excipientOpenItems, specCounts } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos, designLoadouts, excipientClasses, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "../index";

const classKeys = new Set(excipientClasses.classes.map((c) => c.key));

for (const id of ["arx-217", "syr-305"] as const) {
  describe(`${id} demo excipient assessment`, () => {
    const project = buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });
    const assessment = project.excipients!.assessments[0]!;

    it("has one assessment of two or three lines, the first named EXA-001", () => {
      expect(project.excipients!.assessments).toHaveLength(1);
      expect(assessment.id).toBe("EXA-001");
      expect(assessment.lines.length).toBeGreaterThanOrEqual(2);
      expect(assessment.lines.length).toBeLessThanOrEqual(3);
    });

    it("uses classes and prompts that exist in the catalog", () => {
      for (const l of assessment.lines) {
        expect(classKeys.has(l.classKey ?? ""), l.name).toBe(true);
        const cls = excipientClasses.classes.find((c) => c.key === l.classKey)!;
        const prompts = new Set(cls.oftenCompared.map((p) => p.key));
        for (const row of l.specs) if (row.promptKey) expect(prompts.has(row.promptKey), `${l.name}: ${row.promptKey}`).toBe(true);
      }
    });

    it("shows a mix of Same, Different and Only at one site, plus a row not compared yet", () => {
      const results = new Set(assessment.lines.flatMap((l) => l.specs.map(compareSpecRow)));
      for (const r of ["same", "different", "only_sending", "not_compared"] as const) expect(results.has(r), r).toBe(true);
    });

    it("links one line to its TRD item and starts one risk item from a suggestion", () => {
      expect(assessment.lines.filter((l) => l.links.trdItem).length).toBeGreaterThanOrEqual(1);
      expect(assessment.lines.flatMap((l) => l.links.riskItems)).toHaveLength(1);
      const ref = assessment.lines.flatMap((l) => l.links.riskItems)[0]!;
      const risk = project.risk!.assessments.find((a) => a.id === ref.assessmentId)!;
      expect(risk.items.some((i) => i.id === ref.itemId)).toBe(true);
    });

    it("answers nearly everything and leaves a few deliberate gaps of different kinds, and the open-items count equals the list", () => {
      const items = excipientOpenItems(project, assessment);
      // A showcase demo reads as finished: 4 to 8 open items in total, not a page of them.
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items.length).toBeLessThanOrEqual(8);
      expect(new Set(items.map((i) => i.kind)).size).toBeGreaterThanOrEqual(3);
      expect(excipientAssessmentSummary(project, assessment).openItems).toBe(items.length);
    });

    it("fills the method of the specification tests that are stated", () => {
      const stated = assessment.lines.flatMap((l) => l.specs.flatMap((r) => [r.sending, r.receiving])).filter((s) => s.state === "stated");
      expect(stated.length).toBeGreaterThan(0);
      for (const s of stated) expect(s.method?.trim(), "a stated test names its method").toBeTruthy();
    });

    it("computes the comparison counts from the rows", () => {
      for (const l of assessment.lines) {
        const c = specCounts(l);
        const total = l.specs.length;
        expect(c.same + c.different + c.onlyAtOneSite + c.notCompared).toBe(total);
      }
    });
  });
}
