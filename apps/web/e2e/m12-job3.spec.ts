// M12 job 3: the TRD interview is findable and complete. Home offers the four starts in plain words with working buttons, the tour and the "?" help
// describe the Interview tab, the chain status line agrees with the Open items tab, both demos open the Interview tab with a sensible count and the
// "Show" filter options have normal spacing. Desktop, tablet and phone, axe on each. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDemo, openMoreWays } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `m12-j3-${name}-${test.info().project.name}.png`), fullPage: true });

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
}

/** Fills the New project form that every "start" button without an open project opens. */
async function createProject(page: Page) {
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Starts test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
}

test("Home with no project: one big start, and the other three under More ways to start in plain words, and each button lands on the right page", async ({ page }) => {
  await page.goto("./");
  const options = page.getByTestId("start-options");
  await expect(options.getByRole("heading", { level: 3 })).toHaveText(["Start fresh"]);
  await openMoreWays(page);
  await expect(options.getByRole("heading", { level: 3 })).toHaveText(["Start fresh", "Start with one document", "Open a demo", "Upload a document you have"]);
  await expect(options.getByRole("button", { name: "Start a new project" })).toBeVisible(); // the gap assessment
  const docs = page.getByTestId("start-documents");
  await expect(docs.getByRole("heading", { level: 4 })).toHaveText(["A technical requirements document (TRD) on its own", "A sampling plan on its own", "A batch record (MBR) from a TRD"]);
  await expect(docs).toContainText("A sampling plan is welcome but not needed");
  await shot(page, "home-starts");
  await expectNoSidewaysScroll(page, "home starts");
  await expectAccessible(page, "home starts");

});

// Without a project each button first asks for the project name (a document lives in a project), then lands on its page. One test each, so
// every one starts with a clean browser (a project left open would turn the sampling and batch record buttons into links).
const targets: [string, string, RegExp][] = [
  ["trd", "Answer questions", /#\/trd\?trd=[^&]+&tab=interview$/],
  ["sampling", "Start a sampling plan", /#\/sampling$/],
  ["mbr", "Start a batch record", /#\/mbr$/],
];
for (const [id, name, url] of targets) {
  test(`Home with no project: "${name}" asks for the project name and lands on the right page`, async ({ page }) => {
    await page.goto("./");
    await openMoreWays(page);
    await expect(page.getByTestId(`start-doc-${id}`)).toHaveText(name);
    await page.getByTestId(`start-doc-${id}`).click();
    await createProject(page);
    await expect(page).toHaveURL(url);
    if (id === "trd") {
      // The same start as "Answer questions" on the TRD page, with the project made first: the TRD exists and its Interview tab is open, with
      // no second form to fill in (EOU-02, EOU-12).
      await expect(page.getByTestId("trd-interview")).toBeVisible();
      await expect(page.getByTestId("trd-tab-interview")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("trd-title-input")).toHaveCount(0);
    }
  });
}

test("Home with a project open: the sampling and batch record starts are plain links, and the TRD one makes a blank TRD on the Interview tab at once", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "syr");
  await openMoreWays(page);
  const docs = page.getByTestId("start-documents");
  await expect(docs).toBeVisible();
  await expect(page.getByTestId("start-doc-trd")).toHaveText("Answer questions");
  await expect(page.getByTestId("start-doc-sampling")).toHaveAttribute("href", "#/sampling");
  await expect(page.getByTestId("start-doc-mbr")).toHaveAttribute("href", "#/mbr");
  await expectAccessible(page, "home starts with a project");
  await page.getByTestId("start-doc-trd").click();
  // One click: no form. The new TRD is named after the project and its first question is on screen.
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("trd-title-input")).toHaveCount(0);
  await expect(page.getByTestId("trd-tab-interview")).toHaveAttribute("aria-selected", "true");
});

for (const [id, h1] of [["sampling", "Sampling plan"], ["mbr", "Batch record"]] as const) {
  test(`Home with a project open: the ${id} start goes to its page`, async ({ page }) => {
    await page.goto("./");
    await openDemo(page, "syr");
    await openMoreWays(page);
    await page.getByTestId(`start-doc-${id}`).click();
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
  });
}

test("the TRD tour names the Interview tab and the one-at-a-time switch, and the Interview tab's ? help says what it does", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("gap-tour-force", "1"));
  await page.goto("./");
  await openDemo(page, "syr");
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  // The help (?) beside the tab's purpose line.
  await page.getByRole("button", { name: "Help: Interview" }).click();
  const pop = page.getByTestId("help-tip-pop");
  await expect(pop).toContainText("You can also print the blank form");
  for (const w of ["Don't know yet", "Not applicable here", "TBD", "Keep this", "Change it", "Show filter"]) await expect(pop).toContainText(w);
  await shot(page, "trd-help");
  await expectAccessible(page, "interview help open");
  await page.keyboard.press("Escape");
  // The tour: the page's own "Tour of this page" entry.
  const phone = (page.viewportSize()?.width ?? 1000) <= 700;
  if (phone) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByText("Help", { exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Tour of this page" }).click();
  } else {
    await page.getByTestId("help-menu-button").click();
    await page.getByRole("menuitem", { name: "Tour of this page" }).click();
  }
  const bubble = page.getByTestId("tour-bubble");
  const titles: string[] = [];
  for (let i = 0; i < 6; i++) {
    await expect(bubble).toBeVisible();
    titles.push((await bubble.getByRole("heading").innerText()).trim());
    if (titles.at(-1) === "The Interview tab") {
      await page.waitForTimeout(600);
      await shot(page, "tour-interview-tab");
    }
    if (titles.at(-1) === "One question at a time") {
      await page.waitForTimeout(600);
      await shot(page, "tour-one-at-a-time");
    }
    const done = bubble.getByRole("button", { name: "Done" });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await bubble.getByRole("button", { name: "Next" }).click();
  }
  expect(titles).toContain("The Interview tab");
  expect(titles).toContain("One question at a time");
  expect(titles.length).toBeLessThanOrEqual(5);
});

test("the chain status on the TRD stage is the Open items count, and it agrees with the Open items tab", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/trd?trd=TRD-001&tab=open");
  const heading = await page.getByRole("heading", { level: 2, name: /^\d+ open items?$/ }).innerText();
  const n = Number(/^(\d+)/.exec(heading)![1]);
  await hash(page, "#/");
  const status = page.getByTestId("doc-card-state-trd");
  await expect(status).toHaveText(n === 0 ? "TRD-001, no open items" : n === 1 ? "TRD-001, 1 open item" : `TRD-001, ${n} open items`);
  await status.scrollIntoViewIfNeeded();
  await shot(page, "chain-status");
});

test("both demos open the TRD with the Interview tab and a sensible 'N of M answered'", async ({ page }) => {
  // Opens a whole demo and runs axe over the 425-question interview: close to 30 s on a busy laptop since the demos also carry an excipient assessment (M13 job 4B).
  test.setTimeout(60_000);
  for (const which of ["arx", "syr"] as const) {
    await page.goto("./");
    await openDemo(page, which);
    await hash(page, "#/trd?trd=TRD-001&tab=interview");
    await expect(page.getByTestId("trd-tab-interview")).toBeVisible();
    const text = await page.getByTestId("iv-banner").innerText();
    const m = /(\d+) of (\d+) answered/.exec(text);
    expect(m, text).not.toBeNull();
    const [answered, total] = [Number(m![1]), Number(m![2])];
    expect(total).toBeGreaterThan(0);
    expect(answered).toBeLessThanOrEqual(total);
    if (which === "syr") await shot(page, "demo-interview");
    await expectAccessible(page, `${which} demo interview`);
  }
});

test("the Show filter options sit one per line with normal spacing, 24 px targets and no sideways scroll", async ({ page }) => {
  // Opens a whole demo and runs axe over the 425-question interview: close to 30 s on a busy laptop since the demos also carry an excipient assessment (M13 job 4B).
  test.setTimeout(60_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  const boxes = await page.getByTestId("iv-filters").locator("label.check").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, h: r.height, w: r.width })));
  expect(boxes).toHaveLength(3);
  for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(24);
  // One option per line: each starts below the end of the one before.
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 1);
  await expectNoSidewaysScroll(page, "show filter");
  await page.getByTestId("iv-filters").scrollIntoViewIfNeeded();
  await shot(page, "show-filter");
  await page.getByTestId("iv-more").check();
  await expect(page.getByTestId("iv-banner")).toBeVisible();
  await expectAccessible(page, "show filter and More detail");
  // Two of the More detail cards, found by their own wording (a classification and a qualification question).
  await page.getByTestId("iv-search").fill("qualified");
  const cards = page.locator('[data-testid^="iv-card-"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).not.toContainText("Needed for the TRD section");
  await cards.first().scrollIntoViewIfNeeded();
  await shot(page, "more-detail-cards");
});
