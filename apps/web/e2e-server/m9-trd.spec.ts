// Milestone 9, server build: the TRD module gates the menu and the page, and a TRD is kept with the project on the server.
import { expectNoMenuEntry, goTo } from "../e2e/nav-helper";
import { expect, go, loadDemo, makeSamplingInvite, newAccount, serverRevision, signUp, test } from "./helpers";

const DEMO_TITLE = "ARX-217 transfer: Site North Line 2 to Site South Line 4 (fictional demo)";

test("server build: an account without the TRD module has no menu entry, is told why, and the demo comes without a TRD", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("notrd"));
  await loadDemo(page);
  await expectNoMenuEntry(page, "TRD");
  await go(page, "#/trd");
  await expect(page.getByTestId("trd-not-included")).toBeVisible();
  // The TRD seed page is part of the gap assessment and stays; it offers no way into the TRD module.
  await go(page, "#/trd-seed");
  await expect(page.getByTestId("trd-start-from-project")).toHaveCount(0);
  // The project the demo loaded holds no TRD, so saving it is allowed.
  await expect.poll(() => serverRevision(page, DEMO_TITLE)).toBeGreaterThan(0);
});

// EOU-41, EOU-42, EOU-43: a gap-only account is told the module is missing first (even with no project open), is given a way back, and Home
// does not talk about documents it cannot open.
test("server build: a gap-only account with no project open is told the TRD module is missing, can go back, and Home names no document it lacks", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("notrdhome"));
  await go(page, "#/trd");
  await expect(page.getByTestId("trd-not-included")).toContainText("This account does not include the TRD module. Ask the administrator to add it.");
  await expect(page.getByTestId("needs-project")).toHaveCount(0);
  await page.getByTestId("trd-not-included").getByRole("link", { name: "Back to Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Welcome to/ })).toBeVisible();
  for (const id of ["start-options", "home-chain"]) {
    const text = await page.getByTestId(id).innerText();
    expect(text, `${id} names a document this account does not have`).not.toMatch(/TRD|batch record|sampling plan|risk assessment/i);
  }
});

test("server build: with the module a TRD is made, overridden and kept on the server with the project", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("trd"), makeSamplingInvite());
  await loadDemo(page);
  await goTo(page, "TRD");
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
