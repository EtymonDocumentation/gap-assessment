// How each sample is taken: the optional method section of a sampling point, the plan switch and the reminder list. Nothing is preselected,
// reminders never block saving, and the section works at phone width. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

test("a point's method section starts with nothing chosen and its answers show as reminders", async ({ page }) => {
  // Two axe scans and two full-page screenshots: allow for a busy machine when many specs run in parallel.
  test.setTimeout(90000);
  await openDemoPlan(page);
  const name = test.info().project.name;
  // SP-003 has no method answers in the demo: every group reads "Not stated" and no reminder is shown.
  await page.getByTestId("edit-SP-003").click();
  await expect(page.getByTestId("point-dialog")).toBeVisible();
  const section = page.getByTestId("point-howtaken");
  await section.locator("summary").click();
  await expect(page.getByTestId("method-access-unset")).toBeChecked();
  await expect(page.getByTestId("method-closed-unset")).toBeChecked();
  await expect(page.getByTestId("method-reminders")).toContainText("No reminders");
  // Answer a Y-connector added for PPQ: the follow-up questions appear, all still "Not stated".
  await page.getByTestId("method-access-added_y_connector").check();
  await expect(page.getByTestId("method-added-commercial-unset")).toBeChecked();
  await expect(page.getByTestId("method-reminder-list")).toContainText("State whether the added connector is in the commercial assembly");
  await expect(page.getByTestId("method-reminder-list")).toContainText("State the flush or first-draw discard volume and where it goes");
  await page.getByTestId("method-added-commercial-no").check();
  await page.getByTestId("method-flush-flush_volume").check();
  await page.getByTestId("method-flush-volume").fill("50");
  await page.getByTestId("method-flush-unit").selectOption("mL");
  await page.getByTestId("method-flush-discard").fill("the waste container (fictional)");
  await expect(page.getByTestId("method-reminder-list")).not.toContainText("commercial assembly");
  await expectAccessible(page, `${name} method section`);
  await expectNoHorizontalScroll(page, `${name} method section`);
  await page.screenshot({ path: join(SHOTS, `smp-method-editor-${name}.png`) });
  await page.getByTestId("point-save").click();
  // Saved, and reminders are listed at plan level (apart from the open items).
  await expect(page.getByTestId("plan-method-reminders")).toContainText("SP-003");
  await expect(page.getByTestId("plan-method-reminders")).toContainText("State whether the modified assembly is covered");
  await expectAccessible(page, `${name} plan reminders`);
  await page.screenshot({ path: join(SHOTS, `smp-method-reminders-${name}.png`), fullPage: true });
});

test("the plan switch asks every point and can be switched off again", async ({ page }) => {
  await openDemoPlan(page);
  const before = await page.getByTestId("plan-method-reminders").locator("li").count();
  await page.getByTestId("plan-method-switch").check();
  await expect(page.getByTestId("plan-method-SP-003")).toContainText("State how this sample is taken");
  expect(await page.getByTestId("plan-method-reminders").locator("li").count()).toBeGreaterThan(before);
  await page.getByTestId("plan-method-switch").uncheck();
  await expect(page.getByTestId("plan-method-SP-003")).toHaveCount(0);
});
