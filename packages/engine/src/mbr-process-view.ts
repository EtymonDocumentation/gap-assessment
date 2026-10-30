import type { MbrRecord, MbrSampleRow, MbrStep, MbrTimeLimit, Project, SamplingPlan } from "@gap/process-model";
import { holdEntryInfo, numberSteps, sampleMomentKey, splitIndex } from "./mbr";

/*
 * The "Process view" of a batch record: the record drawn as an equipment train, a moments slider through its steps, the clocks against
 * their limits, the samples at their ports and a deterministic fluid tracker (no AI: the same record always gives the same answer).
 *
 * Design notes (the why):
 *  - NOTHING IS GUESSED. A number is used only when the record (or its linked sampling plan) states it: a parameter row with a unit, a
 *    sample quantity, a plan hold duration, a plan batch size. Where a check needs a number that is missing, the check says "Not enough data
 *    in the record: <what is missing>" and does not run on a default. Unknowns stay visible.
 *  - THE RECORD HAS NO CLOCK TIME. Steps carry no timestamps, so the view does not invent a timeline: a clock is shown as running, not
 *    started or finished at a moment, next to its limit and the planned time the record states. Where the start and end steps of a clock are
 *    not marked, the clock is shown at the step that states it and a note says so.
 *  - THE VIEW REPORTS, IT DOES NOT DECIDE. Findings are review prompts for a person, each citing the steps and rows it rests on. The view
 *    never approves anything and never states a regulatory filing category.
 *  - A PLANNED TIME LONGER THAN ITS LIMIT is only "by design" when the record marks the row as a study point (a challenge beyond a limit).
 *    Otherwise it is a finding: the record plans something its own limit does not allow.
 */

export type ViewShape = "container" | "thaw" | "vessel" | "filter" | "filler" | "inspection" | "packing" | "storage" | "document" | "hold" | "generic";

export interface ViewEquipment {
  id: string;
  /** Absent for the hold between the two parts of a split record. */
  sectionId?: string;
  number: number;
  title: string;
  unitOp?: string;
  shape: ViewShape;
  /** False when the unit operation is unknown or custom: the section is drawn as a generic vessel with its title. */
  known: boolean;
  part: 1 | 2;
}

export type MomentKind = "start" | "block" | "hold_start" | "hold_end" | "end";

export interface ViewMoment {
  index: number;
  kind: MomentKind;
  title: string;
  equipmentId?: string;
  sectionId?: string;
  sectionNumber?: number;
  blockId?: string;
  part: 1 | 2;
  stepIds: string[];
  /** "5.1 to 5.8", or the single number. Absent for a moment with no steps. */
  stepRange?: string;
  /** Row ids of the samples taken at this moment. */
  sampleIds: string[];
}

export type ClockStatus = "not_started" | "running" | "finished" | "applies_here" | "not_here" | "started_end_not_marked";

export interface ViewClock {
  id: string;
  kind: "hold" | "limit";
  label: string;
  sectionNumber?: number;
  /** Row id of the record's time limit this clock is compared with. Absent: "no limit stated". */
  limitRowId?: string;
  limitHours?: number;
  limitText?: string;
  /** Where the limit comes from, in words ("R-0053, section 5; TRD value 24 h in <TRD step>"). */
  limitSource?: string;
  startMoment?: number;
  endMoment?: number;
  /** How the span was found. */
  span: "hold_steps" | "split" | "target_steps" | "block";
  spanText: string;
  plannedHours?: number;
  plannedText?: string;
  plannedSource?: string;
  /** True when the planned time is a row the record marks as a study point. */
  studyPoint?: boolean;
  storage?: string;
  /** Sub-limits (targets) with their own step ranges. */
  parts?: { label: string; hours?: number; text?: string; startMoment?: number; endMoment?: number }[];
}

export interface ViewSample {
  /** Row id (R-nnnn) of the sample row in the record. */
  rowId: string;
  pointId: string;
  test: string;
  quantityText?: string;
  /** Total volume drawn (count x volume), in mL. Absent for a unit sample (syringes) or an unstated quantity. */
  volumeMl?: number;
  /** Units (syringes ...) drawn, for a unit sample. */
  units?: number;
  kind: "volume" | "units" | "mass" | "unknown";
  sectionNumber: number;
  momentIndex: number;
  stepNumber?: string;
  /** True when a step (or a hold entry) of the record tells the operator to take the sample. */
  tiedToStep: boolean;
  /** The port, valve or manifold the step names, if it names one. */
  port?: string;
  container?: string;
  storage?: string;
}

export interface MomentVolume {
  /** The batch volume the section states (one row, L). */
  statedL?: number;
  statedRowId?: string;
  statedLabel?: string;
  /** Taken as samples in this section up to and including this moment, L. */
  withdrawnL: number;
  remainingL?: number;
  /** Why no balance is shown. */
  missing?: string;
  /** The batch sizes of the linked sampling plan, shown when the section states none. */
  planBatches?: { label: string; sizeL: number }[];
}

export interface VolumeSectionRow {
  sectionNumber: number;
  sectionTitle: string;
  statedL?: number;
  statedRowId?: string;
  sampleMl: number;
  sampleCount: number;
  percent?: number;
  status: "ok" | "over" | "no_data";
  missing?: string;
}

export interface VolumeBatchRow {
  batchId: string;
  label: string;
  batchSizeL?: number;
  units?: number;
  filledL?: number;
  leftoverL?: number;
  status: "ok" | "over" | "no_data";
  missing: string[];
}

export type Severity = "major" | "minor" | "note";

export interface ViewFinding {
  id: string;
  checkId: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Step numbers and row ids the finding rests on. */
  steps: string[];
  rows: string[];
  moments: number[];
}

export interface ViewCheck {
  id: string;
  group: "Clocks" | "Samples" | "Volumes" | "Structure";
  title: string;
  /** The data the check needs, in words. */
  needs: string;
  status: "ok" | "finding" | "no_data" | "na";
  summary: string;
  /** What is missing when status is "no_data" (or partly missing). */
  missing: string[];
  findingIds: string[];
}

export interface ProcessView {
  recordId: string;
  title: string;
  split: boolean;
  equipment: ViewEquipment[];
  moments: ViewMoment[];
  clocks: ViewClock[];
  samples: ViewSample[];
  momentVolumes: MomentVolume[];
  volumeSections: VolumeSectionRow[];
  volumeBatches: VolumeBatchRow[];
  checks: ViewCheck[];
  findings: ViewFinding[];
  assumptions: string[];
  /** Every "Not enough data" line, for the page header. */
  missingData: string[];
}

// ------------------------------------------------------------------ small parsers (they read what is written, never fill a gap)

/** The unit operation (or the title of a custom section) decides the drawing; nothing else does. */
export function shapeForUnitOp(unitOp: string | undefined): { shape: ViewShape; known: boolean } {
  if (!unitOp) return { shape: "generic", known: false };
  const k = unitOp.toLowerCase();
  if (/fill/.test(k)) return { shape: "filler", known: true };
  if (/filtration|filter/.test(k)) return { shape: "filter", known: true };
  if (/thaw|receipt/.test(k)) return { shape: "thaw", known: true };
  if (/compound|buffer|mix|dilut|pool|formulat/.test(k)) return { shape: "vessel", known: true };
  if (/inspect/.test(k)) return { shape: "inspection", known: true };
  if (/pack|label/.test(k)) return { shape: "packing", known: true };
  if (/ship|transport/.test(k)) return { shape: "container", known: true };
  if (/storage/.test(k)) return { shape: "storage", known: true };
  if (/review|release/.test(k)) return { shape: "document", known: true };
  return { shape: "generic", known: false };
}

const HOURS_PER: Record<string, number> = { h: 1, hr: 1, hrs: 1, hour: 1, hours: 1, min: 1 / 60, mins: 1 / 60, minute: 1 / 60, minutes: 1 / 60, d: 24, day: 24, days: 24 };

/** Hours from a value and unit as the record writes them ("24" + "h", "up to 4" + "h", or "30 min" in the value). Undefined when not stated. */
export function parseHours(value: string | undefined, unit: string | undefined): number | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  const joined = /^[^\d]*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)/.exec(unit ? `${v} ${unit}` : v);
  if (!joined) return undefined;
  const n = Number(joined[1]!.replace(",", "."));
  const per = HOURS_PER[(joined[2] || unit || "").trim().toLowerCase()];
  if (!Number.isFinite(n) || per === undefined) return undefined;
  // A range ("3 to 5") is not one number: it is a range of the process, not a clock.
  if (/\d\s*(to|-|–)\s*\d/.test(v)) return undefined;
  return n * per;
}

/** A single number in a parameter's value, or undefined (a range, text or nothing). */
const singleNumber = (v: string | undefined): number | undefined => {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(v ?? "");
  return m ? Number(m[1]!.replace(",", ".")) : undefined;
};

const toLitres = (n: number, unit: string | undefined): number | undefined => {
  const u = (unit ?? "").trim().toLowerCase();
  return u === "l" ? n : u === "ml" ? n / 1000 : undefined;
};

interface Quantity {
  count: number;
  each: number;
  unit: string;
  kind: "volume" | "units" | "mass";
}

/** "2 x 10 mL", "20 mL", "300 syringes", "2 x 4 syringes". Anything else is not read (the sample then has no stated quantity). */
export function parseQuantity(q: string | undefined): Quantity | undefined {
  const m = /^\s*(?:(\d+(?:[.,]\d+)?)\s*[×x]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|mg|syringes?|units?|vials?)\b/i.exec(q ?? "");
  if (!m) return undefined;
  const unit = m[3]!.toLowerCase();
  const kind = unit === "ml" || unit === "l" ? "volume" : unit === "g" || unit === "kg" || unit === "mg" ? "mass" : "units";
  return { count: m[1] ? Number(m[1].replace(",", ".")) : 1, each: Number(m[2]!.replace(",", ".")), unit, kind };
}

const STOP = new Set(["maximum", "minimum", "time", "study", "point", "all", "ppq", "batches", "the", "and", "for", "from", "with", "per", "hour", "hours", "range", "expected"]);
/** Words of a label cut to four letters, so "filter" and "filtration", "hold" and "holding" count as one word. */
const stems = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 4)));
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

/**
 * The one candidate whose label shares at least two words with `label` and clearly more than any other. Two equally good candidates are
 * ambiguous and give nothing: a wrong link would put a number next to a limit it does not belong to.
 */
function bestMatch<T>(label: string | readonly string[], candidates: readonly T[], labelOf: (c: T) => string | readonly string[]): T | undefined {
  const words = (l: string | readonly string[]) => [l].flat().map(stems);
  const mine = words(label);
  // A clock can be known by two labels (a plan hold and the limit row it is compared with); the better of the pairs counts.
  const score = (c: T) => Math.max(0, ...mine.flatMap((a) => words(labelOf(c)).map((b) => shared(a, b))));
  const scored = candidates.map((c) => ({ c, s: score(c) })).sort((x, y) => y.s - x.s);
  return scored[0] && scored[0].s >= 2 && (scored.length === 1 || scored[0].s > scored[1]!.s) ? scored[0].c : undefined;
}

const fmt = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);
const fmtH = (h: number) => `${fmt(h)} h`;
const POINT = /\bSP-\d{3,}\b/g;
const TAKE = /\b(take|draw|collect|withdraw)\b/i;
const PORT = /(?:(?:upper|lower|bottom|top|sterile|sampling|sample|manifold)[ -])*(?:port|valve|manifold|tap)\b/i;

// ------------------------------------------------------------------ the view

export function buildProcessView(project: Project, rec: MbrRecord): ProcessView {
  const nums = numberSteps(rec);
  const cut = splitIndex(rec);
  const plan: SamplingPlan | undefined = rec.planId ? project.sampling.plans.find((p) => p.id === rec.planId) : undefined;
  const partOf = (si: number): 1 | 2 => (cut >= 0 && si > cut ? 2 : 1);

  // ---- equipment: one per section, plus the hold where a split record's parts meet
  const equipment: ViewEquipment[] = [];
  rec.sections.forEach((s, si) => {
    const sh = shapeForUnitOp(s.unitOp);
    equipment.push({ id: `EQ-${s.id}`, sectionId: s.id, number: si + 1, title: s.title, ...(s.unitOp ? { unitOp: s.unitOp } : {}), shape: sh.shape, known: sh.known, part: partOf(si) });
    if (si === cut) equipment.push({ id: "EQ-HOLD", number: si + 1, title: "Hold between the parts", shape: "hold", known: true, part: 1 });
  });
  const eqOfSection = (sectionId: string) => `EQ-${sectionId}`;

  // ---- moments: the start, one per block with steps (the step range of the block), the two hold entries of a split record, the end
  const moments: ViewMoment[] = [{ index: 0, kind: "start", title: "Before the first step", part: 1, stepIds: [], sampleIds: [] }];
  const stepMoment = new Map<string, number>();
  const blockMoment = new Map<string, number>();
  const range = (ids: string[]) => {
    const a = ids.length ? nums.get(ids[0]!) : undefined;
    const b = ids.length ? nums.get(ids[ids.length - 1]!) : undefined;
    return a && b ? (a === b ? a : `${a} to ${b}`) : undefined;
  };
  rec.sections.forEach((s, si) => {
    const first = moments.length;
    for (const b of s.blocks) {
      if (b.steps.length === 0) continue;
      const ids = b.steps.map((x) => x.id);
      const r = range(ids);
      const m: ViewMoment = { index: moments.length, kind: "block", title: `${s.title}: ${b.title}`, equipmentId: eqOfSection(s.id), sectionId: s.id, sectionNumber: si + 1, blockId: b.id, part: partOf(si), stepIds: ids, ...(r ? { stepRange: r } : {}), sampleIds: [] };
      moments.push(m);
      blockMoment.set(b.id, m.index);
      for (const id of ids) stepMoment.set(id, m.index);
    }
    if (moments.length === first) {
      // A section with no stepped block (a custom section the author has not filled) still has its place in the train.
      moments.push({ index: moments.length, kind: "block", title: s.title, equipmentId: eqOfSection(s.id), sectionId: s.id, sectionNumber: si + 1, part: partOf(si), stepIds: [], sampleIds: [] });
    }
    for (const b of s.blocks) if (!blockMoment.has(b.id)) blockMoment.set(b.id, first);
    if (si === cut) {
      moments.push({ index: moments.length, kind: "hold_start", title: "Hold start (end of Part 1)", equipmentId: "EQ-HOLD", part: 1, stepIds: [], sampleIds: [] });
      moments.push({ index: moments.length, kind: "hold_end", title: "Hold end (start of Part 2)", equipmentId: "EQ-HOLD", part: 2, stepIds: [], sampleIds: [] });
    }
  });
  moments.push({ index: moments.length, kind: "end", title: "After the last step", part: cut >= 0 ? 2 : 1, stepIds: [], sampleIds: [] });
  const holdStartAt = moments.find((m) => m.kind === "hold_start")?.index;
  const holdEndAt = moments.find((m) => m.kind === "hold_end")?.index;

  // ---- samples: each row is taken at the step that names it, or on the hold entry that prints it
  const allSteps: { step: MbrStep; sectionIndex: number }[] = rec.sections.flatMap((s, si) => s.blocks.flatMap((b) => b.steps.map((step) => ({ step, sectionIndex: si }))));
  const entry = holdEntryInfo(project, rec);
  const onEntry = new Map<string, number>();
  if (holdStartAt !== undefined && holdEndAt !== undefined) {
    for (const e of entry.entries) for (const r of e.samples) onEntry.set(r.id, e.edge === "start" ? holdStartAt : holdEndAt);
  }
  const samples: ViewSample[] = [];
  const sampleRows: { row: MbrSampleRow; si: number }[] = rec.sections.flatMap((s, si) => s.blocks.flatMap((b) => b.samples.map((row) => ({ row, si }))));
  for (const { row, si } of sampleRows) {
    const named = allSteps.filter(({ step }) => new RegExp(`\\b${row.pointId}\\b`).test(step.text) || step.placedFor?.points.includes(row.pointId));
    const taker =
      named.find(({ step }) => step.placedFor?.points.includes(row.pointId)) ??
      named.find(({ step }) => TAKE.test(step.text) && !/not taken here/i.test(step.text)) ??
      named.find(({ step }) => !/not taken here/i.test(step.text));
    const entryAt = onEntry.get(row.id);
    const q = parseQuantity(row.quantity);
    let momentIndex: number;
    if (entryAt !== undefined) momentIndex = entryAt;
    else if (taker) momentIndex = stepMoment.get(taker.step.id)!;
    else momentIndex = lastMomentOfSection(moments, rec.sections[si]!.id);
    const port = taker ? PORT.exec(taker.step.text)?.[0] : undefined;
    const kind: ViewSample["kind"] = q ? q.kind : "unknown";
    samples.push({
      rowId: row.id,
      pointId: row.pointId,
      test: row.test,
      ...(row.quantity ? { quantityText: row.quantity } : {}),
      ...(q?.kind === "volume" ? { volumeMl: q.count * q.each * (q.unit === "l" ? 1000 : 1) } : {}),
      ...(q?.kind === "units" ? { units: q.count * q.each } : {}),
      kind,
      sectionNumber: si + 1,
      momentIndex,
      ...(taker ? { stepNumber: nums.get(taker.step.id)! } : {}),
      tiedToStep: entryAt !== undefined || Boolean(taker),
      ...(port ? { port } : {}),
      ...(row.container ? { container: row.container } : {}),
      ...(row.storage ? { storage: row.storage } : {}),
    });
    moments[momentIndex]!.sampleIds.push(row.id);
  }

  // ---- clocks
  const allLimits = rec.sections.flatMap((s, si) => s.blocks.flatMap((b) => b.timeLimits.map((limit) => ({ limit, section: s, si, blockId: b.id }))));
  const timeParams = rec.sections.flatMap((s, si) =>
    s.blocks.flatMap((b) =>
      b.params.flatMap((p) => {
        const hours = parseHours(p.mbrValue, p.mbrUnit);
        return hours !== undefined && !/range/i.test(p.label) ? [{ p, hours, si }] : [];
      }),
    ),
  );
  const limitSource = (l: MbrTimeLimit, si: number) => `${l.id}, section ${si + 1}${l.trd ? `; TRD value ${l.trd.text ?? "not stated"}${l.trd.unit ? ` ${l.trd.unit}` : ""} in ${l.trd.section}` : "; typed in the record"}`;
  const consumed = new Set<string>();
  const clocks: ViewClock[] = [];

  /**
   * Planned time for a clock: a time-unit row of the sections given whose label matches, a study point or an expected duration. The match
   * must hold both ways: the row has to be closer to this clock than to any other, or two clocks would show the same number.
   */
  const pending: { clock: ViewClock; labels: string[]; sections: number[]; planHours?: number | undefined; planSource?: string }[] = [];
  const plannedFor = (me: (typeof pending)[number]) => {
    const cands = timeParams.filter((t) => me.sections.includes(t.si));
    const hit = bestMatch(me.labels, cands, (t) => t.p.label);
    if (!hit || bestMatch(hit.p.label, pending, (x) => x.labels) !== me) return undefined;
    return { hours: hit.hours, text: `${hit.p.mbrValue} ${hit.p.mbrUnit}`, source: `row ${hit.p.id}: ${hit.p.label}`, study: hit.p.studyPoint === true };
  };

  // Holds of the linked sampling plan. Their span is the hold-start and hold-end sampling steps the record carries, or the two hold entries.
  for (const h of plan?.holds ?? []) {
    const planStep = plan!.steps.find((s) => s.id === h.afterStepId);
    const secIdx = rec.sections.flatMap((s, si) => (planStep?.unitOp && s.unitOp === planStep.unitOp ? [si] : []));
    const isSplitHold = rec.split?.planHoldId === h.id && holdStartAt !== undefined;
    // A hold starts and ends where the record takes the sample of its start and of its end (the plan puts those samples on the hold).
    const at = (edge: "hold_start" | "hold_end") => {
      const hits = samples.filter((x) => {
        const pt = plan!.points.find((p) => p.id === x.pointId);
        return x.tiedToStep && pt?.flow?.holdId === h.id && sampleMomentKey(pt) === edge;
      });
      return hits.length ? (edge === "hold_start" ? Math.min : Math.max)(...hits.map((x) => x.momentIndex)) : undefined;
    };
    const startMoment = isSplitHold ? holdStartAt : at("hold_start");
    const endMoment = isSplitHold ? holdEndAt : at("hold_end");
    // The limit: the one the author named for the split hold, else the single best word match among the limits of the same unit operation.
    const named = isSplitHold && rec.split?.holdLimitId ? allLimits.find((x) => x.limit.id === rec.split!.holdLimitId) : undefined;
    const matched = named ?? bestMatch(h.label, allLimits.filter((x) => secIdx.includes(x.si) && !consumed.has(x.limit.id)), (x) => x.limit.label);
    if (matched) consumed.add(matched.limit.id);
    const limitHours = matched ? parseHours(matched.limit.value, matched.limit.unit) : undefined;
    clocks.push({
      id: h.id,
      kind: "hold",
      label: h.label,
      ...(secIdx[0] !== undefined ? { sectionNumber: secIdx[0] + 1 } : {}),
      ...(matched ? { limitRowId: matched.limit.id, limitText: `${matched.limit.value ?? "not stated"} ${matched.limit.unit ?? ""}`.trim(), limitSource: limitSource(matched.limit, matched.si) } : {}),
      ...(limitHours !== undefined ? { limitHours } : {}),
      ...(startMoment !== undefined ? { startMoment } : {}),
      ...(endMoment !== undefined ? { endMoment } : {}),
      span: isSplitHold ? "split" : "hold_steps",
      spanText: startMoment !== undefined && endMoment !== undefined ? `from ${momentWords(moments[startMoment]!)} to ${momentWords(moments[endMoment]!)}` : startMoment !== undefined ? `starts ${momentWords(moments[startMoment]!)}; no step marks the end` : endMoment !== undefined ? `ends ${momentWords(moments[endMoment]!)}; no step marks the start` : "no hold-start or hold-end step in the record",
      ...(h.condition ? { storage: h.condition } : {}),
    });
    pending.push({ clock: clocks[clocks.length - 1]!, labels: [h.label, ...(matched ? [matched.limit.label] : [])], sections: secIdx, planHours: h.durationHours, planSource: `sampling plan hold ${h.id}${h.durationText ? `: ${h.durationText}` : ""}` });
  }

  // Every other time limit of the record. Sub-limits (targets) with step ranges give the span; otherwise the clock sits at the block that states it.
  for (const { limit: l, si, blockId } of allLimits) {
    if (consumed.has(l.id)) continue;
    const hours = parseHours(l.value, l.unit);
    const parts = l.targets.map((t) => ({
      label: t.label,
      ...(parseHours(t.value, t.unit ?? l.unit) !== undefined ? { hours: parseHours(t.value, t.unit ?? l.unit)! } : {}),
      ...(t.value ? { text: `${t.value} ${t.unit ?? l.unit ?? ""}`.trim() } : {}),
      ...(t.fromStepId && stepMoment.has(t.fromStepId) ? { startMoment: stepMoment.get(t.fromStepId)! } : {}),
      ...(t.toStepId && stepMoment.has(t.toStepId) ? { endMoment: stepMoment.get(t.toStepId)! } : {}),
    }));
    const spans = parts.flatMap((p) => [p.startMoment, p.endMoment].filter((x): x is number => x !== undefined));
    const own = blockMoment.get(blockId);
    clocks.push({
      id: l.id,
      kind: "limit",
      label: l.label,
      sectionNumber: si + 1,
      limitRowId: l.id,
      limitText: `${l.value ?? "not stated"} ${l.unit ?? ""}`.trim(),
      limitSource: limitSource(l, si),
      ...(hours !== undefined ? { limitHours: hours } : {}),
      ...(spans.length ? { startMoment: Math.min(...spans), endMoment: Math.max(...spans) } : own !== undefined ? { startMoment: own, endMoment: own } : {}),
      span: spans.length ? "target_steps" : "block",
      spanText: spans.length ? `sub-limits cover ${momentWords(moments[Math.min(...spans)]!)} to ${momentWords(moments[Math.max(...spans)]!)}` : `no start and end steps stated; shown at ${momentWords(moments[own ?? 0]!)}`,
      ...(parts.length ? { parts } : {}),
    });
    pending.push({ clock: clocks[clocks.length - 1]!, labels: [l.label], sections: [si] });
  }
  // Planned times last, once every clock is known (see plannedFor). A hold falls back to the duration its plan states.
  for (const p of pending) {
    const planned = plannedFor(p);
    if (planned) Object.assign(p.clock, { plannedHours: planned.hours, plannedText: planned.text, plannedSource: planned.source, studyPoint: planned.study });
    else if (p.planHours !== undefined) Object.assign(p.clock, { plannedHours: p.planHours, plannedText: `${fmt(p.planHours)} h`, plannedSource: p.planSource });
  }

  // ---- volumes
  const volRows = rec.sections.flatMap((s, si) =>
    s.blocks.flatMap((b) =>
      b.params.flatMap((p) => {
        const n = singleNumber(p.mbrValue);
        const litres = n !== undefined ? toLitres(n, p.mbrUnit) : undefined;
        return litres !== undefined ? [{ p, litres, si }] : [];
      }),
    ),
  );
  // "The batch volume" of a section is a row that says so in its label. A study point is a challenge, not the batch, so it is left out.
  const batchVolumeOf = (si: number) => {
    const c = volRows.filter((v) => v.si === si && !v.p.studyPoint && /batch\s+(volume|size)/i.test(v.p.label) && !/range/i.test(v.p.label));
    const out: { ok?: (typeof c)[number]; ambiguous?: string[] } = c.length === 1 ? { ok: c[0]! } : c.length > 1 ? { ambiguous: c.map((x) => x.p.id) } : {};
    return out;
  };
  const planBatches = (plan?.batches ?? []).flatMap((b) => {
    const litres = b.batchSize !== undefined ? toLitres(b.batchSize, b.batchSizeUnit) : undefined;
    return litres !== undefined ? [{ label: b.label, sizeL: litres }] : [];
  });
  const momentVolumes: MomentVolume[] = moments.map((m) => {
    if (m.sectionNumber === undefined) return { withdrawnL: 0 };
    const si = m.sectionNumber - 1;
    const withdrawn = samples.filter((x) => x.sectionNumber === m.sectionNumber && x.momentIndex <= m.index && x.volumeMl !== undefined).reduce((a, x) => a + x.volumeMl! / 1000, 0);
    const b = batchVolumeOf(si);
    if (b.ok) return { statedL: b.ok.litres, statedRowId: b.ok.p.id, statedLabel: b.ok.p.label, withdrawnL: withdrawn, remainingL: b.ok.litres - withdrawn };
    return {
      withdrawnL: withdrawn,
      missing: b.ambiguous ? `${b.ambiguous.join(", ")} could each be the batch volume of section ${m.sectionNumber}` : `no row of section ${m.sectionNumber} states a batch volume`,
      ...(planBatches.length ? { planBatches } : {}),
    };
  });
  const volumeSections: VolumeSectionRow[] = rec.sections.map((s, si) => {
    const mine = samples.filter((x) => x.sectionNumber === si + 1 && x.volumeMl !== undefined);
    const ml = mine.reduce((a, x) => a + x.volumeMl!, 0);
    const b = batchVolumeOf(si);
    if (b.ok) {
      const pct = (ml / 1000 / b.ok.litres) * 100;
      return { sectionNumber: si + 1, sectionTitle: s.title, statedL: b.ok.litres, statedRowId: b.ok.p.id, sampleMl: ml, sampleCount: mine.length, percent: pct, status: ml / 1000 > b.ok.litres ? "over" : "ok" };
    }
    return { sectionNumber: si + 1, sectionTitle: s.title, sampleMl: ml, sampleCount: mine.length, status: "no_data", missing: b.ambiguous ? `several rows could be the batch volume (${b.ambiguous.join(", ")})` : "no row states a batch volume" };
  });
  const fillRows = volRows.filter((v) => (v.p.key === "fill_volume" || /^fill volume$/i.test(v.p.label)) && (v.p.mbrUnit ?? "").trim().toLowerCase() === "ml");
  const fillMl = fillRows.length === 1 ? fillRows[0]!.litres * 1000 : undefined;
  const holdUp = volRows.find((v) => /hold-?up|dead volume/i.test(v.p.label));
  const volumeBatches: VolumeBatchRow[] = (plan?.batches ?? []).map((b) => {
    const missing: string[] = [];
    const size = b.batchSize !== undefined ? toLitres(b.batchSize, b.batchSizeUnit) : undefined;
    if (size === undefined) missing.push(`the batch size of ${b.label} in litres`);
    if (b.plannedLotSizeUnits === undefined) missing.push(`the planned number of units of ${b.label}`);
    if (fillMl === undefined) missing.push(fillRows.length > 1 ? "which row is the fill volume (several rows could be)" : "a parameter row \"Fill volume\" in mL");
    const filled = b.plannedLotSizeUnits !== undefined && fillMl !== undefined ? (b.plannedLotSizeUnits * fillMl) / 1000 : undefined;
    const row: VolumeBatchRow = { batchId: b.id, label: b.label, ...(size !== undefined ? { batchSizeL: size } : {}), ...(b.plannedLotSizeUnits !== undefined ? { units: b.plannedLotSizeUnits } : {}), ...(filled !== undefined ? { filledL: filled } : {}), status: "no_data", missing };
    if (filled !== undefined && size !== undefined) {
      row.leftoverL = size - filled;
      row.status = filled > size ? "over" : "ok";
    }
    return row;
  });

  // ---- checks
  const findings: ViewFinding[] = [];
  const checks: ViewCheck[] = [];
  const stepNo = (id: string) => nums.get(id) ?? id;
  const addFinding = (checkId: string, severity: Severity, title: string, detail: string, steps: string[], rows: string[], momentIdx: number[]): ViewFinding => {
    const f: ViewFinding = { id: `F${findings.length + 1}`, checkId, severity, title, detail, steps: [...new Set(steps)], rows: [...new Set(rows)], moments: [...new Set(momentIdx)] };
    findings.push(f);
    return f;
  };
  const check = (id: string, group: ViewCheck["group"], title: string, needs: string, run: () => { status: ViewCheck["status"]; summary: string; missing?: string[]; found?: ViewFinding[] }) => {
    const r = run();
    checks.push({ id, group, title, needs, status: r.status, summary: r.summary, missing: r.missing ?? [], findingIds: (r.found ?? []).map((f) => f.id) });
  };
  const momentStepNos = (idx: number[]) => idx.flatMap((i) => (moments[i]!.stepRange ? [moments[i]!.stepRange!] : []));

  // C1: every time limit has a value and a unit of time
  check("C1", "Clocks", "Every time limit states a value in hours, minutes or days", "A value and a time unit on each time limit row", () => {
    if (allLimits.length === 0) return { status: "na", summary: "The record has no time limit rows." };
    const bad = allLimits.filter((x) => parseHours(x.limit.value, x.limit.unit) === undefined);
    if (bad.length === 0) return { status: "ok", summary: `${allLimits.length} time limits, all with a value and a time unit.` };
    return { status: "no_data", summary: `${bad.length} of ${allLimits.length} time limits have no usable value.`, missing: bad.map((x) => `the value or unit of ${x.limit.id} (${x.limit.label}), section ${x.si + 1}`) };
  });

  // C2: a planned time longer than its limit
  check("C2", "Clocks", "A planned time is not longer than its limit", "A time limit and a planned time (a study point row, an expected duration or a plan hold duration) for the same clock", () => {
    const both = clocks.filter((c) => c.limitHours !== undefined && c.plannedHours !== undefined);
    if (both.length === 0) return { status: "no_data", summary: "No clock has both a limit and a planned time.", missing: ["a planned time stated for a clock with a limit (a study point row, an expected duration row or a duration on a plan hold)"] };
    const over = both.filter((c) => c.plannedHours! > c.limitHours! + 1e-9);
    const found: ViewFinding[] = [];
    for (const c of over.filter((x) => !x.studyPoint)) {
      found.push(addFinding("C2", "major", `${c.label}: planned ${fmtH(c.plannedHours!)} is longer than the limit ${fmtH(c.limitHours!)}`, `The record plans ${fmtH(c.plannedHours!)} (${c.plannedSource}) but its own limit is ${fmtH(c.limitHours!)} (${c.limitSource}), and no row marks the planned time as a study point. Either the limit or the plan has to change, or the planned time has to be marked as a study point.`, momentStepNos([c.startMoment ?? 0]), [c.limitRowId ?? ""].filter(Boolean), [c.startMoment ?? 0]));
    }
    const study = over.filter((x) => x.studyPoint);
    if (study.length) {
      found.push(addFinding("C2", "note", `${study.length} planned ${study.length === 1 ? "time is" : "times are"} longer than the limit, marked as study points`, `The record marks these rows as study points (a challenge beyond a limit, not a limit): ${study.map((c) => `${c.label} ${c.plannedText} against ${c.limitText}`).join("; ")}. Listed so a reviewer sees them together; they are not errors.`, [], study.flatMap((c) => [c.limitRowId, c.plannedSource?.match(/R-\d+/)?.[0]].filter((x): x is string => Boolean(x))), study.map((c) => c.startMoment ?? 0)));
    }
    return { status: found.length ? "finding" : "ok", summary: `${both.length} clocks compared; ${over.length} planned longer than the limit.`, found };
  });

  // C3: sub-limits add up to no more than the total
  check("C3", "Clocks", "Sub-limits do not add up to more than their total", "A time limit with sub-limits (targets), each with a value", () => {
    const withParts = clocks.filter((c) => c.parts?.length);
    if (withParts.length === 0) return { status: "na", summary: "No time limit has sub-limits." };
    const found: ViewFinding[] = [];
    const missing: string[] = [];
    for (const c of withParts) {
      const hs = c.parts!.flatMap((p) => (p.hours === undefined ? [] : [p.hours]));
      if (c.limitHours === undefined || hs.length < c.parts!.length) {
        missing.push(`a value for ${c.limitHours === undefined ? `the limit ${c.limitRowId}` : "each sub-limit"} of ${c.label}`);
        continue;
      }
      const sum = hs.reduce((a, h) => a + h, 0);
      if (sum > c.limitHours + 1e-9) found.push(addFinding("C3", "major", `${c.label}: sub-limits add up to ${fmtH(sum)}, more than the total ${fmtH(c.limitHours)}`, `The sub-limits (${c.parts!.map((p) => `${p.label} ${p.text}`).join("; ")}) can all be used in full, so a batch can be inside every sub-limit and still be over the total.`, [], [c.limitRowId ?? ""], [c.startMoment ?? 0]));
    }
    return { status: found.length ? "finding" : missing.length ? "no_data" : "ok", summary: found.length ? `${found.length} total exceeded by its sub-limits.` : missing.length ? "Some sub-limits have no value." : `${withParts.length} ${withParts.length === 1 ? "limit has" : "limits have"} sub-limits; each total covers its parts.`, missing, found };
  });

  // C4 and C5: plan holds
  const holds = clocks.filter((c) => c.kind === "hold");
  check("C4", "Clocks", "Every hold of the sampling plan has a start and an end step in the record", "The linked sampling plan's holds and the hold-start and hold-end sampling steps (or the two hold entries of a split record)", () => {
    if (!plan) return { status: "no_data", summary: "No sampling plan is linked to this record.", missing: ["a linked sampling plan (to know which holds exist)"] };
    if (holds.length === 0) return { status: "na", summary: "The sampling plan has no holds." };
    const bad = holds.filter((c) => c.startMoment === undefined || c.endMoment === undefined);
    const found = bad.map((c) => addFinding("C4", "minor", `${c.label}: ${c.startMoment === undefined && c.endMoment === undefined ? "no step starts or ends the hold" : c.startMoment === undefined ? "no step starts the hold" : "no step ends the hold"}`, `Hold ${c.id} of the sampling plan has no hold-${c.startMoment === undefined ? "start" : "end"} sampling step in the record, so its clock cannot be placed on the steps. Add the steps that record when the hold starts and ends.`, [], [], [c.startMoment ?? c.endMoment ?? 0]));
    return { status: found.length ? "finding" : "ok", summary: found.length ? `${found.length} of ${holds.length} holds are not marked by steps.` : `${holds.length} holds, each with a start and an end.`, found };
  });
  check("C5", "Clocks", "Every hold is compared with a time limit of the record", "A time limit row for each hold (named on the split, or one clear match by wording in the same unit operation)", () => {
    if (holds.length === 0) return { status: "na", summary: plan ? "The sampling plan has no holds." : "No sampling plan is linked, so no holds are known." };
    const bad = holds.filter((c) => !c.limitRowId);
    const found = bad.map((c) => addFinding("C5", "minor", `${c.label}: no time limit of the record is linked to this hold`, `No limit row of the record's unit operation matches hold ${c.id} clearly enough (at least two shared words and one best match), so the hold is not compared with any limit. Check that the record states a limit for it.`, [], [], [c.startMoment ?? 0]));
    return { status: found.length ? "finding" : "ok", summary: found.length ? `${found.length} of ${holds.length} holds have no limit.` : `${holds.length} holds, each with a limit.`, found };
  });

  // C6: where a clock cannot be tied to steps
  check("C6", "Clocks", "Time limits are tied to start and end steps", "Sub-limits with step ranges, or hold-start and hold-end steps", () => {
    const loose = clocks.filter((c) => c.kind === "limit" && c.span === "block");
    if (clocks.length === 0) return { status: "na", summary: "The record has no clocks." };
    if (loose.length === 0) return { status: "ok", summary: "Every clock has a step range." };
    const f = addFinding("C6", "note", `${loose.length} time ${loose.length === 1 ? "limit has" : "limits have"} no start and end steps`, `${loose.map((c) => `${c.label} (${c.limitRowId})`).join("; ")}. The view shows each at the step that states it. If the record marks where each clock starts and stops, a reviewer can see it running; today only the wording of the step tells the operator.`, momentStepNos(loose.map((c) => c.startMoment ?? 0)), loose.map((c) => c.limitRowId ?? ""), loose.map((c) => c.startMoment ?? 0));
    return { status: "finding", summary: `${loose.length} of ${clocks.length} clocks have no start and end steps.`, found: [f] };
  });

  // C7: hold storage condition
  check("C7", "Clocks", "Every hold states the condition it is held at", "A condition on each hold of the sampling plan", () => {
    if (holds.length === 0) return { status: "na", summary: plan ? "The sampling plan has no holds." : "No sampling plan is linked, so no holds are known." };
    const bad = holds.filter((c) => !c.storage);
    if (bad.length === 0) return { status: "ok", summary: `${holds.length} holds, each with a condition.` };
    const f = addFinding("C7", "minor", `${bad.length} ${bad.length === 1 ? "hold states" : "holds state"} no storage condition`, `${bad.map((c) => `${c.label} (${c.id})`).join("; ")}. A hold with a time limit is only meaningful at a stated temperature.`, [], [], bad.map((c) => c.startMoment ?? 0));
    return { status: "finding", summary: `${bad.length} of ${holds.length} holds state no condition.`, missing: bad.map((c) => `the storage condition of ${c.label}`), found: [f] };
  });

  // M1: a time limit with no temperature in its section
  check("M1", "Structure", "A section with a time limit states a temperature", "A parameter row in °C in the section, or a hold condition", () => {
    const limitSections = [...new Set(allLimits.map((x) => x.si))];
    if (limitSections.length === 0) return { status: "na", summary: "The record has no time limit rows." };
    const hasTemp = (si: number) => rec.sections[si]!.blocks.some((b) => b.params.some((p) => /°\s*c|deg\s*c|^c$/i.test(p.mbrUnit ?? "") && (p.mbrValue ?? "") !== ""));
    const holdIn = (si: number) => holds.some((c) => c.sectionNumber === si + 1 && c.storage);
    const bad = limitSections.filter((si) => !hasTemp(si) && !holdIn(si));
    if (bad.length === 0) return { status: "ok", summary: `${limitSections.length} sections with time limits, each states a temperature.` };
    const f = addFinding("M1", "minor", `${bad.length} ${bad.length === 1 ? "section has" : "sections have"} a time limit but no temperature`, `${bad.map((si) => `section ${si + 1} (${rec.sections[si]!.title})`).join("; ")}. A time limit usually applies at a temperature; no row in °C and no hold condition is stated there.`, [], allLimits.filter((x) => bad.includes(x.si)).map((x) => x.limit.id), bad.map((si) => lastMomentOfSection(moments, rec.sections[si]!.id)));
    return { status: "finding", summary: `${bad.length} sections with a limit and no temperature.`, missing: bad.map((si) => `a temperature for section ${si + 1}`), found: [f] };
  });

  // M2: the split
  check("M2", "Structure", "A split record names the hold and its limit", "The plan hold and the time limit row named on the split", () => {
    if (!rec.split) return { status: "na", summary: "The record is not split." };
    const found: ViewFinding[] = [];
    const missing: string[] = [];
    if (!rec.split.planHoldId) {
      missing.push("the hold of the sampling plan the split stands for");
      found.push(addFinding("M2", "note", "The split does not name the hold it stands for", "No hold of the sampling plan is named for the gap between the parts, so the hold entries carry no plan samples and the hold has no planned time.", [], [], [holdStartAt ?? 0]));
    }
    if (!rec.split.holdLimitId) {
      missing.push("the time limit the hold is compared with");
      found.push(addFinding("M2", "minor", "The split does not name a time limit for the hold", "The elapsed hold time between the parts is compared with no limit. Name the limit row on the split.", [], [], [holdStartAt ?? 0]));
    }
    return { status: found.length ? "finding" : "ok", summary: found.length ? "The split is missing a hold or a limit." : "The split names its hold and its limit.", missing, found };
  });

  // S1..S5
  check("S1", "Samples", "Every sample row is taken at a step", "A step (or hold entry) that names the sample number", () => {
    if (samples.length === 0) return { status: "na", summary: "The record has no sample rows." };
    const bad = samples.filter((x) => !x.tiedToStep);
    if (bad.length === 0) return { status: "ok", summary: `${samples.length} samples, each taken at a step.` };
    const f = addFinding("S1", "minor", `${bad.length} ${bad.length === 1 ? "sample is" : "samples are"} in a sample table but no step takes ${bad.length === 1 ? "it" : "them"}`, `${bad.map((x) => x.pointId).join(", ")}. The operator is told to take these by the table only; shown at the end of their section.`, [], bad.map((x) => x.rowId), bad.map((x) => x.momentIndex));
    return { status: "finding", summary: `${bad.length} of ${samples.length} samples have no step.`, found: [f] };
  });
  check("S2", "Samples", "Every sample row states a readable quantity", "A quantity such as \"2 x 10 mL\" or \"300 syringes\" on each sample row", () => {
    if (samples.length === 0) return { status: "na", summary: "The record has no sample rows." };
    const bad = samples.filter((x) => x.kind === "unknown");
    if (bad.length === 0) return { status: "ok", summary: `${samples.length} samples, each with a quantity.` };
    const f = addFinding("S2", "minor", `${bad.length} ${bad.length === 1 ? "sample has" : "samples have"} no readable quantity`, `${bad.map((x) => `${x.pointId}${x.quantityText ? ` ("${x.quantityText}")` : ""}`).join(", ")}. Without a quantity the volume drawn cannot be counted.`, [], bad.map((x) => x.rowId), bad.map((x) => x.momentIndex));
    return { status: "finding", summary: `${bad.length} samples have no readable quantity.`, missing: bad.map((x) => `the quantity of ${x.pointId}`), found: [f] };
  });
  check("S3", "Samples", "The step that takes a sample names the port it is taken from", "A port, valve or manifold named in the step text", () => {
    const tied = samples.filter((x) => x.tiedToStep && x.stepNumber);
    if (tied.length === 0) return { status: "na", summary: "No sample is taken at a step." };
    const bad = tied.filter((x) => !x.port);
    if (bad.length === 0) return { status: "ok", summary: `${tied.length} samples, each with a named port.` };
    const f = addFinding("S3", "note", `${bad.length} ${bad.length === 1 ? "sample step names" : "sample steps name"} no port`, `${bad.map((x) => `${x.pointId} (step ${x.stepNumber})`).join(", ")}. The step text has none of the words port, valve, manifold or tap. Where the sample is drawn from decides what it represents.`, bad.map((x) => x.stepNumber!), bad.map((x) => x.rowId), bad.map((x) => x.momentIndex));
    return { status: "finding", summary: `${bad.length} of ${tied.length} sample steps name no port.`, found: [f] };
  });
  check("S4", "Samples", "A quantity written in the sample step matches the sample row", "A step that names one sample and writes a quantity as \"N x M mL\"", () => {
    const found: ViewFinding[] = [];
    let compared = 0;
    for (const x of samples) {
      if (!x.stepNumber) continue;
      const step = allSteps.find((s) => nums.get(s.step.id) === x.stepNumber)?.step;
      const ids = new Set(step?.text.match(POINT) ?? []);
      const m = step ? /(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*mL/.exec(step.text) : undefined;
      const q = parseQuantity(x.quantityText);
      if (!step || ids.size !== 1 || !m || !q || q.kind !== "volume") continue;
      compared++;
      if (Number(m[1]) !== q.count || Number(m[2]) !== q.each) found.push(addFinding("S4", "minor", `${x.pointId}: the step says ${m[0]}, the sample row says ${x.quantityText}`, `Step ${x.stepNumber} and the row ${x.rowId} disagree on the quantity.`, [x.stepNumber], [x.rowId], [x.momentIndex]));
    }
    if (compared === 0) return { status: "na", summary: "No sample step writes its quantity as N x M mL." };
    return { status: found.length ? "finding" : "ok", summary: found.length ? `${found.length} of ${compared} disagree.` : `${compared} sample steps agree with their rows.`, found };
  });
  check("S5", "Samples", "No volume sample is drawn after the sterilizing filter without a review", "A sterile-filtration section and volume samples in later sections", () => {
    const sf = rec.sections.findIndex((s) => s.unitOp === "sterile_filtration");
    if (sf < 0) return { status: "na", summary: "The record has no sterile-filtration section." };
    const late = samples.filter((x) => x.volumeMl !== undefined && x.sectionNumber - 1 > sf);
    if (late.length === 0) return { status: "ok", summary: "No volume sample is taken in a section after the sterile filtration." };
    const f = addFinding("S5", "note", `${late.length} volume ${late.length === 1 ? "sample is" : "samples are"} taken after the sterile filtration`, `${late.map((x) => x.pointId).join(", ")}. A volume drawn from the sterile side is an aseptic withdrawal and leaves the filled product; check the step for how it is drawn.`, momentStepNos(late.map((x) => x.momentIndex)), late.map((x) => x.rowId), late.map((x) => x.momentIndex));
    return { status: "finding", summary: `${late.length} volume samples after the sterile filtration.`, found: [f] };
  });

  // V1 and V2
  check("V1", "Volumes", "Samples drawn in a section are not more than its batch volume", "A parameter row \"batch volume\" (L or mL) in the section and sample quantities in mL or L", () => {
    const rowsWith = volumeSections.filter((v) => v.statedL !== undefined);
    if (rowsWith.length === 0) {
      return { status: "no_data", summary: "No section states a batch volume, so no volume balance can be made.", missing: ["a parameter row \"batch volume\" with a number and a unit of volume in at least one section"] };
    }
    const over = rowsWith.filter((v) => v.status === "over");
    const found = over.map((v) => addFinding("V1", "major", `Section ${v.sectionNumber}: samples (${fmt(v.sampleMl / 1000, 3)} L) are more than the batch volume (${fmt(v.statedL!, 3)} L)`, `More is drawn as samples in this section than the batch volume the record states (row ${v.statedRowId}).`, [], [v.statedRowId ?? ""], [lastMomentOfSection(moments, rec.sections[v.sectionNumber - 1]!.id)]));
    const missing = volumeSections.filter((v) => v.status === "no_data" && v.sampleCount > 0).map((v) => `a batch volume for section ${v.sectionNumber} (${v.sampleCount} volume samples)`);
    return { status: found.length ? "finding" : "ok", summary: `${rowsWith.length} sections compared.${missing.length ? ` ${missing.length} sections with samples state no batch volume.` : ""}`, missing, found };
  });
  check("V2", "Volumes", "The volume filled is not more than the batch size", "A \"Fill volume\" row in mL, and for each batch of the linked sampling plan its size and planned units", () => {
    if (!plan) return { status: "no_data", summary: "No sampling plan is linked, so there are no batch sizes.", missing: ["a linked sampling plan with batches (size and planned units)"] };
    if (volumeBatches.length === 0) return { status: "no_data", summary: "The sampling plan has no batches.", missing: ["batches in the sampling plan (size and planned units)"] };
    const missing = [...new Set(volumeBatches.flatMap((b) => b.missing))];
    const over = volumeBatches.filter((b) => b.status === "over");
    const found = over.map((b) => addFinding("V2", "major", `${b.label}: ${b.units?.toLocaleString("en")} units use ${fmt(b.filledL!, 3)} L, more than the batch size ${fmt(b.batchSizeL!, 3)} L`, `Planned units times the fill volume is more than the batch the plan states.`, [], [fillRows[0]?.p.id ?? ""], [0]));
    const ok = volumeBatches.filter((b) => b.status === "ok").length;
    return { status: found.length ? "finding" : ok > 0 ? "ok" : "no_data", summary: ok + over.length > 0 ? `${ok + over.length} of ${volumeBatches.length} batches compared.${holdUp ? "" : " No row states a hold-up allowance, so the part of the batch that is not filled cannot be explained."}` : "No batch could be compared.", missing, found };
  });

  const missingData = [...new Set(checks.filter((c) => c.status === "no_data").flatMap((c) => c.missing))];
  const assumptions = [
    "The tracker follows the record's steps in their written order. The record carries no clock times, so no timeline is drawn: a clock is shown as running, not started or finished at a moment, next to the limit and the planned time the record states.",
    "A moment is one block of steps (for example \"Dilution and mixing\"), the two hold entries of a split record, and the start and end of the record. Sample tables, forms and blocks without steps are not moments of their own.",
    "A sample is taken at the step that carries its sample number (a step written to place the sample first, then a step that says take, draw, collect or withdraw). A sample on a hold entry is taken there. A sample no step names is shown at the end of its section.",
    "A sample's quantity is read from text like \"2 x 10 mL\". Volume samples are added up in mL; samples counted in syringes or units are counted apart; samples in grams are not turned into a volume, because no density is stated.",
    "A time limit is linked to a hold of the sampling plan only when the split names it, or when one limit in the hold's unit operation shares at least two words with the hold's label and clearly more than any other. Two equal matches link nothing.",
    "A planned time comes from a time row of the section that shares at least two words with the clock's label (a study point or an expected duration), else from the duration of the sampling plan hold. A row marked as a study point is a challenge beyond a limit and is not an error.",
    "A section's batch volume is the one row of that section whose label says batch volume or batch size, with a number and a unit of volume. Volumes are not carried from one section to the next: nothing says what is lost on the way.",
    "The tracker adds no default tolerance, no hold-up allowance and no density. A check that needs one of them says what is missing.",
    "Findings are review prompts. The view never approves a record and never states a filing category; it needs a person's regulatory affairs assessment for anything that changes a filing.",
    "The drawing is a schematic: shapes follow the unit operation (an unknown or custom operation is a generic vessel with its title); positions and pipes are not process data.",
  ];
  return { recordId: rec.id, title: rec.title, split: cut >= 0, equipment, moments, clocks, samples, momentVolumes, volumeSections, volumeBatches, checks, findings, assumptions, missingData };
}

const lastMomentOfSection = (moments: readonly ViewMoment[], sectionId: string): number => {
  let at = 0;
  for (const m of moments) if (m.sectionId === sectionId) at = m.index;
  return at;
};

/** A moment in words for a sentence ("at step 5.1 to 5.8 (Section 5: ...)"). */
function momentWords(m: ViewMoment): string {
  if (m.kind === "block") return m.stepRange ? `at step ${m.stepRange}` : `in ${m.title}`;
  return m.title.toLowerCase().startsWith("hold") ? `at the ${m.title.charAt(0).toLowerCase()}${m.title.slice(1)}` : m.title.charAt(0).toLowerCase() + m.title.slice(1);
}

/** What a clock does at a moment. */
export function clockStatusAt(c: ViewClock, momentIndex: number): ClockStatus {
  if (c.startMoment === undefined && c.endMoment === undefined) return "not_here";
  if (c.span === "block") return momentIndex === c.startMoment ? "applies_here" : "not_here";
  if (c.startMoment !== undefined && momentIndex < c.startMoment) return "not_started";
  if (c.endMoment === undefined) return "started_end_not_marked";
  if (momentIndex > c.endMoment) return "finished";
  return "running";
}

export const CLOCK_STATUS_TEXT: Record<ClockStatus, string> = {
  not_started: "Not started",
  running: "Running",
  finished: "Finished",
  applies_here: "Applies at this step",
  not_here: "Not at this step",
  started_end_not_marked: "Started, no step marks the end",
};

/** The current moment in words, for a screen reader and for the text under the slider. */
export function describeMoment(view: ProcessView, index: number): string {
  const m = view.moments[index];
  if (!m) return "";
  const parts = [`Moment ${index + 1} of ${view.moments.length}: ${m.title}.`];
  if (view.split) parts.push(`Part ${m.part}.`);
  if (m.stepRange) parts.push(`Steps ${m.stepRange}.`);
  const running = view.clocks.filter((c) => ["running", "applies_here", "started_end_not_marked"].includes(clockStatusAt(c, index)));
  parts.push(running.length ? `Clocks: ${running.map((c) => `${c.label}${c.limitText ? `, limit ${c.limitText}` : ", no limit stated"}`).join("; ")}.` : "No clock is running.");
  const ss = view.samples.filter((s) => s.momentIndex === index);
  parts.push(ss.length ? `Samples taken: ${ss.map((s) => s.pointId).join(", ")}.` : "No sample is taken here.");
  return parts.join(" ");
}
