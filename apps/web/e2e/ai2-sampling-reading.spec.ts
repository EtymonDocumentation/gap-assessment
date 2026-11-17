// Job AI2: "Try the AI reading on an example sampling plan". A finished example sampling plan ships with the site and its AI reading was
// recorded in advance (no AI runs). The review screen shows the rules' rows and the AI suggestions apart: one card per sampling point,
// with its tag, quote, a Reject button, never taken by "Accept all". All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, openDemo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openExample(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await expect(page.getByTestId("sampling-upload")).toBeVisible();
  await expect(page.getByTestId("sampling-upload-ai-example")).toHaveText("Try the AI reading on an example sampling plan");
  await page.getByTestId("sampling-upload-ai-example").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
}

const card = (page: Page, title: string) => page.locator("[data-testid=import-ai]").filter({ has: page.locator("strong", { hasText: title }) });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("the review shows the banner, the count line, AI cards with tags and visible quotes", async ({ page }) => {
  const name = test.info().project.name;
  await openExample(page);
  await expect(page.getByRole("heading", { level: 1, name: "AI reading of an example sampling plan" })).toBeVisible();
  const banner = page.getByTestId("import-ai-banner");
  await expect(banner).toContainText("These suggestions were recorded in advance for this example file.");
  await expect(banner).toContainText("No AI reads your own files yet.");
  await expect(banner).toContainText("Check each suggestion against its quote before you accept it.");
  await expect(banner).not.toContainText(/wizard|validate|required|error|must/i);
  await expect(page.getByTestId("import-ai-download")).toHaveText("Download the example sampling plan (Word)");
  const count = page.getByTestId("import-ai-count");
  await expect(count).toHaveText(/^Rules found \d+\. AI suggests \d+ more\.$/);
  const m = /Rules found (\d+)\. AI suggests (\d+) more/.exec((await count.textContent()) ?? "")!;
  const rules = Number(m[1]);
  const n = Number(m[2]);
  expect(rules).toBeGreaterThanOrEqual(4);
  expect(n).toBeGreaterThanOrEqual(15);
  expect(n).toBeLessThanOrEqual(25);
  await expect(page.getByTestId("import-row")).toHaveCount(rules);
  const cards = page.getByTestId("import-ai");
  await expect(cards).toHaveCount(n);
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    await expect(c.getByTestId("import-ai-tag")).toHaveText(/AI suggestion/);
    await expect(c.getByTestId("import-ai-quote").first()).toBeVisible();
    await expect(c.getByTestId("import-ai-why")).not.toBeEmpty();
    await expect(c.getByTestId("import-ai-accept")).toHaveCount(1);
  }
  await expect(card(page, "Finished product: Sterility").getByTestId("import-ai-quote")).toContainText("20 filled vials");
  await expect(page.getByTestId("import-review")).toContainText('"Accept all" skips them: accept or reject each one.');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `ai2-sampling-review-${name}.png`) });
  await card(page, "Finished product: Sterility").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `ai2-sampling-card-${name}.png`) });
  expect(await noSideways(page)).toBe(false);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(axe.violations.map((v) => `${theme} ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});

test("the example Word file can be downloaded and is a real .docx", async ({ page }) => {
  await openExample(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("import-ai-download").click()]);
  expect(dl.suggestedFilename()).toBe("example-finished-sampling-plan.docx");
  const bytes = await readFile(await dl.path());
  expect(new PizZip(bytes).file("word/document.xml")!.asText()).toContain("(fictional)");
});

test("Accept all leaves AI cards alone; accept two, reject one (Undo restores), then make the plan", async ({ page }) => {
  test.setTimeout(180_000);
  const name = test.info().project.name;
  await openExample(page);
  const total = await page.getByTestId("import-ai").count();
  // The bulk buttons take the rules' matches only.
  for (const id of ["import-accept-table", "import-accept-row"]) {
    const enabled = page.locator(`[data-testid=${id}]:not([disabled])`);
    for (let i = 0; i < 40 && (await enabled.count()) > 0; i++) await enabled.first().click();
  }
  await expect(page.locator("[data-testid=import-ai][data-state=open]")).toHaveCount(total);

  const sterility = card(page, "Finished product: Sterility");
  const endo = card(page, "Finished product: Bacterial endotoxins");
  const trap = card(page, "Sterile filtration: Protein concentration");
  await sterility.getByTestId("import-ai-accept").click();
  await expect(sterility.getByTestId("import-ai-state")).toHaveText("Accepted");
  await endo.getByTestId("import-ai-accept").click();
  await expect(endo.getByTestId("import-ai-state")).toHaveText("Accepted");
  await trap.getByTestId("import-ai-reject").click();
  await expect(trap.getByTestId("import-ai-state")).toHaveText("Rejected");
  await trap.getByTestId("import-ai-undo").click();
  await expect(trap.getByTestId("import-ai-state")).toHaveText("Not accepted yet");
  await trap.getByTestId("import-ai-reject").click();
  await expect(trap.getByTestId("import-ai-state")).toHaveText("Rejected");
  await sterility.getByTestId("import-ai-show").click();

  await page.getByTestId("import-make").scrollIntoViewIfNeeded();
  if ((await page.getByTestId("import-target-new").count()) > 0) await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("ORV-118 example sampling plan");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await page.screenshot({ path: join(SHOTS, `ai2-sampling-made-${name}.png`), fullPage: true });
  await page.getByTestId("import-open-plan").click();
  const body = page.locator("main");
  await expect(body).toContainText("Sterility");
  await expect(body).toContainText("Bacterial endotoxins");
  await expect(body).not.toContainText("Protein concentration");
  await page.screenshot({ path: join(SHOTS, `ai2-sampling-plan-${name}.png`), fullPage: true });
});
