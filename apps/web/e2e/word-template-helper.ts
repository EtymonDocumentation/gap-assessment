// Shared by the M15 e2e specs (job 2, job 3A, 3B, 4): a fictional Word template made from scratch (no client file), added to the library through the
// Templates page, and the TRD's Word download read back. One copy, so a change to the fictional template reaches every spec that uses it.
import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { buildSampleHeadingsTemplate, SAMPLE_HEADINGS } from "../../../packages/docx/src/sample-headings";

// The fictional template: "Harbourlight SOP (fictional)". One copy of the file and its headings lives in the Word package (packages/docx/src/sample-headings.ts),
// which is also what the "Add a sample template (fictional)" button adds, so the tests use exactly what a visitor gets. Headings 5, 6 and 7
// ("Distribution list", "Training records", "Site notes") have no counterpart in a TRD; "Site notes" keeps the template's own text.
export const HEADINGS: Array<[string, string]> = SAMPLE_HEADINGS.map(([h, t]) => [h, t]);

/** The fictional Word file (or one with other headings, for a test that needs them). */
export function buildTemplate(headings: Array<[string, string]> = HEADINGS): Buffer {
  return Buffer.from(buildSampleHeadingsTemplate(headings));
}

/** The demo has open TBD values, so a download asks first; this test wants the file, so it answers "Download anyway". */
export async function confirmTbd(page: Page): Promise<void> {
  const anyway = page.getByRole("button", { name: "Download anyway" });
  if (await anyway.waitFor({ timeout: 1500 }).then(() => true, () => false)) await anyway.click();
}

export async function downloadWord(page: Page): Promise<Buffer> {
  const [dl] = (await Promise.all([page.waitForEvent("download"), page.getByTestId("trd-download-word").click().then(() => confirmTbd(page))])) as [Download, void];
  return readFile(await dl.path());
}

export async function addTemplate(page: Page, headings?: Array<[string, string]>) {
  await page.evaluate(() => (window.location.hash = "#/templates"));
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
  await page.getByLabel(/^Template file/).setInputFiles({ name: "harbourlight-sop.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buildTemplate(headings) });
  const form = page.getByRole("form", { name: /^Add harbourlight-sop\.docx/ });
  await form.getByLabel("Name").fill("Harbourlight SOP (fictional)");
  await form.getByLabel(/^Version/).fill("1");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
}
