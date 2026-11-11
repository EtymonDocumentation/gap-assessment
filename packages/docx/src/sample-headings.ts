import PizZip from "pizzip";

/**
 * The fictional sample Word template for "A template's headings": a made-up company's SOP layout, written from scratch (no real company file).
 * It lets a first-time user (or a showcase visitor with no Word template of their own) try the whole feature. One copy: the Templates page adds
 * it to the library with a button, and the e2e tests build the same file.
 *
 * The headings are chosen to show every case the feature handles:
 *  - 1 to 3 match content of a TRD and have the template's own instruction line under them (so the person chooses "Replace it" or "Keep it").
 *  - "Open items" matches content and has no text of its own.
 *  - "Distribution list" and "Training records" have no counterpart in a TRD and no text: the interview gives each one a writing box.
 *  - "Site notes" has no counterpart either, but the template has text there that stays in the Word file ("kept text"), so it is not an open item.
 */
export const SAMPLE_HEADINGS_NAME = "Harbourlight SOP (fictional)";
export const SAMPLE_HEADINGS_FILE_NAME = "harbourlight-sop-fictional.docx";

/** Heading text and the template's own text under it ("" for none). */
export const SAMPLE_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ["Purpose and scope", "Describe the purpose and scope of this document."],
  ["Abbreviations and definitions", "List the abbreviations used in this document."],
  ["Process description", "Describe the process."],
  ["Open items", ""],
  ["Distribution list", ""],
  ["Training records", ""],
  ["Site notes", "Keep this paragraph as it is. It is the same in every document of this company (fictional)."],
];

const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A small Word file made from nothing: a title, a heading style, a body style and the headings above. The zip's file dates are fixed, so the same
 * headings always give the same bytes (the library recognises "already added" by the file's checksum).
 */
export function buildSampleHeadingsTemplate(headings: ReadonlyArray<readonly [string, string]> = SAMPLE_HEADINGS): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const body = [para(SAMPLE_HEADINGS_NAME, "Title"), ...headings.flatMap(([h, t]) => [para(h, "Heading1"), ...(t ? [para(t)] : [])])].join("");
  const date = new Date(Date.UTC(2026, 0, 1));
  const zip = new PizZip();
  const add = (name: string, xml: string) => zip.file(name, xml, { date });
  add(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  add("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  add("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  add(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  );
  add(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
