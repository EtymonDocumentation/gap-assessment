// The third demo, "SYR-305 mid-transfer": the same syringe as the finished SYR-305 demo, part-way through the transfer, with open items a receiving
// site really has at this point. It is offered on the start page next to the other two (told apart in words), opens with its TRD showing the
// designed open-item number, a TBD list with three overdue items, and open items where the values flow. The finished SYR-305 demo still opens
// complete. Runs on the desktop, tablet and phone projects. The date is fixed to the demo date so "overdue" does not drift. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, openDemo, openMoreWays } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.clock.setFixedTime(new Date("2026-11-13T10:00:00"));
});

const shot = (name: string) => join(tmpdir(), `realgaps-${name}.png`);

async function noSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${where}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function expectAxeClean(page: Page, where: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test("the start page offers three demos and says in one line how the two SYR-305 demos differ", async ({ page }, info) => {
  await page.goto("./");
  await openMoreWays(page);
  const options = page.getByTestId("start-options");
  await expect(options.getByRole("button", { name: /^Open demo: / })).toHaveCount(3);
  await expect(options.getByRole("button", { name: "Open demo: SYR-305 syringe" })).toBeVisible();
  await expect(options.getByRole("button", { name: "Open demo: SYR-305 mid-transfer" })).toBeVisible();
  await expect(page.getByTestId("demo-difference")).toContainText("finished example with nothing left open");
  await expect(page.getByTestId("demo-difference")).toContainText("part-way through, with open items");
  await noSidewaysScroll(page, "start page");
  await expectAxeClean(page, "start page");
  await page.screenshot({ path: shot(`start-${info.project.name}`), fullPage: true });
});

test("the mid-transfer demo opens with its TRD open items, an overdue list and open items where the values flow", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "mid");

  // Home: the open-items link and the overdue count next to it (the gap assessment's own 11 entries, all marked TBD, 3 past their date).
  const card = page.getByRole("link", { name: "11 open items, 11 marked TBD" });
  await expect(card).toBeVisible();
  await expect(card.locator("xpath=..")).toContainText("(3 overdue)");
  await expect(page.getByTestId("home-chain")).toContainText("TRD-001, 21 open items");
  await noSidewaysScroll(page, "home");
  await expectAxeClean(page, "home");
  await page.screenshot({ path: shot(`home-${info.project.name}`), fullPage: true });

  // The TBD list: eleven rows, three overdue, each with its note.
  await card.click();
  await expect(page.getByRole("heading", { level: 1, name: "Open items" })).toBeVisible();
  await expect(page.locator("[role=status].tbd-summary")).toContainText("11 marked TBD (3 overdue)");
  await expect(page.locator("tbody tr")).toHaveCount(11);
  await expect(page.locator("tbody tr .tag-overdue")).toHaveCount(3);
  await expect(page.locator("tbody")).toContainText("Supplier has not yet sent the extractables data for the single-use filter assembly");
  await noSidewaysScroll(page, "TBD list");
  await expectAxeClean(page, "TBD list");
  await page.screenshot({ path: shot(`tbd-${info.project.name}`), fullPage: true });

  // The TRD: its one number, the blanks in the text of the descriptions, and the open items listed in the document.
  await goTo(page, "TRD");
  await expect(page.getByTestId("trd-list-table")).toContainText("SYR-305 technical requirements document (fictional)");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-output").click();
  await expect(page.getByTestId("trd-open-count")).toContainText("11 open items will be listed in the document.");
  await page.getByTestId("trd-preview-toggle").click();
  const preview = page.getByTestId("trd-preview");
  // The document lists the 11 open items and says the 10 blank fields in the descriptions are counted apart (21 in all, the number on Home).
  // A section whose value is not known yet shows its blank in square brackets, never an invented value.
  await expect(preview).toContainText("10 blank fields in the process descriptions have no value yet");
  await expect(preview).toContainText("[Drug substance item number]");
  await expect(preview).toContainText("[Product density, with the unit (g/mL)]");
  await expect(preview).toContainText("To be decided (TBD)");
  await noSidewaysScroll(page, "TRD output");
  await expectAxeClean(page, "TRD output");
  await page.screenshot({ path: shot(`trd-${info.project.name}`), fullPage: true });
});

test("the finished SYR-305 demo still opens complete", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toContainText("TRD-001, no open items");
  await goTo(page, "TRD");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await page.getByTestId("trd-tab-output").click();
  await expect(page.getByTestId("trd-open-count")).toContainText("No open items.");
});
