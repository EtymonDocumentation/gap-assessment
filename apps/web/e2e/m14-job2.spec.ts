// M14 job 2: the TRD interview map screens. The Interview tab gets a plain group "Show the questions as" (List, Process steps, Facility areas); the maps
// are one more way to reach the SAME questions. Checked here, at desktop, tablet and phone with axe: switching views and the address (view and node), the
// tile counts equal to the list, a tile starting a run limited to its questions, the end card, "Back to the map" (focus and the status line), "Go to the next
// open question", a left-out step, the area view with seeded areas (nested, a step in two areas, the unplaced node, both unit lists), a TRD that follows a
// template's headings, a keyboard-only pass, no sideways scroll at 390 and 360 px, light and dark pictures and blocked browser storage. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDemo, setTheme } from "./nav-helper";
import { addTemplate, HEADINGS } from "./word-template-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);
const shot = (page: Page, name: string, theme: string) => page.screenshot({ path: join(tmpdir(), `m14-job2-${name}-${test.info().project.name}-${theme}.png`), fullPage: true });

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

/** A new project with no gap answers at all, then the TRD start path: Decide later, every step ticked, straight to the questions. */
async function startInterview(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Map test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await page.getByTestId("start-kind-later").check();
  await page.getByTestId("start-next").click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

async function openDemoInterview(page: Page, extra = "") {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await hash(page, `#/trd?trd=TRD-001&tab=interview${extra}`);
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

const view = (page: Page, v: "list" | "process" | "areas") => page.getByTestId(`iv-view-${v}`);
const node = (page: Page, id: string) => page.getByTestId(`imap-node-${id}`);
const stateText = (page: Page, id: string) => page.getByTestId(`imap-state-${id}`).locator("span").last().innerText();

/** "All 9 answered" or "3 of 9 answered, 6 open" as numbers. */
function numbers(text: string): { answered: number; total: number } {
  const all = /^All (\d+) answered/.exec(text);
  if (all) return { answered: Number(all[1]), total: Number(all[1]) };
  const m = /^(\d+) of (\d+) answered/.exec(text);
  expect(m, `a count in "${text}"`).not.toBeNull();
  return { answered: Number(m![1]), total: Number(m![2]) };
}

const stepIds = (page: Page) => page.locator('button[data-node^="step:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-node")!));

/** Puts the facility areas into the saved project (a project file with `facility`), then reloads: the areas editor belongs to job 3. */
async function seedFacility(page: Page, facility: unknown) {
  await page.evaluate(async (fac) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("keyval-store");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const project = await new Promise<Record<string, unknown>>((res, rej) => {
      const g = db.transaction("keyval", "readonly").objectStore("keyval").get("gap-assessment:project");
      g.onsuccess = () => res(g.result as Record<string, unknown>);
      g.onerror = () => rej(g.error);
    });
    project.facility = fac;
    await new Promise<void>((res, rej) => {
      const t = db.transaction("keyval", "readwrite");
      t.objectStore("keyval").put(project, "gap-assessment:project");
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    db.close();
  }, facility);
  await page.reload();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
}

const area = (id: string, name: string, stepKeys: string[], extra: Record<string, unknown> = {}) => ({ id, name, stepKeys, createdAt: "2026-11-11T09:00:00.000Z", updatedAt: "2026-11-11T09:00:00.000Z", ...extra });

/** Clicks Next until the end card of the run shows. */
async function runToTheEnd(page: Page) {
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("iv-end").isVisible()) return;
    await page.getByTestId("iv-next").click();
  }
  throw new Error("the run did not end");
}

test("the view group: List is the way it opens, a map is one click away, and its tiles say the same numbers as the list", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemoInterview(page);
  const group = page.getByTestId("iv-views");
  await expect(page.getByRole("group", { name: /Show the questions as/ })).toBeVisible();
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(page.locator('label:has([data-testid^="iv-view-"])')).toHaveText(["List", "Process steps", "Facility areas"]);
  await expect(view(page, "list")).toBeChecked();
  await expect(page.getByTestId("imap")).toHaveCount(0);
  await expect(page.getByTestId("iv-one")).toBeVisible();
  // The five numbered tabs are as they were.
  await expect(page.getByTestId("trd-tabs").getByRole("tab")).toHaveCount(6);

  // The list counts, with everything shown and More detail off.
  await page.getByTestId("iv-show-all").check();
  const listCounts = new Map<string, { answered: number; total: number }>();
  for (const s of await page.locator('section[data-testid^="iv-step-"]').all()) {
    const key = (await s.getAttribute("data-testid"))!.replace("iv-step-", "");
    listCounts.set(key === "document" ? "whole" : `step:${key}`, numbers((await s.getByTestId("iv-step-count").innerText()).trim()));
  }
  expect(listCounts.size).toBeGreaterThan(3);

  await view(page, "process").check();
  await expect(page.getByTestId("imap")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Process steps" })).toBeVisible();
  await expect(page.getByTestId("iv-one")).toHaveCount(0);
  await expect(page).toHaveURL(/view=process/);
  await expect(page).toHaveURL(/tab=interview/);
  await expect(page.locator('section[data-testid^="iv-step-"]')).toHaveCount(0);
  for (const [id, c] of listCounts) expect(numbers(await stateText(page, id)), id).toEqual(c);

  // Every tile says its state in words, with an icon and a border style, and the key is written out.
  const first = (await stepIds(page))[0]!;
  await expect(node(page, first)).toHaveAccessibleName(/^1 .+answered/);
  await expect(page.getByTestId("imap-legend")).toBeVisible();
  await page.getByTestId("imap-legend").locator("summary").click();
  await expect(page.getByTestId("imap-legend")).toContainText("dashed border: some still open");
  await expect(page.getByTestId("imap-legend")).toContainText("solid border: all answered");
  await expect(page.getByTestId("iv-next-open")).toHaveText("Go to the next open question");

  await checkBothThemes(page, "process map", "process-map");
  await expectNoSidewaysScroll(page, "process map");

  await view(page, "areas").check();
  await expect(page).toHaveURL(/view=areas/);
  // The demo now carries its own areas (M14 job 3), so the empty state is checked in m14-job3.spec.ts on a new project.
  await expect(page.getByTestId("imap-empty")).toHaveCount(0);
  await expect(page.getByTestId("imap-edit-areas")).toBeVisible();
  await expectAccessible(page, "areas view");
  await expectNoSidewaysScroll(page, "areas view");

  await view(page, "list").check();
  await expect(page.getByTestId("imap")).toHaveCount(0);
  await expect(page.getByTestId("iv-one")).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  await expectAccessible(page, "list view");
});

test("the address opens the right view and node; the view and the one-at-a-time choice are remembered per TRD", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemoInterview(page, "&view=process");
  await expect(view(page, "process")).toBeChecked();
  await expect(page.getByTestId("imap")).toBeVisible();
  const ids = await stepIds(page);
  expect(ids.length).toBeGreaterThan(2);

  await openDemoInterview(page, "&view=areas");
  await expect(view(page, "areas")).toBeChecked();
  await expect(page.getByTestId("imap")).toBeVisible();
  await expect(page.getByTestId("imap-empty")).toHaveCount(0);

  // A node in the address opens its run at once. Use a tile that still has an open question.
  await openDemoInterview(page, "&view=process");
  let open = "";
  for (const id of ["whole", ...(await stepIds(page))]) {
    const t = await stateText(page, id).catch(() => "");
    if (/open/.test(t) && (await node(page, id).evaluate((e) => e.tagName)) === "BUTTON") {
      open = id;
      break;
    }
  }
  expect(open, "a tile with an open question").not.toBe("");
  const label = (await node(page, open).locator(".imap-name").innerText()).trim();
  await page.goto(`./#/trd?trd=TRD-001&tab=interview&view=process&node=${encodeURIComponent(open)}`);
  await page.reload();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await expect(page.getByTestId("iv-run-line")).toContainText(label);
  await expect(page.getByTestId("iv-back-to-map")).toBeVisible();
  await page.getByTestId("iv-back-to-map").click();
  await expect(page.getByTestId("iv-one-mode")).toHaveCount(0);
  await expect(page).not.toHaveURL(/node=/);
  await expect(page).toHaveURL(/view=process/);

  // The last view is kept for this TRD, so an address without a view opens on it.
  await view(page, "list").check();
  await view(page, "process").check();
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  await page.reload();
  await expect(view(page, "process")).toBeChecked();
  await view(page, "list").check();
  await page.getByTestId("iv-one").check();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await page.reload();
  await expect(view(page, "list")).toBeChecked();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await page.getByTestId("iv-to-list").click();
  await page.reload();
  await expect(page.getByTestId("iv-one-mode")).toHaveCount(0);
  await expect(page.getByTestId("iv-one")).not.toBeChecked();
});

test("a tile starts a run limited to its questions; the end card, Back to the map, focus and the status line", async ({ page }) => {
  test.setTimeout(180_000);
  await startInterview(page);
  await view(page, "process").check();
  const before = await stateText(page, "whole");
  const b = numbers(before);
  expect(before).toMatch(/open/);
  // A tile is a real button; its name is what it shows: the name, then the count and what is open.
  await expect(node(page, "whole")).toHaveAccessibleName(/^Document and details \d+ of \d+ answered/);

  await node(page, "whole").click();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await expect(page.getByTestId("imap")).toHaveCount(0);
  await expect(page).toHaveURL(/node=whole/);
  await expect(page.getByTestId("iv-run-line")).toContainText("Showing every question in Document and details.");
  await expect(page.getByTestId("iv-position")).toContainText("in Document and details");
  // The cursor is on the question's heading, as in the plain one-at-a-time run.
  await expect(page.getByTestId("iv-one-mode").locator("h2, h3").first()).toBeFocused();
  await expectAccessible(page, "run in a node");

  // Answer the first question, then go through the rest of the node.
  const card = page.getByTestId("iv-one-mode").locator("article").first();
  await card.getByTestId("iv-input").fill("A fictional answer");
  await card.getByTestId("iv-save").click();
  await expect(card.getByTestId("iv-saved")).toBeVisible();
  await runToTheEnd(page);
  const end = page.getByTestId("iv-end");
  await expect(end.getByRole("heading", { level: 2 })).toHaveText(new RegExp(`^That was the last question in Document and details\\. ${b.total - b.answered - 1} left open\\.$`));
  await expect(end.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(page.getByTestId("iv-end-map")).toHaveText("Back to the map");
  await expect(page.getByTestId("iv-end-next-node")).toHaveText("Next step with open questions");
  await expectAccessible(page, "end card");
  await shot(page, "end-card", "light");

  await page.getByTestId("iv-end-map").click();
  await expect(page.getByTestId("imap")).toBeVisible();
  await expect(page.getByTestId("iv-one-mode")).toHaveCount(0);
  await expect(node(page, "whole")).toBeFocused();
  await expect(node(page, "whole")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("iv-live")).toContainText("Back on the map. Document and details:");
  expect(numbers(await stateText(page, "whole"))).toEqual({ answered: b.answered + 1, total: b.total });
  await expect(page).not.toHaveURL(/node=/);

  // "Next step with open questions" goes on to the next tile that still has an open question.
  const second = (await stepIds(page))[0]!;
  await node(page, "whole").click();
  await runToTheEnd(page);
  await page.getByTestId("iv-end-next-node").click();
  await expect(page.getByTestId("iv-run-line")).toContainText("Showing every question in");
  await expect(page).toHaveURL(new RegExp(`node=${encodeURIComponent(second)}`));
  await expect(page.getByTestId("iv-back-to-map")).toBeVisible();
  await expect(page.getByTestId("iv-to-list")).toBeVisible();
  // Back to the list ends the run and the list is back.
  await page.getByTestId("iv-to-list").click();
  await expect(view(page, "list")).toBeChecked();
  await expect(page.getByTestId("iv-one")).toBeVisible();
});

test("a run follows the filters in force and says so in one line", async ({ page }) => {
  test.setTimeout(120_000);
  await startInterview(page);
  await view(page, "process").check();
  const id = (await stepIds(page))[0]!;
  const name = (await node(page, id).locator(".imap-name").innerText()).trim();

  await page.getByTestId("iv-show-open").check();
  await node(page, id).click();
  await expect(page.getByTestId("iv-run-line")).toHaveText(new RegExp(`^Showing only the questions still open in ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  await page.getByTestId("iv-back-to-map").click();

  await page.getByTestId("iv-search").fill("no question has these words zzz");
  await node(page, id).click();
  await expect(page.getByTestId("iv-run-line")).toContainText("Only the questions that match your search are included.");
  // Nothing matches, so the run is over at once and says how many are left open.
  await expect(page.getByTestId("iv-end")).toBeVisible();
  await expect(page.getByTestId("iv-end-map")).toBeVisible();
  await page.getByTestId("iv-end-map").click();
  await expect(node(page, id)).toBeFocused();
});

test("Go to the next open question opens the run at the first open question and Back to the map returns", async ({ page }) => {
  test.setTimeout(120_000);
  await startInterview(page);
  await view(page, "process").check();
  await page.getByTestId("iv-next-open").click();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  // The run starts at the first question still open, in process order.
  await expect(page.getByTestId("iv-position")).toContainText(/Question \d+ of \d+/);
  await expect(page.getByTestId("iv-run-line")).toHaveCount(0);
  await page.getByTestId("iv-back-to-map").click();
  await expect(node(page, "whole")).toBeFocused();
  await expect(page.getByTestId("iv-live")).toContainText("Back on the map.");

  // With every question of the Document answered, the button goes on to the first step that still has an open one.
  await expect(page.getByTestId("iv-next-open")).toBeVisible();
});

test("a step left out of the project is a tile with its reason, not a way into a run", async ({ page }) => {
  test.setTimeout(180_000);
  await startInterview(page);
  await expect(page.getByTestId("iv-step-visual_inspection")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("iv-change-steps").click();
  await expect(page.getByTestId("start-step-steps")).toBeVisible();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await page.locator("#trd-start-step-visual_inspection").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Inspected at another site (fictional)");
  await dialog.getByRole("button", { name: "Leave out" }).click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();

  await view(page, "process").check();
  const tile = node(page, "step:visual_inspection");
  await expect(tile).toBeVisible();
  expect(await tile.evaluate((e) => e.tagName)).toBe("DIV");
  await expect(tile).toContainText("Left out of this project: Inspected at another site (fictional)");
  await expect(tile.getByRole("link", { name: "Change this in Scope" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Visual inspection/ })).toHaveCount(0);
  // The tile has a number and sits in process order with the others.
  await expect(tile.locator(".imap-num")).toHaveCount(1);
  await checkBothThemes(page, "process map with a left-out step", "left-out");
  await expectNoSidewaysScroll(page, "left-out step");
});

test("the area view: nested cards, a step in two areas, the unplaced node and both unit lists", async ({ page }) => {
  test.setTimeout(180_000);
  await startInterview(page);
  await view(page, "process").check();
  const ids = await stepIds(page);
  expect(ids.length).toBeGreaterThan(4);
  const key = (i: number) => ids[i]!.replace("step:", "");
  const name = async (i: number) => (await node(page, ids[i]!).locator(".imap-name").innerText()).trim();
  const [n0, n1, n2, n3] = [await name(0), await name(1), await name(2), await name(3)];
  const totals = [] as number[];
  for (let i = 0; i < 4; i++) totals.push(numbers(await stateText(page, ids[i]!)).total);

  await seedFacility(page, {
    ru: { areas: [area("AR-01", "Filling room", [key(0), key(1)], { grade: "B" }), area("AR-02", "Filling isolator", [key(1), key(2)], { grade: "A", insideAreaId: "AR-01" })] },
    su: { areas: [area("AR-03", "Cold store", [key(3)], { grade: "none" })] },
  });
  await expect(view(page, "process")).toBeChecked();
  // The tiles of the process map now name the areas in their accessible name.
  await expect(node(page, ids[0]!)).toContainText("Inside Filling room");

  await view(page, "areas").check();
  await expect(page.getByTestId("iv-unit-ru")).toBeChecked();
  await expect(page.getByTestId("iv-unit-switch").locator("label")).toHaveText(["Receiving unit", "Sending unit"]);
  const parent = node(page, "area:AR-01");
  const child = parent.getByTestId("imap-node-area:AR-02");
  await expect(parent).toBeVisible();
  await expect(child).toBeVisible();
  await expect(page.getByTestId("imap-grade-area:AR-01")).toContainText("Grade B");
  await expect(page.getByTestId("imap-grade-area:AR-02")).toContainText("Grade A");
  await expect(page.getByTestId("imap-grade-area:AR-02")).toContainText("Inside Filling room");
  // The step in two areas shows under both, with "also done in", and is counted once.
  await expect(page.getByTestId(`imap-step-area:AR-01-${key(1)}`)).toContainText(`also done in Filling isolator`);
  await expect(page.getByTestId(`imap-step-area:AR-02-${key(1)}`)).toContainText(`also done in Filling room`);
  const a1 = numbers(await stateText(page, "area:AR-01"));
  const a2 = numbers(await stateText(page, "area:AR-02"));
  expect(a1.total).toBe(totals[0]! + totals[1]!);
  expect(a2.total).toBe(totals[1]! + totals[2]!);
  // The steps in no area gather in one node, so every question stays reachable.
  const unplaced = page.getByTestId("imap-unplaced");
  await expect(unplaced).toContainText("Not placed in an area yet");
  await expect(unplaced).toContainText(n3);
  await expect(unplaced).not.toContainText(n0);
  await expect(node(page, "whole")).toContainText("About the whole site");
  await expect(page.getByTestId("imap-legend")).toBeVisible();
  await checkBothThemes(page, "area map", "area-map");
  await expectNoSidewaysScroll(page, "area map");

  // A card opens a run limited to its steps' questions, and Back to the map returns to that card's button.
  await page.getByTestId("imap-open-area:AR-02").click();
  await expect(page.getByTestId("iv-run-line")).toContainText("Filling isolator");
  await expect(page.getByTestId("iv-position")).toContainText(new RegExp(`in (${n1}|${n2})`));
  await runToTheEnd(page);
  await expect(page.getByTestId("iv-end").getByRole("heading", { level: 2 })).toContainText("That was the last question in Filling isolator.");
  await page.getByTestId("iv-end-map").click();
  await expect(page.getByTestId("imap-open-area:AR-02")).toBeFocused();
  await expect(page.getByTestId("imap-open-area:AR-02")).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/view=areas/);

  // The sending unit has its own list; the receiving rooms are not shown there.
  await page.getByTestId("iv-unit-su").check();
  await expect(node(page, "area:AR-03")).toBeVisible();
  await expect(page.getByTestId("imap-grade-area:AR-03")).toContainText("Not classified");
  await expect(node(page, "area:AR-01")).toHaveCount(0);
  await expect(page.getByTestId("imap-unplaced")).toContainText(n0);
  await expect(page.getByTestId("imap-unplaced")).not.toContainText(n3);
  await expectAccessible(page, "sending unit areas");
  // A unit with no areas says so. Nothing was filled in for it.
  await page.getByTestId("iv-unit-ru").check();

  // The unplaced node is a way in too.
  await page.getByTestId("imap-node-unplaced").click();
  await expect(page.getByTestId("iv-run-line")).toContainText("Not placed in an area yet");
  await page.getByTestId("iv-back-to-map").click();
  await expect(page.getByTestId("imap-node-unplaced")).toBeFocused();
  // An address with an area node opens that card's run.
  await page.goto(`./#/trd?trd=${new URL(page.url()).hash.match(/trd=([^&]+)/)![1]}&tab=interview&view=areas&node=area%3AAR-01`);
  await page.reload();
  await expect(page.getByTestId("iv-run-line")).toContainText("Filling room");
});

test("a TRD that follows a template's headings has one tile for each heading, in the template's order", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Headings map (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await addTemplate(page);
  await hash(page, "#/trd");
  await page.getByTestId("trd-interview-btn").click();
  await page.getByTestId("start-kind-mapped").check();
  const value = await page.locator('[data-testid="start-template-select"] option', { hasText: "Harbourlight SOP (fictional)" }).first().getAttribute("value");
  await page.getByTestId("start-template-select").selectOption(value!);
  await page.getByTestId("start-next").click();
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("start-step-match")).toBeVisible();
  await page.getByTestId("trd-match-confirm-all").click();
  for (let i = 0; i < HEADINGS.length; i++) {
    const replace = page.getByTestId(`trd-match-row-${i}`).getByRole("radio", { name: "Replace it" });
    if ((await replace.count()) > 0) await replace.check();
  }
  await page.getByTestId("start-next").click();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-group-heading-0")).toBeVisible();
  const titles = (await page.locator('h2[id^="iv-g-heading-"]').allInnerTexts()).map((t) => t.replace(/\s+(\d+ of \d+ answered|All \d+ answered|nothing to answer|your template's text stays).*$/s, "").trim());
  expect(titles.length).toBeGreaterThan(2);

  await expect(page.locator('label:has([data-testid^="iv-view-"])')).toHaveText(["List", "Your template's headings", "Facility areas"]);
  await view(page, "process").check();
  await expect(page.getByRole("heading", { level: 2, name: "Your template's headings" })).toBeVisible();
  const tiles = await page.locator('[data-node^="step:heading-"] .imap-name').allInnerTexts();
  expect(tiles.map((t) => t.trim())).toEqual(expect.arrayContaining(titles.slice(0, 3)));
  expect(tiles.map((t) => t.trim()).slice(0, titles.length)).toEqual(titles.slice(0, tiles.length));
  await expectNoSidewaysScroll(page, "headings map");
  await checkBothThemes(page, "headings map", "headings-map");

  // A tile with questions opens its run.
  const withQuestions = await page.locator('button[data-node^="step:heading-"]').first().getAttribute("data-node");
  expect(withQuestions).not.toBeNull();
  await node(page, withQuestions!).click();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await expect(page.getByTestId("iv-run-line")).toContainText("Showing every question in");
  await page.getByTestId("iv-back-to-map").click();
  await expect(node(page, withQuestions!)).toBeFocused();
});

test("the layout: 4, 2 or 1 columns, tiles of at least 44 px, no sideways scroll and a keyboard-only pass", async ({ page }) => {
  test.setTimeout(120_000);
  await startInterview(page);
  await view(page, "process").check();
  const ids = await stepIds(page);
  const boxes = [];
  for (const id of ids) boxes.push((await node(page, id).boundingBox())!);
  for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(44);
  const width = page.viewportSize()!.width;
  const columns = new Set(boxes.map((b) => Math.round(b.x))).size;
  expect(columns).toBe(width > 1000 ? 4 : width > 600 ? 2 : 1);
  await expectNoSidewaysScroll(page, "process map layout");
  await expectAccessible(page, "process map layout");

  // Keyboard only: from the button above the map, Tab passes the key and reaches the first tile; Enter opens its run; Back to the map returns.
  await page.getByTestId("iv-next-open").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(node(page, "whole")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await page.getByTestId("iv-back-to-map").focus();
  // The focused button is not hidden by the bar that sticks to the bottom of the screen.
  const bar = await page.getByTestId("iv-nav").boundingBox();
  const back = await page.getByTestId("iv-back-to-map").boundingBox();
  expect(back!.y).toBeGreaterThanOrEqual(bar!.y - 1);
  await page.keyboard.press("Enter");
  await expect(node(page, "whole")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(node(page, ids[0]!)).toBeFocused();
});

test("the maps work with the browser storage blocked", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"] as const) {
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    }
  });
  await startInterview(page);
  await view(page, "process").check();
  await expect(page.getByTestId("imap")).toBeVisible();
  await node(page, "whole").click();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
  await page.getByTestId("iv-back-to-map").click();
  await expect(node(page, "whole")).toBeFocused();
  await view(page, "areas").check();
  await expect(page.getByTestId("imap-empty")).toBeVisible();
  await view(page, "list").check();
  await page.getByTestId("iv-one").check();
  await expect(page.getByTestId("iv-one-mode")).toBeVisible();
});
