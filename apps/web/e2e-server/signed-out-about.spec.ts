// The sign-in screen and the About and privacy page (Tester D row 21, showcase audit row 7, fix job D1). A visitor who has no account yet
// can read what the site stores, which cookie it sets and how to get access, before asking for an invite.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_URL, expect, expectAccessibleInBothThemes, expectNoHorizontalScroll, expectNoHorizontalScrollOnceSettled, expectNotice, newAccount, signUp, test } from "./helpers";

type Page = import("@playwright/test").Page;

const aboutHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "About and privacy" });

test("sign-in says where an invite code comes from, has a colour button, and starts near the top at 390 and 1280 px", async ({ page }, info) => {
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const at = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.goto("./");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Ask the person who invited you for an invite code.")).toBeVisible();
    await expectNotice(page);
    // The form is the point of the page: its first field and its button are on the first screen, not under a tall picture.
    const username = (await page.getByRole("form", { name: "Sign in" }).getByLabel("Username").boundingBox())!;
    expect(username.y + username.height, `${at}: the username field is on the first screen`).toBeLessThanOrEqual(size.height);
    if (size.width >= 1000) {
      const button = (await page.getByRole("form", { name: "Sign in" }).getByRole("button", { name: "Sign in" }).boundingBox())!;
      expect(button.y + button.height, `${at}: the Sign in button is on the first screen`).toBeLessThanOrEqual(size.height);
    }
    await expectNoHorizontalScroll(page, `sign-in at ${at}`);
    // Pictures for the fix job's report (one run is enough).
    if (info.project.name === "desktop") await page.screenshot({ path: join(tmpdir(), size.width === 390 ? "fixd1-21-after-390.png" : "fixd1-21-after.png") });
  }
  await expectAccessibleInBothThemes(page, "sign-in page");
});

test("the colour button works before signing in and the choice is kept", async ({ page }) => {
  await page.goto("./");
  const button = page.getByRole("button", { name: /^Colour theme: / });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-label", "Colour theme: System");
  await button.click();
  // Three choices named in words, so the picture on the button is never the only cue.
  for (const name of ["System", "Light", "Dark"]) await expect(page.getByRole("radio", { name })).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Colour theme: Dark" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The About page is drawn in the same colours.
  await page.goto("./#/about");
  await expect(aboutHeading(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Colour theme: Dark" }).click();
  await page.getByRole("radio", { name: "System" }).check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("About and privacy opens without an account from the form and from the footer, says what is verifiably true, and sets no cookie", async ({ page, context }, info) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:8788/") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) outside.push(r.url());
  });
  await page.goto("./");
  // The link is under the form and in the footer, on the sign-in page.
  await expect(page.getByRole("link", { name: "About and privacy" })).toHaveCount(2);
  await expect(page.getByRole("form", { name: "Sign in" }).getByRole("link", { name: "About and privacy" })).toBeVisible();
  await page.getByRole("form", { name: "Sign in" }).getByRole("link", { name: "About and privacy" }).click();
  await expect(aboutHeading(page)).toBeVisible();
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  await expectNotice(page);

  // The topics, each a heading, in the order a person asks the questions.
  const topics = ["What Cascade is", "Who runs this copy", "What is stored, and where", "Cookies", "Analytics and tracking", "Deleting your data", "Getting access"];
  for (const topic of topics) await expect(page.getByRole("heading", { level: 2, name: topic })).toBeVisible();
  const about = page.getByTestId("about-privacy");
  await expect(about).toContainText("It is a drafting aid and it is not validated.");
  await expect(about).toContainText("The tool never determines regulatory filing categories.");
  await expect(about).toContainText("the site owner");
  await expect(about).toContainText("does not ask for an email address");
  await expect(about).toContainText("gap_session");
  await expect(about).toContainText("no analytics, no advertising and no tracking");
  await expect(about).toContainText("Ask the person who invited you for an invite code");
  // No name or address of a person anywhere on it.
  expect(await about.innerText()).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);

  // Nothing was set before signing in, and nothing was fetched from another website.
  expect(await context.cookies(), "no cookie before signing in").toEqual([]);
  expect(outside, "requests to other websites").toEqual([]);
  await expectAccessibleInBothThemes(page, "about page signed out");
  if (info.project.name === "desktop") await page.screenshot({ path: join(tmpdir(), "fixd1-audit7-after.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScrollOnceSettled(page, "about page signed out at 390 px");
  await expectAccessibleInBothThemes(page, "about page signed out at 390 px");

  // The way back, and a direct link, both work with no account.
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "About and privacy" }).click();
  await expect(aboutHeading(page)).toBeVisible();
  await page.goto("./#/about");
  await page.reload();
  await expect(aboutHeading(page)).toBeVisible();
});

test("signed in, the same page is in the app and the only cookie is the one it names", async ({ page, context }) => {
  await signUp(page, newAccount("about"));
  expect((await context.cookies()).map((c) => c.name)).toEqual(["gap_session"]);
  await page.getByRole("contentinfo").getByRole("link", { name: "About and privacy" }).click();
  await expect(aboutHeading(page)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  // This copy keeps projects on the server, and the page says so.
  await expect(page.getByTestId("about-stored")).toContainText("All of it is kept on the computer that hosts this copy");
  await expect(page.getByTestId("about-delete")).toContainText("Delete next to it in My projects");
  await expectAccessibleInBothThemes(page, "about page signed in");
});

test("on a server that keeps projects in the browser the page says projects stay in this browser", async ({ page }) => {
  await page.goto(CLIENT_URL);
  await expect(page.getByText("Your projects and documents stay in this browser; the server holds only your account.")).toBeVisible();
  await page.goto(`${CLIENT_URL}#/about`);
  await expect(aboutHeading(page)).toBeVisible();
  await expect(page.getByTestId("about-stored")).toContainText("stay in this browser");
  await expect(page.getByTestId("about-stored")).toContainText("My files is not available on this copy");
  await expect(page.getByTestId("about-stored")).not.toContainText("All of it is kept on the computer that hosts this copy");
});
