import type { Quantity, Range } from "./types";

/**
 * Unit table. Each unit converts to its dimension's base unit by
 * base = value * factor + offset. Only linear conversions are needed here.
 */
export interface UnitDef {
  symbol: string;
  label: string;
  dimension: string;
  factor: number;
  offset?: number;
}

const U = (symbol: string, label: string, dimension: string, factor: number, offset = 0): UnitDef => ({
  symbol,
  label,
  dimension,
  factor,
  offset,
});

export const UNITS: readonly UnitDef[] = [
  // volume (base mL)
  U("µL", "microlitre", "volume", 0.001),
  U("mL", "millilitre", "volume", 1),
  U("L", "litre", "volume", 1000),
  // mass (base g)
  U("mg", "milligram", "mass", 0.001),
  U("g", "gram", "mass", 1),
  U("kg", "kilogram", "mass", 1000),
  // temperature (base °C)
  U("°C", "degree Celsius", "temperature", 1),
  U("K", "kelvin", "temperature", 1, -273.15),
  // time (base s)
  U("s", "second", "time", 1),
  U("min", "minute", "time", 60),
  U("h", "hour", "time", 3600),
  U("d", "day", "time", 86400),
  // pressure (base bar)
  U("mbar", "millibar", "pressure", 0.001),
  U("bar", "bar", "pressure", 1),
  U("kPa", "kilopascal", "pressure", 0.01),
  U("psi", "pound per square inch", "pressure", 0.0689475729),
  // flow (base mL/min)
  U("mL/min", "millilitre per minute", "flow", 1),
  U("L/min", "litre per minute", "flow", 1000),
  U("L/h", "litre per hour", "flow", 1000 / 60),
  // rotational speed (base rpm)
  U("rpm", "revolutions per minute", "rotation", 1),
  // line speed (base units/min)
  U("units/min", "units per minute", "line_speed", 1),
  U("units/h", "units per hour", "line_speed", 1 / 60),
  // area (base cm²)
  U("cm²", "square centimetre", "area", 1),
  U("m²", "square metre", "area", 10000),
  // force (base N)
  U("N", "newton", "force", 1),
  U("lbf", "pound-force", "force", 4.4482216153),
  // bioburden (base CFU/100 mL)
  U("CFU/100 mL", "colony-forming units per 100 mL", "bioburden", 1),
  U("CFU/mL", "colony-forming units per mL", "bioburden", 100),
  // concentration (base g/L)
  U("g/L", "gram per litre", "concentration", 1),
  U("mg/mL", "milligram per millilitre", "concentration", 1),
  // dimensionless
  U("%", "percent", "percent", 1),
  U("count", "count", "count", 1),
];

const BY_SYMBOL = new Map(UNITS.map((u) => [u.symbol, u]));

export function unitDef(symbol: string): UnitDef | undefined {
  return BY_SYMBOL.get(symbol);
}

export function unitsForDimension(dimension: string): UnitDef[] {
  return UNITS.filter((u) => u.dimension === dimension);
}

export class UnitError extends Error {}

/** Converts a quantity to its dimension's base unit. Throws on an unknown unit. */
export function toBase(q: Quantity): { value: number; dimension: string } {
  const def = unitDef(q.unit);
  if (!def) throw new UnitError(`Unknown unit "${q.unit}"`);
  return { value: q.value * def.factor + (def.offset ?? 0), dimension: def.dimension };
}

export function convert(q: Quantity, toUnit: string): Quantity {
  const target = unitDef(toUnit);
  if (!target) throw new UnitError(`Unknown unit "${toUnit}"`);
  const base = toBase(q);
  if (base.dimension !== target.dimension) {
    throw new UnitError(`Cannot convert ${q.unit} (${base.dimension}) to ${toUnit} (${target.dimension})`);
  }
  return { value: (base.value - (target.offset ?? 0)) / target.factor, unit: toUnit };
}

const EPS = 1e-9;

/** Compares two quantities after unit conversion. Returns -1, 0 or 1. Throws if dimensions differ. */
export function compareQuantities(a: Quantity, b: Quantity): -1 | 0 | 1 {
  const x = toBase(a);
  const y = toBase(b);
  if (x.dimension !== y.dimension) {
    throw new UnitError(`Cannot compare ${a.unit} (${x.dimension}) with ${b.unit} (${y.dimension})`);
  }
  const scale = Math.max(1, Math.abs(x.value), Math.abs(y.value));
  const d = x.value - y.value;
  if (Math.abs(d) <= EPS * scale) return 0;
  return d < 0 ? -1 : 1;
}

export function quantitiesEqual(a: Quantity, b: Quantity): boolean {
  return compareQuantities(a, b) === 0;
}

export function rangesEqual(a: Range, b: Range): boolean {
  const boundEq = (x?: Quantity, y?: Quantity) => (x === undefined && y === undefined) || (!!x && !!y && quantitiesEqual(x, y));
  return boundEq(a.min, b.min) && boundEq(a.max, b.max);
}

/** True when inner lies entirely within outer (inclusive). Open bounds on outer are unbounded. */
export function rangeWithin(inner: Range, outer: Range): boolean {
  if (outer.min) {
    if (!inner.min || compareQuantities(inner.min, outer.min) < 0) return false;
  }
  if (outer.max) {
    if (!inner.max || compareQuantities(inner.max, outer.max) > 0) return false;
  }
  return true;
}

export function quantityWithin(q: Quantity, outer: Range): boolean {
  return rangeWithin({ min: q, max: q }, outer);
}

/** Ratio a/b after converting both to base units. */
export function quantityRatio(a: Quantity, b: Quantity): number {
  const x = toBase(a);
  const y = toBase(b);
  if (x.dimension !== y.dimension) throw new UnitError("Cannot take a ratio of different dimensions");
  return x.value / y.value;
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

export function formatQuantity(q: Quantity): string {
  return q.unit === "count" ? formatNumber(q.value) : `${formatNumber(q.value)} ${q.unit}`;
}

export function formatRange(r: Range): string {
  if (r.min && r.max) {
    if (r.min.unit === r.max.unit) {
      if (r.min.value === r.max.value) return formatQuantity(r.max);
      return `${formatNumber(r.min.value)}–${formatQuantity(r.max)}`;
    }
    return `${formatQuantity(r.min)} – ${formatQuantity(r.max)}`;
  }
  if (r.min) return `≥ ${formatQuantity(r.min)}`;
  if (r.max) return `≤ ${formatQuantity(r.max)}`;
  return "(no bounds)";
}
