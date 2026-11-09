// First-time-user fixes (Tester D walkthrough, fix job D1) that no other spec covers: what each Gap register chip means and what the row count
// counts (rows 12, 13), the empty "Save and continue" (row 11), "Saved as TBD" on a paired question (row 24), the spelled-out abbreviations
// (row 19), the TRD start button (row 3), the Library hint lines and the Builder and Sources intros (rows 9, 32), the phone Menu panel
// (row 31), and in the browser-only copy Rename, Import and the About and privacy page (rows 17, 18, audit 7). All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isPhone, openAbout, openDemo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("./");
});

async function axeClean(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`).join("\n"), `${label} (${scheme})`).toBe("");
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const go = (page: Page, hash: string) => page.evaluate((h) => (window.location.hash = h), hash);

test("Gap register: each category chip says what it means, and the count says how many rows the table shows and how many it hides", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();

  // Eight chips, eight meanings, each beside its own chip (a list item holds both).
  const chips = page.getByRole("list", { name: "Count by category" }).getByRole("listitem");
  await expect(chips).toHaveCount(8);
  for (let i = 0; i < 8; i++) expect((await chips.nth(i).locator(".cat-meaning").innerText()).trim().length, `chip ${i} has a meaning`).toBeGreaterThan(10);
  await expect(chips.filter({ hasText: "Equivalent" }).first()).toContainText("SU and RU are the same.");
  await expect(chips.filter({ hasText: "Information required" })).toContainText("The SU or RU value is TBD (to be decided).");

  // The chips count every gap; the line says how many the table shows and how many the unticked "Show equivalent" hides.
  const count = page.getByTestId("register-count");
  const shown = /^Showing (\d+) rows \((\d+) equivalent hidden\)\. Tick Show equivalent to include them\.$/;
  await expect(count).toHaveText(shown);
  const [, rows, hidden] = shown.exec((await count.innerText()).trim())!.map(Number) as [number, number, number];
  expect(hidden, "the demo has equivalent rows that are hidden").toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: `Export CSV (${rows} rows)` })).toBeVisible();
  await page.getByLabel("Show equivalent").check();
  await expect(count).toHaveText(`Showing ${rows + hidden} rows.`);
  await expect(page.getByRole("button", { name: `Export CSV (${rows + hidden} rows)` })).toBeVisible();
  await page.getByLabel("Show equivalent").uncheck();
  await expect(count).toHaveText(shown);
  await axeClean(page, "gap register");
});

test("Save and continue with nothing chosen says so beside the button instead of doing nothing", async ({ page }) => {
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Empty save check (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose an answer first" })).toHaveText("Choose an answer first, or choose TBD if it is not known yet.");
  // Nothing was saved and the person is still on the same question.
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
  await axeClean(page, "interview with the empty-save message");
});

test("TBD on one side of a pair says 'Saved as TBD' on that side at once, and the card stays on the question", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "arx", "#/interview?q=fill.pump%40source");
  await expect(page.locator("#q-prompt")).toHaveText("Filling pump operating principle");
  const side = (s: "source" | "target") => page.locator(`fieldset.side-panel[data-side="${s}"]`);
  // The demo answers both sides, and a card whose two sides are both settled moves on to the next question, which would hide the tag.
  // Clearing the SU answer (a confirmed action) puts the card where a newcomer meets it: the SU side not answered yet, TBD pressed for RU.
  await side("source").getByRole("button", { name: "Clear SU answer" }).click();
  await page.getByRole("dialog", { name: "Clear SU answer?" }).getByRole("button", { name: /^Clear \d+ entr(y|ies)$/ }).click();
  await expect(side("source").locator(".side-answered")).toHaveCount(0);
  await side("target").getByRole("button", { name: "TBD (to be decided)" }).click();
  // Before the fix only the Save button changed and nothing said the TBD had been saved (Tester D row 24).
  await expect(side("target").locator(".side-answered")).toHaveText("Saved as TBD");
  await expect(side("source").locator(".side-answered")).toHaveCount(0);
  await expect(page.locator("#q-prompt")).toHaveText("Filling pump operating principle");
  await axeClean(page, "interview with a saved-as-TBD tag");
});

test("abbreviations are spelled out where a page first uses them", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "arx");
  const text = async (hash: string) => {
    await go(page, hash);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    // textContent, so the line counts whether or not the page's explanation panel is open.
    return (await page.locator("main").textContent()) ?? "";
  };
  expect(await text("#/sampling")).toContain("PPQ (process performance qualification)");
  expect(await text("#/trd")).toContain("TRD (technical requirements document)");
  // NOR and PAR are first used in the page's explanation panel, which is closed until it is opened.
  const panel = await openAbout(page);
  await expect(panel).toContainText("NOR (normal operating range)");
  await expect(panel).toContainText("PAR (proven acceptable range)");
  expect(await text("#/mbr")).toContain("CMO (contract manufacturing organization)");
  // The same words are used in the page headings' purpose lines, which are always visible.
  await go(page, "#/mbr");
  await expect(page.getByTestId("page-purpose")).toContainText("CMO (contract manufacturing organization)");
});

test("the TRD page's start button only goes to the New TRD form and says so", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "arx");
  await go(page, "#/trd");
  const section = page.getByTestId("trd-from-project");
  await expect(section).toContainText("does not create anything");
  const trds = page.locator('[data-testid="trd-list-table"] tbody tr');
  const before = await trds.count();
  const button = page.getByTestId("trd-from-project-btn");
  await expect(button).toHaveText("Go to the New TRD form");
  await button.click();
  await expect(page.getByTestId("trd-title-input")).toBeFocused();
  // Nothing was created by the click.
  expect(await trds.count()).toBe(before);
});

test("the Library menu says in one line what each page is for, and Builder and Sources say how they differ from the Interview", async ({ page }) => {
  test.setTimeout(120_000);
  await openDemo(page, "arx");
  const nav = page.getByRole("navigation", { name: "Main" });
  // A phone keeps every entry in the Menu panel; the other sizes keep these in the Library drop-down.
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  else await nav.getByRole("button", { name: /^Library/ }).click();
  // The hint is the link's description (aria-describedby), so a screen reader reads it after the name. Tester D row 9: only the Documents menu had hints.
  const hints: [string, RegExp][] = [
    ["Templates", /^Your own Word or PDF templates/],
    ["Guidance", /^Official regulations and guidance/],
    ["Saved answers", /^Your own sets of interview answers/],
    ["Sources", /^Where each answer came from\.$/],
    ["Builder", /^Advanced view; the Interview is easier\.$/],
  ];
  for (const [name, hint] of hints) await expect(nav.getByRole("link", { name, exact: true }), name).toHaveAccessibleDescription(hint);

  // Tester D row 32: the two pages that looked like the Interview say how they differ in their first line.
  await go(page, "#/builder");
  await expect(page.getByTestId("page-purpose")).toContainText("Advanced view; the Interview is easier.");
  await go(page, "#/sources");
  await expect(page.getByTestId("page-purpose")).toContainText("Where each answer came from.");
});

test("the phone Menu folds the steps under one line and says when more lies below", async ({ page }) => {
  test.skip(!isPhone(page), "The Menu panel exists on a phone only");
  test.setTimeout(120_000);
  await openDemo(page, "arx");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("button", { name: /^Menu/ }).click();
  const panel = page.locator(".nav-menu-panel");
  await expect(panel).toBeVisible();
  // The six steps sit under one summary line, closed until asked for.
  const steps = panel.locator("details.nav-steps").first();
  await expect(steps.locator("summary")).toHaveText(/^The \d+ steps$/);
  await expect(steps).not.toHaveAttribute("open", "");
  await steps.locator("summary").click();
  await expect(steps.getByRole("link").first()).toBeVisible();
  await steps.locator("summary").click();
  // The panel fits the screen, and when it is taller than that it scrolls inside itself and the hint says so until the end is reached.
  const box = (await panel.boundingBox())!;
  expect(box.y + box.height, "the Menu panel ends inside the screen").toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  const more = page.getByTestId("menu-more");
  const scrolls = await panel.evaluate((el) => el.scrollHeight - el.clientHeight > 8);
  if (scrolls) {
    await expect(more).not.toHaveClass(/is-off/);
    await expect(more).toContainText("More below");
    await panel.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(more).toHaveClass(/is-off/);
  } else {
    await expect(more).toHaveClass(/is-off/);
  }
});

test("browser-only copy: Rename on the open project, Import says what it made, and the About page says data stays in this browser", async ({ page, context }) => {
  test.setTimeout(180_000);
  await openDemo(page, "syr");
  const card = page.getByTestId("open-project");
  const title = (await card.locator(".project-title").innerText()).replace("Fictional demo", "").trim();
  expect(title).toContain("SYR-305");

  // Rename: a field with Save and Cancel; Escape puts the title back; an empty name is refused beside the field; a good name is kept.
  await card.getByRole("button", { name: `Rename ${title}` }).click();
  const field = card.getByRole("textbox", { name: `New name for ${title}` });
  await expect(field).toBeFocused();
  await field.fill("Discarded");
  await page.keyboard.press("Escape");
  await expect(card).toContainText(title);
  await expect(card.getByRole("button", { name: `Rename ${title}` })).toBeFocused();
  await card.getByRole("button", { name: `Rename ${title}` }).click();
  await field.fill("   ");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("Enter a name for the project.");
  await field.fill("Syringe rename check (fictional)");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.locator(".project-title")).toContainText("Syringe rename check (fictional)");
  await expect(card.getByRole("button", { name: "Rename Syringe rename check (fictional)" })).toBeFocused();

  // Import: the file comes from Export project (JSON). This copy holds one project, so the line names it and the person stays on Home.
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Export project (JSON)" }).click()]);
  const file = (await download.path()) as string;
  expect(download.suggestedFilename()).toMatch(/^syringe-rename-check-fictional/);
  expect(JSON.parse(readFileSync(file, "utf8"))).toBeTruthy();
  await page.getByLabel("Project JSON file to import").setInputFiles(file);
  await expect(page.getByTestId("import-result")).toHaveText("Imported: Syringe rename check (fictional)");
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);
  await expect(page.getByTestId("open-project")).toContainText("Syringe rename check (fictional)");

  // About and privacy: reachable from the footer on every page, and it says what is true of this copy.
  await page.getByRole("contentinfo").getByRole("link", { name: "About and privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "About and privacy" })).toBeVisible();
  const about = page.getByTestId("about-privacy");
  await expect(about).toContainText("This copy runs in your browser.");
  await expect(about).toContainText("None. This copy of Cascade sets no cookies.");
  await expect(about).toContainText("What you enter does not leave this browser.");
  await expect(about).toContainText("There is no account to ask for");
  expect(await context.cookies(), "the browser-only copy sets no cookie").toEqual([]);
  await axeClean(page, "about page, browser-only copy");
});
