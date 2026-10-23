// Milestone 9, server build: the TRD module gates the menu and the page, and a TRD is kept with the project on the server.
import { expect, go, loadDemo, makeSamplingInvite, newAccount, serverRevision, signUp, test } from "./helpers";

const DEMO_TITLE = "ARX-217 transfer: Site North Line 2 to Site South Line 4 (fictional demo)";

test("server build: an account without the TRD module has no menu entry, is told why, and the demo comes without a TRD", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("notrd"));
  await loadDemo(page);
  await expect(page.getByRole("link", { name: "TRD", exact: true })).toHaveCount(0);
  await go(page, "#/trd");
  await expect(page.getByTestId("trd-not-included")).toBeVisible();
  // The TRD seed page is part of the gap assessment and stays; it offers no way into the TRD module.
  await go(page, "#/trd-seed");
  await expect(page.getByTestId("trd-start-from-project")).toHaveCount(0);
  // The project the demo loaded holds no TRD, so saving it is allowed.
  await expect.poll(() => serverRevision(page, DEMO_TITLE)).toBeGreaterThan(0);
});

test("server build: with the module a TRD is made, overridden and kept on the server with the project", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("trd"), makeSamplingInvite());
  await loadDemo(page);
  await expect(page.getByRole("link", { name: "TRD", exact: true }).or(page.getByRole("button", { name: /menu/i }))).toBeVisible();
  await go(page, "#/trd");
  await expect(page.getByTestId("trd-list-table")).toContainText("TRD-001");
  const before = await serverRevision(page, DEMO_TITLE);

  await page.getByTestId("trd-title-input").fill("Server TRD (fictional)");
  await page.getByTestId("trd-start-project").check();
  await page.getByTestId("trd-create").click();
  await expect(page.getByTestId("trd-tabs")).toBeVisible();
  await page.getByTestId("trd-tab-open").click();
  await expect.poll(() => serverRevision(page, DEMO_TITLE)).toBeGreaterThan(before);

  // The TRD survives a reload from the server.
  await page.reload();
  await go(page, "#/trd");
  await expect(page.getByTestId("trd-list-table")).toContainText("Server TRD (fictional)");
});
