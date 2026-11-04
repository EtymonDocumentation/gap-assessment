import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { randomInt } from "node:crypto";
import { expectNotice, isPhone, NOTICE_DOCUMENT, openDemo } from "../e2e/nav-helper";
import { INVITES_PER_WORKER, SAMPLING_INVITES_PER_WORKER } from "./global-setup";

// The notice wording and its check are shared with the static suite (e2e/nav-helper.ts), which reads them from the app's own source module.
export { expectNotice, isPhone, NOTICE_DOCUMENT };
export const PASSWORD = "correct horse battery staple";
export const SERVER_URL = "http://localhost:8788/";
export const CLIENT_URL = "http://localhost:8789/";

/** Anything that went wrong in a page: script errors and Content Security Policy violations. */
export interface Problems {
  pageErrors: string[];
  csp: string[];
}

/** Starts listening on a page. Called for every page a test opens. */
export function watch(page: Page, problems: Problems): void {
  page.on("pageerror", (e) => problems.pageErrors.push(e.message));
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("[csp] ")) problems.csp.push(text.slice(6));
    else if (m.type() === "error" && /Content Security Policy/i.test(text)) problems.csp.push(text);
  });
}

// A different made-up client address for every test, so the server's per-address limits (for example 10 sign-ups an hour)
// never get in the way. The server trusts X-Forwarded-For because the browser reaches it from the same computer, as the
// Tailscale proxy does.
const fakeIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

export const test = base.extend<{ problems: Problems; clientIp: string }>({
  clientIp: async ({}, use) => {
    await use(fakeIp());
  },
  extraHTTPHeaders: async ({ clientIp }, use) => {
    await use({ "X-Forwarded-For": clientIp });
  },
  problems: async ({ context }, use) => {
    const problems: Problems = { pageErrors: [], csp: [] };
    // Report every Content Security Policy violation to the console, where watch() counts it.
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        console.error(`[csp] ${e.violatedDirective} blocked ${e.blockedURI || "inline code"}`);
      });
    });
    await use(problems);
    expect(problems.pageErrors, "page errors").toEqual([]);
    expect(problems.csp, "Content Security Policy violations").toEqual([]);
  },
  page: async ({ page, problems }, use) => {
    watch(page, problems);
    await use(page);
  },
});

export { expect };

/** A second, separate browser (no shared cookies), as if on another computer. */
export async function otherComputer(browser: Browser, info: TestInfo, problems: Problems, baseURL = SERVER_URL): Promise<Page> {
  const { viewport, hasTouch, isMobile, userAgent } = info.project.use;
  const context = await browser.newContext({
    baseURL,
    acceptDownloads: true,
    extraHTTPHeaders: { "X-Forwarded-For": fakeIp() },
    ...(viewport ? { viewport } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(userAgent ? { userAgent } : {}),
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`[csp] ${e.violatedDirective} blocked ${e.blockedURI || "inline code"}`);
    });
  });
  const page = await context.newPage();
  watch(page, problems);
  return page;
}

// ------------------------------------------------------------------ the admin tool

let taken = 0;

/** The next unused invite code. They were made with the admin tool before the server started (see global-setup.ts). */
export function makeInvite(which: "server" | "client" = "server"): string {
  const pool = JSON.parse((which === "client" ? process.env.GAP_E2E_INVITES_CLIENT : process.env.GAP_E2E_INVITES_SERVER) ?? "[]") as string[];
  if (taken >= INVITES_PER_WORKER) throw new Error("This test worker has used all its invite codes.");
  const code = pool[test.info().workerIndex * INVITES_PER_WORKER + taken++];
  if (!code) throw new Error("There are no invite codes left: too many test workers were started.");
  return code;
}

let takenSampling = 0;

/** An invite code whose account includes the sampling module. */
export function makeSamplingInvite(): string {
  const pool = JSON.parse(process.env.GAP_E2E_INVITES_SAMPLING ?? "[]") as string[];
  if (takenSampling >= SAMPLING_INVITES_PER_WORKER) throw new Error("This test worker has used all its sampling invite codes.");
  const code = pool[test.info().workerIndex * SAMPLING_INVITES_PER_WORKER + takenSampling++];
  if (!code) throw new Error("There are no sampling invite codes left: too many test workers were started.");
  return code;
}

// ------------------------------------------------------------------ signing in

export interface Account {
  username: string;
  displayName: string;
  password: string;
}

export function newAccount(label: string): Account {
  const suffix = randomInt(100000, 999999);
  return { username: `${label}-${suffix}`, displayName: `Tester ${label} ${suffix} (fictional)`, password: PASSWORD };
}

/**
 * The account block: who is signed in, Change password and Sign out. On a wide screen it is the pop-over of the initials circle at the
 * right of the header; on a phone it is inside the Menu panel. Opens it when it is closed and returns it.
 */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const toggle = isPhone(page) ? page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Menu" }) : page.getByRole("button", { name: /, account: / });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const block = page.locator(".account-details");
  await expect(block).toBeVisible();
  return block;
}

/** Closes the account block again (Escape), so nothing is left covering the page. */
export async function closeAccountMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-details")).toHaveCount(0);
}

/**
 * The account name is shown as the one signed in: the initials circle is named after it (its name starts with the initials it shows:
 * "AE, account: Alex Example"), and the account block says "Signed in as ...".
 */
export async function expectSignedInAs(page: Page, displayName: string): Promise<void> {
  if (!isPhone(page)) await expect(page.getByRole("button", { name: `, account: ${displayName}` })).toBeVisible();
  const block = await openAccountMenu(page);
  await expect(block).toContainText(`Signed in as ${displayName}`);
  await closeAccountMenu(page);
}

export async function signOut(page: Page): Promise<void> {
  const block = await openAccountMenu(page);
  await block.getByRole("button", { name: "Sign out" }).click();
}

/**
 * "Saved to server" is shown for the open project: in the header on a wide screen, inside the Menu panel on a phone (a failed save also
 * shows on its own line under the header, so it never waits behind a closed menu).
 */
export async function expectSaved(page: Page): Promise<void> {
  const saved = page.getByRole("status").filter({ hasText: "Saved to server" });
  if (!isPhone(page)) {
    await expect(saved).toBeVisible();
    return;
  }
  const toggle = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Menu" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(saved).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(saved).toHaveCount(0);
}

export async function signUp(page: Page, account: Account, invite = makeInvite()): Promise<void> {
  await page.goto("./");
  const form = page.getByRole("form", { name: "Have an invite code? Create account" });
  await form.getByLabel("Invite code").fill(invite);
  await form.getByLabel("Choose a username").fill(account.username);
  await form.getByLabel("Display name").fill(account.displayName);
  await form.getByLabel("Choose a password", { exact: true }).fill(account.password);
  await form.getByLabel("Confirm password", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Create account" }).click();
  await expectSignedInAs(page, account.displayName);
}

export async function signIn(page: Page, account: Account, password = account.password): Promise<void> {
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Username").fill(account.username);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
}

export async function signInFresh(page: Page, account: Account): Promise<void> {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, account);
  await expectSignedInAs(page, account.displayName);
}

// ------------------------------------------------------------------ the app

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

export async function startProject(page: Page, title: string): Promise<void> {
  await go(page, "#/");
  await page.getByRole("button", { name: "Start a new project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project title").fill(title);
  await dialog.getByLabel("Responder name").fill("A. Reviewer (fictional)");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "What does this assessment cover?" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to the interview" }).click();
  await expect(page.locator("#q-prompt")).toHaveText("Program or product code");
}

/** Answers the first question with text, then each further question with "TBD". */
export async function answerFirst(page: Page, text: string): Promise<void> {
  await page.locator(".question-card input").first().fill(text);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText("Program or product code");
}

export async function answerTbd(page: Page): Promise<void> {
  const before = await page.locator("#q-prompt").textContent();
  await page.getByRole("button", { name: "TBD (to be decided)" }).click();
  await expect(page.locator("#q-prompt")).not.toHaveText(before ?? "");
}

export async function loadDemo(page: Page): Promise<void> {
  await go(page, "#/");
  await openDemo(page, "arx", "#/register");
  await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();
}

/** The revision the server holds for the project with this title (0 when there is none). */
export async function serverRevision(page: Page, title: string): Promise<number> {
  const r = await page.request.get("/api/projects");
  const list = ((await r.json()) as { projects: { title: string; revision: number }[] }).projects;
  return list.find((p) => p.title === title)?.revision ?? 0;
}

/** "Questions answered" on the Project page, as a number. */
export async function answeredCount(page: Page): Promise<number> {
  await go(page, "#/");
  const dd = page.locator("dt", { hasText: "Questions answered" }).locator("+ dd");
  await expect(dd).toBeVisible();
  // "5 of 43 answered, 38 still open (3 to be decided)": a "to be decided" answer is a response, so it counts here, though it stays open.
  const text = (await dd.textContent()) ?? "";
  return Number(/^(\d+) of/.exec(text)?.[1]) + Number(/\((\d+) to be decided\)/.exec(text)?.[1] ?? 0);
}

// ------------------------------------------------------------------ quality checks

export async function expectAccessible(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(report, label).toBe("");
}

/** axe in the light colour scheme and then in the dark one (the app follows the browser's setting), leaving the page light again. */
export async function expectAccessibleInBothThemes(page: Page, label: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${label} (${scheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

/**
 * The same check for a test that resizes the window half way. The header picks its phone or desktop form in a media-query listener, so for a
 * frame or two after the resize it is still the old form and pokes out of the new, narrower screen (the account button, 16 px; seen in 14 of 30
 * immediate measurements). That passing state is not a defect, so this waits for it to pass, and still fails, with the label, when something is
 * really wider than the screen once the page has settled.
 */
export async function expectNoHorizontalScrollOnceSettled(page: Page, label: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${label}: page scrolls sideways`, timeout: 5_000 })
    .toBeLessThanOrEqual(1);
}

/** Rename / Copy / Delete sit in a row's "..." menu (job H1): open the menu in the My projects list, then pick the item. */
export async function projectAction(page: import("@playwright/test").Page, title: string, action: "Rename" | "Copy" | "Delete"): Promise<void> {
  const list = page.getByRole("list", { name: "My projects" });
  await list.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
  await list.getByRole("menuitem", { name: `${action} ${title}`, exact: true }).click();
}
