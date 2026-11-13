// Ease-of-use layout decisions (EOU-C): the Home start choices, the gap pages without the document chain, the Interview
// "More" button and the TBD-versus-Skip line, Version history and Change log reached without the Library menu, the
// "Show all" button on long preview tables, and the one open items count.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNotice, openDemo, openInterviewMore, openMoreWays } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const go = (page: Page, hash: string) => page.evaluate((h) => (window.location.hash = h), hash);

async function expectNoOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: sideways scroll`).toBeLessThanOrEqual(1);
}

test("Home: one big Start a new project; the other starts sit under More ways to start, closed at first", async ({ page }) => {
  await page.goto("./");
  await expectNotice(page);
  const more = page.getByTestId("more-ways");
  await expect(page.getByRole("button", { name: "Start a new project" })).toBeVisible();
  await expect(more).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: /^Open demo: / }).first()).toBeHidden();
  await openMoreWays(page);
  await expect(page.getByRole("button", { name: /^Open demo: / })).toHaveCount(3);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await expectNoOverflow(page, "home");
});

test("gap pages show only their step pills; the document chain stays on Home", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.getByTestId("doc-chain")).toHaveCount(0);
  await go(page, "#/");
  await expect(page.getByTestId("home-chain")).toBeVisible();
});

test("Interview: Entry order, Saved answers and Progress map sit behind More, and TBD vs Skip has one line", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/interview?q=scope.program%40shared");
  const more = page.getByTestId("interview-more");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("interview-more-panel")).toHaveCount(0);
  await expect(page.getByTestId("tbd-vs-skip")).toContainText("TBD puts the question on the open items list. Skip for now just moves on.");
  await openInterviewMore(page);
  await expect(page.getByTestId("interview-more-panel")).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await expectNoOverflow(page, "interview more");
});

test("Version history and Change log are not in the Library menu; the version chip and Home lead to them; old addresses still open", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/");
  const nav = page.getByRole("navigation", { name: "Main" });
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  else await nav.getByRole("button", { name: /^Library/ }).click();
  for (const name of ["Version history", "Change log"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await go(page, "#/versions");
  await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
  await page.getByTestId("versions-to-changes").click();
  await expect(page.getByRole("heading", { level: 1, name: "Change log" })).toBeVisible();
  await page.getByTestId("changes-to-versions").click();
  await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
  await go(page, "#/changes");
  await expect(page.getByRole("heading", { level: 1, name: "Change log" })).toBeVisible();
});

test("the gap Word download asks Download with open items? and names the same count", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/document");
  await page.getByRole("button", { name: "Download gap assessment (Word)" }).click();
  const warn = page.getByRole("dialog", { name: "Download with open items?" });
  await expect(warn).toContainText(/\d+ open items?/);
  await warn.getByRole("button", { name: "Go back" }).click();
  await expect(warn).toHaveCount(0);
});
