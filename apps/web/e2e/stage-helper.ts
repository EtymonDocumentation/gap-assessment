// Shared by the stage specs: the three-step "Project stage" dialog (choose, say why, summary). The helper walks it the way a person does and
// never skips the reason, so a spec that only wants a stage set still exercises the real flow.
import { expect, type Locator, type Page } from "@playwright/test";

export const STAGE_LABEL = {
  development: "Engineering / development runs",
  clinical: "Clinical batches (GMP, not process-validated)",
  ppq: "PPQ batches (process performance qualification)",
  commercial: "Commercial batches (process validated)",
} as const;
export type StageKey = keyof typeof STAGE_LABEL;

const esc = (s: string) => s.replace(/[()/]/g, "\\$&");

/** Step 1 and 2 from an already open dialog: pick the stage, Next, write the reason, press the save button. Leaves the summary showing. */
export async function pickAndSave(page: Page, stage: StageKey, reason = "Fictional reason for the change"): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "Project stage" });
  await dialog.getByRole("radio", { name: new RegExp(esc(STAGE_LABEL[stage])) }).check();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByLabel(/Why is the stage/).fill(reason);
  await dialog.getByRole("button", { name: /^Save v[\d.]+ and change the stage/ }).click();
  const summary = page.getByTestId("stage-summary");
  await expect(summary).toBeVisible();
  return summary;
}

/** Open the dialog from the header chip and change the stage. */
export async function chooseStage(page: Page, stage: StageKey, reason?: string): Promise<Locator> {
  await page.getByTestId("stage-chip").click();
  return pickAndSave(page, stage, reason);
}

/** Leave the summary: "Later" when a review is offered, "Close" otherwise. Nothing starts the review by accident. */
export async function dismissSummary(page: Page) {
  const summary = page.getByTestId("stage-summary");
  await summary.getByRole("button", { name: /^(Later|Close)$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
