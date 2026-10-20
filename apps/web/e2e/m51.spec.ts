// Milestone 5.1: program stage per side and the stage-aware wording. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";

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

async function newProject(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Stage test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
}

/** Chooses one option of the open choice question and saves it. */
async function answerChoice(page: Page, option: string) {
  await page.locator(".question-card .choice-chip", { hasText: option }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

test("a new project asks the program stage for each side, with no preselected option", async ({ page }) => {
  await newProject(page);
  await go(page, "#/interview?q=site.stage%40source");
  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Program stage at this site");
  await expect(page.locator(".question-card .choice-chip")).toHaveCount(3);
  await expect(page.locator(".question-card input[type=radio]:checked")).toHaveCount(0);
  for (const label of ["Commercial (process validated)", "Clinical (GMP, not process validated)", "Development / engineering runs"]) {
    await expect(page.locator(".question-card .choice-chip", { hasText: label })).toBeVisible();
  }
  await expectAccessible(page, "stage question");
  await expectNoHorizontalScroll(page, "stage question");

  // Unanswered: Compare shows the stage as not established and the document says so too.
  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("sending unit (SU) [not established]; receiving unit (RU) [not established]");
  await go(page, "#/document");
  await expect(page.getByRole("heading", { name: "Sending unit program summary (current state)" }).first()).toBeVisible();
});

test("a clinical source: stage-aware labels on Compare, Register and the Document", async ({ page }) => {
  test.setTimeout(120_000); // five pages and four axe scans
  await loadDemo(page);

  // SU: clinical. RU stays commercial.
  await go(page, "#/interview?q=site.stage%40source");
  await expect(page.locator("#q-prompt")).toHaveText("Program stage at this site");
  await answerChoice(page, "Clinical (GMP, not process validated)");

  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  await expect(page.getByTestId("stage-line")).toContainText("sending unit (SU) Clinical (GMP, not process validated); receiving unit (RU) Commercial (process validated)");
  await expect(page.getByRole("columnheader", { name: "SU (current)" }).first()).toBeVisible();
  await expect(page.locator(".chip", { hasText: "Within SU range" }).first()).toBeVisible();
  await expect(page.locator(".chip", { hasText: "Outside SU range" }).first()).toBeVisible();
  await expect(page.locator(".chip", { hasText: "validated range" })).toHaveCount(0);
  await expectAccessible(page, "compare, clinical source");
  await expectNoHorizontalScroll(page, "compare, clinical source");

  await go(page, "#/register");
  await expect(page.getByRole("list", { name: "Count by category" }).getByRole("button", { name: /^Outside SU range\s+\d+$/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Count by category" }).getByRole("button", { name: /validated range/ })).toHaveCount(0);

  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sending unit program summary (current state)" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /\(validated state\)/ })).toHaveCount(0);
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expectAccessible(page, "document, clinical source");
  await expectNoHorizontalScroll(page, "document, clinical source");

  await go(page, "#/validation");
  await expect(page.getByRole("heading", { level: 3, name: "Stage basis" })).toBeVisible();
  await expect(page.locator("main")).toContainText("no SU PPQ or process validation evidence to leverage");
  await expect(page.locator("main")).toContainText("typically a full PPQ");
  await expectAccessible(page, "validation, clinical source");
  await expectNoHorizontalScroll(page, "validation, clinical source");
});

test("both stages answered in a new project show on Home and Compare, and the banner stays", async ({ page }) => {
  await newProject(page);
  await go(page, "#/interview?q=site.stage%40source");
  await answerChoice(page, "Development / engineering runs");
  await go(page, "#/interview?q=site.stage%40target");
  await expect(page.locator("#q-prompt")).toHaveText("Program stage at this site");
  await answerChoice(page, "Clinical (GMP, not process validated)");

  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("sending unit (SU) Development / engineering runs; receiving unit (RU) Clinical (GMP, not process validated)");

  await go(page, "#/");
  const card = page.locator("section.card", { hasText: "Open project" });
  await expect(card).toContainText("Sending unit (SU): Development / engineering runs");
  await expect(card).toContainText("Receiving unit (RU): Clinical (GMP, not process validated)");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expectAccessible(page, "home with stages");
  await expectNoHorizontalScroll(page, "home with stages");
});

test("the demo (both sides commercial) keeps the validated wording", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("sending unit (SU) Commercial (process validated); receiving unit (RU) Commercial (process validated)");
  await expect(page.locator(".chip", { hasText: "Outside validated range" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "SU (validated)" }).first()).toBeVisible();
  await go(page, "#/document");
  await expect(page.getByRole("heading", { name: "Sending unit program summary (validated state)" }).first()).toBeVisible();
});
