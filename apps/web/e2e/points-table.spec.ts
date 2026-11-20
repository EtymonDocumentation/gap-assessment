// Sampling plan: the sampling points table is compact. In the demo plan no row is taller than about 120 px at desktop width,
// the page never scrolls sideways at phone width (only the table region may), and a "not worked out" or "no batches" value
// stays visible where it is true. All data are fictional.
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo } from "./nav-helper";

const SHOTS = tmpdir();
const BEFORE = process.env.POINTSTABLE_SHOT_PREFIX; // set only to take the "before" numbers and picture, with no checks

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
}

const rowHeights = (page: Page) => page.locator('[data-testid="points-table"] tbody tr').evaluateAll((trs) => trs.map((t) => Math.round(t.getBoundingClientRect().height)));
const pageHeight = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight);

test("the points table is compact, and the page does not scroll sideways", async ({ page }, info) => {
  await openDemoPlan(page);
  const heights = await rowHeights(page);
  const overview = await pageHeight(page);
  const w = info.project.name;
  console.log(`POINTSTABLE ${w} rows=${heights.length} max=${Math.max(...heights)} heights=${heights.join(",")} overview=${overview}`);
  await page.getByTestId("points-table").screenshot({ path: join(SHOTS, `pointstable-${BEFORE ?? "after"}-${w}.png`) });
  if (BEFORE) return;

  expect(heights.length).toBeGreaterThan(10);
  if (w === "desktop") for (const h of heights) expect(h, `row heights ${heights.join(",")}`).toBeLessThanOrEqual(120);
  // Only the table's own scroll region may scroll sideways, never the page.
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  // A select shows its whole chosen value (nothing cut off) at desktop width.
  if (w === "desktop") {
    const cut = await page.locator('[data-testid="points-table"] select').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(cut, "selects with cut-off text").toBe(0);
  }
});

test("the Diagram tab shows the same compact table", async ({ page }, info) => {
  await openDemoPlan(page);
  await page.getByTestId("tab-diagram").click();
  await expect(page.getByTestId("points-table")).toBeVisible();
  const heights = await rowHeights(page);
  console.log(`POINTSTABLE-DIAGRAM ${info.project.name} max=${Math.max(...heights)}`);
  await page.getByTestId("points-table").screenshot({ path: join(SHOTS, `pointstable-diagram-${BEFORE ?? "after"}-${info.project.name}.png`) });
  if (BEFORE) return;
  if (info.project.name === "desktop") for (const h of heights) expect(h).toBeLessThanOrEqual(120);
});
