// Job T1: the Help (?) button, the guided tour of each page and the glossary. Desktop, tablet and phone.
// Tours never start by themselves in an automated browser unless a test sets the force key (see autoStartAllowed in src/tour.tsx), so the
// other specs are unaffected; the tests here that look at the automatic start set it first.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNotice, isPhone, openDemo, setTheme } from "./nav-helper";

const SHOTS = process.env["T1_SHOTS"]; // a folder: when set, the screenshots for the job report are saved there

async function forceTours(page: Page) {
  await page.addInitScript(() => localStorage.setItem("gap-tour-force", "1"));
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
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

/** Opens the Help entries: the header menu on a wide screen, the Help section at the end of the Menu panel on a phone. */
async function openHelp(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByText("Help", { exact: true }).scrollIntoViewIfNeeded();
  } else {
    await page.getByTestId("help-menu-button").click();
  }
}

/** The "Tour of this page" entry: a menu item in the header menu, a button in the phone Menu panel. */
const tourEntry = (page: Page) => (isPhone(page) ? page.getByRole("button", { name: "Tour of this page" }) : page.getByRole("menuitem", { name: "Tour of this page" }));
const aboutEntry = (page: Page) => page.getByTestId("help-about");
const glossaryEntry = (page: Page) => page.getByRole(isPhone(page) ? "link" : "menuitem", { name: "Glossary", exact: true }).first();

async function shot(page: Page, name: string) {
  if (SHOTS) await page.waitForTimeout(700); // let a smooth scroll settle
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/t1-${name}-${isPhone(page) ? "phone" : "desktop"}.png` });
}

const bubble = (page: Page) => page.getByTestId("tour-bubble");

test("the Help button offers the tour and the glossary, and no About section on Home", async ({ page }) => {
  await page.goto("./");
  await expectNotice(page);
  await openHelp(page);
  await expect(tourEntry(page)).toBeVisible();
  await expect(glossaryEntry(page)).toBeVisible();
  // Home has no "About this page" section, so the entry is absent (not disabled).
  await expect(aboutEntry(page)).toHaveCount(0);
  await shot(page, "help-menu");
});

test("the Help menu works from the keyboard: opens, moves, closes with Escape and returns focus", async ({ page }) => {
  test.skip(isPhone(page), "On a phone Help is part of the Menu panel, covered by the other tests");
  await page.goto("./");
  const button = page.getByTestId("help-menu-button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const tour = page.getByRole("menuitem", { name: "Tour of this page" });
  await expect(tour).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Glossary" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(tour).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  // Space opens it too.
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
});

test("the Home tour starts by itself once, Skip ends it, it does not return on reload, and Help replays it", async ({ page }) => {
  await forceTours(page);
  await page.goto("./");
  await expect(bubble(page)).toBeVisible();
  await expect(page.getByTestId("tour-count")).toHaveText(/^Step 1 of \d/);
  // Focus moved into the bubble.
  await expect(bubble(page)).toBeFocused();
  await shot(page, "tour-step");
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(bubble(page)).toHaveCount(0);
  await page.reload();
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(1500);
  await expect(bubble(page)).toHaveCount(0);
  // Replay from Help.
  await openHelp(page);
  await tourEntry(page).click();
  await expect(bubble(page)).toBeVisible();
  // Escape skips the tour.
  await page.keyboard.press("Escape");
  await expect(bubble(page)).toHaveCount(0);
});

test("with storage unavailable no tour starts by itself", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gap-tour-force", "1");
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.startsWith("gap-tour-probe") || k.startsWith("gap-tour-seen")) throw new Error("blocked");
      return real.call(this, k, v);
    };
  });
  await page.goto("./");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(1500);
  await expect(bubble(page)).toHaveCount(0);
});

test("a tour can be walked to Done, including the stage step on Home", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx");
  await openHelp(page);
  await tourEntry(page).click();
  await expect(bubble(page)).toBeVisible();
  const titles: string[] = [];
  for (let i = 0; i < 8; i++) {
    titles.push((await bubble(page).getByRole("heading").textContent()) ?? "");
    if (i === 1) await shot(page, "tour-stage-step");
    const done = bubble(page).getByRole("button", { name: "Done" });
    if (await done.isVisible()) {
      await done.click();
      break;
    }
    await bubble(page).getByRole("button", { name: "Next" }).click();
  }
  expect(titles).toEqual(["Start here", "Project stage", "Next step", "Your documents", "Getting started"]);
  await expect(bubble(page)).toHaveCount(0);
  // Back works, and the first step has no Back.
  await openHelp(page);
  await tourEntry(page).click();
  await expect(bubble(page).getByRole("button", { name: "Back" })).toHaveCount(0);
  await bubble(page).getByRole("button", { name: "Next" }).click();
  await bubble(page).getByRole("button", { name: "Back" }).click();
  await expect(bubble(page).getByRole("heading")).toHaveText("Start here");
  await expectNoHorizontalScroll(page, "tour open");
  await bubble(page).getByRole("button", { name: "Skip tour" }).click();
});

test("a module page starts its tour on the first visit and Help opens the page's About section", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "syr");
  await forceTours(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await bubble(page).getByRole("button", { name: "Skip tour" }).click();
  await go(page, "#/trd");
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page).getByRole("heading")).toHaveText("What this page is");
  await bubble(page).getByRole("button", { name: "Skip tour" }).click();
  await openHelp(page);
  await aboutEntry(page).click();
  await expect(page.getByTestId("about-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("about-toggle")).toBeFocused();
  // The tour is not offered again by itself.
  await go(page, "#/");
  await go(page, "#/trd");
  await page.waitForTimeout(1500);
  await expect(bubble(page)).toHaveCount(0);
});

test("every page tour finds its elements and can be walked to Done", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "syr");
  for (const hash of ["#/interview", "#/risk", "#/sampling", "#/mbr", "#/trd"]) {
    await go(page, hash);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await openHelp(page);
    await tourEntry(page).click();
    await expect(bubble(page), hash).toBeVisible();
    await expect(page.getByTestId("tour-count")).toHaveText(/^Step 1 of [2-5]$/);
    for (let i = 0; i < 6; i++) {
      const done = bubble(page).getByRole("button", { name: "Done" });
      if (await done.isVisible()) {
        await done.click();
        break;
      }
      await bubble(page).getByRole("button", { name: "Next" }).click();
    }
    await expect(bubble(page), hash).toHaveCount(0);
  }
});

test("the glossary: the filter narrows, an anchor link lands on the term, no sideways scroll", async ({ page }) => {
  await page.goto("./");
  await openHelp(page);
  await glossaryEntry(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Glossary" })).toBeVisible();
  const total = await page.getByTestId(/^term-/).count();
  expect(total).toBeGreaterThanOrEqual(30);
  await page.getByTestId("glossary-filter").fill("proven acceptable");
  await expect(page.getByTestId("term-par")).toBeVisible();
  expect(await page.getByTestId(/^term-/).count()).toBeLessThan(total);
  await page.getByTestId("glossary-filter").fill("zzzz-no-such-word");
  await expect(page.getByText("No term matches")).toBeVisible();
  await page.getByTestId("glossary-filter").fill("");
  await expect(page.getByTestId(/^term-/)).toHaveCount(total);
  await expectNoHorizontalScroll(page, "glossary");
  await shot(page, "glossary");
  // An anchor link from elsewhere lands on the term.
  await go(page, "#/");
  await go(page, "#/glossary?term=nor");
  await expect(page.getByTestId("term-nor")).toBeInViewport();
  await expect(page.getByTestId("term-nor")).toBeFocused();
  // A "see also" link moves to the next term.
  await page.getByRole("link", { name: "PAR (proven acceptable range)" }).first().click();
  await expect(page.getByTestId("term-par")).toBeFocused();
  // The footer links to it too.
  await expect(page.getByTestId("notice-footer").getByRole("link", { name: "Glossary" })).toBeVisible();
});

test("axe is clean with a tour step, the Help menu and the glossary open, in light and dark", async ({ page }) => {
  await forceTours(page);
  await page.goto("./");
  await expect(bubble(page)).toBeVisible();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    if (theme === "Dark") await shot(page, "tour-dark");
    await expectAccessible(page, `Home tour step, ${theme}`);
  }
  await page.getByRole("button", { name: "Skip tour" }).click();
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await openHelp(page);
    await expectAccessible(page, `Help menu, ${theme}`);
    await page.keyboard.press("Escape");
    await go(page, "#/glossary");
    await expect(page.getByRole("heading", { level: 1, name: "Glossary" })).toBeVisible();
    await expectAccessible(page, `Glossary, ${theme}`);
    await go(page, "#/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});
