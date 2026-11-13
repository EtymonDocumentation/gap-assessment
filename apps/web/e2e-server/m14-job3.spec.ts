// M14 job 3 in the server build: the areas a person sets up on the "Your areas" page are part of the project, so they are saved on the server with it and
// are still there after a reload. No new server route is needed. All data are fictional.
import { expect, expectSaved, go, newAccount, serverRevision, signUp, startProject, test } from "./helpers";

test("server build: areas added on the Your areas page are saved on the server and come back after a reload", async ({ page }) => {
  test.setTimeout(150_000);
  const account = newAccount("m14areas");
  const title = `Areas ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(0);
  const saved = await serverRevision(page, title);

  await go(page, "#/interview/areas?unit=ru&add=1");
  await expect(page.getByTestId("areas-page")).toBeVisible();
  await page.getByTestId("areas-add-name").fill("Room A (fictional)");
  await page.getByTestId("areas-add-button").click();
  await expect(page.getByRole("heading", { level: 3, name: "Room A (fictional)" })).toBeVisible();
  await expectSaved(page);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(saved);

  await page.reload();
  await go(page, "#/interview/areas?unit=ru");
  await expect(page.getByRole("heading", { level: 3, name: "Room A (fictional)" })).toBeVisible();
});
