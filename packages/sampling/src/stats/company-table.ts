import { z } from "zod";
import { failure, type SampleSizeResult } from "./types";

export interface CompanySamplingTable {
  id: string;
  name: string;
  version: string;
  documentRef?: string;
  owner?: string;
  rows: { lotMin: number; lotMax: number | null; sampleSize: number; accept?: number; reject?: number; testKey?: string }[];
  note?: string;
}

const row = z.object({
  lotMin: z.number().int().min(1),
  lotMax: z.number().int().min(1).nullable(),
  sampleSize: z.number().int().min(1),
  accept: z.number().int().min(0).optional(),
  reject: z.number().int().min(0).optional(),
  testKey: z.string().min(1).optional(),
});

/** Shape of a company sampling table as stored in a project. The plain-words checks (gaps, overlaps ...) are in validateCompanyTable. */
export const companySamplingTableSchema: z.ZodType<CompanySamplingTable> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  documentRef: z.string().optional(),
  owner: z.string().optional(),
  rows: z.array(row),
  note: z.string().optional(),
});

const range = (r: { lotMin: number; lotMax: number | null }) => `${r.lotMin} to ${r.lotMax === null ? "any larger lot" : r.lotMax}`;

/**
 * Plain-words problems with a company table. A table that is not clean can still be used for the lots it does cover, so these are
 * reported to the author and the reviewer, not hidden. Rows are checked per test key, because each test has its own ranges.
 */
export function validateCompanyTable(table: CompanySamplingTable): string[] {
  const problems: string[] = [];
  if (table.rows.length === 0) problems.push("The table has no rows.");
  const groups = new Map<string, CompanySamplingTable["rows"]>();
  for (const r of table.rows) {
    const key = r.testKey ?? "";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rows] of groups) {
    const where = key ? ` (test "${key}")` : "";
    rows.forEach((r, idx) => {
      const label = `Row ${range(r)}${where}`;
      if (r.lotMax !== null && r.lotMax < r.lotMin) problems.push(`${label}: the largest lot size is smaller than the smallest.`);
      if (r.sampleSize < 1) problems.push(`${label}: the sample size must be 1 or more.`);
      if (r.accept !== undefined && r.reject !== undefined && r.accept >= r.reject) problems.push(`${label}: the accept number must be smaller than the reject number.`);
      if (r.lotMax !== null && r.sampleSize > r.lotMax) problems.push(`${label}: the sample size ${r.sampleSize} is larger than the largest lot in the row (${r.lotMax}).`);
      const prev = rows[idx - 1];
      if (prev && r.lotMin < prev.lotMin) problems.push(`${label}: rows are out of order (this row starts below the one before it).`);
    });
    const sorted = [...rows].sort((a, b) => a.lotMin - b.lotMin);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (a.lotMax === null) problems.push(`Rows ${range(a)} and ${range(b)}${where} overlap: the first has no upper limit.`);
      else if (b.lotMin <= a.lotMax) problems.push(`Rows ${range(a)} and ${range(b)}${where} overlap.`);
      else if (b.lotMin > a.lotMax + 1) problems.push(`Gap${where}: lot sizes ${a.lotMax + 1} to ${b.lotMin - 1} are not covered by any row.`);
    }
  }
  return problems;
}

/** Looks the lot size up in the company's own table. The table supplies the answer; nothing is interpolated or extrapolated. */
export function companyTablePlan(i: { table: CompanySamplingTable; lotSize?: number; testKey?: string }): SampleSizeResult {
  const { table, lotSize } = i;
  const testKey = i.testKey?.trim() || undefined;
  const citation = `${table.name}, version ${table.version}${table.documentRef ? `, ${table.documentRef}` : ""}${table.owner ? ` (owner: ${table.owner})` : ""}`;
  const problems: string[] = [];
  if (lotSize === undefined) problems.push("Enter the lot size.");
  else if (!Number.isInteger(lotSize) || lotSize < 1) problems.push("The lot size must be a whole number of 1 or more.");
  const keyed = table.rows.some((r) => r.testKey !== undefined);
  if (keyed && !testKey) problems.push(`Table ${table.name} v${table.version} has rows per test: choose the test.`);
  if (table.rows.length === 0) problems.push(`Table ${table.name} v${table.version} has no rows.`);
  if (problems.length > 0) return failure("company-table", problems, citation);

  const candidates = table.rows.filter((r) => (keyed ? r.testKey === testKey : true));
  const hits = candidates.filter((r) => lotSize! >= r.lotMin && (r.lotMax === null || lotSize! <= r.lotMax));
  const working = [
    { label: "Company table", value: `${table.name} v${table.version}` },
    ...(table.documentRef ? [{ label: "Document", value: table.documentRef }] : []),
    ...(testKey ? [{ label: "Test", value: testKey }] : []),
    { label: "Lot size", value: String(lotSize) },
  ];
  if (hits.length === 0) {
    const forTest = keyed ? ` for test "${testKey}"` : "";
    return failure("company-table", [`Lot size ${lotSize} is outside table ${table.name} v${table.version}${forTest}.`], citation, working);
  }
  if (hits.length > 1) {
    return failure("company-table", [`More than one row of table ${table.name} v${table.version} holds lot size ${lotSize}: fix the overlapping rows.`], citation, working);
  }
  const hit = hits[0]!;
  working.push({ label: "Row used", value: `lot sizes ${range(hit)}` }, { label: "Sample size n", value: String(hit.sampleSize) });
  const result: SampleSizeResult = { method: "company-table", ok: true, problems: [], sampleSize: hit.sampleSize, working, citation };
  if (hit.accept !== undefined && hit.reject !== undefined) {
    result.accept = hit.accept;
    result.reject = hit.reject;
    working.push({ label: "Accept / reject", value: `${hit.accept} / ${hit.reject}` });
  }
  if (hit.sampleSize >= lotSize!) {
    result.hundredPercent = true;
    result.sampleSize = lotSize!;
    working.push({ label: "Lot size check", value: `n = ${hit.sampleSize} is not smaller than the lot of ${lotSize}: inspect the whole lot (100 %).` });
  }
  return result;
}
