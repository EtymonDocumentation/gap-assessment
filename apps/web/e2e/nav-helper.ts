import { expect, type Page } from "@playwright/test";

/** The six gap assessment pages. They live in the step bar (and its Back / Next buttons), not in the top menu. */
const STEP_PATHS: Record<string, string> = {
  Scope: "/scope",
  Interview: "/interview",
  "Side by side": "/compare",
  "Gap register": "/register",
  Validation: "/validation",
  Document: "/document",
};

/**
 * Opens a page by its menu name, whatever the layout: a top link (Home, Gap assessment, My files), a link inside the Documents or Library
 * drop-down, or on a phone inside the Menu panel. The six step pages are reached by address, because the step bar is only a compact line
 * on a phone; the step bar itself is covered in nav.spec.ts.
 */
export async function goTo(page: Page, label: string): Promise<void> {
  const stepPath = STEP_PATHS[label];
  if (stepPath) {
    await page.evaluate((h) => (window.location.hash = h), stepPath);
    return;
  }
  const name = label === "Project" ? "Home" : label;
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name, exact: true });
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  } else if (!(await link.isVisible())) {
    for (const group of ["Documents", "Library"]) {
      const button = nav.getByRole("button", { name: new RegExp(`^${group}`) });
      await button.click();
      if (await link.isVisible()) break;
      await button.click();
    }
  }
  await expect(link).toBeVisible();
  await link.click();
}

/** Asserts a module's entry is absent from the whole menu (every drop-down opened, or the phone Menu panel), not just hidden because a drop-down is closed. */
export async function expectNoMenuEntry(page: Page, label: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) {
    await menu.click();
  } else {
    for (const group of ["Documents", "Library"]) await nav.getByRole("button", { name: new RegExp(`^${group}`) }).click();
  }
  await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
}
