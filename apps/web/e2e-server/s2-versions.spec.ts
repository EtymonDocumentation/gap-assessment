// Stage-up S2 in the server build: a version saved with a stage change is kept on the server and is still in the history after a reload;
// opening a version read-only never writes it back; two computers changing the stage at once end in the conflict dialog with no version
// number used twice. All data are fictional.
import { chooseStage, dismissSummary } from "../e2e/stage-helper";
import { expect, expectSaved, go, newAccount, otherComputer, serverRevision, signInFresh, signUp, startProject, test } from "./helpers";

const rowsOf = (page: import("@playwright/test").Page) => page.getByTestId("version-table").locator("tbody tr");

test("server build: a stage change saves a version on the server, a reload keeps it, and a read-only version is never written back", async ({ page }) => {
  test.setTimeout(150_000);
  const account = newAccount("s2ver");
  const title = `Versions ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(0);

  await chooseStage(page, "clinical", "Fictional: first batches planned");
  await dismissSummary(page);
  await expectSaved(page);
  const saved = await serverRevision(page, title);

  await page.reload();
  await go(page, "#/versions");
  await expect(rowsOf(page).filter({ hasText: "Fictional: first batches planned" })).toHaveCount(1);
  await expect(page.getByTestId("working-copy-line")).toContainText("Working copy after");

  // Open the oldest version read-only: the banner shows and the server copy does not change while it is open.
  await rowsOf(page).last().getByRole("button", { name: /Open read-only/ }).click();
  await expect(page.getByTestId("version-banner")).toBeVisible();
  await page.waitForTimeout(2500); // longer than the autosave wait
  expect(await serverRevision(page, title)).toBe(saved);
  await page.getByTestId("version-banner").getByRole("button", { name: "Back to the working copy" }).click();
  await expect(page.getByTestId("version-banner")).toHaveCount(0);
  await expect(page.getByTestId("stage-chip")).toContainText("Clinical");
});

test("server build: two computers changing the stage at once end in the conflict dialog, and no version label is used twice", async ({ page, browser, problems }, info) => {
  test.setTimeout(180_000);
  const account = newAccount("s2conf");
  const title = `Versions conflict ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(0);

  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await other.getByRole("button", { name: `Open ${title}` }).click();
  await expect(other.getByText("Open now")).toBeVisible();

  await chooseStage(page, "clinical", "Fictional: from the first computer");
  await dismissSummary(page);
  await expectSaved(page);

  // The second computer still has the old copy: its stage change is refused at the server and it must choose.
  await chooseStage(other, "ppq", "Fictional: from the second computer");
  await dismissSummary(other);
  const dialog = other.getByRole("dialog", { name: "This project was changed on another computer" });
  await expect(dialog).toBeVisible();
  // Loading the newer version first downloads the unsaved change, so nothing typed is lost.
  await Promise.all([other.waitForEvent("download"), dialog.getByRole("button", { name: /^Load the newer version/ }).click()]);
  await expect(dialog).toBeHidden();

  await go(other, "#/versions");
  const labels = await rowsOf(other).locator("th[scope=row]").allInnerTexts();
  const cleaned = labels.map((l) => l.replace("Start", "").trim());
  expect(new Set(cleaned).size, `version labels: ${cleaned.join(", ")}`).toBe(cleaned.length);
  await expect(rowsOf(other).filter({ hasText: "Fictional: from the first computer" })).toHaveCount(1);
  await other.context().close();
});
