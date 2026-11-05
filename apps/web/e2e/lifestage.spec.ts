// Life stage, job L1: one project stage. The chip in the header, the chooser (four options, nothing preselected, a summary after a change),
// the Home row, the TRD form row and the interview question all show and set the same value; a migrated Commercial project gets a stage
// check. Runs on the desktop, tablet and phone projects; the screenshots go to the temp folder for the reviewer.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectNotice, goTo, isPhone, openDemo } from "./nav-helper";
import { chooseStage, dismissSummary, pickAndSave } from "./stage-helper";

const SHOTS = tmpdir();
const LABEL = {
  development: "Engineering / development runs",
  clinical: "Clinical batches (GMP, not process-validated)",
  ppq: "PPQ batches (process performance qualification)",
  commercial: "Commercial batches (process validated)",
};

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

/** Screenshots are only taken on the desktop project (and the phone one for the phone shot), so a parallel run does not overwrite them. */
async function shot(page: Page, name: string, only: "desktop" | "phone" = "desktop") {
  const phone = isPhone(page);
  if ((only === "phone") !== phone) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `l1-${name}.png`) });
}

const chip = (page: Page) => page.getByTestId("stage-chip");

async function newProject(page: Page) {
  await page.goto("./");
  await expectNotice(page);
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Stage test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

async function choose(page: Page, stage: keyof typeof LABEL) {
  await chooseStage(page, stage);
}

test("a new project: the chip says not set, the chooser preselects nothing and asks for a choice", async ({ page }) => {
  await newProject(page);
  await expect(chip(page)).toHaveText("Project stage: not set");
  await expect(page.getByTestId("stage-dot")).toHaveCount(0);

  await chip(page).click();
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await expect(dialog.locator("input[type=radio]:checked")).toHaveCount(0);
  // Not even a focus ring on the first option (it would look preselected): the dialog itself has focus, Tab reaches the options.
  await expect(dialog).toBeFocused();
  await expect(dialog.locator("input[type=radio]:focus")).toHaveCount(0);
  for (const label of Object.values(LABEL)) await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  await expect(dialog.getByTestId("stage-now")).toHaveText("Now: not set");
  await shot(page, "chooser");
  await axeClean(page, "chooser");

  // No choice: it says so instead of picking one.
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose one of the four stages");
  await expect(chip(page)).toHaveText("Project stage: not set");

  // Cancel changes nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page)).toHaveText("Project stage: not set");

  // The receiving-site question in the interview shows the project stage read-only (not set) with a button; the sending site keeps its four options.
  await go(page, "#/interview?q=site.stage%40target");
  await expect(page.locator("#q-prompt")).toHaveText("Which batches does each site make or plan to make?");
  const ru = page.getByTestId("interview-stage");
  await expect(ru).toContainText("Not set");
  await expect(ru.getByRole("button", { name: /Change project stage/ })).toBeVisible();
  await expect(ru.getByRole("radio")).toHaveCount(0);
  await expect(page.locator(".question-card input[type=radio]:checked")).toHaveCount(0);
});

test("one value: set it from the chip, see it in the interview, on Home and in a fresh export", async ({ page }) => {
  await newProject(page);
  await choose(page, "clinical");
  const summary = page.getByTestId("stage-summary");
  await expect(summary).toContainText("Project stage is now Clinical.");
  await expect(summary).toContainText("Your own text is not changed or deleted.");
  await shot(page, "summary");
  await axeClean(page, "summary");
  await dismissSummary(page);
  await expect(chip(page)).toHaveText("Project stage: Clinical");
  await shot(page, "chip-desktop");

  await go(page, "#/interview?q=site.stage%40target");
  await expect(page.getByTestId("interview-stage")).toContainText(LABEL.clinical);

  await go(page, "#/");
  const row = page.getByTestId("stage-row").first();
  await expect(row).toContainText(LABEL.clinical);
  await expect(page.getByTestId("stage-check-notice")).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  await shot(page, "home");
  await shot(page, "phone", "phone");
  await axeClean(page, "home with a stage");
  await noSideScroll(page, "home with a stage");

  // The same value is in a fresh export.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export project (JSON)" }).click()]);
  const exported = JSON.parse(readFileSync((await download.path()) as string, "utf8")) as { processes: { target: { site: { fields: { programStage: { value: string } } } } } };
  expect(exported.processes.target.site.fields.programStage.value).toBe("clinical");

  // The current stage cannot be chosen again: its option is off and marked Current (no empty version).
  await chip(page).click();
  const again = page.getByRole("dialog", { name: "Project stage" });
  await expect(again.getByRole("radio", { name: /Clinical batches/ })).toBeDisabled();
  await again.getByRole("button", { name: "Cancel" }).click();
});

test("the demo runs PPQ with no check; the TRD form and Home change the same value", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  await expect(chip(page)).toHaveText("Project stage: PPQ");
  await expect(page.getByTestId("stage-dot")).toHaveCount(0);
  await expect(page.getByTestId("stage-check-notice")).toHaveCount(0);
  await expect(page.locator("dl").filter({ hasText: "Sending-site stage" })).toContainText(LABEL.commercial);

  // The TRD form: a Project stage row (no second copy of the field in the list).
  await goTo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-details").click();
  const trdRow = page.getByTestId("trd-project-stage");
  await expect(trdRow).toContainText(LABEL.ppq);
  await expect(page.getByTestId("trd-field-details-programStage")).toHaveCount(0);
  await shot(page, "trd-form");
  await trdRow.getByRole("button", { name: /Change project stage/ }).click();
  await pickAndSave(page, "commercial", "Fictional: process validated");
  await dismissSummary(page);
  await expect(trdRow).toContainText(LABEL.commercial);
  await expect(chip(page)).toHaveText("Project stage: Commercial");
  await axeClean(page, "TRD form");
  await noSideScroll(page, "TRD form");
});

test("a saved Commercial project gets a stage check; choosing the stage again clears it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export project (JSON)" }).click()]);
  const raw = JSON.parse(readFileSync((await download.path()) as string, "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  // The project as a 1.28.0 build saved it: Commercial was the closest to PPQ that could be chosen.
  raw.schemaVersion = "1.28.0";
  raw.meta.title = "Saved before PPQ (fictional)";
  delete raw.meta.demo;
  raw.processes.target.site.fields.programStage.value = "commercial";
  const file = join(SHOTS, "l1-old-commercial.json");
  writeFileSync(file, JSON.stringify(raw));

  await page.getByLabel("Project JSON file to import").setInputFiles(file);
  await expect(chip(page)).toContainText("Project stage: Commercial");
  await expect(page.getByTestId("stage-dot")).toBeVisible();
  // The dot is never the only cue: the name says "needs a check", and Home has a notice in words.
  await expect(chip(page)).toHaveAttribute("aria-label", /needs a check/);
  await go(page, "#/");
  const notice = page.getByTestId("stage-check-notice");
  await expect(notice).toContainText("Check the project stage");
  await expect(notice).toContainText("saved as Commercial before PPQ could be chosen");
  await notice.scrollIntoViewIfNeeded();
  await shot(page, "stagecheck");
  await axeClean(page, "stage check on Home");
  await noSideScroll(page, "stage check on Home");

  // The document lists it as an open item.
  await go(page, "#/document");
  await expect(page.locator("main")).toContainText("Check the project stage");

  // Confirming Commercial clears the check; the dot and the notice go.
  await go(page, "#/");
  await chip(page).click();
  const confirmDialog = page.getByRole("dialog", { name: "Project stage" });
  await confirmDialog.getByRole("radio", { name: /Commercial batches/ }).check();
  await confirmDialog.getByRole("button", { name: "Confirm Commercial" }).click();
  await expect(page.getByTestId("stage-summary")).toContainText("The check is cleared");
  await dismissSummary(page);
  await expect(page.getByTestId("stage-dot")).toHaveCount(0);
  await expect(page.getByTestId("stage-check-notice")).toHaveCount(0);
});
