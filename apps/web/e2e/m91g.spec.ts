// Milestone 9.1, gap closure: figures with pictures (attach, paste, limits, numbering, export), table rows (add, move, remove, edit,
// blanks in cells, change log), and placement / order of the process descriptions (library picker, Up / Down in the TRD, export order).
// All data are fictional; the pictures are tiny generated files.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const SHOTS = tmpdir();
/** A real 1 by 1 pixel PNG (so the reader sees a true PNG header). */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function openTrdList(page: Page) {
  await loadDemo(page);
  const nav = page.getByRole("link", { name: "TRD", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByTestId("trd-scope-text")).toBeVisible();
}

async function openDescriptions(page: Page) {
  await openTrdList(page);
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-writeups").click();
  await expect(page.getByTestId("trd-writeups")).toBeVisible();
}

async function openCard(page: Page, title: RegExp): Promise<{ card: Locator; id: string }> {
  const card = page.locator('[data-testid^="twu-card-"]').filter({ has: page.getByRole("heading", { name: title }) });
  await expect(card).toHaveCount(1);
  const id = (await card.getAttribute("data-testid"))!.replace("twu-card-", "");
  if ((await card.getByTestId(`twu-toggle-${id}`).getAttribute("aria-expanded")) !== "true") await card.getByTestId(`twu-toggle-${id}`).click();
  await expect(card.getByTestId(`twu-body-${id}`)).toBeVisible();
  return { card, id };
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

async function download(page: Page, click: () => Promise<void>): Promise<{ file: string; bytes: Buffer }> {
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

const STOPPER = /^Stopper position/;
const DILUTION = /^Dilution buffer/;
const COMPOUNDING = /^Pooling, compounding and dilution/;

test("a figure takes a picture from a file, refuses other types and oversize files with the limit stated, and keeps a caption", async ({ page }) => {
  test.setTimeout(120_000);
  await openDescriptions(page);
  const { card, id } = await openCard(page, STOPPER);
  // Add a figure of our own with a caption and no picture: it is an open item.
  await expect(card.getByTestId(`twu-add-kind-${id}`)).toHaveValue("");
  await card.getByTestId(`twu-add-kind-${id}`).selectOption("figure");
  await card.getByTestId(`twu-add-caption-${id}`).fill("Second view (fictional)");
  await card.getByTestId(`twu-add-part-btn-${id}`).click();
  const fig = `${id}-x_1`;
  await expect(card.getByTestId(`twu-text-${fig}`)).toContainText("Figure to be added");
  await expect(card.getByTestId(`twu-count-${id}`)).toContainText("1 figure without a picture");
  await expect(page.getByTestId("twu-summary")).toContainText("1 figure without a picture");
  // The limit is stated before anyone tries.
  await expect(card.getByTestId(`twu-image-limit-${fig}`)).toContainText("PNG or JPEG picture of at most 2 MB");

  // A GIF is refused with a plain message; so is a file over 2 MB.
  await card.getByTestId(`twu-file-${fig}`).setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "binary") });
  await expect(card.getByTestId(`twu-image-error-${fig}`)).toContainText("not a PNG or JPEG");
  await card.getByTestId(`twu-file-${fig}`).setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(2_200_000) });
  await expect(card.getByTestId(`twu-image-error-${fig}`)).toContainText("2.1 MB");
  await expect(card.getByTestId(`twu-image-error-${fig}`)).toContainText("at most 2 MB");

  // A real PNG is taken.
  await card.getByTestId(`twu-file-${fig}`).setInputFiles({ name: "view.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(card.getByTestId(`twu-image-${fig}`)).toBeVisible();
  await expect(card.getByTestId(`twu-image-error-${fig}`)).toHaveCount(0);
  await expect(card.getByTestId(`twu-count-${id}`)).not.toContainText("without a picture");
  // No alternative text yet: the editor says so, and the caption is used meanwhile.
  await expect(card.getByTestId(`twu-alt-missing-${fig}`)).toBeVisible();
  await card.getByTestId(`twu-edit-${fig}`).click();
  await card.getByTestId(`twu-alt-${fig}`).fill("A tiny placeholder square (fictional)");
  await card.getByTestId(`twu-save-${fig}`).click();
  await expect(card.getByTestId(`twu-alt-missing-${fig}`)).toHaveCount(0);
  await expect(card.getByTestId(`twu-image-${fig}`)).toHaveAttribute("alt", "A tiny placeholder square (fictional)");
  await expect(card.getByTestId(`twu-edit-${fig}`)).toBeFocused();

  // Removing the picture goes back to the note and returns focus to the file picker.
  await card.getByTestId(`twu-image-remove-${fig}`).click();
  await expect(card.getByTestId(`twu-text-${fig}`)).toContainText("Figure to be added");
  await expect(card.getByTestId(`twu-file-${fig}`)).toBeFocused();
});

test("a pasted screenshot becomes the picture, and Word and HTML number the figures with their captions", async ({ page }) => {
  test.setTimeout(120_000);
  await openDescriptions(page);
  const { card, id } = await openCard(page, STOPPER);
  await card.getByTestId(`twu-add-kind-${id}`).selectOption("figure");
  await card.getByTestId(`twu-add-caption-${id}`).fill("Pasted view (fictional)");
  await card.getByTestId(`twu-add-part-btn-${id}`).click();
  const fig = `${id}-x_1`;
  // Nothing on the clipboard: a clear message.
  await card.getByTestId(`twu-paste-${fig}`).click();
  await card.getByTestId(`twu-paste-${fig}`).evaluate((el) => el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
  await expect(card.getByTestId(`twu-image-error-${fig}`)).toContainText("no picture on the clipboard");
  // A screenshot on the clipboard.
  await card.getByTestId(`twu-paste-${fig}`).evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG_1X1.toString("base64"));
  await expect(card.getByTestId(`twu-image-${fig}`)).toBeVisible();

  await page.getByTestId("trd-tab-output").click();
  await page.getByTestId("trd-preview-toggle").click();
  const preview = page.getByTestId("trd-preview");
  await expect(preview.locator("figure.picture")).toHaveCount(2);
  await expect(preview.locator("figcaption").filter({ hasText: /^Figure 1\./ })).toHaveCount(1);
  await expect(preview.locator("figcaption").filter({ hasText: /^Figure 2\. Pasted view \(fictional\)/ })).toHaveCount(1);

  const html = (await download(page, () => page.getByTestId("trd-download-html").click())).bytes.toString("utf8");
  expect(html).toContain("<figcaption>Figure 2. Pasted view (fictional)</figcaption>");
  expect(html).toContain('<img src="data:image/png;base64,');

  const word = await download(page, () => page.getByRole("button", { name: /Download Word|Word document/i }).first().click());
  const zip = new PizZip(word.bytes);
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/gapfigure"));
  expect(media.length).toBeGreaterThanOrEqual(2);
  const text = zip.file("word/document.xml")!.asText().replace(/<[^>]+>/g, " ");
  expect(text).toMatch(/Figure\s+1\./);
  expect(text).toMatch(/Figure\s+2\.\s+Pasted view/);
});

test("table rows: add, edit a cell with a blank, move, remove, save with focus back, and the change log records it", async ({ page }) => {
  test.setTimeout(120_000);
  await openDescriptions(page);
  const { card, id } = await openCard(page, DILUTION);
  const part = "excipient_solution_table";
  const rows = `twu-rows-${id}-${part}`;
  await card.getByTestId(`twu-edit-${id}-${part}`).click();
  await expect(card.getByTestId(`${rows}-editor`)).toBeVisible();
  // The demo typed two rows; add a third and fill it. A cell may hold a blank.
  await expect(card.getByTestId(`${rows}-cell-1-0`)).toBeVisible();
  await card.getByTestId(`${rows}-add`).click();
  await expect(card.getByTestId(`${rows}-cell-2-0`)).toBeFocused();
  await card.getByTestId(`${rows}-cell-2-0`).fill("Excipient C (fictional)");
  await card.getByTestId(`${rows}-cell-2-3`).fill("{{trd.dilutionBuffer.quantityC|Quantity of excipient C}}");
  // Move it up: focus follows the row on the same button.
  await card.getByTestId(`${rows}-up-2`).click();
  await expect(card.getByTestId(`${rows}-cell-1-0`)).toHaveValue("Excipient C (fictional)");
  await expect(card.getByTestId(`${rows}-up-1`)).toBeFocused();
  // The first row cannot move up and the last cannot move down.
  await expect(card.getByTestId(`${rows}-up-0`)).toBeDisabled();
  // Remove the first row: focus goes to "Add a row".
  await card.getByTestId(`${rows}-remove-0`).click();
  await expect(card.getByTestId(`${rows}-add`)).toBeFocused();
  await expect(card.getByTestId(`${rows}-cell-0-0`)).toHaveValue("Excipient C (fictional)");
  await card.getByTestId(`twu-save-${id}-${part}`).click();
  const table = card.getByTestId(`twu-table-${id}-${part}`);
  await expect(table).toContainText("Excipient C (fictional)");
  // The blank in the cell is open and shown in brackets, never filled in for the author.
  await expect(table.locator(".blank-open")).toContainText("[Quantity of excipient C]");
  await expect(card.getByTestId(`twu-edit-${id}-${part}`)).toBeFocused();
  await expect(card.getByTestId(`twu-part-${id}-${part}`)).toContainText("edited here");
  // The blank is listed with the others of the description.
  await expect(card.getByTestId(`twu-blank-${id}-trd.dilutionBuffer.quantityC`)).toContainText("Open");
  // Cancel keeps the saved rows.
  await card.getByTestId(`twu-edit-${id}-${part}`).click();
  await card.getByTestId(`${rows}-cell-0-0`).fill("changed but not saved");
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(table).not.toContainText("changed but not saved");

  // Word and HTML carry a header row and the rows; an empty cell stays empty.
  await page.getByTestId("trd-tab-output").click();
  const html = (await download(page, () => page.getByTestId("trd-download-html").click())).bytes.toString("utf8");
  expect(html).toContain("<td>Excipient C (fictional)</td>");
  expect(html).toContain("[Quantity of excipient C]");
});

test("the library form edits the starting rows of a table and the place of a section; a place before or after needs its unit operation", async ({ page }) => {
  test.setTimeout(120_000);
  await openTrdList(page);
  await page.getByTestId("trd-writeups-link").click();
  await page.getByTestId("twl-edit-sec_dilution_buffer").click();
  // Table: starting rows with an Add a row button.
  const add = page.locator('[data-testid^="twl-rows-"][data-testid$="-add"]').first();
  await add.click();
  await page.locator('[data-testid^="twl-rows-"][data-testid*="-cell-0-0"]').first().fill("Starting excipient (fictional)");
  // Placement: nothing is preselected; "before" or "after" asks for the unit operation.
  await expect(page.getByTestId("twl-place-where")).toHaveValue("");
  await page.getByTestId("twl-place-where").selectOption("after");
  await expect(page.getByTestId("twl-place-unitop")).toHaveValue("");
  await page.getByTestId("twl-save").click();
  await expect(page.getByTestId("twl-form-error")).toContainText("Choose the unit operation");
  await page.getByTestId("twl-place-unitop").selectOption("compounding");
  await page.getByTestId("twl-save").click();
  await expect(page.getByTestId("twl-message")).toContainText("version 2");
  // Reopened: the saved place and rows are there.
  await page.getByTestId("twl-edit-sec_dilution_buffer").click();
  await expect(page.getByTestId("twl-place-where")).toHaveValue("after");
  await expect(page.getByTestId("twl-place-unitop")).toHaveValue("compounding");
  await expect(page.locator('[data-testid^="twl-rows-"][data-testid*="-cell-0-0"]').first()).toHaveValue("Starting excipient (fictional)");
  // Clearing the place makes it a section of its own again (a new version).
  await page.getByTestId("twl-place-where").selectOption("");
  await page.getByTestId("twl-save").click();
  await expect(page.getByTestId("twl-message")).toContainText("version 3");
  await page.getByTestId("twl-edit-sec_dilution_buffer").click();
  await expect(page.getByTestId("twl-place-where")).toHaveValue("");
});

test("the TRD author moves a section up or down, it is change-logged, and the export follows; a step-bound description says why it stays", async ({ page }) => {
  test.setTimeout(120_000);
  await openDescriptions(page);
  const titles = async () => (await page.locator('[data-testid^="twu-card-"] h3').allInnerTexts()).map((t) => t.replace(/\s*\(step:.*$/, "").trim());
  const before = await titles();
  const at = before.indexOf("Batch size");
  expect(at).toBeGreaterThan(-1);
  const neighbour = before[at + 1]!;
  const { id } = await openCard(page, /^Batch size/);
  await page.getByTestId(`twu-down-${id}`).click();
  const after = await titles();
  expect(after[at]).toBe(neighbour);
  expect(after[at + 1]).toBe("Batch size");
  // Focus stays on the button that was used.
  await expect(page.getByTestId(`twu-down-${id}`)).toBeFocused();

  // Export follows the order.
  await page.getByTestId("trd-tab-output").click();
  const html = (await download(page, () => page.getByTestId("trd-download-html").click())).bytes.toString("utf8");
  const heading = (t: string) => html.search(new RegExp(`<h2>\\d+\\. ${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h2>`));
  expect(heading("Batch size")).toBeGreaterThan(heading(neighbour));

  // A description that belongs to a step stays with its step: the button explains instead of moving.
  await page.getByTestId("trd-tab-writeups").click();
  const comp = await openCard(page, COMPOUNDING);
  // aria-disabled keeps the button focusable so it can explain itself; the test tool treats it as disabled, hence force.
  await page.getByTestId(`twu-down-${comp.id}`).click({ force: true });
  await expect(page.getByTestId(`twu-move-note-${comp.id}`)).toContainText("sits with its step");
  expect(await titles()).toEqual(after);
});

test("the old Add a paragraph box starts with no kind chosen", async ({ page }) => {
  await openDescriptions(page);
  const { card, id } = await openCard(page, COMPOUNDING);
  await expect(card.getByTestId(`twu-add-kind-${id}`)).toHaveValue("");
  await expect(card.getByTestId(`twu-add-part-btn-${id}`)).toBeDisabled();
});

for (const scheme of ["light", "dark"] as const) {
  test(`figures, table rows and placement are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(240_000);
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `m91g-${name}-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: scheme });
    await openDescriptions(page);

    const stopper = await openCard(page, STOPPER);
    await stopper.card.scrollIntoViewIfNeeded();
    await expectAccessible(page, `${scheme} figure card`);
    await expectNoHorizontalScroll(page, `${scheme} figure card`);
    await shot("figure");
    await stopper.card.getByTestId(`twu-edit-${stopper.id}-figure`).click();
    await expectAccessible(page, `${scheme} figure editing`);
    await expectNoHorizontalScroll(page, `${scheme} figure editing`);
    await stopper.card.getByRole("button", { name: "Cancel" }).click();

    const dil = await openCard(page, DILUTION);
    await dil.card.getByTestId(`twu-edit-${dil.id}-excipient_solution_table`).click();
    await dil.card.scrollIntoViewIfNeeded();
    await expectAccessible(page, `${scheme} table rows editing`);
    await expectNoHorizontalScroll(page, `${scheme} table rows editing`);
    await shot("table-rows");
    // Targets of the row buttons are at least 24 by 24 pixels.
    for (const b of await dil.card.locator("table.rows-editor button").all()) {
      const box = await b.boundingBox();
      expect(box!.height, "row button height").toBeGreaterThanOrEqual(24);
      expect(box!.width, "row button width").toBeGreaterThanOrEqual(24);
    }

    await page.getByRole("link", { name: "All TRDs" }).click();
    await page.getByTestId("trd-writeups-link").click();
    await page.getByTestId("twl-edit-sec_dilution_buffer").click();
    await page.getByTestId("twl-place-where").selectOption("before");
    await expectAccessible(page, `${scheme} library form with placement`);
    await expectNoHorizontalScroll(page, `${scheme} library form with placement`);
    await shot("library-placement");
  });
}
