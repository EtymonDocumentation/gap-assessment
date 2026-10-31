// Layout job 2: real tabs on the batch record, TRD and risk assessment, the "?" help tips, the "What this is" cards and the sampling
// plan Contents list. Keyboard behaviour, deep links, phone width and axe. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `layout2-${name}.png`) });
const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

async function expectNoSidewaysScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `${label}: page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`), label).toEqual([]);
}

async function openSyringe(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByTestId("home-chain")).toBeVisible();
}

/** Opens the first document of a module from its list page (the list links carry the id in the address). */
async function openFirst(page: Page, list: string, param: string) {
  await hash(page, `#${list}`);
  await page.locator(`main a[href*="${param}="]`).first().click();
}

test("batch record tabs: roles, arrow keys, deep link to the Process view tab, Back button", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/mbr?mbr=MBR-001");
  const tablist = page.getByRole("tablist", { name: "Batch record views" });
  await expect(tablist.getByRole("tab")).toHaveText(["Edit", "Process view", "Word document"]);
  const edit = tablist.getByRole("tab", { name: "Edit" });
  const view = tablist.getByRole("tab", { name: "Process view" });
  const word = tablist.getByRole("tab", { name: "Word document" });
  await expect(edit).toHaveAttribute("aria-selected", "true");
  await expect(view).toHaveAttribute("aria-selected", "false");
  await expect(view).toHaveAttribute("tabindex", "-1");
  // The panel is the one the selected tab controls, and each tab says what it is for.
  const panelId = await edit.getAttribute("aria-controls");
  await expect(page.locator(`#${panelId}`)).toHaveAttribute("role", "tabpanel");
  await expect(page.getByTestId("tab-purpose")).toContainText("Write the batch record");
  await shot(page, "mbr-edit-" + test.info().project.name);

  // Arrow keys move focus (and wrap); Enter or Space opens the tab, so the history is not filled by arrow presses.
  await edit.focus();
  await page.keyboard.press("ArrowRight");
  await expect(view).toBeFocused();
  await expect(edit).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(word).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(edit).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(word).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/mbr\/view\?mbr=MBR-001/);
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Process view" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-purpose")).toContainText("The batch record drawn as an equipment train; follow the fluid step by step.");
  await shot(page, "mbr-view-" + test.info().project.name);
  await expectNoSidewaysScroll(page, "process view tab");

  await page.getByRole("tab", { name: "Word document" }).click();
  await expect(page).toHaveURL(/tab=word/);
  await expect(page.getByTestId("mbr-output")).toBeVisible();
  await expect(page.getByTestId("tab-purpose")).toContainText("Download the batch record");
  await shot(page, "mbr-word-" + test.info().project.name);
  await expectNoSidewaysScroll(page, "word tab");
  await expectAccessible(page, "word tab");

  // The browser Back button returns to the Process view tab, then to the Edit tab.
  await page.goBack();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("mbr-output")).toHaveCount(0);
});

test("an old Process view address and a Word deep link open the right tab", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/mbr/view?mbr=MBR-001");
  await expect(page.getByRole("tab", { name: "Process view" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
  await expectAccessible(page, "process view tab");
  await hash(page, "#/mbr?mbr=MBR-001&tab=word");
  await expect(page.getByRole("tab", { name: "Word document" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("mbr-output")).toBeVisible();
});

test("TRD tabs: real tabs with a purpose line, arrow keys switch panels, tab=output deep link, open-items count kept", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/trd?trd=TRD-001");
  const tablist = page.getByRole("tablist", { name: "TRD steps" });
  await expect(tablist.getByRole("tab")).toHaveCount(5);
  const details = page.getByTestId("trd-tab-details");
  await expect(details).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-purpose")).toContainText("Name the TRD");
  await shot(page, "trd-details-" + test.info().project.name);
  await details.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("trd-tab-process")).toBeFocused();
  await expect(page.getByTestId("trd-tab-process")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-purpose")).toContainText("process steps and their parameters");
  await shot(page, "trd-process-" + test.info().project.name);
  await expect(page.getByTestId("trd-tab-open")).toContainText(/4\. Open items \(\d+\)/);
  await page.getByTestId("trd-tab-open").click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await hash(page, "#/trd?trd=TRD-001&tab=output");
  await expect(page.getByTestId("trd-tab-output")).toHaveAttribute("aria-selected", "true");
  await expectNoSidewaysScroll(page, "trd output tab");
  await expectAccessible(page, "trd tabs");
});

test("risk assessment tabs: four real tabs with a purpose each", async ({ page }) => {
  await openSyringe(page);
  await openFirst(page, "/risk", "ra");
  const tablist = page.getByRole("tablist", { name: "Assessment steps" });
  await expect(tablist.getByRole("tab")).toHaveCount(4);
  await expect(page.getByTestId("risk-tab-method")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-purpose")).toContainText("Choose how risks are scored");
  await shot(page, "risk-method-" + test.info().project.name);
  await page.getByTestId("risk-tab-method").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("risk-tab-output")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-purpose")).toContainText("download the risk assessment");
  await shot(page, "risk-output-" + test.info().project.name);
  await expectNoSidewaysScroll(page, "risk tabs");
  await expectAccessible(page, "risk tabs");
});

test("sampling plan: a Contents list jumps to sections, also on another tab", async ({ page }) => {
  await openSyringe(page);
  await openFirst(page, "/sampling", "plan");
  const contents = page.getByTestId("plan-contents");
  await expect(contents).toBeVisible();
  await shot(page, "sampling-contents-" + test.info().project.name);
  const url = page.url();
  await contents.getByRole("button", { name: "Sampling points" }).click();
  await expect(page.locator("#sp-points")).toBeFocused();
  await expect(page.locator("#sp-points")).toBeInViewport();
  expect(page.url(), "a Contents jump does not change the route").toBe(url);
  await page.getByTestId("tab-subsections").click();
  await contents.getByRole("button", { name: "Agency requests" }).click();
  await expect(page.getByTestId("tab-interview")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sp-agency")).toBeFocused();
  await expectNoSidewaysScroll(page, "sampling contents");
  await expectAccessible(page, "sampling contents");
});

test("HelpTip: opens by click and by Enter, closes by Escape and by an outside click, stays on screen", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/mbr?mbr=MBR-001&tab=word");
  const tip = page.getByRole("button", { name: "Help: the HTML export" });
  await expect(tip).toHaveAttribute("aria-expanded", "false");
  await tip.click();
  await expect(tip).toHaveAttribute("aria-expanded", "true");
  const pop = page.getByTestId("help-tip-pop");
  await expect(pop).toBeVisible();
  expect(await tip.getAttribute("aria-controls")).toBe(await pop.getAttribute("id"));
  await expect(pop).toContainText("web page");
  const box = (await pop.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x, "popover inside the viewport (left)").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "popover inside the viewport (right)").toBeLessThanOrEqual(vw);
  await shot(page, "helptip-open-" + test.info().project.name);
  await expectNoSidewaysScroll(page, "help tip open");
  await expectAccessible(page, "help tip open");

  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(tip).toBeFocused();

  await tip.focus();
  await page.keyboard.press("Enter");
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(pop).toBeVisible();

  // Tapping elsewhere closes it; tapping the button again toggles it.
  await page.getByRole("heading", { level: 1 }).click();
  await expect(pop).toHaveCount(0);
  await tip.click();
  await tip.click();
  await expect(pop).toHaveCount(0);
});

test("HelpTip at the edge of a phone screen stays inside the viewport", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "phone only");
  await openSyringe(page);
  await hash(page, "#/trd?trd=TRD-001");
  // The tab purpose "?" sits at the end of a line; its popover must be clamped, whatever the line length.
  await page.getByRole("button", { name: /^Help: 1\. Details$/ }).click();
  const box = (await page.getByTestId("help-tip-pop").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expectNoSidewaysScroll(page, "help tip on a phone");
});

test("What this is: open the first time, hide it, and the choice is remembered in this browser", async ({ page }) => {
  await openSyringe(page);
  await hash(page, "#/mbr?mbr=MBR-001");
  const card = page.getByTestId("whatis-mbr");
  await expect(card).toContainText("master batch record");
  await shot(page, "whatis-" + test.info().project.name);
  const toggle = page.getByTestId("whatis-mbr-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.getByText("A master batch record is the step-by-step")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("whatis-mbr-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("whatis-mbr-toggle").click();
  await expect(page.getByTestId("whatis-mbr")).toContainText("master batch record");
  // Each document kind keeps its own choice.
  await hash(page, "#/trd?trd=TRD-001");
  await expect(page.getByTestId("whatis-trd-toggle")).toHaveAttribute("aria-expanded", "true");
  await expectAccessible(page, "what this is");
});

test("What this is works with browser storage blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await openSyringe(page);
  await hash(page, "#/mbr?mbr=MBR-001");
  await expect(page.getByTestId("whatis-mbr-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("whatis-mbr-toggle").click();
  await expect(page.getByTestId("whatis-mbr-toggle")).toHaveAttribute("aria-expanded", "false");
});
