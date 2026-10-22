import type { CustomConfig, FmeaConfig, MatrixConfig, QualitativeConfig, RiskConfig, RiskScale, RiskScore } from "@gap/process-model";
import { bandsFor } from "./bands";

/*
 * Scoring. One function per method, all returning the same result shape.
 *
 * Design notes (the why):
 *  - NOT SCORED, NEVER GUESSED. If any needed answer is missing or outside its scale, the result is `scored: false` with the reason in
 *    `problems`. A guessed 1 or 5 would look like an assessment and hide the open item.
 *  - THE ARITHMETIC IS SHOWN (`working`), so a reviewer can redo it by hand: "Severity 7 x Occurrence 4 x Detection 5 = 140".
 *  - THE TOOL DOES NOT JUDGE. `label` is the user's own band, cell or level label; it is only set when the person defined one. With no
 *    bands, the score stands alone and the working says so.
 *  - `sortKey` orders a register. For FMEA and a numeric user-defined method it is the score. For a matrix it is the grid position
 *    (likelihood, then severity): a position, not an invented score. For a qualitative method it is the place in the user's own list.
 */

export type RiskResult = {
  scored: boolean;
  /** The number: RPN or combined score. Absent for a matrix, a lookup and a qualitative method. */
  score?: number;
  /** The user's label: band, matrix cell, lookup entry or qualitative level. */
  label?: string;
  /** The user's note on the band, if any. */
  note?: string;
  /** FMEA only: the user's "severity alone triggers" rule fired. Reported next to the band, never instead of it. */
  trigger?: { label: string; note?: string };
  sortKey?: number;
  working: string[];
  problems: string[];
};

const FMEA_KEYS = [
  ["severity", "Severity"],
  ["occurrence", "Occurrence"],
  ["detection", "Detection"],
] as const;

function checkValue(name: string, scale: RiskScale, v: number | undefined, problems: string[]): boolean {
  if (v === undefined) {
    problems.push(`${name} has no value`);
    return false;
  }
  if (!Number.isInteger(v) || v < scale.min || v > scale.max) {
    problems.push(`${name} ${v} is outside the scale ${scale.min} to ${scale.max}`);
    return false;
  }
  return true;
}

const none = (problems: string[]): RiskResult => ({ scored: false, working: [], problems });

/** Band lookup shared by the numeric methods. Zero or several bands means no band is named, with the reason as a problem. */
function applyBands(res: RiskResult, bands: FmeaConfig["bands"], total: number, what: string) {
  if (bands.length === 0) {
    res.working.push(`No bands defined by the user: the ${what} is shown without a judgement.`);
    return;
  }
  const hit = bandsFor(bands, total);
  if (hit.length === 1) {
    res.label = hit[0]!.label;
    if (hit[0]!.note) res.note = hit[0]!.note;
    res.working.push(`${what[0]!.toUpperCase()}${what.slice(1)} ${total} is in the band "${hit[0]!.label}" (${hit[0]!.minRpn} to ${hit[0]!.maxRpn}), as defined by the user.`);
  } else if (hit.length === 0) {
    res.problems.push(`${what[0]!.toUpperCase()}${what.slice(1)} ${total} is in none of the user's bands`);
  } else {
    res.problems.push(`${what[0]!.toUpperCase()}${what.slice(1)} ${total} is in ${hit.length} of the user's bands (${hit.map((b) => `"${b.label}"`).join(", ")}), so no band is named`);
  }
}

export function scoreFmea(config: FmeaConfig, score: RiskScore): RiskResult {
  const problems: string[] = [];
  const got: number[] = [];
  let ok = true;
  for (const [key, name] of FMEA_KEYS) {
    if (checkValue(name, config[key], score.values[key], problems)) got.push(score.values[key]!);
    else ok = false;
  }
  if (!ok) return none(problems);
  const [s, o, d] = got as [number, number, number];
  const rpn = s * o * d;
  const res: RiskResult = { scored: true, score: rpn, sortKey: rpn, working: [`Severity ${s} x Occurrence ${o} x Detection ${d} = ${rpn}`], problems };
  applyBands(res, config.bands, rpn, "RPN");
  if (config.severityTrigger && s >= config.severityTrigger.min) {
    res.trigger = { label: config.severityTrigger.label, ...(config.severityTrigger.note ? { note: config.severityTrigger.note } : {}) };
    res.working.push(`Severity ${s} is at or above ${config.severityTrigger.min}: the user's rule gives "${config.severityTrigger.label}" whatever the RPN.`);
  }
  return res;
}

export function scoreMatrix(config: MatrixConfig, score: RiskScore): RiskResult {
  const problems: string[] = [];
  const l = score.values.likelihood;
  const s = score.values.severity;
  const okL = l !== undefined && Number.isInteger(l) && l >= 1 && l <= config.likelihood.length;
  const okS = s !== undefined && Number.isInteger(s) && s >= 1 && s <= config.severity.length;
  if (!okL) problems.push(l === undefined ? "Likelihood has no value" : `Likelihood position ${l} is outside 1 to ${config.likelihood.length}`);
  if (!okS) problems.push(s === undefined ? "Severity has no value" : `Severity position ${s} is outside 1 to ${config.severity.length}`);
  if (!okL || !okS) return none(problems);
  const lName = config.likelihood[l - 1]!.label;
  const sName = config.severity[s - 1]!.label;
  const working = [`Likelihood "${lName}" (row ${l}) with severity "${sName}" (column ${s})`];
  const cell = config.cells.find((c) => c.row === l && c.col === s);
  const res: RiskResult = { scored: true, sortKey: l * 1000 + s, working, problems };
  if (cell && cell.label.trim()) {
    res.label = cell.label;
    working.push(`The matrix cell gives "${cell.label}", as defined by the user.`);
  } else {
    problems.push(`The matrix cell for "${lName}" and "${sName}" has no risk label`);
  }
  return res;
}

export function scoreCustom(config: CustomConfig, score: RiskScore): RiskResult {
  const problems: string[] = [];
  const vals: number[] = [];
  let ok = true;
  for (const f of config.factors) {
    if (checkValue(f.name, f.scale, score.values[f.key], problems)) vals.push(score.values[f.key]!);
    else ok = false;
  }
  if (!ok) return none(problems);
  const text = config.factors.map((f, i) => `${f.name} ${vals[i]}`);
  if (config.combine === "lookup") {
    const hit = config.lookup.find((e) => e.levels.length === vals.length && e.levels.every((x, i) => x === vals[i]));
    const res: RiskResult = { scored: true, working: [`${text.join(", ")}: looked up in the user's table`], problems };
    if (hit && hit.label.trim()) {
      res.label = hit.label;
      res.working.push(`The table gives "${hit.label}", as defined by the user.`);
    } else {
      problems.push(`The user's table has no entry for ${text.join(", ")}`);
    }
    return res;
  }
  const total = config.combine === "sum" ? vals.reduce((a, b) => a + b, 0) : config.combine === "max" ? Math.max(...vals) : vals.reduce((a, b) => a * b, 1);
  const line = config.combine === "max" ? `Highest of ${text.join(", ")} = ${total}` : `${text.join(config.combine === "sum" ? " + " : " x ")} = ${total}`;
  const res: RiskResult = { scored: true, score: total, sortKey: total, working: [line], problems };
  applyBands(res, config.bands, total, "score");
  return res;
}

export function scoreQualitative(config: QualitativeConfig, score: RiskScore): RiskResult {
  const level = score.level;
  if (!level) return none(["No level chosen"]);
  const idx = config.levels.findIndex((l) => l.label === level);
  if (idx < 0) return none([`Level "${level}" is not in the user's list`]);
  const problems: string[] = [];
  // The written reason is what makes a qualitative level an assessment rather than a label; it is required, and its absence is an open item.
  const reason = score.reason?.trim();
  if (!reason) problems.push("The written reason is missing");
  return { scored: true, label: level, sortKey: idx, working: [`Level "${level}", chosen by the user${reason ? ` because: ${reason}` : ""}`], problems };
}

/** Scores one item with the method of `config`. */
export function scoreItem(config: RiskConfig, score: RiskScore): RiskResult {
  switch (config.method) {
    case "fmea":
      return scoreFmea(config, score);
    case "matrix":
      return scoreMatrix(config, score);
    case "custom":
      return scoreCustom(config, score);
    case "qualitative":
      return scoreQualitative(config, score);
  }
}

/** True if nothing was entered (so a residual score can be "absent" rather than "not scored"). */
export function scoreIsEmpty(score: RiskScore | undefined): boolean {
  return !score || (Object.keys(score.values).length === 0 && !score.level && !score.reason?.trim());
}
