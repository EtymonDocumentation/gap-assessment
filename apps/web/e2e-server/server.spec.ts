// Milestone 5.3: the app in server mode, against the real server (storage "server" on 8788, storage "client" on 8789).
// Every test also fails on a script error or a Content Security Policy violation (see helpers.ts).
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANNER,
  CLIENT_URL,
  answerFirst,
  answerTbd,
  answeredCount,
  expect,
  expectAccessible,
  expectNoHorizontalScroll,
  go,
  loadDemo,
  makeInvite,
  newAccount,
  otherComputer,
  serverRevision,
  signIn,
  signInFresh,
  signUp,
  startProject,
  test,
} from "./helpers";

const FIXTURES = new URL("../../../packages/docx/fixtures/", import.meta.url);
const fixture = (name: string) => fileURLToPath(new URL(name, FIXTURES));

const status = (page: import("@playwright/test").Page, text: string) => page.getByRole("status").filter({ hasText: text });

test("sign-up with an invite, sign out, a wrong password, sign in again", async ({ page, browser, problems }, info) => {
  await page.goto("./");
  // The sign-in page carries the banner and the rules.
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expect(page.getByText("Use at least 7 characters.")).toBeVisible();

  const account = newAccount("signup");
  const invite = makeInvite();
  const form = page.getByRole("form", { name: "Have an invite code? Create account" });

  // Mistakes are explained before anything is sent.
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByRole("alert")).toContainText("invite code");
  await form.getByLabel("Invite code").fill(invite);
  await form.getByLabel("Choose a username").fill(account.username);
  await form.getByLabel("Display name").fill(account.displayName);
  await form.getByLabel("Choose a password", { exact: true }).fill("short");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByRole("alert")).toContainText("at least 7 characters");

  // A wrong invite code gives one plain answer.
  await form.getByLabel("Choose a password", { exact: true }).fill(account.password);
  await form.getByLabel("Confirm password", { exact: true }).fill(account.password);
  await form.getByLabel("Invite code").fill("AAAAA-AAAAA-AAAAA-AAAAA");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(page.getByText(`Signed in as`)).toHaveCount(0);

  await form.getByLabel("Invite code").fill(invite);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Signed in as ${account.displayName}`)).toBeVisible();
  await expect(page.getByText("Plan: Trial (free) · Modules: Gap assessment")).toBeVisible();
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "My projects" })).toBeVisible();
  await expect(page.getByText("You have no saved projects yet.")).toBeVisible();

  // The same invite cannot be used twice.
  const second = await otherComputer(browser, info, problems);
  const again = second.getByRole("form", { name: "Have an invite code? Create account" });
  await second.goto("./");
  await again.getByLabel("Invite code").fill(invite);
  await again.getByLabel("Choose a username").fill(`${account.username}-b`);
  await again.getByLabel("Display name").fill("Second Tester (fictional)");
  await again.getByLabel("Choose a password", { exact: true }).fill(account.password);
  await again.getByLabel("Confirm password", { exact: true }).fill(account.password);
  await again.getByRole("button", { name: "Create account" }).click();
  await expect(again.getByRole("alert")).toBeVisible();
  await second.context().close();

  // Sign out, then a wrong password, then the right one.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText("You have signed out.")).toBeVisible();
  await expect(page.getByText(BANNER).first()).toBeVisible();
  await signIn(page, account, "this is not the password");
  const signin = page.getByRole("form", { name: "Sign in" });
  await expect(signin.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Signed in as")).toHaveCount(0);
  await signIn(page, account);
  await expect(page.getByText(`Signed in as ${account.displayName}`)).toBeVisible();

  // The session survives a reload.
  await page.reload();
  await expect(page.getByText(`Signed in as ${account.displayName}`)).toBeVisible();
});

test("change password signs the other computer out", async ({ page, browser, problems }, info) => {
  const account = newAccount("pw");
  await signUp(page, account);
  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);

  await page.getByRole("button", { name: "Change password" }).click();
  const dialog = page.getByRole("dialog", { name: "Change password" });
  await dialog.getByLabel("Current password").fill(account.password);
  await dialog.getByLabel("New password", { exact: true }).fill("a brand new long passphrase");
  await dialog.getByLabel("Confirm new password").fill("a different long passphrase");
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not the same");
  await dialog.getByLabel("Confirm new password").fill("a brand new long passphrase");
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog.getByRole("status")).toContainText("Your password was changed.");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  // The other computer has been signed out: its next request sends it back to the sign-in page.
  await other.reload();
  await expect(other.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(other, account, "a brand new long passphrase");
  await expect(other.getByText(`Signed in as ${account.displayName}`)).toBeVisible();
  await other.context().close();
});

test("a project saves as you work, and a fresh browser shows it after signing in", async ({ page, browser, problems }, info) => {
  const account = newAccount("save");
  const title = `Autosave ${account.username} (fictional)`;
  await signUp(page, account);

  await startProject(page, title);
  // A new project is saved straight away.
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();

  const before = await serverRevision(page, title);
  await answerFirst(page, "SAVE-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(before);
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();

  // Another computer, signing in for the first time, finds and opens it.
  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await expect(other.getByRole("list", { name: "My projects" })).toContainText(title);
  await other.getByRole("button", { name: `Open ${title}` }).click();
  await expect(other.getByText("Open now")).toBeVisible();
  await go(other, "#/builder");
  await expect(other.locator("main")).toContainText("SAVE-1");

  // The demo is a project of its own on the server; the first project is still listed.
  await loadDemo(page);
  await go(page, "#/");
  await expect(page.getByRole("list", { name: "My projects" })).toContainText(title);
  await expect(page.getByRole("list", { name: "My projects" }).getByRole("listitem")).toHaveCount(2);

  // Closing a project returns to the list; deleting asks first and names the project.
  await page.getByRole("button", { name: "Close project" }).click();
  await expect(page.getByText("Open now")).toHaveCount(0);
  await page.getByRole("button", { name: `Delete ${title}` }).click();
  const confirm = page.getByRole("dialog", { name: `Delete ${title}?` });
  await expect(confirm).toContainText("trash folder");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("list", { name: "My projects" })).toContainText(title);
  await page.getByRole("button", { name: `Delete ${title}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
  await expect(page.getByRole("list", { name: "My projects" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "My projects" })).not.toContainText(title);

  // Import creates a project of its own on the server as well: export the demo, import it back.
  await loadDemo(page);
  await go(page, "#/");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export project (JSON)" }).click()]);
  const file = await readFile((await json.path())!);
  await go(page, "#/");
  await page.getByRole("button", { name: "Close project" }).click();
  await page.getByLabel("Project JSON file to import").setInputFiles({ name: "imported.json", mimeType: "application/json", buffer: file });
  await expect(page.getByRole("heading", { level: 1, name: "Interview" })).toBeVisible();
  await go(page, "#/");
  await expect(page.getByRole("list", { name: "My projects" }).getByRole("listitem")).toHaveCount(3);
  await other.context().close();
});

test("two computers editing the same project: the conflict dialog offers both ways out", async ({ page, browser, problems }, info) => {
  const account = newAccount("conflict");
  const title = `Conflict ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "CONFLICT-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(1);

  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await other.getByRole("button", { name: `Open ${title}` }).click();
  await expect(other.getByText("Open now")).toBeVisible();
  await go(other, "#/interview");
  await expect(other.locator("#q-prompt")).toBeVisible();

  // The first computer moves on: three more answers.
  for (let i = 0; i < 3; i++) await answerTbd(page);
  const latest = await serverRevision(page, title);
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThanOrEqual(latest);
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  const mine = await answeredCount(page);

  // The second computer answers from the old version: its save is refused and it must choose.
  await answerTbd(other);
  const dialog = other.getByRole("dialog", { name: "This project was changed on another computer" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nothing is changed until you choose.");
  await expect(other.getByText("Not saved: this project was changed on another computer")).toBeVisible();

  // Load the newer version: the unsaved change is downloaded first.
  const [download] = await Promise.all([other.waitForEvent("download"), dialog.getByRole("button", { name: /^Load the newer version/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/unsaved.*\.json$/);
  const saved = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(saved.meta.title).toBe(title);
  await expect(dialog).toBeHidden();
  await expect(other.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  expect(await answeredCount(other)).toBe(mine);

  // Again: the first computer moves on twice, the second answers once and chooses Keep mine.
  await go(page, "#/interview");
  await answerTbd(page);
  await answerTbd(page);
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  const afterA = await serverRevision(page, title);
  await go(other, "#/interview");
  await answerTbd(other);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep mine (overwrite)" }).click();
  await expect(dialog).toBeHidden();
  await expect(other.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  expect(await serverRevision(other, title)).toBeGreaterThan(afterA);
  // The server now holds the second computer's version: one answer more than before, not two.
  await page.reload();
  expect(await answeredCount(page)).toBe(mine + 1);
  await other.context().close();
});

test("when the session ends, the app returns to sign-in and the unsaved change is kept", async ({ page, browser, problems }, info) => {
  const account = newAccount("expire");
  const title = `Expire ${account.username} (fictional)`;
  await signUp(page, account);
  await startProject(page, title);
  await answerFirst(page, "EXPIRE-1");
  await expect.poll(() => serverRevision(page, title)).toBeGreaterThan(1);
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();

  // The password is changed from another computer, which signs this one out; the next save finds out.
  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  const changed = await other.request.post("/api/auth/password", {
    headers: { "X-Gap-Request": "1" },
    data: { currentPassword: account.password, newPassword: "an entirely different passphrase" },
  });
  expect(changed.status()).toBe(204);
  await other.context().close();
  account.password = "an entirely different passphrase";
  await answerTbd(page);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /signed out|session/i })).toBeVisible();
  await expect(page.getByText(BANNER).first()).toBeVisible();

  // Signing in again brings the project back with the change that had not been saved.
  await signIn(page, account);
  await expect(page.getByText(`Signed in as ${account.displayName}`)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved to server" })).toBeVisible();
  expect(await answeredCount(page)).toBe(2);
});

test("templates are kept on the server and follow the account", async ({ page, browser, problems }, info) => {
  const account = newAccount("tmpl");
  await signUp(page, account);
  await go(page, "#/templates");
  await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();

  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-template.docx"));
  const form = page.getByRole("form", { name: /^Add brightwater-template\.docx/ });
  await form.getByLabel("Name").fill("Server SOP (fictional)");
  await form.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();

  // Nothing is held in this browser's own library any more.
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Templates in this browser" })).toHaveCount(0);
  const local = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("gap-templates");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("templates")) return resolve(0);
          const count = db.transaction("templates").objectStore("templates").count();
          count.onsuccess = () => resolve(count.result);
        };
        open.onerror = () => resolve(-1);
      }),
  );
  expect(local).toBe(0);

  // Rename it; another computer sees the new name and can use the template for a Word document.
  await page.getByRole("button", { name: /^Rename \/ version of Server SOP/ }).click();
  const dlg = page.getByRole("dialog", { name: /^Rename/ });
  await dlg.getByLabel("Name").fill("Server SOP renamed (fictional)");
  await dlg.getByLabel(/^Version/).fill("2");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  const other = await otherComputer(browser, info, problems);
  await signInFresh(other, account);
  await go(other, "#/templates");
  await expect(other.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  const card = other.locator("article.card", { hasText: "Server SOP renamed (fictional)" });
  await expect(card).toContainText("Version 2");

  // Deleting asks first and names the template.
  await card.getByRole("button", { name: "Delete Server SOP renamed (fictional)" }).click();
  await other.getByRole("dialog").getByRole("button", { name: "Delete template" }).click();
  await expect(other.getByRole("heading", { level: 2, name: "Library (0)" })).toBeVisible();
  await other.context().close();
});

test("templates still in this browser are offered for upload, and removed only when asked", async ({ page }) => {
  const account = newAccount("lib");
  await signUp(page, account);
  await go(page, "#/templates");
  await page.getByLabel(/^Template file/).setInputFiles(fixture("brightwater-tags.docx"));
  await page.getByRole("form", { name: /^Add brightwater-tags\.docx/ }).getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();

  // Move that template into this browser's own library (as an earlier visit to the static demo would have left it) and off the server.
  await page.evaluate(async () => {
    const hdr = { "X-Gap-Request": "1" };
    const { templates } = (await (await fetch("/api/templates")).json()) as { templates: { id: string }[] };
    const t = templates[0]!;
    const bytes = new Uint8Array(await (await fetch(`/api/templates/${t.id}/file`)).arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("gap-templates", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("templates")) open.result.createObjectStore("templates");
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("templates", "readwrite");
        tx.objectStore("templates").put({ ...t, bytes }, t.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    await fetch(`/api/templates/${t.id}`, { method: "DELETE", headers: hdr });
  });
  await page.reload();
  await go(page, "#/templates");
  await expect(page.getByRole("heading", { level: 2, name: "Library (0)" })).toBeVisible();

  const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Templates in this browser" }) });
  await expect(panel).toContainText("This browser has 1 template that is not on the server yet.");
  await panel.getByRole("button", { name: "Upload them" }).click();
  await expect(panel.getByRole("status")).toContainText("1 template was uploaded to the server");
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  // Uploading never removes the browser copy by itself.
  await page.reload();
  await expect(panel).toContainText("This browser has 1 template that is not on the server yet");

  // Uploading again finds it already there; only then is the removal offered, and only on request.
  await panel.getByRole("button", { name: "Upload them" }).click();
  await expect(panel.getByRole("status")).toContainText("already there");
  await panel.getByRole("button", { name: "Remove the browser copies" }).click();
  await expect(panel.getByRole("status")).toContainText("The copies in this browser were removed.");
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Library (1)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Templates in this browser" })).toHaveCount(0);
});

test("a file attached to a document reference is kept as a real file, and can be downloaded and removed", async ({ page }) => {
  test.setTimeout(120_000);
  const account = newAccount("files");
  await signUp(page, account);
  await loadDemo(page);
  await go(page, "#/sources");
  await expect(page.getByRole("heading", { level: 1, name: /Sources/ })).toBeVisible();

  await page.getByRole("button", { name: "Add document reference" }).click();
  const add = page.getByRole("dialog", { name: "Add document reference" });
  await add.getByLabel("Document type").fill("PPQ report");
  await add.getByLabel("Identifier").fill("DEMO-PPQ-999");
  await add.getByRole("button", { name: "Add document reference" }).click();
  await expect(add).toBeHidden();

  const row = page.locator("tr", { has: page.getByRole("button", { name: /^Attach file to .*DEMO-PPQ-999/ }) });
  const content = Buffer.from("Fictional report body.\nSecond line, with an accent: café.\n", "utf8");
  const sha = createHash("sha256").update(content).digest("hex");
  await row.getByLabel(/^File to attach to .*DEMO-PPQ-999/).setInputFiles({ name: "ppq report (final) é.txt", mimeType: "text/plain", buffer: content });
  const list = row.getByRole("list", { name: /^Files attached to / });
  await expect(list).toContainText("ppq report (final) é.txt");
  await expect(list).toContainText(`${content.length} bytes`);
  await expect(list.locator("code")).toHaveText(sha.slice(0, 12));
  await expect(list.locator("code")).toHaveAttribute("title", sha);

  // The Files section lists every file of the project and says where it is attached.
  const section = page.getByRole("region", { name: "Project files table" });
  await expect(page.getByRole("heading", { level: 2, name: "Files (1)" })).toBeVisible();
  await expect(section).toContainText("DEMO-PPQ-999");

  // Download: the very same bytes come back.
  const [download] = await Promise.all([page.waitForEvent("download"), list.getByRole("button", { name: /^Download / }).click()]);
  expect(download.suggestedFilename()).toBe("ppq report (final) é.txt");
  expect(Buffer.compare(await readFile((await download.path())!), content)).toBe(0);

  // The file survives a reload (it is on the server, not in the browser).
  await page.reload();
  await go(page, "#/sources");
  await expect(page.getByRole("list", { name: /^Files attached to / })).toContainText("ppq report (final)");

  // A file over the server's limit is refused with a plain message and nothing is listed.
  const big = join(await mkdtemp(join(tmpdir(), "gap-web53-big-")), "too-big.bin");
  await writeFile(big, Buffer.alloc(60 * 1024 * 1024));
  await page.getByLabel("File to add to the project").setInputFiles(big);
  await rm(dirname(big), { recursive: true, force: true }).catch(() => undefined);
  // The server reads and discards up to four times the limit after a 413, so Chrome gets the answer, not a closed connection.
  const tooBig = page.getByRole("alert").filter({ hasText: /larger than the 50 MB allowed/ });
  await expect(tooBig).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Files (1)" })).toBeVisible();

  // Removing asks first and names the file.
  await page.getByRole("list", { name: /^Files attached to / }).getByRole("button", { name: /^Remove / }).click();
  const confirm = page.getByRole("dialog", { name: /^Remove ppq report/ });
  await expect(confirm).toContainText("trash folder");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Files (1)" })).toBeVisible();
  await page.getByRole("list", { name: /^Files attached to / }).getByRole("button", { name: /^Remove / }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove file" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Files (0)" })).toBeVisible();
  await expect(page.getByText("No files are attached yet.")).toBeVisible();
});

test("Word and Markdown export work under the server's security policy", async ({ page, problems }) => {
  test.setTimeout(120_000);
  const account = newAccount("csp");
  await signUp(page, account);
  await loadDemo(page);
  await go(page, "#/document");
  const panel = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Word document" }) });
  await panel.getByRole("radio", { name: /^Built-in default/ }).check();
  const [word] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Download Word document" }).click()]);
  expect(word.suggestedFilename()).toMatch(/\.docx$/);
  expect((await readFile((await word.path())!)).subarray(0, 2).toString("latin1")).toBe("PK");
  const [md] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Markdown" }).click()]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);

  // Visit every page once: none may break the policy or throw.
  for (const hash of ["#/interview", "#/compare", "#/register", "#/validation", "#/builder", "#/sources", "#/changes", "#/templates"]) {
    await go(page, hash);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  expect(problems.csp).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
});

test("the security headers are on the app and the API", async ({ page }) => {
  const res = await page.goto("./");
  const csp = res!.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  const health = await page.request.get("/api/health");
  expect(await health.json()).toMatchObject({ ok: true, storage: "server" });
  expect(health.headers()["cache-control"]).toBe("no-store");
});

// ------------------------------------------------------------------ storage "client"

test.describe("storage mode client", () => {
  test.use({ baseURL: CLIENT_URL });

  test("only the account is on the server; projects and templates stay in the browser", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (/^\/api\/(projects|templates|files)/.test(u.pathname)) requests.push(`${r.method()} ${u.pathname}`);
    });

    await page.goto("./");
    await expect(page.getByText("Your projects and documents stay in this browser; the server holds only your account.").first()).toBeVisible();
    await expect(page.getByText(BANNER).first()).toBeVisible();
    await expectAccessible(page, "sign-in page, client storage");

    const account = newAccount("client");
    await signUp(page, account, makeInvite("client"));
    await expect(page.getByText("Plan: Trial (free)")).toBeVisible();
    await expect(page.locator(".account-bar")).toContainText("Your projects and documents stay in this browser; the server holds only your account.");
    // No "My projects" list and no save status: it behaves like the static app.
    await expect(page.getByRole("heading", { name: "My projects" })).toHaveCount(0);
    await expect(page.getByText("Saved to server")).toHaveCount(0);

    page.on("dialog", (d) => void d.accept());
    await loadDemo(page);
    await go(page, "#/templates");
    await page.getByRole("button", { name: "Add the fictional sample templates" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Templates in this browser" })).toHaveCount(0);
    await go(page, "#/sources");
    await expect(page.getByRole("heading", { level: 2, name: /^Files/ })).toHaveCount(0);

    // Reloading keeps the project and the templates (they are in this browser).
    await page.reload();
    await expect(page.getByText(`Signed in as ${account.displayName}`)).toBeVisible();
    await go(page, "#/templates");
    await expect(page.getByRole("heading", { level: 2, name: "Library (4)" })).toBeVisible();
    await go(page, "#/register");
    await expect(page.getByRole("heading", { level: 1, name: "Gap register" })).toBeVisible();

    // The server was never asked to store any of it.
    expect(requests).toEqual([]);
    const refused = await page.request.get("/api/projects");
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "client-storage" });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });
});
