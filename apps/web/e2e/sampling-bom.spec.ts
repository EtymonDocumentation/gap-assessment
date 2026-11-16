// The sampling bill of materials: its page (a tab of the plan), the numbers, Word and HTML downloads, its own export history,
// accessibility and no sideways scrolling on desktop, tablet and phone. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, NOTICE_DOCUMENT, openDemo } from "./nav-helper";

const SHOTS = tmpdir();
const INTRO = "Lists what may be used to take the PPQ samples. The batch record records what is actually used.";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openBom(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
  await page.getByTestId("bom-open").click();
  await expect(page.getByTestId("bom-view")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

const wordText = (bytes: Buffer) => new PizZip(bytes).file("word/document.xml")!.asText().replace(/<[^>]+>/g, " ");

async function download(page: Page, testId: string): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTestId(testId).click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["tablet", { width: 820, height: 1100 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`the bill of materials page reads clearly and is accessible on ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openBom(page);
    await expect(page.getByTestId("bom-view").getByText(INTRO)).toBeVisible();
    await expect(page.getByTestId("bom-section-bom-still")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Still to be stated" })).toBeVisible();
    await expectNoHorizontalScroll(page, name);
    await expectAccessible(page, name);
    await page.screenshot({ path: join(SHOTS, `sampling-bom-${name}.png`), fullPage: true });
  });
}

test("each row total is the sum of its batch quantities", async ({ page }) => {
  await openBom(page);
  const tables = page.getByTestId("bom-view").locator("table.bom-table");
  expect(await tables.count()).toBeGreaterThan(0);
  const first = tables.first();
  const heads = await first.locator("thead th").allTextContents();
  const from = heads.indexOf("Sampling points") + 1;
  const to = heads.indexOf("Total");
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  const rows = first.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  for (let r = 0; r < (await rows.count()); r++) {
    const cells = (await rows.nth(r).locator("th, td").allTextContents()).map((t) => parseInt(t, 10));
    const sum = cells.slice(from, to).reduce((a, b) => a + b, 0);
    expect(cells[to], `row ${r + 1}`).toBe(sum);
  }
});

test("Word and HTML downloads carry the notice and the intro, and each is in the bill of materials export history", async ({ page }) => {
  await openBom(page);
  const word = await download(page, "bom-download-word");
  expect(word.file).toMatch(/^sampling-bom-.*\.docx$/);
  const text = wordText(word.bytes);
  expect(text).toContain(NOTICE_DOCUMENT);
  expect(text).toContain(INTRO);
  expect(text).toContain("Still to be stated");
  expect(text).not.toMatch(/filing category/i);
  const html = await download(page, "bom-download-html");
  expect(html.file).toMatch(/^sampling-bom-.*\.html$/);
  const h = html.bytes.toString("utf8");
  expect(h).toContain(NOTICE_DOCUMENT);
  expect(h).toContain(INTRO);
  const region = page.getByRole("region", { name: "Bill of materials export history table" });
  await expect(region.getByRole("cell", { name: "Sampling bill of materials (Word)" })).toBeVisible();
  await expect(region.getByRole("cell", { name: "Sampling bill of materials (HTML)" })).toBeVisible();
});
