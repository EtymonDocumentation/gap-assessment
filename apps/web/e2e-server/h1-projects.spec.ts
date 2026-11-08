// Job H1 on the server: "Your projects" is a compact side column beside the Home content on a wide screen and sits below the content on a
// phone; each row has one Open button and the other actions in a "..." menu; long names are cut with the full name in the title; the list
// shows the first few rows then "Show all"; and a project page asked for with no project open names itself and lands there after Open.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_NAMES, isPhone } from "../e2e/nav-helper";
import { expect, expectAccessibleInBothThemes, go, newAccount, projectAction, serverRevision, signUp, startProject, test } from "./helpers";

type Page = import("@playwright/test").Page;

const projectList = (page: Page) => page.getByRole("list", { name: "My projects" });
const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `h1-${name}-${test.info().project.name}.png`), fullPage: true });

/** Makes a project through the page, then closes it so the list is all that is left (the way a returning person sees Home). */
async function makeAndClose(page: Page, title: string): Promise<void> {
  await startProject(page, title);
  await expect.poll(() => serverRevision(page, title), { message: "the project reaches the server" }).toBeGreaterThan(0);
  await go(page, "#/");
  await page.getByRole("button", { name: "Close project" }).click();
  await expect(projectList(page).getByText("Open now")).toHaveCount(0);
}

test("the projects list is a side column on a wide screen and goes below the content on a phone; rows have Open and a ... menu", async ({ page }, info) => {
  test.setTimeout(180_000);
  await signUp(page, newAccount("h1side"));
  const long = `A very long project name that would push the buttons off the row if it were allowed to ${Date.now()} (fictional)`;
  await startProject(page, long);
  await expect.poll(() => serverRevision(page, long), { message: "the project reaches the server" }).toBeGreaterThan(0);
  await go(page, "#/");
  const side = page.getByTestId("home-projects");
  const main = page.getByRole("heading", { level: 1, name: "Welcome to Cascade" });
  await expect(side).toBeVisible();
  await expect(main).toBeVisible();
  const [s, m, cards] = await Promise.all([side.boundingBox(), main.boundingBox(), page.getByTestId("home-chain").boundingBox()]);
  if (isPhone(page)) {
    // Below the content: under the document cards, full width, never beside them.
    expect(s!.y, "projects under the cards on a phone").toBeGreaterThan(cards!.y + cards!.height - 1);
  } else {
    await page.setViewportSize({ width: 1920, height: 1000 });
    const [s2, m2] = await Promise.all([side.boundingBox(), main.boundingBox()]);
    expect(s2!.x, "projects column sits right of the content at 1920").toBeGreaterThan(m2!.x + 300);
    expect(Math.abs(s2!.y - m2!.y), "column starts near the top of the content").toBeLessThan(400);
    await page.screenshot({ path: join(tmpdir(), "h1-home-1920-projects.png") });
  }
  void m;
  // Long names are cut to one line; the full name is in the title attribute and in the buttons' accessible names.
  const name = projectList(page).locator(".project-name").first();
  await expect(name).toHaveAttribute("title", long);
  await expect(projectList(page).getByRole("button", { name: `More actions for ${long}` })).toBeVisible();
  // The open project says "Open now" and has no Open button (a greyed one beside the tag looked broken).
  await expect(projectList(page).getByText("Open now")).toBeVisible();
  await expect(projectList(page).getByRole("button", { name: `Open ${long}`, exact: true })).toHaveCount(0);
  const row = projectList(page).getByRole("listitem").first();
  const rowBox = (await row.boundingBox())!;
  const moreBox = (await projectList(page).getByRole("button", { name: `More actions for ${long}` }).boundingBox())!;
  expect(moreBox.x + moreBox.width, "the ... button stays inside its row").toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no sideways scroll").toBeLessThanOrEqual(0);
  await shot(page, "projects-side");
  await expectAccessibleInBothThemes(page, "Home with the projects column");
  void info;
});

test("the ... menu has Rename, Copy and Delete, opens with the keyboard, closes with Escape and returns focus", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, newAccount("h1menu"));
  const title = `Menu check ${Date.now()} (fictional)`;
  await makeAndClose(page, title);
  const more = projectList(page).getByRole("button", { name: `More actions for ${title}` });
  await more.focus();
  await page.keyboard.press("Enter");
  const items = projectList(page).getByRole("menuitem");
  await expect(items).toHaveText(["Rename", "Copy", "Delete"]);
  await expectAccessibleInBothThemes(page, "project row menu open");
  await shot(page, "projects-menu");
  await page.keyboard.press("Escape");
  await expect(items).toHaveCount(0);
  await expect(more).toBeFocused();
  // Copy through the menu: a "(copy)" row appears.
  await projectAction(page, title, "Copy");
  await expect(projectList(page).getByRole("listitem")).toHaveCount(2);
  // Delete asks first, names the project, and Cancel keeps it.
  await projectAction(page, title, "Delete");
  const confirm = page.getByRole("dialog", { name: `Delete ${title}?` });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(projectList(page).getByRole("listitem")).toHaveCount(2);
  await projectAction(page, title, "Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
  await expect(projectList(page).getByRole("listitem")).toHaveCount(1);
});

test("the list shows the first rows, then Show all; the open project and a new row always show", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, newAccount("h1all"));
  const stamp = Date.now();
  for (let i = 1; i <= 6; i++) {
    const title = `Many ${i} ${stamp} (fictional)`;
    await go(page, "#/");
    await page.getByRole("button", { name: "Start a new project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByLabel("Project title").fill(title);
    await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => serverRevision(page, title), { message: "the project reaches the server" }).toBeGreaterThan(0);
    await go(page, "#/");
    await page.getByRole("button", { name: "Close project" }).click();
  }
  const rows = projectList(page).getByRole("listitem");
  await expect(rows).toHaveCount(5);
  // Newest first.
  await expect(rows.first()).toContainText(`Many 6 ${stamp}`);
  const all = page.getByTestId("projects-show-all");
  await expect(all).toHaveText("Show all 6 projects");
  await all.click();
  await expect(rows).toHaveCount(6);
  await expect(all).toHaveText("Show fewer");
  await all.click();
  await expect(rows).toHaveCount(5);
});

test("a second click on a demo opens the demo that is already there, and a project page asked for with no project open names itself and lands there after Open", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, newAccount("h1box"));
  await go(page, "#/");
  await page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` }).click();
  await expect(page.getByTestId("demo-opened")).toHaveText(`Demo opened: ${DEMO_NAMES.arx}`, { timeout: 90_000 });
  await page.getByRole("button", { name: "Close project" }).click();
  await page.getByRole("button", { name: `Open demo: ${DEMO_NAMES.arx}` }).click();
  // Walk-through: no second copy is added. The same demo is open again and the list still has one row.
  await expect(page.getByRole("button", { name: "Close project" })).toBeVisible({ timeout: 90_000 });
  await expect(projectList(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Close project" }).click();

  // Ask for a project page with nothing open: the box names it and still lists the projects.
  await go(page, "#/sources");
  const box = page.getByTestId("needs-project");
  await expect(box.getByRole("heading", { level: 1, name: "Sources needs an open project" })).toBeVisible();
  await expect(page.getByTestId("needs-project-text")).toContainText("Open a demo, start a new project, or open one of your projects (below), and you will come straight back to Sources.");
  await expect(projectList(page)).toBeVisible();
  await shot(page, "needs-project-server");
  await expectAccessibleInBothThemes(page, "needs-project box with projects");
  // Opening one of your projects from the box lands on the page asked for.
  await projectList(page).getByRole("button", { name: /^Open / }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources", exact: true })).toBeVisible({ timeout: 90_000 });
  expect(new URL(page.url()).hash).toBe("#/sources");
});
