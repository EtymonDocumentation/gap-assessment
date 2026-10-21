import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FIXTURES = new URL("../../../packages/docx/fixtures/", import.meta.url);
const fixture = (name: string) => fileURLToPath(new URL(name, FIXTURES));

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText("Proof of concept. Not validated. Not for GMP use.").first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

/** The demo has open TBD values, so a download asks first (M5.4); these tests want the file, so they answer "Download anyway". */
async function confirmTbd(page: Page): Promise<void> {
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
}

async function downloadBytes(page: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click().then(() => confirmTbd(page))])) as [Download, void];
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
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

/** Opens the Templates page and adds the four fictional Brightwater samples (the PDF is read with pdf.js in the real browser). */
async function addSamples(page: Page) {
  await go(page, "#/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "4 sample templates added" })).toBeVisible();
}

const card = (page: Page, text: string) => page.locator("article.card", { hasText: text });

function expectZip(file: { name: string; bytes: Buffer }, label: string) {
  expect(file.name, label).toMatch(/\.docx$/);
  expect(file.bytes.subarray(0, 2).toString("latin1"), `${label}: zip signature`).toBe("PK");
  expect(file.bytes.length, `${label}: size`).toBeGreaterThan(10_000);
}

test("templates: samples with analysis, .doc advice, rename, export, delete and import", async ({ page }) => {
  await loadDemo(page);
  await addSamples(page);

  // The macro template: the macros are listed as removed.
  const macro = card(page, "macro-enabled template");
  await macro.locator("summary").click();
  await expect(macro.getByRole("heading", { level: 4, name: "Removed for safety" })).toBeVisible();
  await expect(macro).toContainText(/Macros/);
  await expect(macro).toContainText("Heading level 1");
  await expect(macro).toContainText("Portrait");

  // The PDF template is read in the browser, listed with its outline and offered only for mapping.
  const pdf = card(page, "PDF outline");
  await expect(pdf.locator("dt", { hasText: "Can be used for" }).locator("+ dd")).toHaveText("Map to their headings");
  await pdf.locator("summary").click();
  await expect(pdf.getByRole("list", { name: "Headings found in the template" })).toContainText("Objective");
  await expect(pdf.getByRole("list", { name: "Headings found in the template" })).toContainText("Process Description");

  // The tag template shows its tags; the Word template can be used for two ways.
  const tags = card(page, "placeholder-tag template");
  await tags.locator("summary").click();
  await expect(tags.getByRole("heading", { level: 4, name: "Placeholder tags" })).toBeVisible();
  await expect(tags).toContainText("{program}");
  await expect(card(page, "SOP-style template").locator("dt", { hasText: "Can be used for" }).locator("+ dd")).toContainText("Their look");

  // Adding the samples again adds nothing.
  await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
  await expect(page.getByRole("status").filter({ hasText: "0 sample templates added; 4 already in the library" })).toBeVisible();

  // An old .doc file is refused with advice, announced as an alert.
  const oldDoc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024)]);
  await page.getByLabel(/^Template file/).setInputFiles({ name: "old-sop.doc", mimeType: "application/msword", buffer: oldDoc });
  const alert = page.getByRole("alert").filter({ hasText: "old-sop.doc" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Save As");
  await expect(alert).toContainText(".docx");
  await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible();

  // Rename and change the version.
  await page.getByRole("button", { name: /^Rename \/ version of .*SOP-style/ }).click();
  const dlg = page.getByRole("dialog", { name: /^Rename/ });
  await dlg.getByLabel("Name").fill("Brightwater SOP");
  await dlg.getByLabel(/^Version/).fill("");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(dlg.getByRole("alert")).toContainText("version");
  await dlg.getByLabel(/^Version/).fill("3");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const sop = card(page, "Brightwater SOP");
  await expect(sop).toContainText("Version 3");

  // Export as a file, delete it (the dialog names it), import it back.
  const file = await downloadBytes(page, () => sop.getByRole("button", { name: "Export template file for Brightwater SOP" }).click());
  expect(file.name).toBe("brightwater-sop.gap-template.json");
  const json = JSON.parse(file.bytes.toString("utf8"));
  expect(json).toMatchObject({ format: "gap-template", formatVersion: 1, name: "Brightwater SOP", version: "3" });
  expect(json.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(typeof json.bytesBase64).toBe("string");

  await sop.getByRole("button", { name: "Delete Brightwater SOP" }).click();
  await expect(page.getByRole("dialog", { name: "Delete Brightwater SOP?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (3)" })).toBeVisible();

  // A changed file is refused; the real one is accepted.
  const tampered = { ...json, bytesBase64: `A${json.bytesBase64.slice(1)}` };
  await page.getByLabel(/^Import a template file/).setInputFiles({ name: "tampered.gap-template.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(page.getByRole("alert").filter({ hasText: "checksum" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Library (3)" })).toBeVisible();
  await page.getByLabel(/^Import a template file/).setInputFiles({ name: "brightwater-sop.gap-template.json", mimeType: "application/json", buffer: file.bytes });
  await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible();
  await expect(card(page, "Brightwater SOP")).toContainText("Version 3");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // The tag reference and the starter template.
  await expect(page.getByRole("table").filter({ hasText: "Recommended" }).first()).toBeVisible();
  const md = await downloadBytes(page, () => page.getByRole("button", { name: "Download tag reference (Markdown)" }).click());
  expect(md.bytes.toString("utf8")).toContain("# Placeholder tags for Word templates");
  const starter = await downloadBytes(page, () => page.getByRole("button", { name: "Download starter tag template" }).click());
  expect(starter.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
});

test("templates: uploading a Word file asks for a name and version", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/templates");
  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-macro.docm"));
  const form = page.getByRole("form", { name: /^Add brightwater-macro\.docm/ });
  await expect(form).toBeVisible();
  await expect(form).toContainText("Removed for safety");
  await expect(form.getByLabel("Name")).toHaveValue("brightwater-macro");
  await expect(form.getByLabel(/^Version/)).toHaveValue("1");
  await form.getByLabel("Name").fill("Macro sample (fictional)");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  const c = card(page, "Macro sample (fictional)");
  await expect(c).toContainText("brightwater-macro.docm");
  await expect(c.locator("dt", { hasText: "SHA-256" }).locator("+ dd code").first()).toHaveText(/^[0-9a-f]{12}$/);

  // The same file twice is refused.
  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-macro.docm"));
  await expect(page.getByRole("alert")).toContainText("already in the library");

  // The library survives a reload (it lives in this browser, not in the project).
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
});

test("mapping editor: suggest, change a heading, reorder, leave out needs a tick, save and reload", async ({ page }) => {
  await loadDemo(page);
  await addSamples(page);
  await card(page, "SOP-style template").getByRole("link", { name: /^Create mapping/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Heading mapping:/ })).toBeVisible();

  const unmapped = page.getByRole("heading", { level: 3, name: /^Tool content not mapped/ });
  await expect(page.getByRole("heading", { level: 2, name: /^Template headings/ })).toBeVisible();
  // Nothing is mapped yet.
  await expect(unmapped).toContainText(/\(1\d\)$/);
  const mappedCount = async () => Number(/\((\d+)\)/.exec((await unmapped.textContent()) ?? "")?.[1]);
  const before = await mappedCount();
  await page.getByRole("button", { name: "Suggest a mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: "A suggested mapping was filled in" })).toBeVisible();
  const after = await mappedCount();
  // The suggestion maps most of the document; the Gap details appendix has no heading in this sample, so it stays listed.
  expect(after).toBeLessThan(before);
  expect(after).toBeLessThanOrEqual(10);

  // Remove the content the suggestion put under "Objective": it shows up as not mapped.
  const objective = page.locator("li.map-row", { has: page.getByRole("heading", { level: 3, name: /Objective/ }) });
  await expect(objective).toContainText("Purpose");
  await objective.getByRole("button", { name: /^Remove .*Purpose/ }).click();
  expect(await mappedCount()).toBe(after + 1);
  await expect(unmapped.locator("xpath=following-sibling::ul[1]")).toContainText("Purpose");

  // Put two pieces of content under "Definitions" and move one up and down with the buttons.
  const defs = page.locator("li.map-row", { has: page.getByRole("heading", { level: 3, name: /Definitions/ }) });
  await defs.getByLabel("Add tool content").selectOption({ label: "1. Purpose" });
  await defs.getByLabel("Add tool content").selectOption({ label: "Appendix B. Source register" });
  const items = defs.locator("ol.map-blocks > li > span:first-child");
  await expect(items).toHaveText(["1. Purpose", "Appendix B. Source register"]);
  await defs.getByRole("button", { name: /^Move Appendix B[.] Source register up/ }).click();
  await expect(items).toHaveText(["Appendix B. Source register", "1. Purpose"]);
  await defs.getByRole("button", { name: /^Move Appendix B[.] Source register down/ }).click();
  await expect(items).toHaveText(["1. Purpose", "Appendix B. Source register"]);
  await defs.getByRole("button", { name: /^Remove Appendix B[.] Source register/ }).click();
  await expect(items).toHaveText(["1. Purpose"]);
  // With content, the choices are replace / keep and add ours.
  await expect(defs.getByLabel("Their existing text under this heading").locator("option")).toHaveText(["Replace their text", "Keep their text and add ours after it"]);
  // Move "Purpose" back to "Objective" (it has to be removed here first).
  await defs.getByRole("button", { name: /^Remove 1\. Purpose/ }).click();
  await objective.getByLabel("Add tool content").selectOption({ label: "1. Purpose" });

  // Take one more piece of content away from the mapping; leaving content out needs an explicit tick.
  await objective.getByRole("button", { name: /^Remove .*Purpose/ }).click();
  await page.getByLabel("Leave it out").check();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("alert")).toContainText("I understand this content will be left out");
  await page.getByLabel("I understand this content will be left out of the Word document").check();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mapping saved." })).toBeVisible();
  const savedCount = await mappedCount();

  // The mapping is stored with the template: still there after a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /^Heading mapping:/ })).toBeVisible();
  await expect(page.getByLabel("Leave it out")).toBeChecked();
  await expect(page.getByLabel("I understand this content will be left out of the Word document")).toBeChecked();
  expect(await mappedCount()).toBe(savedCount);
  await expect(page.locator("li.map-row", { has: page.getByRole("heading", { level: 3, name: /Applicability/ }) })).toContainText("Scope");

  // The library page says so too.
  await go(page, "#/templates");
  await expect(card(page, "SOP-style template")).toContainText(/Saved: content assigned to \d+ of \d+ headings/);
});

test("document: Word export in all four modes, from the saved mapping, with the export history", async ({ page }) => {
  test.setTimeout(180_000);
  await loadDemo(page);
  await addSamples(page);

  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 2, name: "Word document" })).toBeVisible();
  const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Word document" }) });
  const exportBtn = panel.getByRole("button", { name: "Download Word document" });
  const pick = async (mode: RegExp, templateText?: string) => {
    await panel.getByRole("radio", { name: mode }).check();
    if (templateText) {
      const opt = panel.locator("select").locator("option", { hasText: templateText });
      await panel.locator("select").selectOption(await opt.getAttribute("value"));
    }
  };

  // 1. Built-in.
  await pick(/^Built-in default/);
  expectZip(await downloadBytes(page, () => exportBtn.click()), "built-in");
  await expect(panel.getByRole("status")).toContainText("Built-in default");

  // 2. Their look.
  await pick(/^Their look/, "SOP-style");
  expectZip(await downloadBytes(page, () => exportBtn.click()), "their look");

  // 3. Mapped: blocked until a mapping is saved, then it uses the saved mapping.
  await pick(/^Map to their headings/, "SOP-style");
  await expect(exportBtn).toBeDisabled();
  await expect(panel).toContainText("no saved heading mapping");
  await panel.getByRole("link", { name: /^Create the heading mapping/ }).click();
  await page.getByRole("button", { name: "Suggest a mapping" }).click();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mapping saved." })).toBeVisible();
  await go(page, "#/document");
  await pick(/^Map to their headings/, "SOP-style");
  await expect(exportBtn).toBeEnabled();
  await expect(panel).toContainText("not mapped to a heading");
  expectZip(await downloadBytes(page, () => exportBtn.click()), "mapped");

  // 4. Tags: only the tag template is offered.
  await panel.getByRole("radio", { name: /^Placeholder tags/ }).check();
  await expect(panel.locator("select").locator("option")).toHaveCount(1);
  await expect(panel.locator("select")).toContainText("placeholder-tag");
  expectZip(await downloadBytes(page, () => exportBtn.click()), "tags");

  // 5. Mapped with the PDF template (headings only). The PDF is not offered for the other options.
  await panel.getByRole("radio", { name: /^Their look/ }).check();
  await expect(panel.locator("select").locator("option", { hasText: "PDF outline" })).toHaveCount(0);
  await panel.getByRole("radio", { name: /^Map to their headings/ }).check();
  await expect(panel.locator("select").locator("option", { hasText: "PDF outline" })).toHaveCount(1);
  await panel.locator("select").selectOption(await panel.locator("select").locator("option", { hasText: "PDF outline" }).getAttribute("value"));
  await expect(exportBtn).toBeDisabled();
  await panel.getByRole("link", { name: /^Create the heading mapping/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /PDF outline/ })).toBeVisible();
  await page.getByRole("button", { name: "Suggest a mapping" }).click();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mapping saved." })).toBeVisible();
  await go(page, "#/document");
  await pick(/^Map to their headings/, "PDF outline");
  await expect(exportBtn).toBeEnabled();
  expectZip(await downloadBytes(page, () => exportBtn.click()), "mapped with a PDF");

  // The history lists every download, newest first, with the template and its hash.
  const history = page.getByRole("region", { name: "Export history table" });
  const rows = history.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Word");
  await expect(rows.first()).toContainText("PDF outline");
  await expect(rows.nth(1)).toContainText("placeholder-tag");
  await expect(rows.last()).toContainText("Built-in default 1.2.0");
  await expect(rows.last().locator("td").nth(4)).toHaveText("4"); // TBD values open
  await expect(rows.last().locator("td").nth(6)).toHaveText("No earlier download");
  await expect(rows.first().locator("td").nth(2).locator("code")).toHaveText(/^[0-9a-f]{12}$/);

  // Markdown and HTML downloads add a row too, recorded against the built-in template.
  await page.getByRole("button", { name: "Download Markdown" }).click();
  await confirmTbd(page);
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("Markdown");
  await expect(rows.first()).toContainText("Built-in default 1.2.0");
  await page.getByRole("button", { name: "Download HTML" }).click();
  await confirmTbd(page);
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText("HTML");

  // A saved export history is part of the project: it survives a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: "Export history table" }).locator("tbody tr")).toHaveCount(7);
});

test("document: the tag sample passes the pre-export check", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/templates");
  await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible({ timeout: 30_000 });
  await go(page, "#/document");
  const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Word document" }) });
  await panel.getByRole("radio", { name: /^Placeholder tags/ }).check();
  await expect(panel.getByText("No problems found.").or(panel.getByText("Warnings"))).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download Word document" })).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`M5 pages: accessibility and layout, ${theme} theme`, async ({ page }) => {
    test.setTimeout(240_000);
    await loadDemo(page);
    await page.getByLabel("Colour theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await addSamples(page);

    // Templates, with the analysis open.
    await card(page, "SOP-style template").locator("summary").click();
    await card(page, "PDF outline").locator("summary").click();
    await expect(page.getByRole("table", { name: "Tag reference table" }).or(page.getByRole("region", { name: "Tag reference table" }))).toBeVisible();
    const original = page.viewportSize();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectAccessible(page, `${theme} templates at ${width}px`);
      await expectNoHorizontalScroll(page, `${theme} templates at ${width}px`);
    }
    if (original) await page.setViewportSize(original);

    // Templates dialogs.
    await page.getByRole("button", { name: /^Rename \/ version of .*SOP-style/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `${theme} rename template dialog`);
    await expectNoHorizontalScroll(page, `${theme} rename template dialog`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /^Delete .*SOP-style/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `${theme} delete template dialog`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // An error message.
    await page.getByLabel(/^Template file/).setInputFiles({ name: "old.doc", mimeType: "application/msword", buffer: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]) });
    await expect(page.getByRole("alert")).toBeVisible();
    await expectAccessible(page, `${theme} templates with an error`);

    // The mapping editor, before and after a suggestion.
    await card(page, "SOP-style template").getByRole("link", { name: /^Create mapping/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Heading mapping:/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Template headings/ })).toBeVisible();
    await expectAccessible(page, `${theme} mapping editor, empty`);
    await page.getByRole("button", { name: "Suggest a mapping" }).click();
    await page.getByLabel("Leave it out").check();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectAccessible(page, `${theme} mapping editor at ${width}px`);
      await expectNoHorizontalScroll(page, `${theme} mapping editor at ${width}px`);
    }
    if (original) await page.setViewportSize(original);

    // The document page: panels, then each dialog.
    await go(page, "#/document");
    const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Word document" }) });
    await panel.getByRole("radio", { name: /^Map to their headings/ }).check();
    await expect(panel.getByRole("button", { name: "Download Word document" })).toBeDisabled();
    await page.getByRole("button", { name: "Download Markdown" }).click();
    await confirmTbd(page);
    await expect(page.getByRole("region", { name: "Export history table" })).toBeVisible();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expectAccessible(page, `${theme} document at ${width}px`);
      await expectNoHorizontalScroll(page, `${theme} document at ${width}px`);
    }
    if (original) await page.setViewportSize(original);

    // The review workflow (revisions, comments) is gone: its buttons must not be on the page.
    await expect(page.getByRole("button", { name: "Issue revision" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(0);
  });
}
