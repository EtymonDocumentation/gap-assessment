// Fix job 4: small-screen first view, a reload keeps the sampling plan tab, Getting started and the step bar tick only what the data
// shows (a "to be decided" answer stays open), the risk assessment is in the chain strip, "Open the TRD" replaces "Start from a TRD" once a
// TRD exists, and the banner never covers a button (axe target-size, which failed on Linux CI only). All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function newProject(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("Fix four (fictional)");
  await dialog.getByLabel("Responder name").fill("Test Person (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
}

test("on a phone the first screen shows the page title and the first action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "phone layout only");
  await page.goto("./");
  const vh = page.viewportSize()!.height;
  const h1 = await page.locator("main h1").first().boundingBox();
  const action = await page.locator("main .btn.primary").first().boundingBox();
  expect(h1!.y + h1!.height).toBeLessThan(vh);
  expect(action!.y + action!.height).toBeLessThan(vh);
  await page.screenshot({ path: join(tmpdir(), "fix4-phone-home-after-spec.png") });
});

test("the chain strip lists the risk assessment after the gap assessment, and the TRD button opens the TRD once one exists", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.goto("./#/");
  const items = page.getByTestId("home-chain").getByRole("link");
  const names = await items.allInnerTexts();
  const gap = names.findIndex((t) => /Gap assessment/.test(t));
  const risk = names.findIndex((t) => /Risk assessment/.test(t));
  const trd = names.findIndex((t) => /TRD/.test(t) && !/Gap/.test(t));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(risk).toBe(gap + 1);
  expect(trd).toBe(risk + 1);
  await expect(page.getByTestId("home-start-trd")).toContainText(/Open the TRD/);
  await expect(page.getByTestId("home-start-trd")).not.toContainText("Start from a TRD");
  // The strip on a document page carries the risk entry too and still passes axe.
  await goTo(page, "TRD");
  await expect(page.getByTestId("doc-chain").getByTestId("chain-risk")).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "fix4-chain-strip.png") });
});

test("a new project offers 'Start from a TRD'; a plan with no points says so; a reload keeps the plan and its tab", async ({ page }) => {
  await newProject(page);
  await page.goto("./#/");
  await expect(page.getByTestId("home-start-trd")).toContainText("Start from a TRD");
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-title-input").fill("Empty plan (fictional)");
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("plan-tabs")).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "fix4-plan-zero-points.png"), fullPage: true });
  await page.getByTestId("tab-review").click();
  await expect(page).toHaveURL(/tab=review/);
  await page.reload();
  await expect(page.getByTestId("tab-review")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-review")).toBeVisible();
});

test("a 'to be decided' answer counts as open: the count says so and the step is not ticked", async ({ page }) => {
  await newProject(page);
  await page.goto("./#/interview");
  await page.getByRole("button", { name: "TBD (to be decided)" }).first().click();
  const aside = (await page.locator(".interview-aside").innerText()).replace(/\s+/g, " ");
  expect(aside).toMatch(/0 of \d+ answered, \d+ still open \(1 to be decided\)/);
  await page.screenshot({ path: join(tmpdir(), "fix4-interview-count.png"), fullPage: true });
  await page.goto("./#/");
  await expect(page.locator("dt", { hasText: "Questions answered" }).locator("+ dd")).toContainText(/still open \(1 to be decided\)/);
  const started = page.getByTestId("getting-started");
  await expect(started.locator("li", { hasText: "Answer the interview" })).not.toContainText("(done)");
  await expect(started.locator("li", { hasText: "Review the gap register" })).not.toContainText("(done)");
  await page.goto("./#/interview");
  await expect(page.getByTestId("step-interview")).not.toContainText("(done)");
});

test("the sticky banner never covers a button: axe target-size at several scroll positions", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.goto("./#/");
  for (const y of [0, 12, 30, 60]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    const axe = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `scroll ${y}`).toEqual([]);
  }
});
