// M13 job 1: schema 1.31.0 (excipient assessments), the 1.30.0 migration, the fact paths and the lookups that reach the facts.
// Fictional data only.
import { describe, expect, it } from "vitest";
import {
  EXCIPIENT_FACTS,
  EXCIPIENT_FORMAT_VERSION,
  EXCIPIENT_REGULATORY_SENTENCE,
  SCHEMA_VERSION,
  emptyProject,
  excipientFactDef,
  excipientFactPath,
  excipientStateSchema,
  getEntry,
  parseExcipientPath,
  parseProject,
  type Actor,
  type Entry,
  type Project,
} from "@gap/process-model";
import { content as realContent } from "../../../content/index";

const ACTOR: Actor = { name: "Alex Example (fictional)", role: "MSAT engineer", at: "2026-11-09T09:00:00.000Z" };
const empty = (): Project => emptyProject({ title: "Excipient schema test (fictional)", actor: ACTOR, contentRefs: realContent.versions });
const json = (p: unknown) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const entry = (path: string, over: Partial<Entry> = {}): Entry => ({ id: "ent_1", path, status: "established", value: "x", sourceIds: ["src_1"], recordedBy: ACTOR.name, recordedAt: ACTOR.at, revision: 1, ...over });
const line = (facts: Record<string, Entry> = {}) => ({
  id: "EXL-001",
  name: "Sodium chloride (fictional)",
  facts,
  specs: [],
  links: { gapIds: [], riskItems: [] },
  createdAt: ACTOR.at,
  updatedAt: ACTOR.at,
});
const assessment = (lines: unknown[] = []) => ({ id: "EXA-001", title: "Buffer excipients (fictional)", status: "draft", lines, createdAt: ACTOR.at, updatedAt: ACTOR.at });

describe("schema 1.31.0", () => {
  it("is schema 1.31.0 and a new project has an empty excipient part", () => {
    expect(SCHEMA_VERSION).toBe("1.31.0");
    expect(empty().excipients).toEqual({ assessments: [] });
    expect(EXCIPIENT_FORMAT_VERSION).toBe("1.0.0");
    expect(EXCIPIENT_REGULATORY_SENTENCE).toBe("Requires regulatory affairs assessment");
  });

  it("migrates a 1.30.0 project by adding an empty part and changes nothing else; twice gives the same", () => {
    const p = empty();
    const raw = json(p);
    raw.schemaVersion = "1.30.0";
    delete raw.excipients;
    const once = parseProject(raw);
    expect(once.schemaVersion).toBe("1.31.0");
    expect(once.excipients).toEqual({ assessments: [] });
    expect(parseProject(json(once))).toEqual(once);
    expect({ ...once, excipients: undefined }).toEqual({ ...p, excipients: undefined });
    expect(once.changeLog).toEqual(p.changeLog);
  });

  it("does not touch an excipient part that is already there, and does not change the file it was given", () => {
    const raw = json(empty());
    raw.schemaVersion = "1.30.0";
    raw.excipients = { assessments: [assessment()] };
    const before = JSON.stringify(raw);
    expect(parseProject(raw).excipients!.assessments).toHaveLength(1);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("an export record may carry a documentId, and an older record without one still reads", () => {
    const raw = json(empty());
    const rec = { at: ACTOR.at, by: ACTOR.name, format: "mbr-docx", template: { mode: "builtin", name: "Built-in default", version: "1.0.0" }, fingerprint: "0123456789abcdef", tbdCount: 0 };
    raw.document.exports = [{ ...rec, documentId: "mbr-1" }, rec];
    const p = parseProject(raw);
    expect(p.document.exports[0]!.documentId).toBe("mbr-1");
    expect(p.document.exports[1]!.documentId).toBeUndefined();
    raw.document.exports = [{ ...rec, documentId: "" }];
    expect(() => parseProject(raw)).toThrow();
  });

  it("refuses a malformed excipient part: a bad id, an empty name, both a class and own words, a fact under another path, a repeated row", () => {
    const parse = (a: unknown) => excipientStateSchema.safeParse({ assessments: [a] }).success;
    expect(parse(assessment([line()]))).toBe(true);
    expect(parse({ ...assessment(), id: "A1" })).toBe(false);
    expect(parse({ ...assessment(), title: "  " })).toBe(false);
    expect(parse({ ...assessment(), status: "approved" })).toBe(false);
    expect(parse(assessment([{ ...line(), classKey: "sugar", classLabel: "mine" }]))).toBe(false);
    expect(parse(assessment([line({ "excipient.EXA-001.EXL-001.supplier.sending": entry("excipient.EXA-001.EXL-001.supplier.receiving") })]))).toBe(false);
    expect(parse(assessment([line(), line()]))).toBe(false);
    const row = { id: "EXR-001", test: "Water", sending: { state: "open", sourceIds: [] }, receiving: { state: "open", sourceIds: [] } };
    expect(parse(assessment([{ ...line(), specs: [row, row] }]))).toBe(false);
  });

  it("a stored project with excipients survives a file round trip unchanged", () => {
    const p = empty();
    const path = "excipient.EXA-001.EXL-001.supplier.sending";
    p.excipients = { assessments: [assessment([line({ [path]: entry(path, { value: "Supplier One (fictional)" }) })]) as never] };
    expect(parseProject(json(p))).toEqual(p);
  });
});

describe("fact paths", () => {
  it("builds and parses the path of a fact, with and without a side", () => {
    expect(excipientFactPath("EXA-001", "EXL-002", "supplier", "receiving")).toBe("excipient.EXA-001.EXL-002.supplier.receiving");
    expect(excipientFactPath("EXA-001", "EXL-002", "amount")).toBe("excipient.EXA-001.EXL-002.amount");
    expect(parseExcipientPath("excipient.EXA-001.EXL-002.supplier.receiving")).toMatchObject({ assessmentId: "EXA-001", lineId: "EXL-002", key: "supplier", side: "receiving" });
    expect(parseExcipientPath("excipient.EXA-001.EXL-002.amount")).toMatchObject({ key: "amount" });
    expect(parseExcipientPath("excipient.EXA-001.EXL-002.amount")!.side).toBeUndefined();
    expect(parseExcipientPath("target.uo.x.y")).toBeUndefined();
    expect(parseExcipientPath("excipient.EXA-001.EXL-002.not_a_fact")).toBeUndefined();
  });

  it("every fact has a definition, unique keys, and a kind that matches its options and units", () => {
    const keys = EXCIPIENT_FACTS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of EXCIPIENT_FACTS) {
      expect(excipientFactDef(f.key)).toBe(f);
      if (f.kind === "choice" || f.kind === "multi_choice") expect(f.options?.length, f.key).toBeGreaterThan(0);
      else expect(f.options, f.key).toBeUndefined();
      if (f.kind === "quantity") expect(f.units?.length, f.key).toBeGreaterThan(0);
    }
  });

  it("getEntry reaches an excipient fact, and nothing else changes: an unknown path is still undefined", () => {
    const p = empty();
    const path = "excipient.EXA-001.EXL-001.supplier.sending";
    const e = entry(path);
    p.excipients = { assessments: [assessment([line({ [path]: e })]) as never] };
    expect(getEntry(p, path)).toBe(e);
    expect(getEntry(p, "excipient.EXA-001.EXL-001.supplier.receiving")).toBeUndefined();
    expect(getEntry(p, "excipient.EXA-009.EXL-001.supplier.sending")).toBeUndefined();
    expect(getEntry(empty(), path)).toBeUndefined();
  });
});
