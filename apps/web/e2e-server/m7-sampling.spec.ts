// Milestone 7, server build: the sampling module gates the menu and the page, and company tables are kept on the server.
import { expect, go, loadDemo, makeSamplingInvite, newAccount, signUp, test } from "./helpers";

test("server build: an account without the sampling module has no menu entry and is told why", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("nosamp"));
  await loadDemo(page);
  await expect(page.getByRole("link", { name: "Sampling plan", exact: true })).toHaveCount(0);
  await go(page, "#/sampling");
  await expect(page.getByTestId("sampling-not-included")).toBeVisible();
  const r = await page.request.get("/api/sampling-tables");
  expect(r.status()).toBe(403);
});

test("server build: with the module the plan opens and a company table is stored on the server", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("samp"), makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/sampling");
  await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
  await expect(page.getByTestId("plan-list")).toContainText("ARX-217 PPQ sampling plan");

  await go(page, "#/sampling/tables");
  await page.getByTestId("table-new").click();
  await page.getByTestId("table-name").fill("QC-SERVER-TEST (fictional)");
  await page.getByTestId("table-version").fill("1.0");
  await page.getByTestId("table-add-row").click();
  await page.getByTestId("row-0-lotMin").fill("1");
  await page.getByTestId("row-0-lotMax").fill("1000");
  await page.getByTestId("row-0-sampleSize").fill("8");
  await page.getByTestId("table-save").click();
  await expect(page.getByTestId("tables-list")).toContainText("QC-SERVER-TEST");

  const list = (await (await page.request.get("/api/sampling-tables")).json()) as { tables: { name: string }[] };
  expect(list.tables.map((t) => t.name)).toContain("QC-SERVER-TEST (fictional)");

  await page.reload();
  await go(page, "#/sampling/tables");
  await expect(page.getByTestId("tables-list")).toContainText("QC-SERVER-TEST");
});
