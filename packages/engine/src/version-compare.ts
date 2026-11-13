import { EXCIPIENT_FACTS, EXCIPIENT_SIDE_LABEL, FACILITY_GRADE_LABEL, FACILITY_UNITS, FACILITY_UNIT_LABEL, allEntries, facilityAreas, excipientAssessments, excipientFactPath, resolveEntry, stableStringify, type ExcipientAssessment, type Project, type ReviewDoc, type TrdDocument, type TrdField, type TrdRange } from "@gap/process-model";
import { excipientTbdText } from "./excipient-analysis";
import type { ContentBundle } from "./content";
import { cell } from "./csv";
import { entryDisplay, entryLabel } from "./labels";
import { effectiveField, trdTemplateChoiceText } from "./trd";
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

/** The five documents of the stage review, the excipient assessment and the facility areas (parts of the project, not documents of the five). */
export type CompareDoc = ReviewDoc | "excipient" | "areas";
export const COMPARE_DOCS: readonly CompareDoc[] = ["gap", "trd", "sampling", "mbr", "risk", "excipient", "areas"];
/** The names the menu and the stage review use for the documents. */
export const COMPARE_DOC_NAME: Record<CompareDoc, string> = { gap: "Gap assessment", trd: "TRD", sampling: "Sampling plan", mbr: "Batch record", risk: "Risk", excipient: "Excipient assessment", areas: "Facility areas" };

/** "same" only appears when the caller asks for unchanged items too (the page's "Only show changes" switched off). */
export type CompareKind = "changed" | "added" | "removed" | "same";

export interface CompareOptions {
  /** Also list the items that have a value and did not change. Off by default: a comparison lists differences. */
  includeSame?: boolean;
}

export interface CompareRow {
  doc: CompareDoc;
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

/**
 * Keys that identify or time-stamp a thing but are not content, or that only help to name it. `sourceIds` and `locations` (which source
 * backs a value, and the page or section cited) are left out on purpose: they are ids of the source register, not words a reader can
 * compare. The compare page says so (COMPARE_LEFT_OUT) so nobody reads "no difference" as "the same citation".
 */
const SKIP_KEYS = new Set(["id", "name", "createdAt", "updatedAt", "sourceIds", "locations"]);

/** What the comparison does not look at, in the words the compare page shows under the summary. */
export const COMPARE_LEFT_OUT = "Not compared: which source backs a value, and the page or section cited for it. Check those in the source register. Which heading of a template each section is placed under is kept with the template in the library, not in a version, so it is not compared either.";

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
  doc: CompareDoc;
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
/**
 * The fields of a list by their label. Two fields can carry one label (a step with two "Make" lines); keyed by the label alone the second
 * would overwrite the first and a change in either would go unseen, so a repeated label is told apart by the field's own key.
 */
function fieldsView(list: TrdField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of list) {
    let name = f.label;
    for (let n = 2; name in out; n++) name = `${f.label} (${f.key}${n > 2 ? `, ${n}` : ""})`;
    out[name] = fieldText(f);
  }
  return out;
}
const rangeText = (r: TrdRange | undefined) => (r ? `${r.min ?? "…"} to ${r.max ?? "…"}${r.unit ? ` ${r.unit}` : ""}${r.provisional ? " (provisional)" : ""}` : "");

/**
 * One write-up (a process description or a TRD-level section) as plain values: its title, whether it is marked not applicable, each part
 * with its text, table rows, figure caption and picture, and the values the team typed for blanks. The compare page is the decision aid
 * for a stage change and for a restore, so a changed hold time in prose must show here as it does in a field.
 */
function writeupView(w: NonNullable<TrdDocument["writeups"]>[number]): Record<string, Json> {
  return {
    id: w.id,
    name: `Write-up ${w.id}: ${w.title}`,
    title: w.title,
    // Only the switch matters to a reader; the condition and its wording are the library's text and are shown when they change.
    "Marked not applicable": w.notApplicable ? (w.notApplicable.on ? "Yes" : "No") : "",
    "Not applicable wording": w.notApplicable ? `${w.notApplicable.condition}: ${w.notApplicable.text}` : "",
    parts: w.parts.map((p) => ({
      id: p.id,
      name: `${w.id}, ${p.title || p.kind} (${p.id})`,
      kind: p.kind,
      title: p.title,
      text: p.text,
      columns: p.columns,
      // Rows are joined cell by cell so a moved value shows as a change, not as the same list of words.
      rows: p.rows?.map((r) => r.join(" | ")),
      caption: p.caption,
      alt: p.alt,
      // The picture is named by its file and its hash, never by its bytes.
      Picture: p.image ? [p.image.name, p.image.sha256 ?? `${p.image.bytes} bytes`].filter(Boolean).join(", ") : "",
      // Optional parts only: "Not chosen" is a state of its own (the stage decides), different from the author switching it off.
      "Switched on": p.optional ? (p.included === true ? "Yes" : p.included === false ? "No" : "Not chosen") : "",
    })),
    // The value typed for each blank, by the blank's key. Who typed it and when are in the change log, not here.
    "Values typed for blanks": Object.fromEntries(Object.entries(w.values ?? {}).map(([k, v]) => [k, v.value])),
  };
}

/** The sign-off lines. They have no id of their own, so the role (counted when it repeats) is the id: a changed name or date is a change of that line. */
function approvalsView(list: NonNullable<TrdDocument["approvals"]>): Record<string, Json>[] {
  const seen = new Map<string, number>();
  return list.map((a) => {
    const n = (seen.get(a.role) ?? 0) + 1;
    seen.set(a.role, n);
    return { id: n > 1 ? `${a.role} (${n})` : a.role, name: `Approval, ${a.role}${n > 1 ? ` (${n})` : ""}`, Approver: a.name ?? "", Date: a.date ?? "" };
  });
}

/** The text a person wrote under one heading of their template, named by the heading's position and words (the same key the TRD stores it by). */
const headingTextKey = (t: { headingIndex: number; headingText: string }) => `${t.headingIndex}|${t.headingText}`;

/** The state of the heading match that lives on the TRD, in words: text written under headings and sections added back. "none" when there is neither. */
function headingMatchText(d: TrdDocument): string {
  const w = d.headingTexts?.length ?? 0;
  const a = d.addedBack?.length ?? 0;
  const parts = [w ? `${w} ${w === 1 ? "heading" : "headings"} with your own text` : "", a ? `${a} ${a === 1 ? "section" : "sections"} added back` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "none";
}

/**
 * One line when the heading match of a TRD changed between two versions: "Heading match: 3 headings changed". The match that lives on the TRD is
 * the text written under headings (changed, added or removed) and the sections added back, which land under the one heading "Additional content",
 * so a different set of add-backs counts as one heading. The placement of content under headings is kept on the template in the library, not in
 * a project version, so it cannot be compared here; COMPARE_LEFT_OUT says so.
 */
function headingMatchRows(a: TrdDocument, b: TrdDocument, includeSame: boolean): CompareRow[] {
  const ta = new Map((a.headingTexts ?? []).map((t) => [headingTextKey(t), t.text]));
  const tb = new Map((b.headingTexts ?? []).map((t) => [headingTextKey(t), t.text]));
  let changed = 0;
  for (const k of new Set([...ta.keys(), ...tb.keys()])) if (ta.get(k) !== tb.get(k)) changed++;
  const sa = [...new Set(a.addedBack ?? [])].sort().join("|");
  const sb = [...new Set(b.addedBack ?? [])].sort().join("|");
  if (sa !== sb) changed++;
  const before = headingMatchText(a);
  const after = headingMatchText(b);
  if (changed === 0 && !(includeSame && before !== "none")) return [];
  return [
    {
      doc: "trd",
      area: [b.id, b.title].filter(Boolean).join(" "),
      item: changed ? `Heading match: ${changed} ${changed === 1 ? "heading" : "headings"} changed` : "Heading match",
      kind: changed ? "changed" : "same",
      a: before,
      b: after,
    },
  ];
}

/** The TRD as plain values: the shown text of every field (an override wins over the project value), the limits in words, the write-ups and the approvals. */
function trdView(d: TrdDocument): Record<string, Json> {
  return {
    id: d.id,
    title: d.title,
    version: d.version,
    "Document reference": d.docRef,
    purpose: d.purpose,
    "Scope note": d.scopeNote,
    // The Word template is part of what the TRD is (M15), so a changed choice is one plain line, in the words every other screen uses.
    "Word template": trdTemplateChoiceText(d.templateChoice),
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
    writeups: (d.writeups ?? []).map(writeupView),
    approvals: approvalsView(d.approvals ?? []),
  };
}

// ------------------------------------------------------------------ the excipient assessments

/**
 * The excipient assessments as plain values: each fact under the words of its question (and the site it is for), the specification rows
 * by test, and the links. A fact reads as the person sees it: the stated value, "TBD" or nothing. The facts are looked up through
 * resolveEntry, so "same as the sending site" shows the sending site's value on both sides of the comparison.
 */
function excipientView(project: Project, a: ExcipientAssessment): Record<string, Json> {
  return {
    id: a.id,
    title: a.title,
    "Purpose and scope": a.scopeNote ?? "",
    lines: a.lines.map((l) => {
      const facts: Record<string, Json> = {};
      for (const def of EXCIPIENT_FACTS) {
        for (const side of def.perSide ? (["sending", "receiving"] as const) : ([undefined] as const)) {
          const path = excipientFactPath(a.id, l.id, def.key, side);
          if (l.facts[path] === undefined) continue;
          const r = resolveEntry(project, path);
          facts[side ? `${def.label}, ${EXCIPIENT_SIDE_LABEL[side]}` : def.label] = r.status === "established" ? plain(r.value) : r.status === "tbd" ? excipientTbdText(r.tbd) : "";
        }
      }
      return {
        id: l.id,
        label: l.name,
        Role: l.classLabel ?? l.classKey ?? "",
        facts,
        specs: l.specs.map((r) => ({
          id: r.id,
          label: r.test,
          Note: r.note ?? "",
          "Sending site": specSideText(r.sending),
          "Receiving site": specSideText(r.receiving),
        })),
        "Linked gaps": l.links.gapIds.join("; "),
        "Linked risk items": l.links.riskItems.map((x) => `${x.assessmentId} ${x.itemId}`).join("; "),
        "Technical requirements document": l.links.trdItem ? `${l.links.trdItem.trdId}, ${l.links.trdItem.stepKey}, ${l.links.trdItem.itemKey}` : "",
        "Regulatory affairs assessment document": l.links.regulatoryReference ?? "",
      };
    }),
  };
}

function specSideText(s: { state: string; method?: string; criterion?: string; unit?: string }): string {
  if (s.state === "not_tested") return "Not tested";
  if (s.state !== "stated") return "";
  return [s.method, [s.criterion, s.unit].filter(Boolean).join(" ")].filter(Boolean).join(": ");
}

// ------------------------------------------------------------------ the gap assessment

// ------------------------------------------------------------------ the facility areas (M14)

/**
 * The areas of both units as plain values: one entry per area, listed by its id, with the grade the person stated, the area it sits inside, the
 * steps done there (by name, in process order) and the note. The areas only help find questions, but they are a part of the project that a
 * reviewer can see changed between two versions, so they are compared like any other part. A rename shows as "Area name".
 */
function areasView(content: ContentBundle, project: Project): Record<string, Json>[] {
  const order = [...content.catalog.unitOperations, ...(project.custom?.unitOperations ?? [])].sort((x, y) => x.sequence - y.sequence);
  const label = new Map(order.map((u) => [u.key, u.label] as const));
  const out: Record<string, Json>[] = [];
  for (const unit of FACILITY_UNITS) {
    const areas = facilityAreas(project, unit);
    for (const a of areas) {
      const steps = order.filter((u) => a.stepKeys.includes(u.key)).map((u) => u.label);
      const unknown = a.stepKeys.filter((k) => !label.has(k));
      out.push({
        id: a.id,
        // `name` is only the label of the row (a key called name is never compared); the area's own name is compared as "Area name".
        name: `${FACILITY_UNIT_LABEL[unit]}: ${a.name}`,
        "Area name": a.name,
        Grade: a.grade ? FACILITY_GRADE_LABEL[a.grade] : "Not stated",
        "Inside area": areas.find((x) => x.id === a.insideAreaId)?.name ?? "",
        "Steps done here": [...steps, ...unknown].join(", "),
        Note: a.note ?? "",
        "From the example, please check": a.fromExample ? "Yes" : "",
      });
    }
  }
  return out;
}

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
  const docs = (doc: CompareDoc, root: string, la: Json, lb: Json) => walk(la, lb, [], root, { doc, rows, includeSame });
  // The TRD documents are listed by id like the others; a list with no entry on either side is skipped quietly by the walk.
  docs("trd", COMPARE_DOC_NAME.trd, a.trd.documents.map(trdView), b.trd.documents.map(trdView));
  for (const db of b.trd.documents) {
    const da = a.trd.documents.find((x) => x.id === db.id);
    if (da) rows.push(...headingMatchRows(da, db, includeSame));
  }
  docs("sampling", COMPARE_DOC_NAME.sampling, a.sampling.plans, b.sampling.plans);
  docs("mbr", COMPARE_DOC_NAME.mbr, a.mbr.records, b.mbr.records);
  docs("risk", COMPARE_DOC_NAME.risk, a.risk.assessments, b.risk.assessments);
  // Saved versions carry the excipient assessments (spec section 8): the whole project is stored, so they are read back like the rest.
  docs("excipient", COMPARE_DOC_NAME.excipient, excipientAssessments(a).map((x) => excipientView(a, x)), excipientAssessments(b).map((x) => excipientView(b, x)));
  // The facility areas (optional; a project from before them has none, so two such projects show no difference).
  docs("areas", COMPARE_DOC_NAME.areas, areasView(content, a), areasView(content, b));
  return rows;
}

/** How many differences each document has (unchanged items, when listed, are not counted). */
export function compareCounts(rows: readonly CompareRow[]): Record<CompareDoc, number> {
  const out: Record<CompareDoc, number> = { gap: 0, trd: 0, sampling: 0, mbr: 0, risk: 0, excipient: 0, areas: 0 };
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
