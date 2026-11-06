// Sampling plan "Design review" tab: questions, three-way answers, "look again", switching a check off, the A5 equipment card, the
// Overview line and the chain strip. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, isPhone, openDemo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openReview(page: Page, demo: "arx" | "syr" = "arx") {
  await page.goto("./");
  await openDemo(page, demo, "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n"), label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

test("the Overview line counts the questions and opens the tab; the chain strip shows the open count", async ({ page }) => {
  test.setTimeout(90000);
  await openReview(page);
  const line = page.getByTestId("review-line");
  await expect(line).toContainText(/\d+ design review questions? not answered yet/);
  // The wide strip carries each stage's status; a phone shows one line ("Chain 3 of 5 · Sampling plan") and the Overview line above has the count.
  if (isPhone(page)) await expect(page.getByTestId("doc-chain")).toContainText("Chain 3 of 5 · Sampling plan");
  else await expect(page.getByTestId("doc-chain")).toContainText(/design review questions? not answered yet/);
  await page.screenshot({ path: join(SHOTS, `m11-j1-overview-line-${test.info().project.name}.png`) });
  await page.getByTestId("review-line-open").click();
  await expect(page.getByTestId("design-review")).toBeVisible();
  await expect(page.getByTestId("tab-review")).toHaveAttribute("aria-pressed", "true");
});

test("a question is answered, kept with who and when, goes to 'look again' when the plan changes, and can be switched off and on", async ({ page }) => {
  test.setTimeout(120000);
  await openReview(page);
  const name = test.info().project.name;
  await page.getByTestId("tab-review").click();
  const cards = page.locator('[data-testid^="review-card-"]');
  await expect(cards.first()).toBeVisible();
  // Group headings are in plain words.
  await expect(page.getByTestId("review-group-A")).toContainText("How the samples are taken");
  await expect(page.getByTestId("review-group-B")).toContainText("Where the samples sit");
  await page.screenshot({ path: join(SHOTS, `m11-j1-tab-${name}.png`), fullPage: true });
  await expectAccessible(page, "design review tab");
  await expectNoHorizontalScroll(page, "design review tab");

  // Answer the first unanswered card that is not the A5 plan question (the demo already carries a few fictional answers).
  const firstOpen = page.locator('[data-testid^="review-card-"][data-state="unanswered"]:not([data-testid="review-card-A5:plan"])').first();
  const testId = (await firstOpen.getAttribute("data-testid"))!;
  const key = testId.replace("review-card-", "");
  const card = page.getByTestId(testId); // pinned: the unanswered filter above stops matching once it is answered
  const before = await page.getByTestId("review-summary").innerText();
  await card.getByTestId(`review-reason-${key}`).fill("Checked with the sampling lead (fictional)");
  await card.getByTestId(`review-confirmed-${key}`).click();
  await expect(card).toHaveAttribute("data-state", "answered");
  await expect(card.getByTestId(`review-state-${key}`)).toHaveText("Answered");
  await expect(card.getByTestId(`review-by-${key}`)).toContainText("Confirmed as designed");
  await expect(card.getByTestId(`review-confirmed-${key}`)).toHaveAttribute("aria-pressed", "true");
  expect(await page.getByTestId("review-summary").innerText()).not.toBe(before);
  await page.screenshot({ path: join(SHOTS, `m11-j1-answered-${name}.png`), fullPage: true });
  // The answer survives a reload of the page's data (it is stored in the plan).
  await page.getByTestId("tab-overview").click();
  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId(testId)).toHaveAttribute("data-state", "answered");

  // Switch the check off with a reason: the card leaves, a collapsed list keeps it, and "Switch on" brings it back.
  const checkId = key.split(":")[0]!;
  const another = page.locator(`[data-testid^="review-card-${checkId}:"]`).first();
  const offKey = (await another.getAttribute("data-testid"))!.replace("review-card-", "");
  await another.getByTestId(`review-off-open-${offKey}`).click();
  await another.getByTestId(`review-off-reason-${offKey}`).fill("Covered by our site procedure (fictional)");
  await another.getByTestId(`review-off-confirm-${offKey}`).click();
  await expect(page.locator(`[data-testid^="review-card-${checkId}:"]`)).toHaveCount(0);
  const off = page.getByTestId("review-off");
  await expect(off).toContainText(`${checkId}`);
  await off.locator("summary").click();
  await expect(page.getByTestId(`review-off-${checkId}`)).toContainText("Covered by our site procedure (fictional)");
  await page.getByTestId(`review-on-${checkId}`).click();
  await expect(page.locator(`[data-testid^="review-card-${checkId}:"]`).first()).toBeVisible();
});

test("changing the plan after an answer marks the card 'look again'", async ({ page }) => {
  test.setTimeout(120000);
  await openReview(page);
  await page.getByTestId("tab-review").click();
  // A4 reads what was said about a part added only for the study; answer it, then answer one of those follow-ups and look again.
  const a1 = page.locator('[data-testid^="review-card-A4:"]').first();
  await expect(a1).toBeVisible();
  const testId = (await a1.getAttribute("data-testid"))!;
  const key = testId.replace("review-card-", "");
  const sample = key.split(":")[1]!;
  await a1.getByTestId(`review-not_applicable-${key}`).click();
  await expect(a1).toHaveAttribute("data-state", "answered");
  // Open the sample from the card (switches to the interview tab with that sample open).
  await a1.getByRole("button", { name: `Open sample ${sample}` }).click();
  await expect(page.getByTestId("tab-interview")).toHaveAttribute("aria-pressed", "true");
  // Say the part is in the commercial assembly (a fact the question reads), then come back.
  const section = page.getByTestId("point-howtaken").first();
  await expect(section).toBeVisible();
  await section.locator("summary").click();
  const wasChecked = await page.getByTestId("method-added-commercial-yes").isChecked();
  await page.getByTestId(wasChecked ? "method-added-commercial-no" : "method-added-commercial-yes").check();
  await page.getByTestId("point-save").first().click();
  await page.getByTestId("tab-review").click();
  const card = page.getByTestId(testId);
  await expect(card).toHaveAttribute("data-state", "look_again");
  await expect(card.locator(".notice")).toContainText("Look again");
  await expect(card.getByTestId(`review-state-${key}`)).toHaveText("Look again");
  await page.screenshot({ path: join(SHOTS, `m11-j1-lookagain-${test.info().project.name}.png`), fullPage: true });
  // Answering again clears the notice.
  await card.getByTestId(`review-confirmed-${key}`).click();
  await expect(card).toHaveAttribute("data-state", "answered");
});

test("nothing in the Design review starts selected, and an answer can be taken back", async ({ page }) => {
  test.setTimeout(120000);
  await openReview(page);
  await page.getByTestId("tab-review").click();
  const review = page.getByTestId("design-review");
  await expect(review).toBeVisible();
  // No preselected answer on an unanswered card: no ticked radio or checkbox, no pressed answer button, and no "Not stated" radio at all (answered demo cards show their own answer).
  await expect(review.locator("input:checked")).toHaveCount(0);
  await expect(review.locator('[data-state="unanswered"] button[aria-pressed=true]')).toHaveCount(0);
  await expect(review.locator('[data-state="answered"] button[aria-pressed=true]')).not.toHaveCount(0);
  await expect(review.locator("input[type=radio]")).toHaveCount(2);
  await expect(review.getByTestId("review-eq-used-unset")).toHaveCount(0);
  await page.screenshot({ path: join(SHOTS, `fix2-design-review-${test.info().project.name}.png`), fullPage: true });
  await review.getByTestId("review-eq-used-no").check();
  await expect(review.getByTestId("review-eq-used-no")).toBeChecked();
  await review.getByTestId("review-eq-used-unset").click();
  await expect(review.locator("input:checked")).toHaveCount(0);
});

test("the A5 card records equipment used only for the study", async ({ page }) => {
  test.setTimeout(120000);
  await openReview(page);
  const name = test.info().project.name;
  await page.getByTestId("tab-review").click();
  const eq = page.getByTestId("review-equipment");
  await expect(eq).toBeVisible();
  await eq.getByTestId("review-eq-used-yes").check();
  await eq.getByTestId("review-eq-add").click();
  const item = eq.getByTestId("review-eq-EQ-01");
  await expect(item).toBeVisible();
  await item.getByTestId("review-eq-what-EQ-01").fill("Extra sampling manifold (fictional)");
  await item.getByTestId("review-eq-what-EQ-01").blur();
  await item.getByTestId("review-eq-qual-EQ-01").selectOption("no");
  await item.getByTestId("review-eq-removed-EQ-01").selectOption("yes");
  await expect(item.getByTestId("review-eq-qual-EQ-01")).toHaveValue("no");
  await page.screenshot({ path: join(SHOTS, `m11-j1-a5-${name}.png`), fullPage: true });
  await expectAccessible(page, "A5 card");
  await expectNoHorizontalScroll(page, "A5 card");
  // The A5 card is the first thing in group A.
  const firstInA = page.getByTestId("review-group-A").locator("> *").nth(1);
  await expect(firstInA).toHaveAttribute("data-testid", "review-equipment");
});

test("the tab is reachable and readable at phone width in dark mode", async ({ page }) => {
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page);
  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId("design-review")).toBeVisible();
  await expectNoHorizontalScroll(page, "design review at 390");
  await expectAccessible(page, "design review dark");
  await page.screenshot({ path: join(SHOTS, `m11-j1-phone-dark-${test.info().project.name}.png`), fullPage: true });
});

// ---- M11 job 2: group C, the percent field, the plan appendix, the Process view Coverage group, the "PPQ only" line.
for (const [scheme, size, label] of [
  ["light", { width: 1280, height: 900 }, "desktop"],
  ["dark", { width: 1280, height: 900 }, "desktop"],
  ["light", { width: 390, height: 844 }, "phone"],
  ["dark", { width: 390, height: 844 }, "phone"],
] as const) {
  test(`group C on the SYR-305 demo shows the volume question: ${label} ${scheme}`, async ({ page }) => {
    test.setTimeout(150000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(size);
    await openReview(page, "syr");
    await page.getByTestId("tab-review").click();
    const group = page.getByTestId("review-group-C");
    await expect(group).toContainText("How much is taken, and in what order");
    const card = group.getByTestId("review-card-C1:plan");
    await expect(card).toBeVisible();
    await expect(card).toContainText("PPQ");
    // The demo team already confirmed C1: the card shows the answer, not a preselected one on a fresh question.
    await expect(card).toHaveAttribute("data-state", "answered");
    await expectNoHorizontalScroll(page, `group C ${label} ${scheme}`);
    await expectAccessible(page, `group C ${label} ${scheme}`);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `m11-j2-groupC-${label}-${scheme}-${test.info().project.name}.png`), fullPage: true });
  });
}

test("the C1 card has an optional percent field: blank shows the numbers, a value flags only above it, a bad value says why", async ({ page }) => {
  test.setTimeout(150000);
  await openReview(page, "syr");
  await page.getByTestId("tab-review").click();
  const field = page.getByTestId("review-volume-percent");
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("review-card-C1:plan")).toBeVisible();
  // A value that is not above 0 says why and stores nothing.
  await field.fill("0");
  await field.blur();
  await expect(page.getByRole("alert").filter({ hasText: /above 0/ })).toBeVisible();
  // 5 % is below the demo's 7.7 %: the card stays and the old answer reads "look again" because the facts changed.
  await field.fill("5");
  await field.blur();
  await expect(page.getByTestId("review-card-C1:plan")).toHaveAttribute("data-state", "look_again");
  await expect(page.getByTestId("review-card-C1:plan")).toContainText("flagged above 5 %");
  await page.screenshot({ path: join(SHOTS, `m11-j2-c1-percent-${test.info().project.name}.png`), fullPage: true });
  await expectAccessible(page, "C1 with a percent");
  // 20 % is above the demo's share: the question goes quiet, and the field stays so it can be cleared.
  await field.fill("20");
  await field.blur();
  await expect(page.getByTestId("review-card-C1:plan")).toHaveCount(0);
  await expect(page.getByTestId("review-volume-percent")).toHaveValue("20");
  await page.getByTestId("review-volume-percent").fill("");
  await page.getByTestId("review-volume-percent").blur();
  await expect(page.getByTestId("review-card-C1:plan")).toBeVisible();
});

test("the plan document has the Design review appendix and the study-only equipment", async ({ page }) => {
  test.setTimeout(150000);
  await openReview(page, "syr");
  await page.getByTestId("sampling-preview-toggle").click();
  const preview = page.getByTestId("sampling-preview");
  await expect(preview).toContainText("Design review");
  await expect(preview).toContainText("Not answered yet");
  await expect(preview).toContainText("Checks switched off for this plan");
  await expect(preview).toContainText("Equipment used only for sampling");
  await expect(preview).toContainText("Single-use tubing set with sterile bottles");
});

test("the Process view shows the Coverage group, and the batch record preview carries the PPQ only line", async ({ page }) => {
  test.setTimeout(150000);
  await page.goto("./");
  await openDemo(page, "syr");
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await page.getByTestId("mbr-tab-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  const findings = page.getByTestId("pv-findings");
  await findings.scrollIntoViewIfNeeded();
  await expect(findings).toContainText("Coverage");
  await expect(findings).toContainText(/Drug substance shipping/);
  await expectAccessible(page, "process view with Coverage");
  await expectNoHorizontalScroll(page, "process view with Coverage");
  await findings.screenshot({ path: join(SHOTS, `m11-j2-coverage-${test.info().project.name}.png`) });
  await page.getByTestId("mbr-tab-word").click();
  await page.getByTestId("mbr-preview-toggle").click();
  const preview = page.getByTestId("mbr-preview");
  await expect(preview).toContainText("PPQ only: Small peristaltic pump");
  await preview.getByText("PPQ only: Small peristaltic pump").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, `m11-j2-ppq-only-${test.info().project.name}.png`) });
});
