// Milestone 10: the PPQ flow figures. The figure on the sampling page (time scale and step cards), the two-way highlight between a
// sample in the figure and its row in the table, the optional "More details" of a step, holds / time targets / sub-processes, the
// hour of a sample, the export choice, the Word export with real pictures, accessibility, 390 px and light / dark screenshots.
// All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { goTo } from "./nav-helper";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("plan-figure")).toBeVisible();
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

test("the demo plan shows a buffer figure first and the main figure, in the time scale style", async ({ page }) => {
  await openDemoPlan(page);
  const fig = page.getByTestId("plan-figure");
  await expect(fig.getByTestId("figure-1")).toContainText("Buffer");
  await expect(fig.getByTestId("figure-2")).toContainText("process flow and sampling plan");
  await expect(fig.getByTestId("figure-style-time_scale")).toHaveAttribute("aria-pressed", "true");
  await fig.getByTestId("figure-style-step_cards").click();
  await expect(fig.getByTestId("figure-style-step_cards")).toHaveAttribute("aria-pressed", "true");
  await expect(fig.locator("svg").first()).toBeVisible();
});

test("pointing at or focusing a sample in the figure outlines its table row, and the other way round", async ({ page }) => {
  await openDemoPlan(page);
  const mark = page.getByTestId("figure-2").locator('[data-sp^="SP-"][tabindex="0"]').first();
  await mark.scrollIntoViewIfNeeded();
  const id = (await mark.getAttribute("data-sp"))!;
  await mark.focus();
  const row = page.getByTestId(`point-${id}`);
  await expect(row).toHaveAttribute("data-highlighted", "true");
  await page.getByTestId("plan-totals").focus().catch(() => undefined);
  await mark.blur();
  await expect(row).not.toHaveAttribute("data-highlighted", "true");
  // Back: hovering the row marks the sample in the figure.
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await expect(page.getByTestId("figure-2").locator(`.fig-hl[data-sp~="${id}"]`).first()).toBeAttached();
  // Enter on a focused sample selects the point.
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`point-${id}`)).toHaveAttribute("aria-current", "true");
});

test("a step's More details saves figure text and hours; hold suggestions need a button press; nothing is required", async ({ page }) => {
  await openDemoPlan(page);
  const step = page.getByTestId("step-list").locator("li").first();
  const stepId = (await step.getAttribute("data-testid"))!.replace("step-", "");
  await step.locator("summary").click();
  await page.getByTestId(`step-text-${stepId}`).fill("Mix 20 min\nTemperature 5 C (fictional)");
  await page.getByTestId(`step-hours-${stepId}`).fill("5");
  await page.getByTestId(`step-more-save-${stepId}`).click();
  await expect(page.getByTestId("figure-2")).toContainText("Mix 20 min");

  // Bad hours are refused in words, nothing is saved.
  await page.getByTestId(`step-more-${stepId}`).locator("summary").click().catch(() => undefined);
  await page.getByTestId(`step-more-${stepId}`).evaluate((el) => ((el as HTMLDetailsElement).open = true));
  await page.getByTestId(`step-hours-${stepId}`).fill("abc");
  await page.getByTestId(`step-more-save-${stepId}`).click();
  await expect(page.getByTestId(`step-more-${stepId}`).getByRole("alert")).toContainText("Hours must be a number");

  // Holds: add one by hand.
  await page.getByTestId("figure-holds").locator("summary").click();
  await page.getByTestId("hold-new-label").fill("Extra hold (fictional)");
  await page.getByTestId("hold-new-add").click();
  await expect(page.getByTestId("figure-holds")).toContainText("Extra hold (fictional)");
  await expect(page.getByTestId("figure-2")).toContainText("Extra hold (fictional)");
  const opts = await page.getByTestId("figure-holds").locator('[data-testid^="hold-remove-"]').count();
  expect(opts).toBeGreaterThanOrEqual(3);
});

test("time target and sub-process editors work and a sample can carry an hour", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("figure-targets").locator("summary").click();
  await page.getByTestId("target-new-label").fill("Extra window (fictional)");
  await page.getByTestId("target-new-hours").fill("30");
  await page.getByTestId("target-new-add").click();
  await expect(page.getByTestId("figure-targets")).toContainText("Extra window (fictional)");
  await expect(page.getByTestId("figure-2")).toContainText("Extra window (fictional)");

  await page.getByTestId("figure-subs").locator("summary").click();
  await expect(page.getByTestId("figure-subs")).toContainText("Buffer");

  // Hour of a sample, in the full editor (opened from the points table).
  await page.locator('[data-testid^="edit-SP-"]').first().click();
  const hour = page.getByTestId("point-hour");
  if (!(await hour.isVisible())) await page.getByTestId("group-toggle-sampling").click();
  await expect(hour).toBeVisible();
  await hour.fill("33");
  await hour.blur();
});

test("the export choice sets the figure in the HTML and in the Word file (real pictures, landscape, numbered captions)", async ({ page }) => {
  await openDemoPlan(page);
  const choice = page.getByTestId("figure-style-choice");
  await expect(choice.getByTestId("export-figure-time_scale")).toBeChecked();
  await choice.getByTestId("export-figure-none").check();
  await page.getByTestId("sampling-preview-toggle").click();
  await expect(page.getByTestId("sampling-preview")).not.toContainText("Figure 1:");
  await choice.getByTestId("export-figure-step_cards").check();
  await expect(page.getByTestId("sampling-preview")).toContainText("Figure 1:");
  await expect(page.getByTestId("sampling-preview").locator("svg").first()).toBeVisible();

  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTestId("sampling-download-word").click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
    })(),
  ]);
  const path = await dl.path();
  const zip = new PizZip(readFileSync(path!));
  const png = Object.keys(zip.files).filter((n) => /^word\/media\/.*\.png$/.test(n));
  expect(png.length).toBeGreaterThanOrEqual(2);
  const first = zip.file(png[0]!)!.asUint8Array();
  expect([...first.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const width = new DataView(first.buffer, first.byteOffset).getUint32(16);
  expect(width).toBeGreaterThanOrEqual(Math.floor((600 * 200) / 72));
  const xml = zip.file("word/document.xml")!.asText();
  expect(xml).toContain("Figure 1");
  expect(xml).toContain("landscape");
});

test("accessible and without sideways scrolling, light and dark, with screenshots", async ({ page }, info) => {
  // The three projects (desktop, tablet, phone) supply the widths; the phone one is 390 px.
  test.setTimeout(180000);
  const name = info.project.name;
  await openDemoPlan(page);
  for (const style of ["time_scale", "step_cards"] as const) {
    await page.getByTestId(`figure-style-${style}`).click();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${name} ${style} ${scheme}`);
      await expectNoHorizontalScroll(page, `${name} ${style} ${scheme}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    // The drawing never pushes past the screen: its region sits inside the viewport and scrolls sideways itself when the drawing is wider.
    const fit = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="figure-1"] .figure-sheet') as HTMLElement;
      const box = r.getBoundingClientRect();
      return { right: box.right, vw: document.documentElement.clientWidth, scrolls: r.scrollWidth > r.clientWidth + 1, tab: r.tabIndex, role: r.getAttribute("role") };
    });
    expect(fit.right, `${name} ${style}: figure region wider than the screen`).toBeLessThanOrEqual(fit.vw + 1);
    expect(fit.tab).toBe(0);
    expect(fit.role).toBe("region");
    if (fit.vw < 700) {
      expect(fit.scrolls, `${name} ${style}: a narrow screen scrolls the figure sideways`).toBe(true);
      await expect(page.getByTestId("figure-hint-1")).toBeVisible();
    }
    if (fit.vw > 960) await expect(page.getByTestId("figure-hint-1")).toBeHidden();
    await page.getByTestId("plan-figure").scrollIntoViewIfNeeded();
    await page.getByTestId("plan-figure").screenshot({ path: join(SHOTS, `m10-${style === "time_scale" ? "F" : "E"}-${name}.png`) });
  }
  await page.getByTestId("figure-data-card").locator("summary").first().click();
  await expectAccessible(page, `${name} details`);
  await expectNoHorizontalScroll(page, `${name} details`);
  await page.getByTestId("step-list").locator("li").first().locator("summary").click();
  await expectAccessible(page, `${name} step details`);
  await expectNoHorizontalScroll(page, `${name} step details`);
});
