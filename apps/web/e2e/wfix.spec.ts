// Walk-through fixes (2026-11): sampling "Open" brings the card into view, removing a point asks first, the Plan details labels wrap
// normally on a phone, the risk demo has bands, a TRD override keeps the project value's unit, and the TRD "Product and site" note
// only says "project" when the TRD is made from a project. Screenshots go to the temp folder as wfix-*.png. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openAbout, openDemo } from "./nav-helper";

const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `wfix-${name}.png`) });

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page, which: "arx" | "syr" = "arx") {
  await page.goto("./");
  await openDemo(page, which, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** The syringe demo has the longer plan (SP-018 is well below the top of the points table). */
async function openDemoPlan(page: Page, which: "arx" | "syr" = "syr") {
  await loadDemo(page, which);
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("flow-diagram")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function inViewport(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.top < window.innerHeight && r.bottom > 0;
  });
}

test("sampling: Open on a point in the table brings its card into view and puts focus on its heading", async ({ page }) => {
  await openDemoPlan(page);
  const open = page.getByTestId("edit-SP-018");
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page.getByTestId("card-title-SP-018")).toBeFocused();
  await expect.poll(() => inViewport(page, "card-SP-018")).toBe(true);
  await shot(page, "sp018-open");
});

test("sampling: removing a point asks first (Cancel has focus), and Cancel keeps it", async ({ page }) => {
  await openDemoPlan(page);
  const row = page.getByTestId("point-SP-018");
  await row.scrollIntoViewIfNeeded();
  await page.getByTestId("remove-SP-018").click();
  const dialog = page.getByRole("dialog", { name: "Delete SP-018?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("remove-cancel")).toBeFocused();
  await shot(page, "delete-confirm");
  await expectAccessible(page, "delete confirm");
  await page.getByTestId("remove-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeVisible();
  // Asking again and going ahead removes it.
  await page.getByTestId("remove-SP-018").click();
  await page.getByTestId("remove-confirm").click();
  await expect(row).toHaveCount(0);
});

test("sampling: the Plan details labels wrap like normal text at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openDemoPlan(page);
  const summary = page.getByTestId("plan-details-summary");
  await summary.scrollIntoViewIfNeeded();
  const label = summary.locator("dt", { hasText: "Why this number of batches" });
  await expect(label).toBeVisible();
  // One word per line would make the label as tall as five or six lines; two lines at most is normal.
  const { height, line } = await label.evaluate((el) => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || 20 }));
  expect(height).toBeLessThanOrEqual(line * 2.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "plan-details-390");
});

test("risk: the demo method has bands, so no demo item says (no band)", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "Risk assessment");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-items").click();
  await expect(page.locator("main")).toContainText("Medium (fictional wording)");
  await expect(page.locator("main")).not.toContainText("(no band)");
  await shot(page, "risk-bands");
});

test("TRD: a bare number typed over a project value with a unit keeps that unit", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "TRD");
  await openAbout(page);
  await page.getByTestId("trd-title-input").fill("Override unit (fictional)");
  await page.getByTestId("trd-start-project").check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-process").click();
  await page.getByTestId("trd-steps-open-all").click();
  // The first item field whose project value is a number and a unit, such as "4 h". The items show their values in a summary until opened.
  const cards = page.locator("article.trd-item");
  let found = "";
  let unit = "";
  for (let i = 0; i < (await cards.count()) && !found; i++) {
    const card = cards.nth(i);
    for (const line of await card.locator(".trd-item-summary li").allInnerTexts()) {
      const m = /^(.+?): -?\d+(?:\.\d+)? ([^\d\s].*?)\s*$/.exec(line.trim());
      if (!m) continue;
      unit = m[2]!;
      await page.getByTestId(`${await card.getAttribute("data-testid")}-edit`).click();
      const row = card.locator("li.trd-field").filter({ has: page.locator(".trd-field-label").getByText(m[1]!, { exact: true }) });
      found = (await row.first().getAttribute("data-testid")) ?? "";
      break;
    }
  }
  expect(found, "a field with a number and a unit").not.toBe("");
  await page.getByTestId(`${found}-edit`).click();
  await page.getByTestId(`${found}-toggle`).check();
  await page.getByTestId(`${found}-display`).fill("5");
  await page.getByTestId(`${found}-save`).click();
  await expect(page.getByTestId(`${found}-value`)).toHaveText(`5 ${unit}`);
  await page.getByTestId(found).scrollIntoViewIfNeeded();
  await shot(page, "trd-override-unit");
});

test("TRD: a blank TRD does not say its Product and site values come from the project", async ({ page }) => {
  await loadDemo(page);
  await goTo(page, "TRD");
  await openAbout(page);
  await page.getByTestId("trd-title-input").fill("Blank (fictional)");
  await page.getByTestId("trd-start-blank").check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-details").click();
  const note = page.getByTestId("trd-product-note");
  await expect(note).toContainText("Type the values here");
  await expect(note).not.toContainText("project");
  await note.scrollIntoViewIfNeeded();
  await shot(page, "trd-blank-product");
});
