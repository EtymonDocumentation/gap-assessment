// Website art: a banner on every page, unit-operation pictures and close-ups in the interview, pictures load, no sideways scroll,
// accessibility, title contrast over the picture, print. Runs on the desktop, tablet and phone projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const BANNER = "Proof of concept. Not validated. Not for GMP use.";

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

/** The picture has really been fetched and decoded (a wrong path would leave naturalWidth at 0). */
async function expectLoaded(img: Locator, label: string) {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { message: `${label}: picture did not load` }).toBeGreaterThan(0);
}

/**
 * Worst-case contrast of the banner title over the picture. The title text is hidden, the area under it is photographed, and the
 * lowest contrast between any pixel there and the title colour is computed, so the scrim is checked as it really renders.
 */
async function worstTitleContrast(page: Page, banner: Locator): Promise<number> {
  const title = banner.locator("h1, .art-banner-title").first();
  const box = await title.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rects = [...r.getClientRects()];
    const x1 = Math.min(...rects.map((q) => q.left));
    const y1 = Math.min(...rects.map((q) => q.top));
    const x2 = Math.max(...rects.map((q) => q.right));
    const y2 = Math.max(...rects.map((q) => q.bottom));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, color: getComputedStyle(el).color };
  });
  await title.evaluate((el) => ((el as HTMLElement).style.color = "transparent"));
  const shot = (await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } })).toString("base64");
  await title.evaluate((el) => ((el as HTMLElement).style.color = ""));
  return page.evaluate(
    async ({ shot, color }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const lum = (r: number, g: number, b: number) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [tr, tg, tb] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number) as [number, number, number];
      const lt = lum(tr, tg, tb);
      let worst = Infinity;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) {
        const lb = lum(d[i]!, d[i + 1]!, d[i + 2]!);
        worst = Math.min(worst, (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05));
      }
      return worst;
    },
    { shot, color: box.color },
  );
}

/** Every page with a banner: route, the art key in the banner, and whether a project is needed. */
const PAGES = [
  { hash: "#/", art: "page-home-hero", name: "Home" },
  { hash: "#/interview", art: "page-interview", name: "Interview" },
  { hash: "#/compare", art: "page-compare", name: "Side by side" },
  { hash: "#/register", art: "page-register", name: "Gap register" },
  { hash: "#/validation", art: "page-validation", name: "Validation" },
  { hash: "#/document", art: "page-document", name: "Document" },
  { hash: "#/templates", art: "page-templates", name: "Templates" },
  { hash: "#/guidance", art: "page-guidance", name: "Guidance" },
  { hash: "#/builder", art: "page-builder", name: "Builder" },
  { hash: "#/sources", art: "page-sources", name: "Sources" },
  { hash: "#/changes", art: "page-changes", name: "Change log" },
] as const;

// One test per page, so a failure names the page and no single test runs a long chain of axe scans.
for (const p of PAGES) {
  test(`${p.name}: banner, picture loads, nothing scrolls sideways, axe clean, title readable in light and dark`, async ({ page }, info) => {
    // Two axe scans and two screenshots on the heaviest pages (Builder, Document) take longer than the default 30 s.
    test.setTimeout(90_000);
    await loadDemo(page);
    await go(page, p.hash);
    const banner = page.locator(`.art-banner[data-art="${p.art}"]`);
    await expect(banner, p.name).toBeVisible();
    await expectLoaded(banner.locator("img"), p.name);
    // The picture is decoration: no text alternative, hidden from assistive technology.
    await expect(banner.locator("img")).toHaveAttribute("alt", "");
    await expect(banner.locator(".art-banner-img")).toHaveAttribute("aria-hidden", "true");
    if (info.project.name === "phone") expect((await banner.boundingBox())!.height, `${p.name}: banner on a phone`).toBeLessThanOrEqual(121);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoHorizontalScroll(page, `${p.name}, ${scheme}`);
      await expectAccessible(page, `${p.name}, ${scheme}`);
      expect(await worstTitleContrast(page, banner), `${p.name}, ${scheme}: title contrast over the picture`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("the home hero is larger than the other banners and loads first", async ({ page }, info) => {
  await page.goto("./");
  const hero = page.locator('.art-banner[data-art="page-home-hero"]');
  await expect(hero).toBeVisible();
  const img = hero.locator("img");
  await expect(img).toHaveAttribute("loading", "eager");
  await expect(img).toHaveAttribute("fetchpriority", "high");
  await expect(img).toHaveAttribute("srcset", /-800\.webp 800w, .*-1600\.webp 1600w/);
  // Size attributes reserve the space, so the page does not jump when the picture arrives.
  await expect(img).toHaveAttribute("width", "1600");
  await expect(img).toHaveAttribute("height", "893");
  if (info.project.name === "desktop") {
    const heroHeight = (await hero.boundingBox())!.height;
    await loadDemo(page);
    await go(page, "#/compare");
    const other = (await page.locator('.art-banner[data-art="page-compare"]').boundingBox())!.height;
    expect(heroHeight).toBeGreaterThan(other);
    // Other banners are lazy.
    await expect(page.locator('.art-banner[data-art="page-compare"] img')).toHaveAttribute("loading", "lazy");
  }
});

test("a template's heading mapping page has the mapping banner", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/templates");
  await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 sample templates added" })).toBeVisible();
  await page.locator("article.card", { hasText: "SOP-style template" }).getByRole("link", { name: /^Create mapping/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Heading mapping:/ })).toBeVisible();
  const banner = page.locator('.art-banner[data-art="page-mapping"]');
  await expect(banner).toBeVisible();
  await expectLoaded(banner.locator("img"), "mapping");
  await expectNoHorizontalScroll(page, "mapping");
  await expectAccessible(page, "mapping");
  expect(await worstTitleContrast(page, banner)).toBeGreaterThanOrEqual(4.5);
});

test("interview: the unit-operation picture and the PUPSIT close-up sit with the sterile filtration questions, and the form stays near the top", async ({ page }, info) => {
  await loadDemo(page);
  await go(page, "#/interview?q=filt.pupsit%40source");
  const card = page.locator("article.question-card");
  await expect(card.getByRole("heading", { level: 1 })).toBeVisible();
  const uo = card.locator('.art-fig[data-art="uo-sterile-filtration"]');
  await expect(uo).toBeAttached();
  await expect(uo).toHaveAttribute("aria-hidden", "true");
  await expectLoaded(uo.locator("img"), "unit operation picture");
  const closeup = card.locator('.art-fig[data-art="uo-pupsit"]');
  if (info.project.name === "phone") {
    // Narrow screens leave the close-up out so the form comes first.
    await expect(closeup).toBeHidden();
  } else {
    await expect(closeup).toBeVisible();
    await expectLoaded(closeup.locator("img"), "PUPSIT close-up");
  }
  // The form is not pushed far down: its first input starts within the first two screens even with the slim banner above.
  const firstField = card.locator("form input, form select, form textarea").first();
  const y = (await firstField.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
  expect(y).toBeLessThan(info.project.name === "phone" ? 1100 : 900);
  await expectNoHorizontalScroll(page, "interview card");
  await expectAccessible(page, "interview card");

  // A question with no obvious match has the section picture but no close-up.
  await go(page, "#/interview?q=filt.bioburden_limit%40source");
  await expect(page.locator('article.question-card .art-fig[data-art="uo-sterile-filtration"]')).toBeAttached();
  await expect(page.locator("article.question-card .art-closeup")).toHaveCount(0);
});

test("interview: the section summary shows the unit-operation picture; stoppering and lyophilization share one", async ({ page }, info) => {
  await loadDemo(page);
  await go(page, "#/interview?summary=uo.aseptic_filling");
  await expect(page.getByRole("heading", { level: 1, name: /^Section summary/ })).toBeVisible();
  const fig = page.locator('article .art-fig[data-art="uo-aseptic-filling"]');
  await expect(fig).toBeAttached();
  if (info.project.name !== "phone") await expectLoaded(fig.locator("img"), "summary picture");
  await go(page, "#/interview?summary=uo.lyophilization");
  await expect(page.locator('article .art-fig[data-art="uo-stoppering-lyo"]')).toBeAttached();
});

test("builder: unit-operation sections carry their small picture", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/builder");
  await expect(page.getByRole("heading", { level: 1, name: "Builder" })).toBeVisible();
  const figs = page.locator(".builder-section .art-uo");
  expect(await figs.count()).toBeGreaterThan(3);
  await expectLoaded(figs.first().locator("img"), "builder thumbnail");
  await expectNoHorizontalScroll(page, "builder");
});

test("print hides every banner and picture", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/document");
  await expect(page.locator(".art-banner")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".art-banner")).toBeHidden();
  await go(page, "#/interview?q=filt.pupsit%40source");
  await expect(page.locator(".art-fig").first()).toBeHidden();
  await expect(page.locator(".art-banner")).toBeHidden();
});

test("no picture carries text: all art is decoration (empty alt)", async ({ page }) => {
  await loadDemo(page);
  await go(page, "#/interview?q=filt.pupsit%40source");
  await expect(page.locator("main img")).not.toHaveCount(0);
  const withAlt = await page.locator("main img:not([alt=''])").count();
  expect(withAlt).toBe(0);
});
