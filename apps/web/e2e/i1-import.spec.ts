// Job I1: upload a finished TRD, levels 1 and 2. A Word export of this tool carries its data and is read back exactly, a cell changed in
// Word becomes a "Changed in Word" row that stays open; the blank TRD form filled in offline is read back by its content controls and a
// control left empty is an open item. The review screen is accessible at three widths in light and dark. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, openDemo, openMoreWays } from "./nav-helper";

const SHOTS = tmpdir();
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function openTrdList(page: Page) {
  await loadDemo(page);
  await goTo(page, "TRD");
  await expect(page.getByTestId("trd-upload")).toBeVisible();
}

async function downloadOf(page: Page, click: () => Promise<void>): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

async function upload(page: Page, testId: string, name: string, buffer: Buffer, mimeType = DOCX) {
  await page.getByTestId(`${testId}-input`).setInputFiles({ name, mimeType, buffer });
}

function editXml(bytes: Buffer, edit: (xml: string) => string): Buffer {
  const zip = new PizZip(bytes);
  zip.file("word/document.xml", edit(zip.file("word/document.xml")!.asText()));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Puts a value into the content control with this tag, the way Word does when a person types into it. */
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

/** The Word export of the demo TRD (it carries its data), from the Document tab. */
async function exportDemoTrd(page: Page): Promise<Buffer> {
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
  const word = await downloadOf(page, () => page.getByRole("button", { name: "Download TRD (Word)" }).click());
  return word.bytes;
}

test("export, change one cell in Word, upload: a Changed in Word row that stays open until decided", async ({ page }) => {
  test.setTimeout(180_000);
  const phone = test.info().project.name;
  await openTrdList(page);
  await page.screenshot({ path: join(SHOTS, `i1-upload-button-trd-${phone}.png`) });
  const exported = await exportDemoTrd(page);
  let before = "";
  let after = "";
  const edited = editXml(exported, (xml) => {
    const m = />(\d+(?:\.\d+)?) to ([^<]+)</.exec(xml);
    expect(m, "a NOR or PAR range in the export").not.toBeNull();
    before = `${m![1]} to ${m![2]}`;
    after = `${Number(m![1]) + 1} to ${m![2]}`;
    return xml.replace(`>${before}<`, `>${after}<`);
  });

  await goTo(page, "TRD");
  await upload(page, "trd-upload", "my-trd.docx", edited);
  await expect(page).toHaveURL(/#\/trd\/import/);
  await expect(page.getByTestId("import-read-as")).toContainText("made by this tool");
  const change = page.getByTestId("import-change").first();
  await expect(change).toContainText("Changed in Word:");
  await expect(change).toContainText(before);
  await expect(change).toContainText(after);
  await expect(change).toContainText("→");
  await expect(change).not.toContainText("->");
  // Neither accepted nor rejected: the row stays open and the summary counts it.
  await expect(page.getByTestId("import-live-summary")).toContainText("1 changed in Word");
  await expect(page.getByTestId("import-field").filter({ has: page.getByTestId("import-change") }).first()).toContainText("Open: neither accepted nor rejected");
  await expect(page.getByTestId("import-field").filter({ has: page.getByTestId("import-change") }).first().getByText("Changed in Word").first()).toBeVisible();
  await change.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `i1-changed-in-word-${phone}.png`), fullPage: true });

  // The project has a TRD, so the upload asks what to do and nothing is preselected.
  await expect(page.getByTestId("import-target-new")).not.toBeChecked();
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-error")).toContainText("Choose whether");
  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("Imported from Word (fictional)");

  await page.getByTestId("import-accept-exact").click();
  await expect(page.getByTestId("import-bulk-status")).toContainText("accepted");
  await page.getByTestId("import-take-new").first().click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^\d+ values taken, \d+ still open, 1 changed in Word$/);
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-summary")).toHaveText(/^\d+ values taken, \d+ still open, 1 changed in Word$/);
  await page.screenshot({ path: join(SHOTS, `i1-summary-${phone}.png`), fullPage: true });

  await page.getByTestId("import-start-mbr").click();
  await expect(page).toHaveURL(/#\/mbr\?trd=TRD-\d+/);
  await expect(page.getByTestId("mbr-start-trd-select")).not.toHaveValue("");
});

test("the blank form, filled in offline, is read back; the cells left empty are open items", async ({ page }) => {
  test.setTimeout(180_000);
  await openTrdList(page);
  const blank = await downloadOf(page, () => page.getByTestId("trd-blank-form").click());
  expect(blank.file).toBe("trd-blank-form.docx");
  const tag = /w:tag w:val="(trd\.step\.([^."]+)\.param\.([^."]+))\.nor_low"/.exec(new PizZip(blank.bytes).file("word/document.xml")!.asText());
  expect(tag, "a parameter control in the blank form").not.toBeNull();
  const base = tag![1]!;
  const filled = editXml(blank.bytes, (xml) => {
    let x = fillControl(xml, "trd.purpose", "Move the process to the receiving unit (fictional).");
    x = fillControl(x, `${base}.set`, "10");
    x = fillControl(x, `${base}.nor_low`, "8");
    x = fillControl(x, `${base}.nor_high`, "12");
    return fillControl(x, `${base}.unit`, "mL");
  });
  await upload(page, "trd-upload", "form.docx", filled);
  await expect(page).toHaveURL(/#\/trd\/import/);
  await expect(page.getByTestId("import-read-as")).toContainText("fill-in form");
  await expect(page.getByTestId("import-accept-exact")).toContainText("(5)");
  // Nothing is taken until it is accepted.
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, \d+ still open$/);
  await page.getByTestId("import-accept-exact").click();
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^5 values taken, \d+ still open$/);
  await page.screenshot({ path: join(SHOTS, `i1-review-form-${test.info().project.name}.png`), fullPage: true });
  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("From the form (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-summary")).toHaveText(/^5 values taken, [1-9]\d* still open$/);
  await page.getByTestId("import-open-trd").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-open").click();
  await expect(page.getByRole("heading", { name: /open items/i }).first()).toBeVisible();
});

test("an unfilled form gives no values at all: every field stays open", async ({ page }) => {
  test.setTimeout(120_000);
  await openTrdList(page);
  const blank = await downloadOf(page, () => page.getByTestId("trd-blank-form").click());
  await upload(page, "trd-upload", "empty-form.docx", blank.bytes);
  await expect(page.getByTestId("import-live-summary")).toHaveText(/^0 values taken, [1-9]\d* still open$/);
  await expect(page.getByTestId("import-accept-exact")).toBeDisabled();
  await expect(page.getByTestId("import-accept-exact")).toContainText("(0)");
});

test("file rules: old Word formats and unreadable files get a plain message", async ({ page }) => {
  await openTrdList(page);
  await upload(page, "trd-upload", "old.doc", Buffer.from("x"), "application/msword");
  await expect(page.getByTestId("trd-upload-message")).toHaveText("Save it as .docx or PDF first.");
  await upload(page, "trd-upload", "other.pdf", Buffer.from("%PDF-1.4"), "application/pdf");
  await expect(page.getByTestId("trd-upload-message")).toContainText("The PDF could not be read. It may be damaged.");
  await expect(page.getByTestId("trd-upload-blank-form")).toBeVisible();
  await upload(page, "trd-upload", "broken.docx", Buffer.from("not a zip"));
  await expect(page.getByTestId("trd-upload-message")).toContainText("not a valid Word document");
});

test("Home offers the upload and the blank form", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Home");
  await openMoreWays(page);
  const block = page.getByTestId("home-start-from-document");
  await expect(block).toContainText("A technical requirements document (TRD)");
  await expect(page.getByTestId("home-upload-trd")).toBeVisible();
  await expect(page.getByTestId("home-blank-form")).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `i1-upload-button-home-${test.info().project.name}.png`) });
});

test("compact review: one row per parameter, row Accept, step Accept, Edit, the More menu and the page height", async ({ page }) => {
  test.setTimeout(180_000);
  const phone = test.info().project.name;
  await openTrdList(page);
  const exported = await exportDemoTrd(page);
  await goTo(page, "TRD");
  await upload(page, "trd-upload", "my-trd.docx", exported);
  await expect(page.getByTestId("import-review")).toBeVisible();
  const rows = page.locator("[data-testid=import-param-table] tr.import-prow");
  expect(await rows.count()).toBeGreaterThan(3);
  // One row per parameter: the name, set point, NOR and PAR as ranges, unit, the reading word and the actions.
  const first = rows.first();
  await expect(first.getByTestId("import-row-accept")).toBeVisible();
  await expect(first).toContainText("Exact");
  await expect(first).toContainText(/\d+(\.\d+)? to \d+(\.\d+)?/);
  await expect(first).toContainText("not accepted yet");
  // The source is one short line, in the More menu only; no path is repeated on every value.
  await expect(page.getByText("The data stored in the Word file")).toHaveCount(0);
  await first.getByTestId("import-more").click();
  await expect(first.getByTestId("import-source").first()).toHaveText("From the data saved in the Word file");
  await first.getByTestId("import-more").click();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  test.info().annotations.push({ type: "page-height", description: `${height}px` });
  await page.screenshot({ path: join(SHOTS, `i1-review-compact-${phone}.png`), fullPage: true });
  // A row's Accept takes that row's values only.
  const exactBefore = Number(/\((\d+)\)/.exec((await page.getByTestId("import-accept-exact").textContent()) ?? "")?.[1]);
  await first.getByTestId("import-row-accept").click();
  await expect(first).toHaveAttribute("data-state", "accepted");
  await expect(first).toContainText("Accepted");
  await expect(first.getByTestId("import-row-accept")).toBeDisabled();
  const exactAfter = Number(/\((\d+)\)/.exec((await page.getByTestId("import-accept-exact").textContent()) ?? "")?.[1]);
  expect(exactAfter).toBeLessThan(exactBefore);
  expect(exactAfter).toBeGreaterThan(0);
  // The step's own accept.
  const stepButton = page.getByTestId("import-step-accept").first();
  await expect(stepButton).toContainText("Accept all exact in this step");
  await stepButton.click();
  await expect(page.getByTestId("import-bulk-status")).toContainText("accepted");
  await expect(stepButton).toBeDisabled();
  // Edit a row inline: the value typed is accepted and shown in the cell.
  const second = rows.nth(1);
  await second.getByTestId("import-edit").click();
  await page.getByTestId("import-edit-input").first().fill("99");
  await page.getByTestId("import-edit-save").click();
  await expect(second).toContainText("99");
  await expectNoHorizontalScroll(page, "compact review");
  await expectAccessible(page, "compact review");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the review screen is accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openTrdList(page);
    const exported = await exportDemoTrd(page);
    const edited = editXml(exported, (xml) => {
      const m = />(\d+(?:\.\d+)?) to ([^<]+)</.exec(xml)!;
      return xml.replace(`>${m[1]} to ${m[2]}<`, `>${Number(m[1]) + 1} to ${m[2]}<`);
    });
    await goTo(page, "TRD");
    await expectAccessible(page, `${scheme} TRD page`);
    await upload(page, "trd-upload", "my-trd.docx", edited);
    await expect(page.getByTestId("import-review")).toBeVisible();
    await expectAccessible(page, `${scheme} review screen`);
    await expectNoHorizontalScroll(page, `${scheme} review screen`);
    await page.screenshot({ path: join(SHOTS, `i1-review-${test.info().project.name}-${scheme}.png`), fullPage: true });
    // Picking from the document: the cells become buttons.
    await page.getByTestId("import-more").first().click();
    await page.getByTestId("import-pick").first().click();
    await expect(page.getByTestId("import-picking")).toBeVisible();
    await expectAccessible(page, `${scheme} picking`);
    await expectNoHorizontalScroll(page, `${scheme} picking`);
  });
}

test("the form with what we know so far carries the TRD's own values and reads back", async ({ page }) => {
  test.setTimeout(120_000);
  await openTrdList(page);
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-output").click();
  const form = await downloadOf(page, () => page.getByTestId("trd-form-so-far").click());
  expect(form.file).toMatch(/^trd-form-TRD-\d+\.docx$/);
  await goTo(page, "TRD");
  await upload(page, "trd-upload", form.file, form.bytes);
  await expect(page.getByTestId("import-read-as")).toContainText("fill-in form");
  const exactCount = Number(/\((\d+)\)/.exec((await page.getByTestId("import-accept-exact").textContent()) ?? "")?.[1]);
  expect(exactCount).toBeGreaterThan(5);
});
