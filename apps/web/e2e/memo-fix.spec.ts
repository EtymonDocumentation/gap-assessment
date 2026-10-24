// Memo template fixes: the department and memo line of a plan party, a library template on the sampling plan and the CMO instructions
// exports (including the memo From / To / Cc tags), and accessibility of the parties form. All data are fictional.
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

async function openSamplingPlan(page: Page) {
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
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
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

const zipText = (bytes: Buffer, name: string) => new PizZip(bytes).file(name)!.asText();
const wordText = (bytes: Buffer) => zipText(bytes, "word/document.xml").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const P = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A minimal memo template made here (no client file): memo lines from the new party tags, then the whole document. */
function memoTemplate(): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  const body = [
    P("{banner}"),
    P("MEMORANDUM {title}"),
    P("From: {fromText}"),
    P("To: {toText}"),
    P("Cc: {ccText}"),
    P("{#toParties}"),
    P("TOLINE {name} / {role} / {department}"),
    P("{/toParties}"),
    P("Sending unit: {sendingUnit}"),
    P("CMO: {cmoName}"),
    P("{@body}"),
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return Buffer.from(zip.generate({ type: "uint8array" }));
}

async function addMemoTemplate(page: Page) {
  await page.evaluate(() => (window.location.hash = "#/templates"));
  await page.getByLabel(/^Template file/).setInputFiles({ name: "memo-sample.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: memoTemplate() });
  const form = page.getByRole("form", { name: /^Add memo-sample\.docx/ });
  await expect(form).toBeVisible();
  await form.getByLabel("Name").fill("Memo sample (fictional)");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
}

test("the tag reference on the Templates page lists the memo party tags", async ({ page }) => {
  await loadDemo(page);
  await page.evaluate(() => (window.location.hash = "#/templates"));
  const table = page.getByRole("region", { name: "Tag reference table" });
  for (const tag of ["{#parties} … {/parties}", "{#fromParties} … {/fromParties}", "{#toParties} … {/toParties}", "{#ccParties} … {/ccParties}", "{sendingUnit}", "{receivingSite}", "{cmoName}", "{fromText}"]) {
    await expect(table.getByRole("rowheader", { name: tag })).toBeVisible();
  }
  await expect(table.getByText("department", { exact: false }).first()).toBeVisible();
});

test("the sampling plan and the CMO instructions can use a library template; the memo lines fill from the parties", async ({ page }) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  await addMemoTemplate(page);
  await openSamplingPlan(page);

  // The built-in look stays the default, and a template is only offered for the options that need one.
  const planPanel = page.getByRole("region", { name: "Word document: sampling plan" });
  const cmoPanel = page.getByRole("region", { name: "Word document: reporting instructions" });
  await expect(planPanel.getByRole("radio", { name: /^Built-in default/ })).toBeChecked();
  await expect(planPanel.getByRole("radio", { name: /^Map to their headings/ })).toHaveCount(0);
  await expect(planPanel.getByRole("combobox")).toHaveCount(0);

  await planPanel.getByRole("radio", { name: /^Placeholder tags/ }).check();
  await expect(planPanel.getByRole("combobox")).toContainText("Memo sample (fictional)");
  // The two panels are separate: choosing a kind in one does not change the other.
  await expect(cmoPanel.getByRole("radio", { name: /^Built-in default/ })).toBeChecked();
  const plan = await download(page, "sampling-download-word");
  expect(plan.file).toMatch(/^sampling-plan-.*\.docx$/);
  const text = wordText(plan.bytes);
  expect(text).toContain(BANNER);
  expect(text).toContain("From: Alex Example (fictional), Technology transfer lead, Process Validation (fictional); Sam Sample (fictional), Validation engineer, Process Validation (fictional)");
  expect(text).toContain("To: Site South manufacturing (fictional), Takes the samples and writes the PPQ summary report, Manufacturing Sciences (fictional)");
  expect(text).toContain("Cc: Example Test Laboratory (fictional), Tests the samples");
  expect(text).toContain("TOLINE Site South manufacturing (fictional) / Takes the samples and writes the PPQ summary report / Manufacturing Sciences (fictional)");
  expect(text).toContain("CMO: Site South manufacturing (fictional)");
  expect(text).not.toContain("not available");
  expect(zipText(plan.bytes, "docProps/custom.xml")).toContain("tags");
  await expect(page.getByTestId("sampling-word-result")).toContainText("Memo sample (fictional)");

  await cmoPanel.getByRole("radio", { name: /^Placeholder tags/ }).check();
  const cmo = await download(page, "cmo-download-word");
  expect(cmo.file).toMatch(/^cmo-instructions-.*\.docx$/);
  expect(wordText(cmo.bytes)).toContain("To: Site South manufacturing (fictional)");
  expect(wordText(cmo.bytes)).toContain("Reporting instructions");

  // Each download is recorded with the template that made it.
  await expect(page.getByRole("region", { name: "Export history table", exact: true }).locator("tbody")).toContainText("Memo sample (fictional)");
  await expect(page.getByRole("region", { name: "CMO instructions export history table" }).locator("tbody")).toContainText("Memo sample (fictional)");

  // The built-in look still works the same way after the choice is changed back.
  await planPanel.getByRole("radio", { name: /^Built-in default/ }).check();
  const builtin = await download(page, "sampling-download-word");
  expect(zipText(builtin.bytes, "docProps/custom.xml")).toContain("builtin");
  expect(wordText(builtin.bytes)).toContain(BANNER);
});

test("a template that has no tags is refused as a tag template; the picker says so in plain words", async ({ page }) => {
  await loadDemo(page);
  await openSamplingPlan(page);
  await page.getByRole("region", { name: "Word document: sampling plan" }).getByRole("radio", { name: /^Placeholder tags/ }).check();
  await expect(page.getByRole("region", { name: "Word document: sampling plan" })).toContainText(/No template in the library works with/);
  await expect(page.getByTestId("sampling-download-word")).toBeDisabled();
});

test("the department and the memo line of a party are saved, optional, and kept after a reload", async ({ page }) => {
  await loadDemo(page);
  await openSamplingPlan(page);
  await page.getByTestId("tab-interview").click();
  const card = page.getByTestId("parties-card");
  await expect(card.getByTestId("party-0-department")).toHaveValue("Process Validation (fictional)");
  await expect(card.getByTestId("party-0-memo")).toHaveValue("from");
  await expect(card.getByTestId("party-2-memo")).toHaveValue("to");

  // A new party needs only a kind and a name: the department and the memo line stay empty and nothing is chosen for it.
  await card.getByTestId("party-add").click();
  const n = (await card.locator('[data-testid$="-kind"]').count()) - 1;
  await card.getByTestId(`party-${n}-kind`).selectOption("other");
  await card.getByTestId(`party-${n}-name`).fill("Quality Unit (fictional)");
  await expect(card.getByTestId(`party-${n}-memo`)).toHaveValue("");
  await expect(card.getByTestId(`party-${n}-department`)).toHaveValue("");
  await card.getByTestId("parties-save").click();
  await expect(page.getByTestId("sampling-error")).toHaveCount(0);

  // Add the department and a Cc line.
  await card.getByTestId(`party-${n}-department`).fill("Quality Assurance (fictional)");
  await card.getByTestId(`party-${n}-memo`).selectOption("cc");
  await card.getByTestId("parties-save").click();
  await expect(card.getByTestId("parties-save")).toBeDisabled();

  await page.reload();
  await openSamplingPlan(page);
  await page.getByTestId("tab-interview").click();
  const after = page.getByTestId("parties-card");
  await expect(after.getByTestId(`party-${n}-department`)).toHaveValue("Quality Assurance (fictional)");
  await expect(after.getByTestId(`party-${n}-memo`)).toHaveValue("cc");

  // Clearing both leaves the party with neither field.
  await after.getByTestId(`party-${n}-department`).fill("");
  await after.getByTestId(`party-${n}-memo`).selectOption("");
  await after.getByTestId("parties-save").click();
  await expect(after.getByTestId("parties-save")).toBeDisabled();
  await page.evaluate(() => (window.location.hash = "#/changes"));
  await expect(page.locator("main")).toContainText("Responsible parties of");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the parties form is accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await loadDemo(page);
    await openSamplingPlan(page);
    await page.getByTestId("tab-interview").click();
    const card = page.getByTestId("parties-card");
    await expect(card).toBeVisible();
    await expectAccessible(page, `${scheme} parties form`);
    await expectNoHorizontalScroll(page, `${scheme} parties form`);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: join(SHOTS, `memofix-parties-${test.info().project.name}-${scheme}.png`) });
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the two Word panels of the sampling plan are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await loadDemo(page);
    await addMemoTemplate(page);
    await openSamplingPlan(page);
    const panel = page.getByRole("region", { name: "Word document: sampling plan" });
    await panel.getByRole("radio", { name: /^Placeholder tags/ }).check();
    await expect(panel.getByRole("combobox")).toBeVisible();
    await expectAccessible(page, `${scheme} sampling Word panel`);
    await expectNoHorizontalScroll(page, `${scheme} sampling Word panel`);
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: join(SHOTS, `memofix-wordpanel-${test.info().project.name}-${scheme}.png`) });
  });
}
