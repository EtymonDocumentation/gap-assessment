// Milestone 8: the risk assessment (ICH Q9(R1)). No default method; load-outs as starters; items by step and as a register table;
// seeding from gaps and from the failure-mode catalog; traceability to gaps and sampling points; the matrix heat view; Word and HTML
// output; accessibility at three widths in light and dark. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** Through the navigation, so the "Risk" link is part of what is tested. On a phone it sits behind the menu button. */
async function openRisk(page: Page) {
  await loadDemo(page);
  const nav = page.getByRole("link", { name: "Risk", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByTestId("risk-scope-text")).toBeVisible();
}

async function openDemoAssessment(page: Page, tab: "method" | "items" | "actions" | "output" = "items") {
  await openRisk(page);
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await expect(page.getByTestId("risk-tabs")).toBeVisible();
  await page.getByTestId(`risk-tab-${tab}`).click();
}

async function createBlank(page: Page, title: string) {
  await openRisk(page);
  await page.getByTestId("risk-title-input").fill(title);
  await page.getByTestId("risk-create").click();
  await expect(page.getByTestId("risk-tabs")).toBeVisible();
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

async function download(page: Page, testId: string): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTestId(testId).click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

const wordXml = (bytes: Buffer) => new PizZip(bytes).file("word/document.xml")!.asText();
const wordText = (bytes: Buffer) => wordXml(bytes).replace(/<[^>]+>/g, " ");

const itemCount = async (page: Page) => Number(/\((\d+)\)/.exec(await page.locator("#ri-list").innerText())![1]);

test("the page says what the tool does; a new assessment has no method, and the starters are offered", async ({ page }) => {
  await openRisk(page);
  await expect(page.getByTestId("risk-scope-text")).toContainText("does not judge whether a risk is acceptable");
  await expect(page.getByTestId("risk-list")).toContainText("ARX-217");
  await expect(page.getByText(BANNER).first()).toBeVisible();

  await page.getByTestId("risk-title-input").fill("Blank assessment (fictional)");
  await page.getByTestId("risk-create").click();
  await expect(page.getByTestId("risk-open-items")).toContainText("No risk method has been chosen");
  await expect(page.getByTestId("risk-method-summary")).toHaveCount(0);
  for (const id of ["fmea-1-10", "fmea-1-5", "matrix-3x3", "matrix-5x5", "qualitative-hml"]) await expect(page.getByTestId(`risk-loadout-${id}`)).toBeVisible();
});

test("a starter is a copy the person edits: the FMEA scale and bands can be changed, and bands are the user's own", async ({ page }) => {
  await createBlank(page, "Starter edit (fictional)");
  await page.getByTestId("risk-loadout-fmea-1-5").click();
  await expect(page.getByTestId("risk-method-summary")).toContainText("FMEA");
  // The starter carries no bands: the page says so.
  await expect(page.getByTestId("risk-method-summary")).toContainText("No bands defined by the user");
  await page.getByTestId("scale-Severity-max").fill("10");
  await page.getByTestId("band-add").click();
  await page.getByTestId("band-label-0").fill("Review needed (fictional wording)");
  await page.getByTestId("band-min-0").fill("1");
  await page.getByTestId("band-max-0").fill("500");
  await page.getByTestId("risk-method-save").click();
  await expect(page.getByTestId("risk-method-summary")).toContainText("Review needed (fictional wording)");
  await expect(page.getByTestId("risk-method-summary")).toContainText("1 to 10");
});

test("matrix method: score an item, see the cell in the heat view, then a different method clears the scores after a warning", async ({ page }) => {
  await createBlank(page, "Matrix (fictional)");
  await page.getByTestId("risk-loadout-matrix-3x3").click();
  await expect(page.getByTestId("risk-method-grid")).toBeVisible();
  await page.getByTestId("risk-tab-items").click();
  await page.getByTestId("risk-add-mode").fill("Pump seizes during fill (fictional)");
  await page.getByTestId("risk-add-submit").click();
  const card = page.getByTestId("risk-item-RA-001");
  await expect(card).toContainText("Pump seizes during fill (fictional)");
  await expect(card).toContainText("Not scored");
  await page.getByTestId("risk-item-edit-RA-001").click();
  await page.getByTestId("score-initial-likelihood").selectOption({ label: "Possible" });
  await page.getByTestId("score-initial-severity").selectOption({ label: "Major" });
  await page.getByTestId("item-save").click();
  await expect(page.getByTestId("risk-item-RA-001")).toContainText("High");
  await expect(page.getByTestId("heat-2-3")).toContainText("1 item");
  await expect(page.getByTestId("heat-2-3")).toContainText("RA-001");

  await page.getByTestId("risk-tab-method").click();
  await page.getByTestId("risk-loadout-qualitative-hml").click();
  await expect(page.getByTestId("risk-method-clear-warning")).toContainText("1 item has scores");
  await page.getByTestId("risk-method-confirm").click();
  await expect(page.getByTestId("risk-open-items")).toContainText("RA-001 is not scored");
});

test("qualitative method asks for a written reason: a level without one is an open item", async ({ page }) => {
  await createBlank(page, "Qualitative (fictional)");
  await page.getByTestId("risk-loadout-qualitative-hml").click();
  await page.getByTestId("risk-tab-items").click();
  await page.getByTestId("risk-add-mode").fill("Label mix-up (fictional)");
  await page.getByTestId("risk-add-submit").click();
  await page.getByTestId("risk-item-edit-RA-001").click();
  await page.getByTestId("score-initial-level").selectOption({ label: "Medium" });
  await page.getByTestId("item-save").click();
  await expect(page.getByTestId("risk-open-items")).toContainText("RA-001");
  await expect(page.getByTestId("risk-open-items")).toContainText(/reason/i);
});

test("the demo: FMEA 1-10 with ten items, the register table sorts and filters, and residual is optional", async ({ page }) => {
  await openDemoAssessment(page);
  expect(await itemCount(page)).toBe(10);
  await expect(page.getByTestId("risk-open-items")).toContainText("RA-008 is not scored");

  await page.getByTestId("risk-view-table").click();
  await expect(page.getByTestId("risk-register").locator("tbody tr")).toHaveCount(10);
  await page.getByTestId("risk-sort").selectOption("score");
  // The highest RPN first (10 x 4 x 5 = 200); the items that cannot be scored go last, never first.
  await expect(page.getByTestId("risk-register").locator("tbody tr").first()).toContainText("RA-002");
  await expect(page.getByTestId("risk-register").locator("tbody tr").first()).toContainText("200");
  await page.getByTestId("risk-filter").selectOption("not-scored");
  await expect(page.getByTestId("risk-register-count")).toContainText("of 10 items");
  await expect(page.getByTestId("risk-register").locator("tbody tr").first()).toContainText("Not scored");
  await page.getByTestId("risk-filter").selectOption("residual");
  await expect(page.getByTestId("risk-register").locator("tbody tr")).toHaveCount(3);
  await page.getByTestId("risk-filter").selectOption("open-action");
  await expect(page.getByTestId("risk-register").locator("tbody tr")).toHaveCount(3);
});

test("an item is a collapsed card with Edit; the form opens in place and focus returns to Edit", async ({ page }) => {
  await openDemoAssessment(page);
  await expect(page.getByTestId("risk-item-RA-001")).toContainText("Score:");
  await expect(page.getByTestId("item-failure-mode")).toHaveCount(0);
  await page.getByTestId("risk-item-edit-RA-001").click();
  await expect(page.getByTestId("item-failure-mode")).toBeFocused();
  await expect(page.getByTestId("item-gaps")).toHaveCount(0);
  await page.getByTestId("item-cancel").click();
  await expect(page.getByTestId("risk-item-edit-RA-001")).toBeFocused();
  await expect(page.getByTestId("item-failure-mode")).toHaveCount(0);
});

test("the gap severity is shown as reference text and never becomes a score", async ({ page }) => {
  await openDemoAssessment(page);
  const before = await itemCount(page);
  await page.getByTestId("risk-from-gaps").locator("summary").click();
  await expect(page.getByTestId("risk-from-gaps")).toContainText("Gap severity (reference only)");
  await page.getByTestId("risk-from-gaps").locator('input[type="checkbox"]:not([disabled])').first().check();
  await page.getByTestId("risk-gaps-add").click();
  expect(await itemCount(page)).toBe(before + 1);
  // The new draft item has no score, whatever the gap severity was.
  await page.getByTestId("risk-view-table").click();
  await expect(page.getByTestId("risk-register").locator("tbody tr").last()).toContainText("Not scored");
});

test("catalog suggestions are offers: nothing is added until the person adds one", async ({ page }) => {
  await openDemoAssessment(page);
  const before = await itemCount(page);
  await page.getByTestId("risk-suggestions").locator("summary").click();
  const first = page.getByTestId("risk-suggestions").locator('button:not([disabled])').first();
  await expect(first).toBeVisible();
  expect(await itemCount(page)).toBe(before);
  await first.click();
  expect(await itemCount(page)).toBe(before + 1);
});

test("a free item is added with the short form; More details opens the full form", async ({ page }) => {
  await openDemoAssessment(page);
  const before = await itemCount(page);
  await page.getByTestId("risk-add-mode").fill("Stopper misfeed (fictional)");
  await page.getByTestId("risk-add-more").click();
  await expect(page.getByTestId("item-failure-mode")).toBeFocused();
  await expect(page.getByTestId("item-failure-mode")).toHaveValue("Stopper misfeed (fictional)");
  await page.getByTestId("score-initial-severity").selectOption("6");
  await page.getByTestId("score-initial-occurrence").selectOption("3");
  // One answer is still missing, so the item stays "Not scored" and the open item says which.
  await page.getByTestId("item-save").click();
  expect(await itemCount(page)).toBe(before + 1);
  await expect(page.getByTestId("risk-open-items")).toContainText("Detection has no value");
});

test("actions: add one with no owner and no date; it says Not given", async ({ page }) => {
  await openDemoAssessment(page, "actions");
  const before = await page.getByTestId("risk-action-list").locator("> li").count();
  await page.getByTestId("action-item").selectOption("RA-005");
  await page.getByTestId("action-text").fill("Review the inspection recipe (fictional)");
  await page.getByTestId("action-add").click();
  await expect(page.getByTestId("risk-action-list").locator("> li")).toHaveCount(before + 1);
  await expect(page.getByTestId("risk-action-list").locator("> li").last()).toContainText("Owner:Not given");
});

test("traceability reads both ways: the gap and the sampling point name the risk item", async ({ page }) => {
  await loadDemo(page);
  await page.evaluate(() => (window.location.hash = "#/compare"));
  await expect(page.locator('[data-testid^="gap-risk-"]').first()).toContainText("In risk assessment:");
  await page.evaluate(() => (window.location.hash = "#/sampling"));
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.locator('[data-testid^="point-risk-"]').first()).toContainText("Linked risk:");
});

test("Word and HTML downloads carry the banner, the method, the register, the open items and the versions; the export history lists them", async ({ page }) => {
  await openDemoAssessment(page, "output");
  await page.getByTestId("risk-preview-toggle").click();
  const preview = page.getByTestId("risk-preview");
  await expect(preview).toContainText("Risk assessment — draft");
  await expect(preview).toContainText("No bands defined by the user");
  await expect(preview).toContainText("Not scored");

  const word = await download(page, "risk-download-word");
  expect(word.file).toMatch(/^risk-assessment-.*\.docx$/);
  const text = wordText(word.bytes);
  expect(text).toContain(BANNER);
  for (const h of ["Purpose and scope", "Risk method", "Risk register", "Action list", "Open items", "Traceability"]) expect(text).toContain(h);
  expect(text).toMatch(/does not judge whether any risk is acceptable/);

  const html = await download(page, "risk-download-html");
  expect(html.file).toMatch(/^risk-assessment-.*\.html$/);
  const htmlText = html.bytes.toString("utf8");
  expect(htmlText).toContain(BANNER);
  expect(htmlText).toMatch(/<h2[^>]*>[^<]*Risk register/);

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.getByRole("cell", { name: "Risk assessment (Word)" })).toBeVisible();
  await expect(history.getByRole("cell", { name: "Risk assessment (HTML)" })).toBeVisible();
});

test("the open-items warning shows the count before a download", async ({ page }) => {
  await openDemoAssessment(page, "output");
  await page.getByTestId("risk-download-html").click();
  await expect(page.getByTestId("risk-tbd-warning")).toContainText(/open item/);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByTestId("risk-tbd-warning")).toHaveCount(0);
});

test("leaving an optional section out of the download removes it from the document", async ({ page }) => {
  await openDemoAssessment(page, "output");
  await page.getByTestId("risk-section-actions").uncheck();
  await page.getByTestId("risk-section-traceability").uncheck();
  const html = await download(page, "risk-download-html");
  const t = html.bytes.toString("utf8");
  expect(t).not.toMatch(/<h2[^>]*>[^<]*Action list/);
  expect(t).not.toMatch(/<h2[^>]*>[^<]*Traceability/);
  expect(t).toMatch(/<h2[^>]*>[^<]*Open items/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`risk pages are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000); // several axe passes; slower when the whole suite runs in parallel
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `m8-${name}-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: scheme });
    await openDemoAssessment(page, "method");
    await expectAccessible(page, `${scheme} method`);
    await expectNoHorizontalScroll(page, `${scheme} method`);
    await shot("method");

    await page.getByTestId("risk-tab-items").click();
    await expectAccessible(page, `${scheme} items by step`);
    await expectNoHorizontalScroll(page, `${scheme} items by step`);
    await shot("items");
    await page.getByTestId("risk-item-edit-RA-003").click();
    await expectAccessible(page, `${scheme} item expanded`);
    await shot("item-expanded");
    await page.getByTestId("item-cancel").click();

    await page.getByTestId("risk-view-table").click();
    await expectAccessible(page, `${scheme} register table`);
    await expectNoHorizontalScroll(page, `${scheme} register table`);
    await shot("register");

    await page.getByTestId("risk-tab-actions").click();
    await expectAccessible(page, `${scheme} actions`);
    await expectNoHorizontalScroll(page, `${scheme} actions`);

    await page.getByTestId("risk-tab-output").click();
    await page.getByTestId("risk-preview-toggle").click();
    await expectAccessible(page, `${scheme} output`);
    await expectNoHorizontalScroll(page, `${scheme} output`);
    await shot("output");

    await page.evaluate(() => (window.location.hash = "#/risk/methods"));
    await expect(page.getByRole("heading", { level: 1, name: "Risk methods" })).toBeVisible();
    await expectAccessible(page, `${scheme} method library`);
    await expectNoHorizontalScroll(page, `${scheme} method library`);
  });

  test(`matrix heat view is accessible: ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await createBlank(page, "Heat view (fictional)");
    await page.getByTestId("risk-loadout-matrix-5x5").click();
    await page.getByTestId("risk-tab-items").click();
    for (const [mode, l, s] of [["Seal leak (fictional)", "Possible", "Major"], ["Vial crack (fictional)", "Possible", "Major"], ["Label smear (fictional)", "Rare", "Minor"]] as const) {
      await page.getByTestId("risk-add-mode").fill(mode);
      await page.getByTestId("risk-add-more").click();
      await page.getByTestId("score-initial-likelihood").selectOption({ label: l });
      await page.getByTestId("score-initial-severity").selectOption({ label: s });
      await page.getByTestId("item-save").click();
    }
    await expect(page.getByTestId("heat-3-4")).toContainText("2 items");
    await expectAccessible(page, `${scheme} heat view`);
    await expectNoHorizontalScroll(page, `${scheme} heat view`);
    await page.getByTestId("risk-heat").screenshot({ path: join(SHOTS, `m8-heat-${test.info().project.name}-${scheme}.png`) });
  });
}
