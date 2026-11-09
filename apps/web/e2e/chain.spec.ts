// The document chain (gap assessment, TRD, sampling plan, batch record, Process view): the strip on Home and every document page, the
// Next / Back bar, the module Library buttons, the folded-in TRD seed, and the phone fixes (long values, header title, Process view
// controls first). All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goTo, isPhone, openDemo } from "./nav-helper";

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
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toBeVisible();
}

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

test("the syringe example opens on Home with one card per document, each with a short state and a button", async ({ page }) => {
  await openSyringe(page);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Cascade" })).toBeVisible();
  for (const [id, name, status] of [
    ["gap", "Gap assessment", /difference/],
    ["risk", "Risk assessment", /./],
    ["trd", "TRD", /TRD-001/],
    ["sampling", "Sampling plan", /SPL-001/],
    ["mbr", "Batch record", /MBR-001/],
  ] as const) {
    const card = page.getByTestId(`doc-card-${id}`);
    await expect(card.getByRole("heading", { level: 3, name })).toBeVisible();
    await expect(page.getByTestId(`doc-card-state-${id}`)).toContainText(status);
    await expect(card.getByTestId(`doc-card-open-${id}`)).toBeVisible();
  }
  // Getting started lives on the gap assessment's own page and covers the whole chain, the later items marked optional.
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await hash(page, "#/gap");
  const list = page.getByTestId("getting-started");
  for (const t of ["Start the TRD (optional)", "Make a sampling plan (optional)", "Write the batch record (optional)", "See the Process view (optional)", "Assess risk (optional)"]) {
    await expect(list.getByRole("link", { name: t })).toBeVisible();
  }
  await hash(page, "#/");
  // The next step knows the chain: all documents exist in this example, so it points on to the Process view.
  await expect(page.getByTestId("then-step")).toContainText("Open the Process view");
  await page.getByTestId("doc-card-open-trd").click();
  await expect(page.getByRole("heading", { level: 1, name: "TRD" })).toBeVisible();
  await hash(page, "#/");
  await page.getByTestId("chain-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
});

test("a project with no documents says 'Not started', proposes the TRD after the register, and never blocks a stage", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  // Gap assessment pages show only their own six step pills; the document chain stays on Home and in the Documents menu.
  await expect(page.getByTestId("doc-chain")).toHaveCount(0);
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Empty chain (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await hash(page, "#/");
  for (const id of ["trd", "sampling", "mbr"]) {
    await expect(page.getByTestId(`doc-card-state-${id}`)).toHaveText("Not started");
    await expect(page.getByTestId(`doc-card-open-${id}`)).toHaveText("Start");
  }
  // No batch record yet, so there is no Process view to offer.
  await expect(page.getByTestId("chain-view")).toHaveCount(0);
  // Nothing is enforced: the batch record page opens straight away, and its Next bar says what the Process view needs.
  await page.getByTestId("doc-card-open-mbr").click();
  await expect(page.getByRole("heading", { level: 1, name: "Batch record" })).toBeVisible();
  await expect(page.getByTestId("chain-mbr")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("doc-chain-bar")).toContainText("Process view opens from a batch record");
  await expect(page.getByTestId("chain-back")).toContainText("Back: Sampling plan");
  await expect(page.getByTestId("chain-next")).toHaveCount(0);
});

test("Next and Back walk gap document, TRD, sampling plan, batch record and Process view, following links that already exist", async ({ page }) => {
  // A demo build, six pages and two axe scans: about 5 s alone, 22 s or more when a full run builds demos in every worker.
  test.slow();
  await openSyringe(page);
  await hash(page, "#/document");
  await expect(page.getByTestId("doc-chain")).toHaveCount(0);
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

test("the chain strip says where you are in words, not only in colour; a phone gets one line with a Next link", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/trd?trd=TRD-001");
  const chain = page.getByRole("navigation", { name: "Document chain" });
  await expect(chain).toBeVisible();
  const here = chain.getByTestId("chain-trd");
  await expect(here).toHaveAttribute("aria-current", "step");
  if (isPhone(page)) {
    // One line: "Chain 2 of 5 · TRD" (Risk assessment sits beside the chain and is not counted), and the next stage as the only link.
    await expect(chain).toContainText("Chain 2 of 5 · TRD");
    await expect(chain.getByRole("link")).toHaveCount(1);
    await expect(chain.getByTestId("chain-strip-next")).toContainText("Next: Sampling plan");
    await chain.getByTestId("chain-strip-next").click();
    await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Document chain" })).toContainText("Chain 3 of 5 · Sampling plan");
    // The last stage has nothing after it.
    await hash(page, "#/mbr/view?mbr=MBR-001");
    await expect(page.getByTestId("pv-page")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Document chain" })).toContainText("Chain 5 of 5 · Process view");
    await expect(page.getByTestId("chain-strip-next")).toHaveCount(0);
  } else {
    // One segmented bar: a segment per stage, the numbered ones read "N · name", and only the current one says "(you are here)".
    await expect(chain.getByRole("link")).toHaveCount(6);
    await expect(here).toContainText("2 · TRD (you are here)");
    await expect(chain.getByText("(you are here)")).toHaveCount(1);
    await expect(chain.getByTestId("chain-gap")).toContainText("1 · Gap assessment");
    await expect(chain.getByTestId("chain-sampling")).toContainText("3 · Sampling plan");
    await expect(chain.getByTestId("chain-mbr")).toContainText("4 · Batch record");
    await expect(chain.getByTestId("chain-view")).toContainText("5 · Process view");
    await expect(chain.getByTestId("chain-sampling")).not.toHaveAttribute("aria-current", "step");
    // The current segment has the 3 px bar under it (not colour alone: the words above say the same).
    const bar = await here.evaluate((e) => getComputedStyle(e).boxShadow);
    expect(bar, "a bar under the current stage").not.toBe("none");
  }
});

test("each module has a visible Library button, and the TRD page starts a TRD from the project (the TRD seed is no menu entry)", async ({ page }) => {
  await openSyringe(page);
  await goTo(page, "Sampling plan");
  const lib = page.getByTestId("module-library");
  await expect(lib.getByRole("link", { name: "Sampling tables" })).toBeVisible();
  await lib.getByRole("link", { name: "Subsection library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Subsection library" })).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("module-library").getByRole("link", { name: "Ready-made steps" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Ready-made steps/i);
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

test("a long unbroken value on Home does not widen the page, and a long project title never makes the header taller", async ({ page }) => {
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
  // The bar is one row (56 px wide screens, 52 px phone, plus its 1 px line) however long the title is.
  const bar = await page.locator("header.app-header").boundingBox();
  expect(bar!.height, "the header bar is one row").toBeLessThanOrEqual(isPhone(page) ? 53 : 57);
  const nav = page.getByRole("navigation", { name: "Main" });
  if (isPhone(page)) {
    // On a phone the project is in the Menu panel, where the whole title may wrap.
    await nav.getByRole("button", { name: "Menu" }).click();
    await expect(nav.getByRole("link", { name: /^Very long project title/ })).toBeVisible();
  } else {
    // Wide screens: one line with an ellipsis; the whole title is the button's name and its tooltip.
    const project = page.getByRole("link", { name: /^Project: Very long project title/ });
    await expect(project).toHaveAttribute("title", /^Very long project title/);
    const cut = await project.locator(".header-project-title").evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(cut, "the long title is cut with an ellipsis inside the button").toBe(true);
  }
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
