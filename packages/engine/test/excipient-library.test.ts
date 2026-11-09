// M13 job 3: the excipient library's rules (versions, start from the library, update from the library, copy from the other site).
// Pure engine; fictional data only.
import { describe, expect, it } from "vitest";
import { addSource, excipientLibraryRecordSchema, emptyProject, type ExcipientLibraryRecord, type ExcipientSpecRow, type Project } from "@gap/process-model";
import {
  addExcipientLine,
  addLibraryLines,
  addSpecRow,
  applyLibraryChanges,
  compareLineToLibrary,
  copyFromOtherSite,
  copyableTests,
  createExcipientAssessment,
  editChangesRecord,
  editLibraryRecord,
  findLibraryMatch,
  libraryIdFor,
  libraryRecordFromLine,
  newLibraryRecord,
  specPickerText,
  updateSpecRow,
} from "@gap/engine";
import { ACTOR, content } from "./helpers";

const NOW = "2026-11-09T10:00:00.000Z";
const fresh = (): Project => emptyProject({ title: "Excipient library test (fictional)", actor: ACTOR, contentRefs: content.versions });
const withAssessment = (): Project => createExcipientAssessment(fresh(), { title: "Buffer excipients (fictional)" }, ACTOR).project;
const line = (p: Project, i = 0) => p.excipients!.assessments[0]!.lines[i]!;
const KEYS = ["surfactant", "sugar", "buffer_salt"];

const saved = (): ExcipientLibraryRecord =>
  newLibraryRecord("xl_surfactant_c", { name: "Surfactant C (fictional)", classKey: "surfactant", tests: [{ test: "Assay" }, { test: "Peroxide value", note: "Low is better here" }], prompts: ["Fatty acid composition"] }, NOW, "A. Reviewer (fictional)");

describe("records and versions", () => {
  it("a new record is version 1 with a checked shape and no history", () => {
    const r = saved();
    expect(r).toMatchObject({ id: "xl_surfactant_c", version: 1, name: "Surfactant C (fictional)", classKey: "surfactant" });
    expect(r.history).toBeUndefined();
    expect(excipientLibraryRecordSchema.safeParse(r).success).toBe(true);
  });

  it("makes ids from names that are unique and safe as file names", () => {
    expect(libraryIdFor("Sodium Chloride (fictional)", [])).toBe("xl_sodium_chloride_fictional");
    expect(libraryIdFor("Sodium Chloride (fictional)", ["xl_sodium_chloride_fictional"])).toBe("xl_sodium_chloride_fictional_2");
    expect(libraryIdFor("../../etc", [])).toMatch(/^xl_[a-z0-9_]+$/);
    expect(libraryIdFor("   ", [])).toBe("xl_excipient");
  });

  it("keeps a test once whatever the capitals, drops blank tests, and refuses a class together with own words", () => {
    const r = newLibraryRecord("xl_a", { name: " A ", tests: [{ test: "Assay" }, { test: " assay " }, { test: " " }] }, NOW, "x");
    expect(r.tests).toEqual([{ test: "Assay" }]);
    expect(r.name).toBe("A");
    expect(excipientLibraryRecordSchema.safeParse({ ...r, classKey: "sugar", classLabel: "mine" }).success).toBe(false);
    expect(excipientLibraryRecordSchema.safeParse({ ...r, id: "../x" }).success).toBe(false);
  });

  it("an edit makes the next version and keeps the whole earlier content; an unchanged save makes none", () => {
    const v1 = saved();
    expect(editChangesRecord(v1, { name: v1.name, classKey: "surfactant", tests: v1.tests, prompts: v1.prompts })).toBe(false);
    expect(editLibraryRecord(v1, { name: v1.name, classKey: "surfactant", tests: v1.tests, prompts: v1.prompts }, NOW, "y")).toBe(v1);
    const v2 = editLibraryRecord(v1, { name: v1.name, classKey: "surfactant", tests: [...v1.tests, { test: "Water content" }], prompts: v1.prompts }, "2026-11-10T10:00:00.000Z", "B. Reviewer (fictional)");
    expect(v2.version).toBe(2);
    expect(v2.tests).toHaveLength(3);
    expect(v2.history).toHaveLength(1);
    expect(v2.history![0]).toMatchObject({ version: 1, name: v1.name });
    expect(v2.history![0]!.tests).toHaveLength(2);
    const v3 = editLibraryRecord(v2, { name: "Surfactant C2 (fictional)", classLabel: "my role", tests: v2.tests, prompts: [] }, NOW, "y");
    expect(v3.version).toBe(3);
    expect(v3.history!.map((h) => h.version)).toEqual([1, 2]);
    expect(v3.classKey).toBeUndefined();
    expect(v3.classLabel).toBe("my role");
  });

  it("finds a saved excipient by name, any capitals", () => {
    expect(findLibraryMatch([saved()], "  surfactant c (FICTIONAL) ")?.id).toBe("xl_surfactant_c");
    expect(findLibraryMatch([saved()], "Other")).toBeUndefined();
    expect(findLibraryMatch([saved()], " ")).toBeUndefined();
  });

  it("makes a record from a line: name, class and tests with notes, never the values written in them", () => {
    let p = addExcipientLine(withAssessment(), "EXA-001", { name: "Surfactant C (fictional)", classKey: "surfactant" }, ACTOR).project;
    const row = addSpecRow(p, "EXA-001", "EXL-001", { test: "Assay", promptKey: "assay" }, ACTOR);
    p = updateSpecRow(row.project, "EXA-001", "EXL-001", row.rowId, { note: "per batch", sending: { criterion: "95.0 - 105.0", method: "HPLC" } }, ACTOR);
    const r = libraryRecordFromLine(line(p), "xl_surfactant_c", NOW, "x");
    expect(r.tests).toEqual([{ test: "Assay", promptKey: "assay", note: "per batch" }]);
    expect(JSON.stringify(r)).not.toContain("HPLC");
    expect(JSON.stringify(r)).not.toContain("95.0");
  });
});

describe("start from the library", () => {
  it("adds one line per chosen record with its name, class and tests; every value stays empty", () => {
    const r2 = newLibraryRecord("xl_sugar_b", { name: "Sugar B (fictional)", classLabel: "my sweetener", tests: [{ test: "Identification" }] }, NOW, "x");
    const { project, lineIds } = addLibraryLines(withAssessment(), "EXA-001", [saved(), r2], ACTOR, { classKeys: KEYS });
    expect(lineIds).toEqual(["EXL-001", "EXL-002"]);
    expect(line(project, 0)).toMatchObject({ name: "Surfactant C (fictional)", classKey: "surfactant" });
    expect(line(project, 0).specs.map((s) => [s.test, s.note, s.sending.state, s.receiving.state])).toEqual([
      ["Assay", undefined, "open", "open"],
      ["Peroxide value", "Low is better here", "open", "open"],
    ]);
    expect(line(project, 0).facts).toEqual({});
    expect(line(project, 1)).toMatchObject({ name: "Sugar B (fictional)", classLabel: "my sweetener" });
    expect(line(project, 1).classKey).toBeUndefined();
    // The project keeps no link to the record.
    expect(JSON.stringify(project)).not.toContain("xl_surfactant_c");
  });

  it("starts without a class when the saved class has left the class list", () => {
    const { project } = addLibraryLines(withAssessment(), "EXA-001", [saved()], ACTOR, { classKeys: ["sugar"] });
    expect(line(project).classKey).toBeUndefined();
    expect(line(project).classLabel).toBeUndefined();
  });
});

describe("update from the library", () => {
  const start = (): Project => addLibraryLines(withAssessment(), "EXA-001", [saved()], ACTOR, { classKeys: KEYS }).project;
  const newer = (): ExcipientLibraryRecord => editLibraryRecord(saved(), { name: "Surfactant C (fictional), grade 2", classKey: "sugar", tests: [...saved().tests.map((t) => (t.test === "Peroxide value" ? { ...t, note: "Newer note" } : t)), { test: "Water content" }], prompts: [] }, NOW, "y");

  it("lists what differs: name, role, a note that differs and a test the line lacks; nothing for tests only the line has", () => {
    let p = start();
    p = addSpecRow(p, "EXA-001", "EXL-001", { test: "My own test" }, ACTOR).project;
    const changes = compareLineToLibrary(line(p), newer(), (k) => k);
    expect(changes.map((c) => c.key)).toEqual(["name", "class", "note:peroxide value", "test:water content"]);
    expect(changes.find((c) => c.key === "class")).toMatchObject({ mine: "surfactant", library: "sugar" });
    expect(compareLineToLibrary(line(p), saved())).toEqual([]);
  });

  it("applies only the chosen changes and leaves everything else, including the values written in the rows", () => {
    let p = start();
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { criterion: "95.0 - 105.0", method: "HPLC" } }, ACTOR);
    const before = JSON.stringify(line(p).specs[0]);
    const out = applyLibraryChanges(p, "EXA-001", "EXL-001", newer(), ["test:water content", "note:peroxide value"], ACTOR, { classKeys: KEYS });
    expect(line(out).name).toBe("Surfactant C (fictional)");
    expect(line(out).classKey).toBe("surfactant");
    expect(line(out).specs.map((s) => s.test)).toEqual(["Assay", "Peroxide value", "Water content"]);
    expect(line(out).specs[1]!.note).toBe("Newer note");
    expect(JSON.stringify(line(out).specs[0])).toBe(before);
    const all = applyLibraryChanges(p, "EXA-001", "EXL-001", newer(), compareLineToLibrary(line(p), newer()).map((c) => c.key), ACTOR, { classKeys: KEYS });
    expect(line(all)).toMatchObject({ name: "Surfactant C (fictional), grade 2", classKey: "sugar" });
    expect(compareLineToLibrary(line(all), newer())).toEqual([]);
  });

  it("choosing nothing changes nothing", () => {
    const p = start();
    expect(applyLibraryChanges(p, "EXA-001", "EXL-001", newer(), [], ACTOR)).toEqual(p);
  });
});

describe("copy from the other site", () => {
  const row = (over: Partial<ExcipientSpecRow>): ExcipientSpecRow => ({
    id: "EXR-001",
    test: "Assay",
    sending: { state: "stated", criterion: "95.0 - 105.0", method: "HPLC", unit: "%", sourceIds: [] },
    receiving: { state: "open", sourceIds: [] },
    ...over,
  });

  it("fills the empty boxes of the other side and nothing else", () => {
    expect(copyFromOtherSite(row({}), "receiving")).toEqual({ method: "HPLC", criterion: "95.0 - 105.0", unit: "%" });
    // A method already written stays; the criterion and unit still come across.
    expect(copyFromOtherSite(row({ receiving: { state: "open", method: "Titration", sourceIds: [] } }), "receiving")).toEqual({ criterion: "95.0 - 105.0", unit: "%" });
    // A criterion already stated is never replaced.
    expect(copyFromOtherSite(row({ receiving: { state: "stated", criterion: "98 - 102", method: "HPLC", unit: "%", sourceIds: [] } }), "receiving")).toBeUndefined();
    // A test the person marked as not in that specification is left as it is.
    expect(copyFromOtherSite(row({ receiving: { state: "not_tested", sourceIds: [] } }), "receiving")).toBeUndefined();
    // Nothing to copy from an open side.
    expect(copyFromOtherSite(row({ sending: { state: "open", sourceIds: [] } }), "receiving")).toBeUndefined();
  });

  it("carries the cited documents with their places when this side cites none, and the result applies cleanly", () => {
    let p = addExcipientLine(withAssessment(), "EXA-001", { name: "A (fictional)" }, ACTOR).project;
    p = addSource(p, { type: "document_reference", docRef: { docType: "Specification", identifier: "SPEC-1 (fictional)" } }, ACTOR).project;
    const srcId = p.sources[0]!.id;
    const added = addSpecRow(p, "EXA-001", "EXL-001", { test: "Assay" }, ACTOR);
    p = updateSpecRow(added.project, "EXA-001", "EXL-001", added.rowId, { sending: { criterion: "NMT 5", sourceIds: [srcId], sourceLocations: { [srcId]: { section: "4.2", page: "3" } } } }, ACTOR);
    const patch = copyFromOtherSite(line(p).specs[0]!, "receiving")!;
    expect(patch.sourceIds).toEqual([srcId]);
    p = updateSpecRow(p, "EXA-001", "EXL-001", added.rowId, { receiving: patch }, ACTOR);
    expect(line(p).specs[0]!.receiving).toMatchObject({ state: "stated", criterion: "NMT 5", sourceIds: [srcId], sourceLocations: { [srcId]: { section: "4.2", page: "3" } } });
    expect(copyableTests(line(p), "receiving")).toBe(0);
    expect(copyableTests(line(p), "sending")).toBe(0);
  });
});

describe("the picker text", () => {
  it("names the excipient with its number of tests, how many differ and how many are not compared yet", () => {
    let p = addExcipientLine(withAssessment(), "EXA-001", { name: "A (fictional)" }, ACTOR).project;
    expect(specPickerText("A (fictional)", line(p))).toBe("A (fictional) (no tests yet)");
    for (const t of ["Assay", "pH"]) p = addSpecRow(p, "EXA-001", "EXL-001", { test: t }, ACTOR).project;
    p = updateSpecRow(p, "EXA-001", "EXL-001", "EXR-001", { sending: { criterion: "5" }, receiving: { criterion: "6" } }, ACTOR);
    expect(specPickerText("A (fictional)", line(p))).toBe("A (fictional) (2 tests, 1 differ, 1 not compared)");
  });
});
