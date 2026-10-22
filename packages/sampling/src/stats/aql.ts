import {
  AQL_VALUES_105E,
  CODE_LETTERS_105E,
  SAMPLE_SIZE_105E,
  SAMPLE_SIZE_105E_REDUCED,
  TABLE_I,
  TABLE_II_A_NORMAL,
  TABLE_II_B_TIGHTENED,
  TABLE_II_C_REDUCED,
  TABLE_I_LOT_MAX,
} from "./tables/mil-std-105e";
import { aqlIndex, failure, type AqlLevel, type Inspection, type SampleSizeResult } from "./types";

export { AQL_VALUES_105E };

const CITATION = "MIL-STD-105E (public domain); tables equivalent to ANSI/ASQ Z1.4 — confirm against your licensed copy";

export const AQL_LEVELS: readonly AqlLevel[] = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];
const INSPECTIONS: readonly Inspection[] = ["normal", "tightened", "reduced"];

const TABLES: Record<Inspection, { name: string; cells: Record<string, readonly string[]>; sizes: Record<string, number>; letters: readonly string[] }> = {
  normal: { name: "Table II-A (normal)", cells: TABLE_II_A_NORMAL, sizes: SAMPLE_SIZE_105E, letters: CODE_LETTERS_105E },
  tightened: { name: "Table II-B (tightened)", cells: TABLE_II_B_TIGHTENED, sizes: SAMPLE_SIZE_105E, letters: [...CODE_LETTERS_105E, "S"] },
  reduced: { name: "Table II-C (reduced)", cells: TABLE_II_C_REDUCED, sizes: SAMPLE_SIZE_105E_REDUCED, letters: CODE_LETTERS_105E },
};

/** Table I: the code letter for a lot size and level. */
export function aqlCodeLetter(lotSize: number, level: AqlLevel): string {
  const idx = TABLE_I_LOT_MAX.findIndex((max) => max === null || lotSize <= max);
  return TABLE_I[level]!.charAt(idx);
}

export interface AqlCell {
  /** Code letter whose plan is used (differs from the starting letter when an arrow was followed). */
  letter: string;
  sampleSize: number;
  accept: number;
  reject: number;
  arrow?: "down" | "up";
}

/**
 * Resolves one cell of Table II-A/B/C. An arrow means "use the first sampling plan in that direction, both its sample size and its
 * accept/reject numbers" (MIL-STD-105E 9.4), so the plan's own sample size replaces the one of the starting letter.
 * Returns null when the standard has no cell there (tightened letter S outside the 0.025 column) or the arrow leads nowhere.
 */
export function resolveAqlCell(inspection: Inspection, letter: string, aqlIdx: number): AqlCell | null {
  const t = TABLES[inspection];
  const start = t.letters.indexOf(letter);
  const cell = t.cells[letter]?.[aqlIdx];
  if (start < 0 || !cell) return null;
  let at = start;
  let arrow: "down" | "up" | undefined;
  let c: string | undefined = cell;
  if (cell === "v" || cell === "^") {
    arrow = cell === "v" ? "down" : "up";
    const step = cell === "v" ? 1 : -1;
    c = undefined;
    for (let j = start + step; j >= 0 && j < t.letters.length; j += step) {
      const next = t.cells[t.letters[j]!]?.[aqlIdx];
      if (next && next !== "v" && next !== "^") {
        at = j;
        c = next;
        break;
      }
    }
  }
  if (!c) return null;
  const [ac, re] = c.split("/").map(Number) as [number, number];
  const found = t.letters[at]!;
  return { letter: found, sampleSize: t.sizes[found]!, accept: ac, reject: re, ...(arrow ? { arrow } : {}) };
}

/** Single sampling plans for attributes from MIL-STD-105E: code letter from Table I, then the plan from II-A, II-B or II-C. */
export function aqlPlan(i: { lotSize?: number; level?: AqlLevel; aql?: number; inspection?: Inspection }): SampleSizeResult {
  const problems: string[] = [];
  if (i.lotSize === undefined) problems.push("Enter the lot size.");
  else if (!Number.isInteger(i.lotSize) || i.lotSize < 2) problems.push("MIL-STD-105E starts at a lot size of 2: the lot size must be a whole number of 2 or more.");
  if (i.level === undefined) problems.push("Choose the inspection level (S-1 to S-4, I, II or III).");
  else if (!AQL_LEVELS.includes(i.level)) problems.push(`"${String(i.level)}" is not a MIL-STD-105E inspection level (S-1, S-2, S-3, S-4, I, II or III).`);
  let col = -1;
  if (i.aql === undefined) problems.push("Choose the AQL (acceptance quality limit).");
  else {
    col = aqlIndex(AQL_VALUES_105E, i.aql);
    if (col < 0) problems.push(`AQL ${i.aql} is not one of the MIL-STD-105E values (${AQL_VALUES_105E.join(", ")}).`);
  }
  if (i.inspection === undefined) problems.push("Choose the inspection severity (normal, tightened or reduced).");
  else if (!INSPECTIONS.includes(i.inspection)) problems.push(`"${String(i.inspection)}" is not an inspection severity (normal, tightened or reduced).`);
  if (problems.length > 0) return failure("aql-105e", problems, CITATION);

  const lotSize = i.lotSize!;
  const level = i.level!;
  const inspection = i.inspection!;
  const letter = aqlCodeLetter(lotSize, level);
  const working = [
    { label: "Lot size", value: String(lotSize) },
    { label: "Inspection level", value: level },
    { label: "Code letter (Table I)", value: letter },
    { label: "Inspection severity", value: inspection },
    { label: "AQL", value: String(i.aql) },
  ];
  const cell = resolveAqlCell(inspection, letter, col);
  if (!cell) {
    return failure("aql-105e", [`MIL-STD-105E ${TABLES[inspection].name} has no plan for code letter ${letter} at AQL ${i.aql}.`], CITATION, working);
  }
  if (cell.arrow) {
    working.push({
      label: `Arrow in ${TABLES[inspection].name}`,
      value: `${letter} at AQL ${i.aql} points ${cell.arrow === "down" ? "down" : "up"}: use the first plan ${cell.arrow === "down" ? "below" : "above"}, code letter ${cell.letter} (its sample size and its accept/reject numbers)`,
    });
  }
  working.push(
    { label: `Plan used (${TABLES[inspection].name})`, value: `code letter ${cell.letter}, n = ${cell.sampleSize}, Ac ${cell.accept}, Re ${cell.reject}` },
  );
  const result: SampleSizeResult = {
    method: "aql-105e",
    ok: true,
    problems: [],
    sampleSize: cell.sampleSize,
    accept: cell.accept,
    reject: cell.reject,
    codeLetter: cell.letter,
    working,
    citation: CITATION,
  };
  if (cell.sampleSize >= lotSize) {
    result.hundredPercent = true;
    result.sampleSize = lotSize;
    working.push({ label: "Lot size check", value: `n = ${cell.sampleSize} is not smaller than the lot of ${lotSize}: inspect the whole lot (100 %).` });
  }
  return result;
}
