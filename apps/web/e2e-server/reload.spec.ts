// Row 31 on the server: a reload on a project page reopens the same project on the same page (the browser-only twin is in
// e2e/nav.spec.ts). Signed in, the project comes back from the server, so the reload must not drop to the "no project" notice.
import { expect, go, newAccount, serverRevision, signUp, startProject, test } from "./helpers";

test("server build: a reload on a document page reopens the same project on the same page", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("reload"));
  const title = `Reload check ${Date.now()} (fictional)`;
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title), { message: "the project reaches the server" }).toBeGreaterThan(0);
  await go(page, "#/interview");
  await expect(page.locator("#q-prompt")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("needs-project")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/interview/);
  await expect(page.locator("#q-prompt")).toBeVisible();
  await go(page, "#/");
  await expect(page.getByTestId("home-projects").getByText("Open now")).toBeVisible();
  await expect(page.getByTestId("home-projects").getByText(title)).toBeVisible();
});
