/// <reference types="node" />
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { importTemplateFile, readOutlineFromPdf } from "../src/index";

/** A PDF with the given lines on one page and no bookmarks. */
async function plainPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 740;
  for (const l of lines) {
    page.drawText(l, { x: 56, y, size: 12, font });
    y -= 20;
  }
  return doc.save({ useObjectStreams: false });
}

describe("reading headings from a PDF without bookmarks", () => {
  it("falls back to numbered lines of text", async () => {
    const bytes = await plainPdf(["Cover words that are not a heading", "1 Objective", "Some body text here.", "2 Scope", "2.1 Products", "2.2 Sites", "3. Required Actions", "12 pieces of equipment were counted"]);
    const out = await readOutlineFromPdf(bytes);
    expect(out.map((h) => h.number)).toEqual(["1", "2", "2.1", "2.2", "3"]);
    expect(out.map((h) => h.text)).toEqual(["Objective", "Scope", "Products", "Sites", "Required Actions"]);
    expect(out.map((h) => h.level)).toEqual([1, 1, 2, 2, 1]);
    expect(out.map((h) => h.index)).toEqual([0, 1, 2, 3, 4]);
    expect(out.every((h) => h.hasBody === false)).toBe(true);
  });

  it("returns an empty list when nothing looks like a heading", async () => {
    expect(await readOutlineFromPdf(await plainPdf(["just some words", "and more words"]))).toEqual([]);
  });

  it("is reported as a PDF import with the mapped mode only, even without headings", async () => {
    const t = await importTemplateFile("plain.pdf", await plainPdf(["just some words"]));
    expect(t.analysis.usableModes).toEqual(["mapped"]);
    expect(t.analysis.outline).toEqual([]);
    expect(t.analysis.warnings.length).toBeGreaterThan(0);
  });

  it("explains a damaged PDF", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf\n%%EOF");
    await expect(importTemplateFile("broken.pdf", bytes)).rejects.toThrow(/PDF/);
  });
});
