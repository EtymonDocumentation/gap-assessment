// Milestone 7, server build: the sampling module gates the menu and the page, and company tables are kept on the server.
import { execFileSync } from "node:child_process";
import { expectNoMenuEntry } from "../e2e/nav-helper";
import { expect, go, loadDemo, makeSamplingInvite, newAccount, signUp, test } from "./helpers";

test("server build: an account without the sampling module has no menu entry and is told why", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("nosamp"));
  await loadDemo(page);
  await expectNoMenuEntry(page, "Sampling plan");
  await go(page, "#/sampling");
  await expect(page.getByTestId("sampling-not-included")).toBeVisible();
  const r = await page.request.get("/api/sampling-tables");
  expect(r.status()).toBe(403);
  // The Plan subsections library is gated the same way.
  expect((await page.request.get("/api/subsections")).status()).toBe(403);
  await go(page, "#/sampling/subsections");
  await expect(page.getByTestId("sampling-not-included")).toBeVisible();
  // So is the Expected studies list.
  expect((await page.request.get("/api/expected-studies")).status()).toBe(403);
  await go(page, "#/sampling/expected");
  await expect(page.getByTestId("sampling-not-included")).toBeVisible();
});

test("server build: the Expected studies list is saved per account on the server and survives a reload", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("sampexp"), makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/sampling/expected");
  await expect(page.getByRole("heading", { level: 1, name: "Expected studies" })).toBeVisible();
  await expect(page.getByTestId("exp-current")).toContainText("the shipped list");
  await page.locator('[data-testid^="exp-tick-"]:not(:checked)').first().check();
  await page.getByTestId("exp-reason").fill("Server test (fictional)");
  await page.getByTestId("exp-save").click();
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
  const body = (await (await page.request.get("/api/expected-studies")).json()) as { doc: { versions: { reason: string }[] } };
  expect(body.doc.versions[0]!.reason).toBe("Server test (fictional)");
  await page.reload();
  await expect(page.getByTestId("exp-current")).toContainText("version 1");
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

test("server build: the Plan subsections library is stored on the server, with the demo item seeded", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("sampsub"), makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/sampling/subsections");
  await expect(page.getByRole("heading", { level: 1, name: "Subsection library" })).toBeVisible();
  await page.getByTestId("lib-new-name").fill("Server library item (fictional)");
  await page.getByTestId("lib-new-version").fill("1");
  await page.getByTestId("lib-add").click();
  await expect(page.getByTestId("lib-item-Server library item (fictional)")).toBeVisible();

  const list = (await (await page.request.get("/api/subsections")).json()) as { items: { name: string }[] };
  expect(list.items.map((t) => t.name)).toContain("Server library item (fictional)");
  expect(list.items.length).toBeGreaterThanOrEqual(2);

  await page.reload();
  await go(page, "#/sampling/subsections");
  await expect(page.getByTestId("lib-item-Server library item (fictional)")).toBeVisible();
});

test("server build: a module taken away while signed in leaves the menus at once, without a reload", async ({ page }) => {
  test.setTimeout(150_000);
  const account = newAccount("sampgone");
  await signUp(page, account, makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/sampling");
  await expect(page.getByRole("heading", { level: 1, name: "Sampling plan" })).toBeVisible();
  // The administrator removes the module while the person is signed in (the admin tool and the server share the account file safely).
  execFileSync(process.execPath, [process.env.GAP_E2E_ADMIN!, "set-modules", account.username, "gap", "--data", process.env.GAP_E2E_DATA_SERVER!], { stdio: "pipe" });
  // The next call the page makes is refused (saving a table asks the server; the lists already on screen do not); the page then
  // asks for the account again and the menus follow.
  await go(page, "#/sampling/tables");
  await page.getByTestId("table-new").click();
  await page.getByTestId("table-name").fill("QC-GONE-TEST (fictional)");
  await page.getByTestId("table-version").fill("1.0");
  await page.getByTestId("table-add-row").click();
  await page.getByTestId("row-0-lotMin").fill("1");
  await page.getByTestId("row-0-lotMax").fill("1000");
  await page.getByTestId("row-0-sampleSize").fill("8");
  await page.getByTestId("table-save").click();
  await expect(page.getByTestId("sampling-not-included")).toBeVisible({ timeout: 20_000 });
  await expectNoMenuEntry(page, "Sampling plan");
});
