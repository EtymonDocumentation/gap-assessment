import { failureModeSuggestionsSchema, riskLoadoutsSchema, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE, type Actor, type FailureModeSuggestion, type FailureModeSuggestions, type Project, type RiskAssessment, type RiskLoadouts } from "@gap/process-model";
import { configProblems } from "@gap/risk";
import { assess } from "./compare";
import type { ContentBundle } from "./content";
import { addItem, RiskError } from "./risk";

/**
 * Where the items of a risk assessment can come from. All of it is an OFFER: nothing becomes an item until a person ticks it, and
 * then the item is a draft with no score (it shows as an open item until the person scores it).
 *
 *  - From the gap assessment: the gap's attribute and the SU / RU values are copied as REFERENCE TEXT into the item's notes. The
 *    gap severity is shown next to the offer and never copied: a gap severity and a risk score answer different questions, and
 *    copying one into the other would hide the person's own risk judgement (ICH Q9(R1): the assessment is the team's, not the tool's).
 *  - From the failure-mode catalog (content/risk/failure-modes.yaml): typical failure modes per unit operation, general GMP
 *    knowledge with a rationale. They carry no score and no judgement of how likely or severe they are.
 */

/** Validates the method load-outs (content/risk/method-loadouts.yaml). Strict, so a stray key or an invalid method stops the build. */
export function parseRiskLoadouts(raw: unknown): RiskLoadouts {
  const r = riskLoadoutsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Risk method load-outs are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  const ids = r.data.loadouts.map((l) => l.id);
  if (new Set(ids).size !== ids.length) throw new Error("Risk method load-outs are invalid: duplicate id");
  for (const l of r.data.loadouts) {
    // A load-out is a starting shape the person edits, so a half-finished one would hand over problems on the first click.
    const problems = configProblems(l.config).filter((p) => !/matrix cells have no risk label/.test(p));
    if (problems.length) throw new Error(`Risk method load-outs are invalid: ${l.id}: ${problems.join("; ")}`);
  }
  return r.data;
}

/** Validates the failure-mode catalog. Checks keys are unique, unit operations exist and guidance references exist. */
export function parseFailureModes(raw: unknown, knownUnitOps: readonly string[] = [], knownGuidance: readonly string[] = []): FailureModeSuggestions {
  const r = failureModeSuggestionsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Failure-mode suggestions are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  const seen = new Set<string>();
  for (const s of r.data.suggestions) {
    if (seen.has(s.key)) throw new Error(`Failure-mode suggestions are invalid: duplicate key ${s.key}`);
    seen.add(s.key);
    if (knownUnitOps.length && ![...knownUnitOps, UNIT_OP_FINISHED_PRODUCT, UNIT_OP_NONE].includes(s.unitOp)) throw new Error(`Failure-mode suggestions are invalid: ${s.key} names an unknown unit operation (${s.unitOp})`);
    if (s.guidanceRef && knownGuidance.length && !knownGuidance.includes(s.guidanceRef)) throw new Error(`Failure-mode suggestions are invalid: ${s.key} cites an unknown guidance entry (${s.guidanceRef})`);
  }
  return r.data;
}

// ------------------------------------------------------------------ from gaps

export interface GapSeed {
  /** Display id, e.g. G-003: what an item stores in `gapIds`. */
  gapId: string;
  attribute: string;
  sectionTitle: string;
  uoKey?: string;
  /** The assessment step that matches the gap's process step, if the assessment has one. */
  stepId?: string;
  su: string;
  ru: string;
  /** The gap's severity, shown as REFERENCE text next to the offer. Never copied into a risk score. */
  severity: string;
  /** Items already linked to this gap. */
  itemIds: string[];
}

/** The project's gaps (differences, not equivalent pairs) as offers for the assessment, in document order. */
export function gapSeeds(content: ContentBundle, project: Project, a: RiskAssessment): GapSeed[] {
  return assess(content, project)
    .gaps.filter((g) => g.displayId.startsWith("G-"))
    .map((g) => ({
      gapId: g.displayId,
      attribute: g.attribute,
      sectionTitle: g.sectionTitle,
      ...(g.uoKey ? { uoKey: g.uoKey } : {}),
      ...(g.uoKey && a.steps.find((s) => s.unitOp === g.uoKey) ? { stepId: a.steps.find((s) => s.unitOp === g.uoKey)!.id } : {}),
      su: g.sourceDisplay,
      ru: g.targetDisplay,
      severity: g.severity,
      itemIds: a.items.filter((i) => i.gapIds.includes(g.displayId)).map((i) => i.id),
    }));
}

/** Adds a draft item from a gap. The gap text goes into the notes as reference; the failure mode, effect and score stay empty for the team. */
export function addItemFromGap(project: Project, assessmentId: string, seed: GapSeed, actor: Actor): { project: Project; itemId: string } {
  const a = project.risk.assessments.find((x) => x.id === assessmentId);
  if (!a) throw new RiskError(`Risk assessment ${assessmentId} does not exist`);
  const existing = a.items.find((i) => i.origin?.kind === "gap" && i.gapIds.includes(seed.gapId));
  if (existing) throw new RiskError(`Item ${existing.id} was already added from gap ${seed.gapId}`);
  return addItem(
    project,
    assessmentId,
    {
      ...(seed.stepId ? { stepId: seed.stepId } : {}),
      gapIds: [seed.gapId],
      notes: `From gap ${seed.gapId}: ${seed.attribute}. SU: ${seed.su}. RU: ${seed.ru}.`,
      origin: { kind: "gap" },
    },
    actor,
  );
}

// ------------------------------------------------------------------ from the failure-mode catalog

export interface FailureModeOffer extends FailureModeSuggestion {
  uoLabel: string;
  /** The assessment step this belongs to. */
  stepId: string;
  /** An item from this suggestion is already in the assessment. */
  added: boolean;
}

/** Catalog suggestions for the assessment's OWN steps, in step order. A suggestion for a step the assessment does not have is not offered (add the step and it comes back). */
export function suggestFailureModes(library: FailureModeSuggestions, a: RiskAssessment): FailureModeOffer[] {
  const done = new Set(a.items.flatMap((i) => (i.origin?.kind === "catalog" && i.origin.suggestionKey ? [i.origin.suggestionKey] : [])));
  return a.steps.flatMap((step) =>
    library.suggestions
      .filter((s) => s.unitOp === step.unitOp)
      .map((s) => ({ ...s, uoLabel: step.label, stepId: step.id, added: done.has(s.key) })),
  );
}

/** Adds an item from a catalog suggestion: the failure mode, effect, causes and controls are the catalog's wording for the team to edit; the score stays empty. */
export function addItemFromSuggestion(project: Project, assessmentId: string, offer: FailureModeOffer, catalogVersion: string, actor: Actor): { project: Project; itemId: string } {
  const a = project.risk.assessments.find((x) => x.id === assessmentId);
  if (!a) throw new RiskError(`Risk assessment ${assessmentId} does not exist`);
  const existing = a.items.find((i) => i.origin?.kind === "catalog" && i.origin.suggestionKey === offer.key);
  if (existing) throw new RiskError(`Item ${existing.id} was already added from this suggestion`);
  return addItem(
    project,
    assessmentId,
    {
      stepId: offer.stepId,
      failureMode: offer.failureMode,
      effect: offer.effect,
      causes: offer.causes,
      ...(offer.controlsPrevention ? { controlsPrevention: offer.controlsPrevention } : {}),
      ...(offer.controlsDetection ? { controlsDetection: offer.controlsDetection } : {}),
      origin: { kind: "catalog", suggestionKey: offer.key, catalogVersion },
    },
    actor,
  );
}
