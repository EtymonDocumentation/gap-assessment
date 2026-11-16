// Polish leftovers: the Home tour bubble covers no card (1280 px), the step "Your documents" names the documents the page shows, and a TRD interview view
// named only by the address is remembered like a click on its radio button. Fictional data only.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { isPhone, openDemo } from "./nav-helper";

const SHOTS = process.env["POLISH_SHOTS"];
const hash = (page: Page, h: string) => page.evaluate((x) => (window.location.hash = x), h);

test.describe("the Home tour", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the bubble covers no card on any step, and Your documents names the cards on the page", async ({ page }) => {
    test.skip(isPhone(page), "the bubble is docked at the bottom on a phone");
    await page.addInitScript(() => localStorage.setItem("gap-tour-force", "1"));
    await page.goto("./");
    const bubble = page.getByTestId("tour-bubble");
    await expect(bubble).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await expect(bubble).toBeVisible();
      await page.waitForTimeout(1200); // smooth scrolling finishes, the page moves once more to make room, then the bubble is placed again
      const title = await bubble.locator(".tour-title").innerText();
      const hits = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="tour-bubble"]')!.getBoundingClientRect();
        const el = document.querySelector<HTMLElement>(".tour-target");
        return Array.from(document.querySelectorAll<HTMLElement>(".card, .doc-card"))
          .filter((c) => c !== el && !(el && (c.contains(el) || el.contains(c))) && c.getClientRects().length > 0)
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return Math.min(b.right, r.right) - Math.max(b.left, r.left) > 0 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0;
          })
          .map((c) => c.getAttribute("data-testid") ?? c.className);
      });
      // "Your documents" points at a card as wide and tall as the page's column: there is no free place beside, above or below it that is not
      // another card, so it may rest on the card after it. Every other step covers no card at all, and no step covers a card inside its own element.
      // That holds whenever the element and the bubble fit in the window together, one under the other (the tour moves the page so that they
      // do). With a font that makes them taller than the window, nothing can fit and the bubble docks at the bottom edge: the continuous
      // integration machine has other fonts than a Windows laptop, so the check must not hang on a few pixels of text height.
      const { inside, fits } = await page.evaluate(() => {
        const bubbleEl = document.querySelector<HTMLElement>('[data-testid="tour-bubble"]')!;
        const b = bubbleEl.getBoundingClientRect();
        const el = document.querySelector<HTMLElement>(".tour-target")!;
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        return {
          fits: margin + el.getBoundingClientRect().height + 12 + b.height + 8 <= window.innerHeight,
          inside: Array.from(el.querySelectorAll<HTMLElement>(".card, .doc-card")).filter((c) => {
            const r = c.getBoundingClientRect();
            return Math.min(b.right, r.right) - Math.max(b.left, r.left) > 0 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0;
          }).length,
        };
      });
      if (fits) expect(inside, `step "${title}" covers a card inside its own element`).toBe(0);
      if (title !== "Your documents") expect(hits, `step "${title}" covers another card`).toEqual([]);
      if (title === "Your documents") {
        const names = await page.getByTestId("home-chain").getByRole("heading", { level: 3 }).allInnerTexts();
        const text = await bubble.locator(".tour-text").innerText();
        for (const n of names) expect(text.toLowerCase(), `names ${n}`).toContain(n.toLowerCase());
        if (SHOTS) await page.screenshot({ path: join(SHOTS, "polish-tour-your-documents.png") });
      }
      const next = bubble.getByRole("button", { name: "Next" });
      if (!(await next.count())) break;
      await next.click();
    }
  });
});

test("a view named only by the address is remembered for the next visit", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./");
  await openDemo(page, "arx", "#/register");
  await hash(page, "#/trd?trd=TRD-001&tab=interview&view=areas");
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-view-areas")).toBeChecked();
  // The same page without the view in its address opens the view the address chose, not the list.
  await hash(page, "#/trd?trd=TRD-001&tab=interview");
  await page.reload();
  await expect(page.getByTestId("trd-interview")).toBeVisible();
  await expect(page.getByTestId("iv-view-areas")).toBeChecked();
});
