import type { DesignLoadout, MixingDesignData, MixingRun, RunParameter, SamplingPoint } from "@gap/process-model";
import { RANGE_KIND_LABEL, RUN_TAG_LABEL, WORST_CASE_LABEL } from "./labels.js";

/**
 * The optional study design of a mixing / homogeneity point, in words and as a run table. The plan and the reporting instructions
 * both print it, so they cannot disagree. Nothing here is required or checked: the design is the team's, and a point without
 * one prints nothing. A part that is missing inside a run reads "not given".
 */

const NOT_GIVEN = "not given";

/** "120 L (maximum)", "not given" or "120 (unit not given)". */
export function parameterText(p: RunParameter | undefined): string {
  if (!p || (p.value === undefined && !p.unit?.trim() && !p.tag)) return NOT_GIVEN;
  const value = p.value === undefined ? NOT_GIVEN : `${p.value}${p.unit?.trim() ? ` ${p.unit.trim()}` : " (unit not given)"}`;
  return `${value}${p.tag ? ` (${RUN_TAG_LABEL[p.tag].toLowerCase()})` : ""}`;
}

export interface MixingDesignText {
  /** The free approach label, or undefined. */
  approach?: string;
  /** The run table; undefined when there are no runs. */
  matrix?: { columns: string[]; rows: string[][] };
  /** One line per range row, e.g. "Range for batch size (PAR): ...". Empty when none. */
  rangeLines: string[];
}

export const runChallenges = (r: MixingRun): string => (r.challenges ?? []).map((w) => (w === "other" ? r.challengesOther?.trim() || WORST_CASE_LABEL.other : WORST_CASE_LABEL[w])).join(", ");

/** True when the design holds anything worth printing. */
export function hasDesign(d: MixingDesignData | undefined): boolean {
  return !!d && (!!d.approach?.trim() || !!d.runs?.length || !!d.rangeSupport?.length);
}

export function mixingDesign(point: Pick<SamplingPoint, "detail">): MixingDesignText {
  const d = point.detail?.mixing?.design;
  const out: MixingDesignText = { rangeLines: [] };
  if (!d) return out;
  if (d.approach?.trim()) out.approach = d.approach.trim();
  if (d.runs?.length) {
    out.matrix = {
      columns: ["Run", "Batch size", "Mixing speed", "Mix time", "Challenges", "Attributes tested", "Rationale"],
      rows: d.runs.map((r) => [r.label.trim() || NOT_GIVEN, parameterText(r.batchSize), parameterText(r.speed), parameterText(r.mixTime), runChallenges(r) || NOT_GIVEN, r.attributes?.trim() || NOT_GIVEN, r.rationale?.trim() || NOT_GIVEN]),
    };
  }
  for (const r of d.rangeSupport ?? []) {
    const kind = r.rangeKind && r.rangeKind !== "unset" ? ` (${RANGE_KIND_LABEL[r.rangeKind]})` : "";
    out.rangeLines.push(`Range for ${r.parameter.trim() || "a parameter"}${kind}: ${r.text?.trim() || NOT_GIVEN}`);
  }
  return out;
}

/** How applying a load-out meets runs that are already there. */
export type LoadoutMode = "replace" | "append";

/**
 * The design after applying a load-out. Pure: it returns a new object and never touches the input. "replace" drops what was there
 * (the caller asks first and the change log keeps the old design); "append" adds the load-out's runs and range rows after the existing ones.
 * The approach label is kept when the person already wrote one, so applying never overwrites their wording.
 */
export function applyLoadout(current: MixingDesignData | undefined, loadout: DesignLoadout, mode: LoadoutMode): MixingDesignData {
  const add = structuredClone(loadout.design);
  if (mode === "replace" || !current) return add;
  const out: MixingDesignData = structuredClone(current);
  if (!out.approach?.trim() && add.approach) out.approach = add.approach;
  if (add.runs?.length) out.runs = [...(out.runs ?? []), ...add.runs];
  if (add.rangeSupport?.length) out.rangeSupport = [...(out.rangeSupport ?? []), ...add.rangeSupport];
  return out;
}
