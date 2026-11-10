// M13 job 4B: the excipient assessment inside both demos, the tour, the "?" help, the glossary terms, the Home card and the export from a demo.
// Counts shown on the page are computed from the stored rows, so each check compares one place with another instead of a typed number.
// Fictional data only. Runs at the three widths of the config.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { NOTICE_DOCUMENT, isPhone, openDemo, setTheme } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

/** The number in a count such as "12 open items" or "No open items". */
const numberIn = (text: string): number => Number(/\d+/.exec(text)?.[0] ?? 0);

const DEMOS = [
  { which: "arx", name: "ARX-217", lines: ["Excipient A (fictional)", "Excipient B (fictional)"] },
  { which: "syr", name: "SYR-305", lines: ["Surfactant C (fictional)", "Amino acid D (fictional)", "Sugar E (fictional)"] },
] as const;

for (const demo of DEMOS) {
  test(`${demo.name} demo: its excipient assessment opens, the open-items count equals the list, and the comparison shows a mix of results`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("./");
    await openDemo(page, demo.which);
    await hash(page, "#/excipient");
    await expect(page.getByTestId("ex-list-table")).toContainText("EXA-001");
    await expect(page.getByTestId("ex-list-table")).toContainText(`${demo.name} `);
    await page.getByTestId("ex-list-link").first().click();
    await expect(page.getByTestId("ex-editor")).toBeVisible();

    // The excipients tab lists every line of the demo.
    for (const l of demo.lines) await expect(page.getByTestId("ex-lines-table")).toContainText(l);
    await expect(page.getByTestId("ex-pill-lines")).toHaveText(`${demo.lines.length} excipients`);
    await expectNoSidewaysScroll(page, `${demo.name} excipients`);
    await expectAccessible(page, `${demo.name} excipients`);

    // One open-items count: the pill, the tab label and the list on the Open items tab agree.
    const pill = numberIn(await page.getByTestId("ex-pill-open").innerText());
    expect(pill).toBeGreaterThan(0);
    await page.getByTestId("ex-tab-open").click();
    await expect(page.getByTestId("ex-tab-open")).toContainText(`(${pill})`);
    await expect(page.getByTestId("ex-open-link")).toHaveCount(pill);
    await expectAccessible(page, `${demo.name} open items`);
    // and the project's own Open items page says the same
    await hash(page, "#/tbd");
    await expect(page.getByTestId("tbd-excipient-count")).toHaveText(`${pill} open ${pill === 1 ? "item" : "items"}`);

    // The comparison mixes Same, Different and Only at one site, with a row not compared yet. Each result is a word, not only a colour.
    await hash(page, "#/excipient?excipient=EXA-001&tab=specs");
    await expect(page.getByTestId("ex-specs")).toBeVisible();
    const seen = new Set<string>();
    for (let i = 0; i < demo.lines.length; i++) {
      await page.getByTestId("ex-specs-line").selectOption({ index: i });
      for (const t of await page.locator('[data-testid^="ex-result-"]').allInnerTexts()) seen.add(t.replace(/^\S\s+/, "").trim());
    }
    for (const word of ["Same", "Different", "Only at the sending site", "Not compared yet"]) expect([...seen].some((s) => s.endsWith(word)), word).toBe(true);
    await expectNoSidewaysScroll(page, `${demo.name} specifications`);
    await expectAccessible(page, `${demo.name} specifications`);
  });
}

test("a demo's excipient assessment exports to HTML and Word with the notice, and the history keeps both", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/excipient?excipient=EXA-001&tab=document");
  await expect(page.getByTestId("ex-open-count")).toContainText("open");
  await page.getByTestId("ex-download-html").click();
  const warn = page.getByTestId("ex-tbd-warning");
  const [dl] = await Promise.all([page.waitForEvent("download"), (await warn.isVisible().catch(() => false)) ? page.getByTestId("ex-tbd-go").click() : Promise.resolve()]);
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(await dl.path(), "utf8");
  expect(dl.suggestedFilename()).toMatch(/^excipient-assessment-.*EXA-001.*\.html$/);
  expect(html).toContain(NOTICE_DOCUMENT);
  expect(html).toContain("Excipient A (fictional)");
  expect(html).toContain("Excipient B (fictional)");
  await page.getByTestId("ex-download-word").click();
  const go = page.getByTestId("ex-tbd-go");
  if (await go.isVisible().catch(() => false)) {
    const [word] = await Promise.all([page.waitForEvent("download"), go.click()]);
    expect(word.suggestedFilename()).toMatch(/\.docx$/);
  }
  await expect(page.getByTestId("ex-word-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Export history table" }).locator("tbody tr")).toHaveCount(2);
});

test("the demo's linked lines show their TRD item and the risk item started from the excipient", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/excipient?excipient=EXA-001");
  await page.getByTestId("ex-line-link").first().click();
  await expect(page.getByTestId("ex-line-page")).toBeVisible();
  await expect(page.getByTestId("ex-trd-linked")).toContainText("TRD-001");
  // the second line carries the risk item
  await hash(page, "#/excipient?excipient=EXA-001");
  await page.getByTestId("ex-line-link").nth(1).click();
  await expect(page.getByTestId("ex-links")).toContainText("Risk item");
  await expect(page.getByTestId("ex-links")).not.toContainText("No risk item was started");
});

test("a risk suggestion already started shows a status with an icon and words instead of a button", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/excipient?excipient=EXA-001");
  await page.getByTestId("ex-line-link").nth(1).click();
  await page.getByTestId("ex-risk-pick").selectOption({ index: 1 });
  const done = page.getByTestId("ex-risk-added-excipient_nitrite_amine_unknown");
  await expect(done).toContainText("Started");
  await expect(done).toContainText("RA-");
  await expect(page.getByTestId("ex-risk-start-excipient_nitrite_amine_unknown")).toHaveCount(0);
  // the other suggestions still offer their button
  await expect(page.getByRole("button", { name: /^Start a draft risk item/ }).first()).toBeVisible();
  await expectAccessible(page, "risk offers with a started item");
});

// ------------------------------------------------------------------ tour, help, glossary, Home

// The tours here are always started from the Help menu: nothing starts by itself in an automated browser.
async function openHelp(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByText("Help", { exact: true }).scrollIntoViewIfNeeded();
  } else {
    await page.getByTestId("help-menu-button").click();
  }
}

const tourEntry = (page: Page) => (isPhone(page) ? page.getByRole("button", { name: "Tour of this page" }) : page.getByRole("menuitem", { name: "Tour of this page" }));
const bubble = (page: Page) => page.getByTestId("tour-bubble");

async function tourTitles(page: Page): Promise<string[]> {
  const titles: string[] = [];
  for (let i = 0; i < 12; i++) {
    titles.push((await bubble(page).getByRole("heading").first().innerText()).trim());
    const next = bubble(page).getByRole("button", { name: /^(Next|Done)$/ });
    const last = (await next.innerText()).trim() === "Done";
    await next.click();
    if (last) break;
  }
  return titles;
}

test("the tour walks through the excipient steps on the list and on an assessment, and the page has an About section", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/excipient");
  await expect(page.getByTestId("ex-list")).toBeVisible();
  await openHelp(page);
  await tourEntry(page).click();
  await expect(bubble(page)).toBeVisible();
  const listSteps = await tourTitles(page);
  expect(listSteps.length).toBeGreaterThanOrEqual(2);
  expect(listSteps).toContain("Start an assessment");
  await expect(bubble(page)).toHaveCount(0);

  // On an assessment the tour carries the steps of that page (the ones whose element is on screen).
  await hash(page, "#/excipient?excipient=EXA-001");
  await expect(page.getByTestId("ex-editor")).toBeVisible();
  await openHelp(page);
  await tourEntry(page).click();
  await expect(page.getByTestId("tour-count")).toHaveText(/^Step 1 of [3-9]$/);
  const steps = await tourTitles(page);
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(steps).toEqual(expect.arrayContaining(["What this page is", "Five steps", "Your excipients"]));

  // "About this page" is offered on the page (and on the library, which has no tour).
  await openHelp(page);
  await expect(page.getByTestId("help-about")).toBeVisible();
  await page.keyboard.press("Escape");
  await hash(page, "#/excipient/library");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openHelp(page);
  await expect(page.getByTestId("help-about")).toBeVisible();
  await expect(page.getByTestId("help-tour")).toHaveCount(0);
});

test("the glossary explains the excipient words, and every 'see also' leads to a real term", async ({ page }) => {
  await page.goto("./");
  await hash(page, "#/glossary");
  await expect(page.getByTestId("glossary")).toBeVisible();
  for (const id of ["excipient", "compendial", "monograph", "specification", "coa", "tse", "nitrosamine", "elemental-impurity", "supplier-qualification"]) {
    await expect(page.getByTestId(`term-${id}`)).toHaveCount(1);
  }
  await page.getByTestId("glossary-filter").fill("excipient");
  await expect(page.getByTestId("term-excipient")).toBeVisible();
  await expectNoSidewaysScroll(page, "glossary");
  await expectAccessible(page, "glossary filtered to excipient");
});

test("Home lists the Excipient assessment card with its state, and the card opens the page", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await hash(page, "#/");
  const card = page.getByTestId("doc-card-excipient");
  await expect(card.getByRole("heading", { level: 3, name: "Excipient assessment" })).toBeVisible();
  await expect(page.getByTestId("doc-card-state-excipient")).toContainText("EXA-001");
  await expect(page.getByTestId("doc-card-state-excipient")).toContainText("open");
  await expectNoSidewaysScroll(page, "home with the excipient card");
  await expectAccessible(page, "home with the excipient card");
  await card.getByTestId("doc-card-open-excipient").click();
  await expect(page.getByTestId("ex-list")).toBeVisible();
});

// ------------------------------------------------------------------ keyboard and themes

test("keyboard: the tabs move with the arrow keys and the demo's rows can be reached with Tab", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx");
  await hash(page, "#/excipient?excipient=EXA-001");
  await expect(page.getByTestId("ex-editor")).toBeVisible();
  await page.getByTestId("ex-tab-excipients").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ex-tab-questions")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByTestId("ex-tab-document")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("ex-tab-excipients")).toHaveAttribute("aria-selected", "true");
  // the first excipient's link takes focus by Tab alone
  await page.getByTestId("ex-tab-excipients").focus();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "ex-line-link");
  }
  expect(reached).toBe(true);
});

for (const scheme of ["Light", "Dark"] as const) {
  test(`${scheme}: the demo's excipient list, an excipient page and the tour step are accessible and do not scroll sideways`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("./");
    await openDemo(page, "syr");
    await setTheme(page, scheme);
    await hash(page, "#/excipient");
    await expect(page.getByTestId("ex-list-table")).toBeVisible();
    await expectNoSidewaysScroll(page, `${scheme} list`);
    await expectAccessible(page, `${scheme} list`);
    await hash(page, "#/excipient?excipient=EXA-001&line=EXL-001");
    await expect(page.getByTestId("ex-line-page")).toBeVisible();
    await expectNoSidewaysScroll(page, `${scheme} line`);
    await expectAccessible(page, `${scheme} line`);
    await hash(page, "#/excipient?excipient=EXA-001");
    await openHelp(page);
    await tourEntry(page).click();
    await expect(bubble(page)).toBeVisible();
    await expectNoSidewaysScroll(page, `${scheme} tour`);
    await expectAccessible(page, `${scheme} tour step`);
  });
}
