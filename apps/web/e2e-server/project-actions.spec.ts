// My projects on the server (Tester D rows 17 and 18, showcase audit row 1, fix job D1): Rename, Copy and Import keep every name in the list
// different, say what they did, and mark the new row; a double click on a demo button makes one project, not two.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_NAMES } from "../e2e/nav-helper";
import { expect, expectAccessibleInBothThemes, go, newAccount, serverRevision, signUp, startProject, test } from "./helpers";

type Page = import("@playwright/test").Page;

const projectList = (page: Page) => page.getByRole("list", { name: "My projects" });
const rowOf = (page: Page, title: string) => projectList(page).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
const note = (page: Page) => page.getByTestId("projects-note");

async function listedOnServer(page: Page): Promise<{ title: string }[]> {
  const r = await page.request.get("/api/projects");
  return ((await r.json()) as { projects: { title: string }[] }).projects;
}

test("Rename is inline with Save and Cancel, refuses a name another project has, and Copy adds a marked '(copy)' row", async ({ page }, info) => {
  await signUp(page, newAccount("rename"));
  const title = `Rename check ${Date.now()} (fictional)`;
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title), { message: "the project reaches the server" }).toBeGreaterThan(0);
  await go(page, "#/");
  await expect(projectList(page)).toBeVisible();

  // Rename: the title turns into a field with Save and Cancel; Escape and Cancel put it back and return focus to the button.
  let row = rowOf(page, title);
  await row.getByRole("button", { name: `Rename ${title}` }).click();
  const field = page.getByRole("textbox", { name: `New name for ${title}` });
  await expect(field).toBeFocused();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await field.fill("Throwaway name");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(rowOf(page, title)).toHaveCount(1);
  // (The open project's own card on Home has a Rename button with the same name: this one is the list's.)
  const listRename = projectList(page).getByRole("button", { name: `Rename ${title}` });
  await expect(listRename).toBeFocused();
  await listRename.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(field).toHaveCount(0);

  // Copy: "<name> (copy)", a line that says what was made, and a row marked New (a tag, not only a tint).
  await page.getByRole("button", { name: `Copy ${title}` }).click();
  const copyTitle = `${title} (copy)`;
  await expect(note(page)).toHaveText(`Copied: ${title}. The copy is called ${copyTitle}.`);
  const copyRow = rowOf(page, copyTitle);
  await expect(copyRow).toHaveCount(1);
  await expect(copyRow).toContainText("New");
  await expect(rowOf(page, title)).not.toContainText("New");
  await expect.poll(async () => (await listedOnServer(page)).map((p) => p.title), { message: "the copy is saved on the server" }).toContain(copyTitle);

  // A name another project already has is refused, with the reason beside the field, and an empty one too.
  await page.getByRole("button", { name: `Rename ${copyTitle}` }).click();
  const copyField = page.getByRole("textbox", { name: `New name for ${copyTitle}` });
  await copyField.fill(title);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "is already called" })).toHaveText(`Another project is already called "${title}". Choose a different name.`);
  await expect(copyField).toBeFocused();
  await copyField.fill("   ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a name" })).toHaveText("Enter a name for the project.");
  await expectAccessibleInBothThemes(page, "My projects with a rename error");
  // Picture for the fix job's report (wide screen only).
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 900 });
    await projectList(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), "fixd1-17-after.png") });
  }

  // A good new name saves, says so, and the list shows it at once (the copy is the project that is not open).
  const renamed = `Renamed copy ${Date.now()} (fictional)`;
  await copyField.fill(renamed);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(note(page)).toHaveText(`Renamed: ${copyTitle} is now called ${renamed}.`);
  await expect(rowOf(page, renamed)).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Rename ${renamed}` })).toBeFocused();
  await expect.poll(async () => (await listedOnServer(page)).map((p) => p.title), { message: "the new name is saved on the server" }).toContain(renamed);
  row = rowOf(page, title);
  await expect(row).toHaveCount(1);
});

test("Import says what it made, keeps a same-named project apart as '(imported)', stays on Home and marks the new row", async ({ page }, info) => {
  await signUp(page, newAccount("import"));
  const title = `Import check ${Date.now()} (fictional)`;
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(0);
  await go(page, "#/");

  // The file comes from the project's own Export project (JSON), as a person would do it.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export project (JSON)" }).click()]);
  const file = (await download.path()) as string;
  expect(JSON.parse(readFileSync(file, "utf8"))).toBeTruthy();

  await page.getByLabel("Project JSON file to import").setInputFiles(file);
  const imported = `${title} (imported)`;
  await expect(note(page)).toHaveText(`Imported: ${title}. A project with this name is already listed, so this one is called ${imported}.`);
  const row = rowOf(page, imported);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("New");
  // The person stays where they were: Home, not the Interview.
  expect(new URL(page.url()).hash).toMatch(/^(#\/?)?$/);
  await expect(page.getByRole("heading", { level: 2, name: "My projects" })).toBeVisible();
  await expect.poll(async () => (await listedOnServer(page)).map((p) => p.title), { message: "the import is saved on the server" }).toContain(imported);
  // A project cannot be listed twice under one name, even after a second import of the same file.
  await page.getByLabel("Project JSON file to import").setInputFiles(file);
  await expect(note(page)).toContainText(`Imported: ${title}`);
  const titles = (await listedOnServer(page)).map((p) => p.title);
  expect(new Set(titles).size, `names in the list: ${titles.join(" | ")}`).toBe(titles.length);
  await expectAccessibleInBothThemes(page, `My projects after an import (${info.project.name})`);
  if (info.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 900 });
    await projectList(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(tmpdir(), "fixd1-18-after.png") });
  }
});

test("a double click on a demo button makes exactly one project, and the other demo makes a second", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, newAccount("demo-once"));
  await go(page, "#/");
  await expect(page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.syr}` })).toBeEnabled();
  // Two clicks in the same frame: the in-flight guard drops the second, whatever React has drawn by then.
  await page.evaluate((name) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === `Open demo: ${name}`) as HTMLButtonElement;
    button.click();
    button.click();
  }, DEMO_NAMES.syr);
  await expect(page.getByTestId("demo-opened")).toHaveText(`Demo opened: ${DEMO_NAMES.syr}`, { timeout: 120_000 });
  await expect.poll(async () => (await listedOnServer(page)).length, { timeout: 60_000, message: "the demo reaches the server" }).toBeGreaterThanOrEqual(1);
  // A second project would be saved a moment after the first: look again before counting.
  await page.waitForTimeout(3_000);
  expect((await listedOnServer(page)).filter((p) => /SYR-305/.test(p.title))).toHaveLength(1);
  await expect(projectList(page).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` }).click();
  await expect(page.getByTestId("demo-opened")).toHaveText(`Demo opened: ${DEMO_NAMES.arx}`, { timeout: 120_000 });
  await expect.poll(async () => (await listedOnServer(page)).length, { timeout: 60_000 }).toBe(2);
  await expect(projectList(page).getByRole("listitem")).toHaveCount(2);
});
