import { allEntries, resolveEntry, stableStringify, type Project, type ReviewDoc, type TrdDocument, type TrdField, type TrdRange } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { cell } from "./csv";
import { entryDisplay, entryLabel } from "./labels";
import { effectiveField } from "./trd";
import { historyOf, readVersion } from "./version-history";

/**
 * Compare two versions of the project (or one version and the working copy): which answers and values changed, per document.
 *
 * Both sides are projects already opened with parseProject, so they are compared in the current schema whatever build saved them.
 * The comparison only reports; it never says which side is right. Texts are the ones the documents show (option labels, units, "TBD").
 *
 * The TRD is NOT compared with diffTrdAgainstSeed (checked for job S3): that function compares a TRD with a SEED (the project's current
 * answers turned into pulled values) and decides what "Update from project" may apply, so it cannot take a second stored TRD. The TRD,
 * the sampling plan, the batch record and the risk assessment therefore share one field-by-field walk (below), which reads the documents
 * by their own ids (TS-01, SP-003, ST-0007, ...), so a renamed or moved item is still the same item.
 */

export const WORKING_COPY_LABEL = "Working copy";

export const COMPARE_DOCS: readonly ReviewDoc[] = ["gap", "trd", "sampling", "mbr", "risk"];
/** The names the menu and the stage review use for the five documents. */
export const COMPARE_DOC_NAME: Record<ReviewDoc, string> = { gap: "Gap assessment", trd: "TRD", sampling: "Sampling plan", mbr: "Batch record", risk: "Risk" };

/** "same" only appears when the caller asks for unchanged items too (the page's "Only show changes" switched off). */
export type CompareKind = "changed" | "added" | "removed" | "same";

export interface CompareOptions {
  /** Also list the items that have a value and did not change. Off by default: a comparison lists differences. */
  includeSame?: boolean;
}

export interface CompareRow {
  doc: ReviewDoc;
  /** Where the item sits: the section of the gap assessment, or the plan point, step or document it belongs to. */
  area: string;
  /** The question, field or list entry. */
  item: string;
  kind: CompareKind;
  /** The value in the first version / in the second ("" when the item does not exist there). */
  a: string;
  b: string;
}

const MAX_TEXT = 2000;
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

// ------------------------------------------------------------------ the generic walk

/** Keys that identify or time-stamp a thing but are not content, or that only help to name it. */
const SKIP_KEYS = new Set(["id", "name", "createdAt", "updatedAt", "sourceIds", "locations"]);

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIdList = (v: Json): v is Record<string, Json>[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObject(x) && typeof x.id === "string");

/** "sampleSize" -> "Sample size". Keys that are already words ("Set point") are left alone. */
function humanise(key: string): string {
  const t = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A value as plain words: lists joined with "; ", groups as "Name: value". Empty values are "". */
function plain(v: Json): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join("; ");
  if (isObject(v)) {
    // Keys are sorted: a saved version has been read back through the schema, which can order the keys differently from the working
    // copy, and the same content must never show as a difference just because of that.
    return Object.entries(v)
      .filter(([k]) => !SKIP_KEYS.has(k))
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([k, x]) => {
        const t = plain(x);
        return t ? `${humanise(k)}: ${t}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(v);
}

/** What a list entry is called: its id and its most telling text ("SP-003 Appearance"); `name` wins when the view gives one. */
function elementLabel(el: Record<string, Json>): string {
  if (typeof el.name === "string" && el.name) return el.name;
  const text = [el.label, el.title, el.attribute, el.text].find((x) => typeof x === "string" && x) as string | undefined;
  const t = text && text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return [el.id, t].filter(Boolean).join(" ");
}

interface Ctx {
  doc: ReviewDoc;
  rows: CompareRow[];
  includeSame: boolean;
}

function walkIdList(a: Json, b: Json, path: string[], area: string, ctx: Ctx): void {
  const la = (Array.isArray(a) ? a : []) as Record<string, Json>[];
  const lb = (Array.isArray(b) ? b : []) as Record<string, Json>[];
  const ma = new Map(la.map((e) => [e.id as string, e]));
  const mb = new Map(lb.map((e) => [e.id as string, e]));
  const where = path.join(", ");
  for (const id of [...mb.keys(), ...[...ma.keys()].filter((k) => !mb.has(k))]) {
    const ea = ma.get(id);
    const eb = mb.get(id);
    if (!ea || !eb) {
      const el = (ea ?? eb)!;
      const label = elementLabel(el);
      ctx.rows.push({ doc: ctx.doc, area, item: where ? `${where}: ${label}` : label, kind: eb ? "added" : "removed", a: ea ? clip(plain(ea)) : "", b: eb ? clip(plain(eb)) : "" });
    } else walk(ea, eb, [], elementLabel(eb), ctx);
  }
}

function walk(a: Json, b: Json, path: string[], area: string, ctx: Ctx): void {
  if (isIdList(a) || isIdList(b)) return walkIdList(a, b, path, area, ctx);
  if (isObject(a) || isObject(b)) {
    const oa = isObject(a) ? a : {};
    const ob = isObject(b) ? b : {};
    for (const k of new Set([...Object.keys(oa), ...Object.keys(ob)])) if (!SKIP_KEYS.has(k)) walk(oa[k], ob[k], [...path, humanise(k)], area, ctx);
    return;
  }
  const ta = plain(a);
  const tb = plain(b);
  if (ta === tb) {
    if (ctx.includeSame && ta) ctx.rows.push({ doc: ctx.doc, area, item: path.join(", ") || "Value", kind: "same", a: clip(ta), b: clip(tb) });
    return;
  }
  ctx.rows.push({ doc: ctx.doc, area, item: path.join(", ") || "Value", kind: !ta ? "added" : !tb ? "removed" : "changed", a: clip(ta), b: clip(tb) });
}

// ------------------------------------------------------------------ the TRD as readable values

const fieldText = (f: TrdField) => effectiveField(f).text;
const fieldsView = (list: TrdField[]): Record<string, string> => Object.fromEntries(list.map((f) => [f.label, fieldText(f)]));
const rangeText = (r: TrdRange | undefined) => (r ? `${r.min ?? "…"} to ${r.max ?? "…"}${r.unit ? ` ${r.unit}` : ""}${r.provisional ? " (provisional)" : ""}` : "");

/** The TRD as plain values: the shown text of every field (an override wins over the project value) and the limits in words. */
function trdView(d: TrdDocument): Record<string, Json> {
  return {
    id: d.id,
    title: d.title,
    version: d.version,
    "Document reference": d.docRef,
    purpose: d.purpose,
    "Scope note": d.scopeNote,
    Details: fieldsView(d.details),
    steps: d.steps.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      fields: fieldsView(s.fields),
      items: s.items.map((i) => ({
        id: `${i.collection}.${i.key}`,
        name: `${s.label}, ${i.label}`,
        fields: fieldsView(i.fields),
        "Set point": i.limits?.setPoint ? `${i.limits.setPoint.value}${i.limits.setPoint.unit ? ` ${i.limits.setPoint.unit}` : ""}${i.limits.setPoint.provisional ? " (provisional)" : ""}` : "",
        "Normal operating range": rangeText(i.limits?.nor),
        "Proven acceptable range": rangeText(i.limits?.par),
        control: i.control,
      })),
    })),
  };
}

// ------------------------------------------------------------------ the gap assessment

function gapRows(content: ContentBundle, a: Project, b: Project, includeSame: boolean): CompareRow[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const p of [b, a]) {
    for (const e of allEntries(p)) {
      if (!seen.has(e.path)) {
        seen.add(e.path);
        refs.push(e.path);
      }
    }
  }
  const rows: CompareRow[] = [];
  const key = (p: Project, ref: string) => {
    const r = resolveEntry(p, ref);
    return stableStringify({ s: r.status, v: r.value ?? null, j: r.justification ?? "", same: r.sameAsSource, prov: r.provisional ?? false });
  };
  for (const ref of refs) {
    const same = key(a, ref) === key(b, ref);
    if (same && (!includeSame || resolveEntry(b, ref).status === "not_established")) continue;
    let ta: string;
    let tb: string;
    let label: { sectionTitle: string; sideText: string; attribute: string };
    try {
      ta = entryDisplay(content, a, ref);
      tb = entryDisplay(content, b, ref);
      label = entryLabel(content, b, ref);
    } catch {
      continue;
    }
    if (ta === tb && !same) continue;
    const sa = resolveEntry(a, ref).status;
    const sb = resolveEntry(b, ref).status;
    rows.push({
      doc: "gap",
      area: label.sectionTitle || "Gap assessment",
      item: `${label.sideText}: ${label.attribute || ref}`,
      kind: same ? "same" : sa === "not_established" ? "added" : sb === "not_established" ? "removed" : "changed",
      a: ta,
      b: tb,
    });
  }
  return rows;
}

// ------------------------------------------------------------------ public

/**
 * Everything that differs between two projects, per document, in document order. Identical projects give an empty list. The gap
 * assessment is compared question by question (both sides, and the project stage with them); the other documents by their own ids.
 */
export function compareVersions(content: ContentBundle, a: Project, b: Project, opts: CompareOptions = {}): CompareRow[] {
  const includeSame = opts.includeSame ?? false;
  const rows: CompareRow[] = gapRows(content, a, b, includeSame);
  const docs = (doc: ReviewDoc, root: string, la: Json, lb: Json) => walk(la, lb, [], root, { doc, rows, includeSame });
  // The TRD documents are listed by id like the others; a list with no entry on either side is skipped quietly by the walk.
  docs("trd", COMPARE_DOC_NAME.trd, a.trd.documents.map(trdView), b.trd.documents.map(trdView));
  docs("sampling", COMPARE_DOC_NAME.sampling, a.sampling.plans, b.sampling.plans);
  docs("mbr", COMPARE_DOC_NAME.mbr, a.mbr.records, b.mbr.records);
  docs("risk", COMPARE_DOC_NAME.risk, a.risk.assessments, b.risk.assessments);
  return rows;
}

/** How many differences each document has (unchanged items, when listed, are not counted). */
export function compareCounts(rows: readonly CompareRow[]): Record<ReviewDoc, number> {
  const out: Record<ReviewDoc, number> = { gap: 0, trd: 0, sampling: 0, mbr: 0, risk: 0 };
  for (const r of rows) if (r.kind !== "same") out[r.doc]++;
  return out;
}

/** "22 changes: Gap assessment 9, TRD 7". Nothing changed reads as such. */
export function compareSummary(rows: readonly CompareRow[]): string {
  const c = compareCounts(rows);
  const total = COMPARE_DOCS.reduce((n, d) => n + c[d], 0);
  if (total === 0) return "No differences between these two.";
  const parts = COMPARE_DOCS.filter((d) => c[d] > 0).map((d) => `${COMPARE_DOC_NAME[d]} ${c[d]}`);
  return `${total} ${total === 1 ? "change" : "changes"}: ${parts.join(", ")}`;
}

/** The word in the Change column. Never colour alone: "Changed", "Added in v2.1", "Removed in v2.1". */
export function compareChangeWord(kind: CompareKind, bLabel: string): string {
  if (kind === "changed") return "Changed";
  if (kind === "same") return "Unchanged";
  const where = bLabel === WORKING_COPY_LABEL ? "the working copy" : bLabel;
  return `${kind === "added" ? "Added" : "Removed"} in ${where}`;
}

/** The changes logged between two versions: the change log only ever grows, so the difference in length is the number. */
export function loggedBetween(a: Project, b: Project): number {
  return Math.abs(b.changeLog.length - a.changeLog.length);
}

/**
 * One side of a comparison: the working copy, or a saved version read from the history (null when no version has that label).
 * Reading decompresses the version, so it is async.
 */
export async function openSide(working: Project, label: string): Promise<Project | null> {
  if (label === WORKING_COPY_LABEL) return working;
  const entry = historyOf(working).entries.find((e) => e.label === label);
  return entry ? readVersion(entry) : null;
}

/** CSV of the rows (all documents, or the ones given), cells made safe against spreadsheet formulas like the change log's. */
export function compareToCsv(rows: readonly CompareRow[], aLabel: string, bLabel: string): string {
  const head = ["Document", "Area", "Item", "Change", aLabel, bLabel];
  const body = rows.map((r) => [COMPARE_DOC_NAME[r.doc], r.area, r.item, compareChangeWord(r.kind, bLabel), r.a, r.b]);
  return [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
