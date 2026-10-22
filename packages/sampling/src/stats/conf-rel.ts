import { failure, type SampleSizeResult } from "./types";

const CITATION =
  "Binomial confidence/reliability (success-run) sample size: the smallest n with P(X <= c | n, 1 - R) <= 1 - C. For c = 0 this is n = ceil(ln(1 - C) / ln(R)).";

/** Safety cap for the search. A plan that needs more than this is not a usable sampling plan; the user is told instead of guessing. */
export const CONF_REL_SEARCH_CAP = 1_000_000;

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let j = 1; j <= k; j++) s += Math.log((n - k + j) / j);
  return s;
}

/**
 * P(X <= c) for X ~ Binomial(n, p), summed in log space (log-sum-exp) so a large n and a tiny p cannot underflow to a wrong answer.
 * lnQ is ln(1 - p) = ln(R), passed in directly because it is exact for R near 1 where 1 - p would lose digits.
 */
function binomialCdf(c: number, n: number, lnP: number, lnQ: number): number {
  if (n <= c) return 1;
  const terms: number[] = [];
  for (let j = 0; j <= c; j++) terms.push(logChoose(n, j) + j * lnP + (n - j) * lnQ);
  const max = Math.max(...terms);
  return Math.exp(max) * terms.reduce((a, t) => a + Math.exp(t - max), 0);
}

export function confRelPlan(i: { confidence?: number; reliability?: number; allowedFailures?: number; lotSize?: number }): SampleSizeResult {
  const problems: string[] = [];
  const { confidence: C, reliability: R, allowedFailures: c } = i;
  if (C === undefined) problems.push("Enter the confidence (a fraction between 0 and 1, for example 0.95).");
  else if (!(C > 0 && C < 1)) problems.push("The confidence must be a fraction greater than 0 and less than 1 (for example 0.95 for 95 %).");
  if (R === undefined) problems.push("Enter the reliability (a fraction between 0 and 1, for example 0.99).");
  else if (!(R > 0 && R < 1)) problems.push("The reliability must be a fraction greater than 0 and less than 1 (for example 0.99 for 99 %).");
  if (c === undefined) problems.push("Enter the number of failures allowed in the sample (0 is allowed).");
  else if (!Number.isInteger(c) || c < 0) problems.push("The allowed failures must be a whole number of 0 or more.");
  if (i.lotSize !== undefined && !(Number.isInteger(i.lotSize) && i.lotSize >= 1)) problems.push("The lot size must be a whole number of 1 or more.");
  if (problems.length > 0) return failure("conf-rel", problems, CITATION);

  const conf = C!;
  const rel = R!;
  const fails = c!;
  const target = 1 - conf;
  const lnP = Math.log(1 - rel);
  const lnQ = Math.log(rel);
  // The tolerance stops a result that equals the target exactly (for example C = 0.75, R = 0.5) from being pushed up by rounding.
  const meets = (n: number) => binomialCdf(fails, n, lnP, lnQ) <= target * (1 + 1e-12);

  // P(X <= c) never rises as n grows, so find an upper bound by doubling and then bisect.
  let lo = fails + 1; // n = c can never satisfy it: P = 1
  let hi = lo;
  while (!meets(hi)) {
    lo = hi + 1;
    if (hi >= CONF_REL_SEARCH_CAP) {
      return failure(
        "conf-rel",
        [`No sample size up to ${CONF_REL_SEARCH_CAP.toLocaleString("en-GB")} reaches ${(conf * 100).toFixed(2)} % confidence of ${(rel * 100).toFixed(2)} % reliability with ${fails} allowed failure(s). Check the inputs.`],
        CITATION,
      );
    }
    hi = Math.min(hi * 2, CONF_REL_SEARCH_CAP);
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) hi = mid;
    else lo = mid + 1;
  }
  const n = lo;
  const achieved = 1 - binomialCdf(fails, n, lnP, lnQ);

  const working = [
    { label: "Confidence C", value: String(conf) },
    { label: "Reliability R", value: String(rel) },
    { label: "Allowed failures c", value: String(fails) },
    { label: "Rule", value: "Smallest n with P(X <= c | n, 1 - R) <= 1 - C" },
    { label: "Sample size n", value: String(n) },
    { label: "Confidence reached at n", value: achieved.toFixed(5) },
  ];
  const result: SampleSizeResult = { method: "conf-rel", ok: true, problems: [], sampleSize: n, working, citation: CITATION };
  if (i.lotSize !== undefined) {
    working.push({ label: "Lot size", value: String(i.lotSize) });
    if (n > i.lotSize) {
      result.hundredPercent = true;
      result.sampleSize = i.lotSize;
      working.push({ label: "Lot size check", value: `n = ${n} is larger than the lot of ${i.lotSize}: inspect the whole lot (100 %).` });
    }
  }
  return result;
}
