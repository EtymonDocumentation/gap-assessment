import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

test("dilution = No removes the Buffer preparation section from the progress map, and Yes brings it back", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview");
  const map = page.getByRole("navigation", { name: "Sections" });
  await expect(map.getByRole("link", { name: /^Buffer preparation/ })).toBeVisible();
  await expect(map.getByRole("link", { name: /^Bioburden reduction \(BBR\) filtration/ })).toBeVisible();
  await expect(map.getByRole("link", { name: /^Sterile filtration/ })).toBeVisible();

  await go(page, "#/interview?q=scope.dilution%40shared");
  await expect(page.locator("#q-prompt")).toHaveText("Does the program involve dilution or formulation with a buffer or diluent?");
  await page.locator(".question-card .choice-chip", { hasText: "No" }).first().click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(map.getByRole("link", { name: /^Buffer preparation/ })).toHaveCount(0);
  await expect(map.getByRole("link", { name: /^Bioburden reduction \(BBR\) filtration/ })).toBeVisible();

  await go(page, "#/interview?q=scope.dilution%40shared");
  await page.locator(".question-card .choice-chip", { hasText: "Yes" }).first().click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(map.getByRole("link", { name: /^Buffer preparation/ })).toBeVisible();
});

test("the PUPSIT card shows the SU and RU answers and its follow-ups", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=filt.pupsit%40source");
  await expect(page.locator("#q-prompt")).toHaveText(/pre-use post-sterilization integrity test \(PUPSIT\)/);
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  // The demo performs PUPSIT at the SU, so the SU follow-ups exist.
  await go(page, "#/interview?q=filt.pupsit_method%40source");
  await expect(page.locator(".question-card")).toBeVisible();
});

test("plunger stopper position: the questions appear in Aseptic filling when the presentation is a prefilled syringe", async ({ page }) => {
  await loadDemo(page);
  // The demo is a vial product: the questions are not part of its Aseptic filling section.
  await go(page, "#/interview?q=fill.stopper_method%40source");
  await expect(page.getByText("How is the plunger stopper placed in the syringe or cartridge?")).toHaveCount(0);
  await go(page, "#/interview?q=scope.presentation%40shared");
  await expect(page.locator("#q-prompt")).toHaveText("What is the primary container presentation?");
  await page.locator(".question-card .choice-chip", { hasText: "Prefilled syringe" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await go(page, "#/interview?q=fill.stopper_method%40source");
  await expect(page.locator("#q-prompt")).toHaveText("How is the plunger stopper placed in the syringe or cartridge?");
  await expect(page.locator("fieldset.side-panel")).toHaveCount(2);
  await go(page, "#/interview?q=fill.stopper_position%40source");
  await expect(page.locator("#q-prompt")).toHaveText(/Target plunger stopper position/);
  await go(page, "#/interview?q=fill.headspace%40source");
  await expect(page.locator("#q-prompt")).toHaveText(/headspace or air bubble size/);
});
