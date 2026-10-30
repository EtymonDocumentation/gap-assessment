// The document chain (gap assessment, TRD, sampling plan, batch record, Process view): the strip on Home and every document page, the
// Next / Back bar, the module Library buttons, the folded-in TRD seed, and the phone fixes (long values, header title, Process view
// controls first). All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goTo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`), label).toEqual([]);
}

async function openSyringe(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByTestId("home-chain")).toBeVisible();
}

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

test("the syringe example opens on Home with the whole chain in view, each stage a link with a short status", async ({ page }) => {
  await openSyringe(page);
  await expect(page.getByRole("heading", { level: 1, name: "Gap assessment for technology transfer" })).toBeVisible();
  const chain = page.getByRole("navigation", { name: "Document chain" });
  await expect(chain.getByRole("link")).toHaveCount(5);
  for (const [id, name, status] of [
    ["gap", "Gap assessment", /difference/],
    ["trd", "TRD", /TRD-001/],
    ["sampling", "Sampling plan", /SPL-001/],
    ["mbr", "Batch record", /MBR-001/],
    ["view", "Process view", /Opens from a batch record/],
  ] as const) {
    const l = chain.getByTestId(`chain-${id}`);
    await expect(l).toContainText(name);
    await expect(l).toContainText(status);
    // Home shows the chain as a map: no stage is "current".
    await expect(l).not.toHaveAttribute("aria-current", "step");
  }
  // Getting started covers the whole chain, the later items marked optional.
  const list = page.getByTestId("getting-started");
  for (const t of ["Start the TRD (optional)", "Make a sampling plan (optional)", "Write the batch record (optional)", "See the Process view (optional)", "Assess risk (optional)"]) {
    await expect(list.getByRole("link", { name: t })).toBeVisible();
  }
  // The next step knows the chain: all documents exist in this example, so it points on to the Process view.
  await expect(page.getByTestId("then-step")).toContainText("Open the Process view");
  await page.getByTestId("home-start-trd").click();
  await expect(page.getByRole("heading", { level: 1, name: "TRD" })).toBeVisible();
  await hash(page, "#/");
  await page.getByTestId("chain-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
});

test("a project with no documents says 'Not started', proposes the TRD after the register, and never blocks a stage", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  // On a gap assessment page the gap stage is the current one.
  await expect(page.getByRole("navigation", { name: "Document chain" })).toBeVisible();
  await expect(page.getByTestId("chain-gap")).toHaveAttribute("aria-current", "step");
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Empty chain (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await hash(page, "#/");
  for (const id of ["trd", "sampling", "mbr"]) await expect(page.getByTestId(`chain-${id}`)).toContainText("Not started");
  await expect(page.getByTestId("chain-view")).toContainText("Needs a batch record to show");
  // Nothing is enforced: the batch record page opens straight away, and its Next bar says what the Process view needs.
  await page.getByTestId("chain-mbr").click();
  await expect(page.getByRole("heading", { level: 1, name: "Batch record" })).toBeVisible();
  await expect(page.getByTestId("chain-mbr")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("doc-chain-bar")).toContainText("Process view opens from a batch record");
  await expect(page.getByTestId("chain-back")).toContainText("Back: Sampling plan");
  await expect(page.getByTestId("chain-next")).toHaveCount(0);
});

test("Next and Back walk gap document, TRD, sampling plan, batch record and Process view, following links that already exist", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/document");
  await expect(page.getByTestId("chain-gap")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("chain-next")).toContainText("Next: TRD");
  await page.getByTestId("chain-next").click();
  await expect(page.getByRole("heading", { level: 1, name: "TRD" })).toBeVisible();
  await expect(page.getByTestId("chain-trd")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("chain-back")).toContainText("Back: Gap assessment document");
  // Inside one TRD: the batch records that were started from it are listed.
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("chain-trd")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("chain-related")).toContainText("MBR-001");
  await page.getByTestId("chain-next").click();
  await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
  await expect(page.getByTestId("chain-sampling")).toHaveAttribute("aria-current", "step");
  // A plan that a batch record uses: Next goes to that record, not to the list.
  await page.getByRole("region", { name: "Sampling plans table" }).getByRole("link").first().click();
  await expect(page.getByTestId("chain-next")).toContainText("Next: Batch record MBR-001");
  await page.getByTestId("chain-next").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await expect(page.getByTestId("chain-mbr")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("chain-back")).toContainText("Back: Sampling plan SPL-");
  // The Document details name the linked TRD and plan as links.
  const summary = page.getByTestId("mbr-details-summary");
  await expect(summary.getByRole("link", { name: /^TRD-/ })).toBeVisible();
  await expect(summary.getByRole("link", { name: /^SPL-/ })).toBeVisible();
  await page.getByTestId("chain-next").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await expect(page.getByTestId("chain-view")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("chain-next")).toHaveCount(0);
  await page.getByTestId("chain-back").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await expectNoSidewaysScroll(page, "batch record with chain");
  await expectAccessible(page, "batch record with the chain strip and Next bar");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expectAccessible(page, "batch record with the chain strip, dark");
});

test("each module has a visible Library button, and the TRD page starts a TRD from the project (the TRD seed is no menu entry)", async ({ page }) => {
  await openSyringe(page);
  await goTo(page, "Sampling plan");
  const lib = page.getByTestId("module-library");
  await expect(lib.getByRole("link", { name: "Sampling tables" })).toBeVisible();
  await lib.getByRole("link", { name: "Plan subsections" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plan subsections" })).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("module-library").getByRole("link", { name: "Step blocks" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Step blocks/i);
  await goTo(page, "TRD");
  await page.getByTestId("module-library").getByRole("link", { name: "Process descriptions" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Process description/i);
  await goTo(page, "TRD");
  await page.getByTestId("trd-from-project-btn").click();
  await expect(page.getByTestId("trd-start-project")).toBeChecked();
  await expect(page.getByTestId("trd-title-input")).toBeFocused();
  // The old route still works.
  await hash(page, "#/trd-seed");
  await expect(page.getByRole("heading", { level: 1, name: "TRD seed" })).toBeVisible();
});

test("a long unbroken value on Home does not widen the page, and the project title stays on one header line", async ({ page }, testInfo) => {
  const long = "A".repeat(140);
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill(`Very long project title ${"title ".repeat(30)}(fictional)`);
  await dialog.getByLabel("Responder name").fill(long);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await hash(page, "#/");
  await expect(page.getByTestId("open-project")).toContainText(long);
  await expectNoSidewaysScroll(page, "home with a long responder name");
  await goTo(page, "TRD");
  await expectNoSidewaysScroll(page, "TRD page with a long project title");
  const header = await page.evaluate(() => {
    const brand = document.querySelector(".brand")!.getBoundingClientRect();
    const theme = document.querySelector(".theme-select")!.getBoundingClientRect();
    return { brandBottom: brand.bottom, themeTop: theme.top };
  });
  if (testInfo.project.name === "desktop") expect(header.themeTop, "the theme picker shares the first header row").toBeLessThan(header.brandBottom);
  await expect(page.locator(".brand > span").last()).toHaveAttribute("title", /Very long project title/);
});

test("the Process view puts the controls first on a phone, with the explanation one tap away", async ({ page }, testInfo) => {
  await openSyringe(page);
  await hash(page, "#/mbr/view?mbr=MBR-001");
  await expect(page.getByTestId("pv-page")).toBeVisible();
  const about = page.locator("details.pv-about");
  if (testInfo.project.name === "phone") {
    await expect(about).not.toHaveAttribute("open", "");
    const slider = await page.getByTestId("pv-slider").boundingBox();
    expect(slider!.y, "slider within the first screen").toBeLessThan(844);
    await about.locator("summary").click();
    await expect(about).toHaveAttribute("open", "");
    // Moving the slider does not close it again.
    await about.scrollIntoViewIfNeeded();
    await page.getByTestId("pv-next").click();
    await expect(about).toHaveAttribute("open", "");
  } else {
    await expect(about).toHaveAttribute("open", "");
  }
  await expectNoSidewaysScroll(page, "process view");
  await expectAccessible(page, "process view");
});
