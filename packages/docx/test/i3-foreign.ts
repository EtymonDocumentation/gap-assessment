import { PDFDocument, StandardFonts } from "pdf-lib";
import { p, table } from "./i2-foreign";

/**
 * Fictional "foreign" sampling plans for the level-3 upload tests (job I3), generated here so no real document is ever needed:
 *  - a Word file in a layout this tool did not write: a title, two points tables with different column words (one under a heading
 *    that names the step, one with a step column and a unit in the amount heading), a group row, and a table the reader must skip;
 *  - a PDF made with pdf-lib: a heading and one points table with a flat header.
 * The step names are passed in (the catalogue's own labels) so the fixtures never hard-code the catalogue.
 */
export const FOREIGN_SAMPLING_TITLE = "Sampling Overview for the Receiving Unit (fictional)";

export function foreignSamplingBodyXml(stepA: string, stepB: string): string {
  return [
    p(FOREIGN_SAMPLING_TITLE, "Title"),
    p("Document number: FX-SMP-0001"),
    p(`1 Sampling at ${stepA}`, "Heading1"),
    p("Samples are pulled during the PPQ batches."),
    table([
      ["Quality attribute", "Method", "Sample size", "When", "Purpose"],
      ["Fill volume", "Gravimetric check", "10 mL", "Beginning, middle, end", "In-process"],
      ["Appearance", "Visual inspection", "20 mL", "Every 30 minutes", "IPC"],
      ["Particle count", "Light obscuration", "5", "End", "Characterisation"],
    ]),
    p("The operator shall record each result within 24 hours."),
    p("2 Other points", "Heading1"),
    table([
      ["Process step", "Attribute", "Test", "Volume (mL)", "Timing", "Type"],
      [stepB, "Bioburden", "Membrane filtration", "100", "End", "Release"],
      [stepB, "Endotoxin", "Kinetic assay", "5", "Middle", "something unclear"],
      ["Some step of our own", "Colour", "Visual", "2 mL", "", "In-process"],
    ]),
    table([
      ["Contact", "Phone"],
      ["Site B office", "n/a"],
    ]),
  ].join("");
}

/** A PDF with a heading and one points table (flat header). */
export async function foreignSamplingPdf(stepA: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const col = [56, 190, 320, 400, 500];
  const lines: { y: number; size?: number; cells: [number, string][] }[] = [
    { y: 740, size: 18, cells: [[56, "Sampling Plan (fictional)"]] },
    { y: 710, cells: [[56, `1 ${stepA}`]] },
    { y: 680, cells: [[col[0]!, "Attribute"], [col[1]!, "Test"], [col[2]!, "Amount"], [col[3]!, "Timing"], [col[4]!, "Type"]] },
    { y: 664, cells: [[col[0]!, "Fill volume"], [col[1]!, "Gravimetric"], [col[2]!, "10 mL"], [col[3]!, "End"], [col[4]!, "Release"]] },
    { y: 648, cells: [[col[0]!, "Appearance"], [col[1]!, "Visual"], [col[2]!, "20 mL"], [col[3]!, "Middle"], [col[4]!, "IPC"]] },
  ];
  for (const l of lines) for (const [x, text] of l.cells) page.drawText(text, { x, y: l.y, size: l.size ?? 10, font });
  return doc.save({ useObjectStreams: false });
}
