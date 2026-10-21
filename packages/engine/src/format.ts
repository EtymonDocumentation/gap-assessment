import { formatQuantity, formatRange, resolveEntry, type EntryValue, type Project, type Resolved } from "@gap/process-model";
import { fieldLabel, optionLabel, parameterFields, type ContentBundle } from "./content";
import type { ParameterField, Question } from "./content-schema";
import { adaptText, sourceValidated } from "./stage";
import { isQuantity, isRange } from "./values";

export const STATUS_TEXT = {
  not_established: "Not established",
  unknown: "Unknown (to be confirmed)",
  not_applicable: "Not applicable",
} as const;

export function formatValue(content: ContentBundle, q: Question | undefined, v: EntryValue, optionSet?: string): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const label = (s: string) =>
    optionSet ? (content.catalog.optionSets[optionSet]?.find((o) => o.value === s)?.label ?? s) : optionLabel(content, q, s);
  if (typeof v === "string") return q?.input.type === "text" && !optionSet ? v : label(v);
  // An empty list can only come from a migrated answer (for example "only PUPSIT" after PUPSIT moved to its own question).
  if (Array.isArray(v)) return v.length ? v.map(label).join("; ") : "None selected";
  if (typeof v === "number") return String(v);
  if (isQuantity(v)) return formatQuantity(v);
  if (isRange(v)) return formatRange(v);
  return JSON.stringify(v);
}

export function formatResolved(content: ContentBundle, q: Question | undefined, r: Resolved, optionSet?: string): string {
  if (r.status === "established") {
    if (r.value === undefined) return STATUS_TEXT.not_established;
    const text = formatValue(content, q, r.value, optionSet);
    return r.sameAsSource ? `${text} (same as SU)` : text;
  }
  if (r.status === "not_applicable") return r.justification ? `Not applicable: ${r.justification}` : STATUS_TEXT.not_applicable;
  return r.sameAsSource && r.status === "unknown" ? `${STATUS_TEXT.unknown} (same as SU)` : STATUS_TEXT[r.status];
}

const FIELD_SHORT: Record<ParameterField, string> = {
  classification: "Class",
  setPoint: "SP",
  nor: "NOR",
  par: "PAR",
  validatedRange: "{{Validated range|Demonstrated range}}",
  rangeBasis: "Basis",
};

const FIELD_OPTION_SET: Partial<Record<ParameterField, string>> = { classification: "classification", rangeBasis: "rangeBasis" };

/** One-line display of a parameter question's fields on one side, e.g. "SP 25 rpm; NOR 20–30 rpm; PAR 15–35 rpm". */
export function formatParameter(content: ContentBundle, project: Project, q: Question, side: "source" | "target"): string {
  const parts: string[] = [];
  const validated = sourceValidated(project);
  for (const f of parameterFields(q, side)) {
    const r = resolveEntry(project, `${side}.${q.binds}.${f}`);
    parts.push(`${adaptText(FIELD_SHORT[f], validated)} ${formatResolved(content, q, r, FIELD_OPTION_SET[f])}`);
  }
  return parts.join("; ");
}

/** Display of everything a question holds on one side. */
export function formatQuestionSide(content: ContentBundle, project: Project, q: Question, side: "source" | "target" | "shared"): string {
  if (q.input.type === "parameter" && side !== "shared") return formatParameter(content, project, q, side);
  const ref = side === "shared" ? q.binds : `${side}.${q.binds}`;
  return formatResolved(content, q, resolveEntry(project, ref));
}

export function parameterFieldLabel(content: ContentBundle, f: ParameterField): string {
  return fieldLabel(content, f);
}

export function questionLabel(q: Question): string {
  return q.label ?? q.prompt;
}
