// Stage-up S3: compare two versions (history button, banner button, the page itself, CSV), and the version on the document preview and in
// the export history. Runs on desktop, tablet and phone; screenshots go to the temp folder.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPhone, openDemo, setTheme } from "./nav-helper";
import { dismissSummary, pickAndSave } from "./stage-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const go = (page: Page, hash: string) => page.evaluate((h) => (window.location.hash = h), hash);

async function axeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function noSideScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Desktop (1366) and phone (390) only, with a -phone suffix on the phone, so parallel runs do not collide. */
async function shot(page: Page, name: string) {
  const phone = isPhone(page);
  if (!phone && (page.viewportSize()?.width ?? 0) < 1300) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `s3-${name}${phone ? "-phone" : ""}.png`) });
}

/** A project with one stage change: the start version and the working copy differ in the project stage. */
async function projectWithAChange(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await page.getByTestId("stage-chip").click();
  await pickAndSave(page, "clinical", "Fictional: compare test");
  await dismissSummary(page);
}

const versionRow = (page: Page, text: string) => page.getByTestId("version-table").locator("tbody tr").filter({ hasText: text });

test("compare from the history: the row button, the table, the words, the toggle and the CSV", async ({ page }) => {
  test.setTimeout(180_000);
  await projectWithAChange(page);
  await go(page, "#/versions");
  await shot(page, "history-compare");
  await versionRow(page, "Start").getByRole("link", { name: /^Compare/ }).click();

  await expect(page).toHaveURL(/#\/versions\/compare\?a=/);
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();

  const summary = page.getByTestId("compare-summary");
  await expect(summary).toContainText("Working copy");
  await expect(summary).toContainText(/\d+ changes?: /);
  await expect(page.getByTestId("compare-logged")).toContainText("logged between these versions");
  await expect(page.getByTestId("compare-logged").getByRole("link", { name: "Open the change log" })).toHaveAttribute("href", /#\/changes/);

  // Tabs per document, each with its count; the gap assessment holds the stage change.
  const tabs = page.getByTestId("compare-tabs");
  await expect(tabs.getByRole("tab", { name: /^Gap assessment [1-9]/ })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: /^TRD \d+$/ })).toBeVisible();

  // The change is a word in the table, not a colour; the table has a caption and headers.
  const table = page.getByTestId("compare-table");
  await expect(table.locator("caption")).toContainText("differences between");
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  const rows = page.getByTestId("compare-row");
  await expect(rows.filter({ hasText: /stage/i }).first()).toContainText("Changed");
  await shot(page, "compare");
  await axeClean(page, "compare page");
  await noSideScroll(page, "compare page");

  // "Only show changes" is on; turning it off lists unchanged items too, with the word "Unchanged".
  const only = page.getByLabel("Only show changes");
  await expect(only).toBeChecked();
  const before = await rows.count();
  await only.uncheck();
  await expect.poll(() => rows.count()).toBeGreaterThan(before);
  await expect(rows.filter({ hasText: "Unchanged" }).first()).toBeVisible();
  await only.check();

  // CSV: the same rows, with the two version names as column titles.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-compare-.*\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv.split("\r\n")[0]).toContain('"Working copy"');
  expect(csv).toContain('"Changed"');
});

test("compare from the banner of a version you are looking at, and two equal choices", async ({ page }) => {
  test.setTimeout(180_000);
  await projectWithAChange(page);
  await go(page, "#/versions");
  await versionRow(page, "PPQ to Clinical").getByRole("button", { name: /Open read-only/ }).click();
  const banner = page.getByTestId("version-banner");
  await expect(banner).toBeVisible();
  await shot(page, "banner-compare");
  await banner.getByTestId("banner-compare").click();
  await expect(page).toHaveURL(/#\/versions\/compare\?a=.*&b=Working(%20|\+)copy/);
  // Nothing differs between that version and the working copy: the plain sentence, not an empty table.
  await expect(page.getByTestId("compare-summary")).toContainText("No differences between these two.");

  // Choosing the same version twice says so.
  const selects = page.getByRole("group", { name: "Choose what to compare" }).locator("select");
  await selects.nth(1).selectOption(await selects.nth(0).inputValue());
  await expect(page.getByText("Choose two different versions to compare.")).toBeVisible();
  // A name that is not in the history is explained, with a way back.
  await go(page, "#/versions/compare?a=v99&b=Working%20copy");
  await expect(page.getByText(/not in the history/)).toBeVisible();
  await axeClean(page, "compare empty state");
});

test("phone: the compare table turns into cards and the page does not scroll sideways", async ({ page }) => {
  test.setTimeout(180_000);
  await projectWithAChange(page);
  await go(page, "#/versions");
  await versionRow(page, "Start").getByRole("link", { name: /^Compare/ }).click();
  await expect(page.getByTestId("compare-row").first()).toBeVisible();
  await noSideScroll(page, "compare page");
  if (isPhone(page)) {
    // Cards: each cell carries its column name (data-label), so the table head can be hidden and the meaning stays.
    await expect(page.getByTestId("compare-row").first().locator("td").first()).toHaveAttribute("data-label", /.+/);
    await shot(page, "compare");
  }
  await setTheme(page, "Dark");
  await axeClean(page, "compare page, dark");
});

test("the document says which version it was made from, in the preview and in the export history", async ({ page }) => {
  test.setTimeout(180_000);
  await projectWithAChange(page);
  await go(page, "#/document");
  const header = page.getByTestId("header-line");
  await expect(header).toContainText("Project stage:");
  await expect(header).toContainText("Working copy after");
  await expect(page.getByTestId("version-line")).toContainText("Version: Working copy after");
  await shot(page, "word-preview");

  // A download of the working copy is recorded with the version it was made from.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download gap assessment (HTML)" }).click();
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.isVisible().catch(() => false)) await anyway.click();
  expect((await downloading).suggestedFilename()).toMatch(/\.html$/);
  await page.getByTestId("export-details").first().locator("summary").click();
  await expect(page.getByTestId("export-version").first()).toContainText("Working copy after");

  // A version opened read-only stamps its own label on the preview.
  await go(page, "#/versions");
  await versionRow(page, "PPQ to Clinical").getByRole("button", { name: /Open read-only/ }).click();
  await go(page, "#/document");
  await expect(page.getByTestId("version-line")).toContainText(/Version: v[\d.]+ \(saved \d{4}-\d{2}-\d{2}\), project stage/);
  await expect(page.getByTestId("header-line")).not.toContainText("Working copy");
});
