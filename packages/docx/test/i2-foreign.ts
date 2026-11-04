import { PDFDocument, StandardFonts } from "pdf-lib";
import PizZip from "pizzip";

/**
 * Fictional "foreign" TRDs for the level-3 upload tests (job I2), generated here so no real document is ever needed:
 *  - a Word file in a layout this tool did not write: other heading words, a title line, "label: value" lines, a table with merged
 *    header cells (gridSpan and vMerge), a table with a sub-heading row, and text that must land in "Not used yet";
 *  - a PDF made with pdf-lib: headings, a paragraph and one column table;
 *  - a PDF with no text at all (what a scan looks like to a text reader).
 * Used by the unit tests and by the browser tests (apps/web/e2e/i2-import.spec.ts).
 */

type Cell = string | { text: string; span?: number; vmerge?: "restart" | "continue" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

function tc(cell: Cell): string {
  const c = typeof cell === "string" ? { text: cell } : cell;
  const pr = `${c.span && c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ""}${c.vmerge === "restart" ? '<w:vMerge w:val="restart"/>' : c.vmerge === "continue" ? "<w:vMerge/>" : ""}`;
  return `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ""}${p(c.text)}</w:tc>`;
}
const table = (rows: Cell[][]) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.map((r) => `<w:tr>${r.map(tc).join("")}</w:tr>`).join("")}</w:tbl>`;

export const FOREIGN_TITLE_LINE = "Process Transfer Summary (fictional)";

/** The body of the foreign Word file. */
export function foreignBodyXml(): string {
  return [
    p(FOREIGN_TITLE_LINE, "Title"),
    p("Document number: FX-DOC-0001"),
    p("Project: Project Falcon (fictional)"),
    p("1 Aim", "Heading1"),
    p("Move the filling process to the receiving unit and show it still works."),
    p("Both sites keep their own quality oversight."),
    p("2 Field of application", "Heading1"),
    p("Applies to the filling and filtration steps of the fictional 2 mL vial product."),
    table([
      ["Receiving site", "Site B (fictional)"],
      ["Filling line", "Line 4"],
    ]),
    p("3 Filling", "Heading1"),
    p("Table 1 Filling parameters"),
    table([
      [{ text: "Parameter", vmerge: "restart" }, { text: "Target", vmerge: "restart" }, { text: "Normal operating range (NOR)", span: 2 }, { text: "Proven acceptable range (PAR)", span: 2 }, { text: "Unit", vmerge: "restart" }],
      [{ text: "", vmerge: "continue" }, { text: "", vmerge: "continue" }, "Min", "Max", "Min", "Max", { text: "", vmerge: "continue" }],
      ["Fill volume", "5.0", "4.8", "5.2", "4.5", "5.5", "mL"],
      ["Fill weight", "5.1", "4.9", "5.3", "4.6", "5.6", "g"],
      ["Line speed", "120", "100", "140", "", "", "vials/min"],
      ["Mixing speed", "60", "50", "70", "", "", "rpm"],
    ]),
    p("The filling operator shall check the fill volume every 30 minutes."),
    p("4 Filtration", "Heading1"),
    table([
      ["Item", "Target", "Normal operating range", "Proven acceptable range", "Limit"],
      [{ text: "Sterile filtration", span: 5 }],
      ["Filtration duration (min)", "", "20-40", "NMT 90", "NMT 120 min"],
      ["Differential pressure (bar)", "1.5", "1.0 to 2.0", "≤ 2.5", ""],
      [{ text: "Lyophilization", span: 5 }],
      ["Primary drying chamber pressure", "0,1 mbar", "", "", ""],
      ["Secondary drying time", "8 h", "6 to 10 h", "> 4 h", ""],
    ]),
  ].join("");
}

/** A Word file in a layout this tool did not write (no data part, no content controls). */
export function foreignDocx(body: string = foreignBodyXml()): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

interface PdfLine {
  y: number;
  size?: number;
  cells: [number, string][];
}

/** A PDF with a heading, a paragraph and one column table (flat header). Columns are left-aligned at fixed positions. */
export async function foreignPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const col = [56, 190, 260, 340, 420, 500];
  const lines: PdfLine[] = [
    { y: 740, size: 18, cells: [[56, "Technology Transfer Report (fictional)"]] },
    { y: 710, cells: [[56, "1 Objective"]] },
    { y: 692, cells: [[56, "Show that the filtration step works at the receiving unit."]] },
    { y: 674, cells: [[56, "The second line of the same paragraph."]] },
    { y: 640, cells: [[56, "2 Sterile filtration"]] },
    { y: 612, cells: [[col[0]!, "Parameter"], [col[1]!, "Set point"], [col[2]!, "NOR min"], [col[3]!, "NOR max"], [col[4]!, "PAR max"], [col[5]!, "Unit"]] },
    { y: 596, cells: [[col[0]!, "Filtration duration"], [col[1]!, "60"], [col[2]!, "40"], [col[3]!, "80"], [col[4]!, "90"], [col[5]!, "min"]] },
    { y: 580, cells: [[col[0]!, "Differential pressure"], [col[1]!, "1.5"], [col[2]!, "1.0"], [col[3]!, "2.0"], [col[4]!, "2.5"], [col[5]!, "bar"]] },
    { y: 548, cells: [[56, "The filter must be integrity tested after use (limit: pass)."]] },
  ];
  for (const l of lines) for (const [x, text] of l.cells) page.drawText(text, { x, y: l.y, size: l.size ?? 10, font });
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose pages carry no text, as a scan does (only a drawn shape). */
export async function pictureOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 50, y: 600, width: 300, height: 100 });
  return doc.save({ useObjectStreams: false });
}
