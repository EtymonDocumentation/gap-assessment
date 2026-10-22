// Milestone 7: the PPQ sampling plan. Create a plan, add suggested and manual points, see each method's working, keep company
// tables, check the report-only rule, download Word and HTML, and check the pages are accessible at three widths.
// All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const TITLE = "PPQ sampling plan — draft";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** Through the navigation, so the "Sampling plan" link is part of what is tested. On a phone it sits behind the menu button. */
async function openSampling(page: Page) {
  await loadDemo(page);
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
}

async function openDemoPlan(page: Page) {
  await openSampling(page);
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
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
      await page.getByRole("button", { name: "Download anyway" }).click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

const wordXml = (bytes: Buffer) => new PizZip(bytes).file("word/document.xml")!.asText();
const wordText = (bytes: Buffer) => wordXml(bytes).replace(/<[^>]+>/g, " ");
function wordHeadings(bytes: Buffer): string[] {
  return (wordXml(bytes).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).filter((p) => /<w:pStyle w:val="Heading\d"/.test(p)).map((p) => p.replace(/<[^>]+>/g, ""));
}

test("the page says what the tool does and does not do, and the demo plan is listed", async ({ page }) => {
  await openSampling(page);
  await expect(page.getByTestId("sampling-scope-text")).toHaveText(
    "The tool works out sample sizes from the method you choose. It does not judge whether that choice is adequate for your process; that decision belongs to QA / statistics.",
  );
  await expect(page.getByTestId("plan-list")).toContainText("ARX-217 PPQ sampling plan");
  await expect(page.getByText(BANNER).first()).toBeVisible();
});

test("a new plan starts with no batches and no points, and the open items say so", async ({ page }) => {
  await openSampling(page);
  await page.getByTestId("plan-title-input").fill("Second plan (fictional)");
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("points-table")).toHaveCount(0);
  const open = page.getByTestId("plan-open-items");
  await expect(open).toContainText("No PPQ batches");
  await expect(open).toContainText("rationale for the number of batches");
  await expect(open).toContainText("No sampling points");
  // Batches are added by the person; none is preset.
  await page.getByTestId("batch-label-input").fill("PPQ batch 1");
  await page.getByTestId("batch-add").click();
  await expect(page.getByText("PPQ batches (1)")).toBeVisible();
});

test("suggestions are added as incomplete points; a manual point can be built with a method and its working", async ({ page }) => {
  await openDemoPlan(page);
  const idsBefore = await page.locator('[data-testid^="point-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("point-", "")));
  const before = idsBefore.length;
  await page.getByTestId("suggestions-toggle").click();
  const row = page.getByTestId("suggestion-row").first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Add point/ }).click();
  await expect(page.locator('[data-testid^="point-SP-"]')).toHaveCount(before + 1);
  // The table is in process order now, so the new point is not necessarily the last row: find it by the id that was not there before.
  const idsNow = await page.locator('[data-testid^="point-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("point-", "")));
  const added = page.getByTestId(`status-${idsNow.find((i) => !idsBefore.includes(i))}`);
  await expect(added).toContainText(/incomplete/i);

  // A manual point: nothing is preselected, then a fixed count shows its working per batch.
  await page.getByTestId("manual-unitop").selectOption("aseptic_filling");
  await page.getByTestId("manual-type").selectOption("ipc");
  await page.getByTestId("manual-attribute").fill("Fill weight check (fictional)");
  await page.getByTestId("manual-add").click();
  const dialog = page.getByTestId("point-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("point-method")).toHaveValue("");
  await expect(page.getByTestId("point-working")).toContainText("Choose a method");
  await page.getByTestId("point-method").selectOption("fixed");
  await page.getByTestId("point-count").fill("7");
  await expect(page.getByTestId("working-result").first()).toContainText("basis");
  await page.getByTestId("point-basis").fill("Site SOP (fictional)");
  await expect(page.getByTestId("working-result").first()).toContainText("n = 7");
});

test("each method shows its working in the point dialog", async ({ page }) => {
  await openDemoPlan(page);
  const expected: Record<string, RegExp> = {
    "SP-001": /n = 20/, // company table
    "SP-002": /n = 3/, // fixed count
    "SP-003": /n = 59/, // confidence and reliability
    "SP-004": /n = 200/, // AQL (105E)
    "SP-005": /n = 50/, // variables (414)
  };
  for (const [id, re] of Object.entries(expected)) {
    await page.getByTestId(`edit-${id}`).click();
    await expect(page.getByTestId("point-dialog")).toBeVisible();
    await expect(page.getByTestId("working-result").first(), id).toContainText(re);
    await expect(page.getByTestId("method-help")).toBeVisible();
    // The form is part of the interview since M7.1; go back to the overview for the next point.
    await page.getByTestId("tab-overview").click();
    await expect(page.getByTestId("point-dialog")).toHaveCount(0);
  }
});

test("report only is refused for a routine point and offered for a characterization point", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("manual-unitop").selectOption("aseptic_filling");
  await page.getByTestId("manual-type").selectOption("ipc");
  await page.getByTestId("manual-attribute").fill("Routine check (fictional)");
  await page.getByTestId("manual-add").click();
  await expect(page.getByTestId("report-only-rule")).toBeVisible();
  await expect(page.getByRole("option", { name: /Report only/ })).toHaveCount(0);
  await page.getByTestId("point-type").selectOption("characterization");
  await expect(page.getByTestId("report-only-rule")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Report only/ })).toHaveCount(1);
});

test("company tables: validation in words, save, export, and a chosen table in a point", async ({ page }) => {
  await openSampling(page);
  await page.getByRole("link", { name: "Sampling tables" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /Sampling tables/ })).toBeVisible();
  await expect(page.getByTestId("tables-list")).toContainText("QC-SAMP-001");

  await page.getByTestId("table-new").click();
  await page.getByTestId("table-name").fill("QC-SAMP-TEST (fictional)");
  await page.getByTestId("table-version").fill("1.0");
  await page.getByTestId("table-add-row").click();
  await page.getByTestId("row-0-lotMin").fill("1");
  await page.getByTestId("row-0-lotMax").fill("500");
  await page.getByTestId("row-0-sampleSize").fill("8");
  await page.getByTestId("table-add-row").click();
  await page.getByTestId("row-1-lotMin").fill("400");
  await page.getByTestId("row-1-lotMax").fill("900");
  await page.getByTestId("row-1-sampleSize").fill("13");
  await expect(page.getByTestId("table-problems")).toContainText(/overlap/i);
  await page.getByTestId("row-1-lotMin").fill("501");
  await expect(page.getByTestId("table-problems")).not.toContainText(/overlap/i);
  await page.getByTestId("table-save").click();
  await expect(page.getByTestId("tables-list")).toContainText("QC-SAMP-TEST");
  await expect(page.getByTestId("tables-list")).toContainText("Can be chosen");
});

test("Word and HTML downloads carry the banner, the headings, the working and the versions; the export history lists them", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("sampling-preview-toggle").click();
  const preview = page.getByTestId("sampling-preview");
  await expect(preview).toContainText(TITLE);
  await expect(preview).toContainText("Draft sampling plan generated from project");
  await expect(preview).toContainText("Not approved.");

  const word = await download(page, "sampling-download-word");
  expect(word.file).toMatch(/^sampling-plan-.*\.docx$/);
  const headings = wordHeadings(word.bytes).join(" | ");
  for (const h of ["Purpose and scope", "PPQ batches", "Statistical bases used", "Agency requests and commitments", "Sample totals per batch", "Open items", "Versions"]) {
    expect(headings).toContain(h);
  }
  const text = wordText(word.bytes);
  expect(text).toContain(BANNER);
  expect(text).toMatch(/Report only/);
  expect(text).not.toMatch(/coming later/i);

  const html = await download(page, "sampling-download-html");
  expect(html.file).toMatch(/^sampling-plan-.*\.html$/);
  const htmlText = html.bytes.toString("utf8");
  expect(htmlText).toContain(BANNER);
  expect(htmlText).toContain(TITLE);
  expect(htmlText).toMatch(/<h2[^>]*>[^<]*Statistical bases used/);
  expect(htmlText).toMatch(/Reporting instructions RI-SP-001/);

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.getByRole("cell", { name: "Sampling plan (Word)" })).toBeVisible();
  await expect(history.getByRole("cell", { name: "Sampling plan (HTML)" })).toBeVisible();
});

test("the TBD warning shows the open item count before a download", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("sampling-download-html").click();
  await expect(page.getByTestId("sampling-tbd-warning")).toContainText(/open item/);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByTestId("sampling-tbd-warning")).toHaveCount(0);
});

for (const name of ["layout"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`pages are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
      test.setTimeout(90_000); // several axe passes; slower when the whole suite runs in parallel
      await page.emulateMedia({ colorScheme: scheme });
      await openDemoPlan(page);
      await expectAccessible(page, `${name}/${scheme} plan editor`);
      await expectNoHorizontalScroll(page, `${name}/${scheme} plan editor`);
      await page.screenshot({ path: join(SHOTS, `m7-plan-${test.info().project.name}-${scheme}.png`), fullPage: true });

      await page.getByTestId("edit-SP-003").click();
      await expect(page.getByTestId("point-dialog")).toBeVisible();
      await expectAccessible(page, `${name}/${scheme} point dialog`);
      await page.screenshot({ path: join(SHOTS, `m7-point-${test.info().project.name}-${scheme}.png`) });
      await page.getByTestId("tab-overview").click();

      await page.getByTestId("sampling-preview-toggle").click();
      await expect(page.getByTestId("sampling-preview")).toBeVisible();
      await expectAccessible(page, `${name}/${scheme} preview`);
      await expectNoHorizontalScroll(page, `${name}/${scheme} preview`);
      await page.screenshot({ path: join(SHOTS, `m7-preview-${test.info().project.name}-${scheme}.png`), fullPage: true });

      await page.evaluate(() => (window.location.hash = "#/sampling/tables"));
      await expect(page.getByTestId("tables-list")).toBeVisible();
      await expectAccessible(page, `${name}/${scheme} tables`);
      await expectNoHorizontalScroll(page, `${name}/${scheme} tables`);
      await page.screenshot({ path: join(SHOTS, `m7-tables-${test.info().project.name}-${scheme}.png`), fullPage: true });
    });
  }
}
