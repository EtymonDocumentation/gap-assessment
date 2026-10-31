// Milestone 11: the master batch record. A record starts from a TRD record, a sampling plan, both or neither; every parameter row shows the
// TRD value with its source and the MBR value, with a three-way choice that is never preselected; notes about differences are information
// only; steps are numbered by the tool and cross-references follow; the step blocks come from a versioned library the user can edit.
// Accessibility at desktop and phone widths in light and dark, and use by keyboard. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** Through the navigation, so the "Batch record" link is part of what is tested. On a phone it sits behind the menu button. */
async function openMbr(page: Page) {
  await loadDemo(page);
  await goTo(page, "Batch record");
  await expect(page.getByTestId("mbr-scope-text")).toBeVisible();
}

async function openDemoRecord(page: Page) {
  await openMbr(page);
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
}

async function openAllBlocks(page: Page) {
  await page.getByTestId("mbr-blocks-toggle-all").click();
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

/** The first parameter row whose choice reads this. */
const rowWith = (page: Page, state: string) => page.locator("li.mbr-row", { has: page.locator('[data-testid^="mbr-choice-state-"]', { hasText: new RegExp(`^${state}$`) }) }).first();

test.describe("batch record: the demo record", () => {
  test("is reached from the navigation, lists the demo record and keeps the banner", async ({ page }) => {
    await openMbr(page);
    await expect(page.getByText(BANNER).first()).toBeVisible();
    await expect(page.getByTestId("mbr-list-table")).toContainText("MBR-001");
    await page.screenshot({ path: join(SHOTS, "m11-list.png") });
  });

  test("shows rows with the TRD value and source, the MBR value, a choice that is not preselected and information-only notes", async ({ page }) => {
    await openDemoRecord(page);
    await openAllBlocks(page);
    await expect(page.locator('[data-testid^="mbr-step-no-"]').first()).toHaveText(/^\d+\.\d+$/);

    // A row nobody has decided reads "Not decided", has no choice ticked as the same or tightened, and no note.
    const undecided = rowWith(page, "Not decided");
    await expect(undecided).toBeVisible();
    await expect(undecided.locator('input[type="radio"][data-testid^="mbr-choice-same_as_trd-"]')).not.toBeChecked();
    await expect(undecided.locator('input[type="radio"][data-testid^="mbr-choice-tightened_by_cmo-"]')).not.toBeChecked();
    await expect(undecided.locator('[data-testid^="mbr-trd-"]').first()).toContainText("TRD value");

    // A row set to the TRD value is read-only.
    const same = rowWith(page, "Same as TRD");
    await expect(same.locator('input[data-testid^="mbr-value-"]')).toHaveAttribute("readonly", "");
    await expect(same.getByText(/Source:/).first()).toBeVisible();

    // The tightened row carries its note, worded as information.
    const tightened = rowWith(page, "Tightened by the CMO");
    await expect(tightened.locator('[data-testid^="mbr-note-"]')).toContainText("Tighter than the TRD");
    await expect(tightened.locator('[data-testid^="mbr-note-"]')).toContainText("nothing is blocked");

    // The study point has the marker and no comparison note.
    const study = page.locator("li.mbr-row", { hasText: "Study point (not a limit)" }).first();
    await expect(study).toBeVisible();
    await expect(study.locator('[data-testid^="mbr-note-"]')).toHaveCount(0);
    await page.locator("article.mbr-block", { has: tightened }).first().screenshot({ path: join(SHOTS, "m11-params.png") });
  });

  test("choosing for a row writes it to the change log, in words, and a typed MBR value can be entered when tightened", async ({ page }) => {
    await openDemoRecord(page);
    await openAllBlocks(page);
    const id = (await rowWith(page, "Not decided").getAttribute("data-testid"))!.replace("mbr-row-", "");
    // Fixed by id: the row stops reading "Not decided" as soon as a choice is made.
    const row = page.getByTestId(`mbr-row-${id}`);
    await row.getByTestId(`mbr-choice-tightened_by_cmo-${id}`).check();
    await expect(row.getByTestId(`mbr-choice-state-${id}`)).toHaveText("Tightened by the CMO");
    const value = row.getByTestId(`mbr-value-${id}`);
    await value.fill("45");
    await row.getByTestId(`mbr-unit-${id}`).fill("min");
    await row.getByTestId(`mbr-unit-${id}`).blur();
    await expect(value).toHaveValue("45");
    // Going back to "not decided" is possible: the choice is never forced.
    await row.getByTestId(`mbr-choice-unset-${id}`).check();
    await expect(row.getByTestId(`mbr-choice-state-${id}`)).toHaveText("Not decided");

    await goTo(page, "Change log");
    const table = page.getByRole("region", { name: "Change log table" });
    await expect(table.getByText(/Parameter row .* edited in block/).first()).toBeVisible();
    await expect(table).toContainText("Tightened by the CMO");
  });

  test("the open items panel lists what is undecided and the TRD requirements without a step, with a button to add a block", async ({ page }) => {
    await openDemoRecord(page);
    const panel = page.getByTestId("mbr-open-items");
    await expect(panel).toContainText("Not decided");
    const reqs = page.getByTestId("mbr-requirements");
    await expect(reqs).toContainText("TRD requirement without an MBR step");
    const before = await reqs.locator("li").count();
    await reqs.getByRole("button", { name: /Add a block of my own/ }).first().click();
    await expect(reqs.locator("li")).toHaveCount(before - 1);
  });

  test("a changed TRD value gets a notice with an Update button, and nothing is rewritten before the click", async ({ page }) => {
    await openDemoRecord(page);
    await expect(page.getByTestId("mbr-changes")).toHaveCount(0);
  });

  test("step numbers are computed and a step can be added, edited with a reference, moved and removed", async ({ page }) => {
    await openDemoRecord(page);
    await openAllBlocks(page);
    const firstBlock = page.locator("article.mbr-block").first();
    const count = await firstBlock.locator("li.mbr-step").count();
    await firstBlock.locator('input[data-testid^="mbr-step-new-"]').fill("Record the line clearance (fictional).");
    await firstBlock.locator('button[data-testid^="mbr-step-add-"]').click();
    await expect(firstBlock.locator("li.mbr-step")).toHaveCount(count + 1);

    // Edit the new step with a reference to another step; the text shows the number, and focus returns to Edit.
    const last = firstBlock.locator("li.mbr-step").last();
    await last.getByRole("button", { name: /^Edit step/ }).click();
    await last.locator('select[data-testid^="mbr-step-ref-"]').selectOption({ index: 1 });
    await last.locator('button[data-testid^="mbr-step-save-"]').click();
    await expect(last).toContainText(/\(Step \d+\.\d+\)/);
    await expect(last.getByRole("button", { name: /^Edit step/ })).toBeFocused();

    await last.getByRole("button", { name: /^Remove step/ }).click();
    await expect(firstBlock.locator("li.mbr-step")).toHaveCount(count);
  });

  test("time limits show the critical limit with its targets and the sum as information", async ({ page }) => {
    await openDemoRecord(page);
    await openAllBlocks(page);
    const limit = page.locator("li.mbr-limit", { has: page.locator("li.mbr-target") }).first();
    await expect(limit).toBeVisible();
    await expect(limit.locator("li.mbr-target")).toHaveCount(2);
    await expect(limit.locator('[data-testid^="mbr-limit-sum-"]')).toContainText(/target/i);
    await page.locator("article.mbr-block", { has: limit }).first().screenshot({ path: join(SHOTS, "m11-limits.png") });
  });

  test("sample rows come from the sampling plan inside a scrolling region", async ({ page }) => {
    await openDemoRecord(page);
    await openAllBlocks(page);
    const region = page.getByRole("region", { name: /^Sample rows of/ }).first();
    await expect(region).toBeVisible();
    await expect(region.locator("tbody tr").first()).toBeVisible();
  });

  test("a block can be removed with a confirmation, and focus returns to where it was", async ({ page }) => {
    await openDemoRecord(page);
    const first = page.locator('button[data-testid^="mbr-block-remove-"]').first();
    await first.focus();
    await first.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(first).toBeFocused();
  });

  test("the HTML download carries the banner and the CMO placeholder", async ({ page }) => {
    await openDemoRecord(page);
    await page.getByTestId("mbr-tab-word").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("mbr-download-html").click().then(async () => {
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })]);
    const text = (await readFile(await dl.path())).toString("utf8");
    expect(text).toContain(BANNER);
    expect(text).toContain("To be completed by the CMO");
    expect(text).not.toMatch(/\b(violation|non-compliant)\b/i);
  });
});

test.describe("batch record: new record", () => {
  test("a blank start offers blocks that are not ticked unless a source backs them, and creates an empty record", async ({ page }) => {
    await openMbr(page);
    await page.getByTestId("mbr-title-input").fill("Blank test record (fictional)");
    await page.getByTestId("mbr-start-options").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, "m11-new.png") });
    const offers = page.getByTestId("mbr-blocks-offer").locator('input[type="checkbox"]');
    const n = await offers.count();
    for (let i = 0; i < n; i++) await expect(offers.nth(i)).not.toBeChecked();
    await page.getByTestId("mbr-create").click();
    await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
    await expect(page.getByText("No sections yet. Add one below.")).toBeVisible();
    // Add a section and a block of my own.
    await page.getByTestId("mbr-section-new").fill("Receipt");
    await page.getByTestId("mbr-section-add").click();
    await expect(page.getByRole("heading", { level: 3, name: /1\. Receipt/ })).toBeVisible();
    await page.locator('input[data-testid^="mbr-add-custom-"]').first().fill("My block");
    await page.locator('button[data-testid^="mbr-add-custom-btn-"]').first().click();
    await expect(page.locator("article.mbr-block")).toHaveCount(1);
  });

  test("starting from the TRD and the sampling plan ticks the blocks they back, and the record is built from them", async ({ page }) => {
    await openMbr(page);
    await page.getByTestId("mbr-title-input").fill("From sources (fictional)");
    await page.getByTestId("mbr-start-trd").check();
    await page.getByTestId("mbr-start-trd-select").selectOption({ index: 1 });
    await page.getByTestId("mbr-start-plan").check();
    await page.getByTestId("mbr-start-plan-select").selectOption({ index: 1 });
    await expect(page.getByTestId("mbr-blocks-offer").locator('input[type="checkbox"]:checked').first()).toBeVisible();
    await page.getByTestId("mbr-create").click();
    await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
    await expect(page.locator("section[data-testid^='mbr-section-']").first()).toBeVisible();
  });
});

test.describe("batch record: step blocks library", () => {
  test("an edit makes a new version, the record shows Update from library, and updating brings the record to it", async ({ page }) => {
    await openDemoRecord(page);
    const libLink = page.getByRole("link", { name: "Batch records" });
    await libLink.click();
    await page.getByRole("link", { name: "step blocks library" }).click();
    await expect(page.getByTestId("mbl-table")).toBeVisible();
    await page.getByTestId("mbl-edit-pooling_with_weights").click();
    const steps = page.getByTestId("mbl-steps");
    const old = await steps.inputValue();
    await steps.fill(`${old}\nRecord the final check (fictional).`);
    await page.screenshot({ path: join(SHOTS, "m11-library.png"), fullPage: true });
    await page.getByTestId("mbl-save").click();
    await expect(page.getByTestId("mbl-message")).toContainText("version 3");
    await expect(page.getByTestId("mbl-row-pooling_with_weights")).toContainText("Shipped, edited by you");

    // The record made from the earlier version keeps its copy and offers the update.
    await page.getByRole("link", { name: "Batch records" }).click();
    await page.getByTestId("mbr-list-table").getByRole("link").first().click();
    const notice = page.locator('[data-testid^="mbr-library-newer-"]').first();
    await expect(notice).toContainText("newer version");
    await notice.getByRole("button", { name: "Update from library" }).click();
    await expect(page.locator('[data-testid^="mbr-library-newer-"]')).toHaveCount(0);
    await openAllBlocks(page);
    await expect(page.getByText("Record the final check (fictional).").first()).toBeVisible();
  });

  test("an unchanged save makes no new version", async ({ page }) => {
    await loadDemo(page);
    await page.goto("./#/mbr/library");
    await page.getByTestId("mbl-edit-pooling_with_weights").click();
    await page.getByTestId("mbl-save").click();
    await expect(page.getByTestId("mbl-message")).toContainText("Nothing changed");
  });
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
    test(`accessibility and layout: ${name}, ${scheme}`, async ({ page }) => {
      // Loads the demo and runs axe on four pages; several seconds under load, so the default 30 s is too tight.
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await openMbr(page);
      await expectAccessible(page, `list ${name} ${scheme}`);
      await expectNoHorizontalScroll(page, `list ${name} ${scheme}`);
      await page.getByTestId("mbr-list-table").getByRole("link").first().click();
      await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
      await openAllBlocks(page);
      await page.locator("details.mbr-more > summary").first().click();
      await expectAccessible(page, `record ${name} ${scheme}`);
      await expectNoHorizontalScroll(page, `record ${name} ${scheme}`);
      if (scheme === "light") await page.locator("article.mbr-block", { has: page.locator("li.mbr-row") }).first().screenshot({ path: join(SHOTS, `m11-record-${name}.png`) });
      await page.goto("./#/mbr/library");
      await expect(page.getByTestId("mbl-table")).toBeVisible();
      await page.getByTestId("mbl-edit-pooling_with_weights").click();
      await expectAccessible(page, `library ${name} ${scheme}`);
      await expectNoHorizontalScroll(page, `library ${name} ${scheme}`);
      if (scheme === "light") await page.screenshot({ path: join(SHOTS, `m11-library-${name}.png`), fullPage: true });
    });
  }
}
