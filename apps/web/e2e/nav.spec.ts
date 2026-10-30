// The guided navigation: the short top menu with its two drop-downs (a Menu button on a phone), the step bar on the six gap assessment
// pages, and the Home page that tells a new user what to do next. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const isPhone = (t: TestInfo) => t.project.name === "phone";
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`), label).toEqual([]);
}

async function startProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Navigation test (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

test("home with no project explains the tool, what you need and how to start, with no next-step card", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 2, name: "What this tool does" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new project" })).toBeVisible();
  await expect(page.getByTestId("next-step")).toHaveCount(0);
  // The "what you need" list is open on a first visit.
  await expect(page.getByTestId("before-you-start")).toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { level: 2, name: "Or try a demo" })).toBeVisible();
  await expect(page.getByText("Both demos are fictional.")).toBeVisible();
  await expect(page.getByTestId("getting-started")).toContainText("Answer the interview");
  // Without a project the "Gap assessment" link goes Home, where a project is started.
  const gap = isPhone(test.info()) ? undefined : mainNav(page).getByRole("link", { name: "Gap assessment" });
  if (gap) await expect(gap).toHaveAttribute("href", "#/");
  await expectNoSidewaysScroll(page, "home, no project");
  await expectAccessible(page, "home, no project");
});

test("a new project is offered the scope first, and the checklist shows no tick it cannot prove", async ({ page }) => {
  await startProject(page);
  await page.goto("./#/");
  await expect(page.getByTestId("next-step")).toContainText("Choose the scope");
  const list = page.getByTestId("getting-started");
  await expect(list).toContainText("Create a project");
  await expect(list.locator("li.is-done")).toHaveCount(1);
  await expect(list.locator("li.is-done")).toContainText("Create a project");
  await expectAccessible(page, "home, new project");
});

test("home with the demo open leads with the next step; demo cards say what they are and why", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("all eight comparison categories")).toBeVisible();
  await expect(page.getByText("The whole document chain is filled in")).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.evaluate(() => (window.location.hash = "#/"));
  const next = page.getByTestId("next-step");
  await expect(next).toContainText("Next step");
  await expect(next.getByRole("link", { name: "Review the gap register" })).toHaveAttribute("href", "#/register");
  await expect(page.getByTestId("about-poc")).not.toHaveAttribute("open", "");
  if (!isPhone(test.info())) await expect(mainNav(page).getByRole("link", { name: "Gap assessment" })).toHaveAttribute("href", "#/scope");
  await expectNoSidewaysScroll(page, "home with demo");
  await expectAccessible(page, "home with demo");
});

test("getting started can be hidden, stays hidden after a reload, and can be shown again", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("getting-started")).toBeVisible();
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.getByRole("button", { name: "Show getting started" }).click();
  await expect(page.getByTestId("getting-started")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("getting-started")).toBeVisible();
});

test("the Documents and Library drop-downs open on click, move with the arrow keys, close on Escape and on a click outside", async ({ page }, testInfo) => {
  test.skip(isPhone(testInfo), "the phone uses the Menu button, tested below");
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = mainNav(page);
  const documents = nav.getByRole("button", { name: /^Documents/ });
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await documents.click();
  await expect(documents).toHaveAttribute("aria-expanded", "true");
  // Chain order, each entry with a line saying what it is for; the gap assessment lists its six steps; risk and the TBD list sit alongside.
  for (const name of ["Scope", "Interview", "Side by side", "Gap register", "Validation", "Document", "TRD", "Sampling plan", "Batch record", "Risk assessment", "Open items (TBD)"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "TRD seed" })).toHaveCount(0);
  await expect(nav.getByText("Alongside")).toBeVisible();
  await expect(nav.getByRole("link", { name: "TRD", exact: true })).toHaveAccessibleDescription(/Technical requirements/);
  const order = await nav.locator(".nav-panel a").allInnerTexts();
  const at = (t: string) => order.findIndex((x) => x.includes(t));
  expect(at("Scope")).toBeLessThan(at("TRD"));
  expect(at("TRD")).toBeLessThan(at("Sampling plan"));
  expect(at("Sampling plan")).toBeLessThan(at("Batch record"));
  // Escape closes and returns focus to the button.
  await page.keyboard.press("Escape");
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await expect(documents).toBeFocused();
  // The keyboard: Enter opens, the arrow keys move through the entries.
  await page.keyboard.press("Enter");
  await expect(documents).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(nav.getByRole("link", { name: "Scope", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(nav.getByRole("link", { name: "Interview", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(nav.getByRole("link", { name: "Scope", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(documents).toBeFocused();
  // A click outside closes it.
  await documents.click();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  // Choosing an entry navigates and closes the list; the group shows as current.
  await documents.click();
  await nav.getByRole("link", { name: "Sampling plan", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await expect(documents).toHaveClass(/is-current/);
  await documents.click();
  await expect(nav.getByRole("link", { name: "Sampling plan", exact: true })).toHaveAttribute("aria-current", "page");
  await expectAccessible(page, "documents drop-down open");
  await page.keyboard.press("Escape");

  const library = nav.getByRole("button", { name: /^Library/ });
  await library.click();
  for (const name of ["Templates", "Guidance", "Sources", "Builder", "Change log"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  // The module libraries moved next to their modules: the Library menu keeps only the cross-cutting entries.
  await expect(nav.getByText("Module libraries")).toHaveCount(0);
  for (const name of ["Sampling tables", "Plan subsections", "Risk methods", "Step blocks library", "Process description library"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await documents.click();
  await nav.getByRole("link", { name: "Risk assessment", exact: true }).click();
  await page.getByTestId("module-library").getByRole("link", { name: "Risk methods" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Risk methods" })).toBeVisible();
  // The module sub-page also keeps lighting its module's entry in Documents, as the flat menu did.
  await documents.click();
  await expect(nav.getByRole("link", { name: "Risk assessment", exact: true })).toHaveAttribute("aria-current", "page");
});

test("the phone folds the menu into one Menu button with no sideways scroll", async ({ page }, testInfo) => {
  test.skip(!isPhone(testInfo), "phone width only");
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = mainNav(page);
  const menu = nav.getByRole("button", { name: /^Menu/ });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expectNoSidewaysScroll(page, "phone, menu closed");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Home", "Gap assessment", "Scope", "TRD", "Sampling plan", "Batch record", "Open items (TBD)", "Templates"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page, "phone, menu open");
  await expectAccessible(page, "phone menu open");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await nav.getByRole("link", { name: "Guidance", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Guidance" })).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the step bar marks the current step, ticks only what is proven, and Back / Next walk the six steps", async ({ page }, testInfo) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.evaluate(() => (window.location.hash = "#/interview"));
  const bar = page.getByRole("navigation", { name: "Gap assessment steps" });
  await expect(bar).toBeVisible();
  if (isPhone(testInfo)) {
    await expect(bar).toContainText("Step 2 of 6: Interview");
  } else {
    await expect(bar.getByRole("link", { name: /Interview/ })).toHaveAttribute("aria-current", "step");
    await expect(bar.getByRole("link")).toHaveCount(6);
    // The demo is fully answered, so the interview is provably done; the register and the document leave no trace, so they get no tick.
    await expect(bar.getByRole("link", { name: /Interview/ })).toContainText("(done)");
    await expect(bar.getByRole("link", { name: /Gap register/ })).not.toContainText("(done)");
    await expect(bar.getByRole("link", { name: /Document/ })).not.toContainText("(done)");
  }
  await expectNoSidewaysScroll(page, "interview with step bar");
  await expectAccessible(page, "interview with step bar");

  await page.getByTestId("step-next").click();
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  await page.getByTestId("step-next").click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.getByTestId("step-back").click();
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  await page.evaluate(() => (window.location.hash = "#/document"));
  await expect(page.getByTestId("step-next")).toHaveCount(0);
  await expect(page.getByTestId("step-back")).toContainText("Back: Validation");
  await page.evaluate(() => (window.location.hash = "#/scope"));
  await expect(page.getByTestId("step-back")).toHaveCount(0);
  await expect(page.getByTestId("step-next")).toContainText("Next: Interview");
  // Library pages have no step bar.
  await page.evaluate(() => (window.location.hash = "#/guidance"));
  await expect(page.getByRole("navigation", { name: "Gap assessment steps" })).toHaveCount(0);
});
