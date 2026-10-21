// Milestone 5.2: per-gap notes, optional document sections, citing documents in the interview, accessibility and the phone layout.
// Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function newProject(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Cite test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
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

/** The demo has open TBD values, so a download asks first (M5.4); these tests want the file, so they answer "Download anyway". */
async function confirmTbd(page: Page): Promise<void> {
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
}

async function downloadText(page: Page, click: () => Promise<void>): Promise<string> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click().then(() => confirmTbd(page))])) as [Download, void];
  return readFile(await dl.path(), "utf8");
}

const NOTE = "Confirm the second fill needle with the supplier before PPQ (fictional note).";

test("a gap note edited on Compare shows on the Document page and in the Markdown download", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();

  // Find a difference that has no note yet and add one.
  const add = page.getByRole("button", { name: /^Add note for / }).first();
  await expect(add).toBeVisible();
  const label = (await add.textContent()) ?? "";
  const id = /for (\S+)/.exec(label)?.[1] ?? "";
  expect(id).not.toBe("");
  await add.click();
  const form = page.getByRole("form", { name: `Note for ${id}` });
  await form.getByLabel(`Note for ${id}`).fill(NOTE);
  await form.getByRole("button", { name: /^Save note/ }).click();
  await expect(page.locator("main")).toContainText(NOTE);

  // The change is logged as a gap update.
  await go(page, "#/changes");
  await expect(page.getByRole("heading", { level: 1, name: /Change log/ })).toBeVisible();
  await expect(page.locator("main")).toContainText(NOTE);

  // The document's Notes column carries it, and so does the Markdown.
  await go(page, "#/document");
  const preview = page.locator(".doc-preview");
  await expect(preview.getByRole("columnheader", { name: "Notes" }).first()).toBeVisible();
  await expect(preview).toContainText(NOTE);
  const md = await downloadText(page, () => page.getByRole("button", { name: "Download Markdown" }).click());
  expect(md).toContain(NOTE);
  expect(md).toContain("| ID | Attribute | SU | RU | Gap | Severity | Actions | Notes |");
});

test("leaving out Risk ranking and Approval removes them and the document says so", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();
  const preview = page.locator(".doc-preview");
  await expect(preview.getByRole("heading", { name: /Risk ranking/ })).toBeVisible();
  await expect(preview.getByRole("heading", { name: /Approval/ })).toBeVisible();
  await expect(preview).toContainText("Sections omitted");

  const panel = page.getByTestId("doc-scope-panel");
  await panel.getByRole("button", { name: "Change" }).click();
  // Mandatory sections are shown ticked and disabled, marked "Always included"; they cannot be unticked.
  await expect(panel.getByRole("checkbox", { name: /^Purpose/ })).toBeDisabled();
  await expect(panel.getByRole("checkbox", { name: /^Purpose/ })).toBeChecked();
  await expect(panel.getByRole("checkbox", { name: /Detailed gap table/ })).toBeDisabled();
  await expect(panel.getByText("Always included").first()).toBeVisible();

  await panel.getByRole("checkbox", { name: "Risk ranking" }).uncheck();
  await panel.getByRole("checkbox", { name: "Approval" }).uncheck();
  await expect(panel.getByTestId("doc-sections")).toContainText("2 optional sections are left out.");
  await expect(preview.getByRole("heading", { name: /Risk ranking/ })).toHaveCount(0);
  await expect(preview.getByRole("heading", { name: /Approval/ })).toHaveCount(0);
  await expect(preview).toContainText("Risk ranking; Approval");
  // The mandatory sections stay.
  await expect(preview.getByRole("heading", { name: /Detailed gap table/ })).toBeVisible();
  await expect(preview.getByRole("heading", { name: /Open information items/ })).toBeVisible();

  // The Markdown follows the same choice, and the export history records it.
  const md = await downloadText(page, () => page.getByRole("button", { name: "Download Markdown" }).click());
  expect(md).not.toMatch(/^## .*Risk ranking/m);
  expect(md).not.toMatch(/^## .*Approval/m);
  expect(md).toContain("Risk ranking; Approval");

  // The choice is stored with the project: it survives a reload.
  await page.reload();
  await go(page, "#/document");
  await expect(page.locator(".doc-preview")).toContainText("Risk ranking; Approval");
  await page.getByTestId("doc-scope-panel").getByRole("button", { name: "Change" }).click();
  await expect(page.locator("#doc-sec-risk")).not.toBeChecked();

  // Ticking a section brings it back.
  await page.locator("#doc-sec-risk").check();
  await expect(page.locator(".doc-preview").getByRole("heading", { name: /Risk ranking/ })).toBeVisible();
  await expect(page.locator(".doc-preview")).toContainText("Approval");
  await expectAccessible(page, "document with sections omitted");
  await expectNoHorizontalScroll(page, "document with sections omitted");
});

test("the interview cites documents: a new reference, then the same one picked from the register", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);

  // First answer: type a value and add a new document reference.
  await page.getByPlaceholder("e.g. ARX-217").fill("TST-1 (fictional)");
  const cite = page.locator("details.cite");
  await cite.locator("summary").click();
  await expect(cite.getByRole("group", { name: "Add a new document reference" })).toBeVisible();
  await cite.getByLabel("Reference ID").fill("DEMO-CITE-001");
  await cite.getByLabel("Title").fill("Cited protocol");
  await cite.getByLabel("Document type").fill("Protocol");
  await expectAccessible(page, "interview with the document form open");
  await expectNoHorizontalScroll(page, "interview with the document form open");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText("Program or product code");

  // Second answer: the document is now in the register and can be ticked.
  const next = page.locator("details.cite");
  await next.locator("summary").click();
  const existing = next.getByRole("group", { name: "Documents already in the register" });
  await expect(existing).toBeVisible();
  await existing.getByRole("checkbox", { name: /DEMO-CITE-001 — Cited protocol/ }).check();
  await page.locator(".question-card .choice-chip").first().click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // The register lists the document once, and it is cited by both answers.
  await go(page, "#/sources");
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  const rows = page.locator("tr", { hasText: "DEMO-CITE-001" });
  await expect(rows).toHaveCount(1);
  await rows.first().locator("button[id^='cites-']").click();
  await expect(page.locator(".cite-list li")).toHaveCount(2);

  // The Builder shows the document, not the interview, as the source of each of those values.
  await go(page, "#/builder");
  await page.getByRole("searchbox", { name: "Filter by text or path" }).fill("modality");
  await expect(page.locator("main")).toContainText("DEMO-CITE-001 — Cited protocol");
  await expect(page.locator("main .b-sources").first()).not.toContainText("Interview");
});

test("an incomplete new document reference is refused with a message", async ({ page }) => {
  await newProject(page);
  await page.getByPlaceholder("e.g. ARX-217").fill("TST-2 (fictional)");
  const cite = page.locator("details.cite");
  await cite.locator("summary").click();
  await cite.getByLabel("Title").fill("A title without an ID");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter the reference ID of the new document" })).toBeVisible();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
});

test("Compare, Document, Interview and Register have no serious accessibility issues", async ({ page }) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  for (const [hash, name] of [
    ["#/register", "register"],
    ["#/compare", "compare"],
    ["#/document", "document"],
    ["#/builder", "builder"],
    ["#/sources", "sources"],
  ] as const) {
    await go(page, hash);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expectAccessible(page, name);
  }
  // The note editor open on Compare.
  await go(page, "#/compare");
  await page.getByRole("button", { name: /^(Add|Edit) note for / }).first().click();
  await expect(page.getByRole("textbox", { name: /^Note for / })).toBeVisible();
  await expectAccessible(page, "compare with the note editor open");
});

test.describe("phone width (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no page scrolls sideways and the wide tables scroll inside their own region", async ({ page }) => {
    test.setTimeout(120_000);
    await loadDemo(page);
    for (const hash of ["#/register", "#/compare", "#/document", "#/builder", "#/sources", "#/changes", "#/validation"]) {
      await go(page, hash);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page, hash);
    }
    // Every wide table on the document page sits in a focusable, labelled scroll region.
    await go(page, "#/compare");
    const regions = page.locator("main .table-scroll");
    expect(await regions.count()).toBeGreaterThan(0);
    for (const r of await regions.all()) {
      await expect(r).toHaveAttribute("role", "region");
      await expect(r).toHaveAttribute("tabindex", "0");
      await expect(r).toHaveAttribute("aria-label", /.+/);
    }
  });
});
