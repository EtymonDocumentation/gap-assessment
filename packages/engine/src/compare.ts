import {
  formatQuantity,
  formatRange,
  quantityRatio,
  quantityWithin,
  rangeWithin,
  resolveEntry,
  UnitError,
  type GapOverlay,
  type GapStatus,
  type Project,
  type Quantity,
  type Range,
  type Resolved,
  type Severity,
  type Side,
} from "@gap/process-model";
import { findRule, optionLabel, type ContentBundle } from "./content";
import type { Category, Question, Rule } from "./content-schema";
import { formatQuestionSide, questionLabel, STATUS_TEXT } from "./format";
import { inactiveEntries, instanceRefs, visibleInstances, type QuestionInstance } from "./sequencer";
import { sourceValidated, stagedFor } from "./stage";
import { isQuantity, isRange, valuesEqual } from "./values";

/** The user-facing name of each side of the transfer: the sending unit (SU) and the receiving unit (RU). */
const SIDE_WORD = { source: "SU", target: "RU" } as const;

export const REGULATORY_NOTE = "Requires regulatory affairs assessment.";

export interface ComparatorResult {
  category: Category;
  /** Distinguishes several results from one comparison (set elements). */
  subKey?: string;
  /** Explanation of how the category was reached. */
  detail: string;
  /** Target/source magnitude ratio for scale changes. */
  ratio?: number;
}

export interface Gap {
  key: string;
  /** Display id assigned in document order: G-001 for differences, EQ-001 for equivalent pairs. */
  displayId: string;
  ruleId: string;
  ruleVersion: string;
  ruleTitle: string;
  comparator: Rule["comparator"];
  category: Category;
  questionId: string;
  sectionId: string;
  sectionTitle: string;
  uoKey?: string;
  path: string;
  subKey?: string;
  attribute: string;
  sourceDisplay: string;
  targetDisplay: string;
  detail: string;
  /** Entry references and ids that produced this result (traceability). */
  inputRefs: string[];
  inputEntryIds: string[];
  rationale: string;
  activities: string[];
  ruleSeverity: Severity;
  severityNote?: string;
  /** Effective severity: the user override when present, otherwise the rule severity. */
  severity: Severity;
  severityOverride?: GapOverlay["severityOverride"];
  regulatoryNote?: string;
  owner?: string;
  status: GapStatus;
  notes?: string;
}

export interface OpenItem {
  key: string;
  ref: string;
  side: Side | "shared";
  questionId: string;
  prompt: string;
  sectionId: string;
  sectionTitle: string;
  status: "unknown" | "not_established";
}

// ------------------------------------------------------------------ comparators

interface Ctx {
  project: Project;
  content: ContentBundle;
  q: Question;
  rule: Rule;
  /** Resolve an entry on a side; `sub` is appended to the question's bind path. */
  get(side: Side, sub?: string): Resolved;
  /** Entry ids used. */
  used: Set<string>;
  /** Entry references used. */
  refs: Set<string>;
}

const est = (r: Resolved) => r.status === "established" && r.value !== undefined;

function statusText(r: Resolved): string {
  return r.status === "established" ? "established" : STATUS_TEXT[r.status].toLowerCase();
}

function info(...parts: [string, Resolved][]): ComparatorResult {
  const missing = parts.filter(([, r]) => !est(r)).map(([name, r]) => `${name} ${statusText(r)}`);
  const text = missing.join("; ");
  return { category: "information_required", detail: text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "Comparison could not be completed." };
}

/** Handles not-applicable on either side, which reads as absence of the element. */
function notApplicable(s: Resolved, t: Resolved): ComparatorResult | undefined {
  const sNA = s.status === "not_applicable";
  const tNA = t.status === "not_applicable";
  if (sNA && tNA) return { category: "equivalent", detail: "Not applicable at SU or RU." };
  if (sNA && est(t)) return { category: "new_requirement", detail: "Not applicable at SU; present at RU." };
  if (tNA && est(s)) return { category: "removed_element", detail: "Present at SU; not applicable at RU." };
  return undefined;
}

function guardUnits(fn: () => ComparatorResult[], fallback: ComparatorResult[]): ComparatorResult[] {
  try {
    return fn();
  } catch (e) {
    if (e instanceof UnitError) return fallback;
    throw e;
  }
}

function asRange(v: unknown): Range | undefined {
  if (isRange(v)) return v;
  if (isQuantity(v)) return { min: v, max: v };
  return undefined;
}

/** Target operating window: NOR when established, else the set point. */
function targetWindow(ctx: Ctx): { window?: Range; label: string } {
  const nor = ctx.get("target", "nor");
  const sp = ctx.get("target", "setPoint");
  if (est(nor)) return { window: nor.value as Range, label: `RU NOR ${formatRange(nor.value as Range)}` };
  if (est(sp)) return { window: asRange(sp.value), label: `RU set point ${formatQuantity(sp.value as Quantity)}` };
  return { label: "RU operating range" };
}

/** "validated" for a commercial (process validated) source; "demonstrated" (actually run) for any other source stage. */
function rangeWord(ctx: Ctx): string {
  return sourceValidated(ctx.project) ? "validated" : "demonstrated";
}

/** Source reference range: the validated (non-validated source: demonstrated) range when recorded, else PAR. */
function sourceReference(ctx: Ctx): { range?: Range; label: string } {
  const word = rangeWord(ctx);
  const vr = ctx.get("source", "validatedRange");
  if (est(vr)) return { range: vr.value as Range, label: `SU ${word} range ${formatRange(vr.value as Range)}` };
  const par = ctx.get("source", "par");
  if (est(par)) return { range: par.value as Range, label: `SU PAR ${formatRange(par.value as Range)}` };
  return { label: `SU PAR / ${word} range` };
}

function paramEquivalent(ctx: Ctx): boolean {
  let compared = 0;
  for (const f of ["setPoint", "nor"]) {
    const s = ctx.get("source", f);
    const t = ctx.get("target", f);
    if (!est(s) && !est(t)) continue;
    if (!est(s) || !est(t) || !valuesEqual(s.value, t.value)) return false;
    compared++;
  }
  return compared > 0;
}

function cmpRange(ctx: Ctx): ComparatorResult[] {
  const tw = targetWindow(ctx);
  if (!tw.window) return [info(["RU set point", ctx.get("target", "setPoint")], ["RU NOR", ctx.get("target", "nor")])];
  if (paramEquivalent(ctx)) return [{ category: "equivalent", detail: "RU set point and NOR match the SU." }];
  const ref = sourceReference(ctx);
  if (!ref.range) {
    return [info(["SU PAR", ctx.get("source", "par")])];
  }
  return guardUnits(
    () => {
      const sp = ctx.get("target", "setPoint");
      const inside = rangeWithin(tw.window!, ref.range!) && (!est(sp) || quantityWithin(sp.value as Quantity, ref.range!));
      return [
        inside
          ? { category: "within_validated_range" as const, detail: `The ${tw.label} lies within the ${ref.label}.` }
          : { category: "outside_validated_range" as const, detail: `The ${tw.label} extends beyond the ${ref.label}.` },
      ];
    },
    [{ category: "information_required", detail: "SU and RU units are not comparable." }],
  );
}

function ratioText(r: number): string {
  return `×${Number(r.toPrecision(3))}`;
}

function cmpScale(ctx: Ctx): ComparatorResult[] {
  if (ctx.q.input.type === "parameter") {
    const sSp = ctx.get("source", "setPoint");
    const tSp = ctx.get("target", "setPoint");
    const tw = targetWindow(ctx);
    if (!tw.window) return [info(["RU set point", tSp], ["RU NOR", ctx.get("target", "nor")])];
    if (paramEquivalent(ctx)) return [{ category: "equivalent", detail: "RU nominal value and range match the SU." }];
    const ref = sourceReference(ctx);
    return guardUnits(
      () => {
        if (ref.range && rangeWithin(tw.window!, ref.range)) {
          return [{ category: "within_validated_range" as const, detail: `The ${tw.label} lies within the ${ref.label}.` }];
        }
        if (!est(sSp) || !est(tSp)) return [info(["SU nominal value", sSp], ["RU nominal value", tSp])];
        const ratio = quantityRatio(tSp.value as Quantity, sSp.value as Quantity);
        const beyond = ref.range ? `; outside the ${ref.label}` : "";
        return [{ category: "scale_change" as const, ratio, detail: `Nominal scale changes ${ratioText(ratio)} (${formatQuantity(sSp.value as Quantity)} to ${formatQuantity(tSp.value as Quantity)})${beyond}.` }];
      },
      [{ category: "information_required", detail: "SU and RU units are not comparable." }],
    );
  }
  const s = ctx.get("source");
  const t = ctx.get("target");
  if (!est(s) || !est(t)) return [info(["SU value", s], ["RU value", t])];
  if (valuesEqual(s.value, t.value)) return [{ category: "equivalent", detail: "Same capacity or scale." }];
  const qs = isQuantity(s.value) ? s.value : undefined;
  const qt = isQuantity(t.value) ? t.value : undefined;
  if (!qs || !qt) return [{ category: "scale_change", detail: "Scale differs." }];
  return guardUnits(
    () => {
      const ratio = quantityRatio(qt, qs);
      return [{ category: "scale_change" as const, ratio, detail: `Scale changes ${ratioText(ratio)} (${formatQuantity(qs)} to ${formatQuantity(qt)}).` }];
    },
    [{ category: "information_required", detail: "SU and RU units are not comparable." }],
  );
}

function cmpLimit(ctx: Ctx, upper: boolean): ComparatorResult[] {
  const s = ctx.get("source");
  const t = ctx.get("target");
  if (!est(s) || !est(t)) return [info(["SU value", s], ["RU value", t])];
  const qs = s.value as Quantity;
  const qt = t.value as Quantity;
  return guardUnits(
    () => {
      if (valuesEqual(qs, qt)) return [{ category: "equivalent" as const, detail: "RU limit equals the SU limit." }];
      const r = quantityRatio(qt, qs);
      const tighter = upper ? r < 1 : r > 1;
      return tighter
        ? [{ category: "within_validated_range" as const, detail: `RU ${formatQuantity(qt)} is within the SU ${rangeWord(ctx)} ${upper ? "maximum" : "minimum"} of ${formatQuantity(qs)}.` }]
        : [{ category: "outside_validated_range" as const, detail: `RU ${formatQuantity(qt)} exceeds the SU ${rangeWord(ctx)} ${upper ? "maximum" : "minimum"} of ${formatQuantity(qs)}.` }];
    },
    [{ category: "information_required", detail: "SU and RU units are not comparable." }],
  );
}

function cmpEqualOrDifferent(ctx: Ctx): ComparatorResult[] {
  const s = ctx.get("source");
  const t = ctx.get("target");
  if (!est(s) || !est(t)) return [info(["SU value", s], ["RU value", t])];
  if (valuesEqual(s.value, t.value)) return [{ category: "equivalent", detail: "SU and RU are the same." }];
  return [{ category: ctx.rule.config.differentAs ?? "different_principle", detail: "SU and RU differ." }];
}

function cmpPresence(ctx: Ctx): ComparatorResult[] {
  const s = ctx.get("source");
  const t = ctx.get("target");
  if (!est(s) || !est(t)) return [info(["SU", s], ["RU", t])];
  const a = s.value === true;
  const b = t.value === true;
  if (a && b) return [{ category: "equivalent", detail: "Present at SU and RU." }];
  if (!a && !b) return [{ category: "equivalent", detail: "Not used at SU or RU." }];
  if (a) return [{ category: "removed_element", detail: "Present at SU; absent at RU." }];
  return [{ category: "new_requirement", detail: "Absent at SU; present at RU." }];
}

function cmpSet(ctx: Ctx): ComparatorResult[] {
  const s = ctx.get("source");
  const t = ctx.get("target");
  if (!est(s) || !est(t)) return [info(["SU", s], ["RU", t])];
  const sa = new Set(s.value as string[]);
  const ta = new Set(t.value as string[]);
  const added = [...ta].filter((x) => !sa.has(x));
  const removed = [...sa].filter((x) => !ta.has(x));
  if (!added.length && !removed.length) return [{ category: "equivalent", detail: "Same elements at SU and RU." }];
  const label = (v: string) => optionLabel(ctx.content, ctx.q, v);
  return [
    ...added.map((v) => ({ category: "new_requirement" as const, subKey: v, detail: `${label(v)}: present at RU, absent at SU.` })),
    ...removed.map((v) => ({ category: "removed_element" as const, subKey: v, detail: `${label(v)}: present at SU, absent at RU.` })),
  ];
}

function cmpCoverage(ctx: Ctx): ComparatorResult[] {
  const { against, coverageSide } = ctx.rule.config;
  const cov = ctx.get(coverageSide!);
  // The checked value may be a parameter (item root): use its NOR, else its set point.
  const isItemRoot = against!.path.split(".").length === 4;
  let val: Resolved;
  if (isItemRoot) {
    const nor = resolveEntry(ctx.project, `${against!.side}.${against!.path}.nor`);
    val = est(nor) ? nor : resolveEntry(ctx.project, `${against!.side}.${against!.path}.setPoint`);
  } else {
    val = resolveEntry(ctx.project, `${against!.side}.${against!.path}`);
  }
  val.entryIds.forEach((id) => ctx.used.add(id));
  ctx.refs.add(val.ref);
  if (!est(cov) || !est(val)) return [info([`Covered range (${SIDE_WORD[coverageSide!]})`, cov], [`compared value (${SIDE_WORD[against!.side]})`, val])];
  const covRange = isQuantity(cov.value) ? { max: cov.value } : (cov.value as Range);
  const v = asRange(val.value)!;
  return guardUnits(
    () =>
      rangeWithin(v, covRange)
        ? [{ category: "within_validated_range" as const, detail: `${formatRange(v)} is within the covered range ${formatRange(covRange)}.` }]
        : [{ category: "outside_validated_range" as const, detail: `${formatRange(v)} is not within the covered range ${formatRange(covRange)}.` }],
    [{ category: "information_required", detail: "Units are not comparable." }],
  );
}

function cmpEvidence(ctx: Ctx, side: Side): ComparatorResult[] {
  const r = ctx.get(side);
  if (r.status === "not_applicable") return [{ category: "equivalent", detail: `Not applicable: ${r.justification ?? ""}`.trim() }];
  if (!est(r)) return [info(["Evidence status", r])];
  const cat = ctx.rule.config.map![String(r.value)];
  if (!cat) return [{ category: "information_required", detail: `No rule mapping for answer "${String(r.value)}".` }];
  return [{ category: cat, detail: `Answer: ${optionLabel(ctx.content, ctx.q, String(r.value))}.` }];
}

function runComparator(ctx: Ctx, onlySide?: Side): ComparatorResult[] {
  const kind = ctx.rule.comparator;
  if (kind === "evidence") return cmpEvidence(ctx, onlySide ?? "target");
  if (kind === "coverage") return cmpCoverage(ctx);
  if (ctx.q.input.type !== "parameter") {
    const na = notApplicable(ctx.get("source"), ctx.get("target"));
    if (na) return [na];
  }
  switch (kind) {
    case "range":
      return cmpRange(ctx);
    case "scale":
      return cmpScale(ctx);
    case "upper_limit":
      return cmpLimit(ctx, true);
    case "lower_limit":
      return cmpLimit(ctx, false);
    case "enum":
    case "text":
      return cmpEqualOrDifferent(ctx);
    case "presence":
      return cmpPresence(ctx);
    case "set":
      return cmpSet(ctx);
    default:
      return [];
  }
}

// ------------------------------------------------------------------ severity

const RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 };

function ruleSeverity(ctx: Ctx, res: ComparatorResult): { severity: Severity; note?: string } {
  const { rule } = ctx;
  if (res.category === "equivalent") return { severity: "none" };
  const outcome = rule.outcomes[res.category];
  if (outcome?.severity) return { severity: outcome.severity };
  if (res.category === "within_validated_range") return { severity: "low" };
  if (res.category === "scale_change" && rule.config.ratioSeverity && res.ratio !== undefined) {
    const mag = res.ratio >= 1 ? res.ratio : 1 / res.ratio;
    const tiers = [...rule.config.ratioSeverity].sort((a, b) => b.atLeast - a.atLeast);
    const tier = tiers.find((t) => mag >= t.atLeast);
    if (tier) return { severity: tier.severity, note: `Magnitude ${ratioText(mag)} (≥ ×${tier.atLeast}).` };
  }
  if (rule.severityBy?.classification && ctx.q.input.type === "parameter") {
    const map = rule.severityBy.classification;
    const cls = resolveEntry(ctx.project, `source.${ctx.q.binds}.classification`);
    if (est(cls) && map[String(cls.value)]) {
      const label = ctx.content.catalog.optionSets.classification?.find((o) => o.value === cls.value)?.label ?? String(cls.value);
      return { severity: map[String(cls.value)]!, note: `Parameter classified as ${label} at SU.` };
    }
    const worst = (Object.values(map) as Severity[]).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none" as Severity);
    return { severity: worst, note: "Classification not established at SU; the most conservative severity is applied." };
  }
  return { severity: rule.severity };
}

// ------------------------------------------------------------------ assessment

export interface Assessment {
  instances: QuestionInstance[];
  gaps: Gap[];
  openItems: OpenItem[];
  inactive: ReturnType<typeof inactiveEntries>;
}

/**
 * Runs every applicable comparison. Gaps are always recomputed from the
 * current entries; user decisions (severity override, owner, status) are
 * merged from overlays keyed by the stable gap key.
 */
export function assess(raw: ContentBundle, project: Project): Assessment {
  // Every stage-dependent text (labels, rule explanations, the detail strings above) follows the source stage.
  const content = stagedFor(raw, project);
  const validated = sourceValidated(project);
  const instances = visibleInstances(content, project, "paired");
  const visibleSides = new Map<string, Set<string>>();
  for (const i of instances) {
    const s = visibleSides.get(i.question.id) ?? new Set<string>();
    s.add(i.side);
    visibleSides.set(i.question.id, s);
  }
  const overlays = new Map(project.gapOverlays.map((o) => [o.gapKey, o]));
  const gaps: Omit<Gap, "displayId">[] = [];
  const seen = new Set<string>();

  for (const inst of instances) {
    const q = inst.question;
    if (q.sides === "shared" || seen.has(q.id)) continue;
    seen.add(q.id);
    const sides = visibleSides.get(q.id)!;
    let onlySide: Side | undefined;
    if (q.sides === "paired") {
      if (!sides.has("source") || !sides.has("target")) continue;
    } else {
      onlySide = q.sides;
    }
    const rule = findRule(content.rules, q.binds);
    if (!rule || rule.comparator === "informational") continue;

    const used = new Set<string>();
    const usedRefs = new Set<string>();
    const ctx: Ctx = {
      project,
      content,
      q,
      rule,
      used,
      refs: usedRefs,
      get(side, sub) {
        const ref = `${side}.${q.binds}${sub ? `.${sub}` : ""}`;
        const r = resolveEntry(project, ref);
        usedRefs.add(ref);
        r.entryIds.forEach((id) => used.add(id));
        return r;
      },
    };
    if (q.input.type === "parameter") {
      // Classification feeds severity; record it as an input.
      ctx.get("source", "classification");
    }
    const results = runComparator(ctx, onlySide);
    for (const res of results) {
      const key = `${rule.id}:${q.binds}${res.subKey ? `#${res.subKey}` : ""}`;
      const outcome = rule.outcomes[res.category];
      const sev = ruleSeverity(ctx, res);
      const ov = overlays.get(key);
      const regulatory =
        res.category !== "equivalent" &&
        res.category !== "information_required" &&
        (outcome?.regulatory ?? (res.category === "within_validated_range" ? false : rule.regulatory));
      const activities =
        res.category === "equivalent"
          ? []
          : (outcome?.activities ??
            (res.category === "information_required"
              ? ["information_gathering"]
              : res.category === "within_validated_range"
                ? []
                : rule.activities));
      const rationale =
        outcome?.why ??
        (res.category === "information_required"
          ? "The comparison cannot be completed until the missing information is established. No value is assumed."
          : res.category === "equivalent"
            ? "No difference identified."
            : res.category === "within_validated_range"
              ? validated
                ? "The RU is within the validated range or covered by existing validation; no additional validation activity is implied. The difference is recorded for completeness."
                : "The RU is within the range demonstrated at the SU or covered by the SU data; this difference alone implies no additional activity. It is recorded for completeness."
              : rule.why);
      // A one-sided coverage question shows the value it was checked against in the other column.
      const against = rule.comparator === "coverage" ? rule.config.against : undefined;
      const againstQ = against && content.questions.find((x) => x.binds === against.path);
      const otherSide = againstQ && against ? `Checked against: ${formatQuestionSide(content, project, againstQ, against.side)}` : "—";
      const sourceDisplay = onlySide === "target" ? (against?.side === "source" ? otherSide : "—") : formatQuestionSide(content, project, q, "source");
      const targetDisplay = onlySide === "source" ? (against?.side === "target" ? otherSide : "—") : formatQuestionSide(content, project, q, "target");
      const gap: Omit<Gap, "displayId"> = {
        key,
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleTitle: rule.title,
        comparator: rule.comparator,
        category: res.category,
        questionId: q.id,
        sectionId: inst.section.id,
        sectionTitle: inst.section.title,
        path: q.binds,
        attribute: res.subKey ? `${questionLabel(q)}: ${optionLabel(content, q, res.subKey)}` : questionLabel(q),
        sourceDisplay,
        targetDisplay,
        detail: res.detail,
        inputRefs: [...usedRefs],
        inputEntryIds: [...used],
        rationale,
        activities,
        ruleSeverity: sev.severity,
        severity: ov?.severityOverride?.value ?? sev.severity,
        status: ov?.status ?? (res.category === "equivalent" ? "closed" : "open"),
      };
      if (inst.section.uo) gap.uoKey = inst.section.uo;
      if (res.subKey) gap.subKey = res.subKey;
      if (sev.note) gap.severityNote = sev.note;
      if (ov?.severityOverride) gap.severityOverride = ov.severityOverride;
      if (regulatory) gap.regulatoryNote = REGULATORY_NOTE;
      if (ov?.owner) gap.owner = ov.owner;
      if (ov?.notes) gap.notes = ov.notes;
      gaps.push(gap);
    }
  }

  let g = 0;
  let e = 0;
  const numbered: Gap[] = gaps.map((x) => ({
    ...x,
    displayId: x.category === "equivalent" ? `EQ-${String(++e).padStart(3, "0")}` : `G-${String(++g).padStart(3, "0")}`,
  }));

  const openItems: OpenItem[] = [];
  for (const inst of instances) {
    for (const ref of instanceRefs(inst)) {
      const r = resolveEntry(project, ref);
      if (r.status === "unknown" || r.status === "not_established") {
        openItems.push({
          key: ref,
          ref,
          side: inst.side,
          questionId: inst.question.id,
          prompt: inst.question.prompt,
          sectionId: inst.section.id,
          sectionTitle: inst.section.title,
          status: r.status,
        });
      }
    }
  }

  return { instances, gaps: numbered, openItems, inactive: inactiveEntries(project, instances) };
}

export const SEVERITY_RANK = RANK;

/** Sort for risk ranking: severity, then category weight, then document order. */
export function riskRanked(gaps: Gap[]): Gap[] {
  const catWeight: Record<Category, number> = {
    outside_validated_range: 6,
    different_principle: 5,
    removed_element: 5,
    new_requirement: 4,
    scale_change: 4,
    information_required: 3,
    within_validated_range: 1,
    equivalent: 0,
  };
  return gaps
    .map((gap, i) => ({ gap, i }))
    .filter(({ gap }) => gap.category !== "equivalent")
    .sort((a, b) => RANK[b.gap.severity] - RANK[a.gap.severity] || catWeight[b.gap.category] - catWeight[a.gap.category] || a.i - b.i)
    .map(({ gap }) => gap);
}
