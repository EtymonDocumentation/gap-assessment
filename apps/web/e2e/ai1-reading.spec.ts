// Job AI1: "Try the AI reading on an example TRD". A finished example TRD ships with the site and its AI reading was recorded in advance
// (no AI runs). The review screen shows the rules' matches and the AI suggestions apart: each AI row has its own tag, the quote it came
// from, a Reject button, and is never taken by "Accept all". All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, openDemo, openMoreWays } from "./nav-helper";

const SHOTS = tmpdir();
const HOLD = "trd.step.compounding.param.max_hold_time";
const FILTER = "trd.step.sterile_filtration.param.max_filtration_time";
const MODALITY = "trd.detail.modality";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function openExample(page: Page) {
  await loadDemo(page);
  await goTo(page, "Home");
  await openMoreWays(page);
  await page.getByTestId("home-upload-trd-ai-example").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
}

const aiRow = (page: Page, field: string) => page.locator(`[data-testid=import-ai][data-field="${field}"]`);
const banner0 = (page: Page) => page.getByTestId("import-ai-banner").getByRole("heading");
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("Home offers the example; the review shows the banner, the count line, AI tags and visible quotes", async ({ page }) => {
  const name = test.info().project.name;
  await openExample(page);
  const banner = page.getByTestId("import-ai-banner");
  await expect(banner).toContainText("These suggestions were recorded in advance for this example file.");
  await expect(banner).toContainText("No AI reads your own files yet.");
  await expect(banner).toContainText("Check each suggestion against its quote before you accept it.");
  const count = page.getByTestId("import-ai-count");
  await expect(count).toHaveText(/^Rules found \d+\. AI suggests \d+ more\.$/);
  const m = /Rules found (\d+)\. AI suggests (\d+) more/.exec((await count.textContent()) ?? "")!;
  const n = Number(m[2]);
  expect(n).toBeGreaterThanOrEqual(20);
  expect(n).toBeLessThanOrEqual(30);
  // No Accept button that looks broken: a row with only AI suggestions has none; the card holds the Accept.
  await expect(page.locator(`tr.import-prow[data-field^="${HOLD}"]`)).toHaveCount(1);
  await expect(page.locator(`tr.import-prow[data-field^="${HOLD}"] [data-testid=import-row-accept]`)).toHaveCount(0);
  const rows = page.getByTestId("import-ai");
  await expect(rows).toHaveCount(n);
  // Every AI row says so in words (tag), shows its quote and its reason.
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i);
    await expect(r.getByTestId("import-ai-tag")).toHaveText(/AI suggestion/);
    await expect(r.getByTestId("import-ai-quote")).toBeVisible();
    await expect(r.getByTestId("import-ai-why")).not.toBeEmpty();
  }
  await expect(aiRow(page, HOLD).getByTestId("import-ai-quote")).toContainText("24 h");
  // One card per parameter: the value reads like the parameter, and there is one Accept.
  await expect(aiRow(page, HOLD).getByTestId("import-ai-value")).toHaveText("PAR up to 24 h");
  await expect(aiRow(page, HOLD).getByTestId("import-ai-accept")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `ai1-reading-review-${name}.png`) });
  await aiRow(page, HOLD).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `ai1-reading-row-quote-${name}.png`) });
  await expect(page.getByTestId("import-review")).toContainText('"Accept all" skips them: accept or reject each one.');
  await expect(banner).not.toContainText(/wizard|validate|required|error|must/i);
  expect(await noSideways(page)).toBe(false);
});

test("the example Word file can be downloaded and is a real .docx", async ({ page }) => {
  await openExample(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("import-ai-download").click()]);
  expect(dl.suggestedFilename()).toBe("example-finished-trd.docx");
  const bytes = await readFile(await dl.path());
  expect(new PizZip(bytes).file("word/document.xml")!.asText()).toContain("(fictional)");
});

test("Accept all leaves AI suggestions alone; accept two, reject one (Undo restores), then make the TRD", async ({ page }) => {
  test.setTimeout(180_000);
  const name = test.info().project.name;
  await openExample(page);
  const total = await page.getByTestId("import-ai").count();
  // The bulk buttons take the rules' matches only.
  await expect(banner0(page)).toContainText("Example of AI reading");
  for (const id of ["import-accept-exact", "import-accept-table", "import-step-accept"]) {
    const enabled = page.locator(`[data-testid=${id}]:not([disabled])`);
    for (let i = 0; i < 40 && (await enabled.count()) > 0; i++) await enabled.first().click();
  }
  await expect(page.locator("[data-testid=import-ai][data-state=open]")).toHaveCount(total);

  await aiRow(page, HOLD).getByTestId("import-ai-accept").click();
  await expect(aiRow(page, HOLD).getByTestId("import-ai-state")).toHaveText("Accepted");
  await aiRow(page, MODALITY).getByTestId("import-ai-accept").click();
  await expect(aiRow(page, MODALITY).getByTestId("import-ai-state")).toHaveText("Accepted");
  // Reject one: the state says so in words, and Undo restores it.
  const r = aiRow(page, FILTER);
  await r.getByTestId("import-ai-reject").click();
  await expect(r.getByTestId("import-ai-state")).toHaveText("Rejected");
  await r.getByTestId("import-ai-undo").click();
  await expect(r.getByTestId("import-ai-state")).toHaveText("Not accepted yet");
  await r.getByTestId("import-ai-reject").click();
  await expect(r.getByTestId("import-ai-state")).toHaveText("Rejected");
  await aiRow(page, HOLD).getByTestId("import-ai-show").click();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.getByTestId("import-make").scrollIntoViewIfNeeded();
  if ((await page.getByTestId("import-target-new").count()) > 0) await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("ORV-118 example TRD");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `ai1-reading-made-${name}.png`), fullPage: true });
  await page.getByTestId("import-open-trd").click();
  const body = page.locator("main");
  await expect(body).toContainText("ORV-118");
  await expect(body).toContainText("humanized monoclonal antibody");
  // The accepted hold limit (24 h) is in the process tab; the rejected filtration time (45) was not written.
  await page.getByRole("tab", { name: /Process/ }).first().click();
  await page.getByRole("button", { name: "Open all steps" }).click();
  await expect(body).toContainText("24");
  await expect(body).not.toContainText(/45\s*(h|min)/);
  // The rejected limit was never written, so nothing stands in for it; what is still missing stays visible as open items.
  await page.getByRole("tab", { name: /Open items/ }).click();
  await expect(body).toContainText(/No value yet: Details, Program/);
  await page.screenshot({ path: join(SHOTS, `ai1-reading-trd-${name}.png`), fullPage: true });
});

test("the example link sits beside Upload a TRD on the TRD page; no sideways scroll; axe clean in light and dark", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "TRD");
  await expect(page.getByTestId("trd-upload")).toBeVisible();
  await expect(page.getByTestId("trd-upload-ai-example")).toHaveText("Try the AI reading on an example TRD");
  await page.getByTestId("trd-upload-ai-example").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
  expect(await noSideways(page)).toBe(false);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
});
