import {
  AQL_VALUES_414,
  CODE_LETTERS_414,
  K_NORMAL_414,
  K_REDUCED_414,
  M_NORMAL_414,
  M_REDUCED_414,
  SAMPLE_SIZE_414,
  SAMPLE_SIZE_414_REDUCED,
  TABLE_A2,
  TABLE_A2_LOT_MAX,
  type CodeLetter414,
} from "./tables/mil-std-414";
import { aqlIndex, failure, type Inspection, type SampleSizeResult, type VarLevel } from "./types";

export { AQL_VALUES_414 };

const CITATION =
  "MIL-STD-414 (public domain), Section B, variability unknown, standard deviation method; equivalent to ANSI/ASQ Z1.9 — confirm against your licensed copy";

export const VAR_LEVELS: readonly VarLevel[] = ["I", "II", "III", "IV", "V"];
const INSPECTIONS: readonly Inspection[] = ["normal", "tightened", "reduced"];

/** Table A-2: code letter for a lot size and level. */
export function varCodeLetter(lotSize: number, level: VarLevel): CodeLetter414 {
  const idx = TABLE_A2_LOT_MAX.findIndex((max) => max === null || lotSize <= max);
  return TABLE_A2[level]!.charAt(idx) as CodeLetter414;
}

export interface VarCell {
  letter: CodeLetter414;
  sampleSize: number;
  value: number;
  arrow: boolean;
}

/**
 * Resolves one cell of B-1/B-2 (k) or B-3/B-4 (M). The standard prints an arrow where a code letter has no plan at that AQL:
 * "use first sampling plan below arrow, that is, both sample size as well as k (or M) value".
 * `col` is the column of the normal table (tightened inspection uses the normal column one AQL lower) or of the reduced table.
 */
export function resolveVarCell(table: "k" | "m", reduced: boolean, letter: CodeLetter414, col: number): VarCell | null {
  const grid = table === "k" ? (reduced ? K_REDUCED_414 : K_NORMAL_414) : reduced ? M_REDUCED_414 : M_NORMAL_414;
  const sizes = reduced ? SAMPLE_SIZE_414_REDUCED : SAMPLE_SIZE_414;
  for (let j = CODE_LETTERS_414.indexOf(letter); j < CODE_LETTERS_414.length; j++) {
    const l = CODE_LETTERS_414[j]!;
    const v = grid[l]?.[col];
    if (v !== null && v !== undefined) return { letter: l, sampleSize: sizes[l], value: v, arrow: l !== letter };
  }
  return null;
}

/**
 * Variables plans from MIL-STD-414 Section B (standard deviation method, variability unknown): Form 1 (k) for a single specification
 * limit, Form 2 (M) for double limits with one AQL. Different AQLs for upper and lower limit, the range method (Section C) and the
 * variability-known plans (Section D) are not supported in this version.
 */
export function variablesPlan(i: { lotSize?: number; level?: VarLevel; aql?: number; inspection?: Inspection; limits?: "single" | "double" }): SampleSizeResult {
  const problems: string[] = [];
  if (i.lotSize === undefined) problems.push("Enter the lot size.");
  else if (!Number.isInteger(i.lotSize) || i.lotSize < 3) problems.push("MIL-STD-414 starts at a lot size of 3: the lot size must be a whole number of 3 or more.");
  if (i.level === undefined) problems.push("Choose the inspection level (I, II, III, IV or V; IV is the standard's normal level).");
  else if (!VAR_LEVELS.includes(i.level)) problems.push(`"${String(i.level)}" is not a MIL-STD-414 inspection level (I, II, III, IV or V).`);
  let idx = -1;
  if (i.aql === undefined) problems.push("Choose the AQL (acceptance quality limit).");
  else {
    idx = aqlIndex(AQL_VALUES_414, i.aql);
    if (idx < 0) problems.push(`AQL ${i.aql} is not one of the MIL-STD-414 values (${AQL_VALUES_414.join(", ")}); other AQLs are not supported in this version.`);
  }
  if (i.inspection === undefined) problems.push("Choose the inspection severity (normal, tightened or reduced).");
  else if (!INSPECTIONS.includes(i.inspection)) problems.push(`"${String(i.inspection)}" is not an inspection severity (normal, tightened or reduced).`);
  if (i.limits === undefined) problems.push("Choose whether the characteristic has a single or a double specification limit.");
  else if (i.limits !== "single" && i.limits !== "double") problems.push(`"${String(i.limits)}" is not a limit type (single or double).`);
  if (problems.length > 0) return failure("var-414", problems, CITATION);

  const inspection = i.inspection!;
  const limits = i.limits!;
  const aql = i.aql!;
  const lotSize = i.lotSize!;
  const level = i.level!;

  // The standard has no table of its own for tightened inspection: the tightened AQL is printed under the normal column one step
  // lower, and reduced inspection has its own tables with 13 AQL columns.
  let col = idx;
  let columnNote = "";
  if (inspection === "tightened") {
    if (idx === 0) return failure("var-414", [`MIL-STD-414 has no tightened plan for AQL ${aql} (it starts at ${AQL_VALUES_414[1]}).`], CITATION);
    col = idx - 1;
    columnNote = `tightened AQL ${aql} is printed under the normal column AQL ${AQL_VALUES_414[col]}`;
  }
  if (inspection === "reduced" && idx === AQL_VALUES_414.length - 1) {
    return failure("var-414", [`MIL-STD-414 has no reduced-inspection plan for AQL ${aql} (Tables B-2 and B-4 end at ${AQL_VALUES_414[idx - 1]}).`], CITATION);
  }

  const letter = varCodeLetter(lotSize, level);
  const form = limits === "single" ? "Form 1 (k)" : "Form 2 (M)";
  const tableName = limits === "single" ? (inspection === "reduced" ? "Table B-2" : "Table B-1") : inspection === "reduced" ? "Table B-4" : "Table B-3";
  const working = [
    { label: "Lot size", value: String(lotSize) },
    { label: "Inspection level", value: level },
    { label: "Code letter (Table A-2)", value: letter },
    { label: "Inspection severity", value: inspection },
    { label: "AQL", value: String(aql) },
    { label: "Specification limits", value: limits === "single" ? "single limit, Form 1" : "double limit, one AQL for both limits combined, Form 2" },
    { label: "Method", value: `Standard deviation method, ${form}, ${tableName}${inspection === "tightened" ? " (normal and tightened)" : ""}` },
  ];
  if (columnNote) working.push({ label: "Tightened inspection", value: columnNote });

  const cell = resolveVarCell(limits === "single" ? "k" : "m", inspection === "reduced", letter, col);
  if (!cell) return failure("var-414", [`MIL-STD-414 ${tableName} has no plan for code letter ${letter} at AQL ${aql}.`], CITATION, working);
  if (cell.arrow) {
    working.push({
      label: `Arrow in ${tableName}`,
      value: `code letter ${letter} has an arrow at this AQL: use the first plan below, code letter ${cell.letter} (its sample size and its ${limits === "single" ? "k" : "M"})`,
    });
  }
  working.push({
    label: "Plan used",
    value: `code letter ${cell.letter}, n = ${cell.sampleSize}, ${limits === "single" ? `k = ${cell.value}` : `M = ${cell.value} %`}`,
  });
  const result: SampleSizeResult = {
    method: "var-414",
    ok: true,
    problems: [],
    sampleSize: cell.sampleSize,
    codeLetter: cell.letter,
    working,
    citation: CITATION,
    ...(limits === "single" ? { k: cell.value } : { maxPercentNonconforming: cell.value }),
  };
  if (cell.sampleSize >= lotSize) {
    result.hundredPercent = true;
    result.sampleSize = lotSize;
    working.push({ label: "Lot size check", value: `n = ${cell.sampleSize} is not smaller than the lot of ${lotSize}: every item in the lot must be inspected (100 %).` });
  }
  return result;
}
