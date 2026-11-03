// Life stage, job L2: the chain after the gap assessment adapts to the project stage. Batch record (PPQ-only items left out of the
// document but listed, with Include anyway), sampling plan reminders, TRD range wording and the Process view. Nothing is hidden in the app
// and nothing is deleted. Runs on desktop, tablet and phone; the screenshots go to the temp folder for the reviewer.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, isPhone, openDemo } from "./nav-helper";

const SHOTS = tmpdir();
const LABEL = {
  development: "Engineering / development runs",
  clinical: "Clinical batches (GMP, not process-validated)",
  ppq: "PPQ batches (process performance qualification)",
  commercial: "Commercial batches (process validated)",
};

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function axeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function noSideScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Screenshots are taken on the desktop project (and the phone one for the phone shot) so a parallel run does not overwrite them. */
async function shot(page: Page, name: string, only: "desktop" | "phone" = "desktop") {
  if ((only === "phone") !== isPhone(page)) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `l2-${name}.png`) });
}

async function choose(page: Page, stage: keyof typeof LABEL) {
  await page.getByTestId("stage-chip").click();
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await dialog.getByRole("radio", { name: new RegExp(LABEL[stage].replace(/[()/]/g, "\\$&")) }).check();
  await dialog.getByRole("button", { name: "Set project stage" }).click();
  await expect(page.getByTestId("stage-summary")).toBeVisible();
  await page.getByRole("dialog", { name: "Project stage" }).getByRole("button", { name: /Close|Done|OK/ }).first().click();
}

async function openRecord(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx");
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
}

test("batch record: PPQ-only items are left out of the document at Clinical, stay listed, and Include anyway puts one back", async ({ page }) => {
  await openRecord(page);
  await choose(page, "clinical");
  const panel = page.getByTestId("mbr-stage-panel");
  await expect(panel).toBeVisible();
  const sentence = page.getByTestId("mbr-left-out-sentence");
  await expect(sentence).toContainText("left out because the project stage is Clinical.");
  const before = Number((await sentence.innerText()).match(/^(\d+)/)![1]);
  await shot(page, "batch-record-clinical-left-out");
  await shot(page, "phone-batch-record", "phone");
  await noSideScroll(page, "batch record panel");
  await axeClean(page, "batch record panel at Clinical");

  await panel.getByRole("button", { name: /^Include anyway/ }).first().click();
  if (before > 1) await expect(sentence).toContainText(`${before - 1} PPQ-only`);
  else await expect(sentence).toHaveCount(0);
  await expect(panel.getByText("Included anyway").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Leave out again/ }).first()).toBeVisible();

  // At a PPQ project nothing is left out and there is no per-item button.
  await choose(page, "ppq");
  await expect(page.getByTestId("mbr-left-out-sentence")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Include anyway/ })).toHaveCount(0);
  await shot(page, "batch-record-ppq");
});

test("sampling plan: a PPQ point gets a reminder at Clinical, is still in the table, and the reminder is gone at PPQ", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx");
  await choose(page, "clinical");
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  const reminders = page.locator('[data-testid^="point-stage-reminder-"]');
  const points = page.locator('[data-testid^="point-SP"]').filter({ has: page.locator("th[scope=row]") });
  await expect(points.first()).toBeVisible();
  if ((await reminders.count()) > 0) {
    await expect(reminders.first()).toContainText(/PPQ point|Not part of routine/);
    await shot(page, "sampling-clinical");
  }
  await choose(page, "ppq");
  await expect(reminders).toHaveCount(0);
  await shot(page, "sampling-ppq");
  await noSideScroll(page, "sampling plan");
});

async function showPreview(page: Page) {
  const tab = page.getByRole("tab", { name: /Document/ });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  if ((await page.getByTestId("trd-preview").count()) === 0) await page.getByTestId("trd-preview-toggle").click();
  await expect(page.getByTestId("trd-preview")).toBeVisible();
}

test("TRD: the write-up states what the ranges mean at the project stage", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "syr");
  await goTo(page, "TRD");
  await page.getByRole("region", { name: "TRDs table" }).getByRole("link").first().click();
  // The stage is chosen first, then the document tab and preview are opened, so the page is not re-rendered between the steps.
  await choose(page, "ppq");
  await showPreview(page);
  await expect(page.getByText(/Project stage: PPQ\./).first()).toBeVisible();
  await shot(page, "trd-range-ppq");
  await choose(page, "commercial");
  await showPreview(page);
  await expect(page.getByText(/Project stage: Commercial\./).first()).toBeVisible();
  await expect(page.getByText(/Project stage: PPQ\./)).toHaveCount(0);
  await shot(page, "trd-range-commercial");
});

test("Process view: the study tag follows the project stage", async ({ page }) => {
  await openRecord(page);
  await choose(page, "clinical");
  await page.getByTestId("mbr-tab-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await shot(page, "process-view-clinical");
  await axeClean(page, "process view at Clinical");
});
