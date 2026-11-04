// Milestone 5.1: program stage per side and the stage-aware wording. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNotice, openDemo } from "./nav-helper";


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
  await expectNotice(page);
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Stage test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
}

/** Chooses one option for one side of the open choice question (SU and RU are on one card) and saves that side. */
async function answerChoice(page: Page, side: "source" | "target", option: string) {
  await page.locator(`fieldset.side-panel[data-side="${side}"] .choice-chip`, { hasText: option }).click();
  await page.getByRole("button", { name: side === "source" ? "Save SU" : "Save RU", exact: true }).click();
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

test("a new project asks the program stage for each side, with no preselected option", async ({ page }) => {
  await newProject(page);
  await go(page, "#/interview?q=site.stage%40source");
  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Which batches does each site make or plan to make?");
  // SU and RU are on one card, each with the four options and none preselected.
  await expect(page.locator(".question-card .choice-chip")).toHaveCount(8);
  await expect(page.locator(".question-card input[type=radio]:checked")).toHaveCount(0);
  for (const side of ["source", "target"] as const) {
    await expect(page.locator(`fieldset.side-panel[data-side="${side}"] .choice-chip`)).toHaveCount(4);
    for (const label of ["Commercial batches (process validated)", "PPQ batches (process performance qualification)", "Clinical batches (GMP, not process-validated)", "Engineering / development runs"]) {
      await expect(page.locator(`fieldset.side-panel[data-side="${side}"] .choice-chip`, { hasText: label })).toBeVisible();
    }
  }
  await expectAccessible(page, "stage question");
  await expectNoHorizontalScroll(page, "stage question");

  // Unanswered: Compare shows the stage as TBD and the document says so too.
  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("Sending-site stage: [TBD]. Project stage: [TBD]");
  await go(page, "#/document");
  await expect(page.getByRole("heading", { name: "Sending unit program summary (current state)" }).first()).toBeVisible();
});

test("a clinical source: stage-aware labels on Compare, Register and the Document", async ({ page }) => {
  test.setTimeout(120_000); // five pages and four axe scans
  await loadDemo(page);

  // SU: clinical. RU stays PPQ.
  await go(page, "#/interview?q=site.stage%40source");
  await expect(page.locator("#q-prompt")).toHaveText("Which batches does each site make or plan to make?");
  await answerChoice(page, "source", "Clinical batches (GMP, not process-validated)");

  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  await expect(page.getByTestId("stage-line")).toContainText("Sending-site stage: Clinical batches (GMP, not process-validated). Project stage: PPQ batches (process performance qualification)");
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
  await expectNotice(page);
  await expectAccessible(page, "document, clinical source");
  await expectNoHorizontalScroll(page, "document, clinical source");

  await go(page, "#/validation");
  await expect(page.getByRole("heading", { level: 3, name: "Stage basis" })).toBeVisible();
  await expect(page.locator("main")).toContainText("no SU PPQ or process validation evidence to leverage");
  await expect(page.locator("main")).toContainText("runs process performance qualification batches");
  await expectAccessible(page, "validation, clinical source");
  await expectNoHorizontalScroll(page, "validation, clinical source");
});

test("both stages answered in a new project show on Home and Compare, and the banner stays", async ({ page }) => {
  await newProject(page);
  await go(page, "#/interview?q=site.stage%40source");
  await answerChoice(page, "source", "Engineering / development runs");
  await go(page, "#/interview?q=site.stage%40target");
  await expect(page.locator("#q-prompt")).toHaveText("Which batches does each site make or plan to make?");
  await answerChoice(page, "target", "Clinical batches (GMP, not process-validated)");

  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("Sending-site stage: Engineering / development runs. Project stage: Clinical batches (GMP, not process-validated)");

  await go(page, "#/");
  const card = page.getByTestId("open-project");
  await expect(card).toContainText("Sending-site stage");
  await expect(card).toContainText("Project stage");
  await expectNotice(page);
  await expectAccessible(page, "home with stages");
  await expectNoHorizontalScroll(page, "home with stages");
});

test("the demo (commercial sending site, PPQ project) keeps the validated wording", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByTestId("stage-line")).toContainText("Sending-site stage: Commercial batches (process validated). Project stage: PPQ batches (process performance qualification)");
  await expect(page.locator(".chip", { hasText: "Outside validated range" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "SU (validated)" }).first()).toBeVisible();
  await go(page, "#/document");
  await expect(page.getByRole("heading", { name: "Sending unit program summary (validated state)" }).first()).toBeVisible();
});
