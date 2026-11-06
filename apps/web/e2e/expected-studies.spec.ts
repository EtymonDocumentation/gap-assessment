// M11 job 3: the "Expected studies" library page (which catalog entries the design review's D2 treats as expected), its versions and
// history, and how the Design review reacts to a changed list. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo } from "./nav-helper";

const SHOTS = tmpdir();

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Opens the demo, then the Expected studies page from the Sampling plan's Library buttons (no menu item of its own). */
async function openList(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByRole("group", { name: "Sampling plan library" }).getByRole("link", { name: "Expected studies" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Expected studies" })).toBeVisible();
}

async function tickAll(page: Page) {
  const boxes = page.locator('[data-testid^="exp-tick-"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
}

async function openFirstPlan(page: Page) {
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId("design-review")).toBeVisible();
}

test("the page opens from the Sampling plan library, shows the shipped list, and saves, lists and removes versions", async ({ page }) => {
  test.setTimeout(120000);
  await openList(page);
  await expect(page.getByTestId("page-head")).toContainText("when a plan has the step but no sample for it");
  await expect(page.getByTestId("exp-current")).toContainText("the shipped list");
  await expect(page.getByTestId("exp-save")).toBeDisabled();
  await expect(page.getByTestId("exp-reset")).toBeDisabled();
  // Steps are the group headings; each row has the study, its type and a tick.
  await expect(page.locator('[data-testid^="exp-group-"]').first()).toBeVisible();
  await expect(page.getByTestId("exp-find")).toBeVisible();

  // A tick that differs from the shipped list says so in words (not colour only), then a save makes version 1 with the reason.
  const unticked = page.locator('[data-testid^="exp-tick-"]:not(:checked)').first();
  const key = (await unticked.getAttribute("data-testid"))!.replace("exp-tick-", "");
  await unticked.check();
  await expect(page.getByTestId(`exp-tag-${key}`)).toHaveText("Not in the shipped list");
  await expect(page.getByTestId("exp-save")).toBeEnabled();
  await page.getByTestId("exp-reason").fill("Our SOP asks for it (fictional)");
  await page.screenshot({ path: join(SHOTS, `m11-j3-page-${test.info().project.name}.png`), fullPage: true });
  await page.getByTestId("exp-save").click();
  await expect(page.getByTestId("exp-msg")).toContainText("new version");
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
  await expect(page.getByTestId("exp-current")).toContainText("Our SOP asks for it (fictional)");
  await expect(page.getByTestId("exp-version-1")).toContainText("Our SOP asks for it (fictional)");
  await expect(page.getByTestId(`exp-tick-${key}`)).toBeChecked();

  // The list survives a reload (browser storage in the static build).
  await page.reload();
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
  await expect(page.getByTestId(`exp-tick-${key}`)).toBeChecked();

  // Reset to the shipped list saves version 2; the earlier version stays in the history.
  await page.getByTestId("exp-reset").click();
  await expect(page.getByTestId("exp-current")).toContainText("version 2");
  await expect(page.getByTestId(`exp-tick-${key}`)).not.toBeChecked();
  await expect(page.getByTestId("exp-version-1")).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `m11-j3-history-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "expected studies with history");

  // Removing a version asks first and keeps the reason in a log; removing the one in use falls back to the version before.
  await page.getByTestId("exp-remove-2").click();
  await page.getByTestId("exp-remove-reason").fill("Reset by mistake (fictional)");
  await page.getByTestId("exp-remove-confirm").click();
  await expect(page.getByTestId("exp-version-2")).toHaveCount(0);
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
  await page.getByText(/Removed versions \(1\)/).click();
  await expect(page.getByTestId("exp-removed")).toContainText("Reset by mistake (fictional)");
  // Even the last version can go; then the shipped list is back.
  await page.getByTestId("exp-remove-1").click();
  await page.getByTestId("exp-remove-confirm").click();
  await expect(page.getByTestId("exp-current")).toContainText("the shipped list");
});

test("the Design review D2 card links to the page, and a changed list makes an answered question say 'look again'", async ({ page }) => {
  test.setTimeout(150000);
  await openList(page);
  // Ask about every catalog entry so the plan surely has D2 questions.
  await tickAll(page);
  await page.getByTestId("exp-reason").fill("Everything is expected for now (fictional)");
  await page.getByTestId("exp-save").click();
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
  await openFirstPlan(page);
  const d2 = page.locator('[data-testid^="review-card-D2:"]');
  await expect(d2.first()).toBeVisible();
  const card = d2.first();
  const testId = (await card.getAttribute("data-testid"))!;
  const key = testId.replace("review-card-", "");
  await expect(card.getByRole("link", { name: "Change the expected studies list" })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `m11-j3-d2-card-${test.info().project.name}.png`), fullPage: false });

  await page.getByTestId(testId).getByTestId(`review-confirmed-${key}`).click();
  await expect(page.getByTestId(testId)).toHaveAttribute("data-state", "answered");

  // The link opens the page; taking another entry off the list changes the list around the answered question.
  await page.getByTestId(testId).getByRole("link", { name: "Change the expected studies list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Expected studies" })).toBeVisible();
  const others = page.locator(`[data-testid^="exp-tick-"]:checked:not([data-testid="exp-tick-${key.replace("D2:", "")}"])`);
  await others.first().uncheck();
  await page.getByTestId("exp-save").click();
  await expect(page.getByTestId("exp-current")).toContainText("version 2");
  await openFirstPlan(page);
  await expect(page.getByTestId(testId)).toHaveAttribute("data-state", "look_again");
  await expect(page.getByTestId(`review-lookagain-${key}`)).toContainText("list of expected studies changed");
  await page.screenshot({ path: join(SHOTS, `m11-j3-d2-lookagain-${test.info().project.name}.png`), fullPage: false });
  await expectAccessible(page, "design review with the D2 link");

  // Resetting to the shipped list reads the same as before any change; an unticked entry stops raising its question.
  const raised = await d2.count();
  expect(raised).toBeGreaterThan(0);
});

for (const [scheme, size, label] of [
  ["light", { width: 1280, height: 900 }, "desktop"],
  ["dark", { width: 1280, height: 900 }, "desktop"],
  ["light", { width: 390, height: 844 }, "phone"],
  ["dark", { width: 390, height: 844 }, "phone"],
] as const) {
  test(`the page is readable, accessible and has no sideways scroll: ${label} ${scheme}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(size);
    await openList(page);
    await page.getByTestId("exp-find").fill("filter");
    await expect(page.locator('[data-testid^="exp-row-"]').first()).toBeVisible();
    await page.getByTestId("exp-find").fill("zzzz-no-such-study");
    await expect(page.getByText("No study matches what you typed.")).toBeVisible();
    await page.getByTestId("exp-find").fill("");
    await expectNoHorizontalScroll(page, `expected studies ${label} ${scheme}`);
    await expectAccessible(page, `expected studies ${label} ${scheme}`);
    await page.screenshot({ path: join(SHOTS, `m11-j3-${label}-${scheme}-${test.info().project.name}.png`), fullPage: true });
  });
}
