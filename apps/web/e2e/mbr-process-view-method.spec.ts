// The Process view draws "how the sample is taken" (read live from the linked sampling plan): a glyph by access kind at the sample marker,
// the study-only tag, the flush to waste, the same facts in words, and nothing for a sample whose point says nothing. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openView(page: Page, demo: "Open syringe example" | "Load demo") {
  await page.goto("./");
  await page.getByRole("button", { name: demo }).click();
  await expect(page.getByTestId("home-chain").or(page.getByRole("heading", { level: 1, name: "Gap register" }))).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await page.getByTestId("mbr-tab-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

/** Jump to the moment at which the given sample marker is taken (the marker's own data tells nothing, so walk the slider). */
async function goToSample(page: Page, pointId: string) {
  const count = await page.getByTestId("pv-jump").locator("option").count();
  for (let i = 0; i < count; i++) {
    await page.getByTestId("pv-jump").selectOption({ value: String(i) });
    if ((await page.getByTestId("pv-samples-now").count()) > 0 && (await page.getByTestId("pv-samples-now").textContent())?.includes(pointId)) return;
  }
  throw new Error(`no moment takes ${pointId}`);
}

for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`syringe demo: glyphs, study tag, flush to waste, words and legend: ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await openView(page, "Open syringe example");

    // The Y-connector point: a Y glyph, drawn dashed (added for the study), with its tag and the flush to waste.
    const y = page.getByTestId("pv-glyph-SP-021");
    await expect(y).toHaveAttribute("data-access", "added_y_connector");
    await expect(y).toHaveAttribute("data-added", "true");
    await expect(page.getByTestId("pv-tag-SP-021")).toHaveText(/^(PPQ only|study only)$/);
    await expect(page.getByTestId("pv-waste-SP-021")).toContainText("100 mL to waste");

    // The shared port: both samples carry the shared glyph and a thin line joins them.
    await expect(page.getByTestId("pv-glyph-SP-001")).toHaveAttribute("data-access", "shared_port");
    await expect(page.getByTestId("pv-glyph-SP-002")).toHaveAttribute("data-access", "shared_port");
    await expect(page.getByTestId("pv-share-SP-001+SP-002")).toHaveCount(1);
    await expect(page.getByTestId("pv-waste-SP-001")).toContainText("50 mL to waste");

    // A dedicated port with no flush stated: a glyph but no waste mark. A manifold with a first-draw discard.
    await expect(page.getByTestId("pv-glyph-SP-020")).toHaveAttribute("data-access", "dedicated_port");
    await expect(page.getByTestId("pv-waste-SP-020")).toHaveCount(0);
    await expect(page.getByTestId("pv-glyph-SP-009")).toHaveAttribute("data-access", "bag_sample_manifold");
    await expect(page.getByTestId("pv-waste-SP-009")).toContainText("10 mL to waste");

    // A sample whose point says nothing about how it is taken has a marker and no glyph, tag or waste mark at all.
    const withGlyph = new Set(await page.locator('[data-testid^="pv-glyph-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("pv-glyph-", ""))));
    const marks = await page.locator('[data-testid^="pv-mark-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("pv-mark-", "")));
    const plain = marks.filter((m) => !withGlyph.has(m));
    expect(plain.length).toBeGreaterThan(0);
    await expect(page.getByTestId(`pv-tag-${plain[0]}`)).toHaveCount(0);
    await expect(page.getByTestId(`pv-waste-${plain[0]}`)).toHaveCount(0);

    // The legend names only the glyphs that are drawn.
    const about = page.locator("details.pv-about");
    if (!(await about.evaluate((d) => (d as HTMLDetailsElement).open))) await about.locator("summary").click();
    for (const a of ["shared_port", "added_y_connector", "dedicated_port", "bag_sample_manifold"]) await expect(page.getByTestId(`pv-legend-${a}`)).toBeVisible();
    await expect(page.getByTestId("pv-legend-aseptic_connector")).toHaveCount(0);
    await expect(page.getByTestId("pv-legend-added")).toBeVisible();
    await expect(page.getByTestId("pv-legend-flush")).toBeVisible();

    // The same facts in words: the sample list at the moment, the volume line and the sample table.
    await goToSample(page, "SP-001");
    await expect(page.getByTestId("pv-method-SP-001")).toContainText("shared port, shared with SP-002, flushed between samples, flush 50 mL");
    await expect(page.getByTestId("pv-flushed")).toContainText("L");
    await goToSample(page, "SP-021");
    await expect(page.getByTestId("pv-method-SP-021")).toContainText("Y-connector");
    await expect(page.getByTestId("pv-method-SP-021")).toContainText("flush 100 mL to the waste bag");
    await expect(page.getByTestId("pv-tables").getByRole("columnheader", { name: /How it is taken/ })).toBeVisible();

    // The reminders are one non-blocking note in the findings.
    await expect(page.getByTestId("pv-findings")).toContainText("sampling-method details not stated");

    if (name === "desktop") {
      await page.getByTestId("pv-diagram").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, "smp-method-b-syr-desktop.png") });
      // Close crops around the Y-connector and around the shared-port pair.
      for (const [file, a, b] of [["y-connector", "SP-008", "SP-021"], ["shared-pair", "SP-003", "SP-002"]] as const) {
        const box1 = (await page.getByTestId(`pv-mark-${a}`).boundingBox())!;
        const box2 = (await page.getByTestId(`pv-mark-${b}`).boundingBox())!;
        const x = Math.min(box1.x, box2.x) - 20;
        const y = Math.min(box1.y, box2.y) - 20;
        await page.screenshot({ path: join(SHOTS, `smp-method-b-${file}.png`), clip: { x: Math.max(0, x), y: Math.max(0, y), width: 260, height: Math.max(box1.y, box2.y) - y + 70 } });
      }
    } else {
      await page.getByTestId("pv-mark-SP-001").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, "smp-method-b-syr-phone.png"), fullPage: false });
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await expectAccessible(page, `method glyphs ${name}`);
  });
}

test("syringe demo in the dark theme: glyphs stay readable and accessible", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openView(page, "Open syringe example");
  await goToSample(page, "SP-001");
  await page.getByTestId("pv-diagram").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, "smp-method-b-syr-dark.png") });
  await expectAccessible(page, "method glyphs dark");
});

test("antibody demo: the shared-port sample shows its glyph, flush to waste and words", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openView(page, "Load demo");
  await expect(page.getByTestId("pv-glyph-SP-007")).toHaveAttribute("data-access", "shared_port");
  await expect(page.getByTestId("pv-waste-SP-007")).toContainText("30 mL to waste");
  await goToSample(page, "SP-007");
  await expect(page.getByTestId("pv-method-SP-007")).toContainText("shared port");
  await page.getByTestId("pv-diagram").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, "smp-method-b-arx-desktop.png") });
  await expectAccessible(page, "method glyphs antibody demo");
});
