import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const CATEGORIES = [
  "Equivalent",
  "Within validated range",
  "Outside validated range",
  "Different principle",
  "Scale change",
  "New requirement",
  "Removed element",
  "Information required",
];

test.beforeEach(async ({ page }) => {
  // "Replace the open project?" confirmations are accepted; each test starts with empty storage anyway.
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText("Proof of concept. Not validated. Not for GMP use.").first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function downloadText(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), click()])) as [Download, void];
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: await readFile(path, "utf8") };
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

test("demo loads in one click and the register covers all eight categories", async ({ page }) => {
  await loadDemo(page);
  const summary = page.getByRole("list", { name: "Count by category" });
  for (const c of CATEGORIES) {
    const btn = summary.getByRole("button", { name: new RegExp(`^${c}\\s+\\d+$`) });
    await expect(btn).toBeVisible();
    const count = Number((await btn.locator(".count").textContent()) ?? "0");
    expect(count, `${c} count`).toBeGreaterThan(0);
  }

  // Filter by category.
  await summary.getByRole("button", { name: /^Outside validated range/ }).click();
  const rows = page.locator("table.register tbody tr:not(.detail-row)");
  await expect(rows.first()).toBeVisible();
  for (const chip of await rows.locator(".chip").allTextContents()) expect(chip).toBe("Outside validated range");
  await summary.getByRole("button", { name: /^Outside validated range/ }).click();

  // Sort by severity: the first row is high.
  await page.getByRole("button", { name: "Sort by Severity" }).click();
  await expect(page.locator("th[aria-sort='ascending']")).toContainText("Severity");
  await expect(rows.first().locator(".sev")).toHaveText("High");

  // Search narrows the rows.
  await page.getByRole("searchbox").fill("pump");
  await expect(rows.first()).toContainText(/pump/i);
  await page.getByRole("searchbox").fill("");

  // Details panel and overlay editor.
  await rows.first().getByRole("button", { name: /^Details/ }).click();
  await expect(page.locator(".detail-row")).toContainText("Rationale:");
  await expect(page.getByRole("form", { name: /^Decisions for/ })).toBeVisible();

  // CSV export.
  const csv = await downloadText(page, () => page.getByRole("button", { name: /^Export CSV/ }).click());
  expect(csv.name).toMatch(/\.csv$/);
  expect(csv.text.split("\n")[0]).toContain("Category");
  expect(csv.text).not.toMatch(/undefined|NaN/);
});

test("interview: progress map jump, why-asked, paired and sequential order", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview");
  const map = page.getByRole("navigation", { name: "Sections" });
  await expect(map).toBeVisible();

  // Paired: source then target for the same question.
  await map.getByRole("link", { name: /^Pooling, compounding and dilution/ }).click();
  const prompt = page.locator("#q-prompt");
  const badge = page.locator(".question-card .side-badge");
  await expect(badge).toHaveText(/^Source/);
  const firstPrompt = await prompt.textContent();
  await page.getByRole("link", { name: /Skip for now/ }).click();
  await expect(badge).toHaveText(/^Target/);
  await expect(prompt).toHaveText(firstPrompt ?? "");
  await expect(page.locator(".source-ref")).toBeVisible();

  // Why is this asked?
  const why = page.locator("details.why");
  await why.locator("summary").click();
  await expect(why).toHaveAttribute("open", "");
  await expect(why.locator("p").first()).not.toBeEmpty();

  // Sequential: the source pass continues with the next source question.
  await page.locator(".segmented label", { hasText: "Sequential" }).click();
  await expect(page.locator("#mode-help")).toHaveText(/All source answers first/);
  await map.getByRole("link", { name: /^Pooling, compounding and dilution/ }).click();
  await expect(badge).toHaveText(/^Source/);
  await page.getByRole("link", { name: /Skip for now/ }).click();
  await expect(badge).toHaveText(/^Source/);
  await expect(prompt).not.toHaveText(firstPrompt ?? "");

  // Section summary.
  await map.getByRole("link", { name: /^Review Aseptic filling/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Section summary: Aseptic filling/ })).toBeVisible();
});

test("branching: making the target pump the same closes its follow-ups and keeps them as inactive", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=fill.accuracy%40target");
  await expect(page.locator(".question-card .trigger")).toContainText("differs from the source");

  await go(page, "#/interview?q=fill.pump%40target");
  await expect(page.locator(".live-compare")).toContainText("Different principle");
  await page.getByRole("button", { name: "Same as source" }).click();
  await expect(page.locator(".interview-aside .notice")).toContainText("no longer apply");

  await go(page, "#/register");
  await page.getByRole("searchbox").fill("Filling pump");
  // The difference is gone; only an equivalent row remains, and those are hidden by default.
  await expect(page.getByText("No rows match these filters.")).toBeVisible();
  await page.getByLabel("Show equivalent").check();
  await expect(page.locator("table.register tbody tr").first()).toContainText("Equivalent");
});

test("new project: responder, scoping answers, unknown and not-applicable handling", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Smoke test (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();

  const prompt = page.locator("#q-prompt");
  await expect(prompt).toHaveText("Program or product code");
  await page.locator(".question-card input").first().fill("SMOKE-1");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(prompt).toHaveText("What is the product modality?");
  await page.locator(".question-card .choice-chip").first().click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(prompt).toHaveText("What is the dosage form?");
  await page.getByRole("button", { name: "Unknown — to be confirmed" }).click();
  await expect(prompt).toHaveText("What is the primary container presentation?");

  // Not applicable needs a justification.
  await page.getByRole("button", { name: "Not applicable…" }).click();
  await page.getByRole("button", { name: "Record as not applicable" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(prompt).toHaveText("What is the primary container presentation?");

  await expect(page.locator(".interview-aside")).toContainText("3 of");

  await go(page, "#/builder");
  await expect(page.getByRole("heading", { level: 1, name: "Builder" })).toBeVisible();
  await expect(page.locator("main")).toContainText("SMOKE-1");
  await expect(page.locator("main")).toContainText("Unknown");
});

test("side by side markers link to the register row", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/compare");
  await expect(page.getByRole("heading", { level: 1, name: "Side by side" })).toBeVisible();
  const marker = page.locator("a.marker", { hasText: "Scale change" }).first();
  await marker.click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.locator("table.register tr.open")).toContainText("Scale change");
});

test("validation page: plan, equipment table, gap link and CSV", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/validation");
  await expect(page.getByRole("heading", { level: 1, name: "Validation" })).toBeVisible();

  const planSection = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Validation plan" }) });
  const equipSection = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Equipment qualification" }) });
  const planRows = planSection.locator("table.validation-plan tbody tr");
  await expect(planRows.first()).toBeVisible();
  expect(await planRows.count()).toBeGreaterThan(0);

  // A filter narrows the plan, and a nonsense search shows the plain empty state.
  await page.getByRole("searchbox").fill("zzzz-no-such-activity");
  await expect(page.getByText("No activities match these filters.")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await expect(planRows.first()).toBeVisible();

  // A gap link opens the register on that row.
  await planRows.first().locator("a[href*='register']").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.locator("table.register tr.open")).toHaveCount(1);

  // CSV downloads from both sections.
  await go(page, "#/validation");
  const csv = await downloadText(page, () => planSection.getByRole("button", { name: /^Export CSV/ }).click());
  expect(csv.name).toMatch(/validation-plan.*\.csv$/);
  expect(csv.text.split("\n")[0]).toContain("Activity");
  expect(csv.text).not.toMatch(/undefined|NaN/);
  // The equipment table needs the demo's equipment qualification answers.
  await expect(equipSection.locator("table.equipment-qualification tbody tr").first()).toBeVisible();
  const eq = await downloadText(page, () => equipSection.getByRole("button", { name: /^Export CSV/ }).click());
  expect(eq.name).toMatch(/equipment-qualification.*\.csv$/);
  expect(eq.text).not.toMatch(/undefined|NaN/);
});

test("document preview and downloads", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  const preview = page.locator(".doc-preview");
  await expect(preview).toContainText("Gap assessment: ARX-217");
  await expect(preview).toContainText("Requires regulatory affairs assessment");

  const md = await downloadText(page, () => page.getByRole("button", { name: "Download Markdown" }).click());
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toContain("# Gap assessment: ARX-217");
  expect(md.text).toContain("Proof of concept. Not validated. Not for GMP use.");
  expect(md.text).not.toMatch(/undefined|NaN/);

  const html = await downloadText(page, () => page.getByRole("button", { name: "Download HTML" }).click());
  expect(html.name).toMatch(/\.html$/);
  expect(html.text).toContain("<!doctype html>");
  expect(html.text).toContain("Not for GMP use");
});

for (const theme of ["light", "dark"] as const) {
  test(`accessibility and layout, ${theme} theme`, async ({ page }) => {
    test.setTimeout(120_000); // the demo now has more rows to check on each page
    await loadDemo(page);
    await page.getByLabel("Colour theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const routes = ["#/", "#/interview?q=fill.pump%40target", "#/interview?summary=uo.aseptic_filling", "#/compare", "#/register", "#/validation", "#/document", "#/builder"];
    for (const r of routes) {
      await go(page, r);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectAccessible(page, `${theme} ${r}`);
      await expectNoHorizontalScroll(page, `${theme} ${r}`);
    }
    // The validation page at three widths (wide tables scroll inside their own region, never the page).
    await go(page, "#/validation");
    const original = page.viewportSize();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("heading", { level: 1, name: "Validation" })).toBeVisible();
      await expectAccessible(page, `${theme} validation at ${width}px`);
      await expectNoHorizontalScroll(page, `${theme} validation at ${width}px`);
    }
    if (original) await page.setViewportSize(original);
    // Open register details and a dialog are checked too.
    await go(page, "#/register");
    await page.locator("table.register tbody tr").first().getByRole("button", { name: /^Details/ }).click();
    await expectAccessible(page, `${theme} register details`);
    // The builder dialogs are checked too.
    await go(page, "#/builder");
    await page.getByRole("button", { name: "Add unit operation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `${theme} builder add dialog`);
    await expectNoHorizontalScroll(page, `${theme} builder add dialog`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await go(page, "#/");
    await page.getByRole("button", { name: "Close and delete…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page, `${theme} dialog`);
  });
}

/** Fills in the "who is making this change" dialog when the project has no responder yet. */
async function answerResponderIfAsked(page: Page) {
  const ask = page.getByRole("dialog", { name: "Who is making this change?" });
  if (await ask.isVisible().catch(() => false)) {
    await ask.getByLabel("Responder name").fill("Test Person (fictional)");
    await ask.getByRole("button", { name: /Save responder/ }).click();
  }
}

const edit = (page: Page, id: string, side: "source" | "target") => page.locator(`[id="edit-${id}-${side}"]`);

async function setParameter(page: Page, id: string, side: "source" | "target", v: { set: string; nor: [string, string]; par?: [string, string] }) {
  await edit(page, id, side).click();
  await answerResponderIfAsked(page);
  const dialog = page.getByRole("dialog");
  if (side === "source") {
    await dialog.locator("label.choice-chip", { hasText: /^CPP/ }).click();
    await dialog.locator("label.choice-chip", { hasText: /^PPQ$/ }).click();
  }
  await dialog.getByLabel("Set point value").fill(v.set);
  await dialog.getByLabel("Normal operating range (NOR) minimum").fill(v.nor[0]);
  await dialog.getByLabel("Normal operating range (NOR) maximum").fill(v.nor[1]);
  if (v.par) {
    await dialog.getByLabel("Proven acceptable range (PAR) minimum").fill(v.par[0]);
    await dialog.getByLabel("Proven acceptable range (PAR) maximum").fill(v.par[1]);
  }
  await dialog.getByRole("button", { name: "Save value" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test("builder: an inline edit changes the register", async ({ page }) => {
  await loadDemo(page);
  const count = async () => {
    const btn = page.getByRole("list", { name: "Count by category" }).getByRole("button", { name: /^Different principle\s+\d+$/ });
    return Number((await btn.locator(".count").textContent()) ?? "0");
  };
  const before = await count();
  expect(before).toBeGreaterThan(0);

  await go(page, "#/builder");
  await expect(page.getByRole("heading", { level: 1, name: "Builder" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Filter by text or path" }).fill("pump");
  const target = edit(page, "fill.pump", "target");
  await expect(target).toBeVisible();
  await target.click();
  await answerResponderIfAsked(page);
  await page.getByRole("dialog").getByRole("button", { name: "Same as source" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(target).toBeFocused();
  await expect(page.locator("main")).toContainText("Same as source");

  await go(page, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  expect(await count()).toBe(before - 1);
});

test("builder: custom unit operation and parameter appear in the register, and removal keeps the values as inactive", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/builder");
  await page.getByRole("button", { name: "Add unit operation" }).click();
  await answerResponderIfAsked(page);
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Visual check (fictional)");
  await dialog.getByRole("button", { name: "Add unit operation" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const heading = page.getByRole("heading", { level: 2, name: /Visual check \(fictional\)/ });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(heading).toContainText("Custom unit operation");

  await page.getByRole("button", { name: "Add parameter, equipment, material or control" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Unit operation").selectOption({ label: "Visual check (fictional)" });
  await dialog.getByLabel("Name").fill("Hold temperature (fictional)");
  await dialog.getByLabel("Unit dimension").selectOption("temperature");
  await dialog.getByLabel(/Why is this asked/).fill("Fictional custom parameter for the smoke test.");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const uo = "x.x_visual_check_fictional";
  for (const side of ["source", "target"] as const) {
    await edit(page, `${uo}.presence`, side).click();
    await page.getByRole("dialog").locator("label.choice-chip", { hasText: /^Yes$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save value" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  const param = `${uo}.param.x_hold_temperature_fictional`;
  await expect(page.locator("main")).toContainText("Hold temperature (fictional)");
  await expect(page.locator("main")).toContainText("Custom");
  await setParameter(page, param, "source", { set: "20", nor: ["18", "22"], par: ["10", "30"] });
  await setParameter(page, param, "target", { set: "35", nor: ["32", "38"] });

  await go(page, "#/register");
  const row = page.locator("table.register tbody tr", { hasText: "Hold temperature (fictional)" });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText("Outside validated range");

  await go(page, "#/builder");
  await page.getByRole("button", { name: "Remove Visual check (fictional)" }).click();
  await expect(page.getByRole("dialog")).toContainText("become inactive");
  await page.getByRole("dialog").getByRole("button", { name: "Remove and keep values as inactive" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const inactive = page.getByRole("region", { name: "Inactive values table" });
  await expect(inactive).toContainText("Hold temperature (fictional)");
  await expect(inactive).toContainText("20");
  await expect(page.getByRole("heading", { level: 2, name: /Visual check \(fictional\)/ })).toHaveCount(0);

  await go(page, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await expect(page.locator("table.register")).not.toContainText("Hold temperature (fictional)");
});
