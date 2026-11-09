// M13 job 3: the excipient library (list, open and edit with versions, remove with a logged reason), starting an assessment from it,
// "Save to the library" and "Update from library" on an excipient's page (Keep mine / Use the library's), and the Specifications tab
// polish (copy from the other site, the counts in the picker, the library's own prompts). Static build: the library lives in the browser.
// Fictional data only. The spec runs at the three widths of the config.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Excipient library test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, label).toBeLessThanOrEqual(0);
}

/** Saves one excipient in the library page: name, a listed role, and tests (name and note). */
async function saveRecord(page: Page, name: string, tests: { test: string; note?: string }[], opts: { role?: string; prompts?: string } = {}) {
  await hash(page, "#/excipient/library");
  await page.getByTestId("exl-new").click();
  await page.getByTestId("exl-name").fill(name);
  if (opts.role) await page.getByTestId("exl-class").selectOption(opts.role);
  for (const [i, t] of tests.entries()) {
    await page.getByTestId("exl-test-add").click();
    await page.getByTestId(`exl-test-name-${i}`).fill(t.test);
    if (t.note) await page.getByTestId(`exl-test-note-${i}`).fill(t.note);
  }
  if (opts.prompts) await page.getByTestId("exl-prompts").fill(opts.prompts);
  await page.getByTestId("exl-save").click();
  await expect(page.getByTestId("exl-message")).toContainText("version 1");
}

const SURF = "xl_surfactant_c_fictional";
const SURF_NAME = "Surfactant C (fictional)";

test("the library page: empty at first, a saved excipient, a new version that keeps the earlier one, and a removal with a reason", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/excipient");
  await page.getByTestId("module-library").getByRole("link", { name: "Excipient library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Excipient library" })).toBeVisible();
  await expect(page.getByText("Nothing is saved yet")).toBeVisible();

  await saveRecord(page, SURF_NAME, [{ test: "Assay" }, { test: "Peroxide value", note: "per batch" }], { role: "surfactant", prompts: "Fatty acid composition" });
  await expect(page.getByTestId(`exl-row-${SURF}`)).toContainText(SURF_NAME);
  await expect(page.getByTestId(`exl-row-${SURF}`)).toContainText("Surfactant");

  // opening and saving without a change makes no version
  await page.getByTestId(`exl-edit-${SURF}`).click();
  await expect(page.getByTestId("exl-form")).toContainText("now version 1");
  await page.getByTestId("exl-save").click();
  await expect(page.getByTestId("exl-message")).toContainText("Nothing changed");

  // a change makes version 2 and keeps version 1 in its history
  await page.getByTestId(`exl-edit-${SURF}`).click();
  await page.getByTestId("exl-test-add").click();
  await page.getByTestId("exl-test-name-2").fill("Water content");
  await page.getByTestId("exl-save").click();
  await expect(page.getByTestId("exl-message")).toContainText("version 2");
  await expect(page.getByTestId(`exl-row-${SURF}`)).toContainText("3");
  await page.getByTestId(`exl-edit-${SURF}`).click();
  await page.getByTestId("exl-history-toggle").click();
  await expect(page.getByTestId("exl-history")).toContainText("Version 1");
  await page.getByRole("button", { name: "Cancel" }).click();

  // removing asks for a reason and says so in words when it is missing
  await page.getByTestId(`exl-remove-${SURF}`).click();
  await page.getByTestId("exl-remove-confirm").click();
  await expect(page.getByTestId("exl-remove-msg")).toBeVisible();
  await page.getByTestId("exl-remove-reason").fill("Replaced by a newer record (fictional)");
  await page.getByTestId("exl-remove-confirm").click();
  await expect(page.getByTestId(`exl-row-${SURF}`)).toHaveCount(0);
  await page.getByTestId("exl-removed").locator("summary").click();
  await expect(page.getByTestId("exl-removed")).toContainText("Replaced by a newer record (fictional)");
});

test("Start from the library: nothing to pick while the library is empty, then pick two and the assessment has those lines", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/excipient");
  await expect(page.getByText("The excipient library comes next")).toHaveCount(0);
  await page.getByTestId("ex-start-library").click();
  await expect(page.getByTestId("ex-lib-none")).toBeVisible();
  await page.getByTestId("ex-lib-cancel").click();

  await saveRecord(page, SURF_NAME, [{ test: "Assay" }, { test: "Peroxide value", note: "per batch" }], { role: "surfactant" });
  await saveRecord(page, "Sugar B (fictional)", [{ test: "Identification" }]);
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-library").click();
  await expect(page.getByTestId("ex-lib-picker")).toBeVisible();
  // nothing is ticked and nothing can be made until something is
  await expect(page.getByTestId("ex-lib-make")).toBeDisabled();
  await page.getByTestId(`ex-lib-item-${SURF}`).getByRole("checkbox").check();
  await page.getByTestId("ex-lib-item-xl_sugar_b_fictional").getByRole("checkbox").check();
  await page.getByTestId("ex-lib-make").click();
  await expect(page.getByTestId("ex-lines-table")).toContainText(SURF_NAME);
  await expect(page.getByTestId("ex-lines-table")).toContainText("Sugar B (fictional)");
  await page.getByTestId("ex-tab-specs").click();
  await page.getByTestId("ex-specs-line").selectOption({ label: `${SURF_NAME} (2 tests, 2 not compared)` });
  await expect(page.getByTestId("ex-specs-counts")).toContainText("0 tests compared");
  await expect(page.getByTestId("ex-row-EXR-001")).toBeVisible();
  await expect(page.getByTestId("ex-row-note-EXR-002")).toHaveValue("per batch");
  // the saved values are empty: both sites start open
  await expect(page.getByTestId("ex-result-EXR-001")).toContainText("Not compared yet");
});

test("Save to the library, then Update from library: Keep mine is the start, and only chosen changes are applied", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await page.getByTestId("ex-add-name").fill(SURF_NAME);
  await page.getByTestId("ex-add-btn").click();
  await expect(page.getByTestId("ex-lines-table")).toContainText(SURF_NAME);
  await page.getByTestId("ex-tab-specs").click();
  await page.getByTestId("ex-spec-new").fill("Assay");
  await page.getByTestId("ex-spec-add").click();
  await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
  await expect(page.getByTestId("ex-line-library")).toBeVisible();

  // first save: one button, version 1
  await page.getByTestId("ex-line-lib-save").click();
  await page.getByTestId("ex-line-lib-save-new").click();
  await expect(page.getByTestId("ex-line-lib-message")).toContainText("version 1");

  // the library gets a newer version (a test and a note) on its own page
  await hash(page, "#/excipient/library");
  await page.getByTestId(`exl-edit-${SURF}`).click();
  await page.getByTestId("exl-test-add").click();
  await page.getByTestId("exl-test-name-1").fill("Water content");
  await page.getByTestId("exl-test-note-1").fill("loss on drying");
  await page.getByTestId("exl-save").click();
  await expect(page.getByTestId("exl-message")).toContainText("version 2");

  await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
  await page.getByTestId("ex-line-lib-update").click();
  // the saved excipient with the same name is the one compared
  await expect(page.getByTestId("ex-lib-source")).toHaveValue(SURF);
  const change = page.getByTestId("ex-lib-change-test:water content");
  await expect(change).toBeVisible();
  // "Leave it out" is on at first
  await expect(page.getByTestId("ex-lib-keep-test:water content")).toBeChecked();
  await expectNoSidewaysScroll(page, "update panel");
  await expectAccessible(page, "update panel");
  // applying with nothing chosen changes nothing
  await page.getByTestId("ex-lib-apply").click();
  await expect(page.getByTestId("ex-line-lib-message")).toContainText("Nothing was changed");
  await page.getByTestId("ex-line-lib-update").click();
  await page.getByTestId("ex-lib-change-use-test:water content").check();
  await page.getByTestId("ex-lib-apply").click();
  await expect(page.getByTestId("ex-line-lib-message")).toContainText("1 change applied");
  await page.getByTestId("ex-line-specs-link").click();
  await expect(page.getByTestId("ex-row-EXR-002")).toBeVisible();
  await expect(page.getByTestId("ex-row-note-EXR-002")).toHaveValue("loss on drying");

  // a second save finds the saved excipient and offers its next version or a separate one
  await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
  await page.getByTestId("ex-line-lib-save").click();
  await expect(page.getByTestId("ex-line-lib-save-version")).toHaveText("Save as version 3");
  await expect(page.getByTestId("ex-line-lib-save-new")).toHaveText("Save as a separate one");
});

test("Update from library: a different name or role is kept unless the library's is chosen", async ({ page }) => {
  await newProject(page);
  await saveRecord(page, "Surfactant C2 (fictional)", [{ test: "Assay" }], { role: "surfactant" });
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await page.getByTestId("ex-add-name").fill(SURF_NAME);
  await page.getByTestId("ex-add-btn").click();
  await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
  await page.getByTestId("ex-line-lib-update").click();
  // no saved excipient has this name, so nothing is chosen for the person
  await expect(page.getByTestId("ex-lib-source")).toHaveValue("");
  await page.getByTestId("ex-lib-source").selectOption("xl_surfactant_c2_fictional");
  await expect(page.getByTestId("ex-lib-change-name")).toContainText("Surfactant C2 (fictional)");
  await expect(page.getByTestId("ex-lib-keep-name")).toBeChecked();
  await page.getByTestId("ex-lib-change-use-class").check();
  await page.getByTestId("ex-lib-apply").click();
  await expect(page.getByTestId("ex-line-lib-message")).toContainText("1 change applied");
  await expect(page.getByTestId("ex-line-name")).toHaveValue(SURF_NAME);
  await expect(page.getByTestId("ex-line-pill-class")).toContainText("Surfactant");
});

test("Specifications: copy from the other site fills only empty boxes; the picker shows counts; the library's own prompts are offered", async ({ page }) => {
  await newProject(page);
  await saveRecord(page, SURF_NAME, [], { prompts: "Fatty acid composition" });
  await hash(page, "#/excipient");
  await page.getByTestId("ex-start-blank").click();
  await page.getByTestId("ex-add-name").fill(SURF_NAME);
  await page.getByTestId("ex-add-btn").click();
  await page.getByTestId("ex-add-name").fill("Sugar B (fictional)");
  await page.getByTestId("ex-add-btn").click();
  await page.getByTestId("ex-tab-specs").click();
  await expect(page.getByTestId("ex-specs-line").locator("option").first()).toHaveText(`${SURF_NAME} (no tests yet)`);

  // the library's own prompt shows as a button; nothing is added until it is picked
  await expect(page.getByTestId("ex-specs-lib-prompts")).toContainText("Fatty acid composition");
  await expect(page.getByTestId("ex-specs-none")).toBeVisible();
  await page.getByTestId("ex-libprompt-fatty-acid-composition").click();
  await expect(page.getByTestId("ex-row-name-EXR-001")).toHaveValue("Fatty acid composition");
  await expect(page.getByTestId("ex-specs-lib-prompts")).toHaveCount(0);

  await page.getByTestId("ex-spec-new").fill("Assay");
  await page.getByTestId("ex-spec-add").click();
  await expect(page.getByTestId("ex-copy-EXR-002-receiving")).toHaveCount(0);
  await page.getByTestId("ex-method-EXR-002-sending").fill("HPLC");
  await page.getByTestId("ex-criterion-EXR-002-sending").fill("98.0 to 102.0");
  await page.getByTestId("ex-row-note-EXR-002").click();
  await expect(page.getByTestId("ex-copy-EXR-002-receiving")).toBeVisible();
  // what is already written on the receiving side stays
  await page.getByTestId("ex-method-EXR-002-receiving").fill("Titration");
  await page.getByTestId("ex-row-note-EXR-002").click();
  await expectNoSidewaysScroll(page, "specs with copy");
  await expectAccessible(page, "specs with copy");
  await page.getByTestId("ex-copy-EXR-002-receiving").click();
  await expect(page.getByTestId("ex-method-EXR-002-receiving")).toHaveValue("Titration");
  await expect(page.getByTestId("ex-criterion-EXR-002-receiving")).toHaveValue("98.0 to 102.0");
  await expect(page.getByTestId("ex-result-EXR-002")).toContainText("Same");
  await expect(page.getByTestId("ex-copy-EXR-002-receiving")).toHaveCount(0);
  await expect(page.getByTestId("ex-specs-line").locator("option").first()).toHaveText(`${SURF_NAME} (2 tests, 1 not compared)`);
});

for (const theme of ["Light", "Dark"] as const) {
  test(`${theme}: the library page, its form, the picker and the excipient's library box have no sideways scroll and no serious accessibility problems`, async ({ page }) => {
    await newProject(page);
    await setTheme(page, theme);
    await hash(page, "#/excipient/library");
    await expect(page.getByTestId("exl-page")).toBeVisible();
    await expectNoSidewaysScroll(page, "library, empty");
    await expectAccessible(page, `library, empty, ${theme}`);
    await saveRecord(page, SURF_NAME, [{ test: "Assay", note: "per batch" }, { test: "Peroxide value" }], { role: "surfactant", prompts: "Fatty acid composition" });
    await expectNoSidewaysScroll(page, "library, one saved");
    await expectAccessible(page, `library, one saved, ${theme}`);
    await page.getByTestId(`exl-edit-${SURF}`).click();
    await expectNoSidewaysScroll(page, "library form");
    await expectAccessible(page, `library form, ${theme}`);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId(`exl-remove-${SURF}`).click();
    await expectAccessible(page, `remove dialog, ${theme}`);
    await page.getByTestId("exl-remove-keep").click();

    await hash(page, "#/excipient");
    await page.getByTestId("ex-start-library").click();
    await expect(page.getByTestId("ex-lib-picker")).toBeVisible();
    await expectNoSidewaysScroll(page, "picker");
    await expectAccessible(page, `picker, ${theme}`);
    await page.getByTestId(`ex-lib-item-${SURF}`).getByRole("checkbox").check();
    await page.getByTestId("ex-lib-make").click();
    await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
    await page.getByTestId("ex-line-lib-save").click();
    await expect(page.getByTestId("ex-line-lib-save-version")).toBeVisible();
    await expectNoSidewaysScroll(page, "line library box");
    await expectAccessible(page, `line library box, ${theme}`);
  });
}
