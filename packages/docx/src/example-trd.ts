import PizZip from "pizzip";

/**
 * The example finished TRD for "Try the AI reading on an example TRD" (job AI1): a FICTIONAL Word document for a lyophilized
 * antibody (ORV-118), written the way a contract manufacturer writes one by hand and NOT in this tool's layout: numbered headings,
 * prose, "label: value" lines, a table with merged cells and a note line under it. It has no hidden data part, so the site reads it as
 * a document from somewhere else (level 3, fixed rules).
 *
 * What it is for: the fixed rules find a handful of values (the "label: value" and two-column table rows, the Purpose and Scope
 * headings, one parameter table). The rest of the useful values sit in prose and in a note line; the pre-recorded AI reading
 * (content/ai-reading/example-trd.yaml) quotes those passages. Every quote there must appear word for word in the text of THIS file
 * (packages/docx/test/ai1-example.test.ts checks it), so change the text here and the recording together.
 *
 * The file is shipped as apps/web/public/examples/example-finished-trd.docx. It is built the same way every time (fixed file dates),
 * and the test compares the shipped file with this generator's output. To rewrite the shipped file after a change here:
 *   WRITE_EXAMPLE_TRD=1 npx vitest run packages/docx/test/ai1-example.test.ts
 */

/** Everything in the example is made up. Nothing in it is a real product, site or company. */
export const EXAMPLE_TRD_FILE_NAME = "example-finished-trd.docx";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

type Cell = string | { text: string; span?: number; vmerge?: "restart" | "continue" };

function tc(cell: Cell): string {
  const c = typeof cell === "string" ? { text: cell } : cell;
  const pr = `${c.span && c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ""}${c.vmerge === "restart" ? '<w:vMerge w:val="restart"/>' : c.vmerge === "continue" ? "<w:vMerge/>" : ""}`;
  return `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ""}${p(c.text, "TableText")}</w:tc>`;
}

const table = (rows: Cell[][]) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.map((r) => `<w:tr>${r.map(tc).join("")}</w:tr>`).join("")}</w:tbl>`;

/** The paragraphs and tables of the example, in order. */
export function exampleTrdBodyXml(): string {
  return [
    p("Technology Transfer Requirements Document: ORV-118 Lyophilized Drug Product (fictional)", "Title"),
    table([
      ["Document number", "ORV-TRD-0118"],
      ["Receiving site", "Northfield Fill Site (fictional)"],
      ["Filling line", "Line 2"],
      [{ text: "Sending site: Riverside Pilot Plant (fictional). Both sites keep their own quality oversight.", span: 2 }],
    ]),

    p("1 Purpose", "Heading1"),
    p("This document describes how the ORV-118 drug product process is moved from the Riverside Pilot Plant to the Northfield Fill Site. It lists the process steps, their limits and what has to be shown at the receiving site."),

    p("2 Product and presentation", "Heading1"),
    p("ORV-118 is a humanized monoclonal antibody supplied as a lyophilized powder for solution for injection."),
    p("The powder is filled into a 10 mL type I glass vial, closed with a 20 mm lyophilization stopper and sealed with an aluminium cap."),

    p("3 Scope", "Heading1"),
    p("The transfer covers thawing of the drug substance, compounding, sterile filtration, aseptic filling, lyophilization and capping. Labelling and secondary packaging are not part of this transfer."),

    p("4 Process description", "Heading1"),
    p("4.1 Thaw and compounding", "Heading2"),
    p("The drug substance arrives frozen and is thawed in its container. The thaw is done at 15 °C and takes no longer than 6 h. After thawing, the drug substance may be held at 2-8 °C for up to 72 h before compounding."),
    p("Compounding is carried out at 20 °C with a mixing speed of 120 rpm for 30 min. The formulated bulk may be held for up to 24 h at 2-8 °C before filtration."),
    p("4.2 Sterile filtration", "Heading2"),
    p("The formulated bulk is filtered through a 0.22 µm polyethersulfone (PES) filter into a sterile bag. The proven acceptable upper limit for the differential pressure is 2.0 bar."),
    p("In the engineering run the filtration took about 45 min, which is the target for the transfer."),
    p("4.3 Filling", "Heading2"),
    p("During the engineering run the line was operated at 100 vials/min. The filling operator checks the fill volume every 30 min."),

    p("5 Filling parameters", "Heading1"),
    p("Table 1 Filling parameters"),
    table([
      [{ text: "Parameter", vmerge: "restart" }, { text: "Target", vmerge: "restart" }, { text: "Normal operating range (NOR)", span: 2 }, { text: "Proven acceptable range (PAR)", span: 2 }, { text: "Unit", vmerge: "restart" }],
      [{ text: "", vmerge: "continue" }, { text: "", vmerge: "continue" }, "Min", "Max", "Min", "Max", { text: "", vmerge: "continue" }],
      ["Fill volume", "5.0", "4.9", "5.1", "4.8", "5.2", "mL"],
    ]),
    p("Note a: After thawing, the drug substance may stay at ambient temperature for no more than 4 h."),

    p("6 Lyophilization", "Heading1"),
    p("The cycle freezes the vials, then dries them at a shelf temperature of -25 °C and a chamber pressure of 0.10 mbar. Secondary drying is done at a shelf temperature of 30 °C for 6 h."),

    p("Document status: Approved, version 2.0 (fictional example)", "Note"),
  ].join("");
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A small style sheet so the file looks like a normal Word document when a person opens it (headings, a title, bordered tables). */
function stylesXml(): string {
  const style = (id: string, name: string, extra: string, rpr: string, ppr = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${ppr}${extra}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style("Title", "Title", '<w:spacing w:before="0" w:after="240"/>', '<w:b/><w:sz w:val="36"/>')}
${style("Heading1", "heading 1", '<w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="28"/>', '<w:keepNext/><w:spacing w:before="320" w:after="120"/>')}
${style("Heading2", "heading 2", '<w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="24"/>', '<w:keepNext/><w:spacing w:before="200" w:after="80"/>')}
${style("TableText", "Table Text", '<w:spacing w:before="40" w:after="40"/>', '<w:sz w:val="20"/>')}
${style("Note", "Note", '<w:spacing w:before="240"/>', '<w:i/><w:sz w:val="18"/>')}
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
}

/** The example Word file. The bytes are the same on every run (fixed file dates, fixed compression). */
export function exampleTrdDocx(): Uint8Array {
  const zip = new PizZip();
  const date = new Date(Date.UTC(2026, 10, 17, 0, 0, 0));
  const add = (name: string, xml: string) => zip.file(name, xml, { date });
  add(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  add(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  add("word/styles.xml", stylesXml());
  add(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${exampleTrdBodyXml()}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
