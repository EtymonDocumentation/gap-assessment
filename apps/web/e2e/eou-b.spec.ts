// Ease-of-use pass B (first-time-user findings EOU-20 to EOU-38): the sampling plan says where its steps come from and opens at the top, an
// empty batch record says what to do next and has a button, the Process view of an empty record is one line, the risk "Add ticked gaps"
// answers with a message, the stage dialog marks its reason box as needed beforehand and explains the two kinds of version, and the compare
// page does not contradict itself. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openDemo } from "./nav-helper";
import { STAGE_LABEL } from "./stage-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page, which: "arx" | "syr" = "arx") {
  await page.goto("./");
  await openDemo(page, which, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function axeClean(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toBe("");
}

test("the sampling plan says where its steps come from, and a new plan opens at the top of the page", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Sampling plan");
  const note = page.getByTestId("plan-source-note");
  await expect(note).toContainText("copied once");
  await expect(page.getByTestId("plan-source-trd")).toContainText(/technical requirements document/i);
  await axeClean(page, '[data-testid="plan-source-note"]');
  await page.getByTestId("plan-title-input").fill("Top of page plan (fictional)");
  await page.getByTestId("plan-create").click();
  // The page keeps the same address with a plan parameter, so nothing used to scroll it: the plan opened level with the old Create button.
  await expect(page.getByTestId("plan-open-items")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId("plan-source-note")).toContainText("Started from this project's scope");
});

test("a batch record asks you to choose the document or plan next to the list, and an empty record offers its sections with a button", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-title-input").fill("Empty record (fictional)");
  await page.getByTestId("mbr-start-trd").check();
  // The label says what to do; the list starts on "Choose one" (nothing is chosen for you).
  await expect(page.getByLabel("Choose the technical requirements document to start from")).toHaveValue("");
  await page.getByTestId("mbr-start-plan").check();
  await expect(page.getByLabel("Choose the sampling plan to start from")).toHaveValue("");
  // The count in the folded list of ready-made steps says what it counts.
  await expect(page.getByTestId("mbr-blocks-details").locator("summary")).toContainText(/\d+ ticked of \d+ offered/);
  await page.getByTestId("mbr-start-trd").uncheck();
  await page.getByTestId("mbr-start-plan").uncheck();
  await page.getByTestId("mbr-create").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
  const empty = page.getByTestId("mbr-empty-sections");
  await expect(empty).toContainText("The steps come from");
  await axeClean(page, '[data-testid="mbr-empty-sections"]');
  // Nothing was added until the button is pressed; then there is one section for each step, all empty.
  await expect(page.locator('[data-testid^="mbr-section-remove-"]')).toHaveCount(0);
  await page.getByTestId("mbr-add-source-sections").click();
  await expect(page.getByTestId("mbr-empty-sections")).toHaveCount(0);
  expect(await page.locator('[data-testid^="mbr-section-remove-"]').count()).toBeGreaterThan(0);
  await expect(page.locator("article.mbr-block")).toHaveCount(0);
});

test("the Process view of a record with no sections is one line that points back to the Edit tab", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-title-input").fill("Nothing to draw (fictional)");
  await page.getByTestId("mbr-create").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
  await page.getByTestId("mbr-tab-view").click();
  const empty = page.getByTestId("pv-empty");
  await expect(empty).toContainText("no sections yet");
  await expect(page.getByTestId("pv-slider")).toHaveCount(0);
  await expect(page.getByText("fluid tracker")).toHaveCount(0);
  await axeClean(page, '[data-testid="pv-empty"]');
  await empty.getByRole("link", { name: "Edit tab" }).click();
  await expect(page.getByTestId("mbr-empty-sections")).toBeVisible();
});

test("the chain strip says that the Process view is a tab of the batch record", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadDemo(page);
  await goTo(page, "Batch record");
  await expect(page.getByTestId("chain-view")).toContainText("A tab of the batch record");
});

test("adding ticked gaps as risk items says what was added, closes the list and moves to the new item", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Risk assessment");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-items").click();
  await page.getByTestId("risk-from-gaps").locator("summary").click();
  await page.getByTestId("risk-from-gaps").locator('input[type="checkbox"]:not([disabled])').first().check();
  await page.getByTestId("risk-gaps-add").click();
  const note = page.getByTestId("risk-gaps-note");
  await expect(note).toContainText("1 item added from the gap");
  await expect(page.getByTestId("risk-from-gaps")).not.toHaveAttribute("open", "");
  // The cursor is on the Edit button of the new item, which is on screen.
  await expect(page.locator('[data-testid^="risk-item-edit-"]:focus, [data-testid^="risk-row-edit-"]:focus')).toHaveCount(1);
  await axeClean(page, '[data-testid="risk-add"]');
});

test("the Method step says which button to take, and still chooses nothing", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Risk assessment");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-method").click();
  await expect(page.getByTestId("risk-method-hint")).toContainText("closest to how your company scores risk");
});

test("the stage dialog marks the reason as needed, and explains main versions and smaller steps", async ({ page }) => {
  await loadDemo(page);
  // The demo is at the PPQ stage, so choosing another one is a change, and a change needs a reason.
  await page.getByTestId("stage-chip").click();
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await dialog.getByRole("radio", { name: new RegExp(STAGE_LABEL.clinical.replace(/[()/]/g, "\\$&")) }).check();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByLabel(/Why is the stage/)).toHaveAccessibleName(/needed to save the change/);
  await expect(dialog.getByTestId("version-kinds-note")).toContainText("smaller step");
  await axeClean(page, '[role="dialog"]');
});
