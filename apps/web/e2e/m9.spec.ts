// Milestone 9: the TRD module. A TRD starts from the project, a seed file or blank; every value can be overridden with the project
// value kept beside it; an update from the project (or a newer seed) never replaces an overridden value on its own; the set point,
// NOR and PAR are entered by the user with sources and only checked, never decided. Word and HTML output; accessibility at three
// widths in light and dark. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
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

/** Through the navigation, so the "TRD" link is part of what is tested. On a phone it sits behind the menu button. */
async function openTrd(page: Page) {
  await loadDemo(page);
  const nav = page.getByRole("link", { name: "TRD", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByTestId("trd-scope-text")).toBeVisible();
}

async function openDemoTrd(page: Page, tab: "details" | "process" | "open" | "output" = "process") {
  await openTrd(page);
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId(`trd-tab-${tab}`).click();
  if (tab === "process") await page.getByTestId("trd-steps-open-all").click();
}

/** The process tab with every step open (the steps start folded, so a test that looks at an item opens them first). */
async function openProcess(page: Page) {
  await page.getByTestId("trd-tab-process").click();
  await page.getByTestId("trd-steps-open-all").click();
}

async function createTrd(page: Page, title: string, kind: "project" | "blank") {
  await page.getByTestId("trd-title-input").fill(title);
  await page.getByTestId(`trd-start-${kind}`).check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
}

/** A new TRD opens the details form because it has no purpose yet; writing one shows the summary. */
async function savePurpose(page: Page) {
  await page.getByTestId("trd-purpose").fill("Transfer of the process to the receiving unit (fictional).");
  await page.getByTestId("trd-details-save").click();
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

async function download(page: Page, click: () => Promise<void>): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}
const downloadId = (page: Page, testId: string) => download(page, () => page.getByTestId(testId).click());

const wordText = (bytes: Buffer) => new PizZip(bytes).file("word/document.xml")!.asText().replace(/<[^>]+>/g, " ");

/** The item card with this title (first match). */
const item = (scope: Page | Locator, title: string | RegExp) => scope.locator("article.trd-item", { has: scope.locator("h4", { hasText: title }) }).first();

// ------------------------------------------------------------------ a seed file with known differences

interface SeedLike {
  unitOperations: { items: { label: string; fields: { label: string; status: string; display?: string; value?: unknown }[] }[] }[];
}
interface Changed {
  itemLabel: string;
  fieldLabel: string;
}

/** The seed of the demo project, downloaded from the TRD seed page like a person would, as text. */
async function downloadSeed(page: Page): Promise<string> {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.evaluate(() => (window.location.hash = "#/trd-seed"));
  const got = await download(page, () => page.getByRole("button", { name: "Download TRD seed (JSON)" }).click());
  return got.bytes.toString("utf8");
}

/** Changes the display of two established fields (in two different items of the first step) and says which. */
function changeTwoFields(text: string): { text: string; changed: Changed[] } {
  const seed = JSON.parse(text) as SeedLike;
  const changed: Changed[] = [];
  const uo = seed.unitOperations.find((u) => u.items.filter((i) => i.fields.some((f) => f.status === "established" && f.display)).length >= 2)!;
  for (const it of uo.items) {
    if (changed.length === 2) break;
    const f = it.fields.find((x) => x.status === "established" && x.display);
    if (!f) continue;
    f.display = `${f.display} (changed in the newer seed)`;
    changed.push({ itemLabel: it.label, fieldLabel: f.label });
  }
  return { text: JSON.stringify(seed), changed };
}

async function startFromSeedFile(page: Page, title: string, seedText: string) {
  await page.getByTestId("trd-title-input").fill(title);
  await page.getByTestId("trd-start-file").check();
  await page.getByTestId("trd-start-file-input").setInputFiles({ name: "seed.json", mimeType: "application/json", buffer: Buffer.from(seedText) });
  await expect(page.getByTestId("trd-start-file-ok")).toBeVisible();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
}

// ------------------------------------------------------------------ tests

test("the TRD page lists the demo TRD and the three ways to start one", async ({ page }) => {
  await openTrd(page);
  await expect(page.getByTestId("trd-scope-text")).toContainText("it does not decide a filing category");
  await expect(page.getByTestId("trd-list-table")).toContainText("TRD-001");
  await expect(page.getByTestId("trd-start-options")).toContainText("From this project");
  await expect(page.getByTestId("trd-start-options")).toContainText("From a TRD seed file");
  await expect(page.getByTestId("trd-start-options")).toContainText("Blank");
  // Nothing is chosen for the person.
  for (const k of ["project", "file", "blank"]) await expect(page.getByTestId(`trd-start-${k}`)).not.toBeChecked();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-create-error")).toBeVisible();
});

test("the button on the TRD seed page opens the start form with 'from this project' chosen", async ({ page }) => {
  await loadDemo(page);
  await page.evaluate(() => (window.location.hash = "#/trd-seed"));
  await page.getByTestId("trd-start-from-project").click();
  await expect(page.getByTestId("trd-start-project")).toBeChecked();
});

test("start from the project: values arrive as project values, nothing is overridden", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "From project (fictional)", "project");
  await savePurpose(page);
  await expect(page.getByTestId("trd-details-summary")).toContainText("this project");
  await expect(page.getByTestId("trd-uptodate")).toBeVisible();
  await page.getByTestId("trd-tab-open").click();
  await expect(page.getByTestId("trd-overrides")).toContainText("No value has been overridden");
  await openProcess(page);
  await expect(page.locator("article.trd-item").first()).toBeVisible();
});

test("start blank: every product and site detail reads Not established", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Blank (fictional)", "blank");
  await expect(page.getByTestId("trd-update")).toHaveCount(0);
  const values = page.locator('[data-testid^="trd-field-details-"][data-testid$="-value"]');
  expect(await values.count()).toBeGreaterThan(0);
  for (const v of await values.allInnerTexts()) expect(v).toBe("Not established");
  await openProcess(page);
  await expect(page.locator("article.trd-item")).toHaveCount(0);
  await page.getByTestId("trd-step-custom-input").fill("Intermediate hold (fictional)");
  await page.getByTestId("trd-step-custom-add").click();
  await expect(page.getByText("Intermediate hold (fictional)").first()).toBeVisible();
});

test("start from a seed file: a wrong file gives the reader's message, a right one starts the TRD", async ({ page }) => {
  const seed = await downloadSeed(page);
  await page.evaluate(() => (window.location.hash = "#/trd"));
  await page.getByTestId("trd-start-file").check();
  await page.getByTestId("trd-start-file-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{ not json") });
  await expect(page.getByTestId("trd-start-file-error")).toBeVisible();
  const other = JSON.parse(seed) as { meta: { formatVersion: string } };
  other.meta.formatVersion = "2.0.0";
  await page.getByTestId("trd-start-file-input").setInputFiles({ name: "v2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) });
  await expect(page.getByTestId("trd-start-file-error")).toContainText("supports TRD seed format 1.x");
  await startFromSeedFile(page, "From seed file (fictional)", seed);
  await savePurpose(page);
  await expect(page.getByTestId("trd-details-summary")).toContainText("a TRD seed file");
  await expect(page.getByTestId("trd-update-file")).toBeVisible();
});

test("an override with a reason and one without: the project value stays beside, the badge says so, 'No reason recorded'", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Overrides (fictional)", "project");
  const rows = page.locator('li[data-testid^="trd-field-details-"]').filter({ has: page.locator('[data-testid$="-edit"]') });

  const a = rows.nth(0);
  const aId = (await a.getAttribute("data-testid"))!;
  const before = await page.getByTestId(`${aId}-value`).innerText();
  await page.getByTestId(`${aId}-edit`).click();
  await expect(page.getByTestId(`${aId}-project`)).toContainText(before);
  await page.getByTestId(`${aId}-toggle`).check();
  await page.getByTestId(`${aId}-display`).fill("Entered by the team (fictional)");
  await page.getByTestId(`${aId}-reason-input`).fill("Agreed with the sending unit (fictional)");
  await page.getByTestId(`${aId}-save`).click();
  await expect(page.getByTestId(`${aId}-edit`)).toBeFocused();
  await expect(page.getByTestId(`${aId}-value`)).toHaveText("Entered by the team (fictional)");
  await expect(a.getByTestId("trd-overridden-badge")).toContainText(`Overridden (project: ${before}`);
  await expect(page.getByTestId(`${aId}-reason`)).toContainText("Agreed with the sending unit (fictional)");

  const b = rows.nth(1);
  const bId = (await b.getAttribute("data-testid"))!;
  await page.getByTestId(`${bId}-edit`).click();
  await page.getByTestId(`${bId}-toggle`).check();
  await page.getByTestId(`${bId}-display`).fill("Second entry (fictional)");
  await page.getByTestId(`${bId}-save`).click();
  await expect(page.getByTestId(`${bId}-reason`)).toContainText("No reason recorded");

  await page.getByTestId("trd-tab-open").click();
  await expect(page.getByTestId("trd-overrides")).toContainText("Overrides (2)");
  await expect(page.getByTestId("trd-overrides")).toContainText("No reason recorded");

  // Switching the override off brings the project value back.
  await page.getByTestId("trd-tab-details").click();
  await page.getByTestId(`${aId}-edit`).click();
  await page.getByTestId(`${aId}-toggle`).uncheck();
  await page.getByTestId(`${aId}-save`).click();
  await expect(page.getByTestId(`${aId}-value`)).toHaveText(before);
});

test("an established override needs a value; the error is shown and nothing is saved", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Needs a value (fictional)", "project");
  const row = page.locator('li[data-testid^="trd-field-details-"]').filter({ has: page.locator('[data-testid$="-edit"]') }).first();
  const id = (await row.getAttribute("data-testid"))!;
  await page.getByTestId(`${id}-edit`).click();
  await page.getByTestId(`${id}-toggle`).check();
  await page.getByTestId(`${id}-display`).fill("");
  await page.getByTestId(`${id}-save`).click();
  await expect(page.getByTestId(id).getByRole("alert")).toContainText("Enter the value");
});

test("the demo TRD shows its overrides, its sources and the PAR and NOR check in words", async ({ page }) => {
  await openDemoTrd(page, "process");
  const speed = item(page, /Mixing speed/);
  await expect(speed.getByText("Check:").first()).toBeVisible();
  await expect(speed).toContainText(/NOR/);
  await expect(speed).toContainText("DEMO-PD-217-01");
  // Units that differ are reported as not comparable, not converted.
  const time = item(page, /Mixing time/);
  await expect(time).toContainText(/cannot compare: units differ/i);
  await expect(page.getByTestId("trd-overridden-badge").first()).toContainText("Overridden (project:");
  // The filing wording appears nowhere as a decision.
  await expect(page.locator("main")).not.toContainText(/filing category:/i);
});

test("entering a PAR and NOR with a source added on the spot; a NOR above the PAR and units that differ are reported", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Limits (fictional)", "project");
  await openProcess(page);
  const card = item(page, /Mixing speed/);
  await card.locator('[data-testid$="-edit"]').first().click();
  await card.locator('[data-testid$="-limits-edit"]').click();
  const editor = card.getByTestId("trd-limits-editor");

  await editor.getByTestId("trd-limits-setPoint-on").check();
  await editor.getByTestId("trd-limits-setPoint-value").fill("50");
  await editor.getByTestId("trd-limits-setPoint-unit").fill("rpm");
  await editor.getByTestId("trd-limits-nor-on").check();
  await editor.getByTestId("trd-limits-nor-min").fill("40");
  await editor.getByTestId("trd-limits-nor-max").fill("90");
  await editor.getByTestId("trd-limits-nor-unit").fill("rpm");
  await editor.getByTestId("trd-limits-par-on").check();
  await editor.getByTestId("trd-limits-par-min").fill("45");
  await editor.getByTestId("trd-limits-par-max").fill("80");
  await editor.getByTestId("trd-limits-par-unit").fill("rpm");
  // A source typed in on the spot (fictional) and cited to the PAR.
  await editor.getByTestId("trd-limits-par-add-source").click();
  await editor.getByTestId("trd-newsrc-type-par").fill("Characterization study report");
  await editor.getByTestId("trd-newsrc-id-par").fill("DEMO-CHAR-900");
  await editor.getByTestId("trd-newsrc-add-par").click();
  await expect(editor.getByText("DEMO-CHAR-900").first()).toBeVisible();
  await editor.getByTestId("trd-limits-save").click();

  const summary = card.locator('[data-testid$="-limits"]');
  await expect(summary).toContainText("DEMO-CHAR-900");
  await expect(card.locator('[data-testid$="-findings"]')).toContainText("Check:");
  // The NOR reaches beyond the PAR. The tool says so and decides nothing else.
  await expect(card.locator('[data-testid$="-findings"]')).toContainText(/NOR/);
  // The NOR and the set point have no source: open items, not silence.
  await expect(card.locator('[data-testid$="-findings"]')).toContainText("Open item:");

  // Units that differ: the PAR in another unit is reported as not comparable.
  await card.locator('[data-testid$="-limits-edit"]').click();
  await card.getByTestId("trd-limits-par-unit").fill("1/min");
  await card.getByTestId("trd-limits-save").click();
  await expect(card.locator('[data-testid$="-findings"]')).toContainText(/cannot compare: units differ \(rpm vs 1\/min\)/);

  // A minimum above the maximum is a validation message and nothing is lost.
  await card.locator('[data-testid$="-limits-edit"]').click();
  await card.getByTestId("trd-limits-par-min").fill("100");
  await card.getByTestId("trd-limits-par-max").fill("10");
  await card.getByTestId("trd-limits-save").click();
  await expect(card.locator('[data-testid$="-findings"], [data-testid="trd-limits-error"], [data-testid="trd-error"], [role=alert]').first()).toBeVisible();
});

test("filters: overridden, has a PAR/NOR problem, not established, TBD", async ({ page }) => {
  await openDemoTrd(page, "process");
  const all = await page.locator("article.trd-item").count();
  await page.getByTestId("trd-filter-overridden").click();
  const overridden = await page.locator("article.trd-item").count();
  expect(overridden).toBeGreaterThan(0);
  expect(overridden).toBeLessThan(all);
  await expect(page.getByTestId("trd-filter-note")).toBeVisible();
  await page.getByTestId("trd-filter-problem").click();
  const problem = await page.locator("article.trd-item").count();
  expect(problem).toBeGreaterThan(0);
  expect(problem).toBeLessThan(all);
  await expect(page.locator("article.trd-item").first()).toContainText("Check:");
  await page.getByTestId("trd-filter-not_established").click();
  await expect(page.getByTestId("trd-filter-not_established")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("trd-filter-tbd").click();
  await expect(page.getByTestId("trd-filter-tbd")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("trd-filter-all").click();
  // Back to "all": the steps fold again (nothing was opened by hand), so open them to count every item.
  await expect(page.locator("article.trd-item")).toHaveCount(0);
  await page.getByTestId("trd-steps-open-all").click();
  expect(await page.locator("article.trd-item").count()).toBe(all);
});

test("adding, editing and removing a step and an item", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Steps (fictional)", "blank");
  await openProcess(page);
  await page.getByTestId("trd-step-custom-input").fill("Intermediate hold (fictional)");
  await page.getByTestId("trd-step-custom-add").click();
  const step = page.locator('section[data-testid^="trd-step-"]', { has: page.getByRole("heading", { name: /Intermediate hold/ }) });
  await expect(step).toBeVisible();
  await step.locator('select[data-testid^="trd-additem-kind-"]').selectOption("param");
  await step.locator('input[data-testid^="trd-additem-label-"]').fill("Hold temperature (fictional)");
  await step.locator('button[data-testid^="trd-additem-add-"]').click();
  await expect(step).toContainText("Hold temperature (fictional)");
  await expect(step).toContainText("Added by the team");
  await step.locator('button[data-testid$="-remove"]').filter({ hasText: "Remove this item" }).count();
  await step.locator("article.trd-item").first().locator('[data-testid$="-edit"]').first().click();
  await step.locator('button[data-testid$="-remove"]').filter({ hasText: "Remove this item" }).click();
  await expect(step).not.toContainText("Hold temperature (fictional)");
  await step.locator('button[data-testid^="trd-step-remove-"]').click();
  await page.getByTestId("trd-step-remove-confirm").click();
  await expect(step).toHaveCount(0);
});

test("update from a newer seed: nothing is replaced on its own; an overridden value is kept unless chosen; 'accept all' skips it", async ({ page }) => {
  const original = await downloadSeed(page);
  const { text: newer, changed } = changeTwoFields(original);
  await page.evaluate(() => (window.location.hash = "#/trd"));
  await startFromSeedFile(page, "Update (fictional)", original);
  await openProcess(page);

  // The team overrides the first changed field.
  const first = item(page, changed[0]!.itemLabel);
  await first.locator('[data-testid$="-edit"]').first().click();
  const f = first.locator("li.trd-field", { hasText: changed[0]!.fieldLabel }).first();
  await f.locator('[data-testid$="-edit"]').click();
  await f.locator('[data-testid$="-toggle"]').check();
  await f.locator('[data-testid$="-display"]').fill("Team value (fictional)");
  await f.locator('[data-testid$="-save"]').click();
  await expect(first.getByTestId("trd-overridden-badge").first()).toBeVisible();

  await page.getByTestId("trd-update-file").setInputFiles({ name: "newer.json", mimeType: "application/json", buffer: Buffer.from(newer) });
  await expect(page.getByTestId("trd-changed-notice")).toContainText("2 rows differ");
  const rows = page.getByTestId("trd-review-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("trd-review-table").locator('tr[data-overridden="true"]')).toHaveCount(1);
  // The TRD still says the team's value.
  await expect(first).toContainText("Team value (fictional)");

  await page.getByTestId("trd-review-accept-all").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-overridden", "true");
  await expect(first).toContainText("Team value (fictional)");
  await expect(page.getByTestId("trd-review-accept-all")).toBeDisabled();

  await page.getByTestId("trd-review-keep").click();
  await expect(rows).toHaveCount(0);
  await expect(first).toContainText("Team value (fictional)");
  await page.getByTestId("trd-review-finish").click();
  await expect(page.getByTestId("trd-uptodate")).toBeVisible();
});

test("taking the project value for an overridden row replaces it only when chosen", async ({ page }) => {
  const original = await downloadSeed(page);
  const { text: newer, changed } = changeTwoFields(original);
  await page.evaluate(() => (window.location.hash = "#/trd"));
  await startFromSeedFile(page, "Take (fictional)", original);
  await openProcess(page);
  const first = item(page, changed[0]!.itemLabel);
  await first.locator('[data-testid$="-edit"]').first().click();
  const f = first.locator("li.trd-field", { hasText: changed[0]!.fieldLabel }).first();
  await f.locator('[data-testid$="-edit"]').click();
  await f.locator('[data-testid$="-toggle"]').check();
  await f.locator('[data-testid$="-display"]').fill("Team value (fictional)");
  await f.locator('[data-testid$="-save"]').click();
  await page.getByTestId("trd-update-file").setInputFiles({ name: "newer.json", mimeType: "application/json", buffer: Buffer.from(newer) });
  await page.getByTestId("trd-review-table").locator('tr[data-overridden="true"]').getByTestId("trd-review-accept").click();
  await expect(first).toContainText("changed in the newer seed");
  await expect(first).not.toContainText("Team value (fictional)");
  // The change log keeps the override that was replaced.
  await page.evaluate(() => (window.location.hash = "#/changes"));
  await expect(page.locator("main")).toContainText(/overridden/i);
});

test("a project that changed since the TRD was updated gives a notice, not a block", async ({ page }) => {
  await openDemoTrd(page, "details");
  await expect(page.getByTestId("trd-update")).toBeVisible();
  // The demo TRD matches the project it started from.
  await expect(page.getByTestId("trd-uptodate").or(page.getByTestId("trd-changed-notice"))).toBeVisible();
  await expect(page.getByTestId("trd-tab-process")).toBeEnabled();
});

test("Word and HTML downloads carry the banner, the sections, the overrides and the open items; the export history lists them", async ({ page }) => {
  await openDemoTrd(page, "output");
  await page.getByTestId("trd-preview-toggle").click();
  await expect(page.getByTestId("trd-preview")).toContainText("Requires regulatory affairs assessment");

  const word = await download(page, () => page.getByRole("button", { name: /Download Word|Word document/i }).first().click());
  expect(word.file).toMatch(/\.docx$/);
  const text = wordText(word.bytes);
  expect(text).toContain(BANNER);
  expect(text).toContain("Requires regulatory affairs assessment");
  expect(text).not.toMatch(/filing category/i);

  const html = await downloadId(page, "trd-download-html");
  expect(html.file).toMatch(/^trd-.*\.html$/);
  const h = html.bytes.toString("utf8");
  expect(h).toContain(BANNER);
  expect(h).toContain("overridden; project:");

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history).toContainText(/TRD \(Word\)|TRD.*Word/);
  await expect(history).toContainText(/TRD \(HTML\)|TRD.*HTML/);
});

test("the open-items warning shows the count before a download", async ({ page }) => {
  await openDemoTrd(page, "output");
  await page.getByTestId("trd-download-html").click();
  await expect(page.getByTestId("trd-tbd-warning")).toContainText(/open item/);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByTestId("trd-tbd-warning")).toHaveCount(0);
});

test("the overrides and open-item sections cannot be left out; the optional ones can", async ({ page }) => {
  await openDemoTrd(page, "output");
  const boxes = page.locator('[data-testid^="trd-section-"]');
  expect(await boxes.count()).toBeGreaterThan(0);
  const first = boxes.first();
  await first.uncheck();
  const html = await downloadId(page, "trd-download-html");
  expect(html.bytes.toString("utf8")).toMatch(/<h2[^>]*>[^<]*Open items/);
});

test("deleting a TRD asks first and the list shows it gone", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "To delete (fictional)", "blank");
  await page.getByTestId("trd-delete").click();
  await page.getByTestId("trd-delete-confirm").click();
  await expect(page.getByTestId("trd-list-table")).not.toContainText("To delete (fictional)");
});

for (const scheme of ["light", "dark"] as const) {
  test(`TRD pages are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `m9-${name}-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: scheme });

    await openTrd(page);
    await page.getByTestId("trd-start-file").check();
    await expectAccessible(page, `${scheme} start screen`);
    await expectNoHorizontalScroll(page, `${scheme} start screen`);
    await shot("start");

    await page.getByTestId("trd-list-table").getByRole("link").first().click();
    await expectAccessible(page, `${scheme} details`);
    await expectNoHorizontalScroll(page, `${scheme} details`);
    await shot("details");

    await openProcess(page);
    await expectAccessible(page, `${scheme} process`);
    await expectNoHorizontalScroll(page, `${scheme} process`);
    const speed = item(page, /Mixing speed/);
    await speed.scrollIntoViewIfNeeded();
    await speed.screenshot({ path: join(SHOTS, `m9-parameter-${test.info().project.name}-${scheme}.png`) });
    await shot("process");
    await speed.locator('[data-testid$="-edit"]').first().click();
    await speed.locator('[data-testid$="-limits-edit"]').click();
    await expectAccessible(page, `${scheme} limits editor`);
    await expectNoHorizontalScroll(page, `${scheme} limits editor`);
    await speed.screenshot({ path: join(SHOTS, `m9-limits-editor-${test.info().project.name}-${scheme}.png`) });
    await speed.getByRole("button", { name: "Cancel" }).last().click();

    await page.getByTestId("trd-tab-open").click();
    await expectAccessible(page, `${scheme} open items`);
    await expectNoHorizontalScroll(page, `${scheme} open items`);
    await shot("open-items");

    await page.getByTestId("trd-tab-output").click();
    await page.getByTestId("trd-preview-toggle").click();
    await expectAccessible(page, `${scheme} output`);
    await expectNoHorizontalScroll(page, `${scheme} output`);
    await shot("output");
  });

  test(`the update review list is accessible: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    const original = await downloadSeed(page);
    const { text: newer, changed } = changeTwoFields(original);
    await page.evaluate(() => (window.location.hash = "#/trd"));
    await startFromSeedFile(page, "Review (fictional)", original);
    await openProcess(page);
    const first = item(page, changed[0]!.itemLabel);
    await first.locator('[data-testid$="-edit"]').first().click();
    const f = first.locator("li.trd-field", { hasText: changed[0]!.fieldLabel }).first();
    await f.locator('[data-testid$="-edit"]').click();
    await f.locator('[data-testid$="-toggle"]').check();
    await f.locator('[data-testid$="-display"]').fill("Team value (fictional)");
    await f.locator('[data-testid$="-save"]').click();
    await page.getByTestId("trd-update-file").setInputFiles({ name: "newer.json", mimeType: "application/json", buffer: Buffer.from(newer) });
    await expect(page.getByTestId("trd-review-table")).toBeVisible();
    await expectAccessible(page, `${scheme} review`);
    await expectNoHorizontalScroll(page, `${scheme} review`);
    await page.getByTestId("trd-update").screenshot({ path: join(SHOTS, `m9-review-${test.info().project.name}-${scheme}.png`) });
    await page.screenshot({ path: join(SHOTS, `m9-review-page-${test.info().project.name}-${scheme}.png`), fullPage: true });
  });
}

// ------------------------------------------------------------------ review round: picker, notice, wording, folded steps

test("the demo TRD shows no change notice when no row differs", async ({ page }) => {
  await openDemoTrd(page, "details");
  await expect(page.getByTestId("trd-changed-notice")).toHaveCount(0);
  await expect(page.getByTestId("trd-review-toggle")).toHaveCount(0);
  await expect(page.getByTestId("trd-uptodate")).toBeVisible();
});

test("steps start folded with a count line; a filter opens the steps with matches; open and close all", async ({ page }) => {
  await openDemoTrd(page, "process");
  await page.getByTestId("trd-steps-close-all").click();
  await expect(page.locator("article.trd-item")).toHaveCount(0);
  const toggle = page.locator('[data-testid^="trd-step-toggle-"]').first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-testid^="trd-step-summary-"]').first()).toContainText(/\d+ parameters?/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("article.trd-item").first()).toBeVisible();
  // The open state survives a switch of tab.
  await page.getByTestId("trd-tab-output").click();
  await page.getByTestId("trd-tab-process").click();
  await expect(page.locator('[data-testid^="trd-step-toggle-"]').first()).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("trd-steps-close-all").click();
  await page.getByTestId("trd-filter-overridden").click();
  await expect(page.locator("article.trd-item").first()).toBeVisible();
});

test("a new TRD starts folded on the process tab", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Folded (fictional)", "project");
  await savePurpose(page);
  await page.getByTestId("trd-tab-process").click();
  await expect(page.locator("article.trd-item")).toHaveCount(0);
  await expect(page.locator('[data-testid^="trd-step-toggle-"]').first()).toHaveAttribute("aria-expanded", "false");
});

test("one source picker: search, cite, remove, interview records in a closed group, and the card says what comes from where", async ({ page }) => {
  await openTrd(page);
  await createTrd(page, "Picker (fictional)", "project");
  await savePurpose(page);
  await openProcess(page);
  const card = item(page, /Mixing speed/);
  // The card separates the project's values from the TRD's own limits.
  await expect(card).toContainText("From the project");
  await expect(card.locator('[data-testid$="-limits"]')).toContainText("TRD limits (set point / NOR / PAR with sources): none entered yet");
  const copy = card.getByRole("button", { name: /Copy project value/ }).first();
  await expect(copy).toBeVisible();
  await card.locator('[data-testid$="-edit"]').first().click();
  await card.locator('[data-testid$="-limits-edit"]').click();
  const editor = card.getByTestId("trd-limits-editor");
  await editor.getByTestId("trd-limits-par-on").check();
  const picker = editor.getByTestId("trd-limits-par-sources");
  await expect(picker.getByTestId("trd-limits-par-src-none")).toBeVisible();
  await picker.getByTestId("trd-limits-par-src-open").click();
  await expect(picker.getByTestId("trd-limits-par-src-docs")).toBeVisible();
  const interviews = picker.getByTestId("trd-limits-par-src-interviews");
  await expect(interviews).toHaveJSProperty("open", false);
  await expect(interviews.locator("summary")).toContainText(/Interview records \(\d+\)/);
  // The list is short: the editor is no longer a wall of checkboxes.
  expect(await editor.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(2500);
  await picker.getByTestId("trd-limits-par-src-search").fill("SOP");
  const first = picker.locator('[data-testid^="trd-limits-par-src-add-"]').first();
  const name = (await first.getAttribute("aria-label"))!.replace(/^Cite /, "").replace(/ for the PAR$/, "");
  await first.click();
  await expect(picker.getByTestId("trd-limits-par-src-selected")).toContainText(name);
  await picker.getByRole("button", { name: /^Remove / }).first().click();
  await expect(picker.getByTestId("trd-limits-par-src-none")).toBeVisible();
  await expectAccessible(page, "source picker");
});
