import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_NAMES, expectNotice, openDemo, openMoreWays, setTheme } from "./nav-helper";

// The two demo buttons (fix job D1, rows 16 and showcase audit 1): next to "Start a new project", one wording, a "Building the demo" line at
// once, buttons off while it builds, and the same landing for both demos. The demo build takes seconds, so these specs allow it time.

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("./");
  await expectNotice(page);
});

async function axeClean(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`).join("\n"), label).toBe("");
}

test("both demos sit under More ways to start, below the one big Start a new project, with one wording", async ({ page }) => {
  const options = page.getByTestId("start-options");
  await expect(options.getByRole("button", { name: "Start a new project" })).toBeVisible();
  // EOU-01: the demos are one fold away, closed at first.
  await expect(page.getByTestId("more-ways")).not.toHaveAttribute("open", "");
  await expect(options.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` })).toBeHidden();
  await openMoreWays(page);
  await expect(options.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` })).toBeVisible();
  await expect(options.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` })).toBeVisible();
  // The old wordings are gone, and only one control starts a project.
  await expect(page.getByRole("button", { name: "Load demo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open syringe example" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create a project/ })).toHaveCount(0);
  // The buttons are in the first screen, not 2,500 px down.
  const box = await options.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` }).boundingBox();
  expect(box?.y ?? 99999).toBeLessThan(1400);
});

test("the Building line shows within 100 ms, buttons go off, a second click is ignored, and both demos land on Home", async ({ page }) => {
  test.setTimeout(120_000);
  await openMoreWays(page);
  // Measured inside the page: Playwright's own polling queues behind a busy page, so it cannot tell a 50 ms answer from a 5 s freeze.
  const shown = await page.evaluate(async (name) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === `Open demo: ${name}`)!;
    return await new Promise<{ ms: number; text: string; disabled: number }>((resolve) => {
      const t0 = performance.now();
      const seen = new MutationObserver(() => {
        const el = document.querySelector('[data-testid="demo-status"]');
        if (el?.textContent?.includes("Building the demo")) {
          seen.disconnect();
          // The next frame is the first one the user can see the line in.
          requestAnimationFrame(() => {
            const disabled = [...document.querySelectorAll('[data-testid="start-options"] button')].filter((b) => (b as HTMLButtonElement).disabled).length;
            resolve({ ms: performance.now() - t0, text: el.textContent ?? "", disabled });
          });
        }
      });
      seen.observe(document.body, { childList: true, subtree: true, characterData: true });
      button.click();
      // A repeat click in the same frame: ignored by the in-flight guard even before React shows the buttons as disabled.
      button.click();
    });
  }, DEMO_NAMES.arx);
  expect(shown.ms).toBeLessThan(100);
  expect(shown.text).toContain(`Building the demo: ${DEMO_NAMES.arx}`);
  // Start, the three "Start with one document" buttons (TRD, sampling plan, batch record), ARX and SYR are all off
  // while the demo builds: any of them would replace the project the demo is writing.
  expect(shown.disabled).toBe(6);
  await expect(page.getByTestId("demo-opened")).toHaveText(`Demo opened: ${DEMO_NAMES.arx}`, { timeout: 90_000 });
  await expect(page.getByTestId("demo-status")).toHaveText("");
  await openMoreWays(page);
  await expect(page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` })).toBeEnabled();
  // Landing: Home, with the open project card.
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);
  await expect(page.getByTestId("open-project")).toContainText("ARX-217");

  // The other demo ends in the same place with the same wording.
  await openDemo(page, "syr");
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);
  await expect(page.getByTestId("open-project")).toContainText("SYR-305");
  await expect(page.getByTestId("demo-opened")).toHaveText(`Demo opened: ${DEMO_NAMES.syr}`);

  // The line belongs to the visit: gone once the user goes elsewhere.
  await page.evaluate(() => (window.location.hash = "#/templates"));
  await page.evaluate(() => (window.location.hash = "#/"));
  await expect(page.getByTestId("demo-opened")).toHaveCount(0);
});

test("the Home page with a demo building and with a demo open has no accessibility violations, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  for (const theme of ["Light", "Dark"] as const) {
    await setTheme(page, theme);
    await axeClean(page, `home ${theme}`);
  }
  await openMoreWays(page);
  await page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` }).click();
  await expect(page.getByTestId("demo-status")).toContainText("Building the demo");
  await axeClean(page, "home while building (dark)");
  await expect(page.getByTestId("demo-opened")).toBeVisible({ timeout: 90_000 });
  await axeClean(page, "home with the demo open (dark)");
  await setTheme(page, "Light");
  await axeClean(page, "home with the demo open (light)");
});
