// My files: moving files between computers through the server (server storage mode only).
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_URL, expect, expectAccessible, expectNoHorizontalScroll, go, makeInvite, newAccount, otherComputer, signInFresh, signUp, test } from "./helpers";

type Page = import("@playwright/test").Page;

// A 1x1 PNG, so the server recognises it as an image and offers a preview.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const shot = (name: string) => join(tmpdir(), `files-${name}.png`);

async function open(page: Page): Promise<void> {
  await go(page, "#/myfiles");
  await expect(page.getByRole("heading", { level: 1, name: "My files" })).toBeVisible();
}

/** Drops files on the drop zone the way a browser does: a drop event carrying a DataTransfer. */
async function dropFiles(page: Page, files: { name: string; text: string }[]): Promise<void> {
  await page.getByTestId("dropzone").evaluate((zone, list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: "text/plain" }));
    zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}

test("upload by choosing, by drop and by pasting a screenshot; download matches the upload", async ({ page, browser, problems }, info) => {
  const account = newAccount("myfiles");
  await signUp(page, account);
  await open(page);
  await expect(page.getByText("You have no files yet.")).toBeVisible();
  await page.screenshot({ path: shot(`empty-${info.project.name}`) });

  // Choose
  await page.getByLabel("Files to upload").setInputFiles({ name: "notes-a.txt", mimeType: "text/plain", buffer: Buffer.from("alpha fictional notes") });
  await expect(page.getByRole("rowheader", { name: "notes-a.txt" })).toBeVisible();

  // Drop
  await dropFiles(page, [{ name: "dropped-b.txt", text: "bravo fictional" }]);
  await expect(page.getByRole("rowheader", { name: "dropped-b.txt" })).toBeVisible();

  // Paste a screenshot: named by the time it was taken.
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString("base64"));
  await expect(page.getByRole("rowheader", { name: /^screenshot-\d{4}-\d{2}-\d{2}-\d{6}\.png$/ })).toBeVisible();
  await expect(page.locator("img.myfiles-thumb")).toHaveCount(1);

  // Another computer sees the file and gets the same bytes.
  const other = await otherComputer(browser, info, problems);
  await other.goto("./");
  await signInFresh(other, account);
  await open(other);
  const [download] = await Promise.all([other.waitForEvent("download"), other.getByRole("link", { name: "Download notes-a.txt" }).click()]);
  expect(download.suggestedFilename()).toBe("notes-a.txt");
  expect(readFileSync((await download.path()) as string, "utf8")).toBe("alpha fictional notes");
  await other.context().close();

  await page.screenshot({ path: shot(`list-${info.project.name}`), fullPage: true });
  await expectAccessible(page, "my files list");
  await expectNoHorizontalScroll(page, "my files list");
});

test("a pasted file does nothing while a dialog is open, and a drop outside the box does not leave the app", async ({ page }) => {
  await signUp(page, newAccount("myfiles-paste"));
  await open(page);
  await page.getByRole("button", { name: "New folder…" }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press("Escape");
  await expect(page.getByText("You have no files yet.")).toBeVisible();
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.txt"));
    const e = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test("folders: create, move a file in, rename, delete with confirmation; focus returns to the button", async ({ page }, info) => {
  await signUp(page, newAccount("myfiles-folders"));
  await open(page);
  await page.getByLabel("Files to upload").setInputFiles({ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("fictional") });
  await expect(page.getByRole("rowheader", { name: "report.txt" })).toBeVisible();

  const newFolder = page.getByRole("button", { name: "New folder…" });
  await newFolder.click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await page.screenshot({ path: shot(`dialog-new-folder-${info.project.name}`) });
  await dialog.getByLabel("Folder name").fill("Batch records");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("link", { name: "Batch records" })).toBeVisible();
  await expect(newFolder).toBeFocused();

  // Move
  const moveButton = page.getByRole("button", { name: "Move report.txt" });
  await moveButton.click();
  const move = page.getByRole("dialog", { name: "Move report.txt" });
  await page.screenshot({ path: shot(`dialog-move-${info.project.name}`) });
  await move.getByLabel("Move to").selectOption("Batch records");
  await move.getByRole("button", { name: "Move" }).click();
  await expect(page.getByRole("rowheader", { name: "report.txt" })).toHaveCount(0);
  await page.getByRole("link", { name: "Batch records" }).click();
  await expect(page.getByRole("rowheader", { name: "report.txt" })).toBeVisible();

  // Rename the file
  await page.getByRole("button", { name: "Rename report.txt" }).click();
  const rename = page.getByRole("dialog", { name: "Rename report.txt" });
  await page.screenshot({ path: shot(`dialog-rename-${info.project.name}`) });
  await rename.getByLabel("File name").fill("report-final.txt");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("rowheader", { name: "report-final.txt" })).toBeVisible();

  // Delete the folder from the top level: the dialog names what is inside.
  await page.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "My files" }).click();
  await page.getByRole("button", { name: "Delete folder Batch records" }).click();
  const del = page.getByRole("dialog", { name: "Delete folder Batch records?" });
  await expect(del).toContainText("1 file");
  await page.screenshot({ path: shot(`dialog-delete-${info.project.name}`) });
  await del.getByRole("button", { name: "Delete folder" }).click();
  await expect(page.getByRole("link", { name: "Batch records" })).toHaveCount(0);
  await expectAccessible(page, "my files after deleting a folder");
});

test("auto-delete: the setting gives new files a date; a single file can be set to never", async ({ page }, info) => {
  await signUp(page, newAccount("myfiles-expiry"));
  await open(page);
  const settings = page.getByRole("region", { name: "Settings" }).or(page.locator("section[aria-labelledby=mf-settings-h]"));
  await settings.getByLabel("Delete new files after (days)").fill("7");
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(settings.getByText("Auto-delete is on: new files are deleted 7 days after upload.")).toBeVisible();

  await page.getByLabel("Files to upload").setInputFiles({ name: "temp.txt", mimeType: "text/plain", buffer: Buffer.from("fictional") });
  const row = page.getByRole("row", { name: /temp\.txt/ });
  await expect(row).toContainText("Deletes on 20");
  await page.screenshot({ path: shot(`settings-${info.project.name}`), fullPage: true });

  await row.getByRole("button", { name: "Auto-delete for temp.txt" }).click();
  const dialog = page.getByRole("dialog", { name: "Auto-delete for temp.txt" });
  await dialog.getByRole("button", { name: "Never delete this file" }).click();
  await expect(row).toContainText("Never");
});

test("another account cannot see or fetch my files", async ({ page, browser, problems }, info) => {
  await signUp(page, newAccount("myfiles-owner"));
  await open(page);
  await page.getByLabel("Files to upload").setInputFiles({ name: "private.txt", mimeType: "text/plain", buffer: Buffer.from("fictional secret") });
  await expect(page.getByRole("rowheader", { name: "private.txt" })).toBeVisible();
  const list = (await (await page.request.get("/api/myfiles")).json()) as { files: { id: string }[] };
  const id = list.files[0]?.id as string;

  const other = await otherComputer(browser, info, problems);
  await signUp(other, newAccount("myfiles-other"));
  await open(other);
  await expect(other.getByText("You have no files yet.")).toBeVisible();
  const r = await other.request.get(`/api/myfiles/files/${id}/download`);
  expect(r.status()).toBe(404);
  await other.context().close();
});

test("delete a file; confirmation names it", async ({ page }) => {
  await signUp(page, newAccount("myfiles-delete"));
  await open(page);
  await page.getByLabel("Files to upload").setInputFiles({ name: "gone.txt", mimeType: "text/plain", buffer: Buffer.from("fictional") });
  await expect(page.getByRole("rowheader", { name: "gone.txt" })).toBeVisible();
  const button = page.getByRole("button", { name: "Delete gone.txt" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Delete gone.txt?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(button).toBeFocused();
  await button.click();
  await page.getByRole("dialog", { name: "Delete gone.txt?" }).getByRole("button", { name: "Delete file" }).click();
  await expect(page.getByText("You have no files yet.")).toBeVisible();
});

test("accessible in the dark theme and at phone width; the drop zone shows its active state", async ({ page }, info) => {
  await signUp(page, newAccount("myfiles-a11y"));
  await open(page);
  await page.getByLabel("Files to upload").setInputFiles({ name: "a-rather-long-file-name-for-the-narrow-layout-check.txt", mimeType: "text/plain", buffer: Buffer.from("fictional") });
  await expect(page.getByRole("rowheader", { name: /a-rather-long/ })).toBeVisible();
  await page.getByTestId("dropzone").evaluate((zone) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.txt"));
    zone.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.getByText("Drop to upload")).toBeVisible();
  await page.screenshot({ path: shot(`dropzone-active-${info.project.name}`) });
  await page.getByTestId("dropzone").evaluate((zone) => zone.dispatchEvent(new DragEvent("dragleave", { bubbles: true })));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `my files, ${scheme}`);
    await expectNoHorizontalScroll(page, `my files, ${scheme}`);
    await page.screenshot({ path: shot(`${scheme}-${info.project.name}`), fullPage: true });
  }
});

test.describe("storage mode client", () => {
  test.use({ baseURL: CLIENT_URL });

  test("My files explains it is not available and the server refuses", async ({ page }) => {
    await signUp(page, newAccount("myfiles-client"), makeInvite("client"));
    await open(page);
    await expect(page.getByTestId("myfiles-unavailable")).toBeVisible();
    const r = await page.request.get("/api/myfiles");
    expect(r.status()).toBe(403);
  });
});
