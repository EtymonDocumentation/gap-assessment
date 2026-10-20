import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const CATEGORIES = [
  "Equivalent",
  "Within validated range",
  "Outside validated range",
  "Different principle",
  "Scale change",
  "New requirement",
  "Removed element",
  "Information required",
];

test.beforeEach(async ({ page }) => {
  // "Replace the open project?" confirmations are accepted; each test starts with empty storage anyway.
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText("Proof of concept. Not validated. Not for GMP use.").first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function downloadText(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click()])) as [Download, void];
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: await readFile(path, "utf8") };
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

test("demo loads in one click and the register covers all eight categories", async ({ page }) => {
  await loadDemo(page);
  const summary = page.getByRole("list", { name: "Count by category" });
  for (const c of CATEGORIES) {
    const btn = summary.getByRole("button", { name: new RegExp(`^${c}\\s+\\d+$`) });
    await expect(btn).toBeVisible();
    const count = Number((await btn.locator(".count").textContent()) ?? "0");
    expect(count, `${c} count`).toBeGreaterThan(0);
  }

  // Filter by category.
  await summary.getByRole("button", { name: /^Outside validated range/ }).click();
  const rows = page.locator("table.register tbody tr:not(.detail-row)");
  await expect(rows.first()).toBeVisible();
  for (const chip of await rows.locator(".chip").allTextContents()) expect(chip).toBe("Outside validated range");
  await summary.getByRole("button", { name: /^Outside validated range/ }).click();

  // Sort by severity: the first row is high.
  await page.getByRole("button", { name: "Sort by Severity" }).click();
  await expect(page.locator("th[aria-sort='ascending']")).toContainText("Severity");
  await expect(rows.first().locator(".sev")).toHaveText("High");

  // Search narrows the rows.
  await page.getByRole("searchbox").fill("pump");
  await expect(rows.first()).toContainText(/pump/i);
  await page.getByRole("searchbox").fill("");

  // Details panel and overlay editor.
  await rows.first().getByRole("button", { name: /^Details/ }).click();
  await expect(page.locator(".detail-row")).toContainText("Rationale:");
  await expect(page.getByRole("form", { name: /^Decisions for/ })).toBeVisible();

  // CSV export.
  const csv = await downloadText(page, () => page.getByRole("button", { name: /^Export CSV/ }).click());
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text.split("\n")[0]).toContain("Category");
  expect(csv.text).not.toMatch(/undefined|NaN/);
});

test("interview: progress map jump, why-asked, paired and sequential order", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview");
  const map = page.getByRole("navigation", { name: "Sections" });
  await expect(map).toBeVisible();

  // Paired: source then target for the same question.
  await map.getByRole("link", { name: /^Pooling, compounding and dilution/ }).click();
  const prompt = page.locator("#q-prompt");
  const badge = page.locator(".question-card .side-badge");
  await expect(badge).toHaveText(/^Source/);
  const firstPrompt = await prompt.textContent();
  await page.getByRole("link", { name: /Skip for now/ }).click();
  await expect(badge).toHaveText(/^Target/);
  await expect(prompt).toHaveText(firstPrompt ?? "");
  await expect(page.locator(".source-ref")).toBeVisible();

  // Why is this asked?
  const why = page.locator("details.why");
  await why.locator("summary").click();
  await expect(why).toHaveAttribute("open", "");
  await expect(why.locator("p").first()).not.toBeEmpty();

  // Sequential: the source pass continues with the next source question.
  await page.locator(".segmented label", { hasText: "Sequential" }).click();
  await expect(page.locator("#mode-help")).toHaveText(/All source answers first/);
  await map.getByRole("link", { name: /^Pooling, compounding and dilution/ }).click();
  await expect(badge).toHaveText(/^Source/);
  await page.getByRole("link", { name: /Skip for now/ }).click();
  await expect(badge).toHaveText(/^Source/);
  await expect(prompt).not.toHaveText(firstPrompt ?? "");

  // Section summary.
  await map.getByRole("link", { name: /^Review Aseptic filling/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Section summary: Aseptic filling/ })).toBeVisible();
});

test("branching: making the target pump the same closes its follow-ups and keeps them as inactive", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.accuracy%40target");
  await expect(page.locator(".question-card .trigger")).toContainText("differs from the source");

  await go(page, "#/interview?q=fill.pump%40target");
  await expect(page.locator(".live-compare")).toContainText("Different principle");
  await page.getByRole("button", { name: "Same as source" }).click();
  await expect(page.locator(".interview-aside .notice")).toContainText("no longer apply");

  await go(page, "#/register");
  await page.getByRole("searchbox").fill("Filling pump");
  // The difference is gone; only an equivalent row remains, and those are hidden by default.
  await expect(page.getByText("No rows match these filters.")).toBeVisible();
  await page.getByLabel("Show equivalent").check();
  await expect(page.locator("table.register tbody tr").first()).toContainText("Equivalent");
});

test("new project: responder, scoping answers, unknown and not-applicable handling", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Smoke test (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();

  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Program or product code");
  await page.locator(".question-card input").first().fill("SMOKE-1");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(prompt).toHaveText("What is the product modality?");
  await page.locator(".question-card .choice-chip").first().click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(prompt).toHaveText("What is the dosage form?");
  await page.getByRole("button", { name: "Unknown — to be confirmed" }).click();
  await expect(prompt).toHaveText("What is the primary container presentation?");

  // Not applicable needs a justification.
  await page.getByRole("button", { name: "Not applicable…" }).click();
  await page.getByRole("button", { name: "Record as not applicable" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(prompt).toHaveText("What is the primary container presentation?");

  await expect(page.locator(".interview-aside")).toContainText("3 of");

  await go(page, "#/model");
  await expect(page.getByRole("table")).toContainText("SMOKE-1");
  await expect(page.getByRole("table")).toContainText("Unknown");
});

test("side by side markers link to the register row", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  const marker = page.locator("a.marker", { hasText: "Scale change" }).first();
  await marker.click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.locator("table.register tr.open")).toContainText("Scale change");
});

test("document preview and downloads", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  const preview = page.locator(".doc-preview");
  await expect(preview).toContainText("Gap assessment: ARX-217");
  await expect(preview).toContainText("Requires regulatory affairs assessment");

  const md = await downloadText(page, () => page.getByRole("button", { name: "Download Markdown" }).click());
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toContain("# Gap assessment: ARX-217");
  expect(md.text).toContain("Proof of concept. Not validated. Not for GMP use.");
  expect(md.text).not.toMatch(/undefined|NaN/);

  const html = await downloadText(page, () => page.getByRole("button", { name: "Download HTML" }).click());
  expect(html.name).toMatch(/\.html$/);
  expect(html.text).toContain("<!doctype html>");
  expect(html.text).toContain("Not for GMP use");
});

for (const theme of ["light", "dark"] as const) {
  test(`accessibility and layout, ${theme} theme`, async ({ page }) => {
    await loadDemo(page);
    await page.getByLabel("Colour theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const routes = ["#/", "#/interview?q=fill.pump%40target", "#/interview?summary=uo.aseptic_filling", "#/compare", "#/register", "#/document", "#/model"];
    for (const r of routes) {
      await go(page, r);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectAccessible(page, `${theme} ${r}`);
      await expectNoHorizontalScroll(page, `${theme} ${r}`);
    }
    // Open register details and a dialog are checked too.
    await go(page, "#/register");
    await page.locator("table.register tbody tr").first().getByRole("button", { name: /^Details/ }).click();
    await expectAccessible(page, `${theme} register details`);
    await go(page, "#/");
    await page.getByRole("button", { name: "Close and delete…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `${theme} dialog`);
  });
}
