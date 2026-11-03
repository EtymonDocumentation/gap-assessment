// How each sample is taken, drawn in the PPQ flow figures on the sampling page (both styles, both fictional demos): glyphs, study tag,
// "N mL to waste", the legend, the same facts in words under the figure, accessible, no sideways page scroll, screenshots.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openPlan(page: Page, demo: "syr" | "arx") {
  await page.goto("./");
  await openDemo(page, demo);
  await expect(page.getByTestId("home-chain")).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("plan-figure")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

for (const [demo, tag, only] of [
  ["Open demo: SYR-305 syringe", "syr", false],
  ["Open demo: ARX-217 vials", "arx", true],
] as const) {
  test(`${demo}: the flow figure shows how each sample is taken, in both styles`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const size = info.project.name;
    await openPlan(page, tag);
    for (const style of ["time_scale", "step_cards"] as const) {
      await page.getByTestId(`figure-style-${style}`).click();
      const fig = page.getByTestId("plan-figure");
      // Glyph lines and the flush label are inside the drawing; the legend names the glyphs present.
      await expect(fig.locator("svg text", { hasText: /\d+ mL to waste/ }).first()).toBeAttached();
      await expect(fig.locator("svg polyline").first()).toBeAttached();
      await expect(fig.locator("svg text", { hasText: "Flushed or discarded to waste before the sample" }).first()).toBeAttached();
      // The same facts in words under the figure (accessible text), only for samples whose method the plan states.
      const note = fig.locator('[data-testid^="figure-method-"]').first();
      await expect(note).toContainText("How the sample is taken, as the plan states it:");
      if (only) await expect(note).toContainText("SP-007");
      else {
        // SYR-305 has every branch: a study-only added part is dashed and tagged, and one port is shared.
        await expect(fig.locator("svg text", { hasText: /PPQ only|study only/ }).first()).toBeAttached();
        await expect(fig.locator("svg [data-share]").first()).toBeAttached();
      }
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectAccessible(page, `${demo} ${style} ${scheme} ${size}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${demo} ${style} ${scheme} ${size}: page scrolls sideways`).toBeLessThanOrEqual(1);
      }
      await page.emulateMedia({ colorScheme: "light" });
      await fig.scrollIntoViewIfNeeded();
      await fig.screenshot({ path: join(SHOTS, `smp-method-c-${tag}-${style}-${size}.png`) });
    }
  });
}
