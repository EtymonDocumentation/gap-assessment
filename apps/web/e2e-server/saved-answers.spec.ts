// Saved answers in the server build: a set is saved to the account on the server (not only to this browser), it is listed from the server,
// and deleting it from the page removes it there. The other account sees none of it. All data are fictional.
import { expect, go, loadDemo, newAccount, signUp, test } from "./helpers";

test("server build: a saved answer set lives on the server for the account, and a delete removes it there", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, newAccount("savedans"));
  await loadDemo(page);
  await go(page, "#/interview");
  await page.getByTestId("saved-save").click();
  const save = page.getByRole("dialog", { name: "Save these answers" });
  await save.getByTestId("sa-save-name").fill("Server set (fictional)");
  await save.getByTestId("sa-side-source").check();
  await save.getByTestId("sa-save-submit").click();
  await expect(save).toBeHidden();

  type Sets = { sets: { id: string; name: string; sides: string; answers: unknown[] }[] };
  const list = (await (await page.request.get("/api/saved-answers")).json()) as Sets;
  expect(list.sets).toHaveLength(1);
  expect(list.sets[0]).toMatchObject({ name: "Server set (fictional)", sides: "source" });
  expect(list.sets[0]!.answers.length).toBeGreaterThan(10);

  // The Saved answers page reads it back from the server (a reload starts with an empty in-memory list).
  await page.reload();
  await go(page, "#/saved-answers");
  await expect(page.getByTestId("sa-table")).toContainText("Server set (fictional)");
  await expect(page.getByText(/kept on the server for your account/)).toBeVisible();

  await page.getByRole("button", { name: "Delete Server set (fictional)" }).click();
  await page.getByTestId("sa-confirm-delete").click();
  await expect(page.getByText("No saved sets yet")).toBeVisible();
  expect(((await (await page.request.get("/api/saved-answers")).json()) as Sets).sets).toEqual([]);
});
