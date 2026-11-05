// Stage-up S2: the stage dialog (reason required, one version per change, from all four editors), the stage review, the version history,
// read-only viewing, and the new pages' accessibility. Runs on desktop, tablet and phone; screenshots go to the temp folder.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, isPhone, openDemo, setTheme } from "./nav-helper";
import { dismissSummary, pickAndSave, STAGE_LABEL, type StageKey } from "./stage-helper";

const SHOTS = tmpdir();
const chip = (page: Page) => page.getByTestId("stage-chip");

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function axeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function noSideScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** A screenshot on the desktop (1366) and phone (390) projects only, with a -phone suffix on the phone, so parallel runs do not collide. */
async function shot(page: Page, name: string) {
  const phone = isPhone(page);
  if (!phone && (page.viewportSize()?.width ?? 0) < 1300) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `s2-${name}${phone ? "-phone" : ""}.png`) });
}

/** On an open dialog: choose a stage, go Next, press save with an empty reason (refused with an alert), then Back. Nothing is saved. */
async function emptyReasonRefused(page: Page, stage: StageKey) {
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await dialog.getByRole("radio", { name: new RegExp(STAGE_LABEL[stage].replace(/[()/]/g, "\\$&")) }).check();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: /^Save v[\d.]+ and change the stage/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Say why the project stage is changing");
  await dialog.getByRole("button", { name: "Back" }).click();
}

const rows = (page: Page) => page.getByTestId("version-table").locator("tbody tr");

test("the stage dialog: three steps, a reason is required, nothing is written before the last button", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await go(page, "#/versions");
  const before = await rows(page).count();

  await go(page, "#/");
  await chip(page).click();
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  // Step 1: the current stage is marked and cannot be chosen again; nothing is preselected; earlier stages are tagged.
  await expect(dialog.getByRole("radio", { name: /PPQ batches/ })).toBeDisabled();
  await expect(dialog.locator("input[type=radio]:checked")).toHaveCount(0);
  await expect(dialog.getByText("Current")).toBeVisible();
  await expect(dialog.getByText("Going back").first()).toBeVisible();
  await shot(page, "dialog-step1");
  await axeClean(page, "dialog step 1");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose one of the four stages");

  // Step 2: the reason. Empty is refused.
  await dialog.getByRole("radio", { name: /Clinical batches/ }).check();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByTestId("stage-preview")).toContainText("will be saved");
  await expect(dialog.getByTestId("stage-preview")).toContainText("Your own text is not changed or deleted.");
  await dialog.getByRole("button", { name: /^Save v[\d.]+ and change the stage/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Say why the project stage is changing");
  await shot(page, "dialog-step2");
  await axeClean(page, "dialog step 2");
  await noSideScroll(page, "dialog step 2");
  // Nothing was written yet: Cancel leaves the stage and the history as they were.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(chip(page)).toHaveText("Project stage: PPQ");
  await go(page, "#/versions");
  await expect(rows(page)).toHaveCount(before);

  // The reason goes through; the summary names the version, then Later leaves the review for later.
  await go(page, "#/");
  await chip(page).click();
  const summary = await pickAndSave(page, "clinical", "Fictional: clinical supply first");
  await expect(summary).toContainText(/Version v\d+ saved\. Project stage is now Clinical\./);
  await dismissSummary(page);
  await expect(chip(page)).toContainText("Project stage: Clinical");
  await go(page, "#/versions");
  await expect(rows(page).filter({ hasText: "Fictional: clinical supply first" })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: "PPQ to Clinical" })).toHaveCount(1);
});

test("all four editors use the same dialog, and a step back is allowed", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");

  // 1. Header chip, PPQ to Clinical.
  await chip(page).click();
  await emptyReasonRefused(page, "clinical");
  await pickAndSave(page, "clinical", "Fictional: from the chip");
  await dismissSummary(page);

  // 2. Home, Clinical to Development (a step back).
  await go(page, "#/");
  await page.getByTestId("stage-row").first().getByRole("button", { name: /Change project stage/ }).click();
  await emptyReasonRefused(page, "development");
  const back = await pickAndSave(page, "development", "Fictional: from Home");
  await expect(back).toContainText("Project stage is now");
  await dismissSummary(page);

  // 3. The interview question shows it read-only with a button.
  await go(page, "#/interview?q=site.stage%40target");
  const ru = page.getByTestId("interview-stage");
  await expect(ru.getByRole("radio")).toHaveCount(0);
  await ru.getByRole("button", { name: /Change project stage/ }).click();
  await pickAndSave(page, "ppq", "Fictional: from the interview");
  await dismissSummary(page);
  await expect(ru).toContainText("PPQ");

  // 4. The TRD form's Project stage detail.
  await goTo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-details").click();
  await page.getByTestId("trd-project-stage").getByRole("button", { name: /Change project stage/ }).click();
  await pickAndSave(page, "commercial", "Fictional: from the TRD form");
  await dismissSummary(page);
  await expect(chip(page)).toContainText("Project stage: Commercial");

  await go(page, "#/versions");
  for (const why of ["from the chip", "from Home", "from the interview", "from the TRD form"]) {
    await expect(rows(page).filter({ hasText: why })).toHaveCount(1);
  }
});

test("stage review: items, ticking, counts in three places, and the finished offer", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await chip(page).click();
  const summary = await pickAndSave(page, "clinical", "Fictional: review test");
  const start = summary.getByRole("button", { name: /^Start the stage review/ });
  await expect(start).toBeVisible();
  const total = Number((await start.innerText()).match(/\((\d+) item/)![1]);
  expect(total).toBeGreaterThan(0);
  await start.click();

  await expect(page).toHaveURL(/#\/stage-review/);
  await expect(page.getByRole("heading", { level: 1, name: "Stage review" })).toBeVisible();
  await expect(page.getByTestId("review-progress").first()).toHaveText(`${0} of ${total} reviewed`);
  // Nothing is ticked and there is no tick-all button.
  await expect(page.locator(".review-box:checked")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /tick all|all reviewed|mark all/i })).toHaveCount(0);
  await shot(page, "review");
  await axeClean(page, "stage review");
  await noSideScroll(page, "stage review");

  // The chip, Open items and the document carry the open count in words.
  await expect(chip(page)).toHaveAttribute("aria-label", new RegExp(`${total} to review`));
  await go(page, "#/tbd");
  const block = page.getByTestId("tbd-stage-review");
  await expect(block).toContainText(`${total}`);
  await shot(page, "tbd-block");
  await axeClean(page, "open items with the stage review block");
  await go(page, "#/document");
  await expect(page.locator("main")).toContainText("Stage review:");

  // Tick one: the count drops; un-tick: it comes back.
  await go(page, "#/stage-review");
  const first = page.locator(".review-box").first();
  await first.check();
  await expect(page.getByTestId("review-progress").first()).toHaveText(`1 of ${total} reviewed`);
  await first.uncheck();
  await expect(page.getByTestId("review-progress").first()).toHaveText(`0 of ${total} reviewed`);

  // Tick all, one by one: the offer to save a version appears and the chip no longer says "to review".
  const boxes = page.locator(".review-box");
  for (let i = 0; i < total; i++) await boxes.nth(i).check();
  await expect(page.getByTestId("review-progress").first()).toHaveText(`${total} of ${total} reviewed`);
  await expect(page.getByTestId("review-finished")).toContainText("Save a version with the review finished?");
  await expect(chip(page)).not.toHaveAttribute("aria-label", /to review/);
  await page.getByTestId("review-finished").getByRole("button", { name: "Save a version" }).click();
  const save = page.getByRole("dialog", { name: "Save a version" });
  await save.getByRole("button", { name: /^Save v[\d.]+/ }).click();
  await expect(save).toHaveCount(0);
  await expect(page.getByTestId("review-finished")).toHaveCount(0);
});

test("version history: save, open read-only, back, remove with a reason", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await chip(page).click();
  await pickAndSave(page, "clinical", "Fictional: history test");
  await dismissSummary(page);

  // The chip beside the stage chip opens the history.
  const vchip = page.getByTestId("version-chip");
  await expect(vchip).toBeVisible();
  await vchip.click();
  await expect(page).toHaveURL(/#\/versions/);
  await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
  await expect(page.getByTestId("working-copy-line")).toContainText("Working copy after");
  await shot(page, "history");
  await axeClean(page, "version history");
  await noSideScroll(page, "version history");

  // Save a smaller step.
  await page.getByTestId("save-version-button").first().click();
  const dlg = page.getByRole("dialog", { name: "Save a version" });
  await dlg.getByLabel(/What is this version for/).fill("Fictional: a note");
  await dlg.getByRole("button", { name: /^Save v[\d.]+/ }).click();
  await expect(rows(page).filter({ hasText: "Fictional: a note" })).toHaveCount(1);

  // Open the stage-change version read-only: banner on every page, the stage cannot be changed, saving is off.
  const stageRow = rows(page).filter({ hasText: "PPQ to Clinical" });
  await stageRow.getByRole("button", { name: /Open read-only/ }).click();
  const banner = page.getByTestId("version-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Read-only");
  await expect(banner).toHaveAttribute("role", "status");
  await shot(page, "viewing-banner");
  await axeClean(page, "viewing banner");
  await go(page, "#/scope");
  await expect(page.getByTestId("version-banner")).toBeVisible();
  await expect(chip(page)).toBeDisabled();
  await go(page, "#/versions");
  await expect(page.getByTestId("save-version-button").first()).toBeDisabled();

  // A reload goes back to the working copy.
  await page.reload();
  await expect(page.getByTestId("version-banner")).toHaveCount(0);
  await go(page, "#/versions");
  await stageRow.getByRole("button", { name: /Open read-only/ }).click();
  await banner.getByRole("button", { name: "Back to the working copy" }).click();
  await expect(banner).toHaveCount(0);

  // Remove any version, with a reason: the start version as well.
  await go(page, "#/versions");
  const note = rows(page).filter({ hasText: "Fictional: a note" });
  await note.getByRole("button", { name: /Remove/ }).click();
  const rm = page.getByRole("dialog", { name: /^Remove v/ });
  await rm.getByRole("button", { name: /^Remove v/ }).click();
  await expect(rm.getByRole("alert")).toBeVisible();
  await rm.getByLabel(/Why is v/).fill("Fictional: no longer needed");
  await rm.getByRole("button", { name: /^Remove v/ }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId("removed-versions")).toContainText("Fictional: no longer needed");
  const start = rows(page).filter({ hasText: "Start" });
  await start.getByRole("button", { name: /Remove/ }).click();
  const rm1 = page.getByRole("dialog", { name: /^Remove v/ });
  await rm1.getByLabel(/Why is v/).fill("Fictional: start copy not needed");
  await rm1.getByRole("button", { name: /^Remove v/ }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("removed-versions")).toContainText("Fictional: start copy not needed");
});

test("keyboard only: the stage dialog and a review tick, then dark mode on the new pages", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await chip(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await expect(dialog).toBeFocused();
  // Tab reaches the first enabled option; Space picks it; Enter submits the step.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(dialog.locator("input[type=radio]:checked")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel(/Why is the stage/)).toBeFocused();
  await page.keyboard.type("Fictional: keyboard");
  await page.keyboard.press("Tab"); // the reason box is a text area (Enter adds a line), so Tab reaches the save button
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stage-summary")).toBeVisible();
  await page.keyboard.press("Enter"); // the first button of the summary has focus: start the review
  await expect(page).toHaveURL(/#\/stage-review/);
  const box = page.locator(".review-box").first();
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();

  await setTheme(page, "Dark");
  for (const hash of ["#/stage-review", "#/versions", "#/tbd"]) {
    await go(page, hash);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axeClean(page, `dark ${hash}`);
    await noSideScroll(page, `dark ${hash}`);
  }
});

test("before any stage change: the empty review page and the history are plain and clean", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await go(page, "#/stage-review");
  await expect(page.getByTestId("review-none")).toBeVisible();
  await axeClean(page, "empty review");
  await go(page, "#/versions");
  await expect(page.getByTestId("version-table")).toBeVisible();
  // The Compare page belongs to a later step, so there is no Compare button yet.
  await expect(page.getByRole("button", { name: /^Compare/ })).toHaveCount(0);
});
