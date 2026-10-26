// Milestone 7.2: the process flow of a sampling plan. Process steps card, the SVG diagram (boxes, slots, markers, tray), moving a
// sample by mouse drag, by the points table and by keyboard, the "+" and "Add a sample" paths, the agency section last in both
// views, accessibility, 390 px, and light / dark screenshots. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoPlan(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("flow-diagram")).toBeVisible();
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

const boxLabels = (page: Page) => page.locator('[data-testid^="flow-box-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-step-label")));
const stepLabels = (page: Page) => page.getByTestId("step-list").locator("li strong").allTextContents();

/** Centre of an SVG element on the page. */
async function centre(l: Locator): Promise<{ x: number; y: number }> {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The id of a marker that sits in the tray (its row says Not on the diagram). */
async function trayMarkerId(page: Page): Promise<string> {
  const ids = await page.locator('[data-testid^="marker-SP-"]').evaluateAll((els) => els.filter((e) => e.getAttribute("data-place") === "Not on the diagram").map((e) => e.getAttribute("data-testid")!.replace("marker-", "")));
  expect(ids.length).toBeGreaterThan(0);
  return ids[0]!;
}

test("the diagram has exactly the plan's steps as boxes, in order, and follows reordering and a custom step", async ({ page }) => {
  await openDemoPlan(page);
  const steps = await stepLabels(page);
  expect(steps.length).toBeGreaterThanOrEqual(6);
  expect(await boxLabels(page)).toEqual(steps);

  await page.getByTestId("step-list").locator('[data-testid^="step-down-"]').first().click();
  const moved = await stepLabels(page);
  expect(moved).toEqual([steps[1], steps[0], ...steps.slice(2)]);
  expect(await boxLabels(page)).toEqual(moved);

  await page.getByTestId("step-custom-input").fill("Visual inspection hold (fictional)");
  await page.getByTestId("step-custom-add").click();
  expect((await boxLabels(page)).at(-1)).toBe("Visual inspection hold (fictional)");
  expect(await boxLabels(page)).toEqual(await stepLabels(page));
});

test("removing a step that holds samples asks, then moves them to Not on the diagram", async ({ page }) => {
  await openDemoPlan(page);
  // The step of the first marker that sits on a step.
  const marker = page.locator('[data-testid^="marker-SP-"]:not([data-place="Not on the diagram"])').first();
  const id = (await marker.getAttribute("data-testid"))!.replace("marker-", "");
  const stepId = await page.getByTestId(`row-step-${id}`).inputValue();
  await page.getByTestId(`step-remove-${stepId}`).click();
  await expect(page.getByTestId("step-remove-confirm")).toContainText("moves them to Not on the diagram");
  await page.getByTestId("step-remove-cancel").click();
  await expect(page.getByTestId(`step-${stepId}`)).toBeVisible();
  await page.getByTestId(`step-remove-${stepId}`).click();
  await page.getByTestId("step-remove-move").click();
  await expect(page.getByTestId(`step-${stepId}`)).toHaveCount(0);
  await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", "Not on the diagram");
  await expect(page.getByTestId(`row-step-${id}`)).toHaveValue("");
});

test("dragging a marker with the mouse moves the sample and the table row", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openDemoPlan(page);
  const id = await trayMarkerId(page);
  const target = page.locator('[data-drop$=":after"]').first();
  const dropKey = (await target.getAttribute("data-drop"))!;
  const stepId = dropKey.split(":")[0]!;
  const from = await centre(page.getByTestId(`marker-${id}`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await centre(target.locator("rect").first());
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // While dragging, the drop places are outlined and say so in words.
  await expect(page.getByTestId("flow-ghost")).toBeVisible();
  await expect(page.locator(".flow-slot.droppable").first()).toBeVisible();
  await expect(page.getByTestId("flow-diagram")).toContainText("drop here");
  await page.screenshot({ path: join(SHOTS, "m72-dragging.png") });
  await page.mouse.up();
  await expect(page.getByTestId(`row-step-${id}`)).toHaveValue(stepId);
  await expect(page.getByTestId(`row-pos-${id}`)).toHaveValue("after");
  await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", /after the step/);

  // Dropping on the tray takes the flow off again.
  const tray = page.getByTestId("slot-tray").locator("rect").first();
  const f2 = await centre(page.getByTestId(`marker-${id}`));
  await page.mouse.move(f2.x, f2.y);
  await page.mouse.down();
  const t2 = await centre(tray);
  await page.mouse.move(t2.x, t2.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId(`row-step-${id}`)).toHaveValue("");
  await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", "Not on the diagram");
});

test("changing the Step or Position in the table moves the marker at once; selection is shared", async ({ page }) => {
  await openDemoPlan(page);
  const id = await trayMarkerId(page);
  const second = (await page.getByTestId("step-list").locator("li").nth(1).getAttribute("data-testid"))!.replace("step-", "");
  const label = (await page.getByTestId(`step-${second}`).locator("strong").textContent())!;
  await page.getByTestId(`row-step-${id}`).selectOption(second);
  await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", `${label}, position not set`);
  await page.getByTestId(`row-pos-${id}`).selectOption("before");
  await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", `${label}, before the step`);
  // Selecting in the diagram marks the row, and the other way round.
  await page.getByTestId(`marker-${id}`).click();
  await expect(page.getByTestId(`point-${id}`)).toHaveAttribute("aria-current", "true");
  const other = (await page.locator('[data-testid^="marker-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("marker-", "")))).find((x) => x !== id)!;
  await page.getByTestId(`point-${other}`).locator("th").click();
  await expect(page.getByTestId(`marker-${other}`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId(`marker-${id}`)).not.toHaveAttribute("aria-current", "true");
});

test("the keyboard moves a marker: Enter picks up, arrows choose, Enter drops, Escape cancels", async ({ page }) => {
  await openDemoPlan(page);
  const id = await trayMarkerId(page);
  const marker = page.getByTestId(`marker-${id}`);
  const live = page.getByTestId("flow-live");
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(live).toContainText(`Picked up ${id}`);
  await page.keyboard.press("ArrowRight"); // from the tray around to the first place
  await expect(live).toHaveText(/, before$/);
  const said = (await live.textContent())!;
  await page.keyboard.press("Enter");
  await expect(live).toContainText(`Dropped ${id}`);
  const place = said.trim();
  await expect(marker).toHaveAttribute("data-place", place.replace(/, before$/, ", before the step"));
  await expect(page.getByTestId(`row-pos-${id}`)).toHaveValue("before");
  // Focus stays on the marker, and Escape cancels a move.
  await expect(marker).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(live).toContainText("cancelled");
  await expect(page.getByTestId(`row-pos-${id}`)).toHaveValue("before");
});

test("the plus on a box and Add a sample use the one add dialog", async ({ page }) => {
  await openDemoPlan(page);
  const firstStep = (await page.getByTestId("step-list").locator("li").first().getAttribute("data-testid"))!.replace("step-", "");
  const ids = () => page.locator('[data-testid^="point-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("point-", "")));
  const idsBefore = await ids();
  const before = idsBefore.length;
  await page.getByTestId(`flow-add-${firstStep}`).click();
  await expect(page.getByTestId("add-step")).toHaveValue(firstStep);
  await page.getByTestId("add-type").selectOption("ipc");
  await page.getByTestId("add-what").fill("Plus-button check (fictional)");
  await page.getByTestId("add-submit").click();
  await expect(page.locator('[data-testid^="point-SP-"]')).toHaveCount(before + 1);
  await expect(page.locator('[data-testid^="marker-SP-"]')).toHaveCount(before + 1);
  // The new point sits on the box with its position not set (nothing is filled in for the person).
  const newId = (await ids()).find((i) => !idsBefore.includes(i))!;
  const newRow = page.getByTestId(`point-${newId}`);
  await expect(newRow.locator("select").first()).toHaveValue(firstStep);
  await expect(newRow.locator("select").nth(1)).toHaveValue("unset");

  // "Add a sample" goes to Not on the diagram: extras are never blocked and never forced onto a step.
  await page.getByTestId("add-sample").click();
  await expect(page.getByTestId("add-step")).toHaveValue("");
  await page.getByTestId("add-type").selectOption("other");
  await page.getByTestId("add-what").fill("Extra sample (fictional)");
  await page.getByTestId("add-submit").click();
  await page.getByTestId("tab-overview").click();
  const extraId = (await ids()).find((i) => !idsBefore.includes(i) && i !== newId)!;
  const extra = page.getByTestId(`point-${extraId}`);
  await expect(extra.locator("select").first()).toHaveValue("");
});

test("a new plan copies the project scope's steps once, and the two lists stay independent", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByRole("link", { name: "All sampling plans" }).click();
  await page.getByTestId("plan-title-input").fill("Second plan (fictional)");
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("steps-card")).toBeVisible();
  const copied = await stepLabels(page);
  expect(copied.length).toBeGreaterThan(0);
  expect(await boxLabels(page)).toEqual(copied);
  // Removing a step from the plan does not touch the project scope.
  await page.getByTestId("step-list").locator('[data-testid^="step-remove-"]').first().click();
  expect((await stepLabels(page)).length).toBe(copied.length - 1);
  // Copy again (append) restores the missing one.
  await page.getByTestId("steps-copy-mode").selectOption("append");
  await page.getByTestId("steps-copy").click();
  expect((await stepLabels(page)).sort()).toEqual([...copied].sort());
});

test("an empty plan points to the Process steps card", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByRole("link", { name: "All sampling plans" }).click();
  await page.getByTestId("plan-title-input").fill("Empty plan (fictional)");
  await page.getByTestId("plan-create").click();
  while ((await page.getByTestId("step-list").count()) > 0) await page.getByTestId("step-list").locator('[data-testid^="step-remove-"]').first().click();
  await expect(page.getByTestId("flow-empty")).toContainText("Process steps");
  await expect(page.getByTestId("points-empty")).toBeVisible();
});

test("the agency section comes last in both interview views", async ({ page }) => {
  await openDemoPlan(page);
  await page.getByTestId("tab-interview").click();
  for (const view of ["step", "type"]) {
    await page.getByTestId(`view-${view}`).click();
    const heads = await page.locator("main h2").allTextContents();
    expect(heads.at(-1), `${view} view: ${heads.join(" | ")}`).toMatch(/agency/i);
  }
});

test("the plan page is accessible, has no sideways scroll at 390 px, and looks right in light and dark", async ({ page }) => {
  // Several axe scans of a long plan page: about 14 s alone, past 30 s when the whole suite runs in parallel.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await openDemoPlan(page);
  await expectAccessible(page, "plan page 1366");
  await page.getByTestId("steps-card").screenshot({ path: join(SHOTS, "m72-steps-card.png") });
  await page.getByTestId("flow-card").screenshot({ path: join(SHOTS, "m72-diagram-1366.png") });
  await page.getByTestId("points-table").screenshot({ path: join(SHOTS, "m72-table.png") });

  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "plan page dark");
  await page.getByTestId("flow-card").screenshot({ path: join(SHOTS, "m72-diagram-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page, "plan page 390");
  await expectAccessible(page, "plan page 390");
  await page.getByTestId("flow-card").screenshot({ path: join(SHOTS, "m72-diagram-390.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoHorizontalScroll(page, "plan page 1280");
});
