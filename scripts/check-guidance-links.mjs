// Checks that every link in content/guidance/guidance.yaml still answers. Run it by hand: `npm run check:guidance-links`.
//
// Why it is NOT part of `npm run ci` or the GitHub workflow: it needs the network and the agencies' sites are slow, rate
// limit scripts and go down for maintenance, so a CI run would fail for reasons that have nothing to do with a change.
// A broken build that nobody caused trains people to ignore the build.
//
// Why it only reads the file and never rewrites it: a link that answers says nothing about whether the guidance behind
// it changed. Updating a date, a status or the `checked` day is a human review of the agency page (see the README,
// "Guidance library"). The script only tells the reviewer which links to look at first.
//
// Exit code 1 only when an item marked `verified: ok` fails. Items marked `blocked-but-official` are real official
// pages that refuse scripts (EUR-Lex, EDQM, USP-NF, NMPA and others); for those a failure is only a warning.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../content/guidance/guidance.yaml", import.meta.url));
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
// Agency sites often answer scripts with 403 unless the request looks like a browser.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Reads the few one-line fields the check needs. The file is written as plain `key: value` lines (one item per
 * `- id:`), so a line scan avoids adding a YAML parser to the root package just for this script. The content test in
 * content/test/guidance.test.ts is what validates the full structure.
 */
function readTargets(text) {
  const items = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:- )?(id|url|pdf|verified):\s*"?([^"]*?)"?\s*$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "id") {
      cur = { id: value, verified: "", urls: [] };
      items.push(cur);
    } else if (!cur) continue;
    else if (key === "verified") cur.verified = value;
    else cur.urls.push({ kind: key, url: value });
  }
  const bad = items.filter((i) => !i.verified || !i.urls.some((u) => u.kind === "url"));
  if (bad.length) throw new Error(`Could not read url/verified for: ${bad.map((b) => b.id).join(", ")}`);
  return items.flatMap((i) => i.urls.map((u) => ({ id: i.id, verified: i.verified, kind: u.kind, url: u.url })));
}

async function check(target) {
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf,*/*;q=0.8", "accept-language": "en" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Only the status matters; do not download large PDFs.
    await res.body?.cancel().catch(() => {});
    const moved = res.redirected && stripSlash(res.url) !== stripSlash(target.url);
    const state = res.status >= 400 ? "fail" : moved ? "redirect" : "ok";
    return { ...target, state, detail: `HTTP ${res.status}${moved ? ` -> ${res.url}` : ""}`, ms: Date.now() - started };
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { ...target, state: "fail", detail: timedOut ? `timeout after ${TIMEOUT_MS / 1000}s` : `${e?.cause?.code ?? e?.name}: ${e?.message}`, ms: Date.now() - started };
  }
}

const stripSlash = (u) => u.replace(/#.*$/, "").replace(/\/$/, "");

async function pool(targets, size) {
  const results = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, targets.length) }, async () => {
      while (next < targets.length) {
        const n = next++;
        results[n] = await check(targets[n]);
        process.stderr.write(".");
      }
    }),
  );
  process.stderr.write("\n");
  return results;
}

function table(rows) {
  if (!rows.length) return;
  const w = (k) => Math.max(...rows.map((r) => String(r[k]).length));
  const cols = ["id", "kind", "verified", "detail"];
  const widths = Object.fromEntries(cols.map((c) => [c, w(c)]));
  for (const r of rows) {
    console.log(`  ${cols.map((c) => String(r[c]).padEnd(widths[c])).join("  ")}`);
    console.log(`  ${" ".repeat(widths.id + 2)}${r.url}`);
  }
}

const targets = readTargets(readFileSync(FILE, "utf8"));
console.log(`Checking ${targets.length} links from content/guidance/guidance.yaml (timeout ${TIMEOUT_MS / 1000}s, ${CONCURRENCY} at a time)...`);
const results = await pool(targets, CONCURRENCY);

const failures = results.filter((r) => r.state === "fail" && r.verified === "ok");
const warnings = results.filter((r) => r.state === "fail" && r.verified !== "ok");
const redirects = results.filter((r) => r.state === "redirect");
const ok = results.filter((r) => r.state === "ok");

if (failures.length) {
  console.log(`\nFAILURES (verified: ok, should answer):`);
  table(failures);
}
if (warnings.length) {
  console.log(`\nWARNINGS (blocked-but-official: scripts are often refused; open these in a browser):`);
  table(warnings);
}
if (redirects.length) {
  console.log(`\nREDIRECTS (the agency moved the page; update the url after checking it is the same document):`);
  table(redirects);
}
console.log(`\nSummary: ${ok.length} ok, ${redirects.length} redirected, ${failures.length} failed, ${warnings.length} warnings (of ${results.length}).`);
console.log("This script never edits the YAML. Review the agency pages, edit the file by hand and bump `checked`.");
process.exit(failures.length ? 1 : 0);
