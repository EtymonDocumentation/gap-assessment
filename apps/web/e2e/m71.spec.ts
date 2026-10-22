// Milestone 7.1: the specialised sampling interview. Both views edit the same points, every study type has its card, the
// reporting-instructions preview, plan subsections and the library, agency requests, the optional mixing load-outs, both exports,
// and accessibility at 390 and 1280 px. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();
const TYPES = ["ipc", "release", "ppq_enhanced", "mixing_homogeneity", "hold_time", "filter_study", "stability", "retain_reserve", "characterization", "supporting_study", "regulatory_commitment", "other"];

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
}

async function interview(page: Page, view: "step" | "type") {
  await page.getByTestId("tab-interview").click();
  await page.getByTestId(`view-${view}`).click();
  await expect(page.getByTestId(`view-${view}`)).toHaveAttribute("aria-pressed", "true");
}

/** Groups of the point editor start closed (only the first with open items is open); tests that need a field open them all. */
async function expandAll(scope: Page | Locator) {
  const b = scope.getByTestId("point-expand-all");
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
}

/** Opens the first point card of a study-type section (view by study type). */
async function openFirstOfType(page: Page, type: string) {
  const section = page.getByTestId(`type-${type}`);
  await section.locator('[data-testid^="card-open-"]').first().click();
  await expect(section.getByTestId("point-dialog")).toBeVisible();
  await expandAll(section);
  return section;
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

test("both views edit the same point", async ({ page }) => {
  await openDemoPlan(page);
  await interview(page, "step");
  await page.getByTestId("card-open-SP-002").click();
  await expandAll(page);
  const text = "Edited in the step view (fictional).";
  await page.getByTestId("point-rationale").fill(text);
  await page.getByTestId("point-save").click();
  // The same point, opened in the study-type view, carries the edit; the open point survives the switch.
  await page.getByTestId("view-type").click();
  await expect(page.getByTestId("point-rationale")).toHaveValue(text);
  await page.getByTestId("card-open-SP-002").click();
  await page.getByTestId("card-open-SP-002").click();
  await expect(page.getByTestId("point-rationale")).toHaveValue(text);
});

test("every study type has a card with its own fields", async ({ page }) => {
  await openDemoPlan(page);
  await interview(page, "type");
  for (const type of TYPES) {
    const section = await openFirstOfType(page, type);
    // ipc, release and other have no extra fields, so no type card.
    if (!["ipc", "release", "other"].includes(type)) await expect(section.getByTestId("type-card"), type).toBeVisible();
    else await expect(section.getByTestId("point-type"), type).toBeVisible();
    await section.locator('[data-testid^="card-open-"]').first().click();
  }
});

test("the reporting instructions preview follows the point and names its block", async ({ page }) => {
  await openDemoPlan(page);
  await interview(page, "step");
  await page.getByTestId("card-open-SP-001").click();
  const ri = page.getByTestId("ri-preview");
  await expect(ri).toContainText("Reporting instructions RI-SP-001");
  await page.screenshot({ path: join(SHOTS, `m71-ri-${test.info().project.name}.png`), fullPage: true });
});

test("a custom subsection goes to the library and comes back; the library note appears when the item moves on", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("tab-subsections").click();
  await page.getByTestId("sub-new-title").fill("Cold chain note (fictional)");
  await page.getByTestId("sub-new-text").fill("Keep {planId} samples cold.\n\n- Record the temperature\n- Report any delay");
  await page.getByTestId("sub-new-placement-kind").selectOption("appendix");
  await page.getByTestId("sub-new-cmo").check();
  await page.getByTestId("sub-add").click();
  const card = page.locator('section[data-testid^="sub-CS-"]', { hasText: "Cold chain note (fictional)" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Save to library" }).click();
  await expect(card.getByText(/Saved to the library/)).toBeVisible();

  // The library page lists it; give it a new version.
  await page.evaluate(() => (window.location.hash = "#/sampling/subsections"));
  await expect(page.getByRole("heading", { level: 1, name: "Plan subsections" })).toBeVisible();
  const item = page.getByTestId("lib-item-Cold chain note (fictional)");
  await expect(item).toBeVisible();
  await item.locator('[data-testid^="lib-version-"]').fill("2");
  await item.getByRole("button", { name: "Save item" }).click();
  await expect(item.getByText(/earlier text is kept/)).toBeVisible();
  await item.getByText(/Version history/).click();
  await expect(item.locator('[data-testid^="lib-history-"] li')).toHaveCount(2);

  // Back in the plan, insert it from the library into a study-type section.
  await page.getByRole("link", { name: "Back to the sampling plans" }).click();
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await page.getByTestId("tab-subsections").click();
  await page.getByTestId("lib-select").selectOption({ label: "Cold chain note (fictional) (version 2)" });
  await page.getByTestId("lib-placement-kind").selectOption("appendix");
  await page.getByTestId("lib-insert").click();
  await expect(page.locator('section[data-testid^="sub-CS-"]', { hasText: "Cold chain note (fictional)" })).toHaveCount(2);
});

test("an agency request is recorded and linked to a point", async ({ page }) => {
  await openDemoPlan(page);
  await interview(page, "step");
  await page.getByTestId("agency-new-agency").fill("Example Agency B (fictional)");
  await page.getByTestId("agency-new-question").fill("Provide hold-time data for the intermediate (fictional).");
  await page.getByTestId("agency-add").click();
  await expect(page.getByTestId("agency-AR-002")).toBeVisible();
  await page.getByTestId("card-open-SP-002").click();
  await expandAll(page);
  await page.getByTestId("link-AR-002").check();
  await page.getByTestId("point-save").click();
  await expect(page.getByTestId("agency-AR-002-coverage")).toContainText("SP-002");
});

test("mixing load-outs: optional, apply, replace, append, start blank", async ({ page }) => {
  await openDemoPlan(page);
  await interview(page, "type");
  const section = await openFirstOfType(page, "mixing_homogeneity");
  const design = section.getByTestId("mixing-design");
  const runs = design.locator('[data-testid^="run-"][data-testid$="-label"]');
  await expect(design).toContainText("Study design (optional)");
  const demoRuns = await runs.count();
  expect(demoRuns).toBeGreaterThan(0);

  // The point already has runs, so a load-out asks first.
  await design.getByTestId("loadout-select").selectOption("three-at-target");
  await design.getByTestId("loadout-apply").click();
  await expect(design.getByTestId("loadout-prompt")).toBeVisible();
  await design.getByTestId("loadout-append").click();
  await expect(runs).toHaveCount(demoRuns + 3);
  await design.getByTestId("loadout-select").selectOption("three-at-target");
  await design.getByTestId("loadout-apply").click();
  await design.getByTestId("loadout-replace").click();
  await expect(runs).toHaveCount(3);

  // Start blank empties the draft and prints nothing; the point is still saved without a design.
  await design.getByTestId("loadout-select").selectOption("blank");
  await design.getByTestId("loadout-apply").click();
  await design.getByTestId("loadout-replace").click();
  await expect(runs).toHaveCount(0);
  await section.getByTestId("point-save").click();
  await expect(page.getByTestId("sampling-error")).toHaveCount(0);

  // With no design the preview is still there and prints no design lines.
  await expect(section.getByTestId("ri-preview")).not.toContainText("worst case");
});

test("the plan and the CMO instructions download as Word and HTML; the CMO export has its own history", async ({ page }) => {
  await openDemoPlan(page);
  const plan = await download(page, "sampling-download-word");
  const planHeadings = wordHeadings(plan.bytes).join(" | ");
  expect(planHeadings).toContain("Agency requests and commitments");
  expect(planHeadings).toMatch(/Reporting instructions RI-SP-001/);
  expect(wordText(plan.bytes)).toContain(BANNER);

  const cmo = await download(page, "cmo-download-word");
  expect(cmo.file).toMatch(/^cmo-instructions-.*\.docx$/);
  const headings = wordHeadings(cmo.bytes).join(" | ");
  expect(headings).toContain("About these instructions");
  expect(headings).toContain("Reporting instructions per sampling point");
  expect(headings).toContain("Additional instructions");
  const text = wordText(cmo.bytes);
  expect(text).toContain(BANNER);
  expect(text).not.toMatch(/filing category/i);

  const html = await download(page, "cmo-download-html");
  expect(html.file).toMatch(/^cmo-instructions-.*\.html$/);
  expect(html.bytes.toString("utf8")).toContain(BANNER);

  await expect(page.getByRole("region", { name: "CMO instructions export history table" }).getByRole("cell", { name: "CMO reporting instructions (Word)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "CMO instructions export history table" }).getByRole("cell", { name: "CMO reporting instructions (HTML)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Export history table" }).getByRole("cell", { name: "Sampling plan (Word)" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`interview, subsections and library are accessible: ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000); // several axe passes
    await page.emulateMedia({ colorScheme: scheme });
    await openDemoPlan(page);
    const name = test.info().project.name;
    await interview(page, "step");
    await page.getByTestId("card-open-SP-001").click();
    await expandAll(page);
    await expectAccessible(page, `${scheme} step view`);
    await page.screenshot({ path: join(SHOTS, `m71-step-${name}-${scheme}.png`), fullPage: true });

    await page.getByTestId("view-type").click();
    await expectAccessible(page, `${scheme} type view`);
    await page.screenshot({ path: join(SHOTS, `m71-type-${name}-${scheme}.png`), fullPage: true });

    await page.getByTestId("tab-subsections").click();
    await expectAccessible(page, `${scheme} subsections`);

    await page.getByTestId("tab-overview").click();
    await page.getByTestId("cmo-preview-toggle").click();
    await expect(page.getByTestId("cmo-preview")).toBeVisible();
    await expectAccessible(page, `${scheme} CMO preview`);

    await page.evaluate(() => (window.location.hash = "#/sampling/subsections"));
    await expect(page.getByRole("heading", { level: 1, name: "Plan subsections" })).toBeVisible();
    await expectAccessible(page, `${scheme} library`);
  });
}

for (const [width, height] of [[390, 844], [1280, 900]] as const) {
  test(`no sideways scroll at ${width} px, also with Verdana`, async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "sets its own viewport; one project is enough");
    await page.setViewportSize({ width, height });
    await openDemoPlan(page);
    await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; }" });
    await expectNoHorizontalScroll(page, "overview");
    await interview(page, "type");
    await openFirstOfType(page, "mixing_homogeneity");
    await expectNoHorizontalScroll(page, "type view with the mixing card open");
    await page.screenshot({ path: join(SHOTS, `m71-mixing-${width}.png`), fullPage: true });
    await page.getByTestId("view-step").click();
    await expectNoHorizontalScroll(page, "step view");
    await page.getByTestId("tab-subsections").click();
    await expectNoHorizontalScroll(page, "subsections");
  });
}
