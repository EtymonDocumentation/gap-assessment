// M15 job 1: the "template first" start path of the TRD. Home shows the four documents openly; a new TRD goes through three numbered steps (pick the Word template,
// say which process steps are in the project, answer the questions) with Back; the interview follows the checklist (a left-out step gets no questions and is listed,
// its answers are kept); the Word template choice is stored on the TRD and can be removed with a reason; each question says where its answer lands in the document.
// Desktop, tablet and phone, axe on each screen, no sideways scroll. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `m15-job1-${name}-${test.info().project.name}.png`), fullPage: true });

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

/** Home with no project: "Start a TRD", the project name form, then step 1 of the start path. */
async function startFromHome(page: Page) {
  await page.goto("./");
  await page.getByTestId("start-doc-trd").click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Template first (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("start-step-template")).toBeVisible();
}

const card = (page: Page, key: string) => page.getByTestId(`iv-card-${key}`);

test("Home shows the four documents openly, each with one line and a real button", async ({ page }) => {
  await page.goto("./");
  const group = page.getByTestId("start-documents");
  await expect(group.getByRole("heading", { level: 3, name: "What do you want to make?" })).toBeVisible();
  await expect(group.getByRole("heading", { level: 4 })).toHaveText(["Gap assessment", "Technology transfer document (TRD)", "Sampling plan", "Batch record (MBR)"]);
  await expect(group.getByRole("button", { name: "Start a new project" })).toBeVisible();
  for (const [id, name] of [["trd", "Start a TRD"], ["sampling", "Start a sampling plan"], ["mbr", "Start a batch record"]] as const) {
    await expect(group.getByTestId(`start-doc-${id}`)).toHaveText(name);
  }
  // The fold is still closed: only the demos and the uploads are in it.
  await expect(page.getByTestId("more-ways")).not.toHaveAttribute("open", "");
  await expectNoSidewaysScroll(page, "home");
  await expectAccessible(page, "home");
  await shot(page, "home");
});

test("a new TRD goes through three steps: Word template, process steps, questions. Nothing is chosen for the person, and Back works", async ({ page }) => {
  await startFromHome(page);
  await expect(page).toHaveURL(/#\/trd\?step=1$/);
  const steps = page.getByTestId("start-path-steps");
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps.locator("li.current")).toContainText("Pick the Word template");

  // Step 1: the three kinds of the download panel and Decide later, none chosen, and a link to add a template.
  const s1 = page.getByTestId("start-step-template");
  await expect(s1.getByRole("heading", { level: 2 })).toHaveText("Step 1 of 3: Pick the Word template");
  await expect(s1.getByRole("radio")).toHaveCount(5); // the four kinds of Word document (the same as the Document page) and "Decide later"
  await expect(s1.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByTestId("start-add-template")).toHaveAttribute("href", "#/templates");
  await expectAccessible(page, "step 1");
  await expectNoSidewaysScroll(page, "step 1");
  await shot(page, "step1");

  // Continue with nothing picked: a plain sentence, no move.
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-path-say")).toContainText("Pick one of the options");
  await expect(page).toHaveURL(/step=1$/);
  // A kind that uses a library template, with none in the library: said in words, with the way to add one.
  await page.getByTestId("start-kind-their_look").check();
  await expect(page.getByTestId("start-no-templates")).toContainText("No template in the library works with");
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-path-say")).toContainText("Choose a template");
  await page.getByTestId("start-kind-later").check();
  await expect(page.getByTestId("start-no-templates")).toHaveCount(0);
  await page.getByTestId("start-next").click();

  // Step 2: the same checklist as the Scope step, nothing second.
  await expect(page).toHaveURL(/#\/trd\?trd=[^&]+&step=2$/);
  const s2 = page.getByTestId("start-step-steps");
  await expect(s2.getByRole("heading", { level: 2 })).toHaveText("Step 2 of 3: Which steps are in your process?");
  await expect(page.getByTestId("trd-start-steps")).toBeVisible();
  await expect(steps.locator("li.current")).toContainText("Which steps are in your process?");
  await expectAccessible(page, "step 2");
  await expectNoSidewaysScroll(page, "step 2");
  await shot(page, "step2");

  // Back keeps the choice: Decide later is still the one picked.
  await page.getByTestId("start-back").click();
  await expect(page.getByTestId("start-kind-later")).toBeChecked();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();

  // Step 3: the interview, with the first question on screen. It says where the answer lands in the document.
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page).toHaveURL(/tab=interview/);
  await expect(page.getByTestId("iv-left-out")).toContainText("Every step of your process is in this interview.");
  // A ticked step is performed: no "is it performed?" question.
  await expect(page.locator('[data-testid^="iv-card-presence"]')).toHaveCount(0);
  const lands = page.getByTestId("iv-lands").first();
  await expect(lands).toContainText("Lands in section", { timeout: 20_000 });
  await expect(lands.getByRole("link", { name: "See it in the document" })).toBeVisible();
  await expectAccessible(page, "interview");
  await expectNoSidewaysScroll(page, "interview");
  await shot(page, "step3-question");
});

test("a step left out gets no questions and is listed with its reason; its answers are kept and come back when it is ticked again", async ({ page }) => {
  await startFromHome(page);
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-step-visual_inspection")).toBeVisible({ timeout: 20_000 });
  // Answer one question of the visual inspection step, so there is something to keep.
  const firstId = await page.getByTestId("iv-step-visual_inspection").locator('[data-testid^="iv-card-"]').first().getAttribute("data-testid");
  const first = page.getByTestId(firstId!);
  const typed = first.getByTestId("iv-input");
  await expect(typed).toBeVisible();
  const kind = await typed.evaluate((el) => el.tagName);
  const keepsAnswer = kind === "INPUT" || kind === "TEXTAREA";
  if (keepsAnswer) {
    await typed.fill("12");
    await first.getByTestId("iv-save").click();
    await expect(first.getByTestId("iv-saved")).toBeVisible();
  }
  // Leave visual inspection out, with a reason, from the same checklist.
  await page.getByTestId("iv-change-steps").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await page.locator("#trd-start-step-visual_inspection").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Inspected at another site (fictional)");
  await dialog.getByRole("button", { name: "Leave out" }).click();
  await shot(page, "step2-left-out");
  await page.getByTestId("start-next").click();

  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-step-visual_inspection")).toHaveCount(0);
  await expect(page.getByTestId("iv-left-out-line")).toContainText("Left out of this project:");
  await expect(page.getByTestId("iv-left-out-line")).toContainText("Inspected at another site (fictional)");
  if (keepsAnswer) await expect(page.getByTestId("iv-left-out-kept")).toContainText("Answers you already gave for a left-out step are kept");
  await expectAccessible(page, "interview with a step left out");
  await expectNoSidewaysScroll(page, "interview with a step left out");
  await shot(page, "left-out");

  // Tick it again: the questions come back.
  await page.getByTestId("iv-change-steps").click();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await page.locator("#trd-start-step-visual_inspection").click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("iv-step-visual_inspection")).toBeVisible();
  if (keepsAnswer) await expect(page.getByTestId("iv-step-visual_inspection").getByTestId("iv-step-count")).toContainText(/^1 of \d+ answered/);
});

test("the Word template choice is stored on the TRD, shown on the Document tab, and can be removed with a reason", async ({ page }) => {
  await startFromHome(page);
  await page.getByTestId("start-kind-builtin").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
  await expect(page.getByTestId("trd-template-choice-text")).toHaveText("Built-in default");
  // The download panel starts on the stored choice.
  await expect(page.getByRole("radio", { name: /Built-in/ }).first()).toBeChecked();
  await expectAccessible(page, "document tab with a stored choice");
  await expectNoSidewaysScroll(page, "document tab with a stored choice");
  await page.getByTestId("trd-template-remove").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("trd-template-remove-dialog-reason").fill("Picked the wrong one (fictional)");
  await dialog.getByRole("button", { name: "Remove the choice" }).click();
  await expect(page.getByTestId("trd-template-choice-text")).toHaveText("Not chosen yet");
  await expect(page.getByTestId("trd-template-remove")).toHaveCount(0);
});

test("'See it in the document' opens the Document tab at the section the answer lands in", async ({ page }) => {
  await startFromHome(page);
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  const link = page.getByTestId("iv-see-in-document").first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const where = await link.getAttribute("href");
  expect(where).toMatch(/tab=output&section=/);
  await link.click();
  await expect(page.getByTestId("trd-preview")).toBeVisible();
  const section = new URLSearchParams(where!.split("?")[1]).get("section")!;
  await expect(page.locator(`[id="doc-${section}"]`)).toBeVisible();
});

test("a TRD that is already there is opened where it was: Home goes straight to it, 'Answer questions' starts another one", async ({ page }) => {
  await startFromHome(page);
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await page.goto("./#/");
  await page.getByTestId("start-doc-trd").click();
  await expect(page).toHaveURL(/#\/trd\?trd=[^&]+&tab=interview$/);
  await page.evaluate(() => (window.location.hash = "#/trd"));
  await page.getByTestId("trd-interview-btn").click();
  await expect(page).toHaveURL(/#\/trd\?step=1$/);
});

test("Home's next step for a project with a TRD and no gap work goes to the TRD questions", async ({ page }) => {
  await startFromHome(page);
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await page.goto("./#/");
  const next = page.getByTestId("next-step").getByRole("link").first();
  await expect(next).toHaveText(/^Answer \d+ more questions?$/);
  await expect(next).toHaveAttribute("href", /#\/trd\?trd=[^&]+&tab=interview$/);
});