import { describe, expect, it } from "vitest";
import { emptyProject, ImportError, parseProject, resolveEntry, SCHEMA_VERSION, type Actor, type Project } from "@gap/process-model";
import { buildDemoProject } from "@gap/engine";
import { content as realContent, demos } from "../../../content/index";

const T0 = "2026-10-01T09:00:00.000Z";
const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: T0 };

const empty = (): Project => emptyProject({ title: "Document state test (fictional)", actor: ACTOR, contentRefs: realContent.versions });
const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const REVISION = {
  number: 1,
  status: "draft",
  summary: "First draft for internal review",
  by: "A. Reviewer (fictional)",
  role: "MSAT lead (fictional)",
  at: "2026-10-05T09:00:00.000Z",
  fingerprint: "0123456789abcdef",
  template: { mode: "their_look", name: "Brightwater look (fictional)", version: "1.0", sha256: "ab".repeat(32), fileName: "brightwater.docx" },
};
const COMMENT = {
  seq: 1,
  anchor: { sectionId: "gap-table", gapKey: "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple" },
  by: "B. Checker (fictional)",
  role: "QA reviewer (fictional)",
  at: "2026-10-06T09:00:00.000Z",
  text: "Please check.",
  status: "resolved",
  replies: [{ kind: "resolution", by: "A. Reviewer (fictional)", at: "2026-10-06T09:45:00.000Z", text: "Done." }],
};
const EXPORT = {
  at: "2026-10-07T09:00:00.000Z",
  by: "Pat Placeholder (fictional)",
  format: "docx",
  template: { mode: "builtin", name: "Built-in default", version: "1.0.0" },
  revision: 1,
  fingerprint: "0123456789abcdef",
  changedSinceRevision: false,
};

/** A current-version file with a fully populated document block. */
const reviewed = () => {
  const raw = json(empty());
  raw.document = structuredClone({ revisions: [REVISION], comments: [COMMENT], exports: [EXPORT] });
  return raw;
};

const issuesOf = (raw: unknown): string[] => {
  try {
    parseProject(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).issues;
  }
  throw new Error("parseProject accepted a bad project");
};

describe("schema 1.3.0 and later: the document block", () => {
  it("is the current version, and a new project starts with an empty document block", () => {
    expect(SCHEMA_VERSION).toBe("1.9.0");
    const p = empty();
    expect(p.schemaVersion).toBe("1.9.0");
    expect(p.document).toEqual({ revisions: [], comments: [], exports: [] });
  });

  it("each new project gets its own arrays", () => {
    const a = empty();
    const b = empty();
    a.document.comments.push({ seq: 1, anchor: { sectionId: "scope" }, by: "x", at: T0, text: "t", status: "open", replies: [] });
    expect(b.document.comments).toHaveLength(0);
  });

  it("round-trips an empty project, a reviewed one and the demo through JSON", () => {
    const fresh = json(empty());
    expect(parseProject(fresh)).toEqual(fresh);
    const raw = reviewed();
    expect(parseProject(raw)).toEqual(raw);
    const demo = buildDemoProject(realContent, demos["arx-217"]);
    expect(demo.document.revisions).toHaveLength(1);
    expect(parseProject(json(demo))).toEqual(json(demo));
  });

  it("does not change the input it parses", () => {
    const raw = reviewed();
    const snapshot = JSON.stringify(raw);
    parseProject(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

describe("migration to 1.3.0", () => {
  const original = buildDemoProject(realContent, demos["arx-217"]);
  /** An older file: the demo as JSON, with no document block and an old version number. */
  const older = (version: string) => {
    const raw = json(original);
    raw.schemaVersion = version;
    delete raw.document;
    if (version === "1.0.0") delete raw.custom;
    return raw;
  };

  for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
    it(`reads a ${version} file and adds an empty document block`, () => {
      const p = parseProject(older(version));
      expect(p.schemaVersion).toBe("1.9.0");
      expect(p.document).toEqual({ revisions: [], comments: [], exports: [] });
      // Nothing else is touched: the change log, sources and entries are as they were.
      expect(p.changeLog).toEqual(original.changeLog);
      expect(p.sources).toEqual(original.sources);
      expect(p.processes).toEqual(original.processes);
      if (version === "1.0.0") expect(p.custom).toEqual({ unitOperations: [], items: [] });
    });
  }

  it("does not write anything into the change log for the migration", () => {
    const raw = older("1.2.0");
    const n = raw.changeLog.length;
    expect(parseProject(raw).changeLog).toHaveLength(n);
  });

  it("does not change the old file it was given", () => {
    const raw = older("1.2.0");
    const snapshot = JSON.stringify(raw);
    parseProject(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(raw.schemaVersion).toBe("1.2.0");
  });

  it("keeps a document block if an older file somehow has one", () => {
    const raw = reviewed();
    raw.schemaVersion = "1.2.0";
    expect(parseProject(raw).document.revisions).toHaveLength(1);
  });

  it("still refuses versions it does not know", () => {
    const raw = reviewed();
    raw.schemaVersion = "0.9.0";
    expect(() => parseProject(raw)).toThrow(/Unsupported schema version 0\.9\.0 \(this build reads 1.9.0\)/);
    raw.schemaVersion = "2.0.0";
    expect(() => parseProject(raw)).toThrow(/Unsupported schema version 2.0.0/);
  });

  it("a 1.5.0 file without a document block is refused with the field named", () => {
    const raw = json(empty());
    delete raw.document;
    expect(issuesOf(raw).join("\n")).toMatch(/document/);
  });
});

describe("migration to 1.4.0: the program stage", () => {
  const original = buildDemoProject(realContent, demos["arx-217"]);
  /** The demo as a 1.3.0 file: no stage answers, old version number. */
  const v13 = () => {
    const raw = json(original);
    raw.schemaVersion = "1.3.0";
    for (const side of ["source", "target"]) delete raw.processes[side].site.fields.programStage;
    raw.answers = raw.answers.filter((a: { questionId: string }) => a.questionId !== "site.stage");
    return raw;
  };

  it("reads a 1.3.0 project as the current version and inserts no stage value", () => {
    const p = parseProject(v13());
    expect(p.schemaVersion).toBe("1.9.0");
    for (const side of ["source", "target"] as const) {
      expect(p.processes[side].site.fields.programStage).toBeUndefined();
      expect(resolveEntry(p, `${side}.site.programStage`).status).toBe("not_established");
    }
  });

  it("leaves the rest of the project as it was", () => {
    const raw = v13();
    const p = parseProject(raw);
    expect(p.processes).toEqual(raw.processes);
    expect(p.changeLog).toEqual(raw.changeLog);
    expect(p.document).toEqual(raw.document);
  });

  it("runs the whole chain from 1.0.0, ending with the stage still unresolved", () => {
    const raw = v13();
    raw.schemaVersion = "1.0.0";
    delete raw.document;
    delete raw.custom;
    const p = parseProject(raw);
    expect(p.schemaVersion).toBe("1.9.0");
    expect(p.document).toEqual({ revisions: [], comments: [], exports: [] });
    expect(resolveEntry(p, "source.site.programStage").status).toBe("not_established");
    expect(resolveEntry(p, "target.site.programStage").status).toBe("not_established");
  });

  it("accepts a current project with answered stages and round-trips it", () => {
    const raw = json(original);
    expect(raw.schemaVersion).toBe("1.9.0");
    expect(parseProject(raw)).toEqual(raw);
    expect(resolveEntry(original, "source.site.programStage")).toMatchObject({ status: "established", value: "commercial" });
  });
});

describe("migration to 1.5.0: per-gap notes and omitted sections", () => {
  const original = buildDemoProject(realContent, demos["arx-217"]);
  /** The demo as a 1.4.0 file: no notes on gaps, no omitted sections. */
  const v14 = () => {
    const raw = json(original);
    raw.schemaVersion = "1.4.0";
    for (const o of raw.gapOverlays as Record<string, unknown>[]) delete o.notes;
    delete raw.document.omittedSections;
    return raw;
  };

  it("reads a 1.4.0 project as 1.5.0 and gives it no notes and no omitted sections", () => {
    const raw = v14();
    const p = parseProject(raw);
    expect(p.schemaVersion).toBe("1.9.0");
    for (const o of p.gapOverlays) expect(o.notes).toBeUndefined();
    expect(p.document.omittedSections).toBeUndefined();
  });

  it("changes nothing but the version number", () => {
    const raw = v14();
    const p = parseProject(raw);
    expect({ ...p, schemaVersion: "1.4.0" }).toEqual(raw);
  });

  it("runs the whole chain from 1.0.0 to the current version", () => {
    const raw = v14();
    raw.schemaVersion = "1.0.0";
    delete raw.document;
    delete raw.custom;
    for (const side of ["source", "target"]) delete raw.processes[side].site.fields.programStage;
    raw.answers = raw.answers.filter((a: { questionId: string }) => a.questionId !== "site.stage");
    const p = parseProject(raw);
    expect(p.schemaVersion).toBe("1.9.0");
    expect(p.document).toEqual({ revisions: [], comments: [], exports: [] });
  });

  it("round-trips omitted sections and a gap note", () => {
    const raw = json(original);
    raw.document.omittedSections = ["risk", "approval"];
    raw.gapOverlays[0].notes = "Note kept (fictional).";
    expect(parseProject(raw)).toEqual(raw);
  });

  it("refuses an omitted-sections list that is not a list of text", () => {
    const raw = json(original);
    raw.document.omittedSections = "risk";
    expect(() => parseProject(raw)).toThrow(ImportError);
  });
});

describe("invalid document data is rejected with a useful message", () => {
  const bad = (edit: (raw: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const raw = reviewed();
    edit(raw);
    return issuesOf(raw).join("\n");
  };

  it("a revision with no summary", () => {
    expect(bad((r) => (r.document.revisions[0].summary = "   "))).toMatch(/document\.revisions\.0\.summary: a revision needs a summary of the change/);
    expect(bad((r) => delete r.document.revisions[0].summary)).toMatch(/document\.revisions\.0\.summary/);
  });

  it("a revision status other than draft or issued for review (there is no approved)", () => {
    expect(bad((r) => (r.document.revisions[0].status = "approved"))).toMatch(/document\.revisions\.0\.status/);
  });

  it("a revision with a bad number, no author, no fingerprint or a bad template", () => {
    expect(bad((r) => (r.document.revisions[0].number = 0))).toMatch(/document\.revisions\.0\.number/);
    expect(bad((r) => (r.document.revisions[0].number = 1.5))).toMatch(/document\.revisions\.0\.number/);
    expect(bad((r) => (r.document.revisions[0].by = ""))).toMatch(/document\.revisions\.0\.by/);
    expect(bad((r) => delete r.document.revisions[0].fingerprint)).toMatch(/document\.revisions\.0\.fingerprint/);
    expect(bad((r) => (r.document.revisions[0].template.mode = "macro"))).toMatch(/document\.revisions\.0\.template\.mode/);
    expect(bad((r) => (r.document.revisions[0].template.name = " "))).toMatch(/document\.revisions\.0\.template\.name/);
  });

  it("two revisions with the same number", () => {
    expect(bad((r) => r.document.revisions.push(structuredClone(REVISION)))).toMatch(/Duplicate revision number 1/);
  });

  it("a comment with no text, a bad status or no anchor section", () => {
    expect(bad((r) => (r.document.comments[0].text = ""))).toMatch(/document\.comments\.0\.text: a comment needs text/);
    expect(bad((r) => (r.document.comments[0].status = "closed"))).toMatch(/document\.comments\.0\.status/);
    expect(bad((r) => (r.document.comments[0].anchor = {}))).toMatch(/document\.comments\.0\.anchor\.sectionId/);
    expect(bad((r) => (r.document.comments[0].anchor.gapKey = ""))).toMatch(/document\.comments\.0\.anchor\.gapKey/);
    expect(bad((r) => delete r.document.comments[0].replies)).toMatch(/document\.comments\.0\.replies/);
  });

  it("a comment number that is not a positive whole number", () => {
    expect(bad((r) => (r.document.comments[0].seq = 0))).toMatch(/document\.comments\.0\.seq/);
    expect(bad((r) => (r.document.comments[0].seq = -3))).toMatch(/document\.comments\.0\.seq/);
  });

  it("two comments with the same number", () => {
    expect(bad((r) => r.document.comments.push(structuredClone(COMMENT)))).toMatch(/Duplicate comment number 1/);
  });

  it("a reply with an unknown kind or no text", () => {
    expect(bad((r) => (r.document.comments[0].replies[0].kind = "approve"))).toMatch(/document\.comments\.0\.replies\.0\.kind/);
    expect(bad((r) => (r.document.comments[0].replies[0].text = " "))).toMatch(/document\.comments\.0\.replies\.0\.text: a response needs text/);
  });

  it("an export with an unknown format, a missing template or a missing flag", () => {
    expect(bad((r) => (r.document.exports[0].format = "pdf"))).toMatch(/document\.exports\.0\.format/);
    expect(bad((r) => delete r.document.exports[0].template)).toMatch(/document\.exports\.0\.template/);
    expect(bad((r) => delete r.document.exports[0].changedSinceRevision)).toMatch(/document\.exports\.0\.changedSinceRevision/);
  });

  it("a document block of the wrong shape", () => {
    expect(bad((r) => (r.document = []))).toMatch(/document/);
    expect(bad((r) => (r.document = { revisions: [], comments: [] }))).toMatch(/document\.exports/);
    expect(bad((r) => (r.document = { revisions: "none", comments: [], exports: [] }))).toMatch(/document\.revisions/);
  });

  it("accepts a revision or comment without the optional fields", () => {
    const raw = reviewed();
    delete raw.document.revisions[0].role;
    delete raw.document.revisions[0].template;
    delete raw.document.comments[0].role;
    delete raw.document.comments[0].anchor.gapKey;
    delete raw.document.exports[0].by;
    delete raw.document.exports[0].revision;
    expect(() => parseProject(raw)).not.toThrow();
  });
});
