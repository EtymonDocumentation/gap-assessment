// Milestone 6, server build: the TRD seed page works with an account, downloads a seed that the schema accepts and records the
// downloads in the export history that is saved on the server.
import { readFile } from "node:fs/promises";
import { parseTrdSeed } from "@gap/process-model";
import type { Download } from "@playwright/test";
import { expect, go, loadDemo, newAccount, signUp, test } from "./helpers";

test("server build: the TRD seed downloads and appears in the export history after a reload", async ({ page }) => {
  test.setTimeout(120_000); // sign-up, demo load, two downloads and a reload on a slow phone profile
  await signUp(page, newAccount("trd"));
  await loadDemo(page);
  await go(page, "#/trd-seed");
  await expect(page.getByRole("heading", { level: 1, name: "TRD seed" })).toBeVisible();

  const dl = async (name: string) => {
    const [d] = (await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name }).click();
        await page.getByRole("button", { name: "Download anyway" }).click();
      })(),
    ])) as [Download, void];
    return { file: d.suggestedFilename(), bytes: await readFile(await d.path()) };
  };

  const json = await dl("Download TRD seed (JSON)");
  expect(json.file).toMatch(/^trd-seed-.+-\d{4}-\d{2}-\d{2}\.json$/);
  expect(parseTrdSeed(json.bytes.toString("utf8")).meta.format).toBe("gap-assessment.trd-seed");
  const html = await dl("Download draft outline (HTML)");
  expect(html.bytes.toString("utf8")).toContain("Technology transfer document");

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.getByRole("cell", { name: "TRD seed (JSON)" })).toBeVisible();
  await expect(history.getByRole("cell", { name: "TRD outline (HTML)" })).toBeVisible();

  // The history is part of the saved project: it is still there after a reload.
  // After a reload the app opens on the project start page with the same project still open.
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  await page.reload();
  await go(page, "#/");
  await expect(page.getByRole("heading", { level: 2, name: "Open project" })).toBeVisible();
  await go(page, "#/trd-seed");
  await expect(page.getByRole("heading", { level: 1, name: "TRD seed" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Export history table" }).getByRole("cell", { name: "TRD seed (JSON)" })).toBeVisible();
});
