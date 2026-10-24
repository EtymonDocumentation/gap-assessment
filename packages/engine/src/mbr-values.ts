import type { MbrParamRow, MbrTrdRef, MbrTimeLimit, SeedStatus, TrdDocument, TrdItem, TrdRange, TrdStep } from "@gap/process-model";
import { effectiveField } from "./trd";

/*
 * Values of the master batch record: how a TRD value is read for a batch-record row, and the report-only comparison of an MBR value with
 * its TRD value. Nothing here decides anything: the comparison produces a sentence for information and never blocks or rewrites.
 */

export const NOT_HELD = "value not held by the site";

type Collection = MbrTrdRef["collection"];

const num = (n: number) => String(n);

/** A TRD range as text without the unit ("50 to 70", "up to 72", "from 15"). */
function rangeValueText(r: TrdRange): string {
  if (r.min !== undefined && r.max !== undefined) return `${num(r.min)} to ${num(r.max)}`;
  if (r.max !== undefined) return `up to ${num(r.max)}`;
  return `from ${num(r.min!)}`;
}

/** Splits a trailing unit off a value text ("72 h" with unit "h" -> "72"), so the unit is held on its own. */
function stripUnit(text: string, unit: string | undefined): string {
  const u = (unit ?? "").trim();
  if (u && text.endsWith(u)) return text.slice(0, text.length - u.length).trim();
  return text;
}

const stepOfUnitOp = (doc: TrdDocument, unitOp: string): TrdStep | undefined => doc.steps.find((s) => s.key === unitOp);
const itemOf = (step: TrdStep | undefined, collection: Collection, key: string): TrdItem | undefined => step?.items.find((i) => i.collection === collection && i.key === key);

/** The site path of a TRD value. */
export const trdValuePath = (unitOp: string, collection: Collection, itemKey: string, field: string) => `uo.${unitOp}.${collection}.${itemKey}.${field}`;

/**
 * Reads one TRD value for a batch-record row. The TRD's own entries (set point, NOR, PAR) are read first; then the item's field of
 * that name (a project value, with the user's override on top). When the TRD record has no such step or item, or the value is not
 * established, the result says so ("value not held by the site") and carries no text: nothing is filled in.
 */
export function resolveTrdValue(doc: TrdDocument, unitOp: string, collection: Collection, itemKey: string, field: string, at: string): MbrTrdRef {
  const step = stepOfUnitOp(doc, unitOp);
  const item = itemOf(step, collection, itemKey);
  const base = {
    trdId: doc.id,
    ...(step ? { stepId: step.id } : {}),
    collection,
    itemKey,
    field,
    path: trdValuePath(unitOp, collection, itemKey, field),
    section: step?.label ?? "",
    copiedAt: at,
  };
  const none = (status: SeedStatus = "not_established"): MbrTrdRef => ({ ...base, status, sourceIds: [] });
  if (!item) return none();
  const lim = field === "setPoint" || field === "nor" || field === "par" ? item.limits?.[field] : undefined;
  if (lim) {
    if ("value" in lim) {
      return { ...base, status: lim.provisional ? "tbd" : "established", text: num(lim.value), ...(lim.unit ? { unit: lim.unit } : {}), min: lim.value, max: lim.value, ...(lim.provisional ? { provisional: true as const } : {}), sourceIds: [...lim.sourceIds], ...(lim.locations ? { locations: structuredClone(lim.locations) } : {}) };
    }
    return {
      ...base,
      status: lim.provisional ? "tbd" : "established",
      text: rangeValueText(lim),
      ...(lim.unit ? { unit: lim.unit } : {}),
      ...(lim.min !== undefined ? { min: lim.min } : {}),
      ...(lim.max !== undefined ? { max: lim.max } : {}),
      ...(lim.provisional ? { provisional: true as const } : {}),
      sourceIds: [...lim.sourceIds],
      ...(lim.locations ? { locations: structuredClone(lim.locations) } : {}),
    };
  }
  const f = item.fields.find((x) => x.key === field);
  if (!f) return none();
  const ev = effectiveField(f);
  if (ev.status === "not_established") return none();
  const unit = f.override ? f.override.unit?.trim() || undefined : f.pulled?.unit?.trim() || undefined;
  const sourceIds = f.override ? [] : [...(f.pulled?.sourceIds ?? [])];
  const locations = f.override ? undefined : f.pulled?.locations;
  if (ev.status === "tbd" || ev.status === "not_applicable") {
    // A TBD or not-applicable answer is shown as the TRD words it ("To be determined (TBD)"); it is not a value to copy.
    return { ...base, status: ev.status, text: ev.text, ...(ev.provisional ? { provisional: true as const } : {}), sourceIds, ...(locations ? { locations: structuredClone(locations) } : {}) };
  }
  return { ...base, status: "established", text: stripUnit(ev.text, unit), ...(unit ? { unit } : {}), sourceIds, ...(locations ? { locations: structuredClone(locations) } : {}) };
}

/** True when the TRD holds a usable value (a number or text to copy), as opposed to TBD, not applicable or nothing. */
export const trdHasValue = (t: MbrTrdRef | undefined): boolean => Boolean(t && t.status === "established" && (t.text ?? "").trim());

/** The value of a TRD reference as one line for a reader: "50 to 70 L/min", or the words for an absent value. */
export function trdRefText(t: MbrTrdRef | undefined): string {
  if (!t) return "No TRD value linked";
  if (t.status === "not_established") return NOT_HELD;
  const base = [t.text, t.unit].filter(Boolean).join(" ");
  return base || NOT_HELD;
}

/** True when two copies of a TRD value say different things (the place and the copy time are not compared). */
export function trdValueDiffers(a: MbrTrdRef, b: MbrTrdRef): boolean {
  return a.status !== b.status || (a.text ?? "") !== (b.text ?? "") || (a.unit ?? "") !== (b.unit ?? "") || a.min !== b.min || a.max !== b.max || Boolean(a.provisional) !== Boolean(b.provisional);
}

// ------------------------------------------------------------------ report-only comparison

export interface Interval {
  min?: number;
  max?: number;
}

const NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * Reads a value text as an interval: "50 to 70", "50-70", "220 +/- 20", "<= 72", "NMT 72", "up to 72", ">= 15", "from 15" or a single
 * number. Anything else (words, TBD, a list) is not read: no comparison is then made. A trailing unit or remark is ignored here, because
 * the unit is held on its own and compared on its own.
 */
export function parseInterval(raw: string | undefined): Interval | undefined {
  if (!raw) return undefined;
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/±/g, "+/-")
    .replace(/[–—−]/g, "-");
  let m = new RegExp(`^(?:<=|<|nmt\\b|not more than|up to|max(?:imum)?\\b)\\s*${NUM}`).exec(t);
  if (m) return { max: Number(m[1]) };
  m = new RegExp(`^(?:>=|>|nlt\\b|not less than|from|min(?:imum)?\\b)\\s*${NUM}`).exec(t);
  if (m) return { min: Number(m[1]) };
  m = new RegExp(`^${NUM}\\s*(?:\\+/-)\\s*${NUM}`).exec(t);
  if (m) return { min: Number(m[1]) - Number(m[2]), max: Number(m[1]) + Number(m[2]) };
  m = new RegExp(`^${NUM}\\s*(?:to|-)\\s*${NUM}(?![\\d.])`).exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a <= b ? { min: a, max: b } : undefined;
  }
  m = new RegExp(`^${NUM}(?![\\d.])`).exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return undefined;
}

const normUnit = (u: string | undefined) => (u ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** True when both sides name the same unit, written the same way (no conversion is ever made; a different unit means no comparison). */
export const sameUnit = (a: string | undefined, b: string | undefined): boolean => normUnit(a) === normUnit(b);

export type Relation = "same" | "tighter" | "outside";

/** How the MBR interval sits against the TRD interval. An open end counts as unbounded. */
export function relate(mbr: Interval, trd: Interval): Relation {
  const lo = (v: Interval) => v.min ?? -Infinity;
  const hi = (v: Interval) => v.max ?? Infinity;
  if (lo(mbr) < lo(trd) || hi(mbr) > hi(trd)) return "outside";
  if (lo(mbr) > lo(trd) || hi(mbr) < hi(trd)) return "tighter";
  return "same";
}

export const NOTE_OUTSIDE = "Outside the TRD value (for information)";
export const NOTE_TIGHTER = "Tighter than the TRD";

/**
 * The report-only note of a parameter row, or nothing. Shown only when the row has an established TRD value, the MBR value and the TRD
 * value can both be read as numbers, and the two units are the same. Never shown for a study point (a challenge beyond a limit is not a
 * limit). The note is information: it blocks nothing and changes nothing.
 */
export function paramNote(row: MbrParamRow): string | undefined {
  if (row.studyPoint || !row.trd || row.trd.status !== "established") return undefined;
  const m = parseInterval(row.mbrValue);
  const t = row.trd.min !== undefined || row.trd.max !== undefined ? ({ ...(row.trd.min !== undefined ? { min: row.trd.min } : {}), ...(row.trd.max !== undefined ? { max: row.trd.max } : {}) } as Interval) : parseInterval(row.trd.text);
  if (!m || !t) return undefined;
  if (!sameUnit(row.mbrUnit, row.trd.unit)) return undefined;
  const r = relate(m, t);
  return r === "outside" ? NOTE_OUTSIDE : r === "tighter" ? NOTE_TIGHTER : undefined;
}

// ------------------------------------------------------------------ time limits

export interface TargetSum {
  /** Sum of the targets that carry a number, when they all share one unit. */
  sum?: number;
  unit?: string;
  /** One sentence, for information only. */
  text: string;
}

const numberOf = (v: string | undefined): number | undefined => {
  const i = parseInterval(v);
  return i && i.min !== undefined && i.min === i.max ? i.min : undefined;
};

/** The targets added up against the critical limit. Information only: the tool does not say whether the sum is acceptable. */
export function targetSum(limit: MbrTimeLimit): TargetSum {
  const crit = [limit.value, limit.unit].filter(Boolean).join(" ") || "not stated";
  if (limit.targets.length === 0) return { text: `No targets under the critical limit (${crit}).` };
  const given = limit.targets.filter((t) => numberOf(t.value) !== undefined);
  if (given.length === 0) return { text: `The targets have no numbers yet (critical limit ${crit}).` };
  const units = new Set(given.map((t) => normUnit(t.unit)));
  if (units.size > 1) return { text: `The targets use different units, so they are not added (critical limit ${crit}).` };
  const sum = given.reduce((a, t) => a + numberOf(t.value)!, 0);
  const unit = given[0]!.unit?.trim() || undefined;
  const rounded = Math.round(sum * 1000) / 1000;
  const shown = [String(rounded), unit].filter(Boolean).join(" ");
  const left = given.length < limit.targets.length ? ` (${limit.targets.length - given.length} target without a number not counted)` : "";
  const critNum = numberOf(limit.value);
  if (critNum !== undefined && sameUnit(limit.unit, unit)) {
    const rel = rounded === critNum ? "equal to" : rounded < critNum ? "below" : "above";
    return { sum: rounded, ...(unit ? { unit } : {}), text: `Targets add up to ${shown}${left}, ${rel} the critical limit of ${crit} (for information).` };
  }
  return { sum: rounded, ...(unit ? { unit } : {}), text: `Targets add up to ${shown}${left}; critical limit ${crit} (for information).` };
}
