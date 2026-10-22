// Milestone 7.2 part B: streamlined adding. The short add form (4 fields), the step-by-step wizard (remembered choice), the "More
// details" editor with collapsible groups, collapsed point cards in the interview, catalog steps inserted in process order, and the
// Type select that can be cleared. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
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

const pointIds = (page: Page) => page.locator('[data-testid^="point-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("point-", "")));

/** Adds a mixing sample through the short form and returns its id. The card stays a summary line. */
async function addMixing(page: Page): Promise<string> {
  const before = await pointIds(page);
  await page.getByTestId("add-sample").click();
  await page.getByTestId("add-type").selectOption("mixing_homogeneity");
  await page.getByTestId("add-what").fill("Blend uniformity (fictional)");
  await page.getByTestId("add-submit").click();
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
  return (await pointIds(page)).find((i) => !before.includes(i))!;
}

test("the short form has four fields, closes with Escape and returns focus; Add selects a collapsed card", async ({ page }) => {
  await openDemoPlan(page);
  const opener = page.getByTestId("add-sample");
  await opener.click();
  const form = page.getByTestId("add-short");
  await expect(form).toBeVisible();
  await expect(form.locator("select, input, textarea")).toHaveCount(4);
  await expect(page.getByTestId("add-step").locator("option").first()).toHaveText("Not on the diagram");
  // Nothing is preselected and Add waits for the one thing that decides the questions.
  await expect(page.getByTestId("add-type")).toHaveValue("");
  await expect(page.getByTestId("add-submit")).toBeDisabled();
  await page.screenshot({ path: join(SHOTS, "m72b-shortform.png") });
  await expectAccessible(page, "short add dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();

  const id = await addMixing(page);
  await expect(page.getByTestId(`point-${id}`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId(`card-${id}`)).toBeVisible();
  await expect(page.getByTestId(`card-open-${id}`)).toHaveText("More details");
  await expect(page.getByTestId("point-dialog")).toHaveCount(0);
  await expect(page.getByTestId(`card-status-${id}`)).toContainText(/to fill/);
});

test("More details shows only the chosen type's fields; group counts match the open items; groups start closed except the first with open items", async ({ page }) => {
  await openDemoPlan(page);
  const id = await addMixing(page);
  await page.getByTestId(`card-open-${id}`).click();
  await expect(page.getByTestId("point-dialog")).toBeVisible();
  // Only the mixing group of fields exists; the other types' groups are not rendered at all.
  await expect(page.getByTestId("type-card")).toHaveCount(1);
  await expect(page.getByTestId("mix-vessel")).toHaveCount(1);
  for (const other of ["hold-step", "filter-test", "retain-purpose", "stab-against-protocol"]) await expect(page.getByTestId(other)).toHaveCount(0);
  await expect(page.getByTestId("group-toggle-type")).toContainText("Mixing");

  // Counts are words ("N to fill"), and they add up to the open-item list.
  const groups = ["type", "sampling", "testing", "acceptance", "reporting", "sources"];
  let sum = 0;
  let firstOpenSeen = false;
  for (const g of groups) {
    const text = (await page.getByTestId(`group-count-${g}`).textContent())!.trim();
    const n = text === "Nothing open" ? 0 : Number(/^(\d+) to fill$/.exec(text)![1]);
    sum += n;
    const expanded = (await page.getByTestId(`group-toggle-${g}`).getAttribute("aria-expanded")) === "true";
    // Only the first group that has something to fill starts open.
    expect(expanded, `group ${g}`).toBe(n > 0 && !firstOpenSeen);
    if (n > 0) firstOpenSeen = true;
  }
  expect(sum).toBeGreaterThan(0);
  await expect(page.getByTestId("point-open").locator("li")).toHaveCount(sum);
  await page.screenshot({ path: join(SHOTS, "m72b-moredetails-mixing.png"), fullPage: true });

  // A group header is a real toggle with aria-expanded.
  const sampling = page.getByTestId("group-toggle-sampling");
  const was = await sampling.getAttribute("aria-expanded");
  await sampling.click();
  await expect(sampling).toHaveAttribute("aria-expanded", was === "true" ? "false" : "true");
  await expectAccessible(page, "expanded card in More details");
});

test("changing the type asks before hiding entries; the entries stay in the data", async ({ page }) => {
  await openDemoPlan(page);
  const id = await addMixing(page);
  await page.getByTestId(`card-open-${id}`).click();
  const toggle = page.getByTestId("group-toggle-type");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByTestId("mix-vessel").fill("Tank 7 (fictional)");
  // A value exists in the mixing group, so leaving the type asks first.
  await page.getByTestId("point-type").selectOption("ipc");
  const ask = page.getByTestId("type-change-confirm");
  await expect(ask).toBeVisible();
  await page.getByTestId("type-change-no").click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId("point-type")).toHaveValue("mixing_homogeneity");
  await page.getByTestId("point-type").selectOption("ipc");
  await page.getByTestId("type-change-yes").click();
  await expect(page.getByTestId("type-card")).toHaveCount(0);
  // Back to mixing: the value is still there (hidden, not deleted), and nothing is asked for an empty group.
  await page.getByTestId("point-type").selectOption("mixing_homogeneity");
  await expect(page.getByTestId("type-change-confirm")).toHaveCount(0);
  await expect(page.getByTestId("mix-vessel")).toHaveValue("Tank 7 (fictional)");
});

test("the wizard: five screens, Back and Next, focus on the heading, the choice is remembered after a reload", async ({ page }) => {
  await openDemoPlan(page);
  const before = await pointIds(page);
  await page.getByTestId("add-sample").click();
  await page.getByTestId("add-mode-wizard").click();
  const heading = page.getByTestId("wizard-heading");
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 1 of 5");
  await expect(page.getByTestId("wizard-back")).toBeDisabled();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 2 of 5");
  await expect(heading).toBeFocused();
  // The type is required to go on; none is preselected.
  await expect(page.getByTestId("wizard-next")).toBeDisabled();
  await page.getByTestId("wizard-type-mixing_homogeneity").check();
  await page.screenshot({ path: join(SHOTS, "m72b-wizard-step2.png") });
  await expectAccessible(page, "wizard step 2");
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 3 of 5");
  await page.getByTestId("add-what").fill("Blend uniformity (wizard, fictional)");
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 4 of 5");
  await page.getByTestId("wizard-field-mixing.vesselRef").fill("Tank 9 (fictional)");
  await page.getByTestId("wizard-back").click();
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 3 of 5");
  await expect(page.getByTestId("add-what")).toHaveValue("Blend uniformity (wizard, fictional)");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-progress")).toHaveText("Step 5 of 5");
  const review = page.getByTestId("wizard-review");
  await expect(review).toContainText("Blend uniformity (wizard, fictional)");
  await expect(review).toContainText("Tank 9 (fictional)");
  await expect(review).toContainText("Not given yet");
  await page.screenshot({ path: join(SHOTS, "m72b-wizard-review.png") });
  await expectAccessible(page, "wizard review");
  await page.getByTestId("add-submit").click();
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
  const id = (await pointIds(page)).find((i) => !before.includes(i))!;
  // The same result as the short form, plus the key field the wizard collected.
  await page.getByTestId(`card-open-${id}`).click();
  await page.getByTestId("point-expand-all").click();
  await expect(page.getByTestId("mix-vessel")).toHaveValue("Tank 9 (fictional)");
  await expect(page.getByTestId("point-attribute")).toHaveValue("Blend uniformity (wizard, fictional)");

  // Remembered in this browser.
  await page.reload();
  await page.getByTestId("add-sample").click();
  await expect(page.getByTestId("add-wizard")).toBeVisible();
  await expect(page.getByTestId("add-mode-wizard")).toHaveAttribute("aria-pressed", "true");
  // Cancel and Escape add nothing.
  const count = (await pointIds(page)).length;
  await page.getByTestId("add-cancel").click();
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
  await page.getByTestId("add-sample").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-dialog")).toHaveCount(0);
  expect((await pointIds(page)).length).toBe(count);
});

test("interview cards are collapsed with a summary line; selecting a row expands only that card", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("tab-interview").click();
  await page.getByTestId("view-step").click();
  await expect(page.getByTestId("point-dialog")).toHaveCount(0);
  const card = page.getByTestId("card-SP-002");
  await expect(card).toContainText("SP-002");
  await expect(card).toContainText(/to fill|Complete/);
  await expect(page.getByTestId("card-open-SP-002")).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: join(SHOTS, "m72b-cards-collapsed.png"), fullPage: true });

  await page.getByTestId("tab-overview").click();
  await page.getByTestId("status-SP-003").click();
  await page.getByTestId("tab-interview").click();
  await expect(page.getByTestId("card-SP-003").getByTestId("point-dialog")).toBeVisible();
  await expect(page.getByTestId("point-dialog")).toHaveCount(1);
  await expect(page.getByTestId("card-open-SP-003")).toHaveAttribute("aria-expanded", "true");
  await expectAccessible(page, "expanded interview card");
  await page.getByTestId("view-type").click();
  await expect(page.getByTestId("point-dialog")).toHaveCount(1);
});

test("a ticked catalog step goes in process order, not at the end", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("steps-choose").click();
  const checks = page.locator('[data-testid^="step-check-"]');
  const labels = await checks.evaluateAll((els) => els.map((e) => (e.closest("label")!.textContent ?? "").trim()));
  const ticked = await checks.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
  // An unticked step with a ticked step after it in the catalog, so an "append" would be visibly wrong.
  const lastTicked = ticked.lastIndexOf(true);
  const pick = ticked.findIndex((t, i) => !t && i < lastTicked);
  expect(pick, "the demo plan should leave a catalog step to add in the middle").toBeGreaterThan(-1);
  await checks.nth(pick).check();
  const inPlan = (await page.getByTestId("step-list").locator("li strong").allTextContents()).filter((l) => labels.includes(l));
  const inCatalog = labels.filter((_l, i) => ticked[i] || i === pick);
  expect(inPlan).toEqual(inCatalog);
  expect(inPlan.indexOf(labels[pick]!)).toBeLessThan(inPlan.length - 1);
});

test("the Type select in the points table can go back to Not chosen", async ({ page }) => {
  await openDemoPlan(page);
  const sel = page.getByTestId("row-type-SP-002");
  await expect(sel).not.toHaveValue("");
  await sel.selectOption("");
  await expect(sel).toHaveValue("");
  await expect(page.getByTestId("status-SP-002")).toContainText(/incomplete/i);
  await sel.selectOption("ipc");
  await expect(sel).toHaveValue("ipc");
});

for (const scheme of ["light", "dark"] as const) {
  test(`add dialog, wizard and an expanded card are accessible: ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openDemoPlan(page);
    await page.getByTestId("add-sample").click();
    await page.getByTestId("add-type").selectOption("hold_time");
    await expectAccessible(page, `${scheme} short form`);
    if (scheme === "dark") await page.screenshot({ path: join(SHOTS, "m72b-dark.png") });
    await page.getByTestId("add-mode-wizard").click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-type-hold_time").check();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("wizard-fields")).toBeVisible();
    await expectAccessible(page, `${scheme} wizard key fields`);
    await page.keyboard.press("Escape");
  });
}

test("no sideways scroll at 390 px for the short form, the wizard and a card in More details", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "sets its own viewport; one project is enough");
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemoPlan(page);
  await page.addStyleTag({ content: "* { font-family: Verdana, sans-serif !important; }" });
  await page.getByTestId("add-sample").click();
  await page.getByTestId("add-type").selectOption("mixing_homogeneity");
  await expectNoHorizontalScroll(page, "short form");
  await page.screenshot({ path: join(SHOTS, "m72b-shortform-390.png") });
  await page.getByTestId("add-mode-wizard").click();
  await page.getByTestId("wizard-next").click();
  await expectNoHorizontalScroll(page, "wizard types");
  await page.getByTestId("wizard-type-mixing_homogeneity").check();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await expectNoHorizontalScroll(page, "wizard key fields");
  await page.getByTestId("wizard-next").click();
  await expectNoHorizontalScroll(page, "wizard review");
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-interview").click();
  await page.locator('[data-testid^="card-open-"]').first().click();
  await page.getByTestId("point-expand-all").click();
  await expectNoHorizontalScroll(page, "card in More details");
});
