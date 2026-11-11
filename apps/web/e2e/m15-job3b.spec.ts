// M15 job 3B: a TRD that follows the headings of the user's own Word template counts and shows the same thing everywhere. A heading with no Cascade
// content and no text of its own is one open item ("<number> <heading>: nothing written under this heading yet."). The number is the same in the TRD
// header, the tabs, the Document tab, the TRD list, Home, the Open items list and every export-history row; it goes down by one when a writing box
// is filled and up again after "Remove this text". The preview, HTML download follow the template's headings in the template's order, with the
// bracketed lines for an empty heading. A deleted template falls back to Cascade's own order and count with nothing lost.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { addTemplate, confirmTbd, downloadWord, HEADINGS } from "./word-template-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

/** Only the first screen is kept: a full-page picture of a long page is unreadable when it is shrunk to fit. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(tmpdir(), `m15-job3b-${name}-${test.info().project.name}.png`) });
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const check = async (tag: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${label}${tag}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  };
  await check("");
  const size = page.viewportSize()!;
  if (size.width <= 400) {
    await page.setViewportSize({ width: 360, height: size.height });
    await check(" at 360 px");
    await page.setViewportSize(size);
  }
}

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const SAMPLES = join(tmpdir(), "gap-docx-samples", "m15-job3b");
const BOX = "What goes under this heading?";
const NOTHING = "nothing written under this heading yet";

async function projectWithTemplate(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Heading count (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await addTemplate(page);
}

/** Start path with "A template's headings": confirm every suggestion, replace the template's own text, and land in the interview. */
async function startMapped(page: Page) {
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await page.getByTestId("start-kind-mapped").check();
  const value = await page.locator('[data-testid="start-template-select"] option', { hasText: "Harbourlight SOP (fictional)" }).first().getAttribute("value");
  await page.getByTestId("start-template-select").selectOption(value!);
  await page.getByTestId("start-next").click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-match")).toBeVisible();
  await page.getByTestId("trd-match-confirm-all").click();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

const num = (text: string | null, re: RegExp) => {
  const m = re.exec(text ?? "");
  if (!m) throw new Error(`no number in "${text}"`);
  return Number(m[1]);
};

/** The TRD's open-item number as each place shows it. */
async function numbers(page: Page) {
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  await expect(page.getByTestId("iv-open-count")).toBeVisible();
  const interview = num(await page.getByTestId("iv-open-count").innerText(), /(\d+) open item/);
  const header = num(await page.getByTestId("trd-pill-open").innerText(), /(\d+) open item/);
  const tab = num(await page.getByTestId("trd-tab-open").innerText(), /\((\d+)\)/);
  await page.getByTestId("trd-tab-open").click();
  const entries = await page.getByText(NOTHING).count();
  await page.getByTestId("trd-tab-output").click();
  const outText = (await page.getByTestId("trd-open-count").innerText()).trim();
  const output = /^No open items/.test(outText) ? 0 : num(outText, /^(\d+) open item/);
  await hash(page, "#/trd");
  const row = page.getByTestId("trd-list-table").getByRole("row", { name: /TRD-001/ });
  const list = num(await row.getByRole("cell").nth(3).innerText(), /(\d+)/);
  await hash(page, "#/");
  await expect(page.getByTestId("doc-card-state-trd")).toBeVisible();
  const homeText = await page.getByTestId("doc-card-state-trd").innerText();
  const home = /no open items/.test(homeText) ? 0 : num(homeText, /(\d+) open item/);
  return { interview, header, tab, output, list, home, entries };
}

/** The history rows' "Open when made" cells, newest first. */
async function historyCounts(page: Page) {
  await hash(page, "#/trd?trd=TRD-001&tab=output");
  const cells = page.getByRole("region", { name: "Export history table" }).getByRole("row").locator("td:nth-child(4)");
  const texts = await cells.allInnerTexts();
  return texts.map((t) => num(t, /(\d+)/));
}

async function downloadHtml(page: Page): Promise<string> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), page.getByTestId("trd-download-html").click().then(() => confirmTbd(page))])) as [Download, void];
  return (await readFile(await dl.path())).toString("utf8");
}

const plain = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<\/(p|h\d|li|tr|div)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ");

test("the open-item number is the same in every place, moves with the writing box, and the document follows the template", async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(SAMPLES, { recursive: true });
  await projectWithTemplate(page);
  await startMapped(page);

  // The same number everywhere, and the list names each empty heading in plain words.
  const first = await numbers(page);
  expect(first.entries).toBeGreaterThanOrEqual(2);
  expect(new Set([first.interview, first.header, first.tab, first.list, first.home]).size, JSON.stringify(first)).toBe(1);
  const base = first.header;
  // The Document tab and the history record the document's own open-items list. The header also counts blank description fields, which no heading change touches, so the gap between the two stays the same.
  const gap = first.header - first.output;
  await hash(page, "#/trd?trd=TRD-001&tab=open");
  await expect(page.getByText(NOTHING).first()).toContainText("Distribution list");
  await expectNoSidewaysScroll(page, "Open items tab");
  await shot(page, "open-items-page");

  // Document tab: before a download the line is in plain words and says the headings count as open items.
  await hash(page, "#/trd?trd=TRD-001&tab=output");
  const before = page.getByText(/headings have no content and no text of your own/);
  const line = page.getByTestId("trd-to-complete");
  await expect(before).toContainText(/headings have no content and no text of your own\. They say "\[To be completed\.\]" in the Word file and count as open items: /);
  await expect(before).toContainText("Distribution list");
  await shot(page, "document-tab-before");
  await expectAccessible(page, "Document tab");
  await expectNoSidewaysScroll(page, "Document tab");

  // Downloads: Word and HTML. Every history row carries the same number.
  const xml = new PizZip(await downloadWord(page)).file("word/document.xml")!.asText();
  writeFileSync(join(SAMPLES, `word-document-${test.info().project.name}.xml`), xml);
  const html = await downloadHtml(page);
  writeFileSync(join(SAMPLES, `trd-${test.info().project.name}.html`), html);
  const text = plain(html);
  // The template's headings are the section titles, in the template's order, with Cascade's own order gone.
  const titles = [...html.matchAll(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
  const at = HEADINGS.map(([h]) => titles.indexOf(h));
  for (const [i, a] of at.entries()) expect(a, HEADINGS[i]![0]).toBeGreaterThan(-1);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
  expect(text).toContain("[To be completed.]");
  expect(text.replace(/\s+/g, " ")).toMatch(/Distribution list ?Nothing written under this heading yet\./);
  expect(await historyCounts(page)).toEqual([first.output, first.output]);
  await expect(line).toContainText(/count as open items: /);
  await shot(page, "document-tab-after");
  await shot(page, "export-history");

  // The preview is in the template's order, with the line saying so and the "Not in your template" line above it.
  await page.getByTestId("trd-preview-toggle").click();
  await expect(page.getByTestId("trd-preview-follows")).toContainText("The document follows the headings of Harbourlight SOP (fictional).");
  await expect(page.getByTestId("trd-preview-not-in-template")).toContainText(/Not in your template: \d+ section/);
  const preview = page.getByTestId("trd-preview");
  await expect(preview.getByText("[To be completed.]").first()).toBeVisible();
  await expect(preview.locator("#doc-heading-4")).toContainText("Distribution list");
  await expectAccessible(page, "preview");
  await expectNoSidewaysScroll(page, "preview");
  await page.getByTestId("trd-preview-follows").scrollIntoViewIfNeeded();
  await shot(page, "preview-template-order");

  // Fill the writing box: one fewer, in every place. The Word file and the history follow.
  await hash(page, "#/trd?trd=TRD-001&tab=interview&show=all");
  await page.getByTestId("iv-show-all").check();
  const group = page.getByTestId("iv-group-heading-4");
  await group.getByRole("textbox", { name: BOX }).fill("Distribution: the sending and receiving sites (fictional).");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("Answered");
  const filled = await numbers(page);
  expect(new Set([filled.interview, filled.header, filled.tab, filled.list, filled.home]).size, JSON.stringify(filled)).toBe(1);
  expect(filled.header).toBe(base - 1);
  expect(filled.header - filled.output).toBe(gap);
  expect(filled.entries).toBe(first.entries - 1);

  // Take the text away again (a confirmed removal with a reason): the number is back.
  await hash(page, "#/trd?trd=TRD-001&tab=interview&show=all");
  await page.getByTestId("iv-show-all").check();
  await page.getByTestId("iv-group-heading-4").getByTestId("iv-remove-text").click();
  await page.getByTestId("iv-text-remove-dialog-reason").fill("The sites are listed elsewhere (fictional).");
  await page.getByTestId("iv-text-remove-dialog-confirm").click();
  await expect(page.getByTestId("iv-group-heading-4")).toContainText("Open");
  const back = await numbers(page);
  expect(new Set([back.interview, back.header, back.tab, back.list, back.home]).size, JSON.stringify(back)).toBe(1);
  expect(back.header).toBe(base);
  expect(back.header - back.output).toBe(gap);

  // A new download records the number as it is now.
  await hash(page, "#/trd?trd=TRD-001&tab=output");
  await downloadHtml(page);
  expect((await historyCounts(page))[0]).toBe(base - gap);

  // The Markdown and HTML wording of the open-items list is the same sentence as the screen.
  expect(text.replace(/\s+/g, " ").match(/Nothing written under this heading yet\./g)!.length).toBe(first.entries);
});

test("a deleted template falls back to Cascade's own order and count, and nothing is lost", async ({ page }) => {
  test.setTimeout(300_000);
  await projectWithTemplate(page);
  await startMapped(page);
  const before = await numbers(page);
  await hash(page, "#/trd?trd=TRD-001&tab=interview&show=all");
  await page.getByTestId("iv-show-all").check();
  const group = page.getByTestId("iv-group-heading-4");
  await group.getByRole("textbox", { name: BOX }).fill("Kept text (fictional).");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("Answered");

  await hash(page, "#/templates");
  await page.getByRole("button", { name: "Delete Harbourlight SOP (fictional)" }).click();
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText('Template "Harbourlight SOP (fictional)" deleted.')).toBeVisible();

  // No heading items any more: the number is the Cascade-shaped one everywhere, and the preview is Cascade's own.
  const after = await numbers(page);
  expect(new Set([after.interview, after.header, after.tab, after.list, after.home]).size, JSON.stringify(after)).toBe(1);
  expect(after.entries).toBe(0);
  expect(after.header).toBeLessThan(before.header);
  expect(after.output).toBe(before.output - before.entries);
  await hash(page, "#/trd?trd=TRD-001&tab=output");
  await page.getByTestId("trd-preview-toggle").click();
  await expect(page.getByTestId("trd-preview-follows")).toHaveCount(0);
  await expect(page.getByTestId("trd-preview")).not.toContainText("[To be completed.]");
  await shot(page, "after-template-deleted");
});
