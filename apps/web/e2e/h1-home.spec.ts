// Job H1: Home is Cascade's start page (welcome, Start, one card per document), the gap assessment has its own page, a project page with no
// project open says which page it is and offers the ways to open one, and the page column is centred on a wide screen. Runs on the desktop,
// tablet and phone projects. All data are fictional. (The projects side column needs server storage: see e2e-server/h1-projects.spec.ts.)
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_NAMES, goTo, isPhone, openDemo, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `h1-${name}-${test.info().project.name}.png`), fullPage: true });

async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

test("a project page with no project open names the page and offers the ways to open a project; the demo lands on that page", async ({ page }) => {
  await page.goto("./");
  for (const [menuName, h1] of [
    ["Sources", "Sources"],
    ["Change log", "Change log"],
  ] as const) {
    await page.goto("./");
    // The first round's demo is still open in this browser: close and delete it so this round starts with no project.
    if (await page.getByRole("button", { name: "Close and delete…" }).count()) {
      await page.getByRole("button", { name: "Close and delete…" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
    }
    await goTo(page, menuName);
    const box = page.getByTestId("needs-project");
    await expect(box).toBeVisible();
    // The box says which page was asked for (it used to show Home, which looked as if the menu did nothing).
    await expect(box.getByRole("heading", { level: 1, name: `${menuName} needs an open project` })).toBeVisible();
    await expect(page.getByTestId("needs-project-text")).toContainText(`you will come straight back to ${menuName}.`);
    await expect(box.getByRole("button", { name: "Start a new project" })).toBeVisible();
    await expect(box.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` })).toBeVisible();
    await expect(box.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` })).toBeVisible();
    await expect(box.getByRole("link", { name: "Go to the Home page" })).toHaveAttribute("href", "#/");
    // It is not Home: no welcome heading, no document cards.
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to Cascade" })).toHaveCount(0);
    await expect(page.getByTestId("home-chain")).toHaveCount(0);
    if (menuName === "Sources") {
      await shot(page, "no-project-box");
      await expectAccessible(page, "no-project box, light");
      await page.emulateMedia({ colorScheme: "dark" });
      await expectAccessible(page, "no-project box, dark");
      await expectNoSidewaysScroll(page, "no-project box");
      await shot(page, "no-project-box-dark");
      await page.emulateMedia({ colorScheme: "light" });
    }
    // Opening the demo from the box lands on the page that was asked for, not on Home.
    await box.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: h1, exact: true })).toBeVisible({ timeout: 90_000 });
    expect(new URL(page.url()).hash).toBe(menuName === "Sources" ? "#/sources" : "#/changes");
    await expect(page.getByTestId("needs-project")).toHaveCount(0);
    // The "Demo opened" line belongs to Home; it must not be left waiting for the next visit.
    await expect(page.getByTestId("demo-opened")).toHaveCount(0);
  }
});

test("starting a new project from the box goes to the Scope step, as a new project always does", async ({ page }) => {
  await page.goto("./#/trd");
  await expect(page.getByTestId("needs-project")).toContainText("TRD needs an open project");
  await page.getByTestId("needs-project").getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Box project (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/scope");
});

test("the box also names pages reached by their address and the module pages that need a project", async ({ page }) => {
  for (const [hash, name] of [
    ["#/interview", "Interview"],
    ["#/register", "Gap register"],
    ["#/sampling", "Sampling plan"],
    ["#/mbr", "Batch record"],
    ["#/risk", "Risk assessment"],
    ["#/trd/import", "Upload a TRD"],
    ["#/tbd", "Open items"],
  ] as const) {
    await page.goto(`./${hash}`);
    await expect(page.getByTestId("needs-project-text")).toContainText(`straight back to ${name}.`);
  }
});

test("Home is the Cascade start page: welcome, the three start choices and one card per document", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Cascade" })).toBeVisible();
  // The gap assessment's own title and picture moved to its page.
  await expect(page.locator('.art-banner[data-art="page-home-hero"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gap assessment for technology transfer" })).toHaveCount(0);
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  const start = page.getByRole("heading", { level: 2, name: "Start", exact: true });
  await expect(start).toBeVisible();
  const options = page.getByTestId("start-options");
  await expect(options.getByRole("heading", { level: 3 })).toHaveText(["Start fresh", "Start with one document", "Open a demo", "Upload a document you have"]);
  // An upload is read into a project, so with none open the choice says what to do first (no dead buttons).
  await expect(page.getByTestId("upload-needs-project")).toBeVisible();
  await expect(page.getByTestId("home-upload-trd")).toHaveCount(0);
  // One card per document, in chain order, each with its purpose.
  const names = await page.getByTestId("home-chain").getByRole("heading", { level: 3 }).allInnerTexts();
  expect(names).toEqual(["Gap assessment", "TRD", "Sampling plan", "Batch record", "Risk assessment"]);
  await expect(page.getByTestId("doc-card-state-gap")).toHaveText("Read how it works, then start a project.");
  await expect(page.getByTestId("doc-card-open-gap")).toHaveAttribute("href", "#/gap");
  for (const id of ["trd", "sampling", "mbr", "risk"]) {
    await expect(page.getByTestId(`doc-card-state-${id}`)).toHaveText("Needs an open project.");
    await expect(page.getByTestId(`doc-card-open-${id}`)).toHaveCount(0);
  }
  await expectNoSidewaysScroll(page, "home, no project");
  await shot(page, "home-light");
  await expectAccessible(page, "home, light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "home, dark");
  await shot(page, "home-dark");
  await page.emulateMedia({ colorScheme: "light" });
});

test("with a project open the cards show its state and their buttons go to each document", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("upload-needs-project")).toHaveCount(0);
  // With a project the upload choice offers the TRD and sampling plan uploads (reused from the pages that read them).
  await expect(page.getByTestId("home-upload-trd")).toBeVisible();
  await expect(page.getByTestId("home-upload-sampling")).toBeVisible();
  const expected: [string, RegExp, string, RegExp][] = [
    ["gap", /difference|question/, "Open", /^#\/gap$/],
    ["trd", /TRD-001/, "Open", /^#\/trd\?trd=/],
    ["sampling", /SPL-001/, "Open", /^#\/sampling$/],
    ["mbr", /MBR-001/, "Open", /^#\/mbr$/],
    ["risk", /RAS-001/, "Open", /^#\/risk$/],
  ];
  for (const [id, state, button, link] of expected) {
    await expect(page.getByTestId(`doc-card-state-${id}`)).toContainText(state);
    const open = page.getByTestId(`doc-card-open-${id}`);
    await expect(open).toHaveText(button);
    await expect(open).toHaveAttribute("href", link);
  }
  // With a project open the order is: open project, the documents, then "Start something else" (it used to lead and push them far down).
  const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y("open-project")).toBeLessThan(await y("home-chain"));
  expect(await y("home-chain")).toBeLessThan(await y("start-else"));
  if (!isPhone(page)) expect(await y("home-chain"), "documents start high on the page").toBeLessThan(1000);
  await expect(page.getByTestId("start-else").getByRole("button", { name: "Start a new project" })).toBeVisible();
  await expect(page.getByTestId("chain-view")).toHaveAttribute("href", /#\/mbr\/view\?mbr=/);
  await expect(page.getByTestId("open-project")).toBeVisible();
  await expectNoSidewaysScroll(page, "home, demo open");
  await expectAccessible(page, "home, demo open");
  await shot(page, "home-demo");
  await page.getByTestId("doc-card-open-gap").click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap assessment for technology transfer" })).toBeVisible();
  await expect(page.getByTestId("gap-continue")).toBeVisible();
});

test("the gap assessment has its own page with the hero, the intro and the Getting started checklist; it reads without a project", async ({ page }) => {
  await page.goto("./#/gap");
  await expect(page.getByRole("heading", { level: 1, name: "Gap assessment for technology transfer" })).toBeVisible();
  await expect(page.locator('.art-banner[data-art="page-home-hero"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What the gap assessment does" })).toBeVisible();
  // No project: no box (the page can be read), and the first checklist item leads to Home, where a project is made.
  await expect(page.getByTestId("needs-project")).toHaveCount(0);
  const list = page.getByTestId("getting-started");
  await expect(list.getByRole("link", { name: "Create a project" })).toHaveAttribute("href", "#/");
  await expect(list.getByRole("link", { name: "Choose the scope" })).toHaveCount(0);
  await expect(page.getByTestId("gap-start")).toHaveAttribute("href", "#/");
  await expectNoSidewaysScroll(page, "gap page, no project");
  await shot(page, "gap-page");
  await expectAccessible(page, "gap page, light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "gap page, dark");
  await shot(page, "gap-page-dark");
  await page.emulateMedia({ colorScheme: "light" });
  // The menu has an entry for it, first in the gap assessment's list, and it opens this page.
  await page.goto("./");
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByText(/^The \d+ steps$/).click();
  }
  await goTo(page, "Getting started");
  await expect(page.getByRole("heading", { level: 1, name: "Gap assessment for technology transfer" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/gap");
  // With a project the checklist links work and the button says what is next.
  await page.goto("./");
  await openDemo(page, "arx");
  await page.goto("./#/gap");
  await expect(page.getByTestId("gap-continue")).toBeVisible();
  await expect(page.getByTestId("getting-started").getByRole("link", { name: "Choose the scope" })).toHaveAttribute("href", "#/scope");
  await expect(page.getByTestId("getting-started").locator("li.is-done")).not.toHaveCount(0);
  await setTheme(page, "Light");
});

test("the page column is centred on a wide screen: equal gaps left and right, and the header lines up with it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sizes are set by the test itself");
  test.setTimeout(120_000);
  await page.goto("./");
  await openDemo(page, "syr");
  const measure = () =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let lo = Infinity;
      let hi = 0;
      for (const e of Array.from(document.querySelectorAll("main *"))) {
        const b = e.getBoundingClientRect();
        if (b.width < 5 || b.height < 5 || getComputedStyle(e).position === "fixed") continue;
        lo = Math.min(lo, b.left);
        hi = Math.max(hi, b.right);
      }
      const brand = document.querySelector(".brand")!.getBoundingClientRect();
      const tools = document.querySelector(".header-tools")!.getBoundingClientRect();
      return { left: lo, right: vw - hi, brandLeft: brand.left, toolsRight: vw - tools.right };
    });
  for (const width of [1366, 1920, 2000]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const hash of ["#/", "#/gap", "#/trd"]) {
      await page.evaluate((h) => (window.location.hash = h), hash);
      await expect(page.locator("main h1").first()).toBeVisible();
      const m = await measure();
      expect(Math.abs(m.left - m.right), `${hash} at ${width}: gap left ${m.left}, right ${m.right}`).toBeLessThanOrEqual(4);
      // The dark bar's contents sit over the page column (a few px for the column's own side padding), not at the window's edges.
      expect(Math.abs(m.brandLeft - m.left), `${hash} at ${width}: brand ${m.brandLeft}, column ${m.left}`).toBeLessThanOrEqual(4);
      expect(Math.abs(m.toolsRight - m.right), `${hash} at ${width}: tools ${m.toolsRight}, column ${m.right}`).toBeLessThanOrEqual(4);
    }
    // The pictures are of Home (the loop ends on another page).
    if (width === 2000 || width === 1366) {
      await page.evaluate(() => (window.location.hash = "#/"));
      await expect(page.getByRole("heading", { level: 1, name: "Welcome to Cascade" })).toBeVisible();
      await page.screenshot({ path: join(tmpdir(), `h1-home-${width}.png`) });
    }
  }
});
