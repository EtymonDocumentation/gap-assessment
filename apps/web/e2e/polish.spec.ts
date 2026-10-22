// "Sampling polish": (1) the demo plan has a step for every demo point that belongs to one, so only the three points that belong
// to no single process step are left in the "Not on the diagram" tray; (2) the Plan details card collapses to a one-line summary
// like the PPQ batch rows. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  const nav = page.getByRole("link", { name: "Sampling plan", exact: true });
  if (!(await nav.isVisible())) await page.getByRole("button", { name: /menu/i }).click();
  await nav.click();
}

async function openDemoPlan(page: Page) {
  await loadDemo(page);
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("flow-diagram")).toBeVisible();
}

async function axeClean(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toBe("");
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Demo point -> the step it must sit on (a pattern on the step's name). The three left out belong to no single process step.
const ON_STEP: Record<string, RegExp> = {
  "SP-003": /capping/i, // container closure integrity
  "SP-004": /visual inspection/i, // visual inspection AQL
  "SP-008": /QC release testing/i, // sterility release test
  "SP-011": /storage/i, // stability pulls
  "SP-012": /storage/i, // retain samples
  "SP-013": /storage/i, // shipping study units
};
const OFF_DIAGRAM = ["SP-006", "SP-014", "SP-015"]; // characterization report, agency request study, operator sample

test("the demo plan puts every point that belongs to a process step on that step's box", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openDemoPlan(page);
  await page.getByTestId("flow-diagram").screenshot({ path: join(SHOTS, "polish-demo-diagram-after.png") });
  for (const [id, step] of Object.entries(ON_STEP)) {
    const marker = page.getByTestId(`marker-${id}`);
    await expect(marker, `${id} has a marker`).toBeVisible();
    await expect(marker).not.toHaveAttribute("data-place", "Not on the diagram");
    await expect(marker).toHaveAttribute("data-place", step);
    // The table row says the same (one store behind both).
    const picked = await page.getByTestId(`row-step-${id}`).evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
    expect(picked, `${id} step in the table`).toMatch(step);
  }
  for (const id of OFF_DIAGRAM) await expect(page.getByTestId(`marker-${id}`)).toHaveAttribute("data-place", "Not on the diagram");
  // Exactly those three are in the tray.
  const tray = await page.locator('[data-testid^="marker-SP-"]').evaluateAll((els) => els.filter((e) => e.getAttribute("data-place") === "Not on the diagram").map((e) => e.getAttribute("data-testid")!.replace("marker-", "")));
  expect(tray.sort()).toEqual(OFF_DIAGRAM);
  // The new boxes are in process order: capping, visual inspection, release testing, storage come after filling.
  const labels = await page.locator('[data-testid^="flow-box-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-step-label")!));
  const at = (re: RegExp) => labels.findIndex((l) => re.test(l));
  expect(at(/aseptic filling/i)).toBeGreaterThan(-1);
  expect(at(/capping/i)).toBeGreaterThan(at(/aseptic filling/i));
  expect(at(/visual inspection/i)).toBeGreaterThan(at(/capping/i));
  expect(at(/QC release testing/i)).toBeGreaterThan(at(/visual inspection/i));
  expect(at(/storage/i)).toBeGreaterThan(at(/QC release testing/i));
});

test("Plan details: collapsed summary with Edit; Edit opens the form; Cancel restores; Save collapses; focus follows", async ({ page }) => {
  await openDemoPlan(page);
  const summary = page.getByTestId("plan-details-summary");
  await expect(summary).toBeVisible();
  await expect(page.getByTestId("plan-title")).toHaveCount(0);
  await expect(summary).toContainText("PPQ batches:");
  await expect(summary).toContainText("3 (B-001, B-002, B-003)");
  const title = (await page.getByTestId("plan-details-title-text").textContent())!;

  // Edit: form with saved values, focus in the first field.
  await page.getByTestId("plan-details-edit").click();
  await expect(page.getByTestId("plan-title")).toBeFocused();
  await expect(page.getByTestId("plan-title")).toHaveValue(title);
  await expect(page.getByTestId("plan-batch-rationale")).not.toHaveValue("");

  // Cancel throws the typing away and puts focus back on Edit.
  await page.getByTestId("plan-title").fill("Abandoned title");
  await page.getByTestId("plan-details-cancel").click();
  await expect(page.getByTestId("plan-details-title-text")).toHaveText(title);
  await expect(page.getByTestId("plan-details-edit")).toBeFocused();
  await page.getByTestId("plan-details-edit").click();
  await expect(page.getByTestId("plan-title")).toHaveValue(title);

  // Save needs a change, then collapses to the new values and focuses Edit.
  await expect(page.getByTestId("plan-details-save")).toBeDisabled();
  await page.getByTestId("plan-batch-rationale").fill("Three consecutive batches, as the fictional master plan requires.");
  await page.getByTestId("plan-details-save").click();
  await expect(page.getByTestId("plan-title")).toHaveCount(0);
  await expect(page.getByTestId("plan-details-rationale-text")).toHaveText("Three consecutive batches, as the fictional master plan requires.");
  await expect(page.getByTestId("plan-details-edit")).toBeFocused();

  // Keyboard only: Enter on Edit opens, Escape is not needed because Cancel is a button in the tab order.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("plan-title")).toBeFocused();
});

test("a brand-new plan opens its details expanded, with no Cancel, and collapses on Save", async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId("plan-title-input").fill("Polish plan (fictional)");
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("plan-title")).toBeVisible();
  await expect(page.getByTestId("plan-details-cancel")).toHaveCount(0);
  await page.getByTestId("plan-batch-rationale").fill("Fictional reason.");
  await page.getByTestId("plan-details-save").click();
  await expect(page.getByTestId("plan-details-summary")).toContainText("Polish plan (fictional)");
  await expect(page.getByTestId("plan-details-summary")).toContainText("none yet");
  await expect(page.getByTestId("plan-details-edit")).toBeFocused();
});

test("Plan details card: accessible, no sideways scroll, collapsed and expanded, light and dark, 390 px", async ({ page }, info) => {
  const phone = info.project.name === "phone";
  await openDemoPlan(page);
  const card = page.locator('section[aria-labelledby="sp-details"]');
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.getByTestId("plan-details-summary")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await axeClean(page, 'section[aria-labelledby="sp-details"]');
    await card.screenshot({ path: join(SHOTS, `polish-details-collapsed-${phone ? "390" : "desktop"}-${scheme}.png`) });
    await page.getByTestId("plan-details-edit").click();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await axeClean(page, 'section[aria-labelledby="sp-details"]');
    await card.screenshot({ path: join(SHOTS, `polish-details-expanded-${phone ? "390" : "desktop"}-${scheme}.png`) });
    await page.getByTestId("plan-details-cancel").click();
  }
});
