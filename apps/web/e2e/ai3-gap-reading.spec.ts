// Job AI3: "Try the AI reading on an example gap assessment". A finished example gap assessment ships with the site and its AI reading was
// recorded in advance (no AI runs). The review screen shows the rules' rows and the AI suggestions apart: one card per gap item (one
// question of the tool), with its tag, quote, a Reject button, never taken by "Accept all". All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openExample(page: Page) {
  await page.goto("./#/gap");
  await expect(page.getByTestId("gap-upload")).toBeVisible();
  await expect(page.getByTestId("gap-upload-ai-example")).toHaveText("Try the AI reading on an example gap assessment");
  await page.getByTestId("gap-upload-ai-example").click();
  await expect(page.getByTestId("import-review")).toBeVisible();
}

const card = (page: Page, title: string) => page.locator("[data-testid=import-ai]").filter({ has: page.locator("strong", { hasText: new RegExp(`^${title}$`) }) });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("the review shows the banner, the count line, AI cards with tags and visible quotes", async ({ page }) => {
  const name = test.info().project.name;
  await openExample(page);
  await expect(page.getByRole("heading", { level: 1, name: "AI reading of an example gap assessment" })).toBeVisible();
  const banner = page.getByTestId("import-ai-banner");
  await expect(banner).toContainText("These suggestions were recorded in advance for this example file.");
  await expect(banner).toContainText("No AI reads your own files yet.");
  await expect(banner).toContainText("Check each suggestion against its quote before you accept it.");
  await expect(banner).not.toContainText(/wizard|validate|required|error|must/i);
  await expect(page.getByTestId("import-ai-download")).toHaveText("Download the example gap assessment (Word)");
  const count = page.getByTestId("import-ai-count");
  await expect(count).toHaveText(/^Rules found \d+\. AI suggests \d+ more\.$/);
  const m = /Rules found (\d+)\. AI suggests (\d+) more/.exec((await count.textContent()) ?? "")!;
  const rules = Number(m[1]);
  const n = Number(m[2]);
  expect(rules).toBeGreaterThanOrEqual(4);
  expect(rules).toBeLessThanOrEqual(8);
  expect(n).toBeGreaterThanOrEqual(15);
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
  // The inferred rating is shown with the AI's own doubt, and the quote that does not give it.
  const shipper = card(page, "Shipper qualification status");
  await expect(shipper.getByTestId("import-ai-quote")).toContainText("The shipper is qualified.");
  await expect(shipper.getByTestId("import-ai-why")).toContainText("unsure");
  await expect(card(page, "BBR inlet bioburden limit").getByTestId("import-ai-quote")).toContainText("10 CFU/100 mL");
  await expect(page.getByTestId("import-review")).toContainText('"Accept all" skips them: accept or reject each one.');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `ai3-gap-review-${name}.png`) });
  await card(page, "BBR inlet bioburden limit").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `ai3-gap-card-${name}.png`) });
  expect(await noSideways(page)).toBe(false);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(axe.violations.map((v) => `${theme} ${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});

test("the link sits under the upload button on the gap page (the header does not grow)", async ({ page }) => {
  const name = test.info().project.name;
  await page.goto("./#/gap");
  await expect(page.getByTestId("gap-upload-ai-example")).toBeVisible();
  const up = await page.getByTestId("gap-upload").boundingBox();
  const link = await page.getByTestId("gap-upload-ai-example").boundingBox();
  expect(link!.y).toBeGreaterThan(up!.y + up!.height - 1);
  expect(await noSideways(page)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `ai3-gap-header-${name}.png`) });
});

test("the example Word file can be downloaded and is a real .docx", async ({ page }) => {
  await openExample(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("import-ai-download").click()]);
  expect(dl.suggestedFilename()).toBe("example-finished-gap-assessment.docx");
  const bytes = await readFile(await dl.path());
  expect(new PizZip(bytes).file("word/document.xml")!.asText()).toContain("(fictional)");
});

test("Accept all leaves AI cards alone; accept some, reject one (Undo restores), then make the project", async ({ page }) => {
  test.setTimeout(180_000);
  const name = test.info().project.name;
  await openExample(page);
  const total = await page.getByTestId("import-ai").count();
  // The bulk buttons take the rules' matches only.
  const enabled = page.locator("[data-testid=import-accept-table]:not([disabled]), [data-testid=import-accept-section]:not([disabled])");
  for (let i = 0; i < 40 && (await enabled.count()) > 0; i++) await enabled.first().click();
  await expect(page.locator("[data-testid=import-ai][data-state=open]")).toHaveCount(total);

  // The scope and the "performed at this site" answers make the unit operations appear in a new project.
  for (const t of ["Product modality", "Dosage form", "Primary container presentation"]) void t;
  for (const c of await page.locator("[data-testid=import-ai]").all()) {
    const label = (await c.locator("strong").first().textContent()) ?? "";
    if (label === "Shipper qualification status" || label === "CCI for RU configuration") continue;
    await c.getByTestId("import-ai-accept").click();
  }
  const shipper = card(page, "Shipper qualification status");
  const cci = card(page, "CCI for RU configuration");
  await shipper.getByTestId("import-ai-reject").click();
  await expect(shipper.getByTestId("import-ai-state")).toHaveText("Rejected");
  await shipper.getByTestId("import-ai-undo").click();
  await expect(shipper.getByTestId("import-ai-state")).toHaveText("Not accepted yet");
  await shipper.getByTestId("import-ai-reject").click();
  await expect(shipper.getByTestId("import-ai-state")).toHaveText("Rejected");
  await cci.getByTestId("import-ai-reject").click();
  await expect(cci.getByTestId("import-ai-state")).toHaveText("Rejected");
  await expect(page.locator("[data-testid=import-ai][data-state=accepted]")).toHaveCount(total - 2);
  await card(page, "Thaw principle").getByTestId("import-ai-show").click();

  await page.getByTestId("import-who-name").scrollIntoViewIfNeeded();
  await page.getByTestId("import-title").fill("ORV-118 example gap assessment");
  await page.getByTestId("import-who-name").fill("Test responder (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-done")).toBeVisible();
  await expect(page.getByTestId("import-added")).toContainText(/[1-9]\d* answers recorded/);
  // Every accepted answer was put in: nothing "left open" for an AI item, and the rejected items are no answers.
  const warnings = page.getByTestId("import-warnings");
  if ((await warnings.count()) > 0) {
    await expect(warnings).not.toContainText(/Thaw principle|Mixer principle|Shipping configuration|BBR inlet bioburden limit|Freezing nucleation/);
  }
  await page.screenshot({ path: join(SHOTS, `ai3-gap-made-${name}.png`), fullPage: true });
});
