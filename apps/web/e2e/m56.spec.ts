// Milestone 5.6: one not-known answer. TBD (to be determined) replaces "Unknown (to be confirmed)": one click saves it,
// details sit behind "Add details", an old project converts on load with change-log records, and no question offers a
// second way of saying "not known". Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const TBD_BUTTON = "TBD (to be determined)";
/** Wording that would be a second not-known answer. */
const NOT_KNOWN_WORDING = /\bunknown\b|to be confirmed|not yet known|not known|not decided/i;

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function loadDemo(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function newProject(page: Page) {
  await page.goto("./");
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill("TBD test (fictional)");
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
}

async function expectAccessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

const panel = (page: Page, side: "source" | "target"): Locator => page.locator(`fieldset.side-panel[data-side="${side}"]`);

test("one click saves a TBD with no details, on a one-sided question and on a paired one", async ({ page }) => {
  test.setTimeout(90_000);
  await newProject(page);
  // One click, no dialog and no required field: the interview moves on.
  await page.getByRole("button", { name: TBD_BUTTON }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText("Program or product code");
  await go(page, "#/tbd");
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("Program");
  // Nothing was filled in for the user: no best guess, owner, due date or note.
  await expect(row).not.toContainText("Overdue");

  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40source");
  await expect(page.locator("#q-prompt")).toHaveText("Filling pump operating principle");
  await panel(page, "source").getByRole("button", { name: TBD_BUTTON }).click();
  await go(page, "#/tbd");
  await expect(page.locator("tbody tr", { hasText: "Filling pump" })).toHaveCount(1);
  await expect(page.locator("[role=status].tbd-summary")).toContainText("5 TBD (1 overdue)");
  await expectAccessible(page, "TBD list after one-click TBD");
});

test("Add details opens an optional best guess, owner, due date and note; keyboard and screen reader friendly", async ({ page }) => {
  test.setTimeout(90_000);
  await loadDemo(page);
  await go(page, "#/interview?q=fill.pump%40source");
  const p = panel(page, "source");
  const toggle = p.getByRole("button", { name: "Add details" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(p.getByRole("group", { name: /^TBD details for SU/ })).toHaveCount(0);

  // Keyboard: focus the disclosure and press Enter.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const box = p.getByRole("group", { name: "TBD details for SU (all optional)" });
  await expect(box).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-controls", /^tbd-box-/);
  await expect(box.getByLabel("Owner (optional)")).toBeVisible();
  await expect(box.getByLabel("Due date (optional)")).toBeVisible();
  await expect(box.getByLabel("Note (optional)")).toBeVisible();
  await expectAccessible(page, "Add details open");
  await expectNoHorizontalScroll(page, "Add details open");

  await box.getByLabel("Owner (optional)").fill("Process lead (fictional)");
  await box.getByLabel("Note (optional)").fill("Vendor data expected next month");
  await box.getByRole("button", { name: "Record TBD with these details" }).click();
  await go(page, "#/tbd");
  const row = page.locator("tbody tr", { hasText: "Filling pump" });
  await expect(row).toContainText("Process lead (fictional)");
  await expect(row).toContainText("Vendor data expected next month");

  // Closing the disclosure hides the box again.
  await go(page, "#/interview?q=fill.pump%40source");
  const t2 = panel(page, "source").getByRole("button", { name: "Add details" });
  await t2.click();
  await t2.click();
  await expect(t2).toHaveAttribute("aria-expanded", "false");
});

test("the Home card says TBD and nowhere offers Unknown or 'to be confirmed'", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/");
  await expect(page.getByRole("link", { name: "4 TBD (1 overdue)" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\bunknown\b|to be confirmed/i);
  await expectAccessible(page, "Home with TBD card");
  await expectNoHorizontalScroll(page, "Home with TBD card");
});

test("an old project (schema 1.8.0, with Unknown answers) converts on import and the change log shows each conversion", async ({ page }) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  await go(page, "#/");
  const [dl] = (await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export project (JSON)" }).click()])) as [Download, void];
  const project = JSON.parse(await readFile((await dl.path())!, "utf8"));

  // Write the project the way a 1.8.0 build stored it: a TBD with no details at all was an Unknown entry.
  project.schemaVersion = "1.8.0";
  const entries: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const take = (fields: any) => entries.push(...Object.values<any>(fields ?? {})); // eslint-disable-line @typescript-eslint/no-explicit-any
  take(project.scope);
  for (const side of ["source", "target"]) {
    const m = project.processes[side];
    take(m.site.fields);
    for (const uo of Object.values<any>(m.unitOperations)) { // eslint-disable-line @typescript-eslint/no-explicit-any
      take(uo.fields);
      for (const coll of Object.values<any>(uo.collections)) for (const item of Object.values<any>(coll)) take(item.fields); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
  let unknowns = 0;
  for (const e of entries) {
    if (e.status === "tbd" && Object.keys(e.tbd ?? {}).length === 0) {
      e.status = "unknown";
      delete e.tbd;
      unknowns++;
    }
  }
  expect(unknowns).toBeGreaterThan(0);
  const oldLogLength = project.changeLog.length;

  await page.goto("./");
  await page.getByLabel("Project JSON file to import").setInputFiles({ name: "old-1.8.0.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByRole("heading", { level: 1, name: "Interview complete" })).toBeVisible();

  await go(page, "#/changes");
  const rows = page.locator("table.change-table tbody tr", { hasText: "System (file update)" });
  await expect(rows).toHaveCount(unknowns);
  await expect(rows.first()).toContainText("Status converted (file update)");
  await expect(rows.first()).toContainText("Unknown converted to TBD (schema 1.9.0, no change in meaning)");
  await expect(rows.first()).toContainText("Unknown"); // before: the old status, as recorded
  await expect(rows.first()).toContainText("To be determined (TBD)");
  await expectAccessible(page, "change log with conversion records");
  await expectNoHorizontalScroll(page, "change log with conversion records");

  // The converted project was saved: reloading does not convert (or log) a second time.
  await page.reload();
  await go(page, "#/changes");
  await expect(page.locator("table.change-table tbody tr", { hasText: "System (file update)" })).toHaveCount(unknowns);
  await expect(page.locator("table.change-table tbody tr")).toHaveCount(oldLogLength + unknowns);

  // Behaviour is the same: the Home card counts the same TBD entries as before.
  await go(page, "#/");
  await expect(page.getByRole("link", { name: "4 TBD (1 overdue)" })).toBeVisible();
});

// One question of each kind, on both sides where the question is paired. The control for "not known" is the TBD button,
// and nothing on the card is called Unknown, "to be confirmed" or "not yet known".
const WALK: { id: string; kind: string; paired: boolean }[] = [
  { id: "fill.pump", kind: "single select", paired: true },
  { id: "filt.integrity", kind: "multi select", paired: true },
  { id: "comp.vessel_capacity", kind: "number with unit", paired: true },
  { id: "comp.mixing_speed", kind: "composite parameter table", paired: true },
  { id: "site.labelling_location", kind: "scoping (labelling location)", paired: true },
  { id: "scope.modality", kind: "scoping (shared)", paired: false },
];

for (const q of WALK) {
  test(`${q.kind} (${q.id}): TBD control present, no Unknown control`, async ({ page }) => {
    test.setTimeout(90_000);
    await loadDemo(page);
    await go(page, `#/interview?q=${encodeURIComponent(q.id + "@" + (q.paired ? "source" : "shared"))}`);
    await expect(page.locator(".question-card")).toBeVisible();
    if (q.paired) {
      for (const side of ["source", "target"] as const) {
        const p = panel(page, side);
        await expect(p.getByRole("button", { name: TBD_BUTTON }), `${q.id} ${side}`).toBeVisible();
        await expect(p.getByRole("button", { name: NOT_KNOWN_WORDING })).toHaveCount(0);
        await expect(p.getByRole("radio", { name: NOT_KNOWN_WORDING })).toHaveCount(0);
        await expect(p.locator("option", { hasText: NOT_KNOWN_WORDING })).toHaveCount(0);
      }
    } else {
      await expect(page.getByRole("button", { name: TBD_BUTTON })).toBeVisible();
    }
    await expect(page.locator(".question-card")).not.toContainText(NOT_KNOWN_WORDING);
    await expect(page.getByRole("button", { name: NOT_KNOWN_WORDING })).toHaveCount(0);
    await expect(page.locator(".question-card .choice-chip", { hasText: NOT_KNOWN_WORDING })).toHaveCount(0);
    await expectAccessible(page, `${q.id} card`);
    await expectNoHorizontalScroll(page, `${q.id} card`);
  });
}
