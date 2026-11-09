import {
  ANIMAL_FACT_KEYS,
  ANIMAL_ORIGINS,
  EXCIPIENT_FACTS,
  EXCIPIENT_REGULATORY_SENTENCE,
  EXCIPIENT_SIDES,
  EXCIPIENT_SIDE_LABEL,
  compareQuantities,
  excipientFactPath,
  resolveEntry,
  stableStringify,
  unitDef,
  type ExcipientAssessment,
  type ExcipientFactDef,
  type ExcipientLine,
  type ExcipientSide,
  type ExcipientSpecRow,
  type ExcipientSpecSide,
  type Project,
  type Resolved,
  type TbdInfo,
} from "@gap/process-model";

/*
 * What the excipient facts say, derived every time and never stored: the specification comparison, the change-risk markers, the one
 * regulatory sentence, the facts that apply to a line and the open items. Nothing here decides anything: a comparison says "different"
 * and never which side is stricter; a marker is a reason to look and never a finding; the only regulatory wording is the fixed sentence
 * "Requires regulatory affairs assessment" (the tool never names a filing category or a variation type).
 */

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ------------------------------------------------------------------ specification comparison

export type SpecResult = "same" | "different" | "only_sending" | "only_receiving" | "not_compared";

export const SPEC_RESULT_LABEL: Readonly<Record<SpecResult, string>> = {
  same: "Same",
  different: "Different",
  only_sending: "Only at the sending site",
  only_receiving: "Only at the receiving site",
  not_compared: "Not compared yet",
};

const CRITERION = /^(<=|>=|<|>|≤|≥|nmt|nlt)?\s*([+-]?\d+(?:[.,]\d+)?|[+-]?[.,]\d+)$/i;
const RELATION: Record<string, string> = { "≤": "<=", nmt: "<=", "≥": ">=", nlt: ">=" };

/** A criterion that is a plain number with an optional relation ("<= 0.25", "NMT 0.25", "7.4"). Anything else is compared as text. */
export function parseCriterion(s: string): { relation: string; value: number } | undefined {
  const m = CRITERION.exec(s.trim().replace(/\s+/g, " "));
  if (!m) return undefined;
  const raw = m[2]!;
  // "0,25" reads as a decimal comma only when there is no dot; "1,000" stays out because it is ambiguous and is then compared as text.
  const value = Number(raw.includes(".") ? raw : raw.replace(",", "."));
  if (!Number.isFinite(value) || /^\d{1,3}(,\d{3})+$/.test(raw)) return undefined;
  const rel = (m[1] ?? "").toLowerCase();
  return { relation: RELATION[rel] ?? rel, value };
}

/** Same criterion on both sides? Numbers are equal after unit conversion (exact, as everywhere in the tool); everything else is equal as written, ignoring case and spacing. */
function criteriaEqual(a: ExcipientSpecSide, b: ExcipientSpecSide): boolean {
  const ca = a.criterion ?? "";
  const cb = b.criterion ?? "";
  const pa = parseCriterion(ca);
  const pb = parseCriterion(cb);
  if (!pa || !pb) return norm(ca) === norm(cb) && norm(a.unit ?? "") === norm(b.unit ?? "");
  if (pa.relation !== pb.relation) return false;
  const ua = a.unit?.trim() ?? "";
  const ub = b.unit?.trim() ?? "";
  if (ua && ub && unitDef(ua) && unitDef(ub)) {
    try {
      return compareQuantities({ value: pa.value, unit: ua }, { value: pb.value, unit: ub }) === 0;
    } catch {
      return false; // different kinds of unit cannot be equal
    }
  }
  return norm(ua) === norm(ub) && pa.value === pb.value;
}

/** The result of one comparison row. "Not compared yet" while either side is open. No side is ever called stricter or wider. */
export function compareSpecRow(row: ExcipientSpecRow): SpecResult {
  const s = row.sending;
  const r = row.receiving;
  if (s.state === "open" || r.state === "open") return "not_compared";
  if (s.state === "not_tested" && r.state === "not_tested") return "same";
  if (s.state === "stated" && r.state === "not_tested") return "only_sending";
  if (s.state === "not_tested" && r.state === "stated") return "only_receiving";
  return criteriaEqual(s, r) ? "same" : "different";
}

export interface SpecCounts {
  rows: number;
  /** Rows with a result (everything except "Not compared yet"). */
  compared: number;
  same: number;
  different: number;
  onlyAtOneSite: number;
  notCompared: number;
}

export function specCounts(line: Pick<ExcipientLine, "specs">): SpecCounts {
  const c: SpecCounts = { rows: line.specs.length, compared: 0, same: 0, different: 0, onlyAtOneSite: 0, notCompared: 0 };
  for (const row of line.specs) {
    const res = compareSpecRow(row);
    if (res === "not_compared") c.notCompared++;
    else {
      c.compared++;
      if (res === "same") c.same++;
      else if (res === "different") c.different++;
      else c.onlyAtOneSite++;
    }
  }
  return c;
}

/** "3 tests compared, 1 same, 1 different, 1 only at one site, 2 not compared yet"; an empty table says so. */
export function specCountsText(c: SpecCounts): string {
  if (c.rows === 0) return "No tests entered yet";
  return `${c.compared} ${c.compared === 1 ? "test" : "tests"} compared, ${c.same} same, ${c.different} different, ${c.onlyAtOneSite} only at one site, ${c.notCompared} not compared yet`;
}

// ------------------------------------------------------------------ facts of a line

/** The fact as the line holds it, "same as the sending site" read through to the sending site's fact. */
export function excipientFactResolved(project: Project, assessmentId: string, lineId: string, key: string, side?: ExcipientSide): Resolved {
  return resolveEntry(project, excipientFactPath(assessmentId, lineId, key, side));
}

/** The text of a stated fact. A to-be-decided fact with a best guess is provisional and is not a statement: it reads as nothing. */
const textOf = (r: Resolved): string | undefined => (r.status === "established" && !r.provisional && typeof r.value === "string" ? r.value : undefined);

export interface ApplicableFact {
  def: ExcipientFactDef;
  side?: ExcipientSide;
  path: string;
}

/**
 * The facts that apply to a line, in the order they are asked. Three facts only exist when an earlier answer calls for them, so the
 * line never asks something that makes no sense: the animal-origin details only when the origin on that side is animal or mixed, and
 * the place of the nitrosamine or elemental evaluation only when the topic is marked as evaluated. A hidden fact that already holds an
 * answer is still listed (an answer is never hidden or dropped because another answer changed).
 */
export function applicableFacts(project: Project, assessmentId: string, line: ExcipientLine): ApplicableFact[] {
  const out: ApplicableFact[] = [];
  for (const def of EXCIPIENT_FACTS) {
    const sides: (ExcipientSide | undefined)[] = def.perSide ? [...EXCIPIENT_SIDES] : [undefined];
    for (const side of sides) {
      const path = excipientFactPath(assessmentId, line.id, def.key, side);
      const held = line.facts[path] !== undefined;
      let applies = true;
      if (ANIMAL_FACT_KEYS.includes(def.key)) {
        const origin = textOf(excipientFactResolved(project, assessmentId, line.id, "origin", side));
        applies = origin !== undefined && ANIMAL_ORIGINS.includes(origin);
      } else if (def.key === "nitrosamineRef" || def.key === "elementalRef") {
        const topic = def.key === "nitrosamineRef" ? "nitrosamine" : "elemental";
        applies = textOf(excipientFactResolved(project, assessmentId, line.id, topic)) === "evaluated";
      }
      if (applies || held) out.push({ def, ...(side ? { side } : {}), path });
    }
  }
  return out;
}

// ------------------------------------------------------------------ change-risk markers

export type ExcipientMarkerKey =
  | "different_supplier"
  | "different_site"
  | "different_grade"
  | "different_specification"
  | "different_origin"
  | "origin_not_known"
  | "supplier_not_qualified"
  | "single_source";

export interface ExcipientMarkerDef {
  key: ExcipientMarkerKey;
  label: string;
  /** The first five: any of them also puts the sentence "Requires regulatory affairs assessment" on the line. */
  regulatory: boolean;
}

/** Plain words, in the order shown. The explanation under each (with stage wording) is in content/excipient/wording.yaml under `markers`. */
export const EXCIPIENT_MARKERS: readonly ExcipientMarkerDef[] = [
  { key: "different_supplier", label: "Different supplier", regulatory: true },
  { key: "different_site", label: "Different manufacturing site", regulatory: true },
  { key: "different_grade", label: "Different grade or standard", regulatory: true },
  { key: "different_specification", label: "Different specification", regulatory: true },
  { key: "different_origin", label: "Different source or origin", regulatory: true },
  { key: "origin_not_known", label: "Origin not known", regulatory: false },
  { key: "supplier_not_qualified", label: "Supplier not qualified at the receiving site", regulatory: false },
  { key: "single_source", label: "Single source at the receiving site", regulatory: false },
];

function normValue(v: unknown): string {
  if (typeof v === "string") return norm(v);
  if (Array.isArray(v)) return stableStringify([...v].map((x) => (typeof x === "string" ? norm(x) : x)).sort());
  return stableStringify(v);
}

/**
 * True only when both sites have stated the fact and the statements differ. A receiving fact set to "same as the sending site" is the
 * same by definition. An open fact never raises a marker (it shows in the open items instead): the tool does not guess.
 */
function sitesDiffer(project: Project, assessmentId: string, line: ExcipientLine, key: string): boolean {
  const s = excipientFactResolved(project, assessmentId, line.id, key, "sending");
  const r = excipientFactResolved(project, assessmentId, line.id, key, "receiving");
  if (r.sameAsSource) return false;
  if (s.status !== "established" || r.status !== "established" || s.provisional || r.provisional) return false;
  if (s.value === undefined || r.value === undefined) return false;
  return normValue(s.value) !== normValue(r.value);
}

/** The markers that apply to a line, in the order of EXCIPIENT_MARKERS. */
export function excipientMarkers(project: Project, assessmentId: string, line: ExcipientLine): ExcipientMarkerDef[] {
  const on = new Set<ExcipientMarkerKey>();
  if (sitesDiffer(project, assessmentId, line, "supplier")) on.add("different_supplier");
  if (sitesDiffer(project, assessmentId, line, "manufacturingSite")) on.add("different_site");
  if (sitesDiffer(project, assessmentId, line, "grade") || sitesDiffer(project, assessmentId, line, "gradeEdition")) on.add("different_grade");
  if (line.specs.some((r) => ["different", "only_sending", "only_receiving"].includes(compareSpecRow(r)))) on.add("different_specification");
  if (sitesDiffer(project, assessmentId, line, "origin")) on.add("different_origin");
  const originOf = (side: ExcipientSide) => textOf(excipientFactResolved(project, assessmentId, line.id, "origin", side));
  if (originOf("sending") === "not_known" || originOf("receiving") === "not_known") on.add("origin_not_known");
  if (textOf(excipientFactResolved(project, assessmentId, line.id, "supplierStatus", "receiving")) === "not_yet") on.add("supplier_not_qualified");
  if (textOf(excipientFactResolved(project, assessmentId, line.id, "sourcesOfSupply", "receiving")) === "one") on.add("single_source");
  return EXCIPIENT_MARKERS.filter((m) => on.has(m.key));
}

export interface ExcipientRegulatory {
  /** True when any of the first five markers applies. */
  required: boolean;
  /** Always the fixed sentence when `required`; the tool never names a category. */
  sentence?: string;
  /** Where the team wrote the assessment (their own words). It only adds a line to the document; the sentence stays either way. */
  reference?: string;
}

export function excipientRegulatory(project: Project, assessmentId: string, line: ExcipientLine): ExcipientRegulatory {
  const required = excipientMarkers(project, assessmentId, line).some((m) => m.regulatory);
  const reference = line.links.regulatoryReference?.trim();
  return { required, ...(required ? { sentence: EXCIPIENT_REGULATORY_SENTENCE } : {}), ...(reference ? { reference } : {}) };
}

// ------------------------------------------------------------------ open items

export interface ExcipientOpenItem {
  kind: "not_established" | "tbd" | "not_compared" | "no_sources";
  /** Assessment, excipient and what, in words. */
  where: string;
  text: string;
  assessmentId: string;
  lineId: string;
  factKey?: string;
  side?: ExcipientSide;
  rowId?: string;
  tbd?: TbdInfo;
}

const tbdText = (t: TbdInfo | undefined): string => {
  const parts = [t?.owner ? `owner ${t.owner}` : "", t?.due ? `due ${t.due}` : ""].filter(Boolean);
  return parts.length ? `TBD (${parts.join(", ")})` : "TBD";
};

/** Does the line cite any document (a source that is not just "who answered")? */
export function lineCitesDocument(project: Project, line: ExcipientLine): boolean {
  const isDoc = (id: string) => project.sources.find((s) => s.id === id)?.type !== "user_entry" && project.sources.some((s) => s.id === id);
  if (Object.values(line.facts).some((e) => e.sourceIds.some(isDoc))) return true;
  return line.specs.some((r) => EXCIPIENT_SIDES.some((side) => r[side].sourceIds.length > 0));
}

/**
 * Every fact that is Not established or TBD, every comparison row that is "Not compared yet", and a line that cites no document at all,
 * in the existing open-item wording. One source of truth: the list page, the Open items tab, the project page, the document and the
 * chain status all read this.
 */
export function excipientOpenItems(project: Project, assessment: ExcipientAssessment): ExcipientOpenItem[] {
  const out: ExcipientOpenItem[] = [];
  for (const line of assessment.lines) {
    const head = `${assessment.title}, ${line.name}`;
    for (const f of applicableFacts(project, assessment.id, line)) {
      const r = excipientFactResolved(project, assessment.id, line.id, f.def.key, f.side);
      const where = `${head}, ${f.def.label}${f.side ? ` (${EXCIPIENT_SIDE_LABEL[f.side].toLowerCase()})` : ""}`;
      const base = { where, assessmentId: assessment.id, lineId: line.id, factKey: f.def.key, ...(f.side ? { side: f.side } : {}) };
      if (r.status === "not_established") out.push({ ...base, kind: "not_established", text: "Not established" });
      else if (r.status === "tbd" || r.provisional) out.push({ ...base, kind: "tbd", text: tbdText(r.tbd), ...(r.tbd ? { tbd: r.tbd } : {}) });
    }
    for (const row of line.specs) {
      if (compareSpecRow(row) === "not_compared") out.push({ kind: "not_compared", where: `${head}, specification: ${row.test}`, text: "Not compared yet", assessmentId: assessment.id, lineId: line.id, rowId: row.id });
    }
    if (!lineCitesDocument(project, line)) out.push({ kind: "no_sources", where: head, text: "No document is cited for this excipient yet", assessmentId: assessment.id, lineId: line.id });
  }
  return out;
}

export interface ExcipientAssessmentSummary {
  lines: number;
  openItems: number;
  /** Lines with at least one marker, and lines that carry the regulatory sentence. */
  withMarkers: number;
  needingRegulatoryAssessment: number;
}

export function excipientAssessmentSummary(project: Project, assessment: ExcipientAssessment): ExcipientAssessmentSummary {
  let withMarkers = 0;
  let needing = 0;
  for (const l of assessment.lines) {
    const m = excipientMarkers(project, assessment.id, l);
    if (m.length) withMarkers++;
    if (m.some((x) => x.regulatory)) needing++;
  }
  return { lines: assessment.lines.length, openItems: excipientOpenItems(project, assessment).length, withMarkers, needingRegulatoryAssessment: needing };
}
