import { parseNumberText, parseRangeText } from "./trd-import";

/**
 * Reading the value text of a document written by somebody else (job I2, level 3): "2-8 °C", "2 to 8 °C", "NMT 24 h", "> 24 h",
 * "≤ 30 min", "NLT 2 h", "between 2 and 8 °C".
 *
 * Rules that matter for GMP:
 *  - The ORIGINAL text always travels with the result: the review screen and the change log quote it as evidence.
 *  - Units are never converted. "1 mL to 2 L" keeps one unit at each end.
 *  - A decimal comma is refused (as in the first upload job): "2,5" could be 2.5 or 2500, and a guess would be a silent change.
 *  - A strict limit ("> 24 h", "< 30 min") is read as the number with the direction, and says it was strict, because the TRD stores a
 *    lower/upper end as a plain number. The caller puts that in the evidence so a reader can see the difference.
 *  - Anything not plainly readable is refused with a reason, never guessed ("20 ± 2 °C" is not turned into 18 to 22).
 */

export type ReadValue =
  | { kind: "none"; original: string }
  | { kind: "blank"; original: string }
  | { kind: "refused"; reason: string; original: string }
  | { kind: "number"; value: number; unit?: string; original: string }
  | { kind: "range"; low: number; high: number; unit?: string; lowUnit?: string; highUnit?: string; original: string }
  /** "not more than": only an upper end. */
  | { kind: "max"; value: number; unit?: string; strict: boolean; original: string }
  /** "not less than": only a lower end. */
  | { kind: "min"; value: number; unit?: string; strict: boolean; original: string };

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const clean = (s: string) =>
  s
    .replace(/[\s ]+/g, " ")
    .replace(/−/g, "-")
    .replace(/—/g, "–")
    .trim();

/** Words that mean "this cell has no value", as they appear in finished documents. */
const BLANK = /^(?:-|–|n\/?a|na|n\.a\.|not applicable|none|tbd|tbc|to be determined|not established|)$/i;

/** A unit as documents write it: short, no sentence. "mL", "°C", "vials/min", "h", "bar". */
function unitOk(u: string | undefined): boolean {
  if (u === undefined || u === "") return true;
  return u.length <= 14 && !/[,;:]/.test(u) && u.split(" ").length <= 2 && !/^\d/.test(u);
}

const MAX_WORDS = "(?:nmt|not more than|no more than|not to exceed|max(?:imum)?\\.?|up to|at most|\\u2264|<=|=<|<)";
const MIN_WORDS = "(?:nlt|not less than|no less than|min(?:imum)?\\.?|at least|\\u2265|>=|=>|>)";

export function readValue(text: string): ReadValue {
  const original = clean(text);
  let t = original.replace(/\s*\((?:provisional|approx\.?|approximately)\)\s*$/i, "");
  if (BLANK.test(t)) return { kind: "blank", original };
  if (!/\d/.test(t)) return { kind: "none", original };
  if (/\d,\d/.test(t)) return { kind: "refused", reason: "it uses a comma between digits, and the review does not guess whether that is a decimal comma or a thousands comma", original };
  if (/±|\+\/-/.test(t)) return { kind: "refused", reason: "it is written with a plus-or-minus sign, and the review does not work out the two ends", original };
  const between = /^between\s+(.+?)\s+and\s+(.+)$/i.exec(t);
  if (between) t = `${between[1]} to ${between[2]}`;

  let m = new RegExp(`^${MAX_WORDS}\\s*${NUM}\\s*(.*)$`, "i").exec(t);
  if (m && !/^to\b/i.test(m[2]!)) return limit("max", m, t, original);
  m = new RegExp(`^${MIN_WORDS}\\s*${NUM}\\s*(.*)$`, "i").exec(t);
  if (m && !/^to\b/i.test(m[2]!)) return limit("min", m, t, original);
  // "24 h max", "2 h minimum", "30 min or less"
  m = new RegExp(`^${NUM}\\s*(.*?)\\s*(maximum|max\\.?|or less|or fewer)$`, "i").exec(t);
  if (m && unitOk(m[2]!.trim())) return { kind: "max", value: Number(m[1]), ...(m[2]!.trim() ? { unit: m[2]!.trim() } : {}), strict: false, original };
  // A bare trailing "min" is not read as "minimum": "30 min" is thirty minutes.
  m = new RegExp(`^${NUM}\\s*(.*?)\\s*(minimum|or more|or greater)$`, "i").exec(t);
  if (m && unitOk(m[2]!.trim())) return { kind: "min", value: Number(m[1]), ...(m[2]!.trim() ? { unit: m[2]!.trim() } : {}), strict: false, original };

  const r = parseRangeText(t);
  if (r && r.low !== undefined && r.high !== undefined) {
    const bad = [r.unit, r.lowUnit, r.highUnit].some((u) => !unitOk(u));
    if (bad) return { kind: "refused", reason: "the unit next to the numbers is not a plain unit", original };
    return { kind: "range", low: r.low, high: r.high, ...(r.unit ? { unit: r.unit } : {}), ...(r.lowUnit ? { lowUnit: r.lowUnit } : {}), ...(r.highUnit ? { highUnit: r.highUnit } : {}), original };
  }
  if (r && r.high !== undefined) return { kind: "max", value: r.high, ...(r.unit ? { unit: r.unit } : {}), strict: false, original };
  if (r && r.low !== undefined) return { kind: "min", value: r.low, ...(r.unit ? { unit: r.unit } : {}), strict: false, original };

  const n = parseNumberText(t);
  if (n && unitOk(n.unit)) return { kind: "number", value: n.value, ...(n.unit ? { unit: n.unit } : {}), original };
  return { kind: "none", original };
}

function limit(kind: "max" | "min", m: RegExpExecArray, t: string, original: string): ReadValue {
  const unit = m[2]!.trim();
  if (!unitOk(unit)) return { kind: "refused", reason: "the unit next to the number is not a plain unit", original };
  const strict = kind === "max" ? /^</.test(t) && !/^<=|^=</.test(t) : /^>/.test(t) && !/^>=/.test(t);
  return { kind, value: Number(m[1]), ...(unit ? { unit } : {}), strict, original };
}
