import { assess, buildDemoProject, buildTrdDocument, trdDocumentOpenItems, trdOpenItems, writeupBlanks, openFigures } from "@gap/engine";
import { describe, expect, it } from "vitest";
import { content, demos, trdWriteups } from "../index";

// The second demo: SYR-305, a fictional liquid mAb in a prefilled syringe made from frozen drug substance. Its TRD is complete on purpose, so
// a reviewer can see what a finished TRD reads like and an MBR can later be built from it.
const raw = demos["syr-305"];
const project = buildDemoProject(content, raw, undefined, undefined, undefined, undefined, { writeups: trdWriteups });
const doc = project.trd.documents[0]!;

describe("SYR-305 demo", () => {
  it("loads through the interview path and has no unanswered visible question", () => {
    expect(project.meta.demo).toBe(true);
    const a = assess(content, project);
    expect(a.inactive).toEqual([]);
    const answered = new Set(project.answers.map((x) => `${x.questionId}@${x.side}`));
    expect(a.instances.filter((i) => !answered.has(i.key)).map((i) => i.key)).toEqual([]);
  });

  it("has a TRD with no open item, no open blank and no open figure", () => {
    expect(trdOpenItems(doc)).toEqual([]);
    expect(trdDocumentOpenItems(doc)).toEqual([]);
    const ctx = { project, doc, content };
    for (const w of doc.writeups ?? []) {
      expect(writeupBlanks(ctx, w).filter((b) => !b.filled).map((b) => `${w.libraryId}:${b.key}`)).toEqual([]);
      expect(openFigures(w).map((f) => `${w.libraryId}:${f.id}`)).toEqual([]);
    }
  });

  it("shows the library's standard syringe barrel drawing in the exports, not a picture stored in the demo", () => {
    // The drawing is a built-in of the generator (a drawing id on the library part): pictures belong to one TRD, never to the shared library.
    expect(JSON.stringify(doc.writeups)).not.toContain("image/png");
    expect(JSON.stringify(buildTrdDocument(project, doc))).toContain("image/png");
  });

  it("follows the process in order, with catalog steps only", () => {
    const keys = doc.steps.map((s) => s.key);
    expect(keys).toEqual([
      "ds_shipping_inbound", "ds_receipt_thaw", "buffer_prep", "compounding", "bbr_filtration", "sterile_filtration",
      "aseptic_filling", "visual_inspection", "bulk_packaging", "labeling_packaging", "storage_shipping",
    ]);
  });

  it("exports a TRD document model", () => {
    const model = buildTrdDocument(project, doc);
    expect(JSON.stringify(model)).toContain("Example Fill Site (fictional)");
  });

  it("names only fictional people and companies and carries no client code or supplier brand", () => {
    const text = JSON.stringify(project) + JSON.stringify(buildTrdDocument(project, doc)) + JSON.stringify(raw);
    expect(text).not.toMatch(/CTP\d{4}|QC\d{4}|VV-IOPS|C2P2/);
    // every person or company named in the script says (fictional)
    for (const n of ["Alex Example", "Sam Example", "Robin Example", "Example Biologics", "Example Fill Site"]) {
      for (const m of text.matchAll(new RegExp(`${n}.{0,50}`, "g"))) expect(m[0], m[0]).toContain("(fictional");
    }
  });

  it("leaves the ARX-217 demo as it was", () => {
    const arx = buildDemoProject(content, demos["arx-217"]);
    expect(arx.meta.title).not.toContain("SYR-305");
    expect(Object.keys(demos)).toEqual(["arx-217", "syr-305"]);
  });
});
