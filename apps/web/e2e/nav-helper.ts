import { expect, type Page } from "@playwright/test";
// The product module has no imports of its own, so the specs read the very words the app and the documents are built from.
import {
  NOTICE_DOCUMENT,
  NOTICE_FOOTER,
  NOTICE_STRIP,
  NOTICE_STRIP_PHONE,
  PRODUCT_NAME,
  PRODUCT_SUBTITLE,
  STORAGE_PHRASE_BROWSER,
  STORAGE_PHRASE_SERVER,
} from "../../../packages/engine/src/product";

export { NOTICE_DOCUMENT, NOTICE_FOOTER, NOTICE_STRIP, NOTICE_STRIP_PHONE, PRODUCT_NAME, PRODUCT_SUBTITLE, STORAGE_PHRASE_BROWSER, STORAGE_PHRASE_SERVER };

/** The width (px) up to which the app uses its phone layout: PHONE_WIDTH in src/viewport.ts. */
export const PHONE_MAX_WIDTH = 700;

/** True when the page is at a phone width: the menu is one button, the notice strip is the short one, the chain strip is one line. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= PHONE_MAX_WIDTH;
}

/**
 * The notice strip is on screen with the wording for this width (the long form with a storage phrase on a wide screen, the three-fact
 * short form on a phone). `storage` is the phrase that follows on a wide screen ("Data stays in this browser.").
 */
export async function expectNotice(page: Page, storage?: string): Promise<void> {
  const strip = page.getByTestId("notice-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(isPhone(page) ? NOTICE_STRIP_PHONE : NOTICE_STRIP);
  if (storage && !isPhone(page)) await expect(strip).toContainText(storage);
}

/** Chooses a colour theme in the header's theme menu, then closes the menu (Escape sends focus back to the theme button). */
export async function setTheme(page: Page, theme: "System" | "Light" | "Dark"): Promise<void> {
  await page.getByRole("button", { name: /^Colour theme/ }).click();
  await page.getByRole("radio", { name: theme, exact: true }).check();
  await page.keyboard.press("Escape");
}

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
