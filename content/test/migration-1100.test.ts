// Migration 1.9.0 -> 1.10.0: the Scope step (project.stepScope) and the end of the review workflow. Old revisions and reviewer
// comments are archived, untouched, and not shown. All data are fictional.
import { assess, buildDemoProject, buildDocument } from "@gap/engine";
import { parseProject, SCHEMA_VERSION } from "@gap/process-model";
import { renderHtml, renderMarkdown } from "@gap/renderers";
import { describe, expect, it, vi } from "vitest";

// Assessing a whole demo twice is slow when the suite shares the machine.
vi.setConfig({ testTimeout: 30000 });
import { content, demos } from "../index";

const REVISION = {
  number: 2,
  status: "issued_for_review",
  summary: "Issued for review (fictional)",
  by: "A. Reviewer (fictional)",
  role: "MSAT lead (fictional)",
  at: "2026-10-05T09:00:00.000Z",
  fingerprint: "0123456789abcdef",
  tbdCount: 3,
  template: { mode: "their_look", name: "Brightwater look (fictional)", version: "1.0", sha256: "ab".repeat(32), fileName: "b.docx" },
};
const COMMENT = {
  seq: 7,
  anchor: { sectionId: "gap-table", gapKey: "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple" },
  by: "B. Checker (fictional)",
  at: "2026-10-06T09:00:00.000Z",
  text: "Is this a filing change? (fictional)",
  status: "resolved",
  replies: [{ kind: "resolution", by: "A. Reviewer (fictional)", at: "2026-10-06T09:45:00.000Z", text: "Raised with regulatory affairs (fictional)." }],
};

/** The demo as a 1.9.0 file that went through the review workflow. */
function oldFile() {
  const raw = JSON.parse(JSON.stringify(buildDemoProject(content, demos["arx-217"]))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw.schemaVersion = "1.9.0";
  delete raw.stepScope;
  raw.document = {
    revisions: [REVISION],
    comments: [COMMENT],
    exports: [{ at: "2026-10-07T09:00:00.000Z", format: "docx", template: REVISION.template, revision: 2, fingerprint: "0123456789abcdef", changedSinceRevision: true }],
  };
  raw.changeLog.push({ at: REVISION.at, by: REVISION.by, action: "issue_revision", path: "document.revisions.2", detail: "Revision 2" });
  return raw;
}

describe("migration 1.9.0 -> 1.10.0", () => {
  it("is the current schema version", () => {
    expect(SCHEMA_VERSION).toBe("1.20.0");
  });

  it("excludes nothing after the update: the project behaves as it did", () => {
    const p = parseProject(oldFile());
    expect(p.schemaVersion).toBe("1.20.0");
    expect(p.stepScope).toEqual({ excluded: [] });
    const before = buildDemoProject(content, demos["arx-217"]);
    expect(assess(content, p).gaps.map((g) => g.key)).toEqual(assess(content, before).gaps.map((g) => g.key));
  });

  it("archives revisions and comments untouched, and writes one change-log record about it", () => {
    const raw = oldFile();
    const p = parseProject(raw);
    expect(p.document.archivedReview?.revisions).toEqual([REVISION]);
    expect(p.document.archivedReview?.comments).toEqual([COMMENT]);
    expect("revisions" in p.document).toBe(false);
    expect("comments" in p.document).toBe(false);
    expect(p.changeLog).toHaveLength(raw.changeLog.length + 1);
    expect(p.changeLog.at(-1)).toMatchObject({ action: "archive_review", by: "System (file update)" });
    // The old change-log records stay as written.
    expect(p.changeLog.slice(0, raw.changeLog.length)).toEqual(raw.changeLog);
  });

  it("keeps the export history (the retired fields stay readable)", () => {
    const p = parseProject(oldFile());
    expect(p.document.exports).toHaveLength(1);
    expect(p.document.exports[0]).toMatchObject({ format: "docx", fingerprint: "0123456789abcdef" });
  });

  it("shows neither in the document, in any format", () => {
    const p = parseProject(oldFile());
    const doc = buildDocument(content, p, assess(content, p), "2026-10-08T00:00:00.000Z");
    expect(doc.sections.map((s) => s.id)).not.toContain("revision-history");
    expect(doc.sections.map((s) => s.id)).not.toContain("reviewer-comments");
    for (const out of [renderMarkdown(doc), renderHtml(doc)]) {
      expect(out).not.toMatch(/Revision history|Reviewer comments|Issued for review \(fictional\)|Is this a filing change/);
    }
  });

  it("round-trips the archive unchanged, and the second read changes nothing", () => {
    const first = parseProject(oldFile());
    const again = parseProject(JSON.parse(JSON.stringify(first)));
    expect(again).toEqual(first);
    expect(again.changeLog).toHaveLength(first.changeLog.length);
  });

  it("does not change the file it was given", () => {
    const raw = oldFile();
    const snapshot = JSON.stringify(raw);
    parseProject(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it("archives nothing, and logs nothing, for a project that never had a review", () => {
    const raw = oldFile();
    raw.document = { revisions: [], comments: [], exports: [] };
    raw.changeLog = raw.changeLog.slice(0, -1);
    const p = parseProject(raw);
    expect(p.document.archivedReview).toBeUndefined();
    expect(p.changeLog).toEqual(raw.changeLog);
  });
});
