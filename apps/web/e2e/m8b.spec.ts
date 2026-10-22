// Milestone 8 follow-ups: the method library edits scales and bands itself (new versions with history), an assessment is told when the
// library has a newer version and updates only on request (with the rescoring shown), and the risk Word output uses the Templates
// library. All data are fictional.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";
const SHOTS = tmpdir();

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
});

async function loadDemo(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Load demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

async function go(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

async function openDemoAssessment(page: Page, tab: "method" | "items" | "actions" | "output") {
  await loadDemo(page);
  await go(page, "#/risk");
  await expect(page.getByTestId("risk-scope-text")).toBeVisible();
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await expect(page.getByTestId("risk-tabs")).toBeVisible();
  await page.getByTestId(`risk-tab-${tab}`).click();
}

async function openLibrary(page: Page) {
  await go(page, "#/risk/methods");
  await expect(page.getByRole("heading", { level: 1, name: "Risk methods" })).toBeVisible();
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

async function download(page: Page, testId: string): Promise<{ file: string; bytes: Buffer }> {
  const [dl] = (await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTestId(testId).click();
      const anyway = page.getByRole("button", { name: "Download anyway" });
      if (await anyway.isVisible().catch(() => false)) await anyway.click();
    })(),
  ])) as [Download, void];
  return { file: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

function wordText(bytes: Buffer): string {
  const xml = new PizZip(bytes).file("word/document.xml")!.asText();
  return xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
}

/** A new method in the library from a load-out, saved as version 1. */
async function newFromLoadout(page: Page, loadout: string, name: string, version = "1") {
  await page.getByTestId("method-new").click();
  await page.getByTestId(`lib-loadout-${loadout}`).click();
  await page.getByTestId("method-name").fill(name);
  await page.getByTestId("method-version").fill(version);
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText(`Saved ${name}, version ${version}`);
}

test("new method from a load-out: scales, bands and levels are edited in the library, and each save is a new version with history", async ({ page }) => {
  await loadDemo(page);
  await openLibrary(page);
  await newFromLoadout(page, "fmea-1-5", "QRM-METH-010 (fictional)");
  await expect(page.getByTestId("methods-list")).toContainText("QRM-METH-010 (fictional)");

  // The load-out supplies the scale range only: no bands are invented.
  await expect(page.getByTestId("scale-Severity-max")).toHaveValue("5");
  await page.getByTestId("scale-Severity-max").fill("10");
  await page.getByTestId("band-add").click();
  await page.getByTestId("band-label-0").fill("Review needed (fictional wording)");
  await page.getByTestId("band-min-0").fill("1");
  await page.getByTestId("band-max-0").fill("500");
  await page.getByTestId("method-version").fill("2");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 2");
  await expect(page.getByTestId("methods-list")).toContainText("2");

  // History keeps the earlier content.
  await page.getByTestId("method-history").locator("summary").click();
  await expect(page.getByTestId("method-history")).toContainText("created");
  await expect(page.getByTestId("method-history")).toContainText("edited");
  await expect(page.getByTestId("method-history")).toContainText("scales, bands or labels were changed");

  // It is stored: after a reload the edited scale and the band are there.
  await page.reload();
  await openLibrary(page);
  await page.getByRole("button", { name: "Edit QRM-METH-010 (fictional)" }).click();
  await expect(page.getByTestId("scale-Severity-max")).toHaveValue("10");
  await expect(page.getByTestId("band-label-0")).toHaveValue("Review needed (fictional wording)");
});

test("a new method can start blank, for each kind, and band problems are shown as in an assessment, and an error blocks saving", async ({ page }) => {
  await loadDemo(page);
  await openLibrary(page);
  await page.getByTestId("method-new").click();
  await page.getByTestId("lib-blank-fmea").click();
  await page.getByTestId("method-name").fill("Blank FMEA (fictional)");
  await page.getByTestId("method-version").fill("1");
  await page.getByTestId("scale-Severity-min").fill("1");
  await page.getByTestId("scale-Severity-max").fill("5");
  await page.getByTestId("scale-Occurrence-min").fill("1");
  await page.getByTestId("scale-Occurrence-max").fill("5");
  await page.getByTestId("scale-Detection-min").fill("1");
  await page.getByTestId("scale-Detection-max").fill("5");
  // Two bands that overlap are an open item (shown, not blocking); a band without a label is an error that blocks the save.
  await page.getByTestId("band-add").click();
  await page.getByTestId("band-add").click();
  await page.getByTestId("band-label-0").fill("A (fictional)");
  await page.getByTestId("band-min-0").fill("1");
  await page.getByTestId("band-max-0").fill("50");
  await page.getByTestId("band-label-1").fill("B (fictional)");
  await page.getByTestId("band-min-1").fill("40");
  await page.getByTestId("band-max-1").fill("125");
  await expect(page.getByTestId("method-problems")).toContainText(/overlap/i);
  await expect(page.getByTestId("method-save")).toBeEnabled();
  await page.getByTestId("band-label-1").fill("");
  await expect(page.getByTestId("method-problems")).toContainText("A band needs a label");
  await expect(page.getByTestId("method-save")).toBeDisabled();
  await page.getByTestId("band-label-1").fill("B (fictional)");
  await page.getByTestId("band-min-1").fill("51");
  await expect(page.getByTestId("method-save")).toBeEnabled();
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("Saved Blank FMEA (fictional), version 1");
});

test("matrix, custom and qualitative methods can be created and edited in the library", async ({ page }) => {
  await loadDemo(page);
  await openLibrary(page);
  await newFromLoadout(page, "matrix-3x3", "Matrix (fictional)");
  // Matrix labels are the user's to change cell by cell.
  await expect(page.getByTestId("mx-cell-0-0")).toBeVisible();
  await page.getByTestId("mx-cell-0-0").fill("Minimal (fictional)");
  await page.getByTestId("method-version").fill("2");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 2");

  await newFromLoadout(page, "qualitative-hml", "Qualitative (fictional)");
  await expect(page.getByTestId("ql-label-0")).toBeVisible();
  await page.getByTestId("ql-label-0").fill("Very low (fictional)");
  await page.getByTestId("method-version").fill("2");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 2");

  await page.getByTestId("method-new").click();
  await page.getByTestId("lib-blank-custom").click();
  await page.getByTestId("method-name").fill("Custom (fictional)");
  await page.getByTestId("method-version").fill("1");
  await expect(page.getByTestId("factor-add")).toBeVisible();
  await page.getByTestId("factor-add").click();
  await page.getByTestId("factor-name-0").fill("Exposure (fictional)");
  await expect(page.getByTestId("method-editor")).toBeVisible();

  await expect(page.getByTestId("methods-list")).toContainText("Matrix (fictional)");
  await expect(page.getByTestId("methods-list")).toContainText("Qualitative (fictional)");
});

test("the same version number with changed content is allowed with a visible notice", async ({ page }) => {
  await loadDemo(page);
  await openLibrary(page);
  await newFromLoadout(page, "fmea-1-5", "Same version (fictional)");
  await page.getByTestId("scale-Detection-max").fill("9");
  await expect(page.getByTestId("method-same-version")).toBeVisible();
  await expect(page.getByTestId("method-save")).toBeEnabled();
  await page.getByTestId("method-version").fill("1.1");
  await expect(page.getByTestId("method-same-version")).toHaveCount(0);
});

test("an assessment keeps its copy; the library's newer version is announced and applied only on request, with the rescoring and the change log", async ({ page }) => {
  await openDemoAssessment(page, "method");
  // The demo's method is a copy. Save it to the library as version 1: the assessment is linked to it.
  await page.getByTestId("risk-library-name").fill("QRM-METH-020 (fictional)");
  await page.getByTestId("risk-library-version").fill("1");
  await page.getByTestId("risk-library-save").click();
  await expect(page.getByTestId("risk-library-msg")).toContainText("version 1");
  await expect(page.getByTestId("risk-method-libref")).toContainText("version 1");
  await expect(page.getByTestId("risk-method-newer")).toHaveCount(0);

  // Version 2 in the library: bands that give the demo's scores a label.
  await openLibrary(page);
  await page.getByRole("button", { name: "Edit QRM-METH-020 (fictional)" }).click();
  await page.getByTestId("band-add").click();
  await page.getByTestId("band-label-0").fill("Reviewed first (fictional wording)");
  await page.getByTestId("band-min-0").fill("1");
  await page.getByTestId("band-max-0").fill("1000");
  await page.getByTestId("method-version").fill("2");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("methods-message")).toContainText("version 2");

  // The assessment still has its own copy and says so.
  await go(page, "#/risk");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-method").click();
  await expect(page.getByTestId("risk-method-newer")).toContainText("Library has v2; this assessment uses v1");
  await expect(page.getByTestId("risk-method-summary")).toContainText("No bands defined by the user");

  // Nothing changes until the person confirms; the dialog lists what would read differently.
  await page.getByTestId("risk-method-update").click();
  await expect(page.getByTestId("risk-method-update-dialog")).toBeVisible();
  await expect(page.getByTestId("risk-update-rescore")).toBeVisible();
  await expect(page.getByTestId("risk-method-update-dialog")).toContainText("Reviewed first (fictional wording)");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("risk-method-update-dialog")).toHaveCount(0);
  await expect(page.getByTestId("risk-method-newer")).toBeVisible();

  await page.getByTestId("risk-method-update").click();
  await page.getByTestId("risk-method-update-confirm").click();
  await expect(page.getByTestId("risk-method-newer")).toHaveCount(0);
  await expect(page.getByTestId("risk-method-libref")).toContainText("version 2");
  await expect(page.getByTestId("risk-method-summary")).toContainText("Reviewed first (fictional wording)");

  // The update is in the change log, with the reason.
  await go(page, "#/changes");
  await expect(page.getByText(/Updated from the library: QRM-METH-020 \(fictional\), version 1 to version 2/).first()).toBeVisible();
});

test("the risk Output tab offers the Templates library; their look and placeholder tags give a Word file that names the template", async ({ page }) => {
  test.setTimeout(120_000);
  await loadDemo(page);
  await go(page, "#/templates");
  await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible({ timeout: 30_000 });
  await go(page, "#/risk");
  await page.getByTestId("risk-list").getByRole("link").first().click();
  await page.getByTestId("risk-tab-output").click();

  // "Map to their headings" is a gap-document feature, so it is not offered; the note says why.
  await expect(page.getByRole("radio", { name: /^Map to their headings/ })).toHaveCount(0);
  await expect(page.getByTestId("risk-word-note")).toBeVisible();

  await page.getByRole("radio", { name: /^Their look/ }).check();
  const look = await download(page, "risk-download-word");
  expect(look.file).toMatch(/^risk-assessment-.*\.docx$/);
  const lookText = wordText(look.bytes);
  expect(lookText).toContain(BANNER);
  expect(lookText).toContain("Risk register");
  expect(new PizZip(look.bytes).file("docProps/custom.xml")!.asText()).toContain("their_look");

  const history = page.getByRole("region", { name: "Export history table" });
  await expect(history.getByRole("cell", { name: "Risk assessment (Word)" })).toBeVisible();
  await expect(history.locator("tbody")).toContainText("SOP-style template");

  await page.getByRole("radio", { name: /^Placeholder tags/ }).check();
  await expect(page.getByTestId("risk-download-word")).toBeEnabled();
  const tags = await download(page, "risk-download-word");
  expect(wordText(tags.bytes)).toContain(BANNER);
  expect(new PizZip(tags.bytes).file("docProps/custom.xml")!.asText()).toContain("tags");
});

for (const scheme of ["light", "dark"] as const) {
  test(`method library editor, version note and template picker are accessible with no sideways scroll: ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const shot = (name: string) => page.screenshot({ path: join(SHOTS, `m8b-${name}-${test.info().project.name}-${scheme}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: scheme });
    await loadDemo(page);
    await go(page, "#/templates");
    await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible({ timeout: 30_000 });

    await openLibrary(page);
    await page.getByTestId("method-new").click();
    await expectAccessible(page, `${scheme} new method starters`);
    await page.getByTestId("lib-loadout-fmea-1-10").click();
    await page.getByTestId("method-name").fill("Library method FMEA (fictional)");
    await page.getByTestId("method-version").fill("1");
    await page.getByTestId("band-add").click();
    await page.getByTestId("band-label-0").fill("Reviewed first (fictional wording)");
    await page.getByTestId("band-min-0").fill("1");
    await page.getByTestId("band-max-0").fill("1000");
    await expectAccessible(page, `${scheme} library editor fmea`);
    await expectNoHorizontalScroll(page, `${scheme} library editor fmea`);
    await shot("library-fmea");
    await page.getByTestId("method-save").click();
    await expect(page.getByTestId("methods-message")).toContainText("Saved");
    await page.getByTestId("method-history").locator("summary").click();
    await expectAccessible(page, `${scheme} library editor with history`);

    for (const [id, name, label] of [
      ["matrix-3x3", "Library method matrix (fictional)", "matrix"],
      ["qualitative-hml", "Library method qualitative (fictional)", "qualitative"],
    ] as const) {
      await page.getByTestId("method-new").click();
      await page.getByTestId(`lib-loadout-${id}`).click();
      await page.getByTestId("method-name").fill(name);
      await page.getByTestId("method-version").fill("1");
      await expectAccessible(page, `${scheme} library editor ${label}`);
      await expectNoHorizontalScroll(page, `${scheme} library editor ${label}`);
      await shot(`library-${label}`);
      await page.getByTestId("method-save").click();
      await expect(page.getByTestId("methods-message")).toContainText("Saved");
    }

    await page.getByTestId("method-new").click();
    await page.getByTestId("lib-blank-custom").click();
    await page.getByTestId("method-name").fill("Library method custom (fictional)");
    await page.getByTestId("method-version").fill("1");
    await page.getByTestId("factor-add").click();
    await page.getByTestId("factor-name-0").fill("Exposure (fictional)");
    await expectAccessible(page, `${scheme} library editor custom`);
    await expectNoHorizontalScroll(page, `${scheme} library editor custom`);
    await shot("library-custom");

    // The version note and the update dialog in an assessment.
    await go(page, "#/risk");
    await page.getByTestId("risk-list").getByRole("link").first().click();
    await page.getByTestId("risk-tab-method").click();
    await page.getByTestId("risk-library-name").fill("Linked method (fictional)");
    await page.getByTestId("risk-library-version").fill("1");
    await page.getByTestId("risk-library-save").click();
    await expect(page.getByTestId("risk-library-msg")).toBeVisible();
    await openLibrary(page);
    await page.getByRole("button", { name: "Edit Linked method (fictional)" }).click();
    await page.getByTestId("band-add").click();
    await page.getByTestId("band-label-0").fill("Reviewed first (fictional wording)");
    await page.getByTestId("band-min-0").fill("1");
    await page.getByTestId("band-max-0").fill("1000");
    await page.getByTestId("method-version").fill("2");
    await page.getByTestId("method-save").click();
    await expect(page.getByTestId("methods-message")).toContainText("version 2");
    await go(page, "#/risk");
    await page.getByTestId("risk-list").getByRole("link").first().click();
    await page.getByTestId("risk-tab-method").click();
    await expect(page.getByTestId("risk-method-newer")).toBeVisible();
    await expectAccessible(page, `${scheme} version note`);
    await expectNoHorizontalScroll(page, `${scheme} version note`);
    await shot("version-note");
    await page.getByTestId("risk-method-update").click();
    await expect(page.getByTestId("risk-method-update-dialog")).toBeVisible();
    await expectAccessible(page, `${scheme} update dialog`);
    await shot("update-dialog");
    await page.keyboard.press("Escape");

    await page.getByTestId("risk-tab-output").click();
    await page.getByRole("radio", { name: /^Their look/ }).check();
    await expect(page.getByTestId("risk-download-word")).toBeVisible();
    await expectAccessible(page, `${scheme} output template picker`);
    await expectNoHorizontalScroll(page, `${scheme} output template picker`);
    await shot("output-template");
  });
}
