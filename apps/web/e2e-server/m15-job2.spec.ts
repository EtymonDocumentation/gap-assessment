// M15 job 2 in server mode: the TRD's match of a template's headings is kept on the server, with the template (PATCH /api/templates/:id), and follows the
// account to another computer. A fictional sample template; Playwright against the real server (8788). Fictional data only.
import { fileURLToPath } from "node:url";
import { expect, expectAccessible, expectNoHorizontalScroll, go, makeSamplingInvite, newAccount, otherComputer, signInFresh, signUp, test } from "./helpers";

const FIXTURES = new URL("../../../packages/docx/fixtures/", import.meta.url);
const fixture = (name: string) => fileURLToPath(new URL(name, FIXTURES));

test("the match of a template's headings for the TRD is stored on the server and follows the account", async ({ page, browser, problems }, info) => {
  const account = newAccount("m15match");
  // The TRD module is not in the default invite; the sampling invite carries every module.
  await signUp(page, account, makeSamplingInvite());
  await go(page, "#/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-template.docx"));
  const form = page.getByRole("form", { name: /^Add brightwater-template\.docx/ });
  await form.getByLabel("Name").fill("Server match SOP (fictional)");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();

  const card = page.locator('[data-testid^="trd-match-card-"]');
  await expect(card).toContainText("Not set yet.");
  await card.getByRole("link", { name: "Match your headings" }).click();
  const url = page.url();
  await expect(page.getByRole("heading", { level: 1, name: "Match your headings" })).toBeVisible();
  await expect(page.getByTestId("trd-match-confirm-all")).toBeEnabled();
  await page.getByTestId("trd-match-confirm-all").click();

  // Every heading that now has content needs its pick before the match is saved.
  await page.getByTestId("trd-match-save").click();
  await expect(page.getByTestId("trd-match-error")).toContainText('Choose "Replace it" or "Keep it above Cascade\'s content" for:');
  const radios = page.getByRole("radio", { name: "Replace it" });
  const n = await radios.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await radios.nth(i).check();
  await page.getByTestId("trd-match-save").click();
  await expect(page.getByTestId("trd-match-status")).toContainText(/saved/i);
  await expectNoHorizontalScroll(page, "match screen on the server");
  await expectAccessible(page, "match screen on the server");

  // It is on the server: a reload, and then another computer, see the same picks.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Replace it", checked: true })).toHaveCount(n);

  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await other.goto(url);
  await expect(other.getByRole("heading", { level: 1, name: "Match your headings" })).toBeVisible();
  await expect(other.getByRole("radio", { name: "Replace it", checked: true })).toHaveCount(n);
  await other.context().close();

  // The Templates page card says how much is placed.
  await go(page, "#/templates");
  await expect(page.locator('[data-testid^="trd-match-card-"]')).toContainText(/TRD content placed under \d+ of \d+ headings/);
});
