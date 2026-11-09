// Job I3: upload a finished SAMPLING PLAN (levels 1 to 3), on the same upload pieces as the TRD.
//  - Level 1: our own Word export, one cell typed over in Word is a "Changed in Word" row that stays open until decided.
//  - Level 2: the blank form filled in offline; an unfilled row is not a point.
//  - Level 3: a Word file in another layout and a PDF; every value is "Matched", accepted per table.
// The review is ONE ROW PER SAMPLING POINT, accessible at three widths in light and dark, and short on a phone.
// All files are fictional and built by the test (packages/docx/test/i3-foreign.ts).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { foreignDocx, pictureOnlyPdf } from "../../../packages/docx/test/i2-foreign";
import { foreignSamplingBodyXml, foreignSamplingPdf } from "../../../packages/docx/test/i3-foreign";
import { goTo, openDemo, openMoreWays } from "./nav-helper";

const SHOTS = tmpdir();
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
// Real step names of the catalogue (the foreign files name steps the way a person would).
const STEP_A = "Sterile filtration";
const STEP_B = "Aseptic filling and stoppering";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openSamplingList(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await expect(page.getByTestId("sampling-upload")).toBeVisible();
}

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

/** The Word export of the first plan (it carries its data), from the plan's Overview. */
async function exportDemoPlan(page: Page): Promise<Buffer> {
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("sampling-download-word")).toBeVisible();
  return downloadOf(page, () => page.getByTestId("sampling-download-word").click());
}

const openForeign = async (page: Page) => {
  await openSamplingList(page);
  await upload(page, "sampling-upload", "other-layout.docx", foreignDocx(foreignSamplingBodyXml(STEP_A, STEP_B)));
  await expect(page.getByTestId("import-review")).toBeVisible();
};

test("a Word file in another layout: one row per point, Matched values, accepted per table, values reach the plan", async ({ page }) => {
  test.setTimeout(180_000);
  const name = test.info().project.name;
  await openForeign(page);
  await expect(page.getByTestId("import-read-as")).toContainText("another layout");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, [1-9]\d* found and waiting for you, \d+ not in this document \(left open\)$/);
  // A suggestion is never part of a bulk "exact" button at this level.
  await expect(page.getByTestId("import-accept-exact")).toHaveCount(0);
  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("Fill volume");
  await expect(rows.first()).toContainText(STEP_A);
  await expect(rows.first()).toContainText("Matched");
  // An unreadable amount cannot be accepted as it stands, and says why in words.
  await expect(rows.nth(2)).toContainText("has no unit");
  await expect(rows.nth(2).getByRole("button", { name: /^Accept Amount per sample/ })).toBeDisabled();
  // An unclear type is not accepted for the person.
  await expect(rows.nth(4).getByTestId("import-cell-type")).toContainText("Not found");
  await expect(rows.nth(4).getByTestId("import-cell-type")).toContainText("not one of the study types");
  await expect(rows.nth(4).getByTestId("import-cell-type")).not.toContainText("Matched");
  // A step that is no step of this project is Not found, never Matched.
  await expect(rows.nth(5).getByTestId("import-cell-step")).toContainText("Not found");
  await expect(rows.nth(5).getByTestId("import-cell-step")).toContainText("no process step of this project is called this");
  await expect(rows.nth(5).getByTestId("import-cell-step")).not.toContainText("Matched");
  await expect(page.getByTestId("import-not-used")).toContainText("Some step of our own");

  const tables = page.getByTestId("import-matched-table");
  await expect(tables).toHaveCount(2);
  await page.screenshot({ path: join(SHOTS, `i3-review-${name}.png`), fullPage: true });
  // All six values of a point are visible without sideways scrolling (a table on a wide screen, stacked blocks on a tablet or phone).
  const region = page.getByRole("region", { name: "Sampling points read from the file" });
  expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const c of ["Amount per sample", "Timing", "Type"]) await expect(rows.first().getByTestId(`import-cell-${c === "Amount per sample" ? "amount" : c.toLowerCase()}`)).toBeVisible();
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`I3 review page height ${name}: ${pageHeight}`);
  await expectNoHorizontalScroll(page, "level 3 review");
  await expectAccessible(page, "level 3 review");

  await tables.first().getByTestId("import-accept-table").click();
  await expect(page.getByTestId("import-bulk-status")).toContainText("accepted");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^[1-9]\d* values taken, /);
  await expect(tables.first().getByTestId("import-accept-table")).toBeDisabled();
  await expect(tables.nth(1).getByTestId("import-accept-table")).toBeEnabled();
  // Accept the second table one row at a time.
  await rows.nth(3).getByTestId("import-accept-row").click();
  await expect(rows.nth(3)).toContainText("Accepted");

  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-use-title").click();
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toHaveText(/found and waiting for you/);
  await expect(page.getByTestId("import-added")).toContainText("points added");
  await page.screenshot({ path: join(SHOTS, `i3-done-${name}.png`), fullPage: true });
  await expectAccessible(page, "done screen");
  await page.getByTestId("import-open-plan").click();
  await expect(page.locator("main")).toContainText("Sampling Overview for the Receiving Unit");
});

test("a rejected or untouched row is not added, and the plan says what it did not use", async ({ page }) => {
  await openForeign(page);
  const list = page.getByTestId("import-not-used");
  await expect(list).toBeVisible();
  await expect(list.locator("summary")).toContainText("Not used yet");
  if (!(await list.evaluate((el) => (el as HTMLDetailsElement).open))) await list.locator("summary").click();
  await expect(list).toContainText("Table 3");
  await expect(list).toContainText("24 hours");
  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("Nothing accepted");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-added")).toContainText("0 points added");
  await expect(page.getByTestId("import-warnings").or(page.getByTestId("import-summary"))).toBeVisible();
});

test("export, change one cell in Word, upload: a Changed in Word row that stays open until decided", async ({ page }) => {
  test.setTimeout(180_000);
  await openSamplingList(page);
  const exported = await exportDemoPlan(page);
  let oldAttr = "";
  void oldAttr;
  const edited = editXml(exported, (xml) => {
    const head = xml.indexOf("Attribute / test");
    const id = xml.indexOf(">SP-", head);
    const m = /<w:t[^>]*>([^<]+?) \(/.exec(xml.slice(id + 10));
    expect(m, "attribute cell").not.toBeNull();
    oldAttr = m![1]!;
    const at = id + 10 + m!.index;
    const tag = /<w:t[^>]*>/.exec(m![0])![0];
    return xml.slice(0, at) + tag + "Edited in Word " + m![0].slice(tag.length) + xml.slice(at + m![0].length);
  });
  await goTo(page, "Sampling plan");
  await upload(page, "sampling-upload", "my-plan.docx", edited);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("made by this tool");
  const changed = page.getByTestId("import-changed");
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText("Changed in Word");
  await expect(changed).toContainText("Edited in Word");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/changed in Word$/);
  await expect(page.getByTestId("import-live-summary")).toContainText("1 changed in Word");
  // Neither accepted nor rejected by default: nothing is taken.
  await expect(page.getByTestId("import-live-summary")).toContainText("0 values taken");
  await page.screenshot({ path: join(SHOTS, `i3-changed-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "changed row");
  await changed.getByTestId("import-use-file").click();
  await expect(changed.getByTestId("import-state")).toHaveText("Taken from the file");
  await expect(page.getByTestId("import-live-summary")).toContainText("1 value taken");
  await page.locator('input[name="import-target"]').nth(1).check();
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-added")).toContainText("1 point updated");
  await page.getByTestId("import-open-plan").click();
  await expect(page.locator("main")).toContainText("Edited in Word");
});

test("the blank form, filled in offline, is read back; a row nobody touched is not a point", async ({ page }) => {
  test.setTimeout(180_000);
  await openSamplingList(page);
  const blank = await downloadOf(page, () => page.getByTestId("sampling-blank-form").click());
  const filled = editXml(blank, (xml) => {
    let x = fillControl(xml, "sampling.title", "Plan from the form (fictional)");
    x = fillControl(x, "sampling.row.1.step", STEP_A);
    x = fillControl(x, "sampling.row.1.attribute", "Bioburden");
    x = fillControl(x, "sampling.row.1.amount", "100 mL");
    x = fillControl(x, "sampling.row.1.type", "Release");
    return x;
  });
  await upload(page, "sampling-upload", "my-form.docx", filled);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("fill-in form");
  await expect(page.getByTestId("import-row")).toHaveCount(1);
  await expect(page.getByTestId("import-row").first()).toContainText("Exact");
  await expect(page.getByTestId("import-not-used")).toContainText("empty rows");
  await page.getByTestId("import-accept-exact").click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^5 values taken, \d+ still open$/);
  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-use-title").click();
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-added")).toContainText("1 point added");
  await page.getByTestId("import-open-plan").click();
  await expect(page.locator("main")).toContainText("Plan from the form (fictional)");
  await expect(page.locator("main")).toContainText("Bioburden");
});

test("an unfilled form gives no rows at all", async ({ page }) => {
  await openSamplingList(page);
  const blank = await downloadOf(page, () => page.getByTestId("sampling-blank-form").click());
  await upload(page, "sampling-upload", "empty-form.docx", blank);
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-row")).toHaveCount(0);
  await expect(page.getByTestId("import-fields")).toContainText("No sampling point was found");
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken/);
});

test("a PDF with a points table gives Matched rows", async ({ page }) => {
  test.setTimeout(120_000);
  await openSamplingList(page);
  await upload(page, "sampling-upload", "plan.pdf", await foreignSamplingPdf(STEP_A), "application/pdf");
  await expect(page.getByTestId("import-review")).toBeVisible();
  await expect(page.getByTestId("import-read-as")).toContainText("PDF");
  await expect(page.getByTestId("import-row")).toHaveCount(2);
  await expect(page.getByTestId("import-row").first()).toContainText("Fill volume");
  await page.screenshot({ path: join(SHOTS, `i3-pdf-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "pdf review");
  await expectNoHorizontalScroll(page, "pdf review");
});

test("file rules: a picture-only PDF and a TRD file get a plain message with a way forward", async ({ page }) => {
  await openSamplingList(page);
  await upload(page, "sampling-upload", "scan.pdf", await pictureOnlyPdf(), "application/pdf");
  const msg = page.getByTestId("sampling-upload-message");
  await expect(msg).toContainText("This PDF is a picture of text");
  await expect(page.getByTestId("sampling-upload-blank-form")).toBeVisible();
  await expect(page.getByTestId("import-review")).toHaveCount(0);
  await upload(page, "sampling-upload", "old.doc", Buffer.from("x"), "application/msword");
  await expect(msg).toContainText("Save it as .docx or PDF first.");
  await expectAccessible(page, "message");
  await expectNoHorizontalScroll(page, "message");
});

test("Home and the sampling page offer the upload and the blank form", async ({ page }) => {
  await openSamplingList(page);
  await expect(page.getByTestId("sampling-blank-form")).toBeVisible();
  await goTo(page, "Home");
  await openMoreWays(page);
  const block = page.getByTestId("home-start-from-sampling-document");
  await expect(block).toContainText("A sampling plan");
  await openMoreWays(page);
  await expect(page.getByTestId("home-upload-sampling")).toBeVisible();
  await expect(page.getByTestId("home-sampling-blank-form")).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `i3-upload-button-home-${test.info().project.name}.png`) });
});

test("compact review: a short page, row Accept, inline Edit", async ({ page }) => {
  test.setTimeout(180_000);
  await openForeign(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  test.info().annotations.push({ type: "page-height", description: `${height}px` });
  // 6 rows: the page stays well under what a card per value would need (the TRD review once reached 30,000 px on a phone).
  expect(height).toBeLessThan(9000);
  const first = page.getByTestId("import-row").first();
  await first.getByRole("button", { name: /^Edit Attribute/ }).click();
  await page.getByTestId("import-edit-input").fill("Fill volume (edited)");
  await page.getByTestId("import-edit-save").click();
  await expect(first).toContainText("Fill volume (edited)");
  await expect(first).toContainText("Accepted (edited)");
  await first.getByTestId("import-accept-row").click();
  await expect(first).toContainText("Accepted");
  await expectNoHorizontalScroll(page, "compact review");
  await expectAccessible(page, "compact review");
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
    await page.screenshot({ path: join(SHOTS, `i3-review-${test.info().project.name}-${scheme}.png`), fullPage: true });
  });
}
