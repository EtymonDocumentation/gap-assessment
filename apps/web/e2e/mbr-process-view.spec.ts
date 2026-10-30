// The Process view of a batch record: the equipment train, the moments slider, clocks against their limits, samples at their ports and
// the fluid-tracker findings. The demo record must work fully; a blank record must say "not enough data" and never guess. Fictional data only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function openDemoView(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await page.getByTestId("mbr-process-view-link").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoPageScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function goToMoment(page: Page, titlePart: RegExp) {
  const jump = page.getByTestId("pv-jump");
  const opt = jump.locator("option").filter({ hasText: titlePart }).first();
  await jump.selectOption({ value: (await opt.getAttribute("value"))! });
}

for (const [name, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`process view of the demo record: slider, hold clock, sample marker, findings: ${name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await openDemoView(page);
    await expect(page.getByTestId("pv-moment-title")).toContainText("Before the first step");
    await page.screenshot({ path: join(SHOTS, `procview-demo-start-${name}.png`), fullPage: name === "phone" });

    // The slider moves with the keyboard and the live region says where the product is.
    const slider = page.getByTestId("pv-slider");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("pv-moment-num")).toHaveText("2");
    await expect(page.getByTestId("pv-describe")).not.toBeEmpty();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("pv-moment-num")).toHaveText("1");

    // A sample marker is drawn on the train and a sample is listed at its moment.
    await expect(page.locator('[data-testid^="pv-mark-"]').first()).toBeVisible();

    // The split: the hold entries are moments, with the hold clock running next to its limit.
    await goToMoment(page, /Hold start/);
    await expect(page.getByTestId("pv-moment-title")).toContainText("Hold start");
    await expect(page.getByTestId("pv-panel-clocks")).toContainText(/limit/i);
    await expect(page.getByTestId("pv-panel-clocks").locator('[data-testid^="pv-clock-"]').first()).toBeVisible();
    if (name === "desktop") await page.screenshot({ path: join(SHOTS, "procview-demo-hold-desktop.png") });

    await goToMoment(page, /Aseptic filling/i);
    await expect(page.getByTestId("pv-moment-title")).toContainText(/Aseptic filling/i);
    if (name === "desktop") await page.screenshot({ path: join(SHOTS, "procview-demo-filling-desktop.png") });

    // Findings are listed with their rule and where they come from; every finding cites steps or rows.
    await expect(page.getByTestId("pv-findings")).toBeVisible();
    await expect(page.locator('[data-testid^="pv-finding-"]').first()).toBeVisible();
    await expect(page.getByTestId("pv-assumptions")).toBeVisible();
    await expect(page.getByTestId("pv-diagram")).toHaveAttribute("tabindex", "0");

    await expectNoPageScroll(page);
    await expectAccessible(page, `process view ${name}`);
    if (name === "phone") await page.screenshot({ path: join(SHOTS, "procview-demo-phone.png"), fullPage: false });
  });
}

test("process view in the dark theme stays readable and accessible", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openDemoView(page);
  await goToMoment(page, /Hold start/);
  await page.getByTestId("pv-diagram").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, "procview-demo-dark.png") });
  await expectAccessible(page, "process view dark");
});

test("a blank record says not enough data and does not guess", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-title-input").fill("Blank process view record (fictional)");
  await page.getByTestId("mbr-create").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
  await page.getByTestId("mbr-section-new").fill("Mystery step");
  await page.getByTestId("mbr-section-add").click();
  await page.getByTestId("mbr-process-view-link").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await expect(page.getByTestId("pv-page")).toContainText("Not enough data in the record");
  await expect(page.getByTestId("pv-missing")).toContainText("Not enough data in the record");
  // An unknown unit operation is a generic vessel, said in words.
  await expect(page.getByTestId("pv-page")).toContainText("generic");
  await page.screenshot({ path: join(SHOTS, "procview-blank.png"), fullPage: true });
  await expectNoPageScroll(page);
  await expectAccessible(page, "process view blank");
});
