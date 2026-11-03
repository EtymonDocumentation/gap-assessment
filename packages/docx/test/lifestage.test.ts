// Life stage, job L1: the Word header repeats the project stage on pages 2 onward (never on the cover), the cover has a Project stage
// row, and the template tag projectStage carries the same text.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocx } from "../src/index";
import { COVER_LABELS } from "../src/front";
import { headerTitleLine } from "../src/builtin";
import { GENERATED_AT, buildModel } from "./fixtures";
import { plainText, strictDocx } from "./strict";

const model = buildModel();

async function render(stageShort: string, targetStage: string) {
  const doc = { ...model.doc, cover: { ...model.doc.cover, stageShort, targetStage } };
  const out = await renderDocx({ doc, tagData: { ...model.tagData, projectStage: targetStage }, mode: "builtin", generatedAt: GENERATED_AT });
  return strictDocx(out.bytes);
}

describe("Word header and cover show the project stage", () => {
  for (const [short, long] of [
    ["Engineering", "Engineering / development runs"],
    ["Clinical", "Clinical batches (GMP, not process-validated)"],
    ["PPQ", "PPQ batches (process performance qualification)"],
    ["Commercial", "Commercial batches (process validated)"],
    ["not set", "[not established]"],
  ] as const) {
    it(`for ${short}`, async () => {
      const res = await render(short, long);
      const header = plainText(res, "word/header1.xml");
      expect(header).toContain(`Project stage: ${short}`);
      // Page 1 (the cover) has no header of its own: only the default header, shown from page 2, carries the line.
      expect(res.text("word/document.xml")).toContain("<w:titlePg/>");
      expect(res.text("word/document.xml")).not.toMatch(/headerReference[^>]*w:type="first"/);
      const cover = plainText(res, "word/document.xml");
      expect(cover).toContain(COVER_LABELS.ruStage);
      expect(cover).toContain(long);
    });
  }

  it("words the line the same way in the app, the HTML preview and Word", () => {
    expect(headerTitleLine({ ...model.doc, cover: { ...model.doc.cover, stageShort: "PPQ" } })).toMatch(/ · Project stage: PPQ$/);
    expect(COVER_LABELS.ruStage).toBe("Project stage");
    expect(COVER_LABELS.suStage).toBe("Sending-site stage");
  });

  it("offers the projectStage tag, with targetStage as its older name", () => {
    expect(model.tagData.projectStage).toBe(model.doc.cover.targetStage);
    expect(model.tagData.targetStage).toBe(model.doc.cover.targetStage);
  });
});

// Sample files for a human to open in Word: one per stage plus "not set", written to the temp folder (like samples.test.ts).
describe("sample files", () => {
  it("writes one Word file per stage and one for a stage that is not set", async () => {
    const dir = join(tmpdir(), "gap-docx-samples", "lifestage");
    mkdirSync(dir, { recursive: true });
    for (const [file, short, long] of [
      ["gap-engineering.docx", "Engineering", "Engineering / development runs"],
      ["gap-clinical.docx", "Clinical", "Clinical batches (GMP, not process-validated)"],
      ["gap-ppq.docx", "PPQ", "PPQ batches (process performance qualification)"],
      ["gap-commercial.docx", "Commercial", "Commercial batches (process validated)"],
      ["gap-not-established.docx", "not set", "[not established]"],
    ] as const) {
      const doc = { ...model.doc, cover: { ...model.doc.cover, stageShort: short, targetStage: long } };
      const out = await renderDocx({ doc, tagData: { ...model.tagData, projectStage: long }, mode: "builtin", generatedAt: GENERATED_AT });
      expect(plainText(strictDocx(out.bytes), "word/header1.xml")).toContain(`Project stage: ${short}`);
      writeFileSync(join(dir, file), out.bytes);
    }
  }, 60_000);
});
