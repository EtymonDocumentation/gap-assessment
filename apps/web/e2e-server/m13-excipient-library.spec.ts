// M13 job 3, server build: the excipient library is behind the "excipient" module, is kept on the server for the account that saved it, is not
// visible to another account, and refuses a body that is far too large. Fictional data only.
import type { Page } from "@playwright/test";
import { expect, go, makeSamplingInvite, newAccount, otherComputer, signUp, test, watch } from "./helpers";

/** One request to the library routes as the signed-in page makes them (same cookie, same-origin header). */
async function api(page: Page, method: string, path: string, body?: unknown, extra?: { bytes?: number; withHeader?: boolean }): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return page.evaluate(
    async ([m, p, b, x]) => {
      const opts = x as { bytes?: number; withHeader?: boolean };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opts.withHeader !== false) headers["X-Gap-Request"] = "1";
      const res = await fetch(p as string, { method: m as string, headers, body: opts.bytes ? " ".repeat(opts.bytes) : b === undefined ? undefined : JSON.stringify(b) });
      return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    [method, path, body, extra ?? {}] as const,
  );
}

const record = {
  id: "xl_surfactant_c",
  version: 1,
  name: "Surfactant C (fictional)",
  classKey: "surfactant",
  tests: [{ test: "Assay" }],
  prompts: [],
};

test("server build: an account without the excipient module has no library page and every library route refuses it", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, newAccount("noxl"));
  await go(page, "#/excipient/library");
  await expect(page.getByTestId("excipient-not-included")).toBeVisible();
  await expect(page.getByTestId("exl-page")).toHaveCount(0);
  const list = await api(page, "GET", "/api/excipient-library");
  expect(list.status).toBe(403);
  expect(list.json?.error).toBe("module-not-included");
  expect((await api(page, "PUT", `/api/excipient-library/${record.id}`, { record })).status).toBe(403);
  expect((await api(page, "DELETE", `/api/excipient-library/${record.id}`, { reason: "No longer needed" })).status).toBe(403);
});

test("server build: a saved excipient is kept on the server for the account, another account sees none of it, and oversize or unmarked requests are refused", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await signUp(page, newAccount("xl"), makeSamplingInvite());
  await go(page, "#/excipient/library");
  await expect(page.getByTestId("exl-page")).toBeVisible();

  // Save one in the page; it is still there after a reload (it came back from the server, not from this browser).
  await page.getByTestId("exl-new").click();
  await page.getByTestId("exl-name").fill("Buffer salt A (fictional)");
  await page.getByTestId("exl-class").selectOption({ index: 1 });
  await page.getByTestId("exl-test-add").click();
  await page.getByTestId("exl-test-name-0").fill("Assay");
  await page.getByTestId("exl-save").click();
  await expect(page.getByTestId("exl-message")).toContainText("version 1");
  await page.reload();
  await go(page, "#/excipient/library");
  await expect(page.getByTestId("exl-table")).toContainText("Buffer salt A (fictional)");

  // Another account, even with the module, sees none of it.
  const problems = { pageErrors: [] as string[], csp: [] as string[] };
  const other = await otherComputer(browser, info, problems);
  watch(other, problems);
  await signUp(other, newAccount("xl2"), makeSamplingInvite());
  const theirs = await api(other, "GET", "/api/excipient-library");
  expect(theirs.status).toBe(200);
  expect(theirs.json?.records).toEqual([]);
  expect((await api(other, "DELETE", "/api/excipient-library/xl_buffer_salt_a_fictional", { reason: "Not mine" })).status).toBe(404);
  await other.context().close();

  // A body far over the library limit is refused, and so is a request without the same-origin header; the library still works.
  const big = await api(page, "PUT", `/api/excipient-library/${record.id}`, undefined, { bytes: 5 * 1024 * 1024 });
  expect(big.status).toBe(413);
  const unmarked = await api(page, "PUT", `/api/excipient-library/${record.id}`, { record }, { withHeader: false });
  expect([400, 403]).toContain(unmarked.status);
  const mine = await api(page, "GET", "/api/excipient-library");
  expect((mine.json?.records as unknown[]).length).toBe(1);

  // Removing asks for a reason and the saved excipient is gone afterwards.
  await page.getByTestId("exl-remove-xl_buffer_salt_a_fictional").click();
  await page.getByTestId("exl-remove-reason").fill("Replaced by a newer record (fictional)");
  await page.getByTestId("exl-remove-confirm").click();
  await expect(page.getByTestId("exl-message")).toContainText("removed");
  expect(((await api(page, "GET", "/api/excipient-library")).json?.records as unknown[]).length).toBe(0);
  expect(problems.pageErrors).toEqual([]);
});
