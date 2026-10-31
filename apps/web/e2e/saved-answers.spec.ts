// Saved answers: save the answers of one project as a named set (SU only), apply it to a second project through a review list with one
// row unticked, see where each applied answer came from, export and import a set file, and refuse bad files. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SET_NAME = "Site North answers (fictional)";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const shotDir = process.env.TEMP ?? tmpdir();
async function shot(page: Page, what: string) {
  const name = test.info().project.name;
  if (name === "desktop" || name === "phone") await page.screenshot({ path: join(shotDir, `saved-answers-${what}-${name}.png`) });
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations).toEqual([]);
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function openDemo(page: Page, which: "Load demo" | "Open syringe example") {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  const details = page.getByTestId("before-you-start");
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
  await page.getByRole("button", { name: which }).click();
  await expect(page.getByTestId("home-chain").or(page.getByRole("heading", { level: 1, name: "Gap register" }))).toBeVisible();
}

test("save an SU-only set, apply it to a second project with one row unticked, and see where the answers came from", async ({ page }) => {
  test.setTimeout(150_000);
  await openDemo(page, "Load demo");
  await go(page, "#/interview");
  await expect(page.getByTestId("saved-answers-card")).toBeVisible();

  // Save: the name and the unit are required, nothing is chosen for the author.
  await page.getByTestId("saved-save").click();
  const save = page.getByRole("dialog", { name: "Save these answers" });
  await save.getByTestId("sa-save-submit").click();
  await expect(save.getByTestId("sa-save-error")).toContainText("name");
  await save.getByTestId("sa-save-name").fill(SET_NAME);
  await expect(save.getByTestId("sa-side-source")).not.toBeChecked();
  await expect(save.getByTestId("sa-side-target")).not.toBeChecked();
  await save.getByTestId("sa-save-submit").click();
  await expect(save.getByTestId("sa-save-error")).toContainText("unit");
  await save.getByTestId("sa-side-source").check();
  await expect(save.getByTestId("sa-save-preview")).toContainText("will be saved");
  await shot(page, "save");
  await axeClean(page);
  await noSideScroll(page);
  await save.getByTestId("sa-save-submit").click();
  await expect(save).toBeHidden();

  // The set is on the Saved answers page (Library menu), with its units, question count and source project.
  await goTo(page, "Saved answers");
  await expect(page.getByRole("heading", { level: 1, name: /Saved answers/ })).toBeVisible();
  const table = page.getByTestId("sa-table");
  await expect(table).toContainText(SET_NAME);
  await expect(table).toContainText("SU");
  await expect(table).toContainText(/ARX-217/);
  await shot(page, "list");
  await axeClean(page);
  await noSideScroll(page);

  // A second project: the syringe example replaces the open one in this browser; the saved set stays.
  await openDemo(page, "Open syringe example");
  await go(page, "#/interview");
  await page.getByTestId("saved-apply").click();
  const apply = page.getByRole("dialog", { name: "Apply saved answers" });
  await apply.getByTestId("sa-apply-set").selectOption({ index: 1 });
  await expect(apply.getByTestId("sa-apply-summary")).toContainText("can be applied here");

  // Every row that can be applied starts ticked.
  const rows = apply.locator('li[data-testid^="sa-row-"]');
  const total = await rows.count();
  expect(total).toBeGreaterThan(3);
  const boxes = rows.locator('input[type="checkbox"]');
  for (let i = 0; i < total; i++) await expect(boxes.nth(i)).toBeChecked();

  // A row whose question already has a different answer says so and shows both values.
  const differs = apply.locator('[data-testid^="sa-differs-"]');
  expect(await differs.count()).toBeGreaterThan(0);
  await expect(differs.first()).toContainText("already has a different answer");
  await expect(differs.first()).toContainText("Now:");
  await expect(differs.first()).toContainText("Saved set:");

  // Questions this project does not ask are listed and skipped.
  const skipped = apply.locator('li[data-testid^="sa-skip-"]');
  if ((await skipped.count()) > 0) await expect(skipped.first()).toContainText(/Not asked in this project|Cannot be applied/);

  // Untick the first row, keep the second; apply.
  const keyOf = async (i: number) => (await rows.nth(i).getAttribute("data-testid"))!.replace("sa-row-", "");
  const unticked = await keyOf(0);
  const kept = await keyOf(1);
  await boxes.nth(0).uncheck();
  await expect(apply.getByTestId("sa-apply-submit")).toHaveText(`Apply ${total - 1} answers`);
  await shot(page, "apply-review");
  await axeClean(page);
  await noSideScroll(page);
  await apply.getByTestId("sa-apply-submit").click();
  await expect(apply).toBeHidden();

  // The applied answer carries its source on the question; the unticked one does not.
  await go(page, `#/interview?q=${encodeURIComponent(kept)}`);
  const note = page.getByTestId(`saved-note-${kept}`);
  await expect(note).toContainText(`From saved answers: ${SET_NAME}, ${new Date().toISOString().slice(0, 10)}`);
  await shot(page, "applied-note");
  await noSideScroll(page);
  await go(page, `#/interview?q=${encodeURIComponent(unticked)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId(`saved-note-${unticked}`)).toHaveCount(0);

  // It is in the change log too.
  await go(page, "#/changes");
  await expect(page.getByText(`From saved answers: ${SET_NAME}`).first()).toBeVisible();
});

test("export a set to a file, delete it (with a confirm step), import the file back, rename it, and refuse bad files", async ({ page }) => {
  test.setTimeout(150_000);
  await openDemo(page, "Load demo");
  await go(page, "#/interview");
  await page.getByTestId("saved-save").click();
  const save = page.getByRole("dialog", { name: "Save these answers" });
  await save.getByTestId("sa-save-name").fill(SET_NAME);
  await save.getByTestId("sa-side-both").check();
  await save.getByTestId("sa-save-submit").click();
  await expect(save).toBeHidden();
  await goTo(page, "Saved answers");
  const table = page.getByTestId("sa-table");
  await expect(table).toContainText("SU and RU");

  // Export gives a JSON file that says what it is.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: `Export set ${SET_NAME}` }).click();
  const dl = await downloadPromise;
  mkdirSync(shotDir, { recursive: true });
  const file = join(shotDir, `saved-answers-roundtrip-${test.info().project.name}.json`);
  await dl.saveAs(file);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  expect(parsed).toMatchObject({ format: "gap-saved-answers", name: SET_NAME, sides: "both" });
  expect(parsed.answers.length).toBeGreaterThan(10);

  // Delete needs a confirm step; "Keep it" leaves the set.
  await page.getByRole("button", { name: `Delete ${SET_NAME}` }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(table).toContainText(SET_NAME);
  await page.getByRole("button", { name: `Delete ${SET_NAME}` }).click();
  await page.getByTestId("sa-confirm-delete").click();
  await expect(page.getByText("No saved sets yet")).toBeVisible();

  // Import the file back: the set returns with the same content.
  await page.getByTestId("sa-import-file").setInputFiles(file);
  await expect(page.getByTestId("sa-message")).toContainText(`Imported "${SET_NAME}"`);
  await expect(table).toContainText(SET_NAME);

  // Rename.
  await page.getByRole("button", { name: `Rename ${SET_NAME}` }).click();
  await page.getByTestId("sa-rename-input").fill("Renamed set (fictional)");
  await page.getByTestId("sa-rename-save").click();
  await expect(table).toContainText("Renamed set (fictional)");
  await noSideScroll(page);

  // Bad files are refused with a plain message and nothing is added.
  const bad = (name: string, text: string) => {
    const f = join(shotDir, name);
    writeFileSync(f, text);
    return f;
  };
  const err = page.getByTestId("sa-import-error");
  await page.getByTestId("sa-import-file").setInputFiles(bad("sa-bad-1.json", "this is not json"));
  await expect(err).toContainText("Import failed");
  await page.getByTestId("sa-import-file").setInputFiles(bad("sa-bad-2.json", JSON.stringify({ title: "a project file" })));
  await expect(err).toContainText("not a saved answer set");
  await shot(page, "import-error");
  await axeClean(page);
  await noSideScroll(page);
  const broken = { ...parsed, answers: [{ questionId: "x", side: "source", input: { kind: "tbd" } }] };
  await page.getByTestId("sa-import-file").setInputFiles(bad("sa-bad-3.json", JSON.stringify(broken)));
  await expect(err).toContainText("damaged or incomplete");
  await expect(table.locator("tbody tr")).toHaveCount(1);
});
