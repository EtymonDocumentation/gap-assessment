// The Guidance library: opens without a project, searches and filters, links to official sites, accessibility and the
// phone layout. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("./#/guidance");
  await expect(page.getByRole("heading", { level: 1, name: "Guidance" })).toBeVisible();
}

/** A drop-down by its label. The label wraps the select, so its accessible name also carries the chosen option. */
const field = (page: Page, label: string) => page.getByRole("combobox", { name: new RegExp(`^${label}`) });

const entries = (page: Page) => page.locator("main li.guide-item");

async function shownCount(page: Page): Promise<number> {
  const text = (await page.getByRole("status").filter({ hasText: /shown$/ }).textContent()) ?? "";
  return Number(/^(\d+) of \d+ shown/.exec(text.trim())?.[1]);
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

test("opens without a project, with the note, the last-checked date and every item", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Proof of concept. Not validated. Not for GMP use.").first()).toBeVisible();
  await expect(page.getByText("Links open the official agency site. Always confirm you are reading the current version there.")).toBeVisible();
  await expect(page.getByText(/Last checked: \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveText("162 of 162 shown");
  await expect(entries(page)).toHaveCount(162);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Guidance" })).toHaveAttribute("aria-current", "page");
});

test("search narrows the results and a filter narrows them further; Clear filters restores", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "Search" }).fill("annex 1");
  const afterSearch = await shownCount(page);
  expect(afterSearch).toBeGreaterThan(0);
  expect(afterSearch).toBeLessThan(162);
  // Every word has to match, so the EU Annex 1 entry is among the hits.
  await expect(entries(page).filter({ hasText: "Manufacture of Sterile Medicinal Products" }).first()).toBeVisible();

  await field(page, "Jurisdiction or market").selectOption("EU");
  const afterFilter = await shownCount(page);
  expect(afterFilter).toBeGreaterThan(0);
  expect(afterFilter).toBeLessThanOrEqual(afterSearch);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: /^European Union/ })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  await expect(field(page, "Jurisdiction or market")).toHaveValue("all");
  await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveText("162 of 162 shown");
});

test("every filter works, and a search with no match says so", async ({ page }) => {
  await open(page);
  for (const [label, value] of [["Agency", "ICH"], ["Topic", "cci"], ["Type", "annex"], ["Status", "draft"]] as const) {
    await field(page, label).selectOption(value);
    const n = await shownCount(page);
    expect(n, label).toBeGreaterThan(0);
    expect(n, label).toBeLessThan(162);
    await page.getByRole("button", { name: "Clear filters" }).click();
    expect(await shownCount(page)).toBe(162);
  }
  await page.getByRole("searchbox", { name: "Search" }).fill("zzzz-no-such-guidance");
  await expect(page.getByRole("status").filter({ hasText: "shown" })).toHaveText("0 of 162 shown");
  await expect(page.getByText("Nothing matches.")).toBeVisible();
});

test("links go to the official site in a new tab and the cues are in words", async ({ page }) => {
  await open(page);
  const link = page.getByRole("link", { name: /^21 CFR Part 211/ });
  await expect(link).toHaveAttribute("href", "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-C/part-211");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await expect(link).toContainText("(opens in new tab)");

  // Every link on the page follows the same rule.
  const bad = await page.locator("main li.guide-item a").evaluateAll((as) =>
    as.filter((a) => !(a as HTMLAnchorElement).href.startsWith("https://") || a.getAttribute("target") !== "_blank" || !/noopener/.test(a.getAttribute("rel") ?? "")).length,
  );
  expect(bad).toBe(0);

  // Words, not colour: the badge, the subscription note and the blocked-site note are text.
  await expect(entries(page).filter({ hasText: "Details to confirm" }).first()).toBeVisible();
  await expect(entries(page).filter({ hasText: "Subscription needed" }).first()).toBeVisible();
  await expect(entries(page).filter({ hasText: "Official site; blocks automated checks" }).first()).toBeVisible();
});

test("accessible in light and dark, with no sideways page scroll", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expectAccessible(page, `guidance ${scheme}`);
    await expectNoHorizontalScroll(page, `guidance ${scheme}`);
    await page.getByRole("searchbox", { name: "Search" }).fill("sterile");
    await field(page, "Status").selectOption("final");
    await expectAccessible(page, `guidance ${scheme} filtered`);
  }
});

test.describe("phone width (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no sideways page scroll, filters and links usable", async ({ page }) => {
    await open(page);
    await expectNoHorizontalScroll(page, "guidance phone");
    await page.getByRole("searchbox", { name: "Search" }).fill("annex 1");
    await expectNoHorizontalScroll(page, "guidance phone search");
    await expect(entries(page).first().getByRole("link").first()).toBeVisible();
  });
});
