import type { RiskBand } from "@gap/process-model";

/*
 * User-defined bands. A band is the user's label for a range of scores, in the user's words (ICH Q9(R1) asks the organisation to
 * define its own risk acceptance criteria; the tool does not).
 *
 * Overlaps and gaps are reported as PROBLEMS, not errors: a person may be part-way through typing the bands, or may leave a gap on
 * purpose. The tool shows the problem and still stores the bands; an item whose score falls in no band, or in two, gets no band
 * (never a guess) plus a problem that says why.
 */

/** Every whole score in [lo, hi] is expected to sit in exactly one band. Reports what is not so. */
export function bandProblems(bands: readonly RiskBand[], range?: { lo: number; hi: number }): string[] {
  const problems: string[] = [];
  const usable = bands.filter((b) => {
    if (b.minRpn > b.maxRpn) {
      problems.push(`Band "${b.label}" starts at ${b.minRpn} and ends at ${b.maxRpn}`);
      return false;
    }
    return true;
  });
  const names = new Map<string, number>();
  for (const b of bands) names.set(b.label, (names.get(b.label) ?? 0) + 1);
  for (const [label, n] of names) if (n > 1) problems.push(`Band label "${label}" is used ${n} times`);

  const sorted = [...usable].sort((a, b) => a.minRpn - b.minRpn || a.maxRpn - b.maxRpn);
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    // Overlap is judged against the furthest end so far, so a band swallowed by an earlier wide one is still reported.
    const before = sorted.slice(0, i);
    const widest = before.reduce((a, b) => (b.maxRpn > a.maxRpn ? b : a));
    if (cur.minRpn <= widest.maxRpn) problems.push(`Bands "${widest.label}" and "${cur.label}" overlap (${cur.minRpn} to ${Math.min(cur.maxRpn, widest.maxRpn)})`);
    else if (cur.minRpn - widest.maxRpn > 1) problems.push(`No band covers ${widest.maxRpn + 1} to ${cur.minRpn - 1}`);
  }
  if (range && sorted.length > 0) {
    const first = sorted[0]!;
    const reachAll = Math.max(...sorted.map((b) => b.maxRpn));
    if (first.minRpn > range.lo) problems.push(`No band covers ${range.lo} to ${first.minRpn - 1}`);
    if (reachAll < range.hi) problems.push(`No band covers ${reachAll + 1} to ${range.hi}`);
  }
  return problems;
}

/** The bands that contain a score. Zero or several means no band can be named. */
export function bandsFor(bands: readonly RiskBand[], score: number): RiskBand[] {
  return bands.filter((b) => b.minRpn <= score && score <= b.maxRpn);
}
