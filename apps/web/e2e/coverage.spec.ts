// Milestone 5.5: process coverage (new sections in process order), the labelling location per side and tailoring a
// section with a required reason. Runs on the desktop, tablet and phone projects. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** Opens the section summary (the review page of one section). The phone layout has no always-open side list, so the link is used. */
async function openSummary(page: Page, section: string) {
  await go(page, `#/interview?summary=${section}`);
  await expect(page.locator("#sum-h")).toContainText("Section summary");
}

async function shot(page: Page, name: string, testInfo: { project: { name: string } }) {
  // Pictures for the review, desktop in the light theme and phone in the dark theme (the two ends of the layout).
  const dark = testInfo.project.name === "phone";
  if (testInfo.project.name === "tablet") return;
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `m55-${name}-${testInfo.project.name}-${dark ? "dark" : "light"}.png`), fullPage: true });
  await page.emulateMedia({ colorScheme: null });
}

test("the new sections appear in process order, with bulk packaging between visual inspection and labelling", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.bulk_packaging");
  await expect(page.locator("#sum-h")).toHaveText("Section summary: Bulk packaging");
  const titles = await page.locator(".progress-map .pm-title").allTextContents();
  const at = (t: string) => titles.indexOf(t);
  expect(at("Drug substance shipping to the fill site")).toBeGreaterThan(-1);
  expect(at("Drug substance shipping to the fill site")).toBe(at("Drug substance receipt and thaw") - 1);
  expect(at("Visual inspection")).toBeGreaterThan(-1);
  expect(at("Bulk packaging")).toBe(at("Visual inspection") + 1);
  expect(at("Labeling and packaging")).toBe(at("Bulk packaging") + 1);
  expect(at("Storage and shipping from the fill site")).toBe(at("Labeling and packaging") + 1);
  await expectAccessible(page, "bulk packaging summary");
  await expectNoHorizontalScroll(page, "bulk packaging summary");
});

test("the bulk packaging card shows its questions and no transport questions", async ({ page }, testInfo) => {
  await loadDemo(page);
  await go(page, "#/interview?q=bp.container%40source");
  await expect(page.locator("#q-prompt")).toHaveText("Bulk container type");
  await expect(page.locator(".q-meta")).toContainText("Bulk packaging");
  await expectAccessible(page, "bulk packaging card");
  await expectNoHorizontalScroll(page, "bulk packaging card");
  await shot(page, "bulk-packaging-card", testInfo);
  await openSummary(page, "uo.bulk_packaging");
  const rows = await page.locator("table.data tbody th").allTextContents();
  expect(rows.join("|")).not.toMatch(/shipper|lane|transit/i);
});

test("labelling at another site hides the labelling section for that side and the scope says where", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.labeling_packaging");
  const before = await page.locator("table.data tbody tr").count();
  expect(before).toBeGreaterThan(0);
  // RU: another site. SU stays at this site, so the section stays but loses the RU column values.
  await go(page, "#/interview?q=site.labelling_location%40target");
  await expect(page.locator("#q-prompt")).toContainText("Where is labelling and secondary packaging done?");
  await page.locator('fieldset.side-panel[data-side="target"] .choice-chip', { hasText: "At another site" }).click();
  await page.getByRole("button", { name: "Save RU", exact: true }).click();
  await go(page, "#/interview?summary=uo.labeling_packaging");
  const cells = await page.locator("table.data tbody tr td:nth-child(3)").allTextContents();
  expect(cells.every((c) => c.trim() === "—")).toBe(true);
  // The document scope names the labelling location and says it is out of scope for the RU.
  await go(page, "#/document");
  await expect(page.getByText("out of scope: labelling and secondary packaging are done at another site").first()).toBeVisible();
});

test("tailoring: a topic can only be left out with a reason, and it is listed in the document scope", async ({ page }, testInfo) => {
  // A long flow (dialog, document, dialog again) that runs slower when the whole suite shares the machine.
  test.setTimeout(120_000);
  await loadDemo(page);
  await openSummary(page, "uo.bulk_packaging");
  await page.getByTestId("tailor-open").click();
  const dialog = page.getByRole("dialog", { name: "Tailor Bulk packaging" });
  await expect(dialog).toBeVisible();
  // Default: every topic included.
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(4);
  await expect(dialog.locator('input[type="checkbox"]:checked')).toHaveCount(4);
  await dialog.getByRole("checkbox", { name: /Hold and temperature/ }).uncheck();
  await expectAccessible(page, "tailor dialog");
  await shot(page, "tailor-dialog", testInfo);
  // No reason: refused with a message, nothing changes.
  await dialog.getByRole("button", { name: "Save scope" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Give a reason");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Reason for leaving out/).fill("Bulk is packed and labelled in one shift (fictional)");
  await dialog.getByRole("button", { name: "Save scope" }).click();
  await expect(dialog).toBeHidden();
  // The topic's questions are gone from the section review.
  const rows = await page.locator("table.data tbody th").allTextContents();
  expect(rows.join("|")).not.toContain("Bulk hold time");
  expect(rows.join("|")).toContain("Bulk container");
  await expect(page.getByTestId("tailor-open")).toContainText("1 left out");
  // The document scope lists the topic with its reason.
  await go(page, "#/document");
  await expect(page.getByText("Scope exclusions").first()).toBeVisible();
  await expect(page.getByText("Bulk is packed and labelled in one shift (fictional)").first()).toBeVisible();
  await expectAccessible(page, "document scope with exclusion");
  await expectNoHorizontalScroll(page, "document scope with exclusion");
  await page.getByText("Scope exclusions").first().scrollIntoViewIfNeeded();
  await shot(page, "document-scope-exclusions", testInfo);
  // Switching it back on restores the questions and the values.
  await openSummary(page, "uo.bulk_packaging");
  await page.getByTestId("tailor-open").click();
  await dialog.getByRole("checkbox", { name: /Hold and temperature/ }).check();
  await dialog.getByRole("button", { name: "Save scope" }).click();
  await expect(dialog).toBeHidden();
  const back = await page.locator("table.data tbody th").allTextContents();
  expect(back.join("|")).toContain("Bulk hold time");
  const hold = page.locator("table.data tbody tr", { hasText: "Bulk hold time" }).first();
  await expect(hold).toContainText("48");
});
