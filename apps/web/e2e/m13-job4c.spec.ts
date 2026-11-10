// M13 job 4C: the optional "Excipients used" table of a batch record. The demo record lists its TRD-linked excipients; a line edited in the
// excipient assessment shows "Changed in the excipient assessment" with an Update that only the author presses (Keep leaves it); a row or the
// whole table is removed with a reason; the table prints in the HTML draft with the same words. Fictional data only.
// Runs at the three widths of the config. Names and counts below are read from the page, not typed, where they can move with the demo.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { goTo, openDemo, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

/** The ARX-217 demo's batch record, on its Edit tab. */
async function openRecord(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx");
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await expect(page.getByTestId("mbr-excipients")).toBeVisible();
}

const rows = (page: Page) => page.locator('[data-testid^="mbr-excipient-EU-"]');

test("the demo record lists the excipients its TRD links to, in a table that is readable and accessible in light and dark", async ({ page }) => {
  test.setTimeout(180_000);
  await openRecord(page);
  const table = page.getByTestId("mbr-excipients-table");
  await expect(table).toBeVisible();
  const count = await rows(page).count();
  expect(count).toBeGreaterThan(0);
  await expect(table).toContainText("Excipient A (fictional)");
  await expect(table).toContainText("Not established"); // an unknown stays visible, nothing is filled in
  await expect(page.getByTestId("mbr-excipients")).toContainText("The bill of materials stays an entry only the CMO makes.");
  // Nothing has changed in the excipient assessment yet, so no row carries a notice.
  await expect(page.locator('[data-testid^="mbr-excipient-changed-"]')).toHaveCount(0);
  await expectNoSidewaysScroll(page, "record with the table");
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 360, height: size.height });
  await expectNoSidewaysScroll(page, "record with the table at 360 px");
  await page.setViewportSize(size);
  await page.getByTestId("mbr-excipients").scrollIntoViewIfNeeded();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await expectAccessible(page, `table (${theme})`);
  }
  await setTheme(page, "Light");
});

test("the table prints in the HTML draft with the same words", async ({ page }) => {
  test.setTimeout(180_000);
  await openRecord(page);
  const names = (await page.locator('[data-testid^="mbr-excipient-name-EU-"]').allInnerTexts()).map((s) => s.trim());
  expect(names.length).toBeGreaterThan(0);
  await page.getByTestId("mbr-tab-word").click();
  await page.getByTestId("mbr-preview-toggle").click();
  const preview = page.getByTestId("mbr-preview");
  await expect(preview).toContainText("Excipients used");
  for (const n of names) await expect(preview).toContainText(n);
  await expect(preview).toContainText("From the excipient assessment");
  await expect(preview).toContainText("Specification reference");
  await expectAccessible(page, "preview with the table");

  const open = page.getByTestId("mbr-download-html");
  await open.click();
  const warn = page.getByTestId("mbr-download-anyway");
  const [dl] = await Promise.all([page.waitForEvent("download"), (await warn.isVisible().catch(() => false)) ? warn.click() : Promise.resolve()]);
  const html = readFileSync((await dl.path())!, "utf8");
  expect(html).toContain("Excipients used");
  for (const n of names) expect(html).toContain(n);
});

test("a line edited in the excipient assessment is offered as an update; Keep leaves the row, Change brings it level", async ({ page }) => {
  test.setTimeout(180_000);
  await openRecord(page);
  const first = rows(page).first();
  const rowId = (await first.getAttribute("data-testid"))!.replace("mbr-excipient-", "");
  const oldName = (await first.locator('[data-testid^="mbr-excipient-name-"]').innerText()).trim();
  const [, assessment, line] = /(EXA-\d+), (EXL-\d+)/.exec((await first.innerText()).replace(/\s+/g, " "))!;

  // Edit the line in the excipient assessment (rename it) and come back.
  await hash(page, `#/excipient?excipient=${assessment}&line=${line}`);
  const name = page.getByTestId("ex-line-name");
  await name.fill(`${oldName} renamed`);
  await name.blur();
  await hash(page, "#/mbr");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("mbr-excipients")).toBeVisible();

  // The row still holds its copy and says it changed. Nothing changed on its own.
  await expect(first.locator('[data-testid^="mbr-excipient-name-"]')).toHaveText(oldName);
  const notice = page.getByTestId(`mbr-excipient-changed-${rowId}`);
  await expect(notice).toContainText("Changed in the excipient assessment");
  await expectNoSidewaysScroll(page, "changed notice");

  // Update shows old and new. Keep leaves the row as it is.
  await page.getByTestId(`mbr-excipient-update-${rowId}`).click();
  const table = page.getByTestId("mbr-excipient-update-table");
  await expect(table).toContainText(oldName);
  await expect(table).toContainText(`${oldName} renamed`);
  await expect(table).toContainText("Different");
  await expectAccessible(page, "update dialog");
  // The colour menu is behind an open dialog, so the theme is changed with the dialog closed.
  await page.getByTestId("mbr-excipient-update-keep").click();
  await setTheme(page, "Dark");
  await page.getByTestId(`mbr-excipient-update-${rowId}`).click();
  await expectAccessible(page, "update dialog (dark)");
  await page.getByTestId("mbr-excipient-update-keep").click();
  await setTheme(page, "Light");
  await page.getByTestId(`mbr-excipient-update-${rowId}`).click();
  await page.getByTestId("mbr-excipient-update-keep").click();
  await expect(table).toHaveCount(0);
  await expect(first.locator('[data-testid^="mbr-excipient-name-"]')).toHaveText(oldName);
  await expect(notice).toBeVisible();

  // Change is the one click that copies the new values; the notice then goes.
  await page.getByTestId(`mbr-excipient-update-${rowId}`).click();
  await page.getByTestId("mbr-excipient-update-change").click();
  await expect(first.locator('[data-testid^="mbr-excipient-name-"]')).toHaveText(`${oldName} renamed`);
  await expect(notice).toHaveCount(0);
});

test("a row is removed with a reason, the whole table is removed with a reason, and lines are added again by ticking them", async ({ page }) => {
  test.setTimeout(180_000);
  await openRecord(page);
  const before = await rows(page).count();
  expect(before).toBeGreaterThan(1);
  const first = rows(page).first();
  const rowId = (await first.getAttribute("data-testid"))!.replace("mbr-excipient-", "");

  // One row: an empty reason is refused in words, the dialog stays; Keep leaves it.
  await page.getByTestId(`mbr-excipient-remove-${rowId}`).click();
  await page.getByTestId("mbr-excipient-remove-confirm").click();
  await expect(page.getByTestId("mbr-excipient-remove-msg")).toContainText("reason");
  await page.getByTestId("mbr-excipient-remove-keep").click();
  await expect(rows(page)).toHaveCount(before);
  await page.getByTestId(`mbr-excipient-remove-${rowId}`).click();
  await page.getByTestId("mbr-excipient-remove-reason").fill("Not used in this batch");
  await page.getByTestId("mbr-excipient-remove-confirm").click();
  await expect(rows(page)).toHaveCount(before - 1);

  // It is offered again, nothing is ticked, and nothing is added until the author ticks and confirms.
  await page.getByTestId("mbr-excipients-add").click();
  const offers = page.locator('[data-testid^="mbr-excipients-pick-"]');
  await expect(offers).toHaveCount(1);
  await expect(offers.first()).not.toBeChecked();
  await expectAccessible(page, "add dialog");
  await page.getByTestId("mbr-excipients-add-cancel").click();
  await setTheme(page, "Dark");
  await page.getByTestId("mbr-excipients-add").click();
  await expectAccessible(page, "add dialog (dark)");
  await page.getByTestId("mbr-excipients-add-cancel").click();
  await setTheme(page, "Light");
  await page.getByTestId("mbr-excipients-add").click();
  await page.getByTestId("mbr-excipients-add-confirm").click();
  await expect(page.getByTestId("mbr-excipients-add-msg")).toContainText("Tick at least one");
  await offers.first().check();
  await page.getByTestId("mbr-excipients-add-confirm").click();
  await expect(rows(page)).toHaveCount(before);

  // With everything added, the dialog says why there is nothing to offer, and links to the excipient assessment.
  await page.getByTestId("mbr-excipients-add").click();
  await expect(page.getByTestId("mbr-excipients-none")).toContainText("already in the table");
  await expect(page.getByTestId("mbr-excipients-none-link")).toBeVisible();
  await page.getByTestId("mbr-excipients-add-cancel").click();

  // The whole table, with a reason.
  await page.getByTestId("mbr-excipients-remove-table").click();
  await page.getByTestId("mbr-excipients-table-remove-confirm").click();
  await expect(page.getByTestId("mbr-excipients-table-remove-msg")).toBeVisible();
  await page.getByTestId("mbr-excipients-table-remove-reason").fill("Table not wanted in this record");
  await page.getByTestId("mbr-excipients-table-remove-confirm").click();
  await expect(page.getByTestId("mbr-excipients-table")).toHaveCount(0);
  await expect(page.getByTestId("mbr-excipients")).toContainText("No excipients are listed in this record.");

  // The Document tab then prints nothing about it.
  await page.getByTestId("mbr-tab-word").click();
  await page.getByTestId("mbr-preview-toggle").click();
  await expect(page.getByTestId("mbr-preview")).not.toContainText("Excipients used");
});

test("keyboard: the add button opens the dialog, Escape closes it and focus comes back, a tick is made with Space", async ({ page }) => {
  test.setTimeout(180_000);
  await openRecord(page);
  const rowId = (await rows(page).first().getAttribute("data-testid"))!.replace("mbr-excipient-", "");
  // Make one offer available first (with the keyboard too).
  const remove = page.getByTestId(`mbr-excipient-remove-${rowId}`);
  await remove.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("mbr-excipient-remove-reason").fill("Keyboard test");
  await page.keyboard.press("Tab"); // Keep the row
  await page.keyboard.press("Tab"); // Remove from the table
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`mbr-excipient-${rowId}`)).toHaveCount(0);

  const add = page.getByTestId("mbr-excipients-add");
  await add.focus();
  await page.keyboard.press("Enter");
  const pick = page.locator('[data-testid^="mbr-excipients-pick-"]').first();
  await expect(pick).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pick).toHaveCount(0);
  await expect(add).toBeFocused();

  await page.keyboard.press("Enter");
  await pick.focus();
  await page.keyboard.press("Space");
  await expect(pick).toBeChecked();
  await page.getByTestId("mbr-excipients-add-confirm").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`mbr-excipient-${rowId}`).or(page.locator('[data-testid^="mbr-excipient-EU-"]').first())).toBeVisible();
});
