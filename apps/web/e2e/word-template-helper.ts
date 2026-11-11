// Shared by the M15 e2e specs (job 2, job 3A): a fictional Word template made from scratch (no client file), added to the library through the
// Templates page, and the TRD's Word download read back. One copy, so a change to the fictional template reaches every spec that uses it.
import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";

// The fictional template: "Harbourlight SOP (fictional)". Headings 4 and 5 ("Distribution list", "Training records") have no counterpart in a TRD.
export const HEADINGS: Array<[string, string]> = [
  ["Purpose and scope", "Describe the purpose and scope of this document."],
  ["Abbreviations and definitions", "List the abbreviations used in this document."],
  ["Process description", "Describe the process."],
  ["Open items", ""],
  ["Distribution list", ""],
  ["Training records", ""],
];

/** A small Word file made from nothing: a heading style, a body style and the headings above with one instruction line under some of them. */
export function buildTemplate(headings: Array<[string, string]> = HEADINGS): Buffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [para("Harbourlight SOP (fictional)", "Title"), ...headings.flatMap(([h, t]) => [para(h, "Heading1"), ...(t ? [para(t)] : [])])].join("");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** The demo has open TBD values, so a download asks first; this test wants the file, so it answers "Download anyway". */
export async function confirmTbd(page: Page): Promise<void> {
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
}

export async function downloadWord(page: Page): Promise<Buffer> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), page.getByTestId("trd-download-word").click().then(() => confirmTbd(page))])) as [Download, void];
  return readFile(await dl.path());
}

export async function addTemplate(page: Page, headings?: Array<[string, string]>) {
  await page.evaluate(() => (window.location.hash = "#/templates"));
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByLabel(/^Template file/).setInputFiles({ name: "harbourlight-sop.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buildTemplate(headings) });
  const form = page.getByRole("form", { name: /^Add harbourlight-sop\.docx/ });
  await form.getByLabel("Name").fill("Harbourlight SOP (fictional)");
  await form.getByLabel(/^Version/).fill("1");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
}
