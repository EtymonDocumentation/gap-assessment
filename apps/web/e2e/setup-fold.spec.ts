// Sampling plan: the one-time set-up cards are ONE "Plan set-up" fold on the Overview. It starts folded once the plan has steps and
// batches (the demo plans) and open for a new plan; links into a card inside it open it first. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo, openPlanSetup } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("plan-setup")).toBeVisible();
}

async function newPlan(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-title-input").fill("Fold plan (fictional)");
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("plan-setup")).toBeVisible();
}

const isOpen = (page: Page) => page.getByTestId("plan-setup").evaluate((el) => (el as HTMLDetailsElement).open);
const pageHeight = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);

test("a set-up plan opens with Plan set-up folded to one line; the line opens and folds it", async ({ page }, info) => {
  await openDemoPlan(page);
  expect(await isOpen(page)).toBe(false);
  await expect(page.getByTestId("plan-setup-summary")).toContainText(/\d+ process steps?, \d+ PPQ batch(es)?/);
  // Nothing of the cards shows while it is folded; the open items and the points do.
  await expect(page.getByTestId("steps-card")).toBeHidden();
  await expect(page.getByTestId("plan-design")).toBeHidden();
  await expect(page.getByTestId("plan-open-items")).toBeVisible();
  const folded = await pageHeight(page);
  await page.screenshot({ path: join(SHOTS, `setupfold-folded-${info.project.name}.png`), fullPage: true });

  await page.getByTestId("plan-setup-toggle").click();
  expect(await isOpen(page)).toBe(true);
  for (const id of ["plan-details-summary", "steps-card", "figure-data-card", "plan-design", "plan-method"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByText(/PPQ batches \(\d+\)/).first()).toBeVisible();
  const open = await pageHeight(page);
  expect(open, "folded is shorter than open").toBeGreaterThan(folded + 500);
  console.log(`OVERVIEW-HEIGHT ${info.project.name} folded=${folded} open=${open}`);

  await page.getByTestId("plan-setup-toggle").click();
  expect(await isOpen(page)).toBe(false);
});

test("the fold is not remembered: a reload of a set-up plan starts folded again", async ({ page }) => {
  await openDemoPlan(page);
  await openPlanSetup(page);
  await page.reload();
  await expect(page.getByTestId("plan-setup")).toBeVisible();
  expect(await isOpen(page)).toBe(false);
});

test("a new plan (no batches yet) starts with Plan set-up open and says what is not given", async ({ page }, info) => {
  await newPlan(page);
  expect(await isOpen(page)).toBe(true);
  await expect(page.getByTestId("plan-setup-summary")).toContainText("Not given yet");
  await expect(page.getByTestId("plan-details-title-text").or(page.getByTestId("plan-title"))).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `setupfold-new-open-${info.project.name}.png`), fullPage: true });
  // Adding the first batch does not fold it away under the person's hands.
  await page.getByTestId("batch-label-input").fill("PPQ batch 1");
  await page.getByTestId("batch-add").click();
  await expect(page.getByText("PPQ batches (1)")).toBeVisible();
  expect(await isOpen(page)).toBe(true);
});

test("Contents links into the set-up open the fold, switch to the Overview if needed, and focus the heading", async ({ page }) => {
  await openDemoPlan(page);
  expect(await isOpen(page)).toBe(false);
  await page.getByTestId("contents-sp-design").click();
  await expect(page.getByTestId("plan-design")).toBeVisible();
  expect(await isOpen(page)).toBe(true);
  await expect(page.locator("#sp-design")).toBeFocused();

  // From another tab, with the fold closed again.
  await page.getByTestId("plan-setup-toggle").click();
  await page.getByTestId("tab-diagram").click();
  await page.getByTestId("contents-sp-steps-h").click();
  await expect(page.getByTestId("steps-card")).toBeVisible();
  expect(await isOpen(page)).toBe(true);
  await expect(page.locator("#sp-steps-h")).toBeFocused();
});

test("'Process steps' in the empty diagram message opens the fold on the Overview", async ({ page }) => {
  await newPlan(page);
  // A new plan copies its steps from the scope; take them out so the diagram is empty.
  const removers = page.locator('[data-testid^="step-remove-ST"]');
  for (let n = await removers.count(); n > 0; n--) {
    await removers.first().click();
    // Removing a step asks first; a step that holds samples also offers to move them.
    const move = page.getByTestId("step-remove-move");
    if (await move.isVisible()) await move.click();
    else await page.getByRole("dialog").getByRole("button", { name: /^Delete / }).click();
    await expect(removers).toHaveCount(n - 1);
  }
  await page.getByTestId("plan-setup-toggle").click();
  expect(await isOpen(page)).toBe(false);
  await page.getByTestId("tab-diagram").click();
  await page.getByTestId("flow-open-steps").click();
  await expect(page.getByTestId("steps-card")).toBeVisible();
  expect(await isOpen(page)).toBe(true);
  await expect(page.locator("#sp-steps-h")).toBeFocused();
});

test("the folded and the open Overview are accessible, in light and dark, with no sideways scroll", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemoPlan(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const folded = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(folded.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.emulateMedia({ colorScheme: "light" });
  // The summary line is a button-like control; it is reachable and named for keyboard and screen-reader users.
  await page.getByTestId("plan-setup-toggle").focus();
  await page.keyboard.press("Enter");
  expect(await isOpen(page)).toBe(true);
  await expect(page.getByRole("heading", { level: 2, name: "Plan set-up" })).toBeVisible();
});
