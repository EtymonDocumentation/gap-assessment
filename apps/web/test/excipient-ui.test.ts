import { addExcipientLine, createExcipientAssessment } from "@gap/engine";
import { content } from "@gap/content";
import { emptyProject } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { classText, factCell, factQuestionKey, openItemQuestionKey, questionStatus } from "../src/excipient-ui";
import { excipientOpenCount, openItemsCount } from "../src/open-count";

const actor = { name: "Tester", at: "2026-01-01T00:00:00.000Z" };

describe("excipient screens: small helpers", () => {
  it("shows every question state as an icon plus words, never colour alone", () => {
    for (const state of ["answered", "open", "tbd", "not_applicable", "same_as_sending"] as const) {
      const s = questionStatus({ state });
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
    expect(questionStatus({ state: "open" }).text).toBe("Open");
  });

  it("keeps an unknown fact visible as 'Not established' and counts it as open", () => {
    const c = factCell({ state: "open" } as never);
    expect(c).toMatchObject({ text: "Not established", open: true });
    expect(factCell({ state: "answered", current: "Acme (fictional)" } as never)).toMatchObject({ text: "Acme (fictional)", open: false });
    expect(factCell({ state: "tbd" } as never).open).toBe(true);
  });

  it("builds the question key of a fact the way the engine does", () => {
    expect(factQuestionKey("EXL-001", "supplier", "sending")).toBe("EXL-001/fact:supplier.sending");
    expect(factQuestionKey("EXL-001", "notes")).toBe("EXL-001/fact:notes");
    expect(openItemQuestionKey({ kind: "not_established", where: "", text: "", assessmentId: "EXA-001", lineId: "EXL-001", factKey: "origin", side: "receiving" })).toBe("EXL-001/fact:origin.receiving");
    expect(openItemQuestionKey({ kind: "not_compared", where: "", text: "", assessmentId: "EXA-001", lineId: "EXL-001", rowId: "EXR-001" })).toBeUndefined();
  });

  it("reads the class of a line in words, or nothing", () => {
    expect(classText({})).toBeUndefined();
    expect(classText({ classLabel: "my own words" })).toBe("my own words");
  });

  it("gives the one open count in the 'N open items' words", () => {
    let p = emptyProject({ title: "Test project", actor, contentRefs: content.versions });
    const made = createExcipientAssessment(p, { title: "Test excipients" }, actor);
    p = addExcipientLine(made.project, made.assessmentId, { name: "Excipient A (fictional)" }, actor).project;
    const a = p.excipients!.assessments[0]!;
    const n = excipientOpenCount(p, a);
    expect(n).toBeGreaterThan(0);
    expect(openItemsCount(n)).toBe(`${n} open items`);
    expect(openItemsCount(1)).toBe("1 open item");
  });
});
