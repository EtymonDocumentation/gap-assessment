import { printableUnit, type TrdLimits, type TrdRange, type TrdSetPoint } from "@gap/process-model";

/**
 * Report-only check of the numbers a person entered for a parameter: set point, normal operating range (NOR) and proven
 * acceptable range (PAR). It REPORTS and never blocks: the TRD is the user's document, and a NOR that sits outside a PAR may
 * be a typing slip or a real finding; only a reviewer can tell. The wording is therefore factual ("NOR max 25 °C is above
 * PAR max 24 °C") and nothing is called unacceptable.
 *
 * Rules behind the choices:
 *  - Units are never converted. When two numbers carry different units the check says "cannot compare: units differ (x vs y)"
 *    and goes no further for that pair; a silent conversion could hide a unit mix-up the reviewer must see.
 *  - A missing citation is an OPEN ITEM, not an error: PAR and NOR come from documents (a PPQ summary report, development
 *    reports ...) and the person may not have them to hand yet.
 *  - A range copied from a TBD best guess is labelled provisional wherever it is used.
 *  - Nothing here decides a regulatory filing category.
 */

export type LimitFindingKind = "range_order" | "nor_outside_par" | "set_point_outside_nor" | "set_point_outside_par" | "units_differ" | "no_source" | "provisional";

export interface LimitFinding {
  kind: LimitFindingKind;
  /** "problem" = the numbers disagree or cannot be compared; "open" = information is missing; "note" = a label the reader should know. */
  level: "problem" | "open" | "note";
  text: string;
}

export interface LimitCheck {
  findings: LimitFinding[];
  /** The comparisons made, in words, so a reviewer can follow the check. */
  working: string[];
}

// "count" is never printed as a unit (see printableUnit); the other units follow the number.
const withUnit = (n: number, unit: string | undefined) => (printableUnit(unit) ? `${n} ${printableUnit(unit)}` : String(n));
const unitText = (u: string | undefined) => (u && u.trim() ? u.trim() : "no unit stated");
const same = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim();

/** Checks one parameter's set point, NOR and PAR. A parameter with nothing entered has no findings. */
export function checkLimits(limits: TrdLimits | undefined): LimitCheck {
  const findings: LimitFinding[] = [];
  const working: string[] = [];
  if (!limits) return { findings, working };
  const { setPoint, nor, par } = limits;
  const add = (kind: LimitFindingKind, level: LimitFinding["level"], text: string) => findings.push({ kind, level, text });

  for (const [name, r] of [["NOR", nor], ["PAR", par]] as const) {
    if (!r) continue;
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) {
      add("range_order", "problem", `${name} minimum ${withUnit(r.min, r.unit)} is above its maximum ${withUnit(r.max, r.unit)}`);
    }
    if (r.sourceIds.length === 0) add("no_source", "open", `${name} has no source cited`);
    if (r.provisional) add("provisional", "note", `${name} was copied from a provisional (TBD best guess) project value`);
  }
  if (setPoint) {
    if (setPoint.sourceIds.length === 0) add("no_source", "open", "Set point has no source cited");
    if (setPoint.provisional) add("provisional", "note", "Set point was copied from a provisional (TBD best guess) project value");
  }

  // NOR inside PAR, end by end. Only the ends both ranges state can be compared.
  if (nor && par) {
    if (!same(nor.unit, par.unit)) {
      add("units_differ", "problem", `NOR and PAR: cannot compare: units differ (${unitText(nor.unit)} vs ${unitText(par.unit)})`);
    } else {
      if (nor.min !== undefined && par.min !== undefined) {
        working.push(`NOR min ${withUnit(nor.min, nor.unit)} against PAR min ${withUnit(par.min, par.unit)}`);
        if (nor.min < par.min) add("nor_outside_par", "problem", `NOR min ${withUnit(nor.min, nor.unit)} is below PAR min ${withUnit(par.min, par.unit)}`);
      }
      if (nor.max !== undefined && par.max !== undefined) {
        working.push(`NOR max ${withUnit(nor.max, nor.unit)} against PAR max ${withUnit(par.max, par.unit)}`);
        if (nor.max > par.max) add("nor_outside_par", "problem", `NOR max ${withUnit(nor.max, nor.unit)} is above PAR max ${withUnit(par.max, par.unit)}`);
      }
    }
  }

  // Set point against the NOR; against the PAR only when there is no NOR.
  if (setPoint) {
    const against: { name: "NOR" | "PAR"; r: TrdRange } | undefined = nor ? { name: "NOR", r: nor } : par ? { name: "PAR", r: par } : undefined;
    if (against) {
      const { name, r } = against;
      if (!same(setPoint.unit, r.unit)) {
        add("units_differ", "problem", `Set point and ${name}: cannot compare: units differ (${unitText(setPoint.unit)} vs ${unitText(r.unit)})`);
      } else {
        working.push(`Set point ${withUnit(setPoint.value, setPoint.unit)} against ${name}${r.min !== undefined ? ` min ${withUnit(r.min, r.unit)}` : ""}${r.max !== undefined ? ` max ${withUnit(r.max, r.unit)}` : ""}`);
        const kind = name === "NOR" ? "set_point_outside_nor" : "set_point_outside_par";
        if (r.min !== undefined && setPoint.value < r.min) add(kind, "problem", `Set point ${withUnit(setPoint.value, setPoint.unit)} is below ${name} min ${withUnit(r.min, r.unit)}`);
        if (r.max !== undefined && setPoint.value > r.max) add(kind, "problem", `Set point ${withUnit(setPoint.value, setPoint.unit)} is above ${name} max ${withUnit(r.max, r.unit)}`);
      }
    }
  }
  return { findings, working };
}

/** A range as one line of words ("15 to 25 °C", "up to 25 °C", "from 15 °C"). Empty text for no range. */
export function rangeText(r: TrdRange | undefined): string {
  if (!r) return "";
  const u = printableUnit(r.unit) ? ` ${printableUnit(r.unit)}` : "";
  const base = r.min !== undefined && r.max !== undefined ? `${r.min} to ${r.max}${u}` : r.max !== undefined ? `up to ${r.max}${u}` : r.min !== undefined ? `from ${r.min}${u}` : "";
  return r.provisional ? `${base} (provisional)` : base;
}

export function setPointText(s: TrdSetPoint | undefined): string {
  if (!s) return "";
  const base = withUnit(s.value, s.unit);
  return s.provisional ? `${base} (provisional)` : base;
}
