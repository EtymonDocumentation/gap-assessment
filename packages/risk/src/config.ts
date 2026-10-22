import type { CustomConfig, RiskConfig, RiskMethod, RiskScale, RiskScore } from "@gap/process-model";
import { bandProblems } from "./bands";
import { scoreItem } from "./score";

/*
 * Reading a method config: its problems, its description for the document, its score columns, and the counts for the heat view.
 * Everything here reports on what the person entered; none of it adds a value the person did not give.
 */

export const METHOD_LABEL: Record<RiskMethod, string> = {
  fmea: "FMEA (severity x occurrence x detection)",
  matrix: "Risk matrix (likelihood x severity)",
  custom: "User-defined method",
  qualitative: "Qualitative (levels with a written reason)",
};

/** The lowest and highest score a numeric config can give (the corners of the factor ranges). Undefined for a non-numeric method. */
export function scoreRange(config: RiskConfig): { lo: number; hi: number } | undefined {
  let scales: RiskScale[];
  let how: "product" | "sum" | "max";
  if (config.method === "fmea") {
    scales = [config.severity, config.occurrence, config.detection];
    how = "product";
  } else if (config.method === "custom" && config.combine !== "lookup") {
    scales = config.factors.map((f) => f.scale);
    how = config.combine;
  } else return undefined;
  // Product, sum and max are all monotone in each factor only when the scales are non-negative; checking every corner is correct for any signs.
  let corners: number[][] = [[]];
  for (const s of scales) corners = corners.flatMap((c) => [[...c, s.min], [...c, s.max]]);
  const vals = corners.map((c) => (how === "sum" ? c.reduce((a, b) => a + b, 0) : how === "max" ? Math.max(...c) : c.reduce((a, b) => a * b, 1)));
  return { lo: Math.min(...vals), hi: Math.max(...vals) };
}

function lookupCombos(c: CustomConfig): number[][] {
  let out: number[][] = [[]];
  for (const f of c.factors) {
    const vals: number[] = [];
    for (let v = f.scale.min; v <= f.scale.max; v++) vals.push(v);
    out = out.flatMap((o) => vals.map((v) => [...o, v]));
  }
  return out;
}

/** Problems in a method itself (not in any item). Reported, never thrown: a half-built method is a normal state. */
export function configProblems(config: RiskConfig): string[] {
  const problems: string[] = [];
  const dupLabels = (labels: string[], what: string) => {
    const seen = new Set<string>();
    for (const l of labels) {
      if (seen.has(l)) problems.push(`The ${what} "${l}" appears twice`);
      seen.add(l);
    }
  };
  switch (config.method) {
    case "fmea": {
      problems.push(...bandProblems(config.bands, scoreRange(config)));
      if (config.severityTrigger && (config.severityTrigger.min < config.severity.min || config.severityTrigger.min > config.severity.max)) {
        problems.push(`The severity rule starts at ${config.severityTrigger.min}, which is outside the severity scale ${config.severity.min} to ${config.severity.max}`);
      }
      break;
    }
    case "matrix": {
      dupLabels(config.likelihood.map((l) => l.label), "likelihood level");
      dupLabels(config.severity.map((l) => l.label), "severity level");
      const total = config.likelihood.length * config.severity.length;
      const labelled = config.cells.filter((c) => c.label.trim()).length;
      if (labelled < total) problems.push(`${total - labelled} of ${total} matrix cells have no risk label`);
      break;
    }
    case "custom": {
      if (config.combine === "lookup") {
        const combos = lookupCombos(config);
        const have = new Set(config.lookup.filter((e) => e.label.trim()).map((e) => e.levels.join(",")));
        const missing = combos.filter((c) => !have.has(c.join(","))).length;
        if (missing > 0) problems.push(`The lookup table has no label for ${missing} of ${combos.length} combinations`);
        const seen = new Set<string>();
        for (const e of config.lookup) {
          const k = e.levels.join(",");
          if (seen.has(k)) problems.push(`The lookup table gives combination ${k} twice`);
          seen.add(k);
        }
      } else {
        problems.push(...bandProblems(config.bands, scoreRange(config)));
      }
      break;
    }
    case "qualitative":
      dupLabels(config.levels.map((l) => l.label), "level");
      break;
  }
  return problems;
}

/** The score columns of a register, in order: key (the key in `values`), the short head and the full name. */
export function factorColumns(config: RiskConfig): { key: string; short: string; name: string }[] {
  switch (config.method) {
    case "fmea":
      return [
        { key: "severity", short: "S", name: "Severity" },
        { key: "occurrence", short: "O", name: "Occurrence" },
        { key: "detection", short: "D", name: "Detection" },
      ];
    case "matrix":
      return [
        { key: "likelihood", short: "L", name: "Likelihood" },
        { key: "severity", short: "S", name: "Severity" },
      ];
    case "custom":
      return config.factors.map((f) => ({ key: f.key, short: f.name.slice(0, 1).toUpperCase(), name: f.name }));
    case "qualitative":
      return [];
  }
}

/** A score's answers in words for a table cell: "S 7, O 4, D 5", "Likelihood: Possible; Severity: Major", "High". */
export function describeAnswers(config: RiskConfig, score: RiskScore | undefined): string {
  if (!score) return "";
  if (config.method === "qualitative") return score.level ?? "";
  const parts: string[] = [];
  for (const c of factorColumns(config)) {
    const v = score.values[c.key];
    if (v === undefined) continue;
    if (config.method === "matrix") {
      const lv = c.key === "likelihood" ? config.likelihood[v - 1] : config.severity[v - 1];
      parts.push(`${c.name}: ${lv?.label ?? v}`);
    } else parts.push(`${c.short} ${v}`);
  }
  return parts.join(", ");
}

export type MethodDescription = {
  method: RiskMethod;
  title: string;
  /** The formula in words. */
  formula: string;
  /** Scales with their level descriptions (FMEA, user-defined). For a matrix and a qualitative method, the levels. */
  scales: { name: string; min: number; max: number; levels: { value: number; description: string }[] }[];
  /** Matrix and qualitative levels: label, description. */
  levelLists: { name: string; levels: { label: string; description?: string }[] }[];
  /** The matrix grid as text: row labels, column labels, and the user's label in each cell ("" when none). */
  grid?: { rows: string[]; cols: string[]; cells: string[][] };
  bands: { label: string; range: string; note?: string }[];
  bandsText: string;
  extra: string[];
  problems: string[];
};

/** The method described from its config, for the document and for the Method page. The words are the user's; the wrapper words are fixed. */
export function describeMethod(config: RiskConfig): MethodDescription {
  const bandsOf = (bands: { label: string; minRpn: number; maxRpn: number; note?: string }[]) =>
    [...bands].sort((a, b) => a.minRpn - b.minRpn).map((b) => ({ label: b.label, range: b.minRpn === b.maxRpn ? `${b.minRpn}` : `${b.minRpn} to ${b.maxRpn}`, ...(b.note ? { note: b.note } : {}) }));
  const base = { method: config.method, title: METHOD_LABEL[config.method], scales: [], levelLists: [], bands: [], bandsText: "", extra: [], problems: configProblems(config) } satisfies Omit<MethodDescription, "formula">;
  const noBands = "No bands defined by the user. Scores are shown without a judgement.";
  switch (config.method) {
    case "fmea": {
      const d: MethodDescription = {
        ...base,
        formula: "Risk priority number (RPN) = severity x occurrence x detection.",
        scales: [
          { name: "Severity", ...config.severity },
          { name: "Occurrence", ...config.occurrence },
          { name: "Detection", ...config.detection },
        ],
        bands: bandsOf(config.bands),
        bandsText: config.bands.length ? "Bands defined by the user:" : noBands,
      };
      if (config.severityTrigger) d.extra.push(`Rule defined by the user: a severity of ${config.severityTrigger.min} or more gives "${config.severityTrigger.label}" whatever the RPN.${config.severityTrigger.note ? ` ${config.severityTrigger.note}` : ""}`);
      return d;
    }
    case "matrix": {
      const cells = config.likelihood.map((_, r) => config.severity.map((_, c) => config.cells.find((x) => x.row === r + 1 && x.col === c + 1)?.label ?? ""));
      return {
        ...base,
        formula: "The risk is read from the matrix: the row is the likelihood, the column is the severity, and the cell holds the user's risk label.",
        levelLists: [
          { name: "Likelihood (rows)", levels: config.likelihood },
          { name: "Severity (columns)", levels: config.severity },
        ],
        grid: { rows: config.likelihood.map((l) => l.label), cols: config.severity.map((l) => l.label), cells },
        bandsText: "The risk labels are the user's own wording for each cell.",
      };
    }
    case "custom": {
      const how = { product: "the product of the factors", sum: "the sum of the factors", max: "the highest factor", lookup: "looked up in the user's table of combinations" }[config.combine];
      const d: MethodDescription = {
        ...base,
        formula: `Score = ${how}: ${config.factors.map((f) => f.name).join(", ")}.`,
        scales: config.factors.map((f) => ({ name: f.name, ...f.scale })),
        bands: config.combine === "lookup" ? [] : bandsOf(config.bands),
        bandsText: config.combine === "lookup" ? "The risk labels come from the user's table." : config.bands.length ? "Bands defined by the user:" : noBands,
      };
      if (config.combine === "lookup") {
        for (const e of [...config.lookup].sort((a, b) => a.levels.join(",").localeCompare(b.levels.join(",")))) d.extra.push(`${config.factors.map((f, i) => `${f.name} ${e.levels[i]}`).join(", ")}: ${e.label}`);
      }
      return d;
    }
    case "qualitative":
      return {
        ...base,
        formula: "Each item is given one level from the user's list, with a written reason. No number is calculated.",
        levelLists: [{ name: "Levels", levels: config.levels }],
        bandsText: "The levels are the user's own wording.",
      };
  }
}

/** Heat view counts. `counts[row][col]` for a matrix; `notScored` counts the items that cannot be placed. */
export function heatCounts(config: RiskConfig, scores: readonly (RiskScore | undefined)[]): { counts: number[][]; placed: number; notScored: number } {
  if (config.method !== "matrix") return { counts: [], placed: 0, notScored: scores.length };
  const counts = config.likelihood.map(() => config.severity.map(() => 0));
  let placed = 0;
  let notScored = 0;
  for (const s of scores) {
    const l = s?.values.likelihood;
    const v = s?.values.severity;
    if (s && scoreItem(config, s).scored && l !== undefined && v !== undefined) {
      counts[l - 1]![v - 1]! += 1;
      placed += 1;
    } else notScored += 1;
  }
  return { counts, placed, notScored };
}
