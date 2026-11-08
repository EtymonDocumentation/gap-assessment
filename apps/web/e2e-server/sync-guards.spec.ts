// Code review fixes CR-04 and CR-09, against the real server (storage "server" on 8788). Fictional data only.
//   CR-04: a new project, a demo or an import is refused while the open project could not be saved, and the edits stay.
//   CR-09: two tabs of one account keep their own browser copies; a project deleted on another computer is saved again as a new one.
// Every test also fails on a script error or a Content Security Policy violation (see helpers.ts).
import {
  answeredCount,
  answerFirst,
  answerTbd,
  expect,
  expectSaved,
  go,
  newAccount,
  otherComputer,
  projectAction,
  serverRevision,
  signInFresh,
  signUp,
  startProject,
  test,
} from "./helpers";

/** The connection to the server drops for saves only (reading still works), which is what a failed save looks like to the person. */
async function failSaves(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/projects/*", (route) => (route.request().method() === "PUT" ? route.abort("connectionrefused") : route.continue()));
}

test("a new project is refused while the open one could not be saved, and the edits stay (CR-04)", async ({ page }) => {
  const account = newAccount("newguard");
  const title = `New guard ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "GUARD-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(1);
  await expectSaved(page);

  // The connection drops and the person keeps answering: the change is kept in the browser, not on the server.
  await failSaves(page);
  await answerTbd(page);
  const before = await serverRevision(page, title);

  // A new project is not started: the form stays as typed and says why.
  await go(page, "#/");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill(`Second ${account.username} (fictional)`);
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved yet, so no other project can be started yet");
  await expect(dialog.getByLabel("Project title")).toHaveValue(`Second ${account.username} (fictional)`);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // A demo is refused with the same words, in the banner.
  await page.getByRole("button", { name: /^Open demo:/ }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "no other project can be started yet" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();

  // The open project is still the one on screen, with its edit, and the server does not have that edit yet.
  expect(await serverRevision(page, title)).toBe(before);
  expect(await answeredCount(page)).toBe(2);

  // Once saving works again, the same click goes through and the first project is on the server with the edit.
  await page.unroute("**/api/projects/*");
  await page.getByRole("button", { name: "Start a new project" }).click();
  await dialog.getByLabel("Project title").fill(`Second ${account.username} (fictional)`);
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  expect(await serverRevision(page, title)).toBeGreaterThan(before);
});

test("an import is refused while the open project could not be saved (CR-04)", async ({ page }) => {
  const account = newAccount("importguard");
  const title = `Import guard ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "IMPORT-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(1);
  await expectSaved(page);

  await failSaves(page);
  await answerTbd(page);

  await go(page, "#/");
  await page.getByLabel("Project JSON file to import").setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  // The refusal comes before the file is read: it is the unsaved project that is named, not a problem with the file.
  await expect(page.getByRole("alert").filter({ hasText: "no other project can be started yet" })).toBeVisible();
  expect(await answeredCount(page)).toBe(2);
});

test("two tabs of one account keep their own project after a reload (CR-09)", async ({ page, context }) => {
  const account = newAccount("twotabs");
  const titleA = `Tab one ${account.username} (fictional)`;
  const titleB = `Tab two ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, titleA);
  await answerFirst(page, "TAB-ONE");
  await expect.poll(() => serverRevision(page, titleA)).toBeGreaterThan(1);

  // A second tab of the same browser starts another project.
  const tab2 = await context.newPage();
  await tab2.goto("/");
  await expect(tab2.getByRole("button", { name: "Start a new project" })).toBeVisible();
  await startProject(tab2, titleB);
  await answerFirst(tab2, "TAB-TWO");
  await expect.poll(() => serverRevision(tab2, titleB)).toBeGreaterThan(1);

  // The server stops taking saves for both tabs; each tab keeps working, so each has a copy only in this browser.
  await failSaves(page);
  await failSaves(tab2);
  await answerTbd(tab2);
  await answerTbd(page);

  // Reload the first tab while the server cannot be reached for saves: it reopens ITS project, with its edit, not the other tab's.
  await page.reload();
  await go(page, "#/");
  await expect(page.locator(".project-title")).toContainText(titleA);
  expect(await answeredCount(page)).toBe(2);
  await tab2.reload();
  await go(tab2, "#/");
  await expect(tab2.locator(".project-title")).toContainText(titleB);
  expect(await answeredCount(tab2)).toBe(2);
});

test("a project deleted on another computer is saved again as a new project, and the person is told (CR-09)", async ({ page, browser, problems }, info) => {
  const account = newAccount("deleted");
  const title = `Deleted elsewhere ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "DELETE-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(1);
  await expectSaved(page);

  // Another computer deletes it from My projects.
  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await go(other, "#/");
  await projectAction(other, title, "Delete");
  await other.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
  // The project was the account's only one, so the list itself is gone (the page says there are no saved projects), not just the row.
  await expect(other.getByText("You have no saved projects yet.")).toBeVisible();
  await expect(other.getByRole("button", { name: `More actions for ${title}`, exact: true })).toHaveCount(0);
  await other.context().close();

  // The next change here is not lost: the message says what happened and the copy becomes a new project with the same name.
  await answerTbd(page);
  await expect(page.getByRole("alert").filter({ hasText: "was removed from the server" })).toBeVisible();
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(0);
  await expectSaved(page);
  expect(await answeredCount(page)).toBe(2);
  // It survives a reload too (the browser copy followed the project to its new id).
  await page.reload();
  expect(await answeredCount(page)).toBe(2);
});
