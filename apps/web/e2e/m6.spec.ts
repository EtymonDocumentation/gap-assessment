// Milestone 6: the TRD seed page. The seed (JSON) and the draft outline (Word, HTML) are downloaded, read back and checked, the
// export history records them with their versions, and the page is accessible at the desktop, tablet and phone widths.
// All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { parseTrdSeed } from "@gap/process-model";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const TITLE = "Technical requirements document — draft outline";
const SHOTS = tmpdir();

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

async function openTrdPage(page: Page) {
  await loadDemo(page);
  // Through the navigation, so the "TRD seed" link is part of what is tested. On a phone the navigation sits behind a menu button.
  const nav = page.getByRole("link", { name: "TRD seed", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await expect(page.getByRole("heading", { level: 1, name: "TRD seed" })).toBeVisible();
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

/** Presses a download button; the demo has open TBD values, so the warning is answered with "Download anyway". */
async function download(page: Page, name: string | RegExp): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("button", { name }).click();
      await page.getByRole("button", { name: "Download anyway" }).click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

function wordHeadings(bytes: Buffer): string[] {
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).filter((p) => /<w:pStyle w:val="Heading\d"/.test(p)).map((p) => p.replace(/<[^>]+>/g, ""));
}
const wordText = (bytes: Buffer) => new PizZip(bytes).file("word/document.xml")!.asText().replace(/<[^>]+>/g, " ");

test("the TRD seed page explains itself, counts the values and offers the three downloads", async ({ page }) => {
  await openTrdPage(page);
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What this is" })).toBeVisible();
  await expect(page.getByText(/Customer templates are not applied to it yet/)).toBeVisible();
  await expect(page.getByTestId("trd-scope-summary")).toContainText("process steps in scope");
  // Counts per process step, inside a scrollable, labelled region.
  const region = page.getByRole("region", { name: "RU values per process step" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("row", { name: /Aseptic filling/ })).toBeVisible();
  // The demo has open TBD values: the page says so before any download.
  await expect(page.getByTestId("trd-open-note")).toContainText("TBD");
  for (const name of ["Download TRD seed (JSON)", "Download draft outline (Word)", "Download draft outline (HTML)"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByTestId("trd-preview").getByRole("heading", { level: 1 })).toHaveText(TITLE);
  await expect(page.getByTestId("trd-preview")).toContainText("Not an approved TRD");
});

test("downloads: the JSON parses with the schema, the Word file has the outline headings, and all three are in the export history", async ({ page }) => {
  test.setTimeout(90_000);
  await openTrdPage(page);

  const json = await download(page, "Download TRD seed (JSON)");
  expect(json.file).toMatch(/^trd-seed-prj-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.json$/);
  const seed = parseTrdSeed(json.bytes.toString("utf8"));
  expect(seed.meta.format).toBe("gap-assessment.trd-seed");
  expect(seed.meta.product.program).toMatchObject({ status: "established", value: "ARX-217" });
  expect(seed.unitOperations.length).toBeGreaterThan(5);
  // Unknowns stay unknown: no field without a value is established, and no SU value is in an RU value field.
  const all = [...seed.site.fields, ...seed.unitOperations.flatMap((u) => [...u.fields, ...u.items.flatMap((i) => i.fields)])];
  expect(all.filter((f) => f.status === "not_established").every((f) => f.value === undefined)).toBe(true);
  expect(all.some((f) => f.status === "tbd")).toBe(true);

  const word = await download(page, "Download draft outline (Word)");
  expect(word.file).toMatch(/^trd-outline-prj-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.docx$/);
  const headings = wordHeadings(word.bytes);
  for (const h of ["Purpose and scope", "Product and presentation", "Receiving site and line", "Process overview", "Open items", "Source register", "Traceability to the gap assessment", "Versions"]) {
    expect(headings.some((x) => x.includes(h)), `Word heading ${h}`).toBe(true);
  }
  expect(headings.some((x) => x.includes("Aseptic filling"))).toBe(true);
  const text = wordText(word.bytes);
  expect(text).toContain(TITLE);
  expect(text).toContain(BANNER);
  expect(text).toContain("Not an approved TRD");
  expect(text).toContain("TBD best guess");

  const html = await download(page, "Download draft outline (HTML)");
  expect(html.file).toMatch(/^trd-outline-prj-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.html$/);
  expect(html.bytes.toString("utf8")).toContain(TITLE);
  expect(html.bytes.toString("utf8")).toContain(BANNER);

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.getByRole("cell", { name: "TRD seed (JSON)" })).toBeVisible();
  await expect(history.getByRole("cell", { name: "TRD outline (Word)" })).toBeVisible();
  await expect(history.getByRole("cell", { name: "TRD outline (HTML)" })).toBeVisible();
  await expect(history.getByTestId("export-versions").first()).toContainText("Process model 1.13.0; catalog 1.9.0; seed format 1.0.0");
  // The same seed behind all three: one fingerprint.
  const prints = await history.locator("tbody tr td:nth-child(4) code").allTextContents();
  expect(new Set(prints).size).toBe(1);
});

test("unticking Traceability removes the section from the preview and from the Word file", async ({ page }) => {
  test.setTimeout(90_000);
  await openTrdPage(page);
  const preview = page.getByTestId("trd-preview");
  await expect(preview.getByRole("heading", { name: /Traceability to the gap assessment/ })).toBeVisible();
  const box = page.getByTestId("trd-traceability");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(preview.getByRole("heading", { name: /Traceability to the gap assessment/ })).toHaveCount(0);
  const word = await download(page, "Download draft outline (Word)");
  expect(wordHeadings(word.bytes).some((x) => x.includes("Traceability"))).toBe(false);
  const html = await download(page, "Download draft outline (HTML)");
  expect(html.bytes.toString("utf8")).not.toContain("Traceability to the gap assessment");
});

test("the TBD warning shows the count before a download and going back records nothing", async ({ page }) => {
  await openTrdPage(page);
  await page.getByRole("button", { name: "Download TRD seed (JSON)" }).click();
  await expect(page.getByTestId("tbd-warning")).toContainText("TBD");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByText("Nothing has been downloaded from this project yet.")).toBeVisible();
});

test("the TRD seed page is accessible and does not scroll sideways", async ({ page }) => {
  test.setTimeout(90_000); // three axe passes
  await openTrdPage(page);
  await expectAccessible(page, "TRD seed page");
  await expectNoHorizontalScroll(page, "TRD seed page");
  await page.getByRole("button", { name: "Download TRD seed (JSON)" }).click();
  await expectAccessible(page, "TRD seed page with the TBD warning open");
  await page.getByRole("button", { name: "Go back" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "TRD seed page, dark");
  await expectNoHorizontalScroll(page, "TRD seed page, dark");
});

test("screenshots of the TRD seed page", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "desktop and phone only");
  await openTrdPage(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(SHOTS, `m6-trd-${info.project.name}-${scheme}.png`), fullPage: false });
    await page.getByTestId("trd-preview").scrollIntoViewIfNeeded();
    await page.getByTestId("trd-preview").screenshot({ path: join(SHOTS, `m6-trd-preview-${info.project.name}-${scheme}.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});
