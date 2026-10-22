// My files needs the server, so the static demo must not offer it (no menu entry, no page, no network calls).
import { expect, test } from "@playwright/test";

test("the static demo has no My files entry and no My files page", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) calls.push(r.url());
  });
  await page.goto("./");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My files" })).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = "#/myfiles"));
  await expect(page.getByRole("heading", { level: 1, name: "My files" })).toHaveCount(0);
  expect(calls).toEqual([]);
});
