// The second demo, SYR-305 (a fictional prefilled syringe made from frozen drug substance): it is offered on the start page, opens with its
// TRD, and the TRD output page reports no open item. The ARX-217 demo button is unchanged. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
