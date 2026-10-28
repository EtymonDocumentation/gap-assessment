// Milestone 5.4: the "Answering from" bar, Link values, citation locations, and TBD (to be determined) values.
// Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Drafting test (fictional)");
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

/** Opens the bar's form, adds a new document and starts answering from it. */
async function startBar(page: Page, id: string, extra?: { section?: string; page?: string }) {
  const bar = page.getByRole("region", { name: "Answering from" });
  await bar.getByRole("button", { name: "Choose a document" }).click();
  await bar.getByLabel("Document", { exact: true }).selectOption({ label: "Add a new document…" });
  await bar.getByLabel("Document ID").fill(id);
  if (extra?.section) await bar.getByLabel("Section (optional)").fill(extra.section);
  if (extra?.page) await bar.getByLabel("Page (optional)").fill(extra.page);
  return bar;
}

test("the Answering from bar cites each saved answer, shows where, and survives a reload", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);
  const bar = page.getByRole("region", { name: "Answering from" });
  await expect(bar).toContainText("no document chosen");

  await startBar(page, "DEMO-DRAFT-001 (fictional)", { section: "4.2", page: "12" });
  await bar.getByLabel("Title").fill("Source batch record");
  await expectAccessible(page, "answering bar form open");
  await expectNoHorizontalScroll(page, "answering bar form open");
  await bar.getByRole("button", { name: "Start answering from this document" }).click();
  await expect(bar).toContainText("DEMO-DRAFT-001 (fictional)");
  await expect(bar).toContainText("§4.2 p.12");

  // The next answer is cited, with feedback and an Undo.
  await page.getByPlaceholder("e.g. ARX-217").fill("TST-1 (fictional)");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText("Program or product code");
  await expect(bar.getByRole("status")).toContainText(/Cited to DEMO-DRAFT-001 \(fictional\).*§4\.2 p\.12/);

  // The bar is saved in the project: it is still there after a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: "Answering from" })).toContainText("DEMO-DRAFT-001 (fictional)");

  // The Sources page shows the document cited once, with its place.
  await go(page, "#/sources");
  const row = page.locator("tr", { hasText: "DEMO-DRAFT-001" }).first();
  await row.locator("button[id^='cites-']").click();
  await expect(page.locator(".cite-list li")).toHaveCount(1);
  await expect(page.locator(".cite-list li")).toContainText("§4.2 p.12");

  // One click turns the bar off.
  await go(page, "#/interview");
  const again = page.getByRole("region", { name: "Answering from" });
  await again.getByRole("button", { name: "Clear answering from" }).click();
  await expect(again).toContainText("no document chosen");
});

test("Undo takes back the citations the save made and the change log records it", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);
  const bar = await startBar(page, "DEMO-DRAFT-002 (fictional)");
  await bar.getByRole("button", { name: "Start answering from this document" }).click();
  await page.getByPlaceholder("e.g. ARX-217").fill("TST-2 (fictional)");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(bar.getByRole("status")).toContainText("Cited to DEMO-DRAFT-002 (fictional)");
  await bar.getByRole("button", { name: /Undo/ }).click();
  await expect(bar.getByRole("status")).toHaveCount(0);

  await go(page, "#/sources");
  const row = page.locator("tr", { hasText: "DEMO-DRAFT-002" }).first();
  await row.locator("button[id^='cites-']").click();
  await expect(page.locator("tr[id^='cited-']")).toContainText("No entry cites this source.");
  await go(page, "#/changes");
  await expect(page.locator("main")).toContainText("DEMO-DRAFT-002");
});

test("Link values cites many entries to a document once and marks them as already cited", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/sources");
  await page.getByRole("button", { name: /^Link values to DEMO-PPQ-217-01/ }).click();
  const dlg = page.getByRole("dialog", { name: /^Link values to DEMO-PPQ-217-01/ });
  await expect(dlg).toBeVisible();
  await expectAccessible(page, "link values dialog");
  await dlg.getByLabel("Side").selectOption("target");
  await dlg.getByLabel("Not yet cited to any document").check();
  await expect(dlg.getByRole("status").first()).toContainText(/\d+ values? shown/);
  await dlg.getByLabel("Section (optional)").fill("6.1");
  await dlg.getByLabel("Page (optional)").fill("9");
  await dlg.getByRole("button", { name: "Select all shown" }).click();
  const cite = dlg.getByRole("button", { name: /^Cite selected \(\d+\)$/ });
  const n = Number(/\((\d+)\)/.exec((await cite.textContent())!)![1]);
  expect(n).toBeGreaterThan(0);
  await cite.click();
  await expect(dlg).toContainText(`Cited ${n} ${n === 1 ? "entry" : "entries"} to DEMO-PPQ-217-01`);
  // Cited entries now cite a document, so the filter hides them; clear it to see them marked, and not selectable again.
  await dlg.getByLabel("Not yet cited to any document").uncheck();
  await expect(dlg.locator(".tag", { hasText: "Already cited (§6.1 p.9)" }).first()).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^Cite selected \(0\)$/ })).toBeDisabled();
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("button", { name: /^Link values to DEMO-PPQ-217-01/ })).toBeFocused();
});

test("a TBD with a best guess is compared, and every result that uses it says Provisional", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  await expect(page.locator("main .tag-provisional").first()).toHaveText("Provisional — based on a TBD value");
  await expect(page.locator("main")).toContainText("TBD best guess, provisional");
  await go(page, "#/register");
  await expect(page.locator("main .tag-provisional").first()).toBeVisible();
  await go(page, "#/validation");
  await expect(page.locator("main .tag-provisional").first()).toBeVisible();
  await go(page, "#/document");
  await expect(page.locator(".doc-preview")).toContainText("Provisional — based on a TBD value");
  await expect(page.locator(".doc-preview")).toContainText("TBD values");
});

test("the interview records a TBD with a best guess, owner and due date; the Home card and list show it", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);
  await page.getByRole("button", { name: "Add details" }).click();
  await page.getByLabel("TBD best guess").fill("TST-3 (fictional)");
  await page.getByLabel("Owner (optional)").fill("Process lead (fictional)");
  await page.getByLabel("Due date (optional)").fill("2020-01-15");
  await page.getByLabel("Note (optional)").fill("Waiting for the code from regulatory");
  await expectAccessible(page, "TBD box open");
  await expectNoHorizontalScroll(page, "TBD box open");
  await page.getByRole("button", { name: "Record TBD with these details" }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText("Program or product code");
  await go(page, "#/");
  const card = page.getByRole("link", { name: "1 TBD (1 overdue)" });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("heading", { level: 1, name: "TBD (to be determined)" })).toBeVisible();
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("TST-3 (fictional)");
  await expect(row).toContainText("Process lead (fictional)");
  await expect(row).toContainText("2020-01-15");
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("Waiting for the code from regulatory");
  await expectAccessible(page, "TBD list");
  await expectNoHorizontalScroll(page, "TBD list");
  // The link goes back to the question.
  await row.getByRole("link").click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
});

test("the demo's Home card counts its TBD values and the overdue one; Show only TBD narrows the interview", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/");
  await expect(page.getByRole("link", { name: "4 TBD (1 overdue)" })).toBeVisible();
  await expectAccessible(page, "home with TBD card");
  await expectNoHorizontalScroll(page, "home with TBD card");
  await go(page, "#/tbd");
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.locator("tbody tr .tag-overdue")).toHaveCount(1);

  await go(page, "#/interview");
  await page.getByLabel("Show only TBD").check();
  const list = page.getByRole("list", { name: "Questions recorded as TBD" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await list.getByRole("link").first().click();
  await expect(page.locator(".question-card")).toBeVisible();
  await expectAccessible(page, "interview with Show only TBD");
});

test("a download with TBD values asks first and names the count, in every format; Go back changes nothing; Download anyway records it", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/document");
  for (const name of ["Download Markdown", "Download HTML"]) {
    await page.getByRole("button", { name }).click();
    const warn = page.getByRole("dialog", { name: "Download with TBD values?" });
    await expect(warn).toContainText("4 TBD values");
    await expect(warn.getByTestId("tbd-warning")).toContainText("4 TBD values were");
    await warn.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.getByRole("button", { name: "Download Word document" }).click();
  const warn = page.getByRole("dialog", { name: "Download with TBD values?" });
  await expectAccessible(page, "TBD warning dialog");
  // Nothing was recorded by going back.
  await expect(page.getByRole("region", { name: "Export history" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Export history" }) })).locator("tbody tr")).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent("download"), warn.getByRole("button", { name: "Download anyway" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.docx$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Export history" }) }).locator("tbody tr").first()).toContainText("4");
});

test("the Interview page with the bar is accessible, keyboard operable and does not scroll sideways", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/interview");
  const bar = page.getByRole("region", { name: "Answering from" });
  await expect(bar).toBeVisible();
  await expectAccessible(page, "interview with the bar");
  await expectNoHorizontalScroll(page, "interview with the bar");
  await bar.getByRole("button", { name: "Choose a document" }).click();
  await bar.getByLabel("Document", { exact: true }).selectOption({ index: 1 });
  await bar.getByRole("button", { name: "Start answering from this document" }).click();
  await expect(bar).not.toContainText("no document chosen");
  await expectAccessible(page, "interview with a document chosen");
  await expectNoHorizontalScroll(page, "interview with a document chosen");
  // Keyboard: the buttons are reachable and Escape closes the form.
  await bar.getByRole("button", { name: "Change" }).focus();
  await page.keyboard.press("Enter");
  await expect(bar.getByRole("button", { name: "Update" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "Update" })).toBeHidden();
  await expect(bar.getByRole("button", { name: "Change" })).toBeFocused();
});
