// M13 job 2: the excipient assessment screens. The list page with its three starts (the library one is switched off and says why), the
// assessment page with its five numbered tabs, the Questions tab (the shared interview card), the specifications comparison, the excipient's own
// page with markers and the regulatory sentence, one open-items count that every page agrees on, deleting with a logged reason, and the phone
// layout (no sideways scroll, axe clean, light and dark). Fictional data only. The spec runs at the three widths of the config.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goTo, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Excipient test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

/** A new project, "Start blank" on the excipient page, and one excipient added by name. */
async function withExcipient(page: Page, name = "Excipient A (fictional)") {
  await newProject(page);
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await expect(page.getByTestId("ex-editor")).toBeVisible();
  await page.getByTestId("ex-add-name").fill(name);
  await page.getByTestId("ex-add-btn").click();
  await expect(page.getByTestId("ex-lines-table")).toContainText(name);
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, label).toBeLessThanOrEqual(0);
}

/** Answers the open text question of a fact on the excipient's own page with the shared card. */
async function answerFact(page: Page, key: string, value: string) {
  await page.getByTestId(`ex-edit-${key}`).click();
  await page.getByTestId("ex-edit-card").getByTestId("iv-input").fill(value);
  await page.getByTestId("ex-edit-card").getByTestId("iv-save").click();
  await expect(page.getByTestId(`ex-edit-${key}`)).toHaveText("Change");
}

test("the menu entry, and the list page with three starts: the library start is off and says why", async ({ page }) => {
  await newProject(page);
  await goTo(page, "Excipient assessment");
  await expect(page.getByRole("heading", { level: 1, name: "Excipient assessment" })).toBeVisible();
  await expect(page.getByTestId("ex-start-blank")).toBeEnabled();
  await expect(page.getByTestId("ex-start-questions")).toBeEnabled();
  await expect(page.getByTestId("ex-start-library")).toBeDisabled();
  await expect(page.getByTestId("ex-library-note")).toHaveText("The excipient library comes next");
  await expect(page.getByTestId("ex-empty-text")).toContainText("Anything you don't know stays open");
  await expect(page.getByText("No excipient assessment yet. Start one above.")).toBeVisible();
});

test("'Start blank' opens the Excipients tab, 'Answer questions' the Questions tab, with the five numbered tabs", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-questions").click();
  await expect(page.getByTestId("ex-empty")).toBeVisible();
  await expect(page.getByTestId("ex-empty-text")).toBeVisible();
  const tabs = page.getByTestId("ex-tabs");
  for (const t of ["1. Excipients", "2. Questions", "3. Specifications", "4. Open items", "5. Document"]) {
    await expect(tabs.getByRole("tab", { name: new RegExp(`^${t.replace(".", "\\.")}`) })).toBeVisible();
  }
  await expect(page.getByTestId("ex-tab-questions")).toHaveAttribute("aria-selected", "true");
  // the first excipient is added right in the empty state
  await page.getByTestId("ex-first-name").fill("Excipient A (fictional)");
  await page.getByTestId("ex-first-btn").click();
  await expect(page.getByTestId("ex-interview")).toBeVisible();
  await page.getByTestId("ex-tab-document").click();
  await expect(page.getByTestId("ex-document")).toContainText("The download comes later");
});

test("one open-items count: the pill, the tab, the list page and the project Open items page agree", async ({ page }) => {
  await withExcipient(page);
  const pill = (await page.getByTestId("ex-pill-open").innerText()).trim();
  const n = Number(/^(\d+) open items?$/.exec(pill)?.[1]);
  expect(n).toBeGreaterThan(0);
  await expect(page.getByTestId("ex-tab-open")).toContainText(`(${n})`);
  await page.getByTestId("ex-tab-open").click();
  await expect(page.getByTestId("ex-open-items").getByRole("heading", { level: 2 })).toHaveText(pill);
  await hash(page, "#/excipient");
  await expect(page.getByTestId("ex-list-open")).toHaveText(pill);
  await hash(page, "#/tbd");
  await expect(page.getByTestId("tbd-excipient-count")).toHaveText(pill);
});

test("Questions: an answer is saved, the count drops, and one question at a time moves with Next and Back", async ({ page }) => {
  await withExcipient(page);
  await page.getByTestId("ex-tab-questions").click();
  const progress = page.getByTestId("iv-progress");
  await expect(progress).toContainText("0 of");
  // the group heading is the excipient's name
  await expect(page.getByTestId("ex-interview").getByRole("heading", { level: 2, name: /Excipient A \(fictional\)/ })).toBeVisible();
  const first = page.getByTestId("iv-card-EXL-001/fact:supplier.sending");
  await first.getByTestId("iv-input").fill("Supplier A (fictional)");
  await first.getByTestId("iv-save").click();
  await expect(progress).toContainText("1 of");
  await expect(page.getByTestId("iv-open-count")).toContainText("open item");
  // one at a time
  await page.getByTestId("iv-one").check();
  await expect(page.getByTestId("iv-position")).toBeVisible();
  const before = await page.getByTestId("iv-position").innerText();
  await page.getByTestId("iv-next").click();
  await expect(page.getByTestId("iv-position")).not.toHaveText(before);
  await page.getByTestId("iv-back").click();
  await expect(page.getByTestId("iv-position")).toHaveText(before);
  await page.getByTestId("iv-to-list").click();
  await expect(page.getByTestId("ex-interview")).toBeVisible();
});

test("the excipient's own page: different suppliers raise the marker and the regulatory sentence; the links box shows what exists", async ({ page }) => {
  await withExcipient(page);
  await page.getByTestId("ex-line-link").click();
  await expect(page.getByTestId("ex-line-page")).toBeVisible();
  await expect(page.getByTestId("ex-markers")).toContainText("Nothing differs so far");
  // one count word, and single-value facts say "Both sites" instead of sitting under the sending site
  await expect(page.getByTestId("ex-line-pill-open")).toHaveText(/^[0-9]+ open items?$/);
  const impurities = page.getByTestId("ex-group-impurities");
  await expect(impurities.getByRole("columnheader", { name: "Both sites" })).toBeVisible();
  await expect(impurities.getByRole("columnheader", { name: "Sending site" })).toHaveCount(0);
  await expect(impurities.getByRole("button", { name: /both sites/i }).first()).toBeVisible();
  await expect(page.getByTestId("ex-regulatory")).toHaveCount(0);
  await answerFact(page, "EXL-001/fact:supplier.sending", "Supplier A (fictional)");
  await answerFact(page, "EXL-001/fact:supplier.receiving", "Supplier B (fictional)");
  await expect(page.getByTestId("ex-marker-different_supplier")).toContainText("Different supplier");
  await expect(page.getByTestId("ex-regulatory-sentence")).toHaveText("Requires regulatory affairs assessment");
  await expect(page.getByTestId("ex-links")).toContainText("Nothing is linked yet");
  // an unknown stays visible
  await expect(page.getByTestId("ex-group-origin")).toContainText("Not established");
  // the excipient table on tab 1 shows the marker as an icon plus words
  await page.getByTestId("ex-line-back").click();
  await expect(page.getByTestId("ex-lines-table")).toContainText("Different supplier");
});

test("at phone width the receiving-site Answer button of a per-site fact is on screen and the page does not scroll sideways", async ({ page }) => {
  await withExcipient(page);
  await page.getByTestId("ex-line-link").click();
  await expect(page.getByTestId("ex-line-page")).toBeVisible();
  const btn = page.getByTestId("ex-edit-EXL-001/fact:supplier.receiving");
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x + box!.width, "the button is inside the viewport").toBeLessThanOrEqual(width);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  if (width <= 700) expect(box!.height).toBeGreaterThanOrEqual(24);
  // a single-value fact also has its Answer button on screen
  const one = page.getByTestId("ex-edit-EXL-001/fact:nitrosamine");
  await one.scrollIntoViewIfNeeded();
  const b2 = await one.boundingBox();
  expect(b2!.x + b2!.width).toBeLessThanOrEqual(width);
});

test("Specifications: a test is added by hand, compared in words, and removed with a reason", async ({ page }) => {
  await withExcipient(page);
  await page.getByTestId("ex-tab-specs").click();
  await expect(page.getByTestId("ex-specs-counts")).toHaveText("No tests entered yet");
  await expect(page.getByTestId("ex-delete")).toHaveCount(0);
  await page.getByTestId("ex-spec-new").fill("Assay (fictional)");
  await page.getByTestId("ex-spec-add").click();
  await expect(page.getByTestId("ex-result-EXR-001")).toContainText("Not compared yet");
  await page.getByTestId("ex-criterion-EXR-001-sending").fill("98.0 to 102.0");
  await page.getByTestId("ex-criterion-EXR-001-receiving").fill("99.0 to 101.0");
  // leaving the box saves it (the note box takes the focus)
  await page.getByTestId("ex-row-note-EXR-001").click();
  await expect(page.getByTestId("ex-result-EXR-001")).toContainText("Different");
  await expect(page.getByTestId("ex-specs-counts")).toContainText("1 test compared");
  // a test the receiving site does not hold at all
  await page.getByTestId("ex-nottested-EXR-001-receiving").check();
  await expect(page.getByTestId("ex-result-EXR-001")).toContainText("Only");
  await page.getByTestId("ex-row-remove-EXR-001").click();
  await page.getByTestId("ex-row-remove-confirm").click();
  await expect(page.getByTestId("ex-row-remove-msg")).toBeVisible();
  await page.getByTestId("ex-row-remove-reason").fill("Entered by mistake (fictional)");
  await page.getByTestId("ex-row-remove-confirm").click();
  await expect(page.getByTestId("ex-specs-none")).toBeVisible();
});

test("deleting an assessment asks why and goes back to the list", async ({ page }) => {
  await withExcipient(page);
  await page.getByTestId("ex-delete").click();
  await expect(page.getByTestId("ex-delete-keep")).toBeFocused();
  await page.getByTestId("ex-delete-confirm").click();
  await expect(page.getByTestId("ex-delete-msg")).toBeVisible();
  await page.getByTestId("ex-delete-reason").fill("Started twice (fictional)");
  await page.getByTestId("ex-delete-confirm").click();
  await expect(page.getByTestId("ex-list")).toBeVisible();
  await expect(page.getByText("No excipient assessment yet. Start one above.")).toBeVisible();
});

for (const theme of ["Light", "Dark"] as const) {
  test(`every excipient page at this width, ${theme}: no sideways scroll, axe clean`, async ({ page }) => {
    await newProject(page);
    await setTheme(page, theme);
    await hash(page, "#/excipient");
    await expect(page.getByTestId("ex-list")).toBeVisible();
    await expectNoSidewaysScroll(page, "list, empty");
    await expectAccessible(page, `list, empty, ${theme}`);
    await page.getByTestId("ex-start-blank").click();
    await page.getByTestId("ex-add-name").fill("Excipient A (fictional)");
    await page.getByTestId("ex-add-btn").click();
    await expect(page.getByTestId("ex-lines-table")).toBeVisible();
    for (const tab of ["excipients", "questions", "specs", "open", "document"]) {
      await page.getByTestId(`ex-tab-${tab}`).click();
      await expectNoSidewaysScroll(page, `tab ${tab}`);
      await expectAccessible(page, `tab ${tab}, ${theme}`);
    }
    await page.getByTestId("ex-tab-specs").click();
    await page.getByTestId("ex-spec-new").fill("Assay (fictional)");
    await page.getByTestId("ex-spec-add").click();
    await expectNoSidewaysScroll(page, "specs with a row");
    await expectAccessible(page, `specs with a row, ${theme}`);
    await page.getByTestId("ex-tab-questions").click();
    await page.getByTestId("iv-one").check();
    await expectNoSidewaysScroll(page, "one at a time");
    await expectAccessible(page, `one at a time, ${theme}`);
    await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
    await expect(page.getByTestId("ex-line-page")).toBeVisible();
    await expectNoSidewaysScroll(page, "excipient page");
    await expectAccessible(page, `excipient page, ${theme}`);
    await page.getByTestId("ex-edit-EXL-001/fact:supplier.sending").click();
    await expectNoSidewaysScroll(page, "excipient page with a card");
    await expectAccessible(page, `excipient page with a card, ${theme}`);
  });
}
