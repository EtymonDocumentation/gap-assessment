import type { CompanyTableSnapshot, SamplingPlan } from "@gap/process-model";

/** Row of the stored table that matters to a point, as one comparable string. */
const rowKey = (r: CompanyTableSnapshot["rows"][number]): string => JSON.stringify([r.lotMin, r.lotMax, r.sampleSize, r.accept ?? null, r.reject ?? null, r.testKey ?? null]);

/**
 * Whether the library table a point used has been edited since: a different version, or different rows. A plan that was issued
 * keeps the snapshot it used, so a later edit never silently changes it; this only reports the difference so the owner can
 * decide whether to re-select the table. Returns the sentence to show, or undefined when the table is the same (or gone from the
 * library: that is reported too, because the snapshot then has nothing to compare with).
 */
export function tableChangedSince(snapshot: CompanyTableSnapshot, library: readonly CompanyTableSnapshot[]): string | undefined {
  const current = library.find((t) => t.id === snapshot.id);
  if (!current) return `Table ${snapshot.name} (version ${snapshot.version}) is no longer in the sampling tables library. The plan keeps the copy it used.`;
  if (current.version !== snapshot.version) {
    return `Table ${current.name} is now at version ${current.version}; this point used version ${snapshot.version}. The plan keeps the copy it used.`;
  }
  const a = snapshot.rows.map(rowKey).join("|");
  const b = current.rows.map(rowKey).join("|");
  if (a !== b) return `Table ${current.name} has changed since this point used it (same version ${current.version}, different rows). The plan keeps the copy it used.`;
  return undefined;
}

/** Every distinct table (by id and version) the plan's points used, in first-use order. The document prints one section for each. */
export function tablesUsed(plan: SamplingPlan): CompanyTableSnapshot[] {
  const seen = new Map<string, CompanyTableSnapshot>();
  for (const p of plan.points) {
    const t = p.sampleSize.method === "company-table" ? p.sampleSize.inputs.table : undefined;
    if (t && !seen.has(`${t.id}@${t.version}`)) seen.set(`${t.id}@${t.version}`, t);
  }
  return [...seen.values()];
}
