// The second demo, SYR-305 (a fictional prefilled syringe made from frozen drug substance): it is offered on the start page, opens with its
// TRD, and the TRD output page reports no open item. The ARX-217 demo button is unchanged. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

test("the syringe demo opens from the start page with a complete TRD", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Load demo" })).toHaveCount(1);
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "TRD", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByTestId("trd-list-table")).toContainText("SYR-305 technical requirements document (fictional)");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-output").click();
  await expect(page.getByTestId("trd-open-count")).toContainText("No open items.");
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
});

// The syringe demo also opens with its master batch record, built from the approved TRD.
async function openSyringeRecord(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "Batch record", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByTestId("mbr-list-table")).toContainText("SYR-305 master batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
}

for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`the syringe batch record shows the 12 h time out of refrigeration with its stage targets and one tightened row; the demo has no open items and no uncovered TRD requirement: ${name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await openSyringeRecord(page);
    await page.getByTestId("mbr-blocks-toggle-all").click();

    // The critical limit and its four stage targets, added up for information only.
    const limit = page.locator("li.mbr-limit", { has: page.locator("li.mbr-target") });
    await expect(limit).toHaveCount(1);
    await expect(limit.locator("li.mbr-target")).toHaveCount(4);
    await expect(limit.locator('[data-testid^="mbr-limit-sum-"]')).toContainText("Targets add up to 12 h");

    const tightened = page.locator("li.mbr-row", { has: page.locator('[data-testid^="mbr-choice-state-"]', { hasText: /^Tightened by the CMO$/ }) });
    await expect(tightened).toHaveCount(1);
    await expect(tightened.locator('[data-testid^="mbr-note-"]')).toContainText("Tighter than the TRD");

    // No filtered-bulk-hold block and no vial wording: filling starts directly after sterile filtration.
    // Checked on the block titles only: the BBR sample rows name the approved post-BBR hold ("Filtered bulk hold in the holding bag"),
    // which is a different hold from the sterile-bulk hold this line guards against.
    await expect(page.locator("article.mbr-block h3.mbr-block-title", { hasText: /Filtered bulk hold$/ })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(/\bvials?\b/i);

    const open = page.getByTestId("mbr-open-items");
    await expect(open).toContainText("Open items (0)");
    await expect(open).toContainText("Nothing open");
    await expect(open).not.toContainText("Not decided");
    // Every TRD requirement now has a step in the record, so the "TRD requirement without an MBR step" list is not shown at all.
    await expect(page.getByTestId("mbr-requirements")).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

    await page.screenshot({ path: join(tmpdir(), `syr305-mbr-record-${name}.png`) });
    await open.screenshot({ path: join(tmpdir(), `syr305-mbr-open-items-${name}.png`) });
    await tightened.first().screenshot({ path: join(tmpdir(), `syr305-mbr-tightened-${name}.png`) });
    await page.locator("article.mbr-block", { has: limit }).first().screenshot({ path: join(tmpdir(), `syr305-mbr-time-limit-${name}.png`) });
  });
}
