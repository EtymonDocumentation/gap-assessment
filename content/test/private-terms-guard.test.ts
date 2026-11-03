import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoPrivateTerms, findPrivateTerms, loadPrivateTerms } from "../../test-support/private-terms";

// The leak guard itself: proves it fails on a private term and ignores comments, blanks and case. The fixture is a
// made-up term in a temp folder OUTSIDE the repo, so no real client term is written here.
const saved = process.env.GAP_PRIVATE_TERMS;
const dirs: string[] = [];
function fixture(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gap-terms-"));
  dirs.push(dir);
  const file = join(dir, "terms.txt");
  writeFileSync(file, text);
  return file;
}
afterEach(() => {
  if (saved === undefined) delete process.env.GAP_PRIVATE_TERMS;
  else process.env.GAP_PRIVATE_TERMS = saved;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("private-terms leak guard", () => {
  it("fails when an output contains a private term (case-insensitive, literal)", () => {
    process.env.GAP_PRIVATE_TERMS = fixture("# comment\r\n\r\n  Zz-Fake.9  \r\n");
    expect(loadPrivateTerms()).toEqual(["Zz-Fake.9"]);
    expect(() => expectNoPrivateTerms("a line with zz-fake.9 inside")).toThrow();
    expect(() => expectNoPrivateTerms("a line with zz-fakeX9 inside")).not.toThrow(); // "." is not a wildcard
    expect(() => expectNoPrivateTerms("clean text")).not.toThrow();
  });
  it("skips (no failure) when the variable is unset or the file is missing", () => {
    delete process.env.GAP_PRIVATE_TERMS;
    expect(findPrivateTerms("anything")).toBe(0);
    process.env.GAP_PRIVATE_TERMS = join(tmpdir(), "gap-terms-does-not-exist.txt");
    expect(loadPrivateTerms()).toEqual([]);
  });
});
