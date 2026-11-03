// My files on a phone (Tester D row 20, fix job D1): at 600 px and below each file is a small card, with Download on a line of its own,
// and nothing is wider than the screen at 390, 360 and 320 px. The table roles stay, so a screen reader still reads rows and cells.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, expectAccessibleInBothThemes, expectNoHorizontalScrollOnceSettled, go, newAccount, signUp, test } from "./helpers";

// One name with no spaces that is longer than a 320 px screen, so only a break inside the word keeps it on the screen.
const LONG = "fictional-transfer-batch-record-review-notes-with-a-very-long-name-and-no-spaces-at-all-2026.txt";

test("each file is a card: Download first, a long name wraps, nothing scrolls sideways at 390, 360 and 320 px", async ({ page }, info) => {
  await signUp(page, newAccount("myfiles-phone"));
  await go(page, "#/myfiles");
  await expect(page.getByRole("heading", { level: 1, name: "My files" })).toBeVisible();
  await page.getByLabel("Files to upload").setInputFiles([
    { name: "notes-a.txt", mimeType: "text/plain", buffer: Buffer.from("alpha fictional notes") },
    { name: LONG, mimeType: "text/plain", buffer: Buffer.from("bravo fictional notes") },
  ]);
  await expect(page.getByRole("rowheader", { name: LONG })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "notes-a.txt" })).toBeVisible();

  const region = page.getByRole("region", { name: "Files table" });
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const label = `my files at ${width} px`;
    // Waits out the frame or two in which the header is still in its old form (see the helper); measuring at once is what made this flaky.
    await expectNoHorizontalScrollOnceSettled(page, label);
    // The box that holds the table does not scroll sideways either (it used to, with the actions off screen).
    expect(await region.evaluate((el) => el.scrollWidth - el.clientWidth), `${label}: the table box scrolls sideways`).toBeLessThanOrEqual(1);

    // The long name wraps inside the screen instead of running off it.
    const name = (await page.getByRole("rowheader", { name: LONG }).boundingBox())!;
    expect(name.x, `${label}: the name starts on the screen`).toBeGreaterThanOrEqual(0);
    expect(name.x + name.width, `${label}: the name ends on the screen`).toBeLessThanOrEqual(width);
    expect(name.height, `${label}: the long name wraps onto several lines`).toBeGreaterThan(40);

    // Download is the first action and has a line to itself; Rename, Move, Auto-delete and Delete are small buttons under it.
    const download = (await page.getByRole("link", { name: `Download ${LONG}` }).boundingBox())!;
    for (const action of ["Rename", "Move", "Auto-delete for", "Delete"]) {
      const b = (await page.getByRole("button", { name: `${action} ${LONG}` }).boundingBox())!;
      expect(b.y, `${label}: ${action} is under Download`).toBeGreaterThan(download.y + download.height - 1);
      expect(b.x + b.width, `${label}: ${action} is on the screen`).toBeLessThanOrEqual(width);
      expect(b.height, `${label}: ${action} is a target of at least 24 px`).toBeGreaterThanOrEqual(24);
    }
    expect(download.x + download.width, `${label}: Download is on the screen`).toBeLessThanOrEqual(width);

    // "Auto-delete: Never" is one fact on one line.
    const fact = (await page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "notes-a.txt" }) }).locator("td.myfiles-expiry").boundingBox())!;
    expect(fact.height, `${label}: the auto-delete fact stays on one line`).toBeLessThan(30);
  }

  // The same page still reads as a table: the column headings are there for a screen reader and hidden from the eye at phone width.
  for (const heading of ["Name", "Size", "Uploaded", "From", "Auto-delete", "Actions"]) {
    const box = (await page.getByRole("columnheader", { name: heading, exact: true }).boundingBox())!;
    expect(box.width, `phone: the ${heading} heading is not drawn`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessibleInBothThemes(page, "my files cards at 390 px");
  // Picture for the fix job's report.
  if (info.project.name === "desktop") await page.screenshot({ path: join(tmpdir(), "fixd1-20-after-390.png"), fullPage: true });

  // Wide screens keep the table with its headings drawn.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("columnheader", { name: "Size", exact: true })).toBeVisible();
  expect((await page.getByRole("columnheader", { name: "Size", exact: true }).boundingBox())!.width).toBeGreaterThan(20);
  await expectNoHorizontalScrollOnceSettled(page, "my files at 1280 px");
  if (info.project.name === "desktop") await page.screenshot({ path: join(tmpdir(), "fixd1-20-after.png") });

  // Tester D row 30: the dialog asks for a number of days, so its button said "Set the date" for no reason; it says what it does.
  await page.getByRole("button", { name: "Auto-delete for notes-a.txt" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Set the days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set the date" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("a folder is a card too, and an empty folder name is asked for in plain words", async ({ page }) => {
  await signUp(page, newAccount("myfiles-folder"));
  await go(page, "#/myfiles");
  await page.getByRole("button", { name: "New folder…" }).click();
  const dialog = page.getByRole("dialog");
  // Tester D row 30 quoted "Give the folder name."; the server already says "Give the folder a name." (unchanged by this job), and this pins it.
  await dialog.getByRole("button", { name: /^(Create|Create folder|Save)$/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give the folder a name.");
  await dialog.getByLabel(/name/i).fill("Fictional reports");
  await dialog.getByRole("button", { name: /^(Create|Create folder|Save)$/ }).click();
  await expect(page.getByRole("rowheader", { name: "Fictional reports" })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScrollOnceSettled(page, "folder card at 360 px");
  // Folder actions are reachable without scrolling sideways.
  const rename = (await page.getByRole("button", { name: "Rename folder Fictional reports" }).boundingBox())!;
  expect(rename.x + rename.width).toBeLessThanOrEqual(360);
});
