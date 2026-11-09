// Walk-through fixes (rows 4 to 7): a project with nothing entered must not get a TRD that states product facts, a record with nothing in it
// must not read "Nothing open", and an interview of "to be decided" answers must not read "complete". All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Nothing entered (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
}

test("a TRD of a new project shows blanks, not facts nobody entered", async ({ page }) => {
  test.setTimeout(120_000);
  await newProject(page);
  await goTo(page, "TRD");
  await page.getByTestId("trd-title-input").fill("TRD nothing entered (fictional)");
  await page.getByTestId("trd-start-project").check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-output").click();
  await page.getByTestId("trd-preview-toggle").click();
  const main = page.getByTestId("trd-preview");
  for (const fact of [/Vacuum-assisted stoppering is required/, /dry ice/i, /frozen bottles/i, /Grade C or better/, /Syringes are filled and stoppered in line/, /aluminium seal/i, /The material must be protected from light during/]) {
    await expect(main, String(fact)).not.toContainText(fact);
  }
  await expect(main).toContainText("[Air quality and grade for open manipulations]");
  await expect(main).toContainText("[Flush medium]");
  await expect(main).toContainText(/\d+, and \d+ blank fields? in the text/);
  await page.screenshot({ path: join(tmpdir(), "fix1-trd-new-after.png"), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("a batch record with no purpose and no steps lists what it leaves open", async ({ page }) => {
  test.setTimeout(120_000);
  await newProject(page);
  await goTo(page, "TRD");
  await page.getByTestId("trd-title-input").fill("TRD for the empty record (fictional)");
  await page.getByTestId("trd-start-project").check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-title-input").fill("Empty record (fictional)");
  await page.getByTestId("mbr-start-trd").check();
  await page.getByTestId("mbr-start-trd-select").selectOption({ index: 1 });
  await page.getByTestId("mbr-create").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  const open = page.getByTestId("mbr-open-items");
  await expect(open).not.toContainText("Nothing open");
  await expect(open).not.toContainText("Open items (0)");
  await expect(open).toContainText("No purpose entered");
  await expect(open).toContainText("No steps yet");
  await expect(open).toContainText(/The TRD still has \d+ open items?/);
  await page.screenshot({ path: join(tmpdir(), "fix1-mbr-empty-after.png"), fullPage: true });
});

test("an interview answered with 'to be decided' is not called complete", async ({ page }) => {
  await newProject(page);
  await page.goto("./#/interview");
  await page.getByRole("button", { name: "TBD (to be decided)" }).first().click();
  const text = (await page.locator(".interview-aside").innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\d+ of \d+ answered, complete/);
  expect(text).toMatch(/\d+ of \d+ answered, \d+ open items? \(\d+ to be decided\)/);
  await page.screenshot({ path: join(tmpdir(), "fix1-interview-tbd-after.png"), fullPage: true });
});
