// A batch record split into two parts at a hold: the author chooses the split point (the sampling plan only points at it), each part has
// its own document number, the hold entries sit where the parts meet, and merging gives the single record back. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openSyringeRecord(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
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
    await expect(preview).toContainText("Hold end (start of Part 2)");
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
