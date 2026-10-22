// Milestone 8 follow-up, server build: a method of the risk library is edited, saved as a new version and kept on the server with
// its history; an assessment that uses it is told about the newer version. The "risk" module is still required.
import { expect, go, loadDemo, makeSamplingInvite, newAccount, signUp, test } from "./helpers";

test("server build: a library method is edited into a new version on the server, and an assessment is told about it", async ({ page }) => {
  test.setTimeout(150_000);
  // The sampling invites of the test setup also include the risk module.
  await signUp(page, newAccount("riskm"), makeSamplingInvite());
  await loadDemo(page);
  await go(page, "#/risk/methods");
  await page.getByTestId("method-new").click();
  await page.getByTestId("lib-loadout-fmea-1-5").click();
  await page.getByTestId("method-name").fill("QRM-SERVER-TEST (fictional)");
  await page.getByTestId("method-version").fill("1");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 1");

  await page.getByTestId("scale-Severity-max").fill("10");
  await page.getByTestId("method-version").fill("2");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 2");

  const list = (await (await page.request.get("/api/risk-methods")).json()) as { methods: { name: string; version: string; history: { action: string }[]; config: { severity: { max: number } } }[] };
  const m = list.methods.find((x) => x.name === "QRM-SERVER-TEST (fictional)")!;
  expect(m.version).toBe("2");
  expect(m.config.severity.max).toBe(10);
  expect(m.history.map((h) => h.action)).toEqual(["created", "edited"]);

  // An assessment that took version 2 and then sees version 3.
  await go(page, "#/risk");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-method").click();
  await page.getByTestId("risk-library-select").selectOption({ index: 1 });
  await page.getByTestId("risk-library-use").click();
  await page.getByTestId("risk-method-confirm").click().catch(() => undefined);
  await expect(page.getByTestId("risk-method-libref")).toContainText("version 2");
  await go(page, "#/risk/methods");
  await page.getByRole("button", { name: "Edit QRM-SERVER-TEST (fictional)" }).click();
  await page.getByTestId("scale-Detection-max").fill("9");
  await page.getByTestId("method-version").fill("3");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 3");
  await go(page, "#/risk");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-method").click();
  await expect(page.getByTestId("risk-method-newer")).toContainText("Library has v3; this assessment uses v2");
});
