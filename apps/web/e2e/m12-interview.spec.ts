// M12 job 2: the TRD interview screens (the Interview tab of the TRD page). A person with no finished TRD and no gap assessment answers plain
// questions, in a list or one at a time, and the SAME TRD fills in. Checked here: the start, list mode, the three exits, the limits card, one
// question at a time (Back / Next / Skip / end screen), a project value (Keep / Change), "only what is still open" after an upload, resume after
// a reload, the phone layout (no sideways scroll, the sticky bar never covers the focused box), keyboard use and axe at three widths. Fictional data.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { goTo, openDemo, setTheme } from "./nav-helper";

const SHOTS = tmpdir();
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const card = (page: Page, key: string) => page.getByTestId(`iv-card-${key}`);

/** A new project with no gap answers at all, then the TRD page. */
async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Interview test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await hash(page, "#/trd");
}

/** "Answer questions" on the TRD page: one click makes a blank TRD (named after the project) and lands on its Interview tab. No form, no title to type. */
async function startInterview(page: Page) {
  await newProject(page);
  await page.getByTestId("trd-interview-btn").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function openDemoInterview(page: Page, show?: "all" | "open" | "confirm") {
  await loadDemo(page);
  await hash(page, `#/trd?trd=TRD-001&tab=interview${show ? `&show=${show}` : ""}`);
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: the page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `m12-j2-${name}-${test.info().project.name}.png`), fullPage: true });
const progressNumbers = async (page: Page) => {
  const m = /^(\d+) of (\d+) answered, (\d+) left open/.exec((await page.getByTestId("iv-progress").textContent()) ?? "");
  expect(m, "the progress banner").not.toBeNull();
  return { answered: Number(m![1]), total: Number(m![2]), open: Number(m![3]) };
};

async function downloadOf(page: Page, click: () => Promise<void>): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click()])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** Puts a value into the content control with this tag, the way Word does when a person types into it. */
function fillControl(bytes: Buffer, tag: string, text: string): Buffer {
  const zip = new PizZip(bytes);
  const xml = zip.file("word/document.xml")!.asText();
  const start = xml.indexOf(`<w:tag w:val="${tag}"/>`);
  expect(start, `control ${tag}`).toBeGreaterThan(0);
  const open = xml.lastIndexOf("<w:sdt>", start);
  const end = xml.indexOf("</w:sdt>", start) + "</w:sdt>".length;
  const filled = xml.slice(open, end).replace("<w:showingPlcHdr/>", "").replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent>`);
  zip.file("word/document.xml", xml.slice(0, open) + filled + xml.slice(end));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// ------------------------------------------------------------------ the start and the empty state

test("'Answer questions' starts a blank TRD on the Interview tab, with no gap assessment, and shows the empty state", async ({ page }) => {
  await startInterview(page);
  await expect(page).toHaveURL(/tab=interview/);
  // An empty TRD has the Interview tab first, selected.
  const first = page.getByTestId("trd-tabs").getByRole("tab").first();
  await expect(first).toHaveText("Interview");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("iv-empty")).toContainText("Answer a few questions and the TRD fills itself in. Anything you don't know stays open.");
  for (const id of ["iv-empty-first", "iv-empty-one"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("iv-empty-open")).toHaveCount(0);
  // Nothing is pre-filled, and the project stage is asked for without being chosen.
  const n = await progressNumbers(page);
  // Only the title (made from the project's title when the TRD is started) is an answer so far.
  expect(n.answered).toBe(1);
  await expect(page.getByTestId("iv-stage-prompt")).toContainText("Set the project stage to get questions that fit");
  await expect(card(page, "doc:purpose").getByTestId("iv-input")).toHaveValue("");
  await expect(card(page, "detail:modality").getByTestId("iv-status")).toContainText("Open");
  await expectAccessible(page, "empty state");
  await expectNoSidewaysScroll(page, "empty state");
  await shot(page, "empty-state");
  // The existing tabs keep their numbers and test ids.
  for (const [id, label] of [["details", "1. Details"], ["process", "2. Process"], ["writeups", "3. Descriptions"], ["open", /^4\. Open items/], ["output", "5. Document"]] as const) {
    await expect(page.getByTestId(`trd-tab-${id}`)).toContainText(label);
  }
  // The first-step button puts the cursor on the first question.
  await page.getByTestId("iv-empty-first").click();
  await expect(card(page, "doc:title").getByTestId("iv-prompt")).toBeFocused();
});

test("a TRD that already holds values puts the Interview tab after '1. Details' and opens on what is still open", async ({ page }) => {
  await openDemoInterview(page);
  const labels = await page.getByTestId("trd-tabs").getByRole("tab").allTextContents();
  expect(labels[0]).toBe("1. Details");
  expect(labels[1]).toBe("Interview");
  await expect(page.getByTestId("iv-show-open")).toBeChecked();
  await expect(page.getByTestId("iv-filters")).toContainText("Only what is still open");
});

// ------------------------------------------------------------------ list mode

test("list mode: an answer is saved with the button, shows in the Details tab, and the reason is linked to the box", async ({ page }) => {
  await startInterview(page);
  const purpose = card(page, "doc:purpose");
  const box = purpose.getByTestId("iv-input");
  // The reason is always visible beside the question and linked with aria-describedby; the box is labelled by the question.
  await expect(purpose.getByTestId("iv-why")).toContainText("Why we ask:");
  const describedBy = (await box.getAttribute("aria-describedby")) ?? "";
  const whyId = await purpose.getByTestId("iv-why").getAttribute("id");
  expect(describedBy.split(" ")).toContain(whyId);
  await expect(box).toHaveAccessibleName(/why is this transfer being done/);
  await box.fill("Move filling to the receiving unit (fictional).");
  await purpose.getByTestId("iv-save").click();
  await expect(purpose.getByTestId("iv-saved")).toBeVisible();
  await expect(page.getByTestId("iv-live")).toContainText("Saved");
  await expect(purpose.getByTestId("iv-status")).toContainText("Answered");
  expect((await progressNumbers(page)).answered).toBe(2);
  // The same TRD: the Details tab shows it.
  await page.getByTestId("trd-tab-details").click();
  await expect(page.getByTestId("trd-details-summary")).toContainText("Move filling to the receiving unit (fictional).");
});

test("list mode: saying a step is performed adds its questions, and the limits card checks without blocking", async ({ page }) => {
  await startInterview(page);
  const presence = card(page, "step:sterile_filtration.presence");
  // Yes / No start on neither.
  await expect(presence.getByTestId("iv-option-yes")).not.toBeChecked();
  await expect(presence.getByTestId("iv-option-no")).not.toBeChecked();
  await presence.getByTestId("iv-save").click();
  await expect(presence.getByTestId("iv-error")).toContainText("Please choose Yes or No");
  await presence.getByTestId("iv-option-yes").check();
  await presence.getByTestId("iv-save").click();
  await expect(presence.getByTestId("iv-saved")).toBeVisible();
  const step = page.getByTestId("iv-step-sterile_filtration");
  await expect(step.locator('[data-testid^="iv-card-limits:"]').first()).toBeVisible();
  const limits = step.locator('[data-testid^="iv-card-limits:"]').first();
  // Three small labelled groups, nothing in them.
  for (const p of ["setPoint", "nor", "par"]) await expect(limits.getByTestId(`iv-limit-${p}`)).toBeVisible();
  await expect(limits.getByTestId("iv-par-min")).toHaveValue("");
  // Text that is not a number is refused beside the question, in words, and stays in the box.
  await limits.getByTestId("iv-setPoint-value").fill("abc");
  await limits.getByTestId("iv-save").click();
  await expect(limits.getByTestId("iv-error")).toContainText("as a number");
  await expect(limits.getByTestId("iv-error")).toHaveAttribute("role", "alert");
  await expect(limits.getByTestId("iv-setPoint-value")).toHaveValue("abc");
  await limits.getByTestId("iv-setPoint-value").fill("");
  await limits.getByTestId("iv-par-min").fill("8");
  await limits.getByTestId("iv-par-max").fill("12");
  // The form's own check speaks as the person types, and never blocks the save.
  await expect(limits.getByTestId("iv-limits-findings")).toContainText(/Check:|Open item:|Note:/);
  await limits.getByTestId("iv-save").click();
  await expect(limits.getByTestId("iv-saved")).toBeVisible();
  await limits.scrollIntoViewIfNeeded();
  await shot(page, "limits-card");
  await expectAccessible(page, "list mode with a limits card");
  // The Process tab holds it: the TRD itself changed.
  await page.getByTestId("trd-tab-process").click();
  await page.getByTestId("trd-steps-open-all").click();
  await expect(page.getByTestId("trd-tabs")).toContainText("8");
});

test("the three exits: Don't know yet writes nothing, Not applicable here and TBD are recorded", async ({ page }) => {
  await startInterview(page);
  const openCount = async () => (await page.getByTestId("trd-pill-open").textContent())?.trim();
  const before = await openCount();
  const base = (await progressNumbers(page)).answered;
  const version = card(page, "doc:version");
  await version.getByTestId("iv-dontknow").click();
  await expect(version.getByTestId("iv-note")).toContainText("Left open");
  await expect(version.getByTestId("iv-status")).toContainText("Open");
  expect(await openCount()).toBe(before);
  expect((await progressNumbers(page)).answered).toBe(base);

  const site = card(page, "detail:site");
  await site.getByTestId("iv-tbd").click();
  await site.getByTestId("iv-tbd-owner").fill("Site lead (fictional)");
  await site.getByTestId("iv-tbd-due").fill("2026-12-15");
  await site.getByTestId("iv-exit-save").click();
  await expect(site.getByTestId("iv-saved")).toBeVisible();
  await expect(site.getByTestId("iv-status")).toContainText("To be decided (TBD)");

  const presentation = card(page, "detail:presentation");
  await presentation.getByTestId("iv-na").click();
  await presentation.getByTestId("iv-na-reason").fill("Not part of this transfer (fictional).");
  await presentation.getByTestId("iv-exit-save").click();
  await expect(presentation.getByTestId("iv-status")).toContainText("Not applicable here");
  // Not applicable is an answer; a TBD is not.
  expect((await progressNumbers(page)).answered).toBe(base + 1);
  // The same exits are in the same place on every question that can use them.
  await expect(card(page, "detail:modality").getByRole("group", { name: "If you cannot answer" })).toBeVisible();
});

test("filters, search and More detail narrow the list; the answered card stays until the view changes", async ({ page }) => {
  await startInterview(page);
  const all = (await progressNumbers(page)).total;
  await page.getByTestId("iv-search").fill("modality");
  await expect(card(page, "detail:modality")).toBeVisible();
  await expect(card(page, "doc:title")).toHaveCount(0);
  await page.getByTestId("iv-search").fill("");
  await page.getByTestId("iv-show-confirm").check();
  await expect(page.getByTestId("iv-none")).toBeVisible();
  await page.getByTestId("iv-show-open").check();
  await expect(card(page, "doc:purpose")).toBeVisible();
  // Answering under "Only what is still open" does not make the card vanish under the person.
  await card(page, "doc:purpose").getByTestId("iv-input").fill("A purpose (fictional)");
  await card(page, "doc:purpose").getByTestId("iv-save").click();
  await expect(card(page, "doc:purpose")).toBeVisible();
  await page.getByTestId("iv-more").check();
  expect((await progressNumbers(page)).total).toBeGreaterThanOrEqual(all);
  await expectNoSidewaysScroll(page, "list with More detail");
});

// ------------------------------------------------------------------ one question at a time

test("one question at a time: Back and Next, the heading takes the focus, Don't know yet and Skip move on, the end screen links", async ({ page }) => {
  await startInterview(page);
  await page.getByTestId("iv-search").fill("filter");
  await page.getByTestId("iv-one").check();
  const mode = page.getByTestId("iv-one-mode");
  await expect(mode).toBeVisible();
  const position = page.getByTestId("iv-position");
  await expect(position).toHaveText(/^Question 1 of \d+ in /);
  const first = await mode.getByTestId("iv-prompt").textContent();
  await expect(mode.getByTestId("iv-prompt")).toBeFocused();
  await expect(page.getByTestId("iv-back")).toBeDisabled();
  await shot(page, "one-at-a-time");
  await expectAccessible(page, "one question at a time");

  await page.getByTestId("iv-next").click();
  await expect(position).toHaveText(/^Question 2 of \d+ in /);
  await expect(mode.getByTestId("iv-prompt")).not.toHaveText(first!);
  await expect(mode.getByTestId("iv-prompt")).toBeFocused();
  await page.getByTestId("iv-back").click();
  await expect(mode.getByTestId("iv-prompt")).toHaveText(first!);

  // Don't know yet moves on and leaves the question open; Skip moves on for this sitting only.
  await mode.getByTestId("iv-dontknow").click();
  await expect(position).toHaveText(/^Question 2 of /);
  const end = page.getByTestId("iv-end");
  for (let i = 0; i < 40 && !(await end.isVisible()); i++) await mode.getByTestId("iv-skip").click();
  await expect(end).toBeVisible();
  await expect(end).toContainText(/That was the last open question\. \d+ left open\./);
  await expect(end.getByRole("heading")).toBeFocused();
  await shot(page, "end-screen");
  await expect(page.getByTestId("iv-end-open")).toHaveAttribute("href", /tab=open/);
  await expect(page.getByTestId("iv-end-document")).toHaveAttribute("href", /tab=output/);
  await page.getByTestId("iv-end-open").click();
  await expect(page.getByTestId("trd-open-items")).toBeVisible();
});

test("one question at a time: a keyboard-only pass answers a question, and the sticky bar never covers the box in focus", async ({ page }) => {
  await startInterview(page);
  await page.getByTestId("iv-one").check();
  const title = card(page, "doc:title");
  await expect(title.getByTestId("iv-prompt")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(title.getByTestId("iv-input")).toBeFocused();
  await page.keyboard.type("Typed by keyboard (fictional)");
  await page.keyboard.press("Tab");
  await expect(title.getByTestId("iv-save")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(title.getByTestId("iv-saved")).toBeVisible();
  // Move on by keyboard: the exits, then the bar.
  await page.getByTestId("iv-next").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("iv-position")).toHaveText(/^Question 2 of /);
  // A focused box is never under the sticky bar (WCAG 2.4.11).
  const box = card(page, "doc:docRef").getByTestId("iv-input");
  await box.focus();
  const [b, nav] = [await box.boundingBox(), await page.getByTestId("iv-nav").boundingBox()];
  expect(b && nav && b.y + b.height <= nav.y + 1, "the box in focus sits above the Back / Next bar").toBe(true);
  await expectNoSidewaysScroll(page, "one question at a time");
});

// ------------------------------------------------------------------ project values, upload, resume

test("a project value shows where it came from, with Keep this and Change it; Change keeps the project value beside the entry", async ({ page }) => {
  test.setTimeout(120_000); // axe walks 84 project-value cards
  await openDemoInterview(page, "confirm");
  const projectCards = page.locator('[data-testid^="iv-card-"][data-state="from_project"]');
  await expect(projectCards.first()).toBeVisible();
  const first = projectCards.first();
  await expect(first.getByTestId("iv-project")).toContainText("From the gap assessment:");
  await expect(first.getByTestId("iv-status")).toContainText("not yet looked at");
  await shot(page, "project-value");
  await expectAccessible(page, "list with project values");
  await expectNoSidewaysScroll(page, "list with project values");

  // Keep this: no TRD write, only a mark in this browser, and the question now counts as looked at.
  const before = await progressNumbers(page);
  const openItemsBefore = (await page.getByTestId("trd-pill-open").textContent())?.trim();
  await first.getByTestId("iv-keep").click();
  await expect(first.getByTestId("iv-keep")).toBeDisabled();
  await expect(first.getByTestId("iv-status")).toContainText("Kept");
  expect((await progressNumbers(page)).answered).toBe(before.answered + 1);
  expect((await page.getByTestId("trd-pill-open").textContent())?.trim()).toBe(openItemsBefore);

  // Change it: a box opens (nothing typed in for the person); the project value stays beside the entry.
  const next = page.locator('[data-testid^="iv-card-"][data-state="from_project"]').filter({ has: page.getByTestId("iv-change") }).first();
  await next.getByTestId("iv-change").click();
  const input = next.getByTestId("iv-input");
  if (await input.count()) {
    await expect(input).toHaveValue("");
    if ((await input.evaluate((e) => e.tagName)) === "SELECT") await input.selectOption({ index: 1 });
    else await input.fill("12");
    await next.getByTestId("iv-save").click();
    if (await next.getByTestId("iv-saved").count()) await expect(next.getByTestId("iv-project-beside")).toContainText("Project value:");
  }
});

test("resume after a reload: 'Continue where you left off' returns to the last question looked at", async ({ page }) => {
  await startInterview(page);
  await card(page, "detail:modality").getByTestId("iv-input").focus();
  await page.reload();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-resume")).toBeVisible();
  await page.getByTestId("iv-resume").click();
  await expect(card(page, "detail:modality").getByTestId("iv-prompt")).toBeFocused();
});

test("after an upload review is accepted, the interview opens on 'Only what is still open'", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "TRD");
  const blank = await downloadOf(page, () => page.getByTestId("trd-blank-form").click());
  const filled = fillControl(blank.bytes, "trd.purpose", "Move the process to the receiving unit (fictional).");
  await page.getByTestId("trd-upload-input").setInputFiles({ name: "form.docx", mimeType: DOCX, buffer: filled });
  await expect(page).toHaveURL(/#\/trd\/import/);
  await page.getByTestId("import-accept-exact").click();
  await page.getByTestId("import-target-new").check();
  await page.getByTestId("import-title").fill("From the form (fictional)");
  await page.getByTestId("import-create").click();
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await page.getByTestId("import-answer-open").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-show-open")).toBeChecked();
  // The answered purpose is not in the list; a question still open is.
  await expect(card(page, "doc:purpose")).toHaveCount(0);
  await expect(card(page, "doc:title")).toHaveCount(0);
  await expect(page.getByTestId("iv-progress")).toContainText("answered");
});

// ------------------------------------------------------------------ looks: three widths, light and dark

test("list mode and one question at a time at this width, light and dark: no sideways scroll, axe clean", async ({ page }) => {
  test.setTimeout(120_000); // axe also walks the More detail list
  await startInterview(page);
  await card(page, "step:aseptic_filling.presence").getByTestId("iv-option-yes").check();
  await card(page, "step:aseptic_filling.presence").getByTestId("iv-save").click();
  await expect(card(page, "step:aseptic_filling.presence").getByTestId("iv-saved")).toBeVisible();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await expectNoSidewaysScroll(page, `list mode ${theme}`);
    await expectAccessible(page, `list mode ${theme}`);
    await shot(page, `list-${theme.toLowerCase()}`);
  }
  await page.getByTestId("iv-more").check();
  await expectNoSidewaysScroll(page, "list mode with More detail");
  await expectAccessible(page, "list mode with More detail");
  await page.getByTestId("iv-one").check();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await expectNoSidewaysScroll(page, `one at a time ${theme}`);
    await expectAccessible(page, `one at a time ${theme}`);
  }
  await setTheme(page, "Light");
});
