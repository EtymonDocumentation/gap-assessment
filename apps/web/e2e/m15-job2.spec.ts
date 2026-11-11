// M15 job 2: the TRD under the headings of a person's own Word template. A fictional template is built from scratch in this file (six headings, two of them
// match nothing in the TRD). The spec follows the whole road: add the template, choose "A template's headings" on the TRD's Document tab, open "Match your
// headings", confirm the suggestions, be held back until every heading with content has its "Replace it" / "Keep it above Cascade's content" pick, save,
// download the Word file and read its XML. Desktop, tablet and phone, axe on each screen, no sideways scroll.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, NOTICE_DOCUMENT, openDemo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `m15-job2-${name}-${test.info().project.name}.png`), fullPage: true });

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

// The fictional template: "Harbourlight SOP (fictional)". Headings 4 and 5 ("Distribution list", "Training records") have no counterpart in a TRD.
const HEADINGS: Array<[string, string]> = [
  ["Purpose and scope", "Describe the purpose and scope of this document."],
  ["Abbreviations and definitions", "List the abbreviations used in this document."],
  ["Process description", "Describe the process."],
  ["Open items", ""],
  ["Distribution list", ""],
  ["Training records", ""],
];

/** A small Word file made from nothing: a heading style, a body style and the headings above with one instruction line under some of them. */
function buildTemplate(headings: Array<[string, string]> = HEADINGS): Buffer {
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
async function confirmTbd(page: Page): Promise<void> {
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
}

async function downloadWord(page: Page): Promise<Buffer> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), page.getByTestId("trd-download-word").click().then(() => confirmTbd(page))])) as [Download, void];
  return readFile(await dl.path());
}

async function addTemplate(page: Page, headings?: Array<[string, string]>) {
  await page.evaluate(() => (window.location.hash = "#/templates"));
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByLabel(/^Template file/).setInputFiles({ name: "harbourlight-sop.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buildTemplate(headings) });
  const form = page.getByRole("form", { name: /^Add harbourlight-sop\.docx/ });
  await form.getByLabel("Name").fill("Harbourlight SOP (fictional)");
  await form.getByLabel(/^Version/).fill("1");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
}

async function pickTemplate(page: Page) {
  const value = await page.locator("select option", { hasText: "Harbourlight SOP (fictional)" }).first().getAttribute("value");
  await page.getByRole("combobox", { name: "Template", exact: true }).selectOption(value!);
}

async function openTrdOutput(page: Page) {
  await goTo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
}

test("the TRD under a template's headings: match, be held back until each pick is made, save, download", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await addTemplate(page);

  // The template's card says the TRD match is not set yet, and offers the match screen. It works here without any TRD being open to the page.
  const cardMatch = page.locator('[data-testid^="trd-match-card-"]');
  await expect(cardMatch).toContainText("Not set yet.");
  await expect(cardMatch.getByRole("link", { name: "Match your headings" })).toBeVisible();
  await shot(page, "templates-card");

  // The TRD's Document tab: "A template's headings" is now offered for the TRD. Nothing is matched yet, so the download is held back in words.
  await openTrdOutput(page);
  await page.getByRole("radio", { name: /A template's headings/ }).check();
  await pickTemplate(page);
  await expect(page.getByTestId("trd-match-links")).toBeVisible();
  await expect(page.getByText("This template has no match for the TRD yet.")).toBeVisible();
  await expect(page.getByTestId("trd-download-word")).toBeDisabled();
  await expectNoSidewaysScroll(page, "TRD Document tab, template headings");
  await shot(page, "trd-document-tab");
  await page.getByTestId("trd-match-links").getByRole("link", { name: "Match your headings" }).click();

  // The match screen: the template's headings in order, "Suggested" marks, nothing chosen for the person.
  await expect(page).toHaveURL(/#\/templates\/[^/]+\/trd-match\?/);
  await expect(page.getByRole("heading", { level: 1, name: "Match your headings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: `Template headings (${HEADINGS.length})` })).toBeVisible();
  await expect(page.getByTestId("trd-match-count")).toContainText("placed under 0 of them");
  const suggested = page.locator(".tag", { hasText: "Suggested" });
  expect(await suggested.count()).toBeGreaterThanOrEqual(4);
  // The two headings that match nothing carry no suggestion and say so.
  await expect(page.getByTestId("trd-match-row-4")).toContainText("No Cascade content under this heading.");
  await expect(page.getByTestId("trd-match-row-5")).toContainText("No Cascade content under this heading.");
  await expect(page.getByTestId("trd-match-row-4").getByTestId("trd-match-suggestion-4")).toHaveCount(0);
  await expectNoSidewaysScroll(page, "match screen before");
  await expectAccessible(page, "match screen before");
  await shot(page, "match-before");

  // Confirm all suggestions: the content moves under its headings, the question about the template's own text appears, and no answer is preselected.
  // The template has one heading for the whole process ("Process description"): the overview AND every process-step description are suggested
  // under it, in process order, each still only a suggestion (nothing stored until confirmed).
  const processSuggestion = page.getByTestId("trd-match-suggestion-2");
  await expect(processSuggestion).toContainText("Suggested");
  const processUnits = (await processSuggestion.locator("span.small").innerText()).split(";").map((s) => s.trim());
  expect(processUnits.length).toBeGreaterThan(10);
  await page.getByTestId("trd-match-confirm-all").click();
  await expect(suggested).toHaveCount(0);
  // After "Confirm all suggestions" only the sections with no heading of their own in this template are left under "Not in your template".
  const leftItems = page.getByTestId("trd-match-not-in-template").locator("li[data-testid^='trd-match-left-']");
  const leftCount = await leftItems.count();
  console.log(`M15J2 not-in-template after confirm-all: ${leftCount}`);
  await expect(page.getByRole("heading", { level: 2, name: `Not in your template (${leftCount})` })).toBeVisible();
  // The old repeated sentence is gone from every row.
  await expect(page.getByTestId("trd-match-not-in-template")).not.toContainText("Left out of the Word file for now.");
  // One line per item on a wide screen (name, picker and button side by side), stacked on a phone.
  const first = leftItems.first();
  const pick = await first.locator("select").boundingBox();
  const btn = await first.locator("button").boundingBox();
  const li = await first.boundingBox();
  expect(pick && btn && li).toBeTruthy();
  if (page.viewportSize()!.width > 600) {
    expect(Math.abs((pick!.y + pick!.height / 2) - (btn!.y + btn!.height / 2))).toBeLessThan(6);
    expect(li!.height).toBeLessThan(80);
  } else {
    expect(btn!.y).toBeGreaterThan(pick!.y);
  }
  // Every picker and button still names its section for a screen reader.
  await expect(first.getByRole("combobox", { name: /^Place under a heading: .+/ })).toBeVisible();
  await expect(first.getByRole("button", { name: /^Add at the end: .+/ })).toBeVisible();
  await expect(page.getByTestId("trd-match-confirm-all")).toBeDisabled();
  const purposeRow = page.getByTestId("trd-match-row-0");
  await expect(purposeRow.getByRole("radio", { name: "Replace it" })).not.toBeChecked();
  await expect(purposeRow.getByRole("radio", { name: "Keep it above Cascade's content" })).not.toBeChecked();

  // Saving with a pick missing is held back with one plain line that names the headings.
  await page.getByTestId("trd-match-save").click();
  const err = page.getByTestId("trd-match-error");
  await expect(err).toContainText('Choose "Replace it" or "Keep it above Cascade\'s content" for:');
  await expect(err).toContainText("Purpose");
  await expectAccessible(page, "match screen held back");
  await shot(page, "match-held-back");

  // Pick for every heading that now has content: replace the template's own text, except under "Scope", which keeps it above ours.
  for (let i = 0; i < HEADINGS.length; i++) {
    const row = page.getByTestId(`trd-match-row-${i}`);
    const replace = row.getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) === 0) continue;
    if (i === 1) await row.getByRole("radio", { name: "Keep it above Cascade's content" }).check();
    else await replace.check();
  }
  await page.getByTestId("trd-match-save").click();
  await expect(err).toHaveCount(0);
  await expect(page.getByTestId("trd-match-status")).toContainText(/saved/i);
  await expect(page.getByTestId("trd-match-count")).toContainText(/placed under [1-9]\d* of them/);
  await expect(page.getByTestId("trd-match-not-in-template")).toBeVisible();
  await expectNoSidewaysScroll(page, "match screen after");
  await expectAccessible(page, "match screen after");
  await shot(page, "match-after");

  // One section the template has no heading for goes at the end of the Word file, under "Additional content".
  const notIn = page.getByTestId("trd-match-not-in-template");
  const addEnd = notIn.getByRole("button", { name: /^Add at the end: / }).first();
  await expect(addEnd).toBeVisible();
  const addedName = ((await addEnd.getAttribute("aria-label")) ?? "").replace(/^Add at the end: /, "");
  await addEnd.click();
  await expect(notIn.getByRole("button", { name: `Take it out again: ${addedName}` })).toBeVisible();

  // The match survives a reload (it is stored with the template, in this browser).
  await page.reload();
  await expect(page.getByTestId("trd-match-row-0").getByRole("radio", { name: "Replace it" })).toBeChecked();
  await expect(page.getByTestId("trd-match-row-1").getByRole("radio", { name: "Keep it above Cascade's content" })).toBeChecked();

  // Back on the Document tab: no hold-back any more, a Word file is made, and it has the template's headings and our content under them.
  await page.getByRole("link", { name: /Back to the TRD/ }).click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
  await page.getByRole("radio", { name: /A template's headings/ }).check();
  await pickTemplate(page);
  await expect(page.getByText("This template has no match for the TRD yet.")).toHaveCount(0);
  await expect(page.getByTestId("trd-not-in-template")).toContainText(/Not in your template: \d+ sections?/);
  const bytes = await downloadWord(page);
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
  for (const [h] of HEADINGS) expect(text, h).toContain(h);
  expect(xml).toContain('w:val="Heading1"');
  // "Replace it": the template's instruction text is gone. "Keep it above": it stays.
  expect(text).not.toContain("Describe the purpose and scope of this document.");
  expect(text).toContain("List the abbreviations used in this document.");
  // Headings with nothing under them say so; the page says only what happens (no open-item number changes).
  expect(text).toContain("[To be completed.]");
  const toComplete = page.getByTestId("trd-to-complete");
  await expect(toComplete).toContainText(/\d+ headings? (have|has) no content and no text of your own\. (They say|It says) "\[To be completed\.\]" in the Word file: /);
  await expect(toComplete).not.toContainText(/open item/);
  expect(text).toContain("Additional content");
  expect(text.replace(/\s+/g, " ")).toContain(NOTICE_DOCUMENT.replace(/\s+/g, " "));
  await expectNoSidewaysScroll(page, "TRD Document tab after the download");
  await shot(page, "trd-document-downloaded");
});

test("the match screen opens from the Templates page with no project open, using the library's sections", async ({ page }) => {
  await page.goto("./");
  await addTemplate(page);
  // No project is open: the match screen still opens from the library, with the library's sections.
  const link = page.locator('[data-testid^="trd-match-card-"]').getByRole("link", { name: "Match your headings" });
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Match your headings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: `Template headings (${HEADINGS.length})` })).toBeVisible();
  await expect(page.getByTestId("trd-match-confirm-all")).toBeEnabled();
  await expectNoSidewaysScroll(page, "library match screen");
  await expectAccessible(page, "library match screen");
  await shot(page, "library-match");
});

test("a template with no headings says so in the words of the TRD, and nothing can be matched", async ({ page }) => {
  await page.goto("./");
  await addTemplate(page, []);
  await page.locator('[data-testid^="trd-match-card-"]').getByRole("link", { name: "Match your headings" }).click();
  await expect(page.getByTestId("trd-match-no-headings")).toContainText("no headings");
  await expect(page.getByTestId("trd-match-save")).toHaveCount(0);
  await expectNoSidewaysScroll(page, "no headings");
  await expectAccessible(page, "no headings");
});
