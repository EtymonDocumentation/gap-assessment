// Milestone 11, server build: the batch record module gates the menu, the page and the step-blocks library page, and a batch record is
// kept with the project on the server.
import { expect, go, loadDemo, makeSamplingInvite, newAccount, serverRevision, signUp, test } from "./helpers";

const DEMO_TITLE = "ARX-217 transfer: Site North Line 2 to Site South Line 4 (fictional demo)";

test("server build: an account without the batch record module has no menu entry, is told why, and the demo comes without one", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("nombr"));
  await loadDemo(page);
  await expect(page.getByRole("link", { name: "Batch record", exact: true })).toHaveCount(0);
  await go(page, "#/mbr");
  await expect(page.getByTestId("mbr-not-included")).toBeVisible();
  await go(page, "#/mbr/library");
  await expect(page.getByTestId("mbr-not-included")).toBeVisible();
  // The project the demo loaded holds no batch record, so saving it is allowed.
  await expect.poll(() => serverRevision(page, DEMO_TITLE)).toBeGreaterThan(0);
});

test("server build: with the module a batch record is shown, edited and kept on the server with the project", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("mbr"), makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/mbr");
  await expect(page.getByTestId("mbr-list-table")).toContainText("MBR-001");
  const before = await serverRevision(page, DEMO_TITLE);

  await page.getByTestId("mbr-title-input").fill("Server batch record (fictional)");
  await page.getByTestId("mbr-create").click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-002/ })).toBeVisible();
  await expect.poll(() => serverRevision(page, DEMO_TITLE)).toBeGreaterThan(before);

  // The record survives a reload from the server.
  await page.reload();
  await go(page, "#/mbr");
  await expect(page.getByTestId("mbr-list-table")).toContainText("Server batch record (fictional)");

  // An edit of a library block is kept on the server for the account.
  await go(page, "#/mbr/library");
  await page.getByTestId("mbl-edit-pooling_with_weights").click();
  await page.getByTestId("mbl-steps").fill("Only step (fictional).");
  await page.getByTestId("mbl-save").click();
  await expect(page.getByTestId("mbl-message")).toContainText("version 3");
  await page.reload();
  await go(page, "#/mbr/library");
  await expect(page.getByTestId("mbl-row-pooling_with_weights")).toContainText("Shipped, edited by you");
});

test("server build: the syringe example opens with its batch record, and the server keeps it with the project", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("mbrsyr"), makeSamplingInvite());
  await go(page, "#/");
  await page.getByRole("button", { name: "Open syringe example" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
  await go(page, "#/mbr");
  await expect(page.getByTestId("mbr-list-table")).toContainText("SYR-305 master batch record");
  await expect.poll(() => serverRevision(page, "SYR-305 technology transfer: Example Biologics to Example Fill Site (fictional demo)")).toBeGreaterThan(0);
});
