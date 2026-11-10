// M13 job 4A: the links of an excipient (gaps, risk items, TRD), "Use in the TRD", the excipient assessment document in HTML, Markdown and Word
// with the export history filtered by document, the open-items count on the project page, the compare page and the optional section of the
// gap document. Fictional data only. Runs at the three widths of the config.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOTICE_DOCUMENT, openDemo, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

/**
 * The syringe demo (it has gaps, a risk assessment, a TRD and its own excipient assessment EXA-001), then "Start blank" on the excipient page
 * (a new assessment, EXA-002) and one excipient added by name.
 */
async function demoWithExcipient(page: Page, name = "Excipient A (fictional)") {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await expect(page.getByTestId("ex-editor")).toBeVisible();
  await page.getByTestId("ex-add-name").fill(name);
  await page.getByTestId("ex-add-btn").click();
  await expect(page.getByTestId("ex-lines-table")).toContainText(name);
}

async function openLine(page: Page) {
  await page.getByTestId("ex-line-link").click();
  await expect(page.getByTestId("ex-line-page")).toBeVisible();
}

test("gap link: chosen from the project's gaps, shown, taken away only with a reason that reaches the change log", async ({ page }) => {
  await demoWithExcipient(page);
  await openLine(page);
  const box = page.getByTestId("ex-links");
  await expect(box).toContainText("Nothing is linked yet");
  // nothing is chosen for the person
  await expect(page.getByTestId("ex-gap-pick")).toHaveValue("");
  await expect(page.getByTestId("ex-gap-link")).toBeDisabled();
  await page.getByTestId("ex-gap-pick").selectOption("G-010");
  await page.getByTestId("ex-gap-link").click();
  await expect(page.getByTestId("ex-gap-G-010")).toContainText("Buffer preparation performed");
  await expect(page.getByTestId("ex-links-status")).toContainText("Linked to G-010");
  await expect(box).not.toContainText("Nothing is linked yet");
  // taking it away asks for a reason; keeping it changes nothing
  await page.getByTestId("ex-gap-away-G-010").click();
  await page.getByTestId("ex-link-away-keep").click();
  await expect(page.getByTestId("ex-gap-G-010")).toBeVisible();
  await page.getByTestId("ex-gap-away-G-010").click();
  await page.getByTestId("ex-link-away-confirm").click();
  await expect(page.getByTestId("ex-link-away-msg")).toBeVisible();
  await expect(page.getByTestId("ex-gap-G-010")).toBeVisible();
  await page.getByTestId("ex-link-away-reason").fill("Linked the wrong gap (fictional)");
  await page.getByTestId("ex-link-away-confirm").click();
  await expect(page.getByTestId("ex-gap-G-010")).toHaveCount(0);
  await expect(box).toContainText("Nothing is linked yet");
  await hash(page, "#/changes");
  await expect(page.getByRole("main")).toContainText("Linked the wrong gap (fictional)");
});

test("risk item: the suggestions are offered, accepting makes a draft item with no score, and the link is kept on the excipient", async ({ page }) => {
  await demoWithExcipient(page);
  await openLine(page);
  await expect(page.getByTestId("ex-risk-offers")).toHaveCount(0);
  await page.getByTestId("ex-risk-pick").selectOption("RAS-001");
  const offers = page.getByTestId("ex-risk-offers").locator("li");
  expect(await offers.count()).toBeGreaterThan(0);
  const start = page.locator('[data-testid^="ex-risk-start-"]').first();
  await start.click();
  await expect(page.getByTestId("ex-links-status")).toContainText(/Draft risk item .* started in RAS-001\. It has no score/);
  await expect(page.locator('[data-testid^="ex-risk-added-"]')).toHaveCount(1);
  expect(await page.getByTestId("ex-links-risk").locator("ul").first().locator("li").count()).toBeGreaterThan(0);
  // the item is on the risk page as a draft, with no score
  await page.getByTestId("ex-links-risk").getByRole("link", { name: /^Risk item / }).click();
  await expect(page.getByRole("main")).toContainText(/draft/i);
});

test("TRD: link a buffer material, write the two blanks with Use in the TRD, copy the rows, and the TRD says N excipients assessed", async ({ page }) => {
  await demoWithExcipient(page);
  await openLine(page);
  await expect(page.getByTestId("ex-trd-pick")).toHaveValue("");
  await page.getByTestId("ex-trd-pick").selectOption({ label: "TRD-001: Pooling, compounding and dilution, Buffer or diluent" });
  await page.getByTestId("ex-trd-link").click();
  await expect(page.getByTestId("ex-trd-linked")).toContainText("TRD-001");
  await expect(page.getByTestId("ex-trd-table")).toBeVisible();
  // the table rows are copy text; nothing is written into the TRD for the person
  await expect(page.getByTestId("ex-trd-table")).toHaveValue(/Excipient A \(fictional\)/);
  await page.getByTestId("ex-trd-doc").fill("QA-DOC-0001 (fictional)");
  await page.getByTestId("ex-trd-proc").fill("SOP-0002 (fictional)");
  await page.getByTestId("ex-trd-use-button").click();
  await expect(page.getByTestId("ex-links-status")).toContainText("Written to TRD-001");
  await expect(page.getByTestId("ex-trd-now")).toContainText("QA-DOC-0001 (fictional)");
  await expect(page.getByTestId("ex-trd-now")).toContainText("SOP-0002 (fictional)");
  await hash(page, "#/trd?trd=TRD-001");
  await expect(page.getByTestId("trd-pill-excipients")).toHaveText("3 excipients assessed"); // the demo's two linked lines and this one
});


/** Clicks a download that may first ask about open items, and returns the saved file's text. */
async function downloadText(page: Page, buttonTestId: string): Promise<{ name: string; text: string }> {
  await page.getByTestId(buttonTestId).click();
  const warn = page.getByTestId("ex-tbd-warning");
  const [dl] = await Promise.all([page.waitForEvent("download"), (await warn.isVisible().catch(() => false)) ? page.getByTestId("ex-tbd-go").click() : Promise.resolve()]);
  const path = await dl.path();
  const { readFile } = await import("node:fs/promises");
  return { name: dl.suggestedFilename(), text: await readFile(path, "utf8") };
}

test("document: HTML and Markdown carry the notice, the export history names the assessment, and each assessment shows only its own downloads", async ({ page }) => {
  await demoWithExcipient(page);
  await page.getByTestId("ex-tab-document").click();
  await expect(page.getByTestId("ex-open-count")).toContainText("open");
  const html = await downloadText(page, "ex-download-html");
  expect(html.name).toMatch(/^excipient-assessment-.*EXA-002.*\.html$/);
  expect(html.text).toContain(NOTICE_DOCUMENT);
  expect(html.text).toContain("Excipient A (fictional)");
  await expect(page.getByTestId("ex-done")).toContainText("recorded in the export history");
  const md = await downloadText(page, "ex-download-markdown");
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toContain(NOTICE_DOCUMENT);
  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(history).toContainText("excipient assessment");

  // a second assessment starts with an empty history
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await expect(page.getByTestId("ex-editor")).toBeVisible();
  await page.getByTestId("ex-add-name").fill("Excipient B (fictional)");
  await page.getByTestId("ex-add-btn").click();
  await page.getByTestId("ex-tab-document").click();
  await expect(page.getByText("Nothing has been downloaded from this project yet.")).toBeVisible();
  const md2 = await downloadText(page, "ex-download-markdown");
  expect(md2.text).toContain("Excipient B (fictional)");
  expect(md2.text).not.toContain("Excipient A (fictional)");
  await expect(history.locator("tbody tr")).toHaveCount(1);
});

test("document: Word download is built from the same document and recorded in the history", async ({ page }) => {
  await demoWithExcipient(page);
  await page.getByTestId("ex-tab-document").click();
  await page.getByTestId("ex-download-word").click();
  const go = page.getByTestId("ex-tbd-go");
  if (await go.isVisible().catch(() => false)) {
    const [dl] = await Promise.all([page.waitForEvent("download"), go.click()]);
    expect(dl.suggestedFilename()).toMatch(/^excipient-assessment-.*\.docx$/);
  }
  await expect(page.getByTestId("ex-word-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Export history table" })).toContainText("Word");
});

test("project pages: the Open items page and the compare page list the excipient assessments", async ({ page }) => {
  await demoWithExcipient(page);
  const pill = (await page.getByTestId("ex-pill-open").innerText()).trim();
  await hash(page, "#/tbd");
  // One count per assessment: the demo's own (EXA-001) first, the one just started (EXA-002) last.
  await expect(page.getByTestId("tbd-excipient-count")).toHaveCount(2);
  await expect(page.getByTestId("tbd-excipient-count").last()).toHaveText(pill);
  await hash(page, "#/versions");
  await page.getByTestId("version-table").locator("tbody tr").filter({ hasText: "Start" }).getByRole("link", { name: /^Compare/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  await expect(page.getByTestId("compare-tabs").getByRole("tab", { name: /^Excipient assessment [1-9]/ })).toBeVisible();
  await page.getByTestId("compare-tabs").getByRole("tab", { name: /^Excipient assessment/ }).click();
  await expect(page.getByTestId("compare-table")).toContainText("Excipient A (fictional)");
});

test("gap document: the Excipient assessment section is optional and appears only when excipient lines exist", async ({ page }) => {
  await demoWithExcipient(page);
  await hash(page, "#/document");
  const box = page.locator("#doc-sec-excipient-assessment");
  await page.getByTestId("doc-scope-panel").getByRole("button", { name: "Change" }).click();
  await expect(box).toBeChecked();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download gap assessment (Markdown)" }).click()]);
  const { readFile } = await import("node:fs/promises");
  const withSection = await readFile(await dl.path(), "utf8");
  expect(withSection).toContain("Excipient assessment");
  expect(withSection).toContain("Excipient A (fictional)");
  await box.uncheck();
  await expect(page.getByTestId("download-contents")).toContainText("left out");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download gap assessment (Markdown)" }).click()]);
  const without = await readFile(await dl2.path(), "utf8");
  expect(without).not.toContain("Excipient A (fictional)");
});

for (const scheme of ["Light", "Dark"] as const) {
  test(`${scheme}: the links box, the Document tab and the pages that list excipients are accessible and do not scroll sideways`, async ({ page }) => {
    await demoWithExcipient(page);
    await setTheme(page, scheme);
    await openLine(page);
    await page.getByTestId("ex-gap-pick").selectOption("G-010");
    await page.getByTestId("ex-gap-link").click();
    await page.getByTestId("ex-risk-pick").selectOption("RAS-001");
    await page.getByTestId("ex-trd-pick").selectOption({ label: "TRD-001: Pooling, compounding and dilution, Buffer or diluent" });
    await page.getByTestId("ex-trd-link").click();
    await expect(page.getByTestId("ex-trd-use")).toBeVisible();
    await expectAccessible(page, `${scheme} links box`);
    await expectNoSidewaysScroll(page, `${scheme} links box`);
    await page.getByTestId("ex-line-back").click();
    await page.getByTestId("ex-tab-document").click();
    await page.getByTestId("ex-preview-toggle").click();
    await expect(page.getByTestId("ex-preview")).toBeVisible();
    await expectAccessible(page, `${scheme} Document tab`);
    await expectNoSidewaysScroll(page, `${scheme} Document tab`);
    for (const h of ["#/tbd", "#/document"]) {
      await hash(page, h);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectAccessible(page, `${scheme} ${h}`);
      await expectNoSidewaysScroll(page, `${scheme} ${h}`);
    }
  });
}
