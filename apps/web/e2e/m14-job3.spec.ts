// M14 job 3: the gap interview map page and the "Your areas" editor. Checked here, at desktop, tablet and phone with axe: "See the map" in the side
// column, the address (view and node), a tile starting a run limited to its questions, "Show only TBD" and its one-line note, the end card and "Back to
// the map" (focus, status line and the changed count), the old Progress map list still showing the same counts, the unit switch following the side of the
// question, the editor (empty state, example preview, "From the example, please check", add, rename, grade, nest, a step in two areas, remove with a
// typed reason), the demo areas, a keyboard-only pass, no sideways scroll at 390 and 360 px, light and dark pictures and blocked browser storage.
// Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDemo, openInterviewMore, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const shot = (page: Page, name: string, theme: string) => page.screenshot({ path: join(tmpdir(), `m14-job3-${name}-${test.info().project.name}-${theme}.png`), fullPage: true });

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

/** Axe in the light and the dark theme, and a picture of each. */
async function checkBothThemes(page: Page, label: string, name: string) {
  await setTheme(page, "Light");
  await expectAccessible(page, `${label} (light)`);
  await shot(page, name, "light");
  await setTheme(page, "Dark");
  await expectAccessible(page, `${label} (dark)`);
  await shot(page, name, "dark");
  await setTheme(page, "Light");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const check = async (tag: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${label}${tag}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  };
  await check("");
  const size = page.viewportSize()!;
  if (size.width <= 400) {
    await page.setViewportSize({ width: 360, height: size.height });
    await check(" at 360 px");
    await page.setViewportSize(size);
  }
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** A new project with no areas at all. */
async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Areas test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
}

const node = (page: Page, id: string) => page.getByTestId(`imap-node-${id}`);
const CAPPING = "step:capping";
const status = (page: Page) => page.locator("div.visually-hidden[aria-live='polite']");
const areaCards = (page: Page) => page.getByTestId(/^area-AR-\d+$/);

test("See the map opens the map page; the address opens the right view and node; the last view is remembered", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview");
  await expect(page.getByTestId("see-the-map")).toBeVisible();
  await expect(page.getByTestId("gap-map")).toHaveCount(0);
  await page.getByTestId("see-the-map").click();
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await expect(page).toHaveURL(/view=/);
  // One three-way group, like the TRD tab.
  await expect(page.getByTestId("iv-views")).toBeVisible();
  for (const v of ["list", "process", "areas"]) await expect(page.getByTestId(`iv-view-${v}`)).toBeVisible();
  await expect(node(page, CAPPING)).toContainText("3 open");
  await checkBothThemes(page, "gap map, process steps", "map-process");
  await expectNoSidewaysScroll(page, "gap map, process steps");

  // The area view, then back to the plain list; "See the map" opens the last view used.
  await page.getByTestId("iv-view-areas").click();
  await expect(page).toHaveURL(/view=areas/);
  await expect(page.getByTestId("iv-unit-switch")).toBeVisible();
  await expect(page.getByTestId("iv-unit-ru")).toBeChecked();
  await page.getByTestId("iv-unit-su").click();
  await expect(page).toHaveURL(/unit=su/);
  await checkBothThemes(page, "gap map, areas", "map-areas");
  await expectNoSidewaysScroll(page, "gap map, areas");
  await page.getByTestId("iv-view-list").click();
  await expect(page.getByTestId("gap-map")).toHaveCount(0);
  await expect(page.getByTestId("see-the-map")).toBeVisible();
  await page.getByTestId("see-the-map").click();
  await expect(page.getByTestId("iv-view-areas")).toBeChecked();

  // The address names the view and the node.
  await hash(page, "#/interview?view=process");
  await expect(page.getByTestId("iv-view-process")).toBeChecked();
  await hash(page, `#/interview?view=process&node=${encodeURIComponent(CAPPING)}`);
  await expect(page.getByTestId("run-note")).toBeVisible();
  await expect(page.getByTestId("run-line")).toContainText("Capping and crimping");
  await expect(page.locator("#q-prompt")).toBeVisible();
  await expect(page.getByTestId("gap-map")).toHaveCount(0);
});

test("a tile starts a run of its own questions; Show only TBD narrows it with a note; the end card returns to the map with the count changed", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview?view=map");
  await expect(node(page, CAPPING)).toContainText("20 of 23 answered, 3 open");
  await node(page, CAPPING).click();
  // The first open question comes first, and the card is the same question card.
  await expect(page.getByTestId("run-line")).toHaveText("Showing every question in Capping and crimping.");
  await expect(page.locator("#q-prompt")).toContainText("residual seal force");
  await checkBothThemes(page, "narrowed question card", "run");
  await expectNoSidewaysScroll(page, "narrowed question card");

  // Show only TBD says so in one line and keeps to the node.
  await page.getByText("Show only TBD").click();
  await expect(page.getByTestId("run-line")).toHaveText("Showing only the questions recorded as TBD in Capping and crimping.");

  // Answer the first question (the demo's first open one is single-sided), then move on to the end of the step.
  await page.locator(".question-card .choice-chip").first().click();
  await page.locator(".question-card").getByRole("button", { name: /^Save/ }).first().click();
  for (let i = 0; i < 6; i++) {
    const end = page.getByTestId("gap-end");
    const link = page.locator(".q-nav").getByRole("link", { name: /^(Skip for now|Finish this step)/ });
    await expect(end.or(link)).toBeVisible();
    if (await end.isVisible()) break;
    await link.click();
  }
  await expect(page.getByTestId("gap-end")).toBeVisible();
  await expect(page.getByTestId("gap-end-line")).toContainText("Capping and crimping");
  await expect(page.getByTestId("gap-end-map")).toBeVisible();
  await checkBothThemes(page, "end-of-step card", "end");

  await page.getByTestId("gap-end-map").click();
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await expect(node(page, CAPPING)).toBeFocused();
  await expect(node(page, CAPPING)).toHaveAttribute("aria-current", /.+/);
  await expect(status(page)).toContainText("Back on the map. Capping and crimping");
  await expect(node(page, CAPPING)).toContainText("21 of 23 answered, 2 open");
});

test("Back to the map in the middle of a run; the old Progress map list shows the same counts", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview?view=map");
  const tileText = ((await node(page, CAPPING).innerText()) ?? "").replace(/\s+/g, " ");
  await node(page, CAPPING).click();
  await page.getByTestId("gap-back-to-map").click();
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await expect(node(page, CAPPING)).toBeFocused();
  await expect(status(page)).toContainText("Back on the map.");

  // The text equivalent: the Progress map list carries the same counts.
  await hash(page, "#/interview");
  await openInterviewMore(page);
  const counts = tileText.match(/(\d+) of (\d+) answered, (\d+) open/)!;
  await expect(page.locator(".pm-count", { hasText: `${counts[1]} of ${counts[2]} answered, ${counts[3]} open` }).first()).toBeVisible();
});

test("in the area view the unit switch follows the side of the current question", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview?view=areas&unit=ru&node=whole&q=site.name%40source");
  await expect(page.getByTestId("run-note")).toBeVisible();
  await page.getByTestId("gap-back-to-map").click();
  await expect(page.getByTestId("iv-unit-su")).toBeChecked();
  await hash(page, "#/interview?view=areas&unit=su&node=whole&q=site.name%40target");
  await page.getByTestId("gap-back-to-map").click();
  await expect(page.getByTestId("iv-unit-ru")).toBeChecked();
});

test("the demo has areas: they show in the area view and the editor lists them", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview?view=areas&unit=ru");
  await expect(page.getByTestId("imap-empty")).toHaveCount(0);
  await expect(page.getByTestId("gap-map")).toContainText("Filling room");
  await page.getByTestId("imap-edit-areas").click();
  await expect(page.getByTestId("areas-page")).toBeVisible();
  await expect(areaCards(page).first()).toBeVisible();
  await expect(page.getByTestId("areas-empty")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Filling room" })).toBeVisible();
  await checkBothThemes(page, "editor with the demo areas", "editor-demo");
  await expectNoSidewaysScroll(page, "editor with the demo areas");
  await page.getByTestId("areas-unit-su").click();
  await expect(areaCards(page).first()).toBeVisible();
});

test("the editor: empty state, example preview, use, please-check marker, add, rename, grade, nest, a step in two areas, remove with a reason", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/interview?view=areas");
  await expect(page.getByTestId("imap-empty")).toBeVisible();
  await expect(page.getByTestId("imap-add-first")).toBeVisible();
  await expect(page.getByTestId("imap-start-example")).toBeVisible();

  // "Add the first area" opens the editor on the receiving unit, with nothing in it yet.
  await page.getByTestId("imap-add-first").click();
  await expect(page.getByTestId("areas-page")).toBeVisible();
  await expect(page.getByTestId("areas-unit-ru")).toBeChecked();
  await expect(page.getByTestId("areas-empty")).toBeVisible();
  await expect(areaCards(page)).toHaveCount(0);
  await checkBothThemes(page, "editor, empty", "editor-empty");

  // The example is a read-only preview first; nothing changes until "Use this example".
  await page.getByTestId("areas-start-example").click();
  await expect(page.getByTestId("areas-example")).toBeVisible();
  await expect(areaCards(page)).toHaveCount(0);
  await checkBothThemes(page, "editor, example preview", "editor-example");
  await page.getByTestId("areas-close-example").click();
  await expect(page.getByTestId("areas-example")).toHaveCount(0);
  await page.getByTestId("areas-start-example").click();
  await page.getByTestId("areas-use-example").click();
  await expect(areaCards(page).first()).toBeVisible();
  const exampleCount = await areaCards(page).count();
  expect(exampleCount).toBeGreaterThan(0);
  const first = areaCards(page).first();
  const firstId = (await first.getAttribute("data-testid"))!;
  await expect(page.getByTestId(`${firstId}-from-example`)).toContainText("From the example, please check");
  await expectNoSidewaysScroll(page, "editor with the example");

  // "Looks right" takes the marker off that one area only.
  await page.getByTestId(`${firstId}-looks-right`).click();
  await expect(page.getByTestId(`${firstId}-from-example`)).toHaveCount(0);
  if (exampleCount > 1) await expect(page.getByTestId(/-from-example$/).first()).toBeVisible();

  // Add an area: the grade starts on "Choose..." with nothing preselected.
  await page.getByTestId("areas-add-name").fill("Test room (fictional)");
  await page.getByTestId("areas-add-button").click();
  await expect(areaCards(page)).toHaveCount(exampleCount + 1);
  const added = areaCards(page).last();
  const addedId = (await added.getAttribute("data-testid"))!;
  await expect(page.getByTestId(`${addedId}-grade`)).toHaveValue("");
  await expect(page.getByTestId(`${addedId}-inside`)).toHaveValue("");

  // Rename, grade, nest within the first area, and place two steps; one of them goes to two areas.
  await page.getByTestId(`${addedId}-name`).fill("Renamed test room");
  await page.getByTestId(`${addedId}-grade`).selectOption("B");
  await page.getByTestId(`${addedId}-inside`).selectOption({ index: 1 });
  const boxes = page.getByTestId(`${addedId}-steps`).locator("input[type=checkbox]");
  expect(await boxes.count()).toBeGreaterThan(1);
  const shared = (await boxes.nth(0).getAttribute("data-testid"))!.replace(`${addedId}-step-`, "");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByTestId(`${addedId}-save`).click();
  await expect(page.getByTestId(`${addedId}-summary`)).toContainText("B");
  await expect(page.getByRole("heading", { level: 3, name: "Renamed test room" })).toBeVisible();
  // The same step is also placed in the first area (several areas per step are allowed).
  await page.getByTestId(`${firstId}-step-${shared}`).check();
  await page.getByTestId(`${firstId}-save`).click();
  await expect(page.getByTestId(`${firstId}-step-${shared}`)).toBeChecked();
  await checkBothThemes(page, "editor with areas", "editor-areas");
  await expectNoSidewaysScroll(page, "editor with areas");

  // The map shows the step under both areas and the number of steps does not change.
  await page.getByTestId("areas-back").click();
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await page.getByTestId("iv-view-process").click();
  await expect(node(page, `step:${shared}`)).toContainText("Renamed test room");
  const before = await page.locator('button[data-node^="step:"]').count();

  // Remove with a typed reason; the change log keeps it.
  await page.getByTestId("iv-view-areas").click();
  await page.getByTestId("imap-edit-areas").click();
  await page.getByTestId(`${addedId}-remove`).click();
  await expect(page.getByTestId(`${addedId}-remove-panel`)).toBeVisible();
  await page.getByTestId(`${addedId}-remove-confirm`).click();
  await expect(page.getByTestId(`${addedId}-reason-msg`)).toBeVisible();
  await expect(areaCards(page)).toHaveCount(exampleCount + 1);
  await page.getByTestId(`${addedId}-reason`).fill("Fictional: room is not used");
  await page.getByTestId(`${addedId}-remove-confirm`).click();
  await expect(areaCards(page)).toHaveCount(exampleCount);
  await page.getByTestId("areas-back").click();
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await page.getByTestId("iv-view-process").click();
  await expect(page.locator('button[data-node^="step:"]')).toHaveCount(before);
  await page.getByTestId("iv-view-areas").click();
  await hash(page, "#/changes");
  await expect(page.locator("table.change-table tbody tr", { hasText: "Fictional: room is not used" }).first()).toBeVisible();
});

test("removing the only area of a step puts the step back to Not placed", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/interview/areas?unit=ru&add=1");
  await expect(page.getByTestId("areas-page")).toBeVisible();
  for (const name of ["Room A (fictional)", "Room B (fictional)"]) {
    await page.getByTestId("areas-add-name").fill(name);
    await page.getByTestId("areas-add-button").click();
  }
  await expect(areaCards(page)).toHaveCount(2);
  const a = (await areaCards(page).first().getAttribute("data-testid"))!;
  await page.getByTestId(`${a}-steps`).locator("input[type=checkbox]").first().check();
  await page.getByTestId(`${a}-save`).click();
  await page.getByTestId(`${a}-remove`).click();
  await page.getByTestId(`${a}-reason`).fill("Fictional: room is not used");
  await page.getByTestId(`${a}-remove-confirm`).click();
  await expect(areaCards(page)).toHaveCount(1);
  await page.getByTestId("areas-back").click();
  await page.getByTestId("iv-view-areas").click();
  await expect(page.getByTestId("imap-unplaced")).toContainText("Not placed in an area yet");
  await expect(page.getByTestId("gap-map")).toContainText("Room B (fictional)");
});

test("the second start path: Start from an example layout in the empty state", async ({ page }) => {
  await newProject(page);
  await hash(page, "#/interview?view=areas");
  await page.getByTestId("imap-start-example").click();
  await expect(page.getByTestId("areas-example")).toBeVisible();
  await page.getByTestId("areas-use-example").click();
  await expect(areaCards(page).first()).toBeVisible();
});

test("keyboard only: a tile opens its run with Enter and Back to the map returns the focus", async ({ page }) => {
  await loadDemo(page);
  await hash(page, "#/interview?view=map");
  await node(page, CAPPING).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("run-note")).toBeVisible();
  await page.getByTestId("gap-back-to-map").focus();
  await page.keyboard.press("Enter");
  await expect(node(page, CAPPING)).toBeFocused();
});

test("blocked browser storage: the map and the editor still work", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await loadDemo(page);
  await hash(page, "#/interview?view=map");
  await expect(page.getByTestId("gap-map")).toBeVisible();
  await page.getByTestId("iv-view-areas").click();
  await expect(page.getByTestId("iv-unit-switch")).toBeVisible();
  await page.getByTestId("imap-edit-areas").click();
  await expect(page.getByTestId("areas-page")).toBeVisible();
});
