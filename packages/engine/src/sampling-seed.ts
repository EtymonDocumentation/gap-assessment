import { SAMPLING_TYPES, designLoadoutsSchema, type DesignLoadouts, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type Project, type SamplingPlan, type SamplingType } from "@gap/process-model";
import { z } from "zod";
import type { ContentBundle } from "./content";
import { buildValidationPlan } from "./validation";
import { buildTrdSeed } from "./trd-seed";

/**
 * Suggestions for the PPQ sampling plan. They are OFFERS, never entries: a suggestion becomes a point only when a person
 * accepts it, and then the point is incomplete (no timing, locations, method, acceptance or rationale are carried over).
 * GMP reasons:
 *  - The catalog (content/sampling/ppq-suggestions.yaml) is options only. Its schema is strict, so a size, a criterion or a method
 *    in the file is refused when the content loads: the tool must never suggest the answer.
 *  - Everything project-specific is read from the receiving unit (RU) data through the TRD seed builder, which already leaves out
 *    process steps that are out of scope and topics that were tailored out. A suggestion for such a step would be noise at best and
 *    a wrong commitment at worst.
 */

export const PPQ_SUGGESTIONS_ID = "ppq-suggestions";

const candidate = z.strictObject({
  uo: z.string().min(1),
  key: z.string().regex(/^[a-z0-9_]+$/),
  attribute: z.string().min(1),
  type: z.enum(SAMPLING_TYPES),
  materialType: z.string().optional(),
  why: z.string().min(1),
});

export const samplingSuggestionsSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(PPQ_SUGGESTIONS_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  candidates: z.array(candidate).min(1),
  activityCandidates: z.array(candidate.extend({ activity: z.string().min(1) })),
});
export type SamplingSuggestions = z.infer<typeof samplingSuggestionsSchema>;
export type SuggestionCandidate = z.infer<typeof candidate>;

/** Validates the raw YAML. Throws a readable message; also checks keys are unique and that every unit-operation key exists. */
export function parseSamplingSuggestions(raw: unknown, knownUnitOps: readonly string[] = []): SamplingSuggestions {
  const r = samplingSuggestionsSchema.safeParse(raw);
  if (!r.success) {
    throw new Error(`PPQ suggestions are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  }
  const seen = new Set<string>();
  for (const c of [...r.data.candidates, ...r.data.activityCandidates]) {
    if (seen.has(c.key)) throw new Error(`PPQ suggestions are invalid: duplicate key ${c.key}`);
    seen.add(c.key);
    if (knownUnitOps.length && ![...knownUnitOps, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE].includes(c.uo)) {
      throw new Error(`PPQ suggestions are invalid: ${c.key} names an unknown unit operation (${c.uo})`);
    }
  }
  return r.data;
}

/** Validates the design load-outs (content/sampling/design-loadouts.yaml). Strict, so a stray key or an unknown range kind stops the build. */
export function parseDesignLoadouts(raw: unknown): DesignLoadouts {
  const r = designLoadoutsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Design load-outs are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  const ids = r.data.loadouts.map((l) => l.id);
  if (new Set(ids).size !== ids.length) throw new Error("Design load-outs are invalid: duplicate id");
  return r.data;
}

export type SuggestionSource = "catalog" | "ipc" | "cpp" | "activity";

export interface PointSuggestion {
  /** Stable id, also stored in the point's origin (suggestionKey) so an accepted suggestion is shown as added. */
  id: string;
  source: SuggestionSource;
  /** Unit-operation key, "finished_product" or "none". */
  uo: string;
  uoLabel: string;
  attribute: string;
  type: SamplingType;
  materialType?: string;
  /** Why this is offered, in words ("In-process control of this step in the RU data."). */
  why: string;
  itemPath?: string;
  gapIds: string[];
  validationActivity?: string;
  /** A point from this suggestion is already in the plan. */
  added: boolean;
}

export const SUGGESTION_SOURCE_LABEL: Record<SuggestionSource, string> = {
  catalog: "Common PPQ candidate",
  ipc: "In-process control in the RU data",
  cpp: "Critical process parameter in the RU data",
  activity: "Follows a validation activity",
};

/**
 * Suggestions for a plan, from the project and the catalog, in unit-operation order and (inside one) IPC items, CPP parameters,
 * catalog candidates, then activity candidates. Pure: the same inputs give the same list. With `plan`, suggestions already
 * accepted are marked `added` (they stay listed so the list does not jump around).
 */
export function suggestPoints(content: ContentBundle, project: Project, library: SamplingSuggestions, plan?: SamplingPlan): PointSuggestion[] {
  const seed = buildTrdSeed(content, project, { exportedAt: "1970-01-01T00:00:00.000Z" });
  const included = new Map(seed.scope.included.map((u) => [u.key, u]));
  const order = (uo: string): number => included.get(uo)?.sequence ?? content.catalog.unitOperations.find((u) => u.key === uo)?.sequence ?? (uo === UNIT_OP_FINISHED_PRODUCT ? 9000 : 9100);
  const labelOf = (uo: string): string => (uo === UNIT_OP_FINISHED_PRODUCT ? "Finished product" : uo === UNIT_OP_NONE ? "Supporting work (no single step)" : (included.get(uo)?.label ?? content.catalog.unitOperations.find((u) => u.key === uo)?.label ?? uo));
  const live = (uo: string): boolean => uo === UNIT_OP_FINISHED_PRODUCT || uo === UNIT_OP_NONE || included.has(uo) || (plan?.steps.some((s) => s.unitOp === uo) ?? false);
  const done = new Set((plan?.points ?? []).flatMap((p) => (p.origin.kind === "seeded" && p.origin.suggestionKey ? [p.origin.suggestionKey] : [])));
  // With a plan, only suggestions for the plan's own process steps are offered, plus the ones that belong to no single step
  // (finished product, supporting work). The rest are hidden, not deleted: add the step and they come back. Without a plan
  // (the demo replay, tests of the catalog) the list is the whole project scope, as before.
  const planOps = plan ? new Set(plan.steps.flatMap((s) => (s.unitOp ? [s.unitOp] : []))) : undefined;
  const wanted = (uo: string): boolean => !planOps || uo === UNIT_OP_FINISHED_PRODUCT || uo === UNIT_OP_NONE || planOps.has(uo);
  // The plan's steps are its own scope, so a catalog candidate of a plan step is offered even if the gap Scope left that step out.
  const out: PointSuggestion[] = [];
  const add = (s: Omit<PointSuggestion, "added" | "uoLabel">) => {
    if (wanted(s.uo)) out.push({ ...s, uoLabel: labelOf(s.uo), added: done.has(s.id) });
  };

  // RU data: every IPC item and every CPP parameter of a step that is in scope. The seed has already dropped tailored-out topics.
  for (const uo of seed.unitOperations) {
    for (const item of uo.items) {
      const itemPath = `uo.${uo.key}.${item.collection}.${item.key}`;
      const gapIds = [...new Set(item.fields.flatMap((f) => f.reference?.gapIds ?? []))].sort();
      if (item.collection === "ipc") {
        add({ id: `ipc:${itemPath}`, source: "ipc", uo: uo.key, attribute: item.label, type: "ipc", why: "An in-process control of this step in the RU data. Say how it is sampled during PPQ.", itemPath, gapIds });
      } else if (item.collection === "param" && item.classification === "CPP") {
        add({ id: `cpp:${itemPath}`, source: "cpp", uo: uo.key, attribute: `Verify the effect of ${item.label}`, type: "ppq_enhanced", why: "A critical process parameter in the RU data. PPQ often samples to show the process stays in control around it.", itemPath, gapIds });
      }
    }
  }

  // Catalog candidates of steps that are in scope. A step left out, or not applicable, gets none.
  for (const c of library.candidates) {
    if (!live(c.uo)) continue;
    add({ id: `cat:${c.key}`, source: "catalog", uo: c.uo, attribute: c.attribute, type: c.type, ...(c.materialType ? { materialType: c.materialType } : {}), why: c.why, gapIds: [] });
  }

  // Candidates that follow a validation activity a gap implies (the activities the Validation plan page lists).
  const rows = new Map(buildValidationPlan(content, project).map((r) => [r.activityKey, r]));
  for (const c of library.activityCandidates) {
    const row = rows.get(c.activity);
    if (!row || !live(c.uo)) continue;
    add({
      id: `act:${c.activity}:${c.key}`,
      source: "activity",
      uo: c.uo,
      attribute: c.attribute,
      type: c.type,
      ...(c.materialType ? { materialType: c.materialType } : {}),
      why: c.why,
      gapIds: row.gaps.map((g) => g.displayId).sort(),
      validationActivity: c.activity,
    });
  }

  const rank: Record<SuggestionSource, number> = { ipc: 0, cpp: 1, catalog: 2, activity: 3 };
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => order(a.s.uo) - order(b.s.uo) || rank[a.s.source] - rank[b.s.source] || a.i - b.i)
    .map((x) => x.s);
}
