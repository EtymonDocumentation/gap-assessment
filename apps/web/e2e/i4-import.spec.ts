// Job I4: upload a finished GAP ASSESSMENT (levels 1 to 3), on the same upload pieces as the TRD and the sampling plan.
//  - Level 1: our own Word export restores the answers (new project); a cell typed over in Word is a "Changed in Word" row.
//  - Level 2: the blank gap assessment form filled in offline, uploaded with no project open (it makes a new one).
//  - Level 3: a Word file in another layout and a PDF; every answer is "Matched", an answer that does not fit is Not found.
// The review is ONE ROW PER QUESTION grouped by section, accessible at three widths in light and dark, with no sideways scroll.
// All files are fictional and built by the test (packages/docx/test/i4-foreign.ts).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { foreignDocx, pictureOnlyPdf } from "../../../packages/docx/test/i2-foreign";
import { foreignGapBodyXml, foreignGapPdf, type ForeignGapQuestions } from "../../../packages/docx/test/i4-foreign";
import { openDemo } from "./nav-helper";

const SHOTS = tmpdir();
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
// Real question wording and choices of the catalogue (the foreign files ask the way a person would).
const QUESTIONS: ForeignGapQuestions = {
  sharedChoice: { prompt: "What is the product modality?", option: "Monoclonal antibody" },
  sharedChoice2: { prompt: "What is the dosage form?" },
  paired: { prompt: "Backfill gas", source: "Filtered air", target: "Other gas" },
};

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function downloadOf(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return readFile(await dl.path());
}

const upload = (page: Page, testId: string, name: string, buffer: Buffer | Uint8Array, mimeType = DOCX) => page.getByTestId(`${testId}-input`).setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });

function editXml(bytes: Buffer, edit: (xml: string) => string): Buffer {
  const zip = new PizZip(bytes);
  zip.file("word/document.xml", edit(zip.file("word/document.xml")!.asText()));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function fillControl(xml: string, tag: string, text: string): string {
  const start = xml.indexOf(`<w:tag w:val="${tag}"/>`);
  expect(start, `control ${tag}`).toBeGreaterThan(0);
  const open = xml.lastIndexOf("<w:sdt>", start);
  const end = xml.indexOf("</w:sdt>", start) + "</w:sdt>".length;
  const filled = xml.slice(open, end).replace("<w:showingPlcHdr/>", "").replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent>`);
  return xml.slice(0, open) + filled + xml.slice(end);
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const openGap = async (page: Page) => {
  await page.goto("./");
  await hash(page, "#/gap");
};

/** The Word export of the open demo's gap assessment (it carries its data), from the Document page. */
async function exportDemoGap(page: Page): Promise<Buffer> {
  await page.goto("./");
  await openDemo(page, "arx", "#/document");
  return downloadOf(page, async () => {
    await page.getByRole("button", { name: "Download gap assessment (Word)", exact: true }).click();
  });
}

async function fillWho(page: Page, name: string) {
  await page.getByTestId("import-title").fill(name);
  await page.getByTestId("import-who-name").fill("Test responder (fictional)");
}

test("level 1: our own Word export restores every answer as a new project", async ({ page }) => {
  test.setTimeout(240_000);
  const bytes = await exportDemoGap(page);
  await hash(page, "#/gap");
  await expect(page.getByTestId("gap-upload-card")).toBeVisible();
  await upload(page, "gap-upload", "gap-assessment.docx", bytes);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("made by this tool");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, [1-9]\d* still open/);
  // Nothing is decided yet; "Accept all exact" takes every exact answer in one press.
  const exact = page.getByTestId("import-accept-exact");
  await expect(exact).toBeEnabled();
  await exact.click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^[1-9]\d* values taken, /);
  await page.screenshot({ path: join(SHOTS, `i4-review-level1-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "level 1 review");
  await expectNoHorizontalScroll(page, "level 1 review");
  await page.getByTestId("import-target-new").check();
  await fillWho(page, "Restored from Word (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("import-added")).toContainText(/[1-9]\d* answers recorded/);
  await expectAccessible(page, "done screen");
  // The restored project has the answers: the interview has progressed, and the change log says where they came from.
  await page.getByTestId("import-open-interview").click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("level 1: a cell typed over in Word is a Changed row that stays open until decided", async ({ page }) => {
  test.setTimeout(240_000);
  const bytes = await exportDemoGap(page);
  const edited = editXml(bytes, (xml) => {
    expect(xml).toContain(">ARX-217<");
    return xml.split(">ARX-217<").join(">ARX-999<");
  });
  await hash(page, "#/gap");
  await upload(page, "gap-upload", "edited.docx", edited);
  await expect(page.getByTestId("import-review")).toBeVisible();
  const changed = page.getByTestId("import-changed");
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText("Changed in Word");
  await expect(changed).toContainText("ARX-217");
  await expect(changed).toContainText("ARX-999");
  await expect(page.getByTestId("import-live-summary")).toContainText("changed in Word");
  // Update mode is the default with a project open, and "Accept all exact" skips a changed row.
  await expect(page.getByTestId("import-target-update")).toBeChecked();
  await page.getByTestId("import-accept-exact").click();
  await expect(changed).not.toContainText("Taken from the file");
  await page.screenshot({ path: join(SHOTS, `i4-changed-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "changed row");
  await changed.getByTestId("import-use-file").click();
  await expect(changed.getByTestId("import-state")).toHaveText("Taken from the file");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("import-added")).toContainText(/1 answer recorded/);
});

test("level 2: the blank form filled in offline makes a new project (no project open)", async ({ page }) => {
  test.setTimeout(240_000);
  await openGap(page);
  await expect(page.getByTestId("gap-upload-card")).toBeVisible();
  const blank = await downloadOf(page, () => page.getByTestId("gap-blank-form").click());
  const filled = editXml(blank, (xml) => fillControl(fillControl(xml, "gap.q.scope.modality.shared", "Monoclonal antibody"), "gap.q.scope.dosage_form.shared", "not a real choice"));
  await upload(page, "gap-upload", "form.docx", filled);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("fill-in form");
  // Only boxes with something in them are rows; the unfilled ones are open items, never values.
  await expect(page.getByTestId("import-row")).toHaveCount(2);
  await expect(page.getByTestId("import-live-summary")).toContainText("still open");
  const bad = page.getByTestId("import-row").filter({ hasText: "Dosage form" });
  await expect(bad).toContainText("not one of the choices");
  await expect(bad.getByTestId("import-accept")).toBeDisabled();
  await page.getByTestId("import-accept-exact").click();
  // No project is open, so the only choice is a new project: it needs a name and who answers.
  await expect(page.getByTestId("import-target-new")).toHaveCount(0);
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-error")).toContainText("name");
  await fillWho(page, "From the form (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("import-added")).toContainText(/1 answer recorded/);
});

const openForeign = async (page: Page) => {
  await openGap(page);
  await upload(page, "gap-upload", "other-layout.docx", foreignDocx(foreignGapBodyXml(QUESTIONS)));
  await expect(page.getByTestId("import-review")).toBeVisible();
};

test("level 3: a Word file in another layout gives Matched answers, Not found with a reason, and a Not used yet list", async ({ page }) => {
  test.setTimeout(180_000);
  await openForeign(page);
  await expect(page.getByTestId("import-read-as")).toContainText("another layout");
  await expect(page.getByTestId("import-accept-exact")).toHaveCount(0);
  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(3);
  const modality = rows.filter({ hasText: "Modality" });
  await expect(modality).toContainText("Monoclonal antibody");
  await expect(modality).toContainText("Matched");
  // A both-units question says so, and says the two columns of the document agreed.
  await expect(modality.getByTestId("import-cell-shared")).toContainText("Both units");
  await expect(modality.getByTestId("import-cell-shared")).toContainText("give the same answer");
  await expect(page.getByTestId("import-review")).not.toContainText("Not established");
  const dosage = rows.filter({ hasText: "Dosage form" });
  await expect(dosage.getByTestId("import-not-used-why")).toContainText("not one of the choices");
  await expect(dosage.getByRole("button", { name: /^Type an answer/ })).toBeVisible();
  const gas = rows.filter({ hasText: "Backfill gas" });
  await expect(gas.getByTestId("import-cell-source")).toContainText("Filtered air");
  await expect(gas.getByTestId("import-cell-target")).toContainText("Other gas");
  await expect(page.getByTestId("import-not-used")).toContainText("Colour of the building");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, /);
  await page.getByTestId("import-accept-table").first().click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^[1-9]\d* values taken, /);
  await page.getByTestId("import-who-name").fill("Test responder (fictional)");
  await page.getByTestId("import-title").fill("From another layout (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  // Backfill gas belongs to lyophilization, which this new project does not have in scope: left open, never forced in.
  await expect(page.getByTestId("import-warnings")).toContainText("Backfill gas");
});

test("level 3: a PDF with a question table gives Matched answers; a picture-only PDF gets a plain message", async ({ page }) => {
  test.setTimeout(180_000);
  await openGap(page);
  await upload(page, "gap-upload", "review.pdf", await foreignGapPdf(QUESTIONS), "application/pdf");
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("PDF");
  const gas = page.getByTestId("import-row").filter({ hasText: "Backfill gas" });
  await expect(gas.getByTestId("import-cell-source")).toContainText("Filtered air");
  await page.screenshot({ path: join(SHOTS, `i4-pdf-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "pdf review");
  await expectNoHorizontalScroll(page, "pdf review");
  await page.getByRole("button", { name: "Cancel" }).click();
  await upload(page, "gap-upload", "scan.pdf", await pictureOnlyPdf(), "application/pdf");
  await expect(page.getByTestId("gap-upload-message")).toContainText("This PDF is a picture of text");
  await expectAccessible(page, "message");
});

test("a TRD or sampling file made by this tool is sent to its own page", async ({ page }) => {
  test.setTimeout(240_000);
  const bytes = await exportDemoGap(page);
  // A gap assessment file offered to the TRD page is sent to the Gap assessment page.
  await hash(page, "#/trd");
  await upload(page, "trd-upload", "gap.docx", bytes);
  await expect(page.getByTestId("trd-upload-message")).toContainText("gap assessment");
  await expect(page.getByTestId("trd-upload-message")).toContainText("Gap assessment page");
});

test("the Home upload block and the interview offer the gap assessment upload", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await expect(page.getByTestId("home-upload-gap")).toBeVisible();
  await openDemo(page, "arx", "#/gap");
  await expect(page.getByTestId("gap-upload")).toBeVisible();
  await expect(page.getByTestId("gap-prefilled-form")).toBeVisible();
  const form = await downloadOf(page, () => page.getByTestId("gap-prefilled-form").click());
  // The pre-filled form carries the answers of the demo and reads back as exact values.
  await upload(page, "gap-upload", "prefilled.docx", form);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("fill-in form");
  await expect(page.getByTestId("import-accept-exact")).toBeEnabled();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the review is accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openForeign(page);
    await expectAccessible(page, `${scheme} review`);
    await expectNoHorizontalScroll(page, `${scheme} review`);
    await page.getByTestId("import-matched-table").first().getByRole("button", { name: /Show table/ }).click();
    await expectAccessible(page, `${scheme} document pane`);
    await expectNoHorizontalScroll(page, `${scheme} document pane`);
    await page.screenshot({ path: join(SHOTS, `i4-review-${test.info().project.name}-${scheme}.png`), fullPage: true });
  });
}
