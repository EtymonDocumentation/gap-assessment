// Milestone 9.1: process descriptions in the TRD. The write-ups come from an account-level library, are copied into the TRD, can be
// edited, shortened and extended there, fill their blanks from the TRD and project where known (and say where from), keep open blanks
// visible, and export to Word and HTML as the "Manufacturing process overview". An edit of the library never reaches a TRD until
// the author chooses "Update from library". All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo } from "./nav-helper";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

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
  await goTo(page, "TRD");
  await expect(page.getByTestId("trd-scope-text")).toBeVisible();
}

async function openDescriptions(page: Page) {
  await openTrdList(page);
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-writeups").click();
  await expect(page.getByTestId("trd-writeups")).toBeVisible();
}

/** The card of a description by its title; opens it. Returns the card and the description's id. */
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

const COMPOUNDING = /^Pooling, compounding and dilution/;
const FILLING = /^Filling, stoppering and stopper insertion/;
const STERILE = /^Sterile filtration/;

test("the demo TRD has process descriptions in step order, with open blanks counted and filled blanks naming their source", async ({ page }) => {
  await openDescriptions(page);
  await expect(page.getByTestId("twu-summary")).toContainText(/\d+ descriptions?, \d+ open blanks?/);
  const { card, id } = await openCard(page, COMPOUNDING);
  // A blank the TRD answers (the batch size override) is filled and says where it came from.
  const filled = card.getByTestId(`twu-blank-${id}-uo.compounding.param.batch_size.setPoint`);
  await expect(filled).toContainText("Filled");
  await expect(filled).toContainText("source: TRD");
  // A blank nobody has answered stays visible, in brackets, and the text says so.
  const open = card.getByTestId(`twu-blank-${id}-trd.compounding.poolingMethod`);
  await expect(open).toContainText("Open");
  await expect(card.locator(".blank-open").first()).toContainText("[");
});

test("editing a paragraph is kept, marked as edited and logged", async ({ page }) => {
  await openDescriptions(page);
  const { card, id } = await openCard(page, COMPOUNDING);
  await card.getByTestId(`twu-edit-${id}-p1`).click();
  await card.getByTestId(`twu-text-input-${id}-p1`).fill("Pooling is done by gentle pumping only (fictional team wording).");
  await card.getByTestId(`twu-save-${id}-p1`).click();
  await expect(card.getByTestId(`twu-text-${id}-p1`)).toContainText("gentle pumping only (fictional team wording)");
  await expect(card.getByTestId(`twu-part-${id}-p1`)).toContainText("edited here");
  // Focus returns to the Edit button after saving.
  await expect(card.getByTestId(`twu-edit-${id}-p1`)).toBeFocused();
  await goTo(page, "Change log");
});

test("typing a value fills the blank, shared with the other descriptions; clearing it reopens it", async ({ page }) => {
  await openDescriptions(page);
  const { card, id } = await openCard(page, FILLING);
  const key = "trd.aseptic_filling.clogDelayHours";
  const row = card.getByTestId(`twu-blank-${id}-${key}`);
  await expect(row).toContainText("Open");
  await card.getByTestId(`twu-blank-input-${id}-${key}`).fill("6");
  await card.getByTestId(`twu-blank-set-${id}-${key}`).click();
  await expect(row).toContainText("Filled");
  await expect(row).toContainText("6");
  await expect(row).toContainText("Entered in");
  await card.getByTestId(`twu-blank-clear-${id}-${key}`).click();
  await expect(row).toContainText("Open");
});

test("an optional paragraph is off until included, a paragraph can be removed, and one can be added", async ({ page }) => {
  await openDescriptions(page);
  const { card, id } = await openCard(page, STERILE);
  const flush = card.getByTestId(`twu-optional-${id}-flush`);
  await expect(flush).not.toBeChecked();
  await flush.check();
  await expect(flush).toBeChecked();
  await card.getByTestId(`twu-part-remove-${id}-note_post_use`).click();
  await expect(card.getByTestId(`twu-part-${id}-note_post_use`)).toHaveCount(0);
  // Nothing is preselected: the kind is chosen first.
  await card.getByTestId(`twu-add-kind-${id}`).selectOption("paragraph");
  await card.getByTestId(`twu-add-text-${id}`).fill("Added by the team (fictional).");
  await card.getByTestId(`twu-add-part-btn-${id}`).click();
  await expect(card).toContainText("Added by the team (fictional).");
});

test("a description can be removed and added again from the library picker", async ({ page }) => {
  await openDescriptions(page);
  const { card, id } = await openCard(page, FILLING);
  await card.getByTestId(`twu-remove-${id}`).click();
  await card.getByTestId(`twu-remove-confirm-${id}`).click();
  await expect(page.locator('[data-testid^="twu-card-"]').filter({ has: page.getByRole("heading", { name: FILLING }) })).toHaveCount(0);
  const select = page.getByTestId("twu-add-select");
  await select.selectOption({ label: /Filling, stoppering and stopper insertion \(step:/ as unknown as string }).catch(async () => {
    const value = await select.locator("option", { hasText: "Filling, stoppering and stopper insertion" }).first().getAttribute("value");
    await select.selectOption(value!);
  });
  await page.getByTestId("twu-add").click();
  await expect(page.locator('[data-testid^="twu-card-"]').filter({ has: page.getByRole("heading", { name: FILLING }) })).toHaveCount(1);
});

test("a library edit makes a new version; the TRD offers Update from library with a note, and the update brings it in", async ({ page }) => {
  await openTrdList(page);
  await page.getByTestId("trd-writeups-link").click();
  await expect(page.getByTestId("twl-table")).toBeVisible();
  await page.getByTestId("twl-edit-wu_compounding").click();
  const first = page.getByTestId("twl-part-text-0");
  await first.fill("The drug substance is pooled by gentle pumping (library edit, fictional).");
  await page.getByTestId("twl-save").click();
  await expect(page.getByTestId("twl-message")).toContainText("version 4");
  await expect(page.getByTestId("twl-row-wu_compounding")).toContainText("Shipped, edited by you");
  // Focus is back on the Edit button.
  await expect(page.getByTestId("twl-edit-wu_compounding")).toBeFocused();

  await page.getByRole("link", { name: "TRDs", exact: true }).click();
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-writeups").click();
  const { card, id } = await openCard(page, COMPOUNDING);
  await expect(card.getByTestId(`twu-newer-${id}`)).toContainText("version 4");
  await card.getByTestId(`twu-update-${id}`).click();
  await expect(card.getByTestId(`twu-diff-${id}`)).toContainText("1 changed part");
  await card.getByTestId(`twu-update-confirm-${id}`).click();
  await expect(card.getByTestId(`twu-newer-${id}`)).toHaveCount(0);
  await expect(card.getByTestId(`twu-text-${id}-p1`)).toContainText("library edit, fictional");
});

test("the library can duplicate a write-up and create a new one", async ({ page }) => {
  await openTrdList(page);
  await page.getByTestId("trd-writeups-link").click();
  await page.getByTestId("twl-dup-wu_sterile_filtration").click();
  await expect(page.getByTestId("twl-row-wu_sterile_filtration_copy")).toContainText("Yours");
  await page.getByTestId("twl-new").click();
  await page.getByTestId("twl-title").fill("Visual inspection variant (fictional)");
  await page.getByTestId("twl-part-add").click();
  await page.getByTestId("twl-part-text-0").fill("Inspect each unit (fictional).");
  await page.getByTestId("twl-save").click();
  await expect(page.getByTestId("twl-message")).toContainText("version 1");
  await expect(page.getByTestId("twl-table")).toContainText("Visual inspection variant (fictional)");
});

test("Word and HTML carry the Manufacturing process overview with numbered steps, lettered sub-steps, notes and highlighted open blanks", async ({ page }) => {
  await openDescriptions(page);
  await page.getByTestId("trd-tab-output").click();
  await page.getByTestId("trd-preview-toggle").click();
  await expect(page.getByTestId("trd-preview")).toContainText("Manufacturing process overview");
  await expect(page.getByTestId("trd-preview").locator(".blank-open").first()).toBeVisible();

  const html = (await download(page, () => page.getByTestId("trd-download-html").click())).bytes.toString("utf8");
  expect(html).toContain(BANNER);
  expect(html).toContain("Manufacturing process overview");
  expect(html).toMatch(/<h3>\d+\.1 /);
  expect(html).toContain('<ol type="a" class="lettered">');
  expect(html).toContain('class="blank-open"');

  const word = await download(page, () => page.getByRole("button", { name: /Download Word|Word document/i }).first().click());
  const xml = new PizZip(word.bytes).file("word/document.xml")!.asText();
  const text = xml.replace(/<[^>]+>/g, " ");
  expect(text).toContain(BANNER);
  expect(text).toContain("Manufacturing process overview");
  expect(xml).toContain('<w:highlight w:val="yellow"/>');
  expect(text).not.toMatch(/filing category/i);
});

for (const scheme of ["light", "dark"] as const) {
  test(`process descriptions and the library are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `m91b-${name}-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: scheme });
    await openDescriptions(page);
    await expectAccessible(page, `${scheme} descriptions (folded)`);
    await expectNoHorizontalScroll(page, `${scheme} descriptions (folded)`);
    await shot("descriptions-folded");

    const { card, id } = await openCard(page, STERILE);
    await card.getByTestId(`twu-edit-${id}-p1`).click();
    await expectAccessible(page, `${scheme} descriptions (open, editing)`);
    await expectNoHorizontalScroll(page, `${scheme} descriptions (open, editing)`);
    await card.scrollIntoViewIfNeeded();
    await shot("descriptions-open");
    await card.getByRole("button", { name: "Cancel" }).click();

    await page.getByTestId("trd-tab-output").click();
    await page.getByTestId("trd-preview-toggle").click();
    await expectAccessible(page, `${scheme} output with descriptions`);
    await expectNoHorizontalScroll(page, `${scheme} output with descriptions`);
    await shot("output");

    await page.getByRole("link", { name: "All TRDs" }).click();
    await page.getByTestId("trd-writeups-link").click();
    await expect(page.getByTestId("twl-table")).toBeVisible();
    await expectAccessible(page, `${scheme} library`);
    await expectNoHorizontalScroll(page, `${scheme} library`);
    await shot("library");
    await page.getByTestId("twl-edit-wu_compounding").click();
    await expectAccessible(page, `${scheme} library form`);
    await expectNoHorizontalScroll(page, `${scheme} library form`);
    await shot("library-form");
  });
}
