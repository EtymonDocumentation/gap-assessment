// M15 job 4: the "TRD follows your own template" feature finished. A visitor with no Word file adds the fictional sample template (Templates library, and a
// link in the start path), starts a TRD with it, matches the headings, sees the interview follow them and deletes the template again. The tour, the Help
// tips and the glossary name the feature, version compare shows a changed template choice and a changed match in one plain line each, and the
// leftovers are closed (no Back/Next bar on the start steps, a one-paragraph step 2, the missing-template notice, the group name, the omit line).
// Desktop, tablet and phone, axe on every changed screen, no sideways scroll. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPhone, openDemo } from "./nav-helper";
import { mkdir, writeFile } from "node:fs/promises";
import PizZip from "pizzip";
import { buildTemplate, downloadWord, HEADINGS } from "./word-template-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

/** First screen only (a long page is unreadable when it is shrunk to fit). The desktop (1366) and phone (390) ones are the ones to look at. */
const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `m15-job4-${name}-${test.info().project.name}.png`) });

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const SAMPLE = "Harbourlight SOP (fictional)";
const SAMPLE_BUTTON = "Add a sample template (fictional)";
const BOX = "What goes under this heading?";

/** A new, empty project (the library is empty too: every test starts in a fresh browser). */
async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Sample template (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

async function addSampleFromLibrary(page: Page) {
  await hash(page, "#/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByTestId("add-headings-sample").click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
}

/** Step 1 to the match screen with "A template's headings" and the sample, then confirm everything and go on to the interview. */
async function startWithSample(page: Page) {
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await page.getByTestId("start-kind-mapped").check();
  const value = await page.locator('[data-testid="start-template-select"] option', { hasText: SAMPLE }).first().getAttribute("value");
  await page.getByTestId("start-template-select").selectOption(value!);
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-match")).toBeVisible();
}

async function matchAndContinue(page: Page) {
  await page.getByTestId("trd-match-confirm-all").click();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

// ------------------------------------------------------------------ 1. the sample template

test("the sample template: added from an empty library, once only, used to start a TRD, followed by the interview, and deleted again", async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  await hash(page, "#/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  const button = page.getByTestId("add-headings-sample");
  await expect(button).toHaveText(SAMPLE_BUTTON);
  await expect(page.getByRole("heading", { level: 2, name: "Library (0)" })).toBeVisible();
  await expectAccessible(page, "Templates, empty library");
  await expectNoSidewaysScroll(page, "Templates, empty library");
  await shot(page, "templates-empty");

  await button.click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  await expect(page.getByText(SAMPLE).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "fictional" }).first()).toBeVisible();
  // A second press never makes a second copy: it says it is already there.
  await button.click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  await expect(page.getByText(/already in the library/).first()).toBeVisible();
  await expectAccessible(page, "Templates, with the sample");
  await expectNoSidewaysScroll(page, "Templates, with the sample");
  await shot(page, "templates-sample");

  // Nothing is preselected: the start path still asks, and the match is still confirmed by the person.
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await expect(page.getByTestId("start-step-template").getByRole("radio", { checked: true })).toHaveCount(0);
  await startWithSample(page);
  await expect(page.getByRole("heading", { level: 2, name: `Template headings (${HEADINGS.length})` })).toBeVisible();
  await expect(page.locator(".tag", { hasText: "Suggested" }).first()).toBeVisible();
  // The match screen has a Help tip.
  await page.getByRole("button", { name: "Help: matching your headings" }).click();
  await expect(page.getByRole("tooltip").or(page.getByRole("dialog")).or(page.getByRole("region")).filter({ hasText: "Suggested" }).first()).toBeVisible();
  await expectNoSidewaysScroll(page, "match with the tip open");
  await shot(page, "match-help-tip");
  await page.keyboard.press("Escape");
  await expectAccessible(page, "match step");
  await matchAndContinue(page);

  // The interview follows the template: its headings are the groups, the whole-document questions have their own, plainly named group.
  const titles = await page.locator('[id^="iv-g-"]').allInnerTexts();
  const text = titles.join(" | ");
  expect(text).toContain("Purpose and scope");
  expect(text).toContain("Distribution list");
  expect(text).toContain("Details of this TRD");
  expect(text).not.toContain("About this document");
  await expectAccessible(page, "interview");
  await expectNoSidewaysScroll(page, "interview");
  // A heading with no Cascade content is one writing box; a heading whose own text stays has no box.
  const group = page.getByTestId("iv-group-heading-4");
  await expect(group.getByRole("textbox", { name: BOX })).toBeVisible();
  await expect(page.getByTestId("iv-group-heading-6").getByTestId("iv-group-kept-text")).toBeVisible();

  // Delete it from the library: it asks first; the TRD keeps its answers and says the template is gone.
  await hash(page, "#/templates");
  await page.getByRole("button", { name: `Delete ${SAMPLE}` }).click();
  await expectAccessible(page, "delete dialog");
  // The reason is asked for: empty is refused in words and the template stays.
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByTestId("tpl-delete-msg")).toContainText("Write a short reason");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByTestId("tpl-delete-reason").fill("Fictional: not needed any more");
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText(`Template "${SAMPLE}" deleted.`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Library (0)" })).toBeVisible();
  // The reason is kept with a record of the removal (name, version, reason, time).
  const kept = await page.evaluate(
    () =>
      new Promise<Array<{ name: string; reason: string }>>((resolve, reject) => {
        const open = indexedDB.open("gap-templates-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction("removed").objectStore("removed").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(kept.map((k) => [k.name, k.reason])).toEqual([[SAMPLE, "Fictional: not needed any more"]]);
});

test("the start path offers the sample where it asks for a library template and the library has none", async ({ page }) => {
  test.setTimeout(180_000);
  await newProject(page);
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  const s1 = page.getByTestId("start-step-template");
  await s1.getByTestId("start-kind-mapped").check();
  const none = page.getByTestId("start-no-templates");
  await expect(none).toContainText("No template in the library works with");
  await expect(none.getByTestId("start-add-sample")).toHaveText(SAMPLE_BUTTON);
  await expectAccessible(page, "start step 1 with no template");
  await expectNoSidewaysScroll(page, "start step 1 with no template");
  await shot(page, "start-step1-no-template");
  await none.getByTestId("start-add-sample").click();
  // The library now has it; the list offers it, still not picked.
  await expect(page.getByTestId("start-no-templates")).toHaveCount(0);
  await expect(page.getByTestId("start-template-select")).toHaveValue("");
  await expect(page.locator('[data-testid="start-template-select"] option', { hasText: SAMPLE })).toHaveCount(1);
  // The other kinds that use a library template do not get the sample link (it is for headings only).
  await s1.getByTestId("start-kind-tags").check();
  await expect(page.getByTestId("start-add-sample")).toHaveCount(0);
});

// ------------------------------------------------------------------ 2. leftovers on the start steps

test("the start steps have no Back/Next document bar, step 2 has one short paragraph, and the choice has a Help tip", async ({ page }) => {
  test.setTimeout(180_000);
  await newProject(page);
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await expect(page.getByTestId("start-step-template")).toBeVisible();
  await expect(page.getByTestId("doc-chain-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Help: the Word template choice" }).click();
  await expect(page.getByText(/the questions then follow its headings/).first()).toBeVisible();
  await expectNoSidewaysScroll(page, "step 1 with the tip open");
  await shot(page, "start-step1-help-tip");
  await page.keyboard.press("Escape");
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();

  const s2 = page.getByTestId("start-step-steps");
  await expect(s2).toBeVisible();
  await expect(page.getByTestId("doc-chain-bar")).toHaveCount(0);
  await expect(s2.locator("> p")).toHaveCount(1);
  await expect(s2.locator("> p")).toContainText("Untick the steps this project does not have.");
  await expectAccessible(page, "start step 2");
  await expectNoSidewaysScroll(page, "start step 2");
  await shot(page, "start-step2");
  // Everything the bar offered is still on the page: the start path's own Back and Next.
  await expect(page.getByTestId("start-back").first()).toBeVisible();
  await expect(page.getByTestId("start-next").first()).toBeVisible();
});

test("a TRD whose template is gone says so on step 1, in words", async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  await addSampleFromLibrary(page);
  await startWithSample(page);
  await matchAndContinue(page);
  await hash(page, "#/templates");
  await page.getByRole("button", { name: `Delete ${SAMPLE}` }).click();
  await page.getByTestId("tpl-delete-reason").fill("Fictional: not needed any more");
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText(`Template "${SAMPLE}" deleted.`)).toBeVisible();
  await hash(page, "#/trd?trd=TRD-001&step=1");
  await expect(page.getByTestId("start-step-template")).toBeVisible();
  await expect(page.getByTestId("start-template-missing")).toContainText(`The template chosen for this TRD, "${SAMPLE}", is not in the library any more. Pick another one, or choose another option.`);
  await expectAccessible(page, "missing template notice");
  await expectNoSidewaysScroll(page, "missing template notice");
});

// ------------------------------------------------------------------ 3. tour, glossary

async function openHelp(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByText("Help", { exact: true }).scrollIntoViewIfNeeded();
  } else {
    await page.getByTestId("help-menu-button").click();
  }
}
const tourEntry = (page: Page) => (isPhone(page) ? page.getByRole("button", { name: "Tour of this page" }) : page.getByRole("menuitem", { name: "Tour of this page" }));

test("the TRD tour tells a first-time user about the template's headings, and the glossary explains the five words", async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  await hash(page, "#/trd");
  await expect(page.getByRole("heading", { level: 2, name: "New TRD" })).toBeVisible();
  await openHelp(page);
  await tourEntry(page).click();
  const bubble = page.getByTestId("tour-bubble");
  for (let i = 0; i < 8; i++) {
    const title = (await bubble.getByRole("heading").first().innerText()).trim();
    if (title === "Start a TRD") break;
    await bubble.getByRole("button", { name: /^(Next|Done)$/ }).click();
  }
  await expect(bubble.getByRole("heading").first()).toHaveText("Start a TRD");
  await expect(bubble).toContainText("A template's headings");
  await expect(bubble).toContainText("headings of your own Word file");
  await expectNoSidewaysScroll(page, "tour step");
  await shot(page, "tour-step");
  await page.keyboard.press("Escape");

  await hash(page, "#/glossary");
  const terms: Array<[string, string]> = [
    ["template-headings", "A template's headings"],
    ["match-your-headings", "Match your headings"],
    ["not-in-your-template", "Not in your template"],
    ["additional-content", "Additional content"],
    ["to-be-completed", "[To be completed.]"],
  ];
  for (const [id, term] of terms) {
    await expect(page.getByTestId(`term-${id}`)).toHaveText(term);
  }
  await page.getByTestId("glossary-filter").fill("headings");
  await expect(page.getByTestId("term-template-headings")).toBeVisible();
  await expectAccessible(page, "glossary");
  await expectNoSidewaysScroll(page, "glossary");
  await shot(page, "glossary");
});

// ------------------------------------------------------------------ 4. version compare, 5. omit line

test("version compare shows a changed template choice and a changed match in one plain line each, and the Document tab says what a ticked-off section leaves empty", async ({ page }) => {
  test.setTimeout(300_000);
  await newProject(page);
  await addSampleFromLibrary(page);
  await startWithSample(page);
  await matchAndContinue(page);

  // Save a version now: the template's headings are chosen, nothing is written under a heading yet.
  await hash(page, "#/versions");
  await page.getByTestId("save-version-button").first().click();
  const dlg = page.getByRole("dialog", { name: "Save a version" });
  await dlg.getByLabel(/What is this version for/).fill("Fictional: before the changes");
  await dlg.getByRole("button", { name: /^Save v[\d.]+/ }).click();
  await expect(dlg).toHaveCount(0);

  // Change the match (text under a heading) and the choice (Decide later).
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  const group = page.getByTestId("iv-group-heading-4");
  await group.getByRole("textbox", { name: BOX }).fill("Distribution: the sending and receiving sites (fictional).");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("Answered");
  await hash(page, "#/trd?trd=TRD-001&step=1");
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();

  await hash(page, "#/versions");
  await page.getByTestId("version-table").locator("tbody tr").filter({ hasText: "Fictional: before the changes" }).getByRole("link", { name: /^Compare/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  await page.getByTestId("compare-tabs").getByRole("tab", { name: /^TRD \d+$/ }).click();
  const rows = page.getByTestId("compare-row");
  const choice = rows.filter({ hasText: "Word template" });
  await expect(choice).toHaveCount(1);
  await expect(choice).toContainText("Changed");
  await expect(choice).toContainText(`A template's headings: ${SAMPLE}`);
  await expect(choice).toContainText("Decide later (still open)");
  const match = rows.filter({ hasText: "Heading match: 1 heading changed" });
  await expect(match).toHaveCount(1);
  await expect(match).toContainText("Changed");
  await expect(match).toContainText("1 heading with your own text");
  await expect(page.getByTestId("compare-left-out")).toContainText("is kept with the template in the library, not in a version, so it is not compared either");
  await expectAccessible(page, "compare");
  await expectNoSidewaysScroll(page, "compare");
  await shot(page, "compare");
  // The CSV has the same words.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const { readFileSync } = await import("node:fs");
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("Heading match: 1 heading changed");
  expect(csv).toContain(`A template's headings: ${SAMPLE}`);
});

test("the Document tab says which headings an unticked section leaves empty, without changing the open-item count", async ({ page }) => {
  test.setTimeout(300_000);
  // The demonstration project has process steps, so the "Process overview" section holds content that a heading can depend on.
  await page.goto("./");
  await openDemo(page, "arx");
  await addSampleFromLibrary(page);
  await startWithSample(page);
  await matchAndContinue(page);
  const trdId = new URL(page.url()).hash.match(/trd=([^&]+)/)![1]!;
  await hash(page, `#/trd?trd=${trdId}&tab=output`);
  await expect(page.getByTestId("trd-omit-empties")).toHaveCount(0);
  const change = page.getByRole("button", { name: "Change" });
  if ((await page.locator('input[data-testid^="trd-section-"]').first().isVisible()) === false && (await change.count()) > 0) await change.first().click();
  const boxes = page.locator('input[data-testid^="trd-section-"]');
  const n = await boxes.count();
  expect(n).toBeGreaterThan(0);
  const openTab = page.getByTestId("trd-open-count");
  const before = await openTab.innerText();
  for (let i = 0; i < n; i++) await boxes.nth(i).uncheck();
  // The line shows only when a heading's sole content is the unticked section. In this demo project the headings keep other content, so the line is
  // absent here; when it is there it must be the plain sentence, a status, and must not change the count. (The rule itself is a unit test: m15-job4-compare-and-help.)
  const line = page.getByTestId("trd-omit-empties");
  if ((await line.count()) > 0) {
    await expect(line).toContainText("Left empty by the sections you unticked:");
    await expect(line).toContainText('They say "[To be completed.]" in this download, and are not counted as open items');
    await expect(line).toHaveAttribute("role", "status");
  }
  // The open-items count of the document is the one from before: unticking a section never recounts.
  await expect(openTab).toHaveText(before);
  await expectAccessible(page, "Document tab with a section unticked");
  await expectNoSidewaysScroll(page, "Document tab with a section unticked");
});

// ------------------------------------------------------------------ 6. the Word files (samples for review)

test("the Word file made from the sample template follows its headings, and the template itself is kept as a sample", async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  await addSampleFromLibrary(page);
  await startWithSample(page);
  await matchAndContinue(page);
  await page.getByTestId("iv-group-heading-4").getByRole("textbox", { name: BOX }).fill("Distribution: the sending and receiving sites (fictional).");
  await page.getByTestId("iv-group-heading-4").getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByTestId("iv-group-heading-4")).toContainText("Answered");
  const trdId = new URL(page.url()).hash.match(/trd=([^&]+)/)![1]!;
  await hash(page, `#/trd?trd=${trdId}&tab=output`);
  const word = await downloadWord(page);
  const xml = new PizZip(word).file("word/document.xml")!.asText();
  const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // The template's headings, in its order; the text written under one heading; the open one says "[To be completed.]"; the kept text stays.
  let at = -1;
  for (const [h] of HEADINGS) {
    const next = text.indexOf(h, at + 1);
    expect(next, `"${h}" is in the Word file, after the one before`).toBeGreaterThan(at);
    at = next;
  }
  expect(text).toContain("Distribution: the sending and receiving sites (fictional).");
  expect(text).toContain("[To be completed.]");
  expect(text).toContain("Keep this paragraph as it is.");
  // Kept for review by a person (desktop run only, so the phone run does not write the same files again).
  if (test.info().project.name === "desktop") {
    const dir = join(tmpdir(), "gap-docx-samples", "m15-job4");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "sample-template-harbourlight-sop-fictional.docx"), buildTemplate());
    await writeFile(join(dir, "trd-from-sample-template.docx"), word);
  }
});
