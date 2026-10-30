// What the PDA Technical Reports expect, in the TRD, the PPQ sampling plan and the master batch record (syringe demo, all data fictional):
// the parameter classification evidence and data map, the PPQ design and readiness card with the per-sample "After PPQ" flag and
// statistical justification, and the filter-record and intervention-log forms of the batch record.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemo(page: Page, link: string) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByTestId("home-chain")).toBeVisible();
  await goTo(page, link);
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("TRD: a parameter carries its classification evidence and data map, shown and editable", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-process").click();
  await page.getByTestId("trd-steps-open-all").click();
  const summary = page.getByTestId("trd-control-summary-thaw_temperature");
  await expect(summary).toContainText("Classification evidence and data map");
  await expect(summary).toContainText("controlled by:");
  await page.screenshot({ path: join(tmpdir(), "tr-apply-trd-control-summary.png") });

  // Open the parameter and edit its data map; an emptied field would read "Not established" in the document.
  await page.locator('[data-testid$="-param-thaw_temperature-edit"]').first().click();
  const editor = page.locator('fieldset[data-testid^="trd-control-"][data-testid$="-thaw_temperature"]');
  await expect(editor).toBeVisible();
  const recorded = editor.locator('[data-testid$="-recorded-in"]');
  await recorded.fill("Batch record, thaw section (edited in the test)");
  await editor.locator('[data-testid$="-save"]').click();
  await expect(recorded).toHaveValue(/edited in the test/);
  await editor.scrollIntoViewIfNeeded();
  await editor.screenshot({ path: join(tmpdir(), "tr-apply-trd-control-editor.png") });
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(axe.violations).toEqual([]);
});

test("PPQ plan: design and readiness card, After PPQ flag and statistical justification per sample", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();

  const card = page.getByTestId("plan-design");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("plan-design-rework")).toHaveValue(/No rework/);
  await expect(page.getByTestId("plan-design-eb-decision")).toHaveValue("planned");
  // An unanswered readiness item is Unknown, never a default answer.
  await expect(page.getByTestId("plan-readiness-protocols-status")).toHaveValue("");
  await expect(page.getByTestId("plan-readiness-equipment_qualified-status")).toHaveValue("complete");
  await page.getByTestId("plan-readiness-protocols-status").selectOption("open");
  await expect(page.getByTestId("plan-readiness-protocols-status")).toHaveValue("open");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(tmpdir(), "tr-apply-ppq-design.png") });

  await page.getByTestId("plan-design-freeze").fill("Edited freeze rule (test)");
  await page.getByTestId("plan-design-save").click();
  await expect(page.getByTestId("plan-design-freeze")).toHaveValue("Edited freeze rule (test)");

  // The point dialog: After PPQ is a choice (never preselected on a new point) and the confidence level is an entry with a hint.
  await page.locator('[data-testid^="edit-SP-"]').first().click();
  await page.getByTestId("point-expand-all").click();
  const after = page.getByTestId("point-after-ppq");
  await expect(after).toHaveValue(/ppq_only|continues/);
  await after.selectOption("continues");
  await expect(after).toHaveValue("continues");
  const basis = page.getByTestId("point-stat-basis");
  await expect(basis).toContainText("at least 90% at the rejectable quality level");
  await expect(basis).toContainText("not a statement of process capability");
  await expect(page.getByTestId("point-stat-confidence")).toBeVisible();
  await basis.scrollIntoViewIfNeeded();
  await basis.screenshot({ path: join(tmpdir(), "tr-apply-ppq-point-basis.png") });
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("MBR: filter records and the intervention log are in the record, and sample rows show the After PPQ flag", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await page.getByTestId("mbr-blocks-toggle-all").click();

  const filters = page.locator('[data-testid^="mbr-form-"][data-testid$="-filter_record"]');
  expect(await filters.count()).toBeGreaterThanOrEqual(2);
  await expect(filters.first()).toContainText("Post-use");
  const interventions = page.locator('[data-testid^="mbr-form-"][data-testid$="-intervention_log"]');
  await expect(interventions).toHaveCount(1);
  await expect(interventions).toContainText("Duration");
  await expect(page.locator('[data-testid^="mbr-forms-"]', { hasText: "qualified intervention list" }).first()).toBeVisible();
  await expect(page.locator('[data-testid^="mbr-sample-after-ppq-"]').first()).toContainText(/PPQ only|Continues into routine|Not stated/);
  await interventions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), "tr-apply-mbr-forms.png") });
  const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
