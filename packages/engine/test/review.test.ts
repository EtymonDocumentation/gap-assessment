import { describe, expect, it } from "vitest";
import { parseProject, type DocumentExport, type Project, type TemplateRecord } from "@gap/process-model";
import {
  assess,
  buildDocument,
  documentFingerprint,
  omittedSectionIds,
  OPTIONAL_SECTIONS,
  recordExport,
  ReviewError,
  SECTION_CHOICES,
  setOmittedSections,
  type DocModel,
} from "@gap/engine";
import { content, kit } from "./helpers";

const { base, pair, v } = kit;

const PUMP_KEY = "R-FILL-PUMP:uo.aseptic_filling.equip.filler.operatingPrinciple";
const GEN = "2026-10-20T08:00:00.000Z";
const GEN2 = "2026-10-21T17:45:00.000Z";

/** A small project with one real gap (the filling pump principle). */
const project = (): Project => pair(base(), "fill.pump", "rotary_piston", "peristaltic");
const docOf = (p: Project, generated = GEN): DocModel => buildDocument(content, p, assess(content, p), generated);

const BUILTIN: TemplateRecord = { mode: "builtin", name: "Built-in default", version: "1.0.0" };

/** Strict deep-freeze, to prove that no function writes into the project it was given. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze((o as Record<string, unknown>)[k]);
    Object.freeze(o);
  }
  return o;
}

const msg = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ReviewError);
    return (e as Error).message;
  }
  throw new Error("expected the call to throw");
};

describe("documentFingerprint", () => {
  it("is 16 hex digits and the same for the same document", () => {
    const p = project();
    const f = documentFingerprint(docOf(p));
    expect(f).toMatch(/^[0-9a-f]{16}$/);
    expect(documentFingerprint(docOf(p))).toBe(f);
    expect(documentFingerprint(docOf(structuredClone(p)))).toBe(f);
  });

  it("ignores the Generated time", () => {
    const p = project();
    expect(documentFingerprint(docOf(p, GEN))).toBe(documentFingerprint(docOf(p, GEN2)));
    expect(docOf(p, GEN).meta.find(([k]) => k === "Generated")![1]).not.toBe(docOf(p, GEN2).meta.find(([k]) => k === "Generated")![1]);
  });

  it("changes when a recorded value changes", () => {
    const p = project();
    const changed = v(p, "fill.pump", "target", "rotary_piston");
    expect(documentFingerprint(docOf(changed))).not.toBe(documentFingerprint(docOf(p)));
  });

  it("changes when a gap decision (owner or status) changes the document", () => {
    const p = project();
    const f = documentFingerprint(docOf(p));
    const q = structuredClone(p);
    q.gapOverlays.push({ gapKey: PUMP_KEY, status: "in_progress", owner: "Owner (fictional)" });
    expect(documentFingerprint(docOf(q))).not.toBe(f);
  });

  it("changes when the title, banner, status, other meta rows or any section changes", () => {
    const d = docOf(project());
    const f = documentFingerprint(d);
    expect(documentFingerprint({ ...d, title: d.title + "!" })).not.toBe(f);
    expect(documentFingerprint({ ...d, banner: d.banner + "!" })).not.toBe(f);
    expect(documentFingerprint({ ...d, status: "FINAL" })).not.toBe(f);
    expect(documentFingerprint({ ...d, meta: d.meta.map(([k, x]) => (k === "Project" ? [k, x + "!"] : [k, x])) as [string, string][] })).not.toBe(f);
    const edited = structuredClone(d);
    const sec = edited.sections.find((s) => s.id === "purpose")!;
    sec.blocks = [{ type: "paragraph", text: "Different." }];
    expect(documentFingerprint(edited)).not.toBe(f);
  });

  it("is not fooled by moving text between table cells", () => {
    const d = docOf(project());
    const a: DocModel = { ...d, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A", "B"], rows: [["ab", "c"]] }] }] };
    const b: DocModel = { ...d, sections: [{ id: "x", number: "1", title: "T", blocks: [{ type: "table", columns: ["A", "B"], rows: [["a", "bc"]] }] }] };
    expect(documentFingerprint(a)).not.toBe(documentFingerprint(b));
  });

  it("handles non-ASCII text", () => {
    const d = docOf(project());
    const a = documentFingerprint({ ...d, title: "Gap — é" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(documentFingerprint({ ...d, title: "Gap — e" }));
  });
});

describe("optional document sections", () => {
  it("lists every section once, and the optional ones match OPTIONAL_SECTIONS", () => {
    const ids = SECTION_CHOICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SECTION_CHOICES.filter((s) => s.optional).map((s) => s.id)).toEqual(OPTIONAL_SECTIONS.map((s) => s.id));
    // Purpose, scope, the SU and RU summaries, the gap table and the open items can never be left out.
    for (const id of ["purpose", "scope", "source-summary", "target-summary", "gap-table", "open-items"]) {
      expect(SECTION_CHOICES.find((s) => s.id === id)?.optional).toBe(false);
    }
  });

  it("stores the choice without a change-log entry and refuses sections that must stay", () => {
    const p0 = deepFreeze(project());
    const p = setOmittedSections(p0, ["risk", "approval"]);
    expect(omittedSectionIds(p)).toEqual(["risk", "approval"]);
    expect(p.changeLog).toEqual(p0.changeLog);
    expect(msg(() => setOmittedSections(p0, ["gap-table"]))).toMatch(/cannot be left out/);
    expect(omittedSectionIds(setOmittedSections(p, []))).toEqual([]);
  });

  it("leaves the omitted sections out of the document and says so", () => {
    const p = setOmittedSections(project(), ["risk"]);
    const d = docOf(p);
    expect(d.sections.some((s) => s.id === "risk")).toBe(false);
    expect(docOf(project()).sections.some((s) => s.id === "risk")).toBe(true);
    expect(d.meta.find(([k]) => k === "Sections omitted")![1]).toBe("Risk ranking");
    expect(documentFingerprint(d)).not.toBe(documentFingerprint(docOf(project())));
  });
});

describe("recordExport", () => {
  const rec = (over: Partial<DocumentExport> = {}): DocumentExport => ({
    at: GEN,
    by: "Pat Placeholder (fictional)",
    format: "docx",
    template: { mode: "their_look", name: "Brightwater look (fictional)", version: "1.0", sha256: "cd".repeat(32), fileName: "b.docx" },
    fingerprint: "0123456789abcdef",
    tbdCount: 3,
    ...over,
  });

  it("appends the record without adding a change-log entry", () => {
    const p0 = project();
    const p = recordExport(recordExport(p0, rec()), rec({ format: "markdown", template: BUILTIN, fingerprint: "fedcba9876543210" }));
    expect(p.document.exports).toHaveLength(2);
    expect(p.document.exports[0]).toEqual(rec());
    expect(p.document.exports[1]).toMatchObject({ format: "markdown", tbdCount: 3 });
    expect(p.changeLog).toEqual(p0.changeLog);
  });

  it("works out whether the answers changed since the previous download from the fingerprints", () => {
    let p = recordExport(project(), rec());
    expect(p.document.exports[0]!.changedSincePrevious).toBeUndefined();
    p = recordExport(p, rec({ format: "html", template: BUILTIN }));
    expect(p.document.exports[1]!.changedSincePrevious).toBe(false);
    p = recordExport(p, rec({ fingerprint: "ffffffffffffffff" }));
    expect(p.document.exports[2]!.changedSincePrevious).toBe(true);
  });

  it("keeps the sections left out at download time, taken from the project when the record does not say", () => {
    const p0 = setOmittedSections(project(), ["risk", "references"]);
    expect(recordExport(p0, rec()).document.exports[0]!.omittedSections).toEqual(["risk", "references"]);
    expect(recordExport(p0, rec({ omittedSections: [] })).document.exports[0]!.omittedSections).toBeUndefined();
    expect(recordExport(project(), rec()).document.exports[0]!.omittedSections).toBeUndefined();
  });

  it("does not change the project it was given or keep a reference to the record", () => {
    const p0 = deepFreeze(project());
    const r = rec();
    const p = recordExport(p0, r);
    expect(p0.document.exports).toHaveLength(0);
    r.template.name = "changed";
    expect(p.document.exports[0]!.template.name).toBe("Brightwater look (fictional)");
  });

  it("does not change the document fingerprint", () => {
    const p0 = project();
    expect(documentFingerprint(docOf(recordExport(p0, rec())))).toBe(documentFingerprint(docOf(p0)));
  });

  it("refuses an unknown format, a missing fingerprint and a nameless template", () => {
    const p0 = project();
    expect(msg(() => recordExport(p0, rec({ format: "pdf" as never })))).toMatch(/format/i);
    expect(msg(() => recordExport(p0, rec({ fingerprint: "" })))).toMatch(/fingerprint/i);
    expect(msg(() => recordExport(p0, rec({ template: { mode: "builtin", name: "", version: "1" } })))).toMatch(/template/i);
  });
});

describe("the document has no review workflow", () => {
  it("has no Revision line, no revision history and no reviewer comments", () => {
    const d = docOf(project());
    expect(d.meta.some(([k]) => k === "Revision")).toBe(false);
    expect(d.sections.some((s) => /revision history|reviewer comments/i.test(s.title))).toBe(false);
    expect("revisions" in d).toBe(false);
    expect("comments" in d).toBe(false);
  });
});

describe("a project with exports survives a file round trip", () => {
  it("keeps the export records", () => {
    let p = project();
    p = recordExport(p, { at: GEN, format: "docx", template: BUILTIN, fingerprint: documentFingerprint(docOf(p)), tbdCount: 0 });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it("the project used here starts with no exports and an empty scope", () => {
    expect(project().document).toEqual({ exports: [] });
    expect(project().stepScope).toEqual({ excluded: [] });
    expect(project().schemaVersion).toBe("1.19.0");
  });
});
