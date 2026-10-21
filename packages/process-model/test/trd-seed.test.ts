import { describe, expect, it } from "vitest";
import { TRD_SEED_FORMAT, TRD_SEED_VERSION, TrdSeedError, parseTrdSeed, type TrdSeed } from "../src/index";

const established = { status: "established" as const, value: "x", display: "x" };
const field = (over: Record<string, unknown> = {}) => ({
  path: "uo.a.param.p.setPoint",
  field: "setPoint",
  label: "Set point",
  ...established,
  sourceIds: [],
  verification: "unverified",
  ...over,
});
const seed = (fields: unknown[] = [field()]): unknown => ({
  meta: {
    format: TRD_SEED_FORMAT,
    formatVersion: TRD_SEED_VERSION,
    exportedAt: "2026-10-21T08:00:00.000Z",
    generator: { name: "test", version: "0.0.0" },
    processModelVersion: "1.0.0",
    contentVersions: { catalog: "1.7.0" },
    projectSchemaVersion: "1.10.0",
    project: { id: "p", name: "Test (fictional)" },
    product: { program: established, modality: established, dosageForm: established, presentation: established },
    receivingSite: { name: established, line: established, programStage: established },
    gapAssessment: { documentFingerprint: "abc" },
  },
  scope: { included: [], excluded: [], notApplicable: [], topicsLeftOut: [] },
  site: { fields: [] },
  unitOperations: [{ key: "a", label: "A", sequence: 1, custom: false, fields, items: [] }],
  sources: [],
});
const fail = (s: unknown): string => {
  try {
    parseTrdSeed(s);
  } catch (e) {
    expect(e).toBeInstanceOf(TrdSeedError);
    return (e as Error).message;
  }
  throw new Error("expected parseTrdSeed to throw");
};

describe("parseTrdSeed", () => {
  it("reads a valid seed from an object or JSON text", () => {
    const s: TrdSeed = parseTrdSeed(seed());
    expect(s.meta.format).toBe("gap-assessment.trd-seed");
    expect(parseTrdSeed(JSON.stringify(seed()))).toEqual(s);
  });

  it("refuses other documents, other major versions and bad JSON", () => {
    expect(fail("{nope")).toMatch(/not valid JSON/);
    expect(fail({ meta: { format: "something.else" } })).toMatch(/Not a TRD seed/);
    const other = seed() as { meta: { formatVersion: string } };
    other.meta.formatVersion = "2.0.0";
    expect(fail(other)).toMatch(/supports TRD seed format 1\.x/);
  });

  it("accepts a newer minor version", () => {
    const s = seed() as { meta: { formatVersion: string } };
    s.meta.formatVersion = "1.4.0";
    expect(() => parseTrdSeed(s)).not.toThrow();
  });

  it("enforces no defaults: a not established field carries no value", () => {
    expect(fail(seed([field({ status: "not_established" })]))).toMatch(/must not carry a value/);
    expect(() => parseTrdSeed(seed([field({ status: "not_established", value: undefined, display: undefined })]))).not.toThrow();
  });

  it("requires an established field to have a value", () => {
    expect(fail(seed([field({ value: undefined })]))).toMatch(/needs a value/);
  });

  it("allows a value on a TBD field only when it is marked provisional", () => {
    expect(fail(seed([field({ status: "tbd", tbd: {} })]))).toMatch(/provisional/);
    expect(() => parseTrdSeed(seed([field({ status: "tbd", provisional: true, tbd: { owner: "O" } })]))).not.toThrow();
    expect(fail(seed([field({ status: "tbd", provisional: true, value: undefined, tbd: {} })]))).toMatch(/needs the best guess/);
  });

  it("does not let an established field be provisional or carry TBD details", () => {
    expect(fail(seed([field({ provisional: true })]))).toMatch(/Only a TBD answer can be provisional/);
    expect(fail(seed([field({ tbd: { owner: "O" } })]))).toMatch(/belong to a TBD answer/);
  });

  it("rejects an unknown verification state", () => {
    expect(fail(seed([field({ verification: "approved" })]))).toMatch(/verification/);
  });
});
