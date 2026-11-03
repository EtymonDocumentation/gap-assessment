// A point added to the sampling plan after the batch record was made is not lost. The record lists it among its open items, the author adds
// it in one click (its sample row, and its sampling step where the block names the place for that moment), and the Process view shows it at
// its step. Until then the Process view makes one note that the record and its plan differ. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openDemo } from "./nav-helper";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

const pointIds = (page: Page) => page.locator('[data-testid^="point-SP-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("point-", "")));

/** Opens the sampling plan of the syringe demo and returns the number of the point added there. `step` is a word of the diagram step it is added on. */
async function addPointToPlan(page: Page, step: RegExp | undefined, timing: string | undefined): Promise<string> {
  await goTo(page, "Sampling plan");
  await page.getByTestId("plan-list").getByRole("link").first().click();
  await expect(page.getByTestId("points-table")).toBeVisible();
  const known = await pointIds(page);
  await page.getByTestId("add-sample").click();
  if (step) {
    const labels = await page.getByTestId("add-step").locator("option").allTextContents();
    const label = labels.find((l) => step.test(l));
    expect(label, `a step of the plan is called like ${step}`).toBeTruthy();
    await page.getByTestId("add-step").selectOption({ label });
  }
  await page.getByTestId("add-type").selectOption("ipc");
  await page.getByTestId("add-what").fill("Appearance check added to the plan (fictional)");
  await page.getByTestId("add-submit").click();
  const id = (await pointIds(page)).find((i) => !known.includes(i))!;
  expect(id).toBeTruthy();
  if (timing) {
    await page.getByTestId(`card-open-${id}`).click();
    await expect(page.getByTestId("point-dialog")).toBeVisible();
    const all = page.getByTestId("point-expand-all");
    if ((await all.getAttribute("aria-pressed")) !== "true") await all.click();
    await page.getByTestId(`timing-${timing}`).check();
    // The form is a draft until it is saved (an incomplete point can be saved: it stays an open item of the plan); saving leaves the dialog open.
    await page.getByTestId("point-save").click();
    await expect(page.getByText(`Point ${id} saved`)).toHaveCount(1);
    await page.getByTestId("point-dialog").getByRole("button", { name: /^(Cancel|Close)$/ }).click();
    await expect(page.getByTestId("point-dialog")).toHaveCount(0);
  }
  return id;
}

async function openRecord(page: Page) {
  await goTo(page, "Batch record");
  await page.getByTestId("mbr-list-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const report = result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
    expect(report, `${label}, ${scheme}`).toBe("");
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** Walks the Process view to the moment that takes the sample (the marker's own data does not say where it is). */
async function goToSample(page: Page, pointId: string) {
  const count = await page.getByTestId("pv-jump").locator("option").count();
  for (let i = 0; i < count; i++) {
    await page.getByTestId("pv-jump").selectOption({ value: String(i) });
    if ((await page.getByTestId("pv-samples-now").count()) > 0 && (await page.getByTestId("pv-samples-now").textContent())?.includes(pointId)) return;
  }
  throw new Error(`no moment takes ${pointId}`);
}

test("a point added to the plan is listed in the record, added in one click with its step, and shown in the Process view", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toBeVisible();

  // The demo record covers its plan: one open item (a value to enter before issue), nothing about the plan.
  await openRecord(page);
  await expect(page.getByTestId("mbr-open-items")).toContainText("Open items (1)");
  await expect(page.getByTestId("mbr-open-items")).not.toContainText("In the sampling plan, not in this batch record");

  // The plan gains a point at the start of mixing, after the record was made.
  const id = await addPointToPlan(page, /compounding/i, "beginning");

  await openRecord(page);
  const open = page.getByTestId("mbr-open-items");
  await expect(open).toContainText("Open items (2)");
  const item = open.getByRole("listitem").filter({ hasText: `In the sampling plan, not in this batch record: ${id}` });
  await expect(item).toHaveCount(1);
  const add = item.getByRole("button", { name: /^Add to / });
  await expect(add).toHaveCount(1);
  await expect(add).toHaveAccessibleName(new RegExp(`^Add to .+: sample ${id}$`));
  await expectAccessible(page, "batch record with the plan point left out");

  // While the record leaves the point out, the Process view says so once, in a note, and links back to the record.
  await page.getByTestId("mbr-tab-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  const note = page.getByTestId("pv-findings").locator("article.pv-find", { hasText: "The batch record and its sampling plan differ" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("0 rows changed, 1 point missing");
  await expect(note).toContainText("The picture shows the batch record as written.");
  await expect(note.locator("h3")).toContainText("Note");
  await note.getByRole("link", { name: "Open the batch record" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /MBR-001/ })).toBeVisible();

  // Add: the item goes, the count is back to what it was, and the record holds the row and the step that tells when to take it.
  await item.getByRole("button", { name: /^Add to / }).click();
  await expect(open).toContainText("Open items (1)");
  await expect(open).not.toContainText("In the sampling plan, not in this batch record");
  await page.getByTestId("mbr-blocks-toggle-all").click();
  // The last section ("Batch record review") has no unit operation, so it lists every plan point as a picker option:
  // the section that now holds the row is the one whose heading names the compounding step, so look only there.
  const section = page.locator('[data-testid^="mbr-section-"]', { has: page.getByRole("heading", { level: 3, name: /Pooling, compounding and dilution/ }) });
  await expect(section).toHaveCount(1);
  const step = section.locator(".mbr-step-text", { hasText: new RegExp(`^Take sample ${id} `) });
  await expect(step).toHaveCount(1);
  await expect(step).toContainText("at the start of mixing");
  await expect(section.getByRole("row", { name: new RegExp(`^${id} `) })).toHaveCount(1);
  await expect(page.locator(".mbr-step-text", { hasText: new RegExp(`^Take sample ${id} `) })).toHaveCount(1);

  // The Process view shows the sample at that step, and the note is gone.
  await page.getByTestId("mbr-tab-view").click();
  await expect(page.getByTestId("pv-page")).toBeVisible();
  await expect(page.getByTestId("pv-findings")).not.toContainText("The batch record and its sampling plan differ");
  await goToSample(page, id);
  await expect(page.getByTestId(`pv-mark-${id}`)).toHaveAttribute("data-state", "now");
  await expect(page.getByTestId("pv-samples-now")).toContainText(/Step \d/);
  await expect(page.getByTestId("pv-samples-now")).not.toContainText("On the hold entry");
  await expectAccessible(page, "process view after the point was added");
});

test("a point that names no step of the process is 'choose where': the author is taken to the sections and nothing is added", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "syr");
  await expect(page.getByTestId("home-chain")).toBeVisible();
  const id = await addPointToPlan(page, undefined, undefined);

  await openRecord(page);
  const open = page.getByTestId("mbr-open-items");
  await expect(open).toContainText("Open items (2)");
  const item = open.getByRole("listitem").filter({ hasText: `In the sampling plan, not in this batch record: ${id}` });
  await expect(item).toContainText("Choose where");
  // Several sections could take it, so no section is picked for the author: there is no "Add to" button, only a way to the sections.
  await expect(item.getByRole("button", { name: /^Add to / })).toHaveCount(0);
  await item.getByRole("button", { name: /^Go to the sections/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Sections" })).toBeFocused();
  await expect(open).toContainText("Open items (2)");
  await expectAccessible(page, "batch record with a point to place");
});
