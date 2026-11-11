// M15 job 3A: the TRD interview follows the headings of the user's own Word template. A fictional template (word-template-helper.ts) is added to the
// library; the start path has a fourth choice, "A template's headings", and a step "Match your headings" in the step bar; the interview then lists the
// questions under the template's headings, in the template's order. A heading Cascade has nothing for is one writing box that lands in the Word file.
// Pieces the template has no heading for are listed under "Not in your template" (Add / Remove with a reason). A missing template falls back to
// Cascade's own order with a notice, and the answers are kept. Desktop, tablet and phone, axe on the new screens, no sideways scroll at 390 and 360 px.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, openDemo } from "./nav-helper";
import { addTemplate, downloadWord, HEADINGS } from "./word-template-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

/** The whole page, and the part of it the person sees first (a long page is unreadable when it is shrunk to fit). */
async function shot(page: Page, name: string) {
  const base = join(tmpdir(), `m15-job3a-${name}-${test.info().project.name}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true });
  await page.screenshot({ path: `${base}-view.png` });
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

/** No sideways scroll at the current width and at the 360 px of a small phone. */
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

/** A new project with nothing answered, then the fictional template in the library. */
async function projectWithTemplate(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Headings interview (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await addTemplate(page);
}

/** The fictional template in the step 1 list. */
async function pickLibraryTemplate(page: Page) {
  const value = await page.locator('[data-testid="start-template-select"] option', { hasText: "Harbourlight SOP (fictional)" }).first().getAttribute("value");
  await page.getByTestId("start-template-select").selectOption(value!);
}

/** Step 1 to step 3 of the start path with "A template's headings", up to the match screen. */
async function toMatchStep(page: Page) {
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await page.getByTestId("start-kind-mapped").check();
  await pickLibraryTemplate(page);
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-match")).toBeVisible();
}

/** Confirm every suggestion and pick "Replace it" for each heading that has content (the template's own text is not kept), then go on. */
async function matchAndContinue(page: Page) {
  await page.getByTestId("trd-match-confirm-all").click();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

const groupTitles = async (page: Page) => {
  await expect(page.getByTestId("iv-group-heading-0")).toBeVisible();
  return page.locator('[id^="iv-g-"]').allInnerTexts();
};

/** The card (article) of one question, found by its prompt. */
const cardOf = (page: Page, prompt: string) => page.locator("article", { has: page.getByRole("heading", { level: 3, name: prompt }) });

const SENDING_SITE = "Which site is the sending site?";
const BOX = "What goes under this heading?";

/** Show every question, not only the open ones (a finished card would otherwise leave the list). */
async function showAll(page: Page) {
  await page.getByTestId("iv-show-all").check();
}

test("the start path has four choices; a template's headings adds a fourth step that matches them", async ({ page }) => {
  test.setTimeout(180_000);
  await projectWithTemplate(page);
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  const steps = page.getByTestId("start-path-steps");
  const s1 = page.getByTestId("start-step-template");

  // Step 1: four kinds (the same labels as the Document page) and Decide later. Nothing is chosen. The bar shows three steps until the headings are picked.
  await expect(s1.getByRole("radio")).toHaveCount(5);
  await expect(s1.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(s1.getByText("A template's headings", { exact: true })).toBeVisible();
  await expect(s1.getByRole("heading", { level: 2 })).toHaveText("Step 1 of 3: Pick the Word template");
  await shot(page, "start-step1");

  await s1.getByTestId("start-kind-mapped").check();
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(s1.getByRole("heading", { level: 2 })).toHaveText("Step 1 of 4: Pick the Word template");
  await expect(s1.getByTestId("start-template-select")).toBeVisible();
  await expectAccessible(page, "start step 1");
  await expectNoSidewaysScroll(page, "start step 1");

  // Picking it asks for a template. Continuing without one says so in words and stays.
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-path-say")).toContainText("Choose a template");
  await pickLibraryTemplate(page);
  await page.getByTestId("start-next").click();

  // Step 2, then step 3 is the match screen inside the bar.
  await expect(page.getByTestId("start-step-steps").getByRole("heading", { level: 2 })).toHaveText("Step 2 of 4: Which steps are in your process?");
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await page.getByTestId("start-next").click();
  const s3 = page.getByTestId("start-step-match");
  await expect(s3).toBeVisible();
  await expect(steps.locator("li.current")).toContainText("Match your headings");
  await expect(s3.getByRole("heading", { level: 2, name: /Step 3 of 4: Match your headings/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: `Template headings (${HEADINGS.length})` })).toBeVisible();
  await expectAccessible(page, "start step 3");
  await expectNoSidewaysScroll(page, "start step 3");
  await shot(page, "start-step3-match");

  // Held back exactly as Save is: after the suggestions are confirmed, a heading with content needs "Replace it" or "Keep it above".
  await page.getByTestId("trd-match-confirm-all").click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-match-error")).toContainText('Choose "Replace it" or "Keep it above Cascade\'s content" for:');
  await expect(page.getByTestId("start-step-match")).toBeVisible();

  // Back never loses a pick: step 2, then forward again, the confirmed suggestions are still confirmed.
  await page.getByTestId("start-back").last().click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-match")).toBeVisible();
  await expect(page.locator(".tag", { hasText: "Suggested" })).toHaveCount(0);
  await expect(page.getByTestId("trd-match-confirm-all")).toBeDisabled();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page).toHaveURL(/tab=interview/);
});

test("the interview lists the template's headings in order, says where an answer lands, and has one box for a heading Cascade has nothing for", async ({ page }) => {
  test.setTimeout(300_000);
  await projectWithTemplate(page);
  await toMatchStep(page);
  await matchAndContinue(page);
  await showAll(page);

  await expect(page.getByTestId("iv-heading-follow")).toContainText("The questions follow the headings of Harbourlight SOP (fictional)");
  const titles = await groupTitles(page);
  // The template's own headings come in the template's order.
  const own = HEADINGS.map(([h]) => titles.findIndex((t) => t.includes(h)));
  expect(own.every((i) => i >= 0), JSON.stringify(titles)).toBe(true);
  expect([...own].sort((a, b) => a - b)).toEqual(own);
  // The jump list names the same groups, and a button goes to one of them.
  const jump = page.getByTestId("iv-jump");
  await expect(jump.locator("summary")).toContainText("Jump to a heading");
  if (!(await jump.evaluate((el) => (el as HTMLDetailsElement).open))) await jump.locator("summary").click();
  await jump.getByTestId("iv-jump-heading-4").click();
  await expect(page.locator("#iv-g-heading-4")).toBeFocused();
  await expectNoSidewaysScroll(page, "interview with headings");
  await expectAccessible(page, "interview with headings");
  await shot(page, "interview-headings");

  // One answer says where it lands, in the template's words, and keeps the link to the document.
  const card = cardOf(page, SENDING_SITE);
  await expect(card.getByTestId("iv-lands")).toContainText("Lands under Process description (your template).");
  await expect(card.getByRole("link", { name: "See it in the document" })).toBeVisible();
  await card.getByRole("textbox", { name: SENDING_SITE }).fill("Harbourlight Fill Site (fictional)");
  await card.getByRole("button", { name: "Save answer" }).click();
  await expect(card).toContainText("Answered");
  await shot(page, "interview-lands");

  // A heading with no Cascade content is one card: one multi-line box, empty = open, saved like any other card.
  const group = page.getByTestId("iv-group-heading-4");
  await expect(group.getByRole("heading", { level: 2 })).toContainText("Distribution list");
  const box = group.getByRole("textbox", { name: BOX });
  await expect(group.getByTestId("iv-lands")).toContainText("Lands under Distribution list (your template).");
  await expect(group).toContainText("Open");
  await shot(page, "writing-box-empty");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("Write the text for this heading");
  await box.fill("Distribution: the sending and receiving sites (fictional).");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("Answered");
  await shot(page, "writing-box-filled");

  // It survives a reload.
  await page.reload();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await showAll(page);
  await expect(page.getByTestId("iv-group-heading-4").getByRole("textbox", { name: BOX })).toHaveValue("Distribution: the sending and receiving sites (fictional).");
  await expect(cardOf(page, SENDING_SITE).getByRole("textbox", { name: SENDING_SITE })).toHaveValue("Harbourlight Fill Site (fictional)");

  // The Word file has the text under its heading, between "Distribution list" and "Training records".
  await page.getByTestId("trd-tab-output").click();
  const xml = new PizZip(await downloadWord(page)).file("word/document.xml")!.asText();
  const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
  const at = text.indexOf("Distribution: the sending and receiving sites (fictional).");
  // The open-items list (job 3B) names the empty headings too, so the heading itself is the last place its title appears.
  expect(at).toBeGreaterThan(text.lastIndexOf("Distribution list"));
  expect(at).toBeLessThan(text.lastIndexOf("Training records"));
  expect(text).toContain("Harbourlight Fill Site (fictional)");

  // Taking the text away is a confirmed removal with a reason, never a silent save of an empty box. The box empties and the card is open again.
  await page.getByTestId("trd-tab-interview").click();
  await showAll(page);
  const again = page.getByTestId("iv-group-heading-4");
  await again.getByTestId("iv-remove-text").click();
  const dialog = page.getByTestId("iv-text-remove-dialog-confirm");
  await dialog.click();
  await expect(page.getByTestId("iv-text-remove-dialog-msg")).toContainText("Write a short reason");
  await page.getByTestId("iv-text-remove-dialog-reason").fill("The sites are listed elsewhere (fictional).");
  await dialog.click();
  await expect(again.getByRole("textbox", { name: BOX })).toHaveValue("");
  await expect(again).toContainText("Open");
});

test("pieces the template has no heading for are listed under Not in your template: Add, answer, Remove with a reason, and the answer is kept", async ({ page }) => {
  test.setTimeout(300_000);
  await projectWithTemplate(page);
  await toMatchStep(page);
  await matchAndContinue(page);
  await showAll(page);

  const nit = page.getByTestId("iv-not-in-template");
  await expect(page.getByTestId("iv-not-in-template-count")).toContainText(/Not in your template: \d+ sections of the TRD/);
  const row = nit.locator("li.iv-nit-item", { hasText: "Batch size" });
  await expect(row.getByRole("link", { name: "Place it under a heading: Batch size" })).toHaveAttribute("href", /trd-match\?trd=/);
  await expectNoSidewaysScroll(page, "not in your template");
  await shot(page, "not-in-template");

  // Add puts it at the end, under "Additional content", with the question asked there.
  await row.getByRole("button", { name: "Add at the end: Batch size" }).click();
  const added = page.getByTestId("iv-group-additional");
  await expect(added.getByRole("heading", { level: 2 })).toContainText("Additional content");
  await expect(added.getByTestId("iv-added-back")).toContainText("Batch size");
  await expect(nit.locator("li.iv-nit-item", { hasText: "Batch size" })).toHaveCount(0);
  const titles = await groupTitles(page);
  expect(titles[titles.length - 1]).toContain("Additional content");
  const batch = cardOf(page, "What is the batch size (mass, volume or number of units, with the unit)?");
  await expect(batch.getByTestId("iv-lands")).toContainText("Lands under Additional content (not in your template).");
  await batch.getByLabel("Value").first().fill("10");
  await batch.locator("select").first().selectOption("L");
  await batch.getByRole("button", { name: "Save answer" }).click();
  await expect(batch).toContainText("Answered");
  await expectAccessible(page, "interview with an added item");
  await shot(page, "not-in-template-added");

  // Remove asks why (an empty reason is said in words), then takes it out of the end. The answer is not deleted.
  await added.getByTestId("iv-added-remove").click();
  await page.getByTestId("iv-added-remove-dialog-confirm").click();
  await expect(page.getByTestId("iv-added-remove-dialog-msg")).toContainText("Write a short reason");
  await page.getByTestId("iv-added-remove-dialog-reason").fill("Not wanted in this Word file (fictional).");
  await page.getByTestId("iv-added-remove-dialog-confirm").click();
  await expect(page.getByTestId("iv-group-additional")).toHaveCount(0);
  await expect(nit.locator("li.iv-nit-item", { hasText: "Batch size" })).toContainText("1 question kept, not asked");
  await nit.locator("li.iv-nit-item", { hasText: "Batch size" }).getByRole("button", { name: "Add at the end: Batch size" }).click();
  await expect(batch.getByLabel("Value").first()).toHaveValue("10");
  await expect(batch).toContainText("Answered");
});

test("when the template is not in the library any more the interview is in Cascade's own order, says so, and keeps the answers", async ({ page }) => {
  test.setTimeout(300_000);
  await projectWithTemplate(page);
  await toMatchStep(page);
  await matchAndContinue(page);
  await showAll(page);
  const card = cardOf(page, SENDING_SITE);
  await card.getByRole("textbox", { name: SENDING_SITE }).fill("Harbourlight Fill Site (fictional)");
  await card.getByRole("button", { name: "Save answer" }).click();
  await expect(card).toContainText("Answered");

  await hash(page, "#/templates");
  await page.getByRole("button", { name: "Delete Harbourlight SOP (fictional)" }).click();
  await page.getByTestId("tpl-delete-reason").fill("Fictional: not needed any more");
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText('Template "Harbourlight SOP (fictional)" deleted.')).toBeVisible();

  await hash(page, "#/trd?trd=TRD-001&tab=interview&show=all");
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  const notice = page.getByTestId("iv-heading-missing");
  await expect(notice).toContainText("is not in the library any more, so the questions are in Cascade's own order. Your answers are kept.");
  await expect(page.getByTestId("iv-group-heading-0")).toHaveCount(0);
  await expect(page.getByTestId("iv-not-in-template")).toHaveCount(0);
  await expect(cardOf(page, SENDING_SITE).getByRole("textbox", { name: SENDING_SITE })).toHaveValue("Harbourlight Fill Site (fictional)");
  // Cascade's own wording of where it lands is back.
  await expect(cardOf(page, SENDING_SITE).getByTestId("iv-lands")).toContainText("Lands in section");
  await expectNoSidewaysScroll(page, "fallback notice");
  await expectAccessible(page, "fallback notice");
  await shot(page, "fallback-notice");
});

test("a TRD that already exists follows the headings once its Document tab says so, and asks for the match when there is none", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await addTemplate(page);
  await goTo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
  await page.getByRole("radio", { name: /A template's headings/ }).check();
  const value = await page.locator("select option", { hasText: "Harbourlight SOP (fictional)" }).first().getAttribute("value");
  await page.getByRole("combobox", { name: "Template", exact: true }).selectOption(value!);
  await expect(page.getByText("This template has no match for the TRD yet.")).toBeVisible();

  // No match yet: Cascade's own order, one plain line and a button to the match screen.
  await page.getByTestId("trd-tab-interview").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  const none = page.getByTestId("iv-heading-no-match");
  await expect(none).toContainText("Match your template's headings and the questions will follow them.");
  await expect(page.getByTestId("iv-group-heading-0")).toHaveCount(0);
  await expectAccessible(page, "interview, no match");
  await shot(page, "no-match-notice");
  await none.getByTestId("iv-heading-match-button").click();
  await expect(page.getByRole("heading", { level: 1, name: "Match your headings" })).toBeVisible();
  await page.getByTestId("trd-match-confirm-all").click();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("trd-match-save").click();
  await expect(page.getByTestId("trd-match-status")).toContainText(/saved/i);

  // Back on the TRD, the interview follows the headings (the match is stored with the template, the choice with the TRD).
  await page.getByRole("link", { name: /Back to the TRD/ }).click();
  await page.getByTestId("trd-tab-interview").click();
  await expect(page.getByTestId("iv-heading-follow")).toContainText("The questions follow the headings of Harbourlight SOP (fictional)");
  await showAll(page);
  const titles = await groupTitles(page);
  const own = HEADINGS.map(([h]) => titles.findIndex((t) => t.includes(h)));
  expect(own.every((i) => i >= 0), JSON.stringify(titles)).toBe(true);
  expect([...own].sort((a, b) => a - b)).toEqual(own);
  await expectNoSidewaysScroll(page, "demo TRD with headings");
  await shot(page, "demo-headings");
});
