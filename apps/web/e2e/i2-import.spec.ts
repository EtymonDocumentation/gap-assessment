// Job I2: upload a TRD written by somebody else (level 3). A Word file in another layout (other headings and column words, merged cells)
// and a PDF with a table are read by fixed rules; every match is shown as "Matched" (a suggestion, never part of "Accept all exact"),
// accepted per table, and a text-less PDF gets a plain message. "Not used yet" lists what looked important and was left out.
// The review is accessible at three widths in light and dark. All files are fictional and built by the test (packages/docx/test/i2-foreign.ts).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foreignDocx, foreignPdf, pictureOnlyPdf } from "../../../packages/docx/test/i2-foreign";
import { goTo, openDemo } from "./nav-helper";

const SHOTS = tmpdir();
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openTrdList(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "TRD");
  await expect(page.getByTestId("trd-upload")).toBeVisible();
}

async function upload(page: Page, name: string, bytes: Uint8Array, mimeType: string) {
  await page.getByTestId("trd-upload-input").setInputFiles({ name, mimeType, buffer: Buffer.from(bytes) });
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

const openForeignDocx = async (page: Page) => {
  await openTrdList(page);
  await upload(page, "other-layout.docx", foreignDocx(), DOCX);
  await expect(page.getByTestId("import-review")).toBeVisible();
};

test("a Word file in another layout: Matched rows, accepted per table, values reach the TRD", async ({ page }) => {
  test.setTimeout(180_000);
  const name = test.info().project.name;
  await openForeignDocx(page);
  await expect(page.getByTestId("import-read-as")).toContainText("another layout");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, [1-9]\d* found and waiting for you, [1-9]\d* not in this document \(left open\)$/);
  // Matches are suggestions: nothing is "exact", and there is no "Accept all exact" at this level.
  await expect(page.getByTestId("import-accept-exact")).toHaveCount(0);
  await expect(page.getByText("Matched").first()).toBeVisible();

  const tables = page.getByTestId("import-matched-table");
  await expect(tables).toHaveCount(3);
  await expect(tables.nth(1)).toContainText('Table 2 under "3 Filling"');
  await page.screenshot({ path: join(SHOTS, `i2-matched-${name}.png`), fullPage: true });
  await expectNoHorizontalScroll(page, "matched review");
  await expectAccessible(page, "matched review");

  // One press takes everything matched in the filling table, and only that.
  await tables.nth(1).getByTestId("import-accept-table").click();
  await expect(page.getByTestId("import-bulk-status")).toContainText("accepted");
  const taken = await page.getByTestId("import-live-summary").innerText();
  expect(taken).toMatch(/^\d+ values taken, \d+ found and waiting for you, [1-9]\d* not in this document \(left open\)$/);
  expect(Number(taken.split(" ")[0])).toBeGreaterThanOrEqual(10);
  await expect(tables.nth(1).getByTestId("import-accept-table")).toBeDisabled();
  await expect(tables.nth(2).getByTestId("import-accept-table")).toBeEnabled();

  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("From another layout (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-summary")).toHaveText(/^\d+ values taken, \d+ found and waiting for you, [1-9]\d* not in this document \(left open\)$/);
  await page.getByTestId("import-open-trd").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  // The accepted filling values are in the TRD (4.8 to 5.2 mL); the values of the table that was not accepted are not.
  await page.getByTestId("trd-tab-process").click();
  await page.getByTestId("trd-steps-open-all").click();
  const body = page.locator("main");
  await expect(body).toContainText("Fill volume");
  await expect(body).toContainText("4.8");
  await expect(body).toContainText("5.2");
});

test("'Not used yet' lists important text that no field took, with the reason", async ({ page }) => {
  await openForeignDocx(page);
  const list = page.getByTestId("import-not-used");
  await expect(list).toBeVisible();
  await expect(list.locator("summary")).toContainText("Not used yet");
  await list.locator("summary").click();
  if (!(await list.evaluate((el) => (el as HTMLDetailsElement).open))) await list.locator("summary").click();
  await expect(list).toContainText("The filling operator shall check the fill volume every 30 minutes.");
  await expect(list).toContainText("does not say whether it is a NOR or a PAR value");
  await expect(list).toContainText("comma between digits");
  await expect(list).toContainText("only counts as fill volume when the document gives a volume unit");
  await page.screenshot({ path: join(SHOTS, `i2-not-used-${test.info().project.name}.png`), fullPage: true });
  await expectNoHorizontalScroll(page, "not used yet");
  await expectAccessible(page, "not used yet");
});

test("a PDF with a table gives Matched rows with the page in the evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await openTrdList(page);
  await upload(page, "report.pdf", await foreignPdf(), "application/pdf");
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("A PDF in another layout");
  await expect(page.getByTestId("import-matched-table")).toHaveCount(1);
  await expect(page.getByTestId("import-matched-table")).toContainText("Page 1, table 1");
  await expect(page.getByText("Matched").first()).toBeVisible();
  await page.getByTestId("import-matched-table").getByTestId("import-accept-table").click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^1\d values taken, \d+ found and waiting for you, [1-9]\d* not in this document \(left open\)$/);
  await page.screenshot({ path: join(SHOTS, `i2-pdf-${test.info().project.name}.png`), fullPage: true });
  await expectNoHorizontalScroll(page, "pdf review");
  await expectAccessible(page, "pdf review");
});

test("a PDF that is a picture of text says so and offers the blank form", async ({ page }) => {
  await openTrdList(page);
  await upload(page, "scan.pdf", await pictureOnlyPdf(), "application/pdf");
  const msg = page.getByTestId("trd-upload-message");
  await expect(msg).toContainText("This PDF is a picture of text; save it from the original file as .docx or a text PDF.");
  await expect(page.getByTestId("trd-upload-blank-form")).toBeVisible();
  await expect(page.getByTestId("import-review")).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, `i2-scanned-${test.info().project.name}.png`) });
  await expectAccessible(page, "scanned message");
  await expectNoHorizontalScroll(page, "scanned message");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the level 3 review is accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openForeignDocx(page);
    await expectAccessible(page, `${scheme} review`);
    await expectNoHorizontalScroll(page, `${scheme} review`);
    // The document pane with merged cells, and picking from it.
    await page.getByTestId("import-matched-table").nth(1).getByRole("button", { name: /Show table/ }).click();
    await expectAccessible(page, `${scheme} document pane`);
    await expectNoHorizontalScroll(page, `${scheme} document pane`);
    await page.screenshot({ path: join(SHOTS, `i2-review-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.getByTestId("import-more").first().click();
    await page.getByTestId("import-pick").first().click();
    await expect(page.getByTestId("import-picking")).toBeVisible();
    await expectAccessible(page, `${scheme} picking`);
    await expectNoHorizontalScroll(page, `${scheme} picking`);
  });
}
