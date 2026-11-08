import { assess, buildDemoProject, setStepsExcluded, stepGroups, type Assessment } from "@gap/engine";
import { content, demos, designLoadouts, failureModes, mbrLibrary, riskLoadouts, samplingSuggestions, trdWriteups } from "@gap/content";
import { emptyProject, type DocumentExport, type Project } from "@gap/process-model";
import { describe, expect, it } from "vitest";
import { documentDownloadedNote, gapDocumentDownloaded, nextStep, scopeRecorded, stepDone } from "../src/next-step";

const blank = () => emptyProject({ title: "Test project", actor: { name: "Tester", at: "2026-01-01T00:00:00.000Z" }, contentRefs: content.versions });
const demo = (id: keyof typeof demos) =>
  buildDemoProject(content, demos[id], samplingSuggestions, designLoadouts, { loadouts: riskLoadouts, failureModes }, { library: mbrLibrary }, { writeups: trdWriteups });

describe("next step on the Home page", () => {
  it("offers the scope first on a fresh project, and shows no tick for it", () => {
    const p = blank();
    const a = assess(content, p);
    expect(scopeRecorded(p)).toBe(false);
    expect(nextStep(p, a)).toMatchObject({ path: "/scope", label: "Choose the scope" });
    expect(stepDone(p, a)).toEqual({});
  });

  it("offers the interview once the scope is recorded, with a count that follows the number of open questions", () => {
    let p = blank();
    const uo = stepGroups(content, p)[0]!.steps.find((s) => s.state === "included")!.uo;
    p = setStepsExcluded(content, p, [uo], true, undefined, { name: "Tester", at: "2026-01-02T00:00:00.000Z" });
    const a = assess(content, p);
    const n = nextStep(p, a);
    expect(n.path).toBe("/interview");
    expect(n.label).toMatch(/^Answer \d+ more questions?$/);
    expect(stepDone(p, a).scope).toBe(true);
    expect(stepDone(p, a).interview).toBeUndefined();
  });

  // EOU-09: a first-time tester answered one question and the step bar showed "Scope done", although the Scope step was never opened.
  it("does not tick the scope just because questions were answered; the next step still moves on to the interview", () => {
    const d = demo("syr-305");
    const p: Project = { ...d, stepScope: { ...d.stepScope, excluded: [] } };
    const a = assess(content, p);
    expect(scopeRecorded(p)).toBe(false);
    expect(stepDone(p, a).scope).toBeUndefined();
    // "Everything stays in scope" leaves no trace, so answered questions still mean the person has moved on from the Scope step.
    expect(nextStep(p, a).path).not.toBe("/scope");
  }, 30000);

  it("sends an opened demo to the gap register once every question is answered, and ticks the interview but never the register or document", () => {
    const p = demo("syr-305");
    const a = assess(content, p);
    const n = nextStep(p, a);
    // The demo's answers are replayed through the interview, so the interview is complete and the next step is the register.
    expect(n.path).toBe("/register");
    expect(stepDone(p, a).interview).toBe(true);
    expect(stepDone(p, a).register).toBeUndefined();
    expect(stepDone(p, a).document).toBeUndefined();
  }, 30000);
});

// Tester D row 14: the Document step read "done" after one download while 38 items were still open.
describe("the Document step after a download", () => {
  const exportOf = (format: DocumentExport["format"]): DocumentExport => ({
    at: "2026-01-03T00:00:00.000Z",
    format,
    template: { mode: "builtin", name: "Built-in default", version: "1" },
    fingerprint: "abc",
  });
  const withExport = (p: Project, format: DocumentExport["format"]): Project => ({ ...p, document: { ...p.document, exports: [exportOf(format)] } });

  it("is not done, and says how many items are open, when the document was downloaded with items still open", () => {
    const p = withExport(blank(), "docx");
    const a = assess(content, p);
    expect(a.openItems.length).toBeGreaterThan(0);
    expect(stepDone(p, a).document).toBeUndefined();
    expect(documentDownloadedNote(p, a)).toBe(`downloaded, ${a.openItems.length} open items`);
  });

  it("uses the singular for one open item", () => {
    const p = withExport(blank(), "html");
    const a = { ...assess(content, p) };
    a.openItems = a.openItems.slice(0, 1);
    expect(documentDownloadedNote(p, a as Assessment)).toBe("downloaded, 1 open item");
  });

  it("is done, with no note, once a download is recorded and nothing is open", () => {
    const p = withExport(blank(), "markdown");
    const a = { ...assess(content, p), openItems: [] } as Assessment;
    expect(stepDone(p, a).document).toBe(true);
    expect(documentDownloadedNote(p, a)).toBeUndefined();
  });

  it("has no note and no tick before any download", () => {
    const p = blank();
    const a = { ...assess(content, p), openItems: [] } as Assessment;
    expect(stepDone(p, a).document).toBeUndefined();
    expect(documentDownloadedNote(p, assess(content, p))).toBeUndefined();
  });

  it("ignores downloads of other documents (a TRD seed or a sampling plan says nothing about the gap assessment)", () => {
    const p = withExport(blank(), "sampling-plan-docx");
    const a = { ...assess(content, p), openItems: [] } as Assessment;
    expect(gapDocumentDownloaded(p)).toBe(false);
    expect(stepDone(p, a).document).toBeUndefined();
  });
});
