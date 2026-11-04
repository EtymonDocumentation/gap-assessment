import { PDFDocument, StandardFonts } from "pdf-lib";
import { p, table } from "./i2-foreign";

/**
 * Fictional "foreign" gap assessments for the level-3 upload tests (job I4), generated here so no real document is ever needed:
 *  - a Word file in a layout this tool did not write: a title, a table with Topic / Sending site / Receiving site columns, a group
 *    row, a row with an answer that does not fit the choices, a row the catalogue does not ask, and a table the reader must skip;
 *  - a second table with ONE answer column (only questions asked of both units may use it);
 *  - a PDF made with pdf-lib: a heading and one question table with a flat header.
 * The question texts are passed in (the catalogue's own wording) so the fixtures never hard-code the catalogue.
 */
export const FOREIGN_GAP_TITLE = "Technology Transfer Gap Review (fictional)";

export interface ForeignGapQuestions {
  /** A shared choice question, its prompt, and one of its option labels. */
  sharedChoice: { prompt: string; option: string };
  /** A shared question with the same prompt but a wrong answer. */
  sharedChoice2: { prompt: string };
  /** A paired text or choice question and an answer for each side. */
  paired: { prompt: string; source: string; target: string };
  /** A paired quantity question: prompt and a bare number (the heading gives the unit). */
  quantity?: { prompt: string };
}

export function foreignGapBodyXml(q: ForeignGapQuestions): string {
  return [
    p(FOREIGN_GAP_TITLE, "Title"),
    p("Document number: FX-GAP-0001"),
    p("1 Scope", "Heading1"),
    table([
      ["Topic", "Sending site", "Receiving site"],
      [q.sharedChoice.prompt, q.sharedChoice.option, q.sharedChoice.option],
      [q.sharedChoice2.prompt, "Something the list does not have", "Something the list does not have"],
      [q.paired.prompt, q.paired.source, q.paired.target],
      ["Colour of the building", "Grey", "Blue"],
    ]),
    p("The receiving site shall confirm everything within 24 hours."),
    p("2 Other", "Heading1"),
    table([
      ["Contact", "Phone"],
      ["Site B office", "n/a"],
    ]),
  ].join("");
}

/** A PDF with a heading and one question table (flat header). */
export async function foreignGapPdf(q: ForeignGapQuestions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines: { y: number; size?: number; cells: [number, string][] }[] = [
    { y: 740, size: 18, cells: [[56, "Gap Review (fictional)"]] },
    { y: 700, cells: [[56, "Question"], [330, "Sending unit"], [450, "Receiving unit"]] },
    { y: 684, cells: [[56, q.paired.prompt], [330, q.paired.source], [450, q.paired.target]] },
  ];
  for (const l of lines) for (const [x, text] of l.cells) page.drawText(text, { x, y: l.y, size: l.size ?? 10, font });
  return doc.save({ useObjectStreams: false });
}
