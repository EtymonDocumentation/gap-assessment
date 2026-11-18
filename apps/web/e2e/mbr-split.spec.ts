// A batch record split into two parts at a hold: the author chooses the split point (the sampling plan only points at it), each part has
// its own document number, the hold entries sit where the parts meet, and merging gives the single record back. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo } from "./nav-helper";

// Opening a demo project takes a while under load (the whole suite runs in parallel), so these specs get a 60 s limit instead of the default 30 s.
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openSyringeRecord(page: Page) {
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`split, hint, hold entries, part export and merge: ${name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await openSyringeRecord(page);

    // The demo arrives split at its hold: both parts labelled, the panel shows both entries with the plan's samples.
    const panel = page.getByTestId("mbr-split-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-testid^="mbr-part-label-"]', { hasText: "Part 1" }).first()).toBeVisible();
    await expect(page.locator('[data-testid^="mbr-part-label-"]', { hasText: "Part 2" }).first()).toBeVisible();
    await expect(page.getByTestId("mbr-split-ref1")).toHaveValue("DEMO-MBR-305-01-P1");
    await expect(page.getByTestId("mbr-split-ref2")).toHaveValue("DEMO-MBR-305-01-P2");
    await expect(page.getByTestId("mbr-split-entry-start")).toContainText("SP-007");
    await expect(page.getByTestId("mbr-split-entry-end")).toContainText("SP-009");
    // The demo says where the hold ends: the choice shows the step, the entry sits right after it and no open item asks.
    const endStep = page.getByTestId("mbr-split-hold-end-step");
    await expect(endStep).not.toHaveValue("");
    await expect(endStep.locator("option:checked")).toContainText("Take the holding bag out of cold storage");
    await expect(page.getByTestId("mbr-split-entry-end")).toContainText(/Hold end \(after step \d+\.\d+\)/);
    await expect(page.getByTestId("mbr-open-items")).not.toContainText("Say at which step the hold ends");
    await endStep.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), `holdend-editor-${name}.png`), fullPage: false });
    await page.screenshot({ path: join(tmpdir(), `mbrsplit-demo-${name}.png`), fullPage: false });
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: join(tmpdir(), `mbrsplit-record-${name}.png`) });
    if (name === "phone") {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await expectAccessible(page, `split record ${name}`);

    // Output: pick one part; the preview carries that part's document number and its hold entry only.
    await page.getByTestId("mbr-tab-word").click();
    await page.getByTestId("mbr-part-2").check();
    await page.getByTestId("mbr-preview-toggle").click();
    const preview = page.getByTestId("mbr-preview");
    await expect(preview).toContainText("DEMO-MBR-305-01-P2");
    await expect(preview).toContainText(/Hold end \(after step \d+\.\d+\)/);
    await expect(preview).not.toContainText("Hold end (start of Part 2)");
    await expect(preview).not.toContainText("Hold start (end of Part 1)");
    await page.getByTestId("mbr-part-1").check();
    await expect(preview).toContainText("DEMO-MBR-305-01-P1");
    await expect(preview).toContainText("Hold start (end of Part 1)");
    await page.getByTestId("mbr-preview-toggle").click();

    await page.getByTestId("mbr-tab-edit").click();
    // Merge: the record is one again, nothing of the split is left, and the plan's hold is only pointed out.
    await page.getByTestId("mbr-merge").click();
    await expect(page.getByTestId("mbr-split-panel")).toHaveCount(0);
    await expect(page.locator('[data-testid^="mbr-part-label-"]')).toHaveCount(0);
    await expect(page.getByTestId("mbr-part-choice")).toHaveCount(0);
    const hint = page.locator('[data-testid^="mbr-split-hint-"]').first();
    await expect(hint).toContainText("The sampling plan has a hold here: ");
    await hint.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), `mbrsplit-hint-${name}.png`) });
    await expectAccessible(page, `unsplit record with hint ${name}`);

    // The author splits where the hint points. The hold is not preselected by a plain "Split here".
    const gapId = (await hint.getAttribute("data-testid"))!.replace("mbr-split-hint-", "");
    await page.getByTestId(`mbr-split-${gapId}`).click();
    await expect(page.getByTestId("mbr-split-panel")).toBeVisible();
    await expect(page.getByTestId("mbr-split-hold")).toHaveValue("");
    await expect(page.getByTestId("mbr-split-limit")).toHaveValue("");
    await expect(page.getByTestId("mbr-split-entry-start")).toContainText("no hold chosen");
    // Nothing is preselected for the hold-end step: it reads "Not said yet" and an open item asks, with the entry at the top of Part 2.
    await expect(page.getByTestId("mbr-split-hold-end-step")).toHaveValue("");
    await expect(page.getByTestId("mbr-open-items")).toContainText("Say at which step the hold ends");
    await page.getByTestId("mbr-split-ref1").fill("DEMO-MBR-305-01-A");
    await page.getByTestId("mbr-split-ref2").fill("DEMO-MBR-305-01-B");
    await page.getByTestId("mbr-split-refs-save").click();
    const holdSelect = page.getByTestId("mbr-split-hold");
    await holdSelect.selectOption({ index: 1 });
    await expect(page.getByTestId("mbr-split-entries")).toBeVisible();
    await page.getByTestId("mbr-tab-word").click();
    await page.getByTestId("mbr-part-2").check();
    await page.getByTestId("mbr-preview-toggle").click();
    await expect(page.getByTestId("mbr-preview")).toContainText("DEMO-MBR-305-01-B");
    await expect(page.getByTestId("mbr-preview")).toContainText("No limit stated");
  });
}

// The hold-end entry sits right after the step the author chooses: the choice is changed here, and the entry appears under that step.
test("the author picks the step where the hold ends and the entry follows it in the record", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openSyringeRecord(page);
  const select = page.getByTestId("mbr-split-hold-end-step");
  await expect(select).toBeVisible();
  // Clear the demo's choice: nothing chosen reads "Not said yet", the open item asks and the entry has no step to sit after.
  await select.selectOption("");
  await expect(page.getByTestId("mbr-open-items")).toContainText("Say at which step the hold ends");
  await expect(page.getByTestId("mbr-split-entry-end")).toContainText("Hold end (start of Part 2)");
  await page.getByTestId("mbr-blocks-toggle-all").click();
  await expect(page.getByTestId("mbr-hold-end-entry")).toHaveCount(0);
  // Choose the second step of the first Part 2 block that has steps (a plain list of Part 2 steps, in order).
  const options = select.locator("option");
  expect(await options.count()).toBeGreaterThan(3);
  await select.selectOption({ index: 2 });
  await expect(page.getByTestId("mbr-open-items")).not.toContainText("Say at which step the hold ends");
  await expect(page.getByTestId("mbr-split-entry-end")).toContainText(/Hold end \(after step \d+\.\d+\)/);
  const entry = page.getByTestId("mbr-hold-end-entry");
  await expect(entry).toHaveCount(1);
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), "holdend-record-phone.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page, "hold-end entry in the record");
});
