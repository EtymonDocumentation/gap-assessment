// The Cascade look (website redesign): the product name and mark, the notice strip, the header (menus, open project, theme menu, phone
// Menu button), the self-hosted font, and the layout limits (one header row, no sideways scroll at 390, 360 and 320 px). Runs at the desktop,
// tablet and phone widths. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNotice, isPhone, NOTICE_FOOTER, openDemo, PRODUCT_NAME, PRODUCT_SUBTITLE, setTheme, STORAGE_PHRASE_BROWSER } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function openSyringe(page: Page) {
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

const menuButton = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Menu" });

test("the product is Cascade: page title, mark and name in the header, the line above the Home title, an SVG favicon", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle(`${PRODUCT_NAME}: ${PRODUCT_SUBTITLE}`);
  const brand = page.locator("header.app-header .brand");
  await expect(brand).toContainText(PRODUCT_NAME);
  // The mark is a drawing of three bars that step down and right; the name beside it is its label, so the drawing is hidden from readers.
  const mark = brand.locator("svg.cascade-mark");
  await expect(mark).toHaveAttribute("viewBox", "0 0 32 32");
  await expect(mark).toHaveAttribute("aria-hidden", "true");
  await expect(mark.locator("rect")).toHaveCount(3);
  // Home keeps its title and says what the product is for above it.
  await expect(page.getByRole("heading", { level: 1, name: "Gap assessment for technology transfer" })).toBeVisible();
  await expect(page.locator("main .eyebrow")).toHaveText(`${PRODUCT_NAME} · ${PRODUCT_SUBTITLE}`);
  await expect(page.getByTestId("about-poc")).toContainText(`About ${PRODUCT_NAME}`);
  // The tab icon is an SVG file served by the site itself.
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("type", "image/svg+xml");
  const res = await page.request.get(new URL((await icon.getAttribute("href"))!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const svg = await res.text();
  expect(svg).toContain('viewBox="0 0 32 32"');
  expect(svg.match(/<rect /g)).toHaveLength(3);
});

test("the notice strip is on every page in the short or long form for the width, and the old wording is gone", async ({ page }) => {
  await page.goto("./");
  await expectNotice(page, STORAGE_PHRASE_BROWSER);
  const strip = page.getByTestId("notice-strip");
  await expect(strip).toHaveAttribute("role", "note");
  await expect(page.getByText("Proof of concept")).toHaveCount(0);
  await expect(page.getByText("Not for GMP use")).toHaveCount(0);
  // The design: 12 px white text on the dark red, about 4 px of padding above and below.
  const look = await strip.evaluate((e) => {
    const s = getComputedStyle(e);
    return { size: s.fontSize, top: s.paddingTop, bottom: s.paddingBottom, bg: s.backgroundColor, color: s.color };
  });
  expect(look).toEqual({ size: "12px", top: "4px", bottom: "4px", bg: "rgb(122, 23, 23)", color: "rgb(255, 255, 255)" });
  // The page footer says it again, with the filing-category sentence, and links to the About and privacy page.
  await expect(page.getByTestId("notice-footer").locator(".app-footer-text")).toHaveText(NOTICE_FOOTER);
  await expect(page.getByTestId("notice-footer").getByRole("link", { name: "About and privacy" })).toBeVisible();

  // It is on the pages of every module, and it stays in view while the page scrolls.
  await openSyringe(page);
  for (const h of ["#/", "#/register", "#/document", "#/trd?trd=TRD-001", "#/sampling", "#/mbr", "#/mbr/view?mbr=MBR-001", "#/risk", "#/tbd", "#/guidance", "#/templates"]) {
    await hash(page, h);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expectNotice(page);
  }
  await hash(page, "#/register");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(strip).toBeInViewport();
});

test("the header: a dark bar with the same menus, the open project, a theme menu; a phone gets a Menu button", async ({ page }) => {
  await page.goto("./");
  const bar = page.locator("header.app-header");
  // One row: 56 px on wide screens, 52 px on a phone, and the 1 px line under it.
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(isPhone(page) ? 53 : 57);
  expect(await bar.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(22, 32, 43)");
  // No project open: no project button.
  await expect(page.getByRole("link", { name: /^Project:/ })).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: "Main" });
  if (isPhone(page)) {
    // The menus fold into one 44 px button; the theme button is 44 px too.
    for (const b of [menuButton(page), page.getByRole("button", { name: /^Colour theme/ })]) {
      const r = (await b.boundingBox())!;
      expect(r.width, "a phone target is at least 44 px wide").toBeGreaterThanOrEqual(44);
      expect(r.height, "a phone target is at least 44 px high").toBeGreaterThanOrEqual(44);
    }
    await expect(nav.getByRole("link")).toHaveCount(0);
    await menuButton(page).click();
    for (const name of ["Home", "TRD", "Sampling plan", "Batch record", "Risk assessment", "Open items", "Templates", "Guidance"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    // No project is open, so there is no "Gap assessment" link to nowhere.
    await expect(nav.getByRole("link", { name: "Gap assessment", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menuButton(page)).toBeFocused();
  } else {
    await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Gap assessment", exact: true })).toHaveCount(0);
    for (const group of ["Documents", "Library"]) {
      const button = nav.getByRole("button", { name: new RegExp(`^${group}`) });
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
    // Every control of the bar is at least 24 px square (WCAG 2.2 target size).
    for (const b of [page.getByRole("button", { name: /^Colour theme/ }), nav.getByRole("button", { name: /^Documents/ })]) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
  }

  // With a project open: its title in the bar (wide), or in the Menu panel (phone), and the way to the project page.
  await openSyringe(page);
  await hash(page, "#/trd?trd=TRD-001");
  await expect(page.locator("main h1").first()).toBeVisible();
  if (isPhone(page)) {
    await menuButton(page).click();
    const project = nav.getByRole("link", { name: /^SYR-305/ });
    await expect(project).toBeVisible();
    await expect(nav.getByText(STORAGE_PHRASE_BROWSER)).toBeVisible();
    await project.click();
  } else {
    const project = page.getByRole("link", { name: /^Project: SYR-305/ });
    await expect(project).toHaveAttribute("title", /^SYR-305/);
    await expect(project).toHaveAttribute("href", /#\/$/);
    await project.click();
  }
  await expect(page.getByTestId("home-chain")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test("the theme menu offers System, Light and Dark, applies at once, remembers the choice and closes with Escape", async ({ page }) => {
  await page.goto("./");
  const button = page.getByRole("button", { name: /^Colour theme/ });
  await expect(button).toHaveAccessibleName("Colour theme: System");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const group = page.getByRole("group", { name: "Colour theme" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: "System", exact: true })).toBeChecked();
  // Nothing is chosen for the person: System is what the device says, and picking another is one click.
  await group.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).toHaveAccessibleName("Colour theme: Dark");
  // The panel stays open, so the person sees what each choice does.
  await expect(group).toBeVisible();
  await group.getByRole("radio", { name: "Light", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await group.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(group).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // The choice is kept in this browser.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /^Colour theme/ })).toHaveAccessibleName("Colour theme: Dark");
  // System forgets it again.
  await setTheme(page, "System");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await page.evaluate(() => localStorage.getItem("gap-theme"))).toBeNull();
  // A click outside closes the menu too.
  await page.getByRole("button", { name: /^Colour theme/ }).click();
  await expect(page.getByRole("group", { name: "Colour theme" })).toBeVisible();
  // (The footer is plain text at the bottom of the page: on a phone the open menu covers the page heading, so the heading is no target.)
  await page.getByTestId("notice-footer").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("group", { name: "Colour theme" })).toBeHidden();
});

test("the header, the theme menu and the phone Menu panel pass axe in the light and the dark theme", async ({ page }) => {
  test.setTimeout(120_000);
  await openSyringe(page);
  await hash(page, "#/trd?trd=TRD-001");
  await expect(page.locator("main h1").first()).toBeVisible();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await expectAccessible(page, `${theme}: header and chain strip`);
    await page.getByRole("button", { name: /^Colour theme/ }).click();
    await expectAccessible(page, `${theme}: theme menu open`);
    await page.keyboard.press("Escape");
    if (isPhone(page)) {
      await menuButton(page).click();
      await expectAccessible(page, `${theme}: Menu panel open`);
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Documents/ }).click();
      await expectAccessible(page, `${theme}: Documents menu open`);
      await page.keyboard.press("Escape");
    }
  }
});

test("IBM Plex Sans is served by the site itself; no font, script or style comes from another host", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) hosts.add(new URL(r.url()).host);
  });
  await page.goto("./");
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('600 16px "IBM Plex Sans"');
    await document.fonts.load('400 16px "IBM Plex Sans"');
    return { semibold: document.fonts.check('600 16px "IBM Plex Sans"'), regular: document.fonts.check('400 16px "IBM Plex Sans"') };
  });
  expect(loaded).toEqual({ semibold: true, regular: true });
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?IBM Plex Sans"?,/);
  expect([...hosts]).toEqual([new URL(page.url()).host]);
  // The licence text of the font travels with the site.
  const licence = await page.request.get(new URL("fonts/IBM-Plex-Sans-OFL-1.1.txt", page.url()).toString());
  expect(licence.ok()).toBe(true);
  expect(await licence.text()).toContain("SIL OPEN FONT LICENSE Version 1.1");
});

test("no sideways scroll at 390, 360 and 320 px, and the header stays one row", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the narrow widths are checked once, from the phone project");
  test.setTimeout(120_000);
  await openSyringe(page);
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const h of ["#/", "#/trd?trd=TRD-001", "#/sampling", "#/mbr/view?mbr=MBR-001", "#/register", "#/risk"]) {
      await hash(page, h);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoSidewaysScroll(page, `${h} at ${width} px`);
      const bar = (await page.locator("header.app-header").boundingBox())!;
      expect(bar.height, `${h} at ${width} px: the header bar is one row`).toBeLessThanOrEqual(53);
    }
    // The open Menu panel and the open theme menu stay inside the screen.
    await menuButton(page).click();
    await expectNoSidewaysScroll(page, `Menu panel at ${width} px`);
    const panel = (await page.locator(".nav-menu-panel").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Colour theme/ }).click();
    const pop = (await page.locator(".header-popover:not([hidden])").boundingBox())!;
    expect(pop.x).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
});
