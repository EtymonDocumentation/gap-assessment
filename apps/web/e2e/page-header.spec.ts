// Redesign job R2: the shared page header on the module and library pages. Breadcrumb, one purpose sentence, facts the page already knows,
// "About this page" (closed on every visit), the Export menu (keyboard and the real downloads), where the first working area starts on
// the page, and no sideways scroll on a narrow phone. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { breadcrumb, expectNotice } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await expectNotice(page);
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/** The demo project's first TRD, opened (its tabs show). */
async function openDemoTrd(page: Page) {
  await loadDemo(page);
  await go(page, "#/trd");
  await page.getByTestId("trd-list-table").getByRole("link").first().click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
}

/** Pages of the project and of the libraries that show the header, with the words of their h1. */
const HEADER_PAGES = [
  "#/scope",
  "#/compare",
  "#/register",
  "#/validation",
  "#/document",
  "#/trd",
  "#/trd-seed",
  "#/sampling",
  "#/mbr",
  "#/risk",
  "#/risk/methods",
  "#/trd/writeups",
  "#/sampling/tables",
  "#/sampling/subsections",
  "#/mbr/library",
  "#/templates",
  "#/guidance",
  "#/saved-answers",
  "#/sources",
  "#/builder",
  "#/changes",
] as const;

// ------------------------------------------------------------------ breadcrumb

test("breadcrumb: project, area, page; earlier parts are links, the last part is plain text and the current page", async ({ page }) => {
  await loadDemo(page);
  const nav = breadcrumb(page);
  await expect(nav).toBeVisible();
  const items = nav.getByRole("listitem");
  await expect(items).toHaveCount(4);
  // The project's own name comes first and leads to Home.
  await expect(items.nth(0).getByRole("link")).toHaveAttribute("href", "#/");
  expect((await items.nth(0).innerText()).trim().length).toBeGreaterThan(0);
  // The area has no page of its own, so it is plain text; the step before the page links to it.
  await expect(items.nth(1)).toHaveText("Documents");
  await expect(items.nth(1).getByRole("link")).toHaveCount(0);
  await expect(items.nth(2).getByRole("link", { name: "Gap assessment" })).toHaveAttribute("href", "#/scope");
  await expect(items.nth(3)).toHaveText("Gap register");
  await expect(items.nth(3)).toHaveAttribute("aria-current", "page");
  await expect(items.nth(3).getByRole("link")).toHaveCount(0);
  // Following a link goes there.
  await items.nth(2).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
});

test("breadcrumb: a library page has no project part, and Home has no breadcrumb", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/templates");
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Library", "Templates"]);
  await expect(breadcrumb(page).getByRole("link")).toHaveCount(0);
  // A module's library names the module it belongs to, and links back to it.
  await go(page, "#/trd/writeups");
  await expect(breadcrumb(page).getByRole("listitem")).toHaveText(["Documents", "TRD", "Process descriptions"]);
  await expect(breadcrumb(page).getByRole("link", { name: "TRD", exact: true })).toHaveAttribute("href", "#/trd");
  await go(page, "#/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(breadcrumb(page)).toHaveCount(0);
});

test("breadcrumb: a record ends with its own name, and the list before it is a link back", async ({ page }) => {
  await openDemoTrd(page);
  const h1 = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  const id = h1.split(":")[0]!.trim();
  const items = breadcrumb(page).getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect(items.nth(2).getByRole("link", { name: "TRD", exact: true })).toHaveAttribute("href", "#/trd");
  await expect(items.nth(3)).toHaveText(id);
  await expect(items.nth(3)).toHaveAttribute("aria-current", "page");
  await items.nth(2).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "TRD", exact: true })).toBeVisible();
});

// ------------------------------------------------------------------ title row

test("every header page has one title and one plain purpose sentence, and its facts never say Draft or Approved", async ({ page }, info) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  if (info.project.name !== "phone") await page.setViewportSize({ width: 1280, height: 800 });
  for (const hash of HEADER_PAGES) {
    await go(page, hash);
    // One title in the header (the Document page's preview has its own h1 for the generated document further down).
    await expect(page.getByTestId("page-head").getByRole("heading", { level: 1 }), hash).toHaveCount(1);
    const purpose = page.getByTestId("page-purpose");
    await expect(purpose, `${hash}: purpose sentence`).toBeVisible();
    const text = (await purpose.innerText()).trim();
    expect(text.endsWith("."), `${hash}: the purpose is one sentence ending in a full stop ("${text.slice(0, 40)}")`).toBe(true);
    expect(text.length, `${hash}: purpose length`).toBeLessThan(170);
    expect(text, `${hash}: purpose`).not.toMatch(/undefined|NaN|\[object Object\]/);
    // About one line at 1280 px (two at most, so a different font on another machine does not fail it).
    if (info.project.name !== "phone") {
      const lines = await purpose.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      expect(lines, `${hash}: purpose lines`).toBeLessThanOrEqual(2.1);
    }
    // Facts are things the page counts. The tool does not say whether a document is a draft or approved.
    const pills = await page.locator(".page-pills li").allInnerTexts();
    for (const p of pills) expect(p, `${hash}: pill "${p}"`).not.toMatch(/\b(draft|approved|released|effective|final)\b/i);
  }
});

test("open items show as a warning pill whose words say so, in a list named At a glance", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  const pill = page.getByTestId("doc-tbd-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText(/^\d+ TBD values? open$/);
  await expect(pill).toHaveClass(/\bwarn\b/);
  await expect(page.getByRole("list", { name: "At a glance" }).getByRole("listitem")).toHaveCount(1);

  await openDemoTrd(page);
  const open = page.getByTestId("trd-pill-open");
  await expect(open).toHaveText(/^\d+ open items?$/);
  await expect(page.getByTestId("trd-pill-steps")).toHaveText(/^\d+ process steps?$/);
  // The pill is the same count as the tab name ("4. Open items (n)").
  const n = (await open.innerText()).match(/^(\d+)/)![1];
  await expect(page.getByTestId("trd-tab-open")).toContainText(`(${n})`);
});

test("the header comes in the same order everywhere: breadcrumb, title, purpose, chain strip, then the tabs", async ({ page }) => {
  await openDemoTrd(page);
  const y = async (loc: ReturnType<Page["locator"]>) => (await loc.first().boundingBox())!.y;
  const crumb = await y(breadcrumb(page));
  const title = await y(page.getByRole("heading", { level: 1 }));
  const purpose = await y(page.getByTestId("page-purpose"));
  const chain = await y(page.getByTestId("doc-chain"));
  const tabs = await y(page.getByTestId("trd-tabs").getByRole("tablist"));
  expect(crumb).toBeLessThan(title);
  expect(title).toBeLessThan(purpose);
  expect(purpose).toBeLessThan(chain);
  expect(chain).toBeLessThan(tabs);
  // The drafting-aid notice (the page-wide strip from the first redesign job) stays above all of it.
  expect(await y(page.getByTestId("notice-strip"))).toBeLessThan(crumb);
});

// ------------------------------------------------------------------ About this page

test("About this page: closed on every visit, names what it opens, shows the explanation and the picture, and closes again", async ({ page }) => {
  test.setTimeout(90_000);
  await openDemoTrd(page);
  const toggle = page.getByTestId("about-toggle");
  await expect(toggle).toHaveText(/^About this page/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const panelId = await toggle.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  await expect(page.getByTestId("about-panel")).toBeHidden();
  // No picture is drawn until the person asks for the explanation.
  await expect(page.locator(".about-art")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByTestId("about-panel");
  await expect(panel).toBeVisible();
  expect(await panel.getAttribute("id")).toBe(panelId);
  // The panel is a labelled region, named by the button that opens it.
  await expect(page.getByRole("region", { name: /About this page/ })).toBeVisible();
  await expect(panel).toContainText("technical requirements");
  await expect(panel.locator("figure[data-art]")).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `about this page, open, ${scheme}`);
    await expectNoHorizontalScroll(page, `about this page, open, ${scheme}`);
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  // Opening it is not remembered: after a reload, and on another page, it starts closed.
  await toggle.click();
  await page.reload();
  await expect(page.getByTestId("about-toggle")).toHaveAttribute("aria-expanded", "false");
  await go(page, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.getByTestId("about-toggle")).toHaveAttribute("aria-expanded", "false");
});

// ------------------------------------------------------------------ Export menu

test("Export menu: the page's downloads, arrow keys, Home and End, Escape returns focus, and an item leads to the matching button", async ({ page }) => {
  test.setTimeout(90_000);
  await openDemoTrd(page);
  const button = page.getByTestId("export-menu-button");
  await expect(button).toHaveAccessibleName(/^Export/);
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // The menu lists the downloads the Output tab already has, with the same labels.
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "Export" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Download TRD (Word)", "Download TRD (HTML)", "Download evidence record (Word)", "Download evidence record (HTML)"]);
  // Targets are big enough to hit: 24 px on a wide screen, 44 px on a phone.
  const min = page.viewportSize()!.width <= 700 ? 43.5 : 23.5;
  for (const loc of [button, ...(await menu.getByRole("menuitem").all())]) expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(min);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `export menu open, ${scheme}`);
    await expectNoHorizontalScroll(page, `export menu open, ${scheme}`);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();

  // From the keyboard: the arrow on the button opens the menu on the first item; the arrows, Home and End move; the ends wrap.
  const items = page.getByRole("menuitem");
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Enter on the button also lands on the first item. Choosing "Download TRD (HTML)" opens the Output tab with that button focused
  // (the kind of download and the pre-download check are there); nothing is downloaded until that button is pressed.
  await page.keyboard.press("Enter");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("trd-tab-output")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("trd-download-html")).toBeFocused();

  // A click or tap outside closes an open menu.
  await button.click();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.getByRole("heading", { level: 1 }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Export menu on the Document page runs the same downloads as the buttons, including the pre-download check", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.getByRole("heading", { level: 1, name: "Document" })).toBeVisible();
  // (The "?" beside Word is a help tip, not a download.)
  const buttons = page.getByTestId("downloads-row").getByRole("button", { name: /^(Download|Print)/ });
  await expect(buttons).toHaveText(["Download Word document", "Download HTML", "Download Markdown", "Print / save as PDF"]);
  // Word is the one highlighted download; Print is not set above it.
  await expect(buttons.nth(0)).toHaveClass(/\bprimary\b/);
  await expect(buttons.nth(3)).not.toHaveClass(/\bprimary\b/);

  await page.getByTestId("export-menu-button").click();
  await expect(page.getByRole("menuitem")).toHaveText(["Download Word document", "Download HTML", "Download Markdown", "Print / save as PDF"]);
  const [md] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("menuitem", { name: "Download Markdown" }).click();
      // The demo has open TBD values, so the same warning as the button's appears first.
      await expect(page.getByRole("dialog", { name: "Download with TBD values?" })).toBeVisible();
      await page.getByRole("button", { name: "Download anyway" }).click();
    })(),
  ]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);
  // And the export history has the row, as it has after the button.
  await expect(page.getByRole("region", { name: "Export history table" }).locator("tbody tr").first()).toContainText("Markdown");
});

test("the Export button is a 44 px target on a phone, in a full-width row, and the chain strip is one line", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Phone layout only");
  await openDemoTrd(page);
  const width = page.viewportSize()!.width;
  const button = (await page.getByTestId("export-menu-button").boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(43.5);
  const actions = (await page.locator(".page-head-actions").boundingBox())!;
  expect(actions.width, "the actions use the full width").toBeGreaterThan(width - 40);
  const chain = (await page.getByTestId("doc-chain").boundingBox())!;
  expect(chain.height, "the chain strip is one line").toBeLessThan(64);
  await expectNoHorizontalScroll(page, "phone header");
});

// ------------------------------------------------------------------ where the work starts

/** The page y of the tab strip, or of the first content block when the page has no tabs. */
async function workTop(page: Page): Promise<{ y: number | null; what: string }> {
  return page.evaluate(() => {
    const main = document.getElementById("main")!;
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const abs = (el: Element) => Math.round(el.getBoundingClientRect().top + window.scrollY);
    const tabs = [...main.querySelectorAll('[role="tablist"], [data-testid="plan-tabs"]')].filter(vis)[0];
    if (tabs) return { y: abs(tabs), what: "tab strip" };
    // A page with no card (Guidance) starts with its search box.
    const block = [...main.querySelectorAll(".card, .table-scroll, fieldset, form, table, input:not([type=hidden]), select, textarea")].filter(vis)[0];
    return { y: block ? abs(block) : null, what: "first content block" };
  });
}

test("the tab strip, or the first content card, starts above y=600 on a wide screen and y=700 on a phone", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "Measured at 1280 x 800 and 390 x 844 only");
  test.setTimeout(180_000);
  const phone = info.project.name === "phone";
  await loadDemo(page);
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  const limit = phone ? 700 : 600;
  // The first record of each module, found on its list page.
  const routes: string[] = [...HEADER_PAGES];
  for (const [list, re] of [["#/trd", /[?&]trd=/], ["#/sampling", /[?&]plan=/], ["#/mbr", /[?&]mbr=/], ["#/risk", /[?&]ra=/]] as const) {
    await go(page, list);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const link = (await page.$$eval("main a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""))).find((h) => re.test(h));
    expect(link, `a record on ${list}`).toBeTruthy();
    routes.push(link!);
    if (list === "#/mbr") routes.push(link!.replace("#/mbr?", "#/mbr/view?"));
  }
  const tooLow: string[] = [];
  for (const r of routes) {
    await go(page, r);
    await expect(page.getByRole("heading", { level: 1 }).first(), r).toBeVisible();
    const m = await workTop(page);
    if (m.y === null || m.y >= limit) tooLow.push(`${r}: ${m.what} at ${m.y}`);
  }
  expect(tooLow, `starts below y=${limit}`).toEqual([]);
});

// ------------------------------------------------------------------ narrow phones

test("nothing scrolls sideways at 390, 360 and 320 px with the explanation and the Export menu open", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The widths are set by the test");
  test.setTimeout(180_000);
  await loadDemo(page);
  const records: string[] = [];
  for (const [list, re] of [["#/trd", /[?&]trd=/], ["#/sampling", /[?&]plan=/], ["#/mbr", /[?&]mbr=/], ["#/risk", /[?&]ra=/]] as const) {
    await go(page, list);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const link = (await page.$$eval("main a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""))).find((h) => re.test(h));
    records.push(link!);
  }
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of [...records, "#/document", "#/register", "#/guidance"]) {
      await go(page, route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // The breadcrumb is one line and only the project name gives way (with an ellipsis): the area and the page are never cut off.
      const crumbs = page.locator(".page-crumbs ol");
      if (await crumbs.count()) {
        expect(await crumbs.evaluate((ol) => ol.scrollWidth - ol.clientWidth), `${route} at ${width}px: the breadcrumb is cut off`).toBeLessThanOrEqual(1);
        const current = (await page.locator('.page-crumbs li[aria-current="page"]').boundingBox())!;
        expect(current.x + current.width, `${route} at ${width}px: the current page's name is on screen`).toBeLessThanOrEqual(width);
      }
      const toggle = page.getByTestId("about-toggle");
      if (await toggle.count()) {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      }
      const menuButton = page.getByTestId("export-menu-button");
      if (await menuButton.count()) await menuButton.click();
      await expectNoHorizontalScroll(page, `${route} at ${width}px`);
      if (await menuButton.count()) {
        // Close it again so the next page starts from its normal state.
        if ((await menuButton.getAttribute("aria-expanded")) === "true") await page.keyboard.press("Escape");
      }
    }
  }
});
