// Leak guard for client-identifying terms that must never appear in any output (site data, Word, HTML).
//
// Why a private file: the public repo must not spell the terms out, not even as fragments (fragments still publish
// them). The terms live OUTSIDE the repo, one per line, in the file named by the environment variable
// GAP_PRIVATE_TERMS. CI writes them from a repository secret. When the variable is unset or the file is missing,
// the private part of the guard is skipped with one warning; the generic patterns in each test still run.
import { existsSync, readFileSync } from "node:fs";
import { expect } from "vitest";

let warned = false;

/** Terms from the private file: trimmed, blank lines and lines starting with # ignored. */
export function loadPrivateTerms(): string[] {
  const file = process.env.GAP_PRIVATE_TERMS;
  if (!file || !existsSync(file)) {
    if (!warned) {
      warned = true;
      console.warn("GAP_PRIVATE_TERMS is unset or the file is missing: the private-term leak guard is SKIPPED (generic patterns still run).");
    }
    return [];
  }
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Terms found in the text. Literal, case-insensitive match (never a regex, so "-" or "." cannot misfire). */
export function findPrivateTerms(text: string, terms: string[] = loadPrivateTerms()): number {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

/** Fails when the text holds any private term. The message gives only the count, never the term. */
export function expectNoPrivateTerms(text: string): void {
  expect(findPrivateTerms(text), "private client terms found in output").toBe(0);
}
