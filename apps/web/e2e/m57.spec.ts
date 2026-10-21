// Milestone 5.7: choosing the scope up front (the Scope step and the Document-top panel), the end of the review workflow,
// the TBD warning on every download, the optional tailoring reason, the Scoping summary without an RU column and the
// Progress map at large text. Runs on the desktop, tablet and phone projects. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
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
  await dialog.getByLabel("Project title").fill("Scope test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
}

/** Pictures for the review: desktop in the light theme, phone in the dark theme (the two ends of the layout). */
async function shot(page: Page, name: string, testInfo: { project: { name: string } }, full = true) {
  if (testInfo.project.name === "tablet") return;
  const dark = testInfo.project.name === "phone";
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `m57-${name}-${testInfo.project.name}-${dark ? "dark" : "light"}.png`), fullPage: full });
  await page.emulateMedia({ colorScheme: null });
}

const mapTitles = (page: Page) => page.locator(".progress-map .pm-title").allTextContents();

test("a new project opens the Scope step first: everything is included, nothing is pre-decided", async ({ page }, testInfo) => {
  await newProject(page);
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Process steps" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Document sections" })).toBeVisible();
  await expect(page.getByTestId("scope-summary")).toContainText("process steps");
  // Nothing is answered yet, so no step may be called "not applicable" (that would be an invented default): steps that wait
  // for a scoping answer stay in scope and name the question.
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect(page.getByTestId("scope-summary")).not.toContainText("not applicable");
  await expect(page.getByText(/^Not applicable/)).toHaveCount(0);
  const waiting = page.getByText(/^Depends on an unanswered question: /);
  expect(await waiting.count()).toBeGreaterThan(0);
  await expect(page.locator("#scope-step-lyophilization")).toBeEnabled();
  await expect(page.locator("#scope-step-lyophilization")).toBeChecked();
  await page.locator("li.scope-step", { has: page.locator("#scope-step-lyophilization") }).getByRole("link", { name: "Go to this question" }).waitFor();
  // Mandatory sections are shown ticked and disabled.
  await expect(page.locator("#scope-sec-risk")).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^Purpose/ })).toBeDisabled();
  await expect(page.getByText("Always included").first()).toBeVisible();
  await expectAccessible(page, "scope step, new project");
  await expectNoHorizontalScroll(page, "scope step, new project");
  await shot(page, "scope-step", testInfo, false);
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
  // Reachable again from the navigation.
  await go(page, "#/scope");
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
});

test("scope step: groups, a single step, a confirm for answered steps, and re-ticking restores everything", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.aseptic_filling");
  await expect(page.locator("#sum-h")).toContainText("Section summary");
  expect(await mapTitles(page)).toContain("Aseptic filling and stoppering");
  const countBefore = await page.locator(".progress-map li", { hasText: "Aseptic filling" }).locator(".pm-count").textContent();

  await go(page, "#/scope");
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expectAccessible(page, "scope step, groups expanded");
  await expectNoHorizontalScroll(page, "scope step, groups expanded");
  await shot(page, "scope-groups-expanded", testInfo);

  const group = page.locator("#scope-tick-filling_closing");
  await expect(group).toBeChecked();
  const step = page.locator("#scope-step-aseptic_filling");
  await step.click();

  // The step has recorded answers: the dialog says they are kept. Cancel changes nothing.
  const dialog = page.getByRole("dialog", { name: /Leave out/ });
  await expect(dialog).toContainText(/\d+ answers? will be kept but left out/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(step).toBeChecked();

  await step.click();
  await page.getByRole("dialog", { name: /Leave out/ }).getByLabel(/Reason/).fill("Filled at a partner site (fictional)");
  await page.getByRole("dialog", { name: /Leave out/ }).getByRole("button", { name: "Leave out" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const row = page.locator('[data-state="excluded"]', { has: step });
  await expect(row).toContainText("Filled at a partner site (fictional)");
  await expect(row).toContainText("kept");
  // The group tick now shows "some" (mixed) with a text count, not colour alone.
  await expect(group).toHaveAttribute("aria-checked", "mixed");
  await expect(page.locator("li.scope-group", { has: group })).toContainText("1 of 2 in scope");

  // Gone from the interview and the progress map.
  await go(page, "#/interview");
  expect(await mapTitles(page)).not.toContain("Aseptic filling and stoppering");

  // The change log records it.
  await go(page, "#/changes");
  await expect(page.locator("table.change-table")).toContainText("Process step left out (scope)");

  // Ticking it again brings the section and its values back.
  await go(page, "#/scope");
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await page.locator("#scope-step-aseptic_filling").check();
  await go(page, "#/interview?summary=uo.aseptic_filling");
  expect(await mapTitles(page)).toContain("Aseptic filling and stoppering");
  await expect(page.locator(".progress-map li", { hasText: "Aseptic filling" }).locator(".pm-count")).toHaveText(countBefore ?? "");

  // A whole group: one tick leaves every step out, one tick puts them back.
  await go(page, "#/scope");
  const g2 = page.locator("#scope-tick-inspection_packaging");
  await g2.click();
  await page.getByRole("dialog", { name: /Leave out/ }).getByRole("button", { name: "Leave out" }).click();
  await expect(g2).not.toBeChecked();
  await expect(page.locator("li.scope-group", { has: g2 })).toContainText("0 of 3 in scope");
  await g2.check();
  await expect(g2).toBeChecked();
});

test("scope step: a step the answers rule out is greyed, not tickable, and links to its question", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/scope");
  await page.getByRole("button", { name: "Expand all groups" }).click();
  const row = page.locator("#scope-step-lyophilization");
  await expect(row).toBeDisabled();
  const li = page.locator('li[data-state="not_applicable"]', { has: row });
  await expect(li).toContainText("Not applicable:");
  await li.getByRole("link", { name: "Go to this question" }).click();
  await expect(page.locator("#q-prompt")).toBeVisible();
});

test("the Document-top panel shows the same choice as the Scope step and changes the preview", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/document");
  const panel = page.getByTestId("doc-scope-panel");
  await expect(panel).toBeVisible();
  const collapsed = await panel.getByTestId("doc-scope-summary").textContent();
  await expect(page.locator("#doc-sec-risk")).toBeHidden();
  await expectAccessible(page, "document panel collapsed");
  await shot(page, "document-panel-collapsed", testInfo, false);
  await panel.getByRole("button", { name: "Change" }).click();
  await expect(panel.getByRole("button", { name: "Done" })).toHaveAttribute("aria-expanded", "true");
  await panel.getByRole("button", { name: "Expand all groups" }).click();
  await expect(page.locator("#doc-sec-risk")).toBeVisible();
  await expectAccessible(page, "document panel expanded");
  await expectNoHorizontalScroll(page, "document panel expanded");
  await shot(page, "document-panel-expanded", testInfo, false);

  await page.locator("#doc-sec-risk").uncheck();
  await expect(page.locator(".doc-preview").getByRole("heading", { name: /Risk ranking/ })).toHaveCount(0);
  await expect(page.getByTestId("download-contents")).toContainText("optional section left out");
  const changed = await panel.getByTestId("doc-scope-summary").textContent();
  expect(changed).not.toBe(collapsed);

  // The same choice, seen on the Scope step.
  await go(page, "#/scope");
  await expect(page.locator("#scope-sec-risk")).not.toBeChecked();
  await expect(page.getByTestId("scope-summary")).toContainText((changed ?? "").split(".")[0] ?? "");
  // And back: ticking it on the Scope step shows in the panel.
  await page.locator("#scope-sec-risk").check();
  await go(page, "#/document");
  await expect(page.locator(".doc-preview").getByRole("heading", { name: /Risk ranking/ })).toBeVisible();
});

test("HTML and Word downloads follow the selection, including a left-out process step", async ({ page }) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  await go(page, "#/document");
  const grab = async (name: string) => {
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        // The demo has TBD values, so a download asks first (unless the step left out held all of them).
        await page.getByRole("button", { name }).click();
        const anyway = page.getByRole("button", { name: "Download anyway" });
        if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
      })(),
    ]);
    return readFile(await dl.path());
  };
  const before = { html: await grab("Download HTML"), word: await grab("Download Word document") };
  const panel = page.getByTestId("doc-scope-panel");
  await panel.getByRole("button", { name: "Change" }).click();
  await panel.getByRole("button", { name: "Expand all groups" }).click();
  await page.locator("#doc-step-capping").click();
  await page.getByRole("dialog", { name: /Leave out/ }).getByRole("button", { name: "Leave out" }).click();
  await expect(page.getByTestId("download-contents")).toContainText("process step");
  const after = { html: await grab("Download HTML"), word: await grab("Download Word document") };
  expect(after.html.equals(before.html)).toBe(false);
  expect(after.word.equals(before.word)).toBe(false);
  // The document says what was left out, with "No reason recorded" because none was typed.
  expect(after.html.toString("utf8")).toContain("No reason recorded");
  expect(before.html.toString("utf8")).not.toContain("Process step left out");
});

test("the review workflow is gone: no revisions, no Draft/Issued, no comments", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();
  for (const name of ["Issue revision", "Add comment"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await expect(page.locator("#revision-state")).toHaveCount(0);
  for (const heading of [/Revision history/, /Reviewer comments/, /Revisions/]) await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
  await expect(page.locator(".doc-preview")).not.toContainText(/Revision history|Not yet issued|Draft revision/i);
  // What stays: Export history and Approval.
  await expect(page.getByRole("heading", { name: "Export history" })).toBeVisible();
  await expect(page.locator(".doc-preview").getByRole("heading", { name: /Approval/ })).toBeVisible();
});

test("a download with TBD values names the count, in every format", async ({ page }, testInfo) => {
  await loadDemo(page);
  await go(page, "#/document");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const warn = page.getByRole("dialog", { name: "Download with TBD values?" });
  await expect(warn.getByTestId("tbd-warning")).toContainText("TBD values were");
  await expectAccessible(page, "TBD warning");
  await shot(page, "tbd-warning", testInfo, false);
  await warn.getByRole("button", { name: "Go back" }).click();
  await page.getByRole("button", { name: "Download HTML" }).click();
  await expect(page.getByRole("dialog", { name: "Download with TBD values?" })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await page.getByRole("button", { name: "Download Word document" }).click();
  await expect(page.getByRole("dialog", { name: "Download with TBD values?" })).toBeVisible();
});

test("tailoring a topic needs no reason: the document says 'No reason recorded'", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.bulk_packaging");
  await page.getByTestId("tailor-open").click();
  const dialog = page.getByRole("dialog", { name: "Tailor Bulk packaging" });
  await dialog.getByRole("checkbox", { name: /Hold and temperature/ }).uncheck();
  await expect(dialog.getByLabel(/Reason for leaving out/)).toContainText("");
  await dialog.getByRole("button", { name: "Save scope" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("tailor-open")).toContainText("1 left out");
  await go(page, "#/document");
  await expect(page.locator(".doc-preview")).toContainText("No reason recorded");
});

test("the Scoping summary has no RU column: the answers apply to both sides", async ({ page }, testInfo) => {
  await loadDemo(page);
  await go(page, "#/interview?summary=scoping");
  await expect(page.locator("#sum-h")).toContainText("Section summary");
  const table = page.locator("table.data").first();
  await expect(table.getByRole("columnheader", { name: "Attribute" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Answer (applies to both SU and RU)" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "RU", exact: true })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "SU", exact: true })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Comparison" })).toHaveCount(0);
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(0);
  await expectAccessible(page, "scoping summary");
  await expectNoHorizontalScroll(page, "scoping summary");
  await shot(page, "scoping-summary", testInfo);
});

test("the Progress map explains its counts and never clips at 390px with 200% text", async ({ page }, testInfo) => {
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.aseptic_filling");
  await expect(page.getByTestId("pm-help")).toContainText("Counts are questions answered out of those showing.");
  await expect(page.locator(".pm-sides").first()).toContainText(/SU: \d+ of \d+ answered · RU: \d+ of \d+ answered/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(page.locator(".progress-map")).toBeVisible();
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll(".progress-map li, .progress-map li *"))) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > limit + 1 || r.left < -1)) bad.push(`${el.className || el.tagName}: ${Math.round(r.left)}..${Math.round(r.right)} of ${limit}`);
    }
    return bad;
  });
  expect(wide, "progress map parts outside the viewport").toEqual([]);
  await expectNoHorizontalScroll(page, "progress map at 200% text");
  await page.locator(".progress-map").scrollIntoViewIfNeeded();
  mkdirSync(SHOTS, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  if (testInfo.project.name === "phone") await page.locator("nav[aria-label='Sections']").screenshot({ path: join(SHOTS, "m57-progress-map-phone-dark.png") });
  await page.emulateMedia({ colorScheme: null });
});

for (const theme of ["light", "dark"] as const) {
  test(`scope pages: accessible, no sideways scroll, ${theme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await loadDemo(page);
    await page.getByLabel("Colour theme").selectOption(theme);
    await go(page, "#/scope");
    await page.getByRole("button", { name: "Expand all groups" }).click();
    await page.locator("#scope-step-capping").click();
    await page.getByRole("dialog", { name: /Leave out/ }).getByRole("button", { name: "Leave out" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expectAccessible(page, `${theme} scope step with an exclusion`);
    await expectNoHorizontalScroll(page, `${theme} scope step with an exclusion`);
    // The confirm dialog.
    await page.locator("#scope-step-bulk_packaging").click();
    await expect(page.getByRole("dialog", { name: /Leave out/ })).toBeVisible();
    await expectAccessible(page, `${theme} leave-out dialog`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await go(page, "#/document");
    await page.getByTestId("doc-scope-panel").getByRole("button", { name: "Change" }).click();
    await expectAccessible(page, `${theme} document panel`);
    await expectNoHorizontalScroll(page, `${theme} document panel`);
  });
}
