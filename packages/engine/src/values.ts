import {
  compareQuantities,
  quantitiesEqual,
  rangesEqual,
  type EntryValue,
  type Quantity,
  type Range,
} from "@gap/process-model";

export function isQuantity(v: unknown): v is Quantity {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "value" in v && "unit" in v;
}

export function isRange(v: unknown): v is Range {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !("value" in v) && ("min" in v || "max" in v);
}

export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Value equality with unit conversion; arrays compare as sets; text ignores case and spacing. */
export function valuesEqual(a: EntryValue | undefined, b: EntryValue | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  try {
    if (isQuantity(a) && isQuantity(b)) return quantitiesEqual(a, b);
    if (isRange(a) && isRange(b)) return rangesEqual(a, b);
  } catch {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const sa = new Set(a);
    const sb = new Set(b);
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
  }
  if (typeof a === "string" && typeof b === "string") return normalizeText(a) === normalizeText(b);
  return a === b;
}

/** A representative quantity for magnitude comparisons: the quantity itself, or a range's maximum. */
export function magnitudeOf(v: EntryValue | undefined): Quantity | undefined {
  if (isQuantity(v)) return v;
  if (isRange(v)) return v.max ?? v.min;
  return undefined;
}

/** Compares two values numerically. Returns undefined when not comparable. */
export function compareMagnitude(a: EntryValue | number | undefined, b: EntryValue | number | undefined): number | undefined {
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  const qa = typeof a === "number" ? undefined : magnitudeOf(a);
  const qb = typeof b === "number" ? undefined : magnitudeOf(b);
  if (!qa || !qb) return undefined;
  try {
    return compareQuantities(qa, qb);
  } catch {
    return undefined;
  }
}
