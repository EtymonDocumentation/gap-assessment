// The optional PDA TR 44 FMEA load-out on the risk page: chosen by the person, never imposed; the action threshold is theirs and blank by
// default; rows above it are flagged in words as well as a symbol; "risk accepted?" is an open item until answered; review history;
// intervention scoring and the severity / confidence hint are hints only. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function createBlank(page: Page, title: string) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Risk assessment");
  await page.getByTestId("risk-title-input").fill(title);
  await page.getByTestId("risk-create").click();
  await expect(page.getByTestId("risk-tabs")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

test("TR 44 load-out: threshold blank, flag in words, risk accepted open item, review history, intervention hint", async ({ page }) => {
  await createBlank(page, "TR 44 FMEA (fictional)");

  // Chosen, never imposed: the plain starters stay beside it.
  await expect(page.getByTestId("risk-loadout-fmea-1-10")).toBeVisible();
  await page.getByTestId("risk-loadout-fmea-pda-tr44").click();
  await expect(page.getByTestId("risk-method-summary")).toContainText("PDA TR 44");
  await expect(page.getByTestId("risk-method-summary")).toContainText(/reversed/i);

  // The threshold is blank; the example figure is only in the hint text.
  await expect(page.getByTestId("risk-threshold")).toHaveValue("");
  await expect(page.getByTestId("risk-review")).toContainText("used 100");
  await expect(page.getByTestId("risk-open-items")).toContainText("action threshold");
  await expect(page.getByTestId("risk-trigger-investigation")).not.toBeChecked();

  // One item, scored 10 x 4 x 5 = 200.
  await page.getByTestId("risk-tab-items").click();
  await page.getByTestId("risk-add-mode").fill("Contamination at filter set-up (fictional)");
  await page.getByTestId("risk-add-submit").click();
  await page.getByTestId("risk-item-edit-RA-001").click();
  await expect(page.getByTestId("item-tr44-guidance")).toContainText("loss of sterility");
  await page.getByTestId("score-initial-severity").selectOption("10");
  await page.getByTestId("score-initial-occurrence").selectOption("4");
  await page.getByTestId("score-initial-detection").selectOption("5");
  await expect(page.getByTestId("item-priority")).toContainText("200");
  await expect(page.getByTestId("item-priority")).toContainText("No action threshold entered yet");
  await expect(page.getByTestId("item-accepted")).toHaveValue("");
  // Intervention scoring is optional, off by default, and the overall level is not derived.
  await page.getByTestId("item-intervention-on").check();
  await page.getByTestId("item-iv-complexity").selectOption("high");
  await expect(page.getByTestId("item-iv-tally")).toContainText("1 high");
  await expect(page.getByTestId("item-iv-level")).toHaveValue("");
  await page.getByTestId("item-iv-level").selectOption("medium");
  await expect(page.getByTestId("item-iv-hint")).toContainText("PDA TR 22");
  await page.getByTestId("item-save").click();
  await expect(page.getByTestId("risk-open-items")).toContainText("risk accepted");

  // Threshold typed by the person: the row is flagged with words, not only a symbol or colour.
  await page.getByTestId("risk-tab-method").click();
  await page.getByTestId("risk-threshold").fill("100");
  await page.getByTestId("risk-trigger-change_control").check();
  await page.getByTestId("risk-next-review").fill("2027-05-01");
  await page.getByTestId("risk-review-save").click();
  await page.getByTestId("risk-review-date").fill("2026-10-27");
  await page.getByTestId("risk-review-trigger").selectOption("new_risk");
  await page.getByTestId("risk-review-note").fill("First review of the filter set-up row (fictional)");
  await page.getByTestId("risk-review-add").click();
  await expect(page.getByTestId("risk-review-history")).toContainText("RV-001");
  await expectAccessible(page, "method tab, light");
  await page.screenshot({ path: join(SHOTS, "tr-risk-method.png"), fullPage: true });

  await page.getByTestId("risk-tab-items").click();
  await expect(page.getByTestId("risk-threshold-flag-RA-001")).toContainText("Above the action threshold (100)");
  await expect(page.getByTestId("risk-accepted-RA-001")).toContainText("Not answered");
  await expect(page.getByTestId("risk-open-items")).toContainText("no recommended action");
  await page.screenshot({ path: join(SHOTS, "tr-risk-items.png"), fullPage: true });

  // The open item goes away once the team answers it.
  await page.getByTestId("risk-item-edit-RA-001").click();
  await page.getByTestId("item-accepted").selectOption("no");
  // The severity / confidence hint sits beside the sampling-point links; it is text only and ticks nothing.
  await expect(page.getByTestId("item-confidence-hint")).toContainText("high severity 99 %");
  await page.screenshot({ path: join(SHOTS, "tr-risk-form.png"), fullPage: true });
  await expectAccessible(page, "item form, light");
  await page.getByTestId("item-save").click();
  await expect(page.getByTestId("risk-accepted-RA-001")).toContainText("No");
  await expect(page.getByTestId("risk-open-items")).not.toContainText("risk accepted");

  // Dark mode and a phone: no sideways scrolling, still accessible.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 800 });
  await expectAccessible(page, "items tab, dark, phone");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: join(SHOTS, "tr-risk-phone-dark.png"), fullPage: true });
});

test("a plain FMEA starter shows none of the TR 44 extras", async ({ page }) => {
  await createBlank(page, "Plain FMEA (fictional)");
  await page.getByTestId("risk-loadout-fmea-1-10").click();
  await expect(page.getByTestId("risk-threshold")).toHaveCount(0);
  await page.getByTestId("risk-tab-items").click();
  await page.getByTestId("risk-add-mode").fill("Leak (fictional)");
  await page.getByTestId("risk-add-submit").click();
  await page.getByTestId("risk-item-edit-RA-001").click();
  await expect(page.getByTestId("item-accepted")).toHaveCount(0);
  await expect(page.getByTestId("item-intervention")).toHaveCount(0);
});
