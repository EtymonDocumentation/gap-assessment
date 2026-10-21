// Milestone 5.7, part 0, server build: unticking an optional section must change the HTML and the Word download here too.
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";
import type { Download } from "@playwright/test";
import { expect, go, loadDemo, newAccount, signUp, test } from "./helpers";

function wordHeadings(bytes: Buffer): string[] {
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).filter((p) => /<w:pStyle w:val="Heading\d"/.test(p)).map((p) => p.replace(/<[^>]+>/g, ""));
}

/** The optional-section ticks sit in the panel above the downloads, folded to a summary until "Change" is pressed. */
async function openPanel(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("doc-scope-panel");
  if (!(await page.locator("#doc-sec-risk").isVisible())) await panel.getByRole("button", { name: "Change" }).click();
}

test("server build: unticking Risk ranking changes the HTML and the Word download, and ticking it again brings it back", async ({ page }) => {
  await signUp(page, newAccount("dl"));
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();

  const dl = async (name: string) => {
    const [d] = (await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        // The demo has open TBD values, so each download asks once.
        await page.getByRole("button", { name }).click();
        await page.getByRole("button", { name: "Download anyway" }).click();
      })(),
    ])) as [Download, void];
    return readFile(await d.path());
  };
  const html = async () => (await dl("Download HTML")).toString("utf8");
  const word = () => dl("Download Word document");
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
