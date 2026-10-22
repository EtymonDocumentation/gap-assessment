import { FILTER_TESTS, MIXING_POSITIONS, RETAIN_PURPOSES, type SamplingPoint, type SamplingType, type TypeDetail } from "@gap/process-model";
import { type PointGroup } from "./completeness.js";
import { FILTER_TEST_LABEL, METHOD_LABEL, REPORT_WHAT_LABEL, RESPONSIBLE_LABEL, TYPE_LABEL } from "./labels.js";

/*
 * Pure helpers behind the point editor's short form, wizard and "More details" groups.
 *
 * Why this exists: the full point editor listed every field of every study type and was, in the product owner's words, "so long and
 * confusing". The editor now shows (a) four fields to add a point, (b) only the chosen study type's own fields, and (c) the entries
 * every type has in small collapsible groups. Nothing here adds a requirement: the groups only SORT the open items checkPoint() already
 * reports, and the wizard only offers fields that are already part of a study type's completeness.
 */

export const GROUP_LABEL: Record<Exclude<PointGroup, "type">, string> = {
  sampling: "Sampling",
  testing: "Testing",
  acceptance: "Acceptance and rationale",
  reporting: "Reporting instructions",
  sources: "Sources and agency requests",
};

/** The title of the study-type group: the chosen type's own name, or a prompt when none is chosen yet. */
export const typeGroupLabel = (type: SamplingType | undefined): string => (type ? `${TYPE_LABEL[type]}: details` : "Study type");

/** "3 to fill" / "Nothing open", as text (never colour alone). */
export const toFillText = (n: number): string => (n === 0 ? "Nothing open" : `${n} to fill`);

// ------------------------------------------------------------------ the type's own field group

/** The `detail` group each study type keeps its own entries in. ipc, release and other have none. */
export const TYPE_DETAIL_KEY: Partial<Record<SamplingType, keyof TypeDetail>> = {
  ppq_enhanced: "enhanced",
  mixing_homogeneity: "mixing",
  hold_time: "hold",
  filter_study: "filter",
  stability: "stability",
  retain_reserve: "retain",
  characterization: "analyses",
  supporting_study: "analyses",
  regulatory_commitment: "commitment",
};

const hasValue = (v: unknown): boolean => {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(hasValue);
  if (typeof v === "object") return Object.values(v as object).some(hasValue);
  return true;
};

/**
 * Whether switching the point from its type to `to` would hide entries the person made. Two types that share a group
 * (characterization and supporting study) hide nothing. The entries are never deleted, only hidden: switching back shows them again.
 */
export function typeChangeHidesValues(point: Pick<SamplingPoint, "type" | "detail">, to: SamplingType | undefined): boolean {
  if (!point.type || point.type === to) return false;
  const key = TYPE_DETAIL_KEY[point.type];
  if (!key || (to && TYPE_DETAIL_KEY[to] === key)) return false;
  return hasValue(point.detail?.[key]);
}

// ------------------------------------------------------------------ one-line summaries of the groups

/** A short line of what is in a group now, shown on its closed header. Says "Nothing entered yet" rather than guessing. */
export function groupSummary(point: SamplingPoint, group: PointGroup): string {
  const parts: string[] = [];
  switch (group) {
    case "type":
      parts.push(point.type ? TYPE_LABEL[point.type] : "Not chosen yet");
      if (point.typeLabel?.trim()) parts.push(point.typeLabel.trim());
      break;
    case "sampling":
      if (point.responsible) parts.push(`${RESPONSIBLE_LABEL[point.responsible.party]} samples`);
      if (point.sampleSize.method) parts.push(METHOD_LABEL[point.sampleSize.method]);
      if (point.timing.options.length) parts.push(`${point.timing.options.length} timing ${point.timing.options.length === 1 ? "choice" : "choices"}`);
      if (point.locationsCount !== undefined) parts.push(`${point.locationsCount} ${point.locationsCount === 1 ? "location" : "locations"} per batch`);
      break;
    case "testing":
      if (point.attribute.trim()) parts.push(point.attribute.trim());
      if (point.testMethodRef?.trim()) parts.push(`method ${point.testMethodRef.trim()}`);
      if (point.destinationLab?.trim()) parts.push(`lab ${point.destinationLab.trim()}`);
      break;
    case "acceptance":
      if (point.acceptance?.kind === "criterion") parts.push(point.acceptance.text.trim() ? `Criterion: ${point.acceptance.text.trim()}` : "Criterion not written yet");
      else if (point.acceptance?.kind === "report_only") parts.push("Report only");
      if (point.rationale.trim()) parts.push("rationale given");
      break;
    case "reporting": {
      const what = point.reporting?.what ?? [];
      if (what.length) parts.push(`Reports ${what.map((w) => REPORT_WHAT_LABEL[w].toLowerCase()).join(", ")}`);
      break;
    }
    case "sources": {
      const s = point.sourceIds.length;
      const a = point.agencyRequestIds?.length ?? 0;
      if (s) parts.push(`${s} ${s === 1 ? "source" : "sources"}`);
      if (a) parts.push(`${a} agency ${a === 1 ? "request" : "requests"}`);
      break;
    }
  }
  return parts.length ? parts.join("; ") : "Nothing entered yet";
}

/** Which groups start open: only the first one that has something to fill (none when everything is filled). */
export function initialOpenGroups(byGroup: Record<PointGroup, string[]>, order: readonly PointGroup[]): PointGroup[] {
  const first = order.find((g) => byGroup[g].length > 0);
  return first ? [first] : [];
}

// ------------------------------------------------------------------ the wizard's key fields

export type WizardField =
  | { key: string; label: string; kind: "text"; path: string }
  | { key: string; label: string; kind: "select"; path: string; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: "step"; path: string }
  | { key: string; label: string; kind: "multi"; path: string; options: { value: string; label: string }[] };

const text = (path: string, label: string): WizardField => ({ key: path, label, kind: "text", path });

/**
 * The key fields of each study type for the wizard's fourth screen: the type's own completeness-relevant text and choice entries
 * (the ones checkPoint() would otherwise list as open). Lists such as time points or conditions stay in "More details"; the
 * wizard says so. `path` is "<detail group>.<field>" or a top-level point field. The wizard never preselects an answer.
 */
export const WIZARD_FIELDS: Record<SamplingType, WizardField[]> = {
  ipc: [],
  release: [],
  ppq_enhanced: [text("enhanced.interventions", "Interventions or stoppages covered")],
  mixing_homogeneity: [
    text("mixing.vesselRef", "Vessel or equipment"),
    text("mixing.parameters", "Mixing parameters (for example speed and time)"),
    { key: "mixing.positions", label: "Sampling positions", kind: "multi", path: "mixing.positions", options: MIXING_POSITIONS.map((p) => ({ value: p, label: p === "other" ? "Other" : p[0]!.toUpperCase() + p.slice(1) })) },
    text("mixing.criterionBasis", "Basis of the criterion (for example an RSD)"),
  ],
  hold_time: [
    { key: "hold.holdStep", label: "Step after which the material is held", kind: "step", path: "hold.holdStep" },
    text("hold.start", "Hold starts"),
    text("hold.end", "Hold ends"),
    text("hold.condition", "Temperature or condition"),
    text("hold.supports", "What the result supports (the proposed maximum hold)"),
  ],
  filter_study: [
    text("filter.filterRef", "Filter (identifier or type)"),
    { key: "filter.test", label: "Filter test", kind: "select", path: "filter.test", options: FILTER_TESTS.map((t) => ({ value: t, label: FILTER_TEST_LABEL[t] })) },
  ],
  stability: [text("stability.protocolRef", "Stability protocol reference")],
  retain_reserve: [
    { key: "retain.purpose", label: "Retain, reserve or both", kind: "select", path: "retain.purpose", options: RETAIN_PURPOSES.map((p) => ({ value: p, label: p === "both" ? "Retain and reserve" : p[0]!.toUpperCase() + p.slice(1) })) },
    text("retain.quantityBasis", "Basis of the quantity"),
    text("retain.retentionPeriod", "Retention period"),
    text("retain.storage", "Storage"),
    text("retain.requirementRef", "Requirement the quantity and period come from"),
  ],
  characterization: [text("analyses.informs", "What decision or report the result informs")],
  supporting_study: [text("analyses.informs", "What decision or report the result informs")],
  regulatory_commitment: [text("commitment.answer", "How this study answers the request")],
  other: [text("typeLabel", "What kind of sampling is this")],
};

/** What the wizard collected: blank entries are left out, so nothing is stored for a question the person skipped. */
export type WizardValues = Record<string, string | string[]>;

/** Turns the wizard's entries into the point fields to store (`typeLabel` and/or `detail`). Pure; the caller passes it to updatePoint. */
export function wizardPatch(type: SamplingType, values: WizardValues): { typeLabel?: string; detail?: TypeDetail } {
  const out: { typeLabel?: string; detail?: Record<string, Record<string, unknown>> } = {};
  for (const f of WIZARD_FIELDS[type]) {
    const v = values[f.key];
    const blank = v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === "");
    if (blank) continue;
    const value = Array.isArray(v) ? v : v.trim();
    const [head, field] = f.path.split(".") as [string, string | undefined];
    if (!field) {
      if (head === "typeLabel") out.typeLabel = value as string;
      continue;
    }
    out.detail ??= {};
    (out.detail[head] ??= {})[field] = value;
  }
  return out as { typeLabel?: string; detail?: TypeDetail };
}
