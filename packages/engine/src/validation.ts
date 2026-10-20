import { isCustomKey, resolveEntry, type GapStatus, type Project, type Resolved, type Severity, type Side } from "@gap/process-model";
import { assess, SEVERITY_RANK, type Assessment, type Gap } from "./compare";
import { effectiveContent } from "./custom";
import { fieldLabel, findRule, type ContentBundle } from "./content";
import type { Category, Question } from "./content-schema";
import { cell } from "./csv";
import { formatResolved, questionLabel, STATUS_TEXT } from "./format";
import { isPresenceQuestion } from "./sequencer";

/*
 * Validation plan and equipment qualification comparison.
 *
 * Both are derived from the current assessment on every call and are never stored. They read study and
 * equipment-qualification entries by path pattern, so new content needs no code change:
 *   uo.<uo>.study.<key>.status                       study status (any option set)
 *   uo.<uo>.study.<key>.<other field>                shown as details (for example coverage)
 *   uo.<uo>.equip.<key>.qualificationStatus          equipment qualification status
 *   uo.<uo>.equip.<key>.qualifiedRange[<sep><attr>]  qualified operating range (target side)
 */

// ------------------------------------------------------------------ readiness

export type Readiness = "evidence_available" | "bridging_required" | "planned" | "not_planned" | "information_required" | "no_study";

export const READINESS_LABEL: Record<Readiness, string> = {
  evidence_available: "Evidence available",
  bridging_required: "Bridging or action required",
  planned: "Planned",
  not_planned: "Not planned",
  information_required: "Information required",
  no_study: "No study status tracked",
};

/** Display order for filters and legends. */
export const READINESS_ORDER: readonly Readiness[] = ["information_required", "not_planned", "bridging_required", "planned", "evidence_available", "no_study"];

/**
 * THE readiness table: study status option value -> readiness. It covers the study-status option sets in the
 * catalog (evidenceAvailability, validationCoverage, impactAssessment). Option values are matched by key, so
 * the same word in different sets maps once. Any other value, "unknown" and "not established" fall back to
 * "information_required". Edit this table (and only this) to change how study answers read in the plan.
 */
export const STUDY_STATUS_READINESS: Readonly<Record<string, Readiness>> = {
  // evidenceAvailability
  available: "evidence_available",
  planned: "planned",
  not_planned: "not_planned",
  // validationCoverage
  covered: "evidence_available",
  bridging_required: "bridging_required",
  not_covered: "not_planned",
  // impactAssessment
  no_impact: "evidence_available",
  impact: "bridging_required",
  not_assessed: "information_required",
};

/** Lower is worse. A plan row takes the worst readiness among its studies. */
const READINESS_RANK: Record<Readiness, number> = {
  information_required: 0,
  not_planned: 1,
  bridging_required: 2,
  planned: 3,
  evidence_available: 4,
  no_study: 5,
};

/** Readiness of one study answer. */
export function readinessOf(r: Pick<Resolved, "status" | "value">): Readiness {
  if (r.status !== "established" || typeof r.value !== "string") return "information_required";
  return STUDY_STATUS_READINESS[r.value] ?? "information_required";
}

// ------------------------------------------------------------------ shared

export type SideEntryState = "established" | "unknown" | "not_established" | "not_applicable" | "not_asked";

export interface SideValue {
  /** Text for the cell: the answer, "Unknown (to be confirmed)", "Not established", or "—" when the side is not asked. */
  display: string;
  entry: SideEntryState;
}

export interface LinkedGap {
  key: string;
  displayId: string;
  category: Category;
  severity: Severity;
  status: GapStatus;
  attribute: string;
}

function linkedGap(g: Gap): LinkedGap {
  return { key: g.key, displayId: g.displayId, category: g.category, severity: g.severity, status: g.status, attribute: g.attribute };
}

const NOT_ASKED: SideValue = { display: "—", entry: "not_asked" };

function visibleBinds(a: Assessment): Set<string> {
  const out = new Set<string>();
  for (const i of a.instances) {
    if (i.side === "shared") continue;
    if (i.question.input.type === "parameter") continue;
    out.add(`${i.side}:${i.question.binds}`);
  }
  return out;
}

function questionFor(content: ContentBundle, binds: string): Question | undefined {
  return content.questions.find((q) => q.binds === binds);
}

function sideValue(content: ContentBundle, project: Project, shown: Set<string>, side: Side, path: string, allowRecorded = false): SideValue {
  const r = resolveEntry(project, `${side}.${path}`);
  const recorded = allowRecorded && r.status !== "not_established";
  if (!shown.has(`${side}:${path}`) && !recorded) return NOT_ASKED;
  const display = formatResolved(content, questionFor(content, path), r);
  if (r.status === "established" && r.value === undefined) return { display: STATUS_TEXT.not_established, entry: "not_established" };
  return { display, entry: r.status };
}

function highest(severities: Severity[]): Severity {
  return severities.reduce<Severity>((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a), "none");
}

// ------------------------------------------------------------------ validation plan

export interface StudyDetail {
  label: string;
  source: SideValue;
  target: SideValue;
}

export interface PlanStudy {
  uoKey: string;
  uoLabel: string;
  key: string;
  label: string;
  source: SideValue;
  target: SideValue;
  /** Readiness from the target status; "not_asked" / "not_applicable" when there is nothing to read. */
  readiness: Readiness | "not_asked" | "not_applicable";
  /** Other recorded fields of the study (for example the covered range). */
  details: StudyDetail[];
}

export interface PlanRow {
  activityKey: string;
  label: string;
  description: string;
  gaps: LinkedGap[];
  /** Highest effective severity among the gaps that imply the activity (including closed or accepted ones). */
  severity: Severity;
  regulatoryNote?: string;
  studies: PlanStudy[];
  readiness: Readiness;
  readinessLabel: string;
  /** Gaps that are Open or In progress. A row whose gaps are all closed or accepted is still listed. */
  openGaps: number;
  /** Linked studies whose target status is unknown or not established. */
  openItems: number;
}

/**
 * One row per activity implied by a gap, in order of highest severity, then catalog order.
 *
 * Overlays: a gap that is Closed or Accepted (no action) still implies its activity and is listed with its
 * status, because the register is the place to record that decision and the document must not silently drop
 * a validation activity. Such rows report `openGaps` without it. Gaps hidden by inactive answers or
 * not-applicable unit operations are not in the assessment and so never imply anything.
 */
export function buildValidationPlan(content: ContentBundle, project: Project, assessment?: Assessment): PlanRow[] {
  const eff = effectiveContent(content, project);
  const a = assessment ?? assess(eff, project);
  const shown = visibleBinds(a);
  const diffs = a.gaps.filter((g) => g.category !== "equivalent");
  const rows: { row: PlanRow; order: number }[] = [];

  eff.catalog.activities.forEach((act, order) => {
    const gaps = diffs.filter((g) => g.activities.includes(act.key));
    if (!gaps.length) return;
    const studies = (act.studies ?? []).flatMap((studyKey) =>
      eff.catalog.unitOperations
        .filter((u) => u.items.some((i) => i.coll === "study" && i.key === studyKey))
        .map((u) => planStudy(eff, project, shown, u.key, u.label, studyKey, u.items.find((i) => i.coll === "study" && i.key === studyKey)!.label)),
    );
    const counted = studies.map((s) => s.readiness).filter((r): r is Readiness => r !== "not_asked" && r !== "not_applicable");
    let readiness: Readiness;
    if (!studies.length) readiness = "no_study";
    else if (counted.length) readiness = counted.reduce((x, y) => (READINESS_RANK[y] < READINESS_RANK[x] ? y : x));
    else readiness = studies.some((s) => s.readiness === "not_asked") ? "information_required" : "no_study";
    const regulatory = gaps.find((g) => g.regulatoryNote)?.regulatoryNote;
    const row: PlanRow = {
      activityKey: act.key,
      label: act.label,
      description: act.description,
      gaps: gaps.map(linkedGap),
      severity: highest(gaps.map((g) => g.severity)),
      studies,
      readiness,
      readinessLabel: READINESS_LABEL[readiness],
      openGaps: gaps.filter((g) => g.status === "open" || g.status === "in_progress").length,
      openItems: studies.filter((s) => s.target.entry === "unknown" || s.target.entry === "not_established").length,
    };
    if (regulatory) row.regulatoryNote = regulatory;
    rows.push({ row, order });
  });

  return rows.sort((x, y) => SEVERITY_RANK[y.row.severity] - SEVERITY_RANK[x.row.severity] || x.order - y.order).map((r) => r.row);
}

function planStudy(content: ContentBundle, project: Project, shown: Set<string>, uo: string, uoLabel: string, key: string, label: string): PlanStudy {
  const base = `uo.${uo}.study.${key}`;
  const source = sideValue(content, project, shown, "source", `${base}.status`);
  const target = sideValue(content, project, shown, "target", `${base}.status`);
  let readiness: PlanStudy["readiness"];
  if (target.entry === "not_asked") readiness = "not_asked";
  else if (target.entry === "not_applicable") readiness = "not_applicable";
  else readiness = readinessOf(resolveEntry(project, `target.${base}.status`));

  const fields = new Set<string>();
  for (const k of shown) {
    const path = k.slice(k.indexOf(":") + 1);
    if (path.startsWith(`${base}.`) && !path.endsWith(".status")) fields.add(path.slice(base.length + 1));
  }
  const details: StudyDetail[] = [...fields].sort().map((f) => ({
    label: detailLabel(content, `${base}.${f}`, f),
    source: sideValue(content, project, shown, "source", `${base}.${f}`),
    target: sideValue(content, project, shown, "target", `${base}.${f}`),
  }));
  return { uoKey: uo, uoLabel, key, label, source, target, readiness, details };
}

function detailLabel(content: ContentBundle, path: string, field: string): string {
  const q = questionFor(content, path);
  return q ? questionLabel(q) : fieldLabel(content, field);
}

export const PLAN_CSV_COLUMNS = [
  "Activity",
  "Description",
  "Implied by gaps",
  "Gap statuses",
  "Highest severity",
  "Regulatory",
  "Readiness",
  "Linked studies",
  "Source study status",
  "Target study status",
  "Open gaps",
  "Open information items",
] as const;

export function validationPlanToCsv(plan: PlanRow[]): string {
  const studyName = (s: PlanStudy) => `${s.label} (${s.uoLabel})`;
  const rows = plan.map((r) => [
    r.label,
    r.description,
    r.gaps.map((g) => g.displayId).join("; "),
    r.gaps.map((g) => `${g.displayId} ${g.status}`).join("; "),
    r.severity,
    r.regulatoryNote ?? "",
    r.readinessLabel,
    r.studies.map(studyName).join("; "),
    r.studies.map((s) => `${studyName(s)}: ${s.source.display}`).join("; "),
    r.studies.map((s) => `${studyName(s)}: ${s.target.display}`).join("; "),
    String(r.openGaps),
    String(r.openItems),
  ]);
  return [PLAN_CSV_COLUMNS as readonly string[], ...rows].map((x) => x.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ equipment qualification

export interface QualifiedRange {
  /** Attribute the range applies to, e.g. "Fill volume". */
  attribute: string;
  /** Target qualified range as recorded, or "Not established" / "Unknown (to be confirmed)" / "—". */
  qualified: SideValue;
  /** Reference of the entry holding the qualified range. */
  ref: string;
  /** References of the entries the required value was read from (for verification status). */
  requiredRefs?: string[];
  /** The target process value or range it must cover, when the coverage rule names one. */
  required?: { display: string; basis: string; entry: SideEntryState };
}

export interface EquipmentRow {
  uoKey: string;
  uoLabel: string;
  equipKey: string;
  equipLabel: string;
  custom: boolean;
  source: SideValue;
  target: SideValue;
  ranges: QualifiedRange[];
  /** Differences recorded against this equipment item (any attribute), excluding equivalent pairs. */
  gaps: LinkedGap[];
}

const RANGE_FIELD = /^qualifiedRange(?:[._](.+))?$/;

/** One row per equipment item with qualification entries, in unit operation sequence then catalog order. */
export function buildEquipmentQualification(content: ContentBundle, project: Project, assessment?: Assessment): EquipmentRow[] {
  const eff = effectiveContent(content, project);
  const a = assessment ?? assess(eff, project);
  const shown = visibleBinds(a);
  const diffs = a.gaps.filter((g) => g.category !== "equivalent");
  const out: EquipmentRow[] = [];

  for (const u of eff.catalog.unitOperations) {
    const inScope = a.instances.some((i) => i.section.uo === u.key && !isPresenceQuestion(i.question, i.section));
    if (!inScope) continue;
    for (const item of u.items.filter((i) => i.coll === "equip")) {
      const base = `uo.${u.key}.equip.${item.key}`;
      const custom = isCustomKey(item.key);
      const fields = new Set<string>();
      for (const k of shown) {
        const path = k.slice(k.indexOf(":") + 1);
        if (path.startsWith(`${base}.`)) fields.add(path.slice(base.length + 1));
      }
      if (custom) {
        for (const side of ["source", "target"] as const) {
          for (const f of Object.keys(project.processes[side].unitOperations[u.key]?.collections.equip[item.key]?.fields ?? {})) fields.add(f);
        }
      }
      const rangeFields = [...fields].filter((f) => RANGE_FIELD.test(f)).sort();
      const hasStatus = fields.has("qualificationStatus");
      if (!hasStatus && !rangeFields.length) continue;

      const ranges: QualifiedRange[] = rangeFields.map((f) => qualifiedRange(eff, project, shown, `${base}.${f}`, f, custom));
      out.push({
        uoKey: u.key,
        uoLabel: u.label,
        equipKey: item.key,
        equipLabel: item.label,
        custom,
        source: sideValue(eff, project, shown, "source", `${base}.qualificationStatus`, custom),
        target: sideValue(eff, project, shown, "target", `${base}.qualificationStatus`, custom),
        ranges,
        gaps: diffs.filter((g) => g.path.startsWith(`${base}.`)).map(linkedGap),
      });
    }
  }
  return out;
}

function qualifiedRange(content: ContentBundle, project: Project, shown: Set<string>, path: string, field: string, custom: boolean): QualifiedRange {
  const q = questionFor(content, path);
  const suffix = RANGE_FIELD.exec(field)?.[1];
  const attribute = q ? questionLabel(q) : suffix ? suffix.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : fieldLabel(content, field);
  const result: QualifiedRange = { attribute, qualified: sideValue(content, project, shown, "target", path, custom), ref: `target.${path}` };
  const rule = findRule(content.rules, path);
  const against = rule?.comparator === "coverage" ? rule.config.against : undefined;
  if (!against) return result;

  const root = against.path.split(".").length === 4;
  let r: Resolved;
  let basis: string;
  let requiredRefs: string[];
  let refQ: Question | undefined;
  if (root) {
    const nor = resolveEntry(project, `${against.side}.${against.path}.nor`);
    const useNor = nor.status === "established" && nor.value !== undefined;
    r = useNor ? nor : resolveEntry(project, `${against.side}.${against.path}.setPoint`);
    basis = `${against.side} ${useNor ? "NOR" : "set point"}`;
    requiredRefs = [`${against.side}.${against.path}.${useNor ? "nor" : "setPoint"}`];
    refQ = content.questions.find((x) => x.binds === against.path);
  } else {
    r = resolveEntry(project, `${against.side}.${against.path}`);
    basis = `${against.side} process value`;
    requiredRefs = [`${against.side}.${against.path}`];
    refQ = questionFor(content, against.path);
  }
  const display = formatResolved(content, refQ, r);
  result.required = { display, basis: `${refQ ? `${questionLabel(refQ)}, ` : ""}${basis}`, entry: r.status === "established" && r.value === undefined ? "not_established" : r.status };
  result.requiredRefs = requiredRefs;
  return result;
}

export const EQUIPMENT_CSV_COLUMNS = ["Unit operation", "Equipment", "Source qualification", "Target qualification", "Qualified range (target)", "Required by target process", "Gaps"] as const;

export function equipmentQualificationToCsv(rows: EquipmentRow[]): string {
  const data = rows.map((r) => [
    r.uoLabel,
    r.equipLabel,
    r.source.display,
    r.target.display,
    r.ranges.map((x) => `${x.attribute}: ${x.qualified.display}`).join("; "),
    r.ranges.map((x) => (x.required ? `${x.attribute}: ${x.required.display} (${x.required.basis})` : `${x.attribute}: —`)).join("; "),
    r.gaps.map((g) => `${g.displayId} ${g.category}`).join("; "),
  ]);
  return [EQUIPMENT_CSV_COLUMNS as readonly string[], ...data].map((x) => x.map(cell).join(",")).join("\r\n") + "\r\n";
}
