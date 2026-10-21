// Milestone 5.3: accessibility (axe, WCAG 2.2 AA) and phone layout of everything the server mode adds.
// Runs at the desktop (1366 px) and phone (390 px) widths, in the light and the dark colour scheme.
import { fileURLToPath } from "node:url";
import {
  BANNER,
  answerFirst,
  expect,
  expectAccessible,
  expectNoHorizontalScroll,
  go,
  loadDemo,
  newAccount,
  otherComputer,
  signInFresh,
  signUp,
  startProject,
  test,
} from "./helpers";

const FIXTURES = new URL("../../../packages/docx/fixtures/", import.meta.url);
const fixture = (name: string) => fileURLToPath(new URL(name, FIXTURES));

type Page = import("@playwright/test").Page;

/** Checks the page in both colour schemes. */
async function checkBoth(page: Page, label: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${label}, ${scheme} theme`);
    await expectNoHorizontalScroll(page, `${label}, ${scheme} theme`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("sign-in page", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await checkBoth(page, "sign-in page");

  // The error message is announced and still accessible.
  await page.getByRole("form", { name: "Sign in" }).getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("form", { name: "Sign in" }).getByRole("alert")).toBeVisible();
  await checkBoth(page, "sign-in page with an error");
});

test("project page, account bar and the password and delete dialogs", async ({ page }) => {
  await signUp(page, newAccount("a11y-home"));
  await expect(page.getByText("You have no saved projects yet.")).toBeVisible();
  await checkBoth(page, "project page, empty list");

  await loadDemo(page);
  await go(page, "#/");
  await expect(page.getByRole("list", { name: "My projects" })).toBeVisible();
  await checkBoth(page, "project page, with a project");

  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("dialog", { name: "Change password" })).toBeVisible();
  await checkBoth(page, "change password dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Change password" })).toBeFocused();

  await page.getByRole("button", { name: /^Delete / }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await checkBoth(page, "delete project dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("sources page with attached files, and the remove dialog", async ({ page }) => {
  await signUp(page, newAccount("a11y-src"));
  await loadDemo(page);
  await go(page, "#/sources");
  await expect(page.getByRole("heading", { level: 2, name: "Files (0)" })).toBeVisible();
  await checkBoth(page, "sources page, no files");

  await page.getByRole("button", { name: "Add document reference" }).click();
  const add = page.getByRole("dialog", { name: "Add document reference" });
  await add.getByLabel("Document type").fill("PPQ report");
  await add.getByLabel("Identifier").fill("DEMO-PPQ-998");
  await add.getByRole("button", { name: "Add document reference" }).click();
  await page.getByLabel(/^File to attach to .*DEMO-PPQ-998/).setInputFiles({ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional.") });
  await expect(page.getByRole("heading", { level: 2, name: "Files (1)" })).toBeVisible();
  await checkBoth(page, "sources page, one file attached");

  await page.getByRole("list", { name: /^Files attached to / }).getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByRole("dialog", { name: /^Remove report\.txt/ })).toBeVisible();
  await checkBoth(page, "remove file dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("templates page and the panel for templates still in the browser", async ({ page }) => {
  await signUp(page, newAccount("a11y-tpl"));
  await go(page, "#/templates");
  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-tags.docx"));
  await page.getByRole("form", { name: /^Add brightwater-tags\.docx/ }).getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  await checkBoth(page, "templates page");

  // Leave a copy in this browser's library so the panel shows (the server copy stays, so it reports "already there").
  await page.evaluate(async () => {
    const { templates } = (await (await fetch("/api/templates")).json()) as { templates: { id: string }[] };
    const t = templates[0]!;
    const bytes = new Uint8Array(await (await fetch(`/api/templates/${t.id}/file`)).arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("gap-templates", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("templates")) open.result.createObjectStore("templates");
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("templates", "readwrite");
        tx.objectStore("templates").put({ ...t, bytes }, t.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await go(page, "#/templates");
  const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Templates in this browser" }) });
  await expect(panel).toBeVisible();
  await checkBoth(page, "templates page with the browser-library panel");
  await panel.getByRole("button", { name: "Upload them" }).click();
  await expect(panel.getByRole("status")).toContainText("already there");
  await checkBoth(page, "browser-library panel after uploading");
});

test("the save-conflict dialog", async ({ page, browser, problems }, info) => {
  const account = newAccount("a11y-conf");
  const title = `Conflict ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "A11Y-1");
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();

  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await other.getByRole("button", { name: `Open ${title}` }).click();
  await expect(other.getByText("Open now")).toBeVisible();
  await go(other, "#/interview");

  await page.getByRole("button", { name: "Unknown — to be confirmed" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  await expect(page.locator("#q-prompt")).not.toHaveText("What is the product modality?");
  await other.getByRole("button", { name: "Unknown — to be confirmed" }).click();
  const dialog = other.getByRole("dialog", { name: "This project was changed on another computer" });
  await expect(dialog).toBeVisible();
  await checkBoth(other, "conflict dialog");
  // The dialog cannot be dismissed by accident: Escape leaves it open until a choice is made.
  await other.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await other.context().close();
});
