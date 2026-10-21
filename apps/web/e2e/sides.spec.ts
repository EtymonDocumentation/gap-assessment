// Interview clarity: which unit (SU or RU) is being answered. A paired question shows both sides on one card; a one-sided
// question shows a banner. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SU_LEGEND = "Sending unit (SU) — Site North (fictional), Line 2 · validated state";
const RU_LEGEND = "Receiving unit (RU) — Site South (fictional), Line 4 · planned state";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function newProject(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Sides test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
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

const panel = (page: Page, side: "source" | "target"): Locator => page.locator(`fieldset.side-panel[data-side="${side}"]`);
const status = (page: Page): Locator => page.locator("div.visually-hidden[aria-live='polite']");

/** Picks an option other than the one now chosen in a panel and returns its text. */
async function pickDifferent(p: Locator): Promise<string> {
  const chip = p.locator(".choice-chip:not(.checked)").first();
  const text = ((await chip.textContent()) ?? "").trim();
  await chip.click();
  return text;
}

test("a paired question shows SU and RU together, each in its own labelled group", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40source");
  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Filling pump operating principle");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  await expect(page.getByRole("group", { name: SU_LEGEND })).toBeVisible();
  await expect(page.getByRole("group", { name: RU_LEGEND })).toBeVisible();
  // Each side has its own input, and the RU panel (only) offers Same as SU.
  await expect(panel(page, "source").getByRole("group", { name: "SU answer" })).toBeVisible();
  await expect(panel(page, "target").getByRole("group", { name: "RU answer" })).toBeVisible();
  await expect(panel(page, "source").getByRole("button", { name: "Same as SU" })).toHaveCount(0);
  await expect(panel(page, "target").getByRole("button", { name: "Same as SU" })).toBeVisible();
  for (const side of ["source", "target"] as const) {
    await expect(panel(page, side).getByRole("button", { name: "Unknown — to be confirmed" })).toBeVisible();
    await expect(panel(page, side).getByRole("button", { name: "Not applicable…" })).toBeVisible();
    await expect(panel(page, side).locator("details.cite")).toHaveCount(1);
  }
  // The RU panel shows the SU answer next to it, and there is a single primary button.
  await expect(panel(page, "target").locator(".source-ref")).toContainText("SU answer:");
  await expect(page.getByRole("button", { name: /^Save SU and RU$/ })).toHaveCount(1);
  // The same card opens from the RU key, and both sides stay editable in sequential order too.
  await go(page, "#/interview?q=fill.pump%40target");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  await page.locator(".segmented label", { hasText: "Sequential" }).click();
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
});

test("one button saves both sides, and the status line says so", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  const su = await pickDifferent(panel(page, "source"));
  const ru = await pickDifferent(panel(page, "target"));
  const save = page.getByRole("button", { name: "Save SU and RU" });
  await expect(save).toBeVisible();
  await save.click();
  await expect(status(page)).toHaveText(/^Saved SU and RU\. Next: .+\.$/);
  // Back on the question, both new answers are there.
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(panel(page, "source").locator(".choice-chip.checked")).toHaveText(su);
  await expect(panel(page, "target").locator(".choice-chip.checked")).toHaveText(ru);
  // One change-log entry per side.
  await go(page, "#/changes");
  await expect(page.getByRole("heading", { level: 1, name: "Change log" })).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows.nth(0)).toContainText("RU: Aseptic filling and stoppering: Filling pump principle");
  await expect(rows.nth(1)).toContainText("SU: Aseptic filling and stoppering: Filling pump principle");
});

test("only the side with input is saved, and the button says which", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40source");
  const suBefore = ((await panel(page, "source").locator(".choice-chip.checked").textContent()) ?? "").trim();
  const ru = await pickDifferent(panel(page, "target"));
  await expect(page.getByRole("button", { name: "Save RU", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save RU", exact: true }).click();
  await expect(status(page)).toHaveText(/^Saved RU\. Next: /);
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(panel(page, "source").locator(".choice-chip.checked")).toHaveText(suBefore);
  await expect(panel(page, "target").locator(".choice-chip.checked")).toHaveText(ru);

  // Changing only SU gives "Save SU".
  await pickDifferent(panel(page, "source"));
  await expect(page.getByRole("button", { name: "Save SU", exact: true })).toBeVisible();
});

test("Same as SU sits inside the RU panel and records RU only", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40target");
  await panel(page, "target").getByRole("button", { name: "Same as SU" }).click();
  await expect(status(page)).toHaveText(/^Saved RU\. Next: /);
  await go(page, "#/interview?q=fill.pump%40target");
  await expect(panel(page, "target")).toContainText("Recorded RU:");
  await expect(panel(page, "target").locator(".recorded")).toContainText(/same as SU/i);
});

test("a link to either side opens the combined card with focus in that side's panel", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40target");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  await expect(panel(page, "target").locator(":focus")).toHaveCount(1);
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(panel(page, "source").locator(":focus")).toHaveCount(1);
  await go(page, "#/interview?q=fill.pump%40target");
  await expect(panel(page, "target").locator(":focus")).toHaveCount(1);

  // Moving on with Skip starts at the heading.
  await go(page, "#/interview?q=fill.pump%40source");
  await page.getByRole("link", { name: /Skip for now/ }).click();
  await expect(page.locator("#q-prompt")).toBeFocused();
});

test("a question for one unit only has a side banner, a prefixed heading and a labelled input", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=comp.mixing_coverage%40source");
  const banner = page.locator(".side-banner");
  await expect(banner).toContainText("You are answering for:");
  await expect(banner).toContainText(SU_LEGEND);
  await expect(banner.locator(".side-mark")).toHaveText("SU");
  await expect(page.locator("#q-prompt")).toHaveText(/^SU: /);
  await expect(page.locator("fieldset.side-panel")).toHaveCount(0);
  await expect(page.getByLabel("SU answer minimum")).toBeVisible();

  await go(page, "#/interview?q=fill.accuracy%40target");
  await expect(page.locator(".side-banner")).toContainText(RU_LEGEND);
  await expect(page.locator(".side-banner .side-mark")).toHaveText("RU");
  await expect(page.locator("#q-prompt")).toHaveText(/^RU: /);
  await expect(page.getByRole("group", { name: "RU answer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and continue" })).toBeVisible();
});

test("scoping questions say they apply to both units, with no side prefix", async ({ page }) => {
  await newProject(page);
  await expect(page.locator(".side-banner")).toContainText("one answer for both the sending unit (SU) and the receiving unit (RU)");
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
});

test("saving one side with Unknown stays on the card for the other side; site names show in the legends", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);
  await go(page, "#/interview?q=site.name%40source");
  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Site name");
  // Names are not known yet: only the side name and the state wording.
  await expect(page.getByRole("group", { name: "Sending unit (SU) · current state" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Receiving unit (RU) · planned state" })).toBeVisible();
  await panel(page, "source").getByRole("textbox").fill("Site North (fictional)");
  await panel(page, "target").getByRole("textbox").fill("Site South (fictional)");
  await page.getByRole("button", { name: "Save SU and RU" }).click();
  await expect(status(page)).toHaveText(/^Saved SU and RU\./);

  await go(page, "#/interview?q=site.line%40source");
  await expect(prompt).toHaveText("Filling line");
  await expect(page.getByRole("group", { name: "Sending unit (SU) — Site North (fictional) · current state" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Receiving unit (RU) — Site South (fictional) · planned state" })).toBeVisible();

  // Unknown for SU keeps the card open and moves focus to RU, which still needs an answer.
  await panel(page, "source").getByRole("button", { name: "Unknown — to be confirmed" }).click();
  await expect(status(page)).toHaveText("Saved SU. RU still needs an answer.");
  await expect(prompt).toHaveText("Filling line");
  await expect(panel(page, "source")).toContainText("Recorded SU:");
  await expect(panel(page, "target").locator(":focus")).toHaveCount(1);
  // Unknown for RU completes the question, and the interview moves on.
  await panel(page, "target").getByRole("button", { name: "Unknown — to be confirmed" }).click();
  await expect(status(page)).toHaveText(/^Saved RU\. Next: .+\.$/);
  await expect(prompt).not.toHaveText("Filling line");
});

test("in the SU-first order, the RU panel is there too and says it can be answered now", async ({ page }) => {
  await newProject(page);
  await go(page, "#/interview?q=site.name%40source");
  await page.locator(".segmented label", { hasText: "Sequential" }).click();
  await expect(page.locator("#mode-help")).toHaveText(/All SU answers first/);
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  await expect(panel(page, "target")).toContainText("RU is asked in the second pass; you can answer it now.");
  await expect(panel(page, "target").getByRole("textbox")).toBeEditable();
  // Saving just SU works in this order too.
  await panel(page, "source").getByRole("textbox").fill("Site North (fictional)");
  await page.getByRole("button", { name: "Save SU", exact: true }).click();
  await expect(status(page)).toHaveText(/^Saved SU\./);
});

test("a refused answer is reported on its own panel and in a summary alert", async ({ page }) => {
  await loadDemo(page);
  // Two numbers where one side is incomplete: the aseptic filling duration is a quantity on both sides.
  await go(page, "#/interview?q=fill.duration%40source");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  const ruValue = panel(page, "target").getByRole("textbox", { name: "RU answer value" });
  await ruValue.fill("abc");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText("Nothing was saved");
  await expect(panel(page, "target").locator(".error")).toContainText("not a number");
  await expect(ruValue).toHaveAttribute("aria-invalid", "true");
  await expect(ruValue).toHaveAttribute("aria-describedby", /err-/);
  await expect(panel(page, "source").locator(".error")).toHaveCount(0);
});

test("the paired card is accessible and fits the screen; panels sit side by side when wide, stacked when narrow", async ({ page }) => {
  await loadDemo(page);
  for (const hash of ["#/interview?q=fill.pump%40source", "#/interview?q=fill.duration%40source", "#/interview?q=comp.mixing_coverage%40source"]) {
    await go(page, hash);
    await expect(page.locator("#q-prompt")).toBeVisible();
    await expectAccessible(page, hash);
    await expectNoHorizontalScroll(page, hash);
  }
  await go(page, "#/interview?q=fill.duration%40source");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  // Open the extra boxes so the widest layout is checked.
  await panel(page, "source").locator("details.cite summary").click();
  await panel(page, "target").locator("details.cite summary").click();
  await panel(page, "target").getByRole("button", { name: "Not applicable…" }).click();
  await expectNoHorizontalScroll(page, "paired card with every box open");
  await expectAccessible(page, "paired card with every box open");

  const su = (await panel(page, "source").boundingBox())!;
  const ru = (await panel(page, "target").boundingBox())!;
  const width = page.viewportSize()!.width;
  if (width <= 760) {
    // Stacked, SU first, both the full width of the card.
    expect(ru.y).toBeGreaterThanOrEqual(su.y + su.height - 1);
    expect(Math.abs(ru.x - su.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(ru.width - su.width)).toBeLessThanOrEqual(1);
    expect(su.x + su.width).toBeLessThanOrEqual(width);
  } else {
    // Side by side, SU on the left.
    expect(Math.abs(ru.y - su.y)).toBeLessThanOrEqual(1);
    expect(ru.x).toBeGreaterThanOrEqual(su.x + su.width - 1);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`banner and panels are accessible in the ${theme} theme`, async ({ page }) => {
    await loadDemo(page);
    await page.getByLabel("Colour theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const hash of ["#/interview?q=fill.pump%40target", "#/interview?q=comp.mixing_coverage%40source", "#/interview?q=fill.accuracy%40target"]) {
      await go(page, hash);
      await expect(page.locator("#q-prompt")).toBeVisible();
      await expectAccessible(page, `${theme} ${hash}`);
      await expectNoHorizontalScroll(page, `${theme} ${hash}`);
    }
  });
}
