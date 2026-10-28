// PPQ batch rows on the sampling plan page: a row opens in edit when it is just added, collapses to a read-only
// summary after Save, and comes back with Edit. Keyboard focus must follow. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function newPlanWithBatch(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-title-input").fill("Batch rows plan (fictional)");
  await page.getByTestId("plan-create").click();
  await page.getByTestId("batch-label-input").fill("PPQ batch 1");
  await page.getByTestId("batch-add").click();
  await expect(page.getByText("PPQ batches (1)")).toBeVisible();
}

async function axeClean(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toBe("");
}

test("a batch opens in edit when added, collapses to a summary on save, and Edit / Cancel keep keyboard focus", async ({ page }) => {
  await newPlanWithBatch(page);
  const row = page.getByTestId("batch-B-001");
  // Just added: the form is open, and there is nothing saved yet to cancel back to.
  await expect(page.getByTestId("batch-label-B-001")).toBeVisible();
  await expect(page.getByTestId("batch-cancel-B-001")).toHaveCount(0);

  await page.getByTestId("batch-lot-B-001").fill("1200");
  await page.getByTestId("batch-size-B-001").fill("21");
  await page.getByTestId("batch-unit-B-001").fill("L");
  await page.getByTestId("batch-save-B-001").click();

  // Summary: values and unit shown, inputs gone, focus on the row's Edit button.
  await expect(page.getByTestId("batch-lot-B-001")).toHaveCount(0);
  await expect(page.getByTestId("batch-lot-text-B-001")).toHaveText("1,200 containers");
  await expect(page.getByTestId("batch-size-text-B-001")).toHaveText("21 L");
  await expect(row).toContainText("PPQ batch 1");
  const edit = page.getByRole("button", { name: "Edit batch B-001" });
  await expect(edit).toBeFocused();
  await expect(page.getByRole("button", { name: "Remove batch B-001" })).toBeVisible();

  // Edit: the form is back with the saved values and focus is in the first field.
  await edit.click();
  await expect(page.getByTestId("batch-label-B-001")).toBeFocused();
  await expect(page.getByTestId("batch-lot-B-001")).toHaveValue("1200");
  await expect(page.getByTestId("batch-size-B-001")).toHaveValue("21");
  await expect(page.getByTestId("batch-unit-B-001")).toHaveValue("L");

  // Cancel discards the unsaved change.
  await page.getByTestId("batch-lot-B-001").fill("999");
  await page.getByTestId("batch-cancel-B-001").click();
  await expect(page.getByTestId("batch-lot-text-B-001")).toHaveText("1,200 containers");
  await expect(page.getByRole("button", { name: "Edit batch B-001" })).toBeFocused();

  // Save after a change updates the summary; a value without a unit says so; blanks say "not given".
  await page.getByRole("button", { name: "Edit batch B-001" }).click();
  await page.getByTestId("batch-unit-B-001").fill("");
  await page.getByTestId("batch-save-B-001").click();
  await expect(page.getByTestId("batch-size-text-B-001")).toHaveText("21 (unit not given)");
  await page.getByRole("button", { name: "Edit batch B-001" }).click();
  await page.getByTestId("batch-lot-B-001").fill("");
  await page.getByTestId("batch-size-B-001").fill("");
  await page.getByTestId("batch-save-B-001").click();
  await expect(page.getByTestId("batch-lot-text-B-001")).toHaveText("not given");
  await expect(page.getByTestId("batch-size-text-B-001")).toHaveText("not given");
});

test("a second batch opens in edit while the saved one stays collapsed", async ({ page }) => {
  await newPlanWithBatch(page);
  await page.getByTestId("batch-save-B-001").click();
  await expect(page.getByTestId("batch-lot-text-B-001")).toHaveText("not given");
  await page.getByTestId("batch-label-input").fill("PPQ batch 2");
  await page.getByTestId("batch-add").click();
  await expect(page.getByTestId("batch-label-B-002")).toBeVisible();
  await expect(page.getByTestId("batch-label-B-001")).toHaveCount(0);
});

test("the batch card is accessible and does not scroll sideways, in summary and edit mode", async ({ page }, info) => {
  await newPlanWithBatch(page);
  const card = page.locator('section[aria-labelledby="sp-batches"]');
  await page.getByTestId("batch-lot-B-001").fill("1200");
  await page.getByTestId("batch-size-B-001").fill("21");
  await page.getByTestId("batch-unit-B-001").fill("L");
  await page.getByTestId("batch-save-B-001").click();
  await expect(page.getByTestId("batch-lot-text-B-001")).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await axeClean(page, 'section[aria-labelledby="sp-batches"]');
  if (info.project.name === "desktop") await card.screenshot({ path: join(SHOTS, "batches-summary-1280.png") });

  await page.getByRole("button", { name: "Edit batch B-001" }).click();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await axeClean(page, 'section[aria-labelledby="sp-batches"]');
  if (info.project.name === "desktop") await card.screenshot({ path: join(SHOTS, "batches-edit-1280.png") });
});

test("390 px phone and dark mode: summary fits and is accessible", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await newPlanWithBatch(page);
  await page.getByTestId("batch-lot-B-001").fill("1200");
  await page.getByTestId("batch-size-B-001").fill("21");
  await page.getByTestId("batch-unit-B-001").fill("L");
  await page.getByTestId("batch-save-B-001").click();
  await expect(page.getByTestId("batch-lot-text-B-001")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await axeClean(page, 'section[aria-labelledby="sp-batches"]');
  await page.locator('section[aria-labelledby="sp-batches"]').screenshot({ path: join(SHOTS, "batches-summary-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator('section[aria-labelledby="sp-batches"]').screenshot({ path: join(SHOTS, "batches-summary-390.png") });
});
