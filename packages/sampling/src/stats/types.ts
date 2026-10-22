export type Inspection = "normal" | "tightened" | "reduced";
/** MIL-STD-105E Table I levels: the four special levels and the three general levels. */
export type AqlLevel = "S-1" | "S-2" | "S-3" | "S-4" | "I" | "II" | "III";
/** MIL-STD-414 Table A-2 levels. The standard has five (I to V); IV is its normal "general" level. No mapping to 105E is invented. */
export type VarLevel = "I" | "II" | "III" | "IV" | "V";

export interface SampleSizeResult {
  method: "company-table" | "fixed" | "conf-rel" | "aql-105e" | "var-414";
  ok: boolean;
  /** Non-empty means there is no sample size: nothing is guessed, every missing or invalid input is listed in plain words. */
  problems: string[];
  /** Per lot (per batch) for this point. When hundredPercent is set it is the lot size (the whole lot is inspected). */
  sampleSize?: number;
  hundredPercent?: boolean;
  accept?: number;
  reject?: number;
  /** Variables plans: Form 1 acceptability constant k, or Form 2 maximum allowable percent nonconforming M. */
  k?: number;
  maxPercentNonconforming?: number;
  codeLetter?: string;
  /** Every step, in the order a QA reader can follow it. */
  working: { label: string; value: string }[];
  citation: string;
}

export type Method = SampleSizeResult["method"];

export function failure(method: Method, problems: string[], citation: string, working: { label: string; value: string }[] = []): SampleSizeResult {
  return { method, ok: false, problems, working, citation };
}

export const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** Looks an AQL up in a list of the standard's values; exact match only (floating point tolerant), never rounds to the nearest. */
export function aqlIndex(values: readonly number[], aql: number): number {
  return values.findIndex((v) => Math.abs(v - aql) < 1e-9);
}
