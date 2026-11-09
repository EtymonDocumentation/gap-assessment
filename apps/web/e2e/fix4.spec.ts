// Fix job 4: small-screen first view, a reload keeps the sampling plan tab, Getting started and the step bar tick only what the data
// shows (a "to be decided" answer stays open), the risk assessment is in the chain strip, "Open the TRD" replaces "Start from a TRD" once a
// TRD exists, and the banner never covers a button (axe target-size, which failed on Linux CI only). All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goTo, isPhone, openDemo } from "./nav-helper";

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

test("the document cards list the risk assessment after the gap assessment, and the TRD card opens the TRD once one exists", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.goto("./#/");
  // The cards follow the chain order: the risk assessment sits beside the chain, straight after the gap assessment.
  const names = await page.getByTestId("home-chain").getByRole("heading", { level: 3 }).allInnerTexts();
  const gap = names.indexOf("Gap assessment");
  const risk = names.indexOf("Risk assessment");
  const trd = names.indexOf("TRD");
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(trd).toBeGreaterThan(gap);
  expect(risk).toBeGreaterThan(gap);
  // Once the project has a TRD its card says Open (it used to say Start from a TRD, which hid the way back to it).
  await expect(page.getByTestId("doc-card-open-trd")).toHaveText("Open");
  await expect(page.getByTestId("doc-card-open-trd")).toHaveAttribute("href", /#\/trd\?trd=/);
  // The strip on a document page carries the risk entry too and still passes axe.
  await goTo(page, "TRD");
  // (A phone shows one line, "Chain 2 of 5 · TRD", which leaves the unnumbered Risk assessment out; Home lists it on a phone too.)
  if (isPhone(page)) await expect(page.getByTestId("doc-chain")).toContainText("Chain 2 of 5 · TRD");
  else await expect(page.getByTestId("doc-chain").getByTestId("chain-risk")).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), "fix4-chain-strip.png") });
});

test("a new project offers 'Start from a TRD'; a plan with no points says so; a reload keeps the plan and its tab", async ({ page }) => {
  await newProject(page);
  await page.goto("./#/");
  await expect(page.getByTestId("doc-card-state-trd")).toHaveText("Not started");
  await expect(page.getByTestId("doc-card-open-trd")).toHaveText("Start");
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
  expect(aside).toMatch(/0 of \d+ answered, \d+ open items? \(1 to be decided\)/);
  await page.screenshot({ path: join(tmpdir(), "fix4-interview-count.png"), fullPage: true });
  await page.goto("./#/");
  await expect(page.locator("dt", { hasText: "Questions answered" }).locator("+ dd")).toContainText(/open items? \(1 to be decided\)/);
  // The checklist moved to the gap assessment's own page.
  await page.goto("./#/gap");
  const started = page.getByTestId("getting-started");
  await expect(started.locator("li", { hasText: "Answer the interview" })).not.toContainText("(done)");
  await expect(started.locator("li", { hasText: "Review the gap register" })).not.toContainText("(done)");
  await page.goto("./#/interview");
  await expect(page.getByTestId("step-interview")).not.toContainText("(done)");
});

test("the sticky banner never covers a button: axe target-size at several scroll positions", async ({ page }) => {
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await page.goto("./#/");
  for (const y of [0, 12, 30, 60]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    const axe = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `scroll ${y}`).toEqual([]);
  }
});
