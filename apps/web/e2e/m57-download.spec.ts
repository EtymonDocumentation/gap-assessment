// Milestone 5.7, part 0: the reported bug "when I change the checked selections and press Download HTML or Word it gives
// the same file no matter the selection". Unticking an optional section must change every download, and ticking it again
// must bring it back.
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function downloadBytes(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click()])) as [Download, void];
  return readFile(await dl.path());
}

/** The text of the heading paragraphs of a Word file (the "Sections omitted" line also names a section, so plain text cannot tell). */
function wordHeadings(bytes: Buffer): string[] {
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .filter((p) => /<w:pStyle w:val="Heading\d"/.test(p))
    .map((p) => p.replace(/<[^>]+>/g, ""));
}

/** The optional-section ticks sit in the panel above the downloads, folded to a summary until "Change" is pressed. */
async function openPanel(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("doc-scope-panel");
  if (!(await page.locator("#doc-sec-risk").isVisible())) await panel.getByRole("button", { name: "Change" }).click();
}

test("unticking Risk ranking changes the HTML and the Word download, and ticking it again brings it back", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();

  // The demo has open TBD values, so each download asks once; the answer is "Download anyway".
  const press = (name: string) => async () => {
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: "Download anyway" }).click();
  };
  const html = () => downloadBytes(page, press("Download HTML")).then((b) => b.toString("utf8"));
  const word = () => downloadBytes(page, press("Download Word document"));
  const risk = (h: string[]) => h.some((x) => /Risk ranking/.test(x));

  const before = { html: await html(), word: await word() };
  expect(before.html).toMatch(/<h2[^>]*>[^<]*Risk ranking/);
  expect(risk(wordHeadings(before.word))).toBe(true);

  await openPanel(page);
  await page.locator("#doc-sec-risk").uncheck();
  await expect(page.locator(".doc-preview").getByRole("heading", { name: /Risk ranking/ })).toHaveCount(0);
  const after = { html: await html(), word: await word() };
  expect(after.html, "HTML download changes").not.toBe(before.html);
  expect(after.html).not.toMatch(/<h2[^>]*>[^<]*Risk ranking/);
  expect(risk(wordHeadings(after.word)), "Word has no Risk ranking heading").toBe(false);

  await page.locator("#doc-sec-risk").check();
  const again = { html: await html(), word: await word() };
  expect(again.html).toMatch(/<h2[^>]*>[^<]*Risk ranking/);
  expect(risk(wordHeadings(again.word))).toBe(true);
});
