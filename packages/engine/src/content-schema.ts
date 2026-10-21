import { conditionSchema, optionSchema, type Catalog as ModelCatalog, type Condition, type Option } from "@gap/process-model";
import { z } from "zod";

/** The eight comparison categories (brief section 4). */
export const CATEGORIES = [
  "equivalent",
  "within_validated_range",
  "outside_validated_range",
  "different_principle",
  "scale_change",
  "new_requirement",
  "removed_element",
  "information_required",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["high", "medium", "low", "none"] as const;
// The condition language and option lists belong to the shared process model (they are part of its catalog). They are re-exported
// here so the rest of the engine, the content package and the web app keep importing them from one place.
export { conditionSchema, optionSchema };
export type { Condition, Option };

const versionString = z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver x.y.z");

// ---------------------------------------------------------------- catalog

/**
 * What only the gap assessment adds to the process-model catalog: the validation activities that gaps imply and the comparison
 * categories. It is a separate file (content/catalog/gap-overlay.yaml) so the shared catalog stays free of gap logic.
 */
export const catalogOverlaySchema = z.object({
  overlay: z.object({ id: z.string(), version: versionString }),
  activities: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string(),
      /** Keys of catalog study items (coll "study") that provide evidence for this activity. */
      studies: z.array(z.string()).optional(),
    }),
  ),
  categories: z.array(z.object({ key: z.enum(CATEGORIES), label: z.string(), description: z.string() })),
});
export type CatalogOverlay = z.infer<typeof catalogOverlaySchema>;

/** The catalog the gap engine works with: the shared process-model catalog plus the gap overlay's activities and categories. */
export type Catalog = ModelCatalog & Pick<CatalogOverlay, "activities" | "categories">;

// ---------------------------------------------------------------- questions

export const PARAMETER_FIELDS = ["classification", "setPoint", "nor", "par", "validatedRange", "rangeBasis"] as const;
export type ParameterField = (typeof PARAMETER_FIELDS)[number];

export const INPUT_TYPES = ["choice", "multi_choice", "yes_no", "text", "quantity", "range", "parameter"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const questionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  section: z.string(),
  parent: z.string().optional(),
  prompt: z.string().min(1),
  /** Short attribute name used in tables and the gap register. Defaults to the prompt. */
  label: z.string().optional(),
  /** "Why is this asked?" rationale, one or two sentences. */
  why: z.string().min(1),
  help: z.string().optional(),
  /** Shown on follow-up questions to say what triggered them. */
  triggerNote: z.string().optional(),
  sides: z.enum(["shared", "paired", "source", "target"]),
  binds: z.string(),
  input: z.object({
    type: z.enum(INPUT_TYPES),
    options: z.array(optionSchema).optional(),
    optionsFrom: z.string().optional(),
    dimension: z.string().optional(),
    units: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
    sourceFields: z.array(z.enum(PARAMETER_FIELDS)).optional(),
    targetFields: z.array(z.enum(PARAMETER_FIELDS)).optional(),
  }),
  /** Offer "Same as SU" on the RU side. Defaults to true for paired questions. */
  sameAsSource: z.boolean().optional(),
  /** Labels for the source and target sides when they differ from the prompt. */
  sideLabels: z.object({ source: z.string().optional(), target: z.string().optional() }).optional(),
  showWhen: conditionSchema.optional(),
  tags: z.array(z.string()).optional(),
  /** Tailoring topic key (see the unit operation's topics). Defaults to the item collection the question binds to. */
  topic: z.string().optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const sectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["scoping", "site", "uo"]),
  uo: z.string().optional(),
  order: z.number(),
  intro: z.string().optional(),
});
export type Section = z.infer<typeof sectionSchema>;

export const questionFileSchema = z.object({
  bank: z.object({ id: z.string(), version: versionString }).optional(),
  sections: z.array(sectionSchema).default([]),
  questions: z.array(questionSchema).default([]),
});

// ---------------------------------------------------------------- rules

export const COMPARATORS = [
  "range",
  "scale",
  "upper_limit",
  "lower_limit",
  "enum",
  "text",
  "presence",
  "set",
  "coverage",
  "evidence",
  "transition",
  "informational",
] as const;
export type ComparatorKind = (typeof COMPARATORS)[number];

const outcomeSchema = z.object({
  why: z.string().optional(),
  activities: z.array(z.string()).optional(),
  severity: z.enum(SEVERITIES).optional(),
  regulatory: z.boolean().optional(),
});
export type Outcome = z.infer<typeof outcomeSchema>;

/**
 * Transition comparator: the SU answer and the RU answer of a choice question are looked up in an ordered list. The first entry whose
 * `from` (SU) and `to` (RU) both match decides the category; a missing `from` or `to` matches any answer. `detail` replaces the generic
 * detail text, and the outcome fields (why, activities, severity, regulatory) apply to that entry only. When no entry matches, equal answers
 * are equivalent and different answers use `differentAs` (default: different principle).
 */
const transitionSchema = z.object({
  from: z.array(z.string()).min(1).optional(),
  to: z.array(z.string()).min(1).optional(),
  category: z.enum(CATEGORIES),
  detail: z.string().optional(),
  ...outcomeSchema.shape,
});
export type Transition = z.infer<typeof transitionSchema>;

export const ruleSchema = z.object({
  id: z.string().regex(/^R-[A-Z0-9-]+$/),
  version: versionString,
  title: z.string(),
  /** Side-less path globs; "*" matches one segment. First matching rule in file order wins. */
  match: z.array(z.string()).min(1),
  comparator: z.enum(COMPARATORS),
  config: z
    .object({
      /** Category used by enum/text comparators when values differ. */
      differentAs: z.enum(CATEGORIES).optional(),
      /** Evidence comparator: answer value -> category. */
      map: z.record(z.string(), z.enum(CATEGORIES)).optional(),
      /** Coverage comparator: the value checked against the covered range. */
      against: z.object({ side: z.enum(["source", "target"]), path: z.string() }).optional(),
      /** Coverage comparator: which side holds the coverage (study) entry. */
      coverageSide: z.enum(["source", "target"]).optional(),
      /** Transition comparator: ordered SU answer -> RU answer rules (see transitionSchema). */
      transitions: z.array(transitionSchema).optional(),
      /** Scale comparator: severity by magnitude of change (ratio >= atLeast, largest first). */
      ratioSeverity: z.array(z.object({ atLeast: z.number(), severity: z.enum(SEVERITIES) })).optional(),
    })
    .default({}),
  severity: z.enum(SEVERITIES),
  severityBy: z.object({ classification: z.record(z.string(), z.enum(SEVERITIES)) }).optional(),
  regulatory: z.boolean().default(false),
  why: z.string(),
  activities: z.array(z.string()).default([]),
  outcomes: z.partialRecord(z.enum(CATEGORIES), outcomeSchema).default({}),
});
export type Rule = z.infer<typeof ruleSchema>;

export const rulesFileSchema = z.object({
  ruleset: z.object({ id: z.string(), version: versionString }).optional(),
  rules: z.array(ruleSchema),
});

// ---------------------------------------------------------------- templates

export const templateSchema = z.object({
  templates: z.object({ id: z.string(), version: versionString }),
  document: z.object({
    title: z.string(),
    banner: z.string(),
    purpose: z.string(),
    scope: z.string(),
    sourceSummaryIntro: z.string(),
    targetSummaryIntro: z.string(),
    differencesIntro: z.string(),
    gapTableIntro: z.string(),
    gapDetailsIntro: z.string(),
    activitiesIntro: z.string(),
    equipmentQualificationIntro: z.string(),
    openItemsIntro: z.string(),
    riskIntro: z.string(),
    referencesIntro: z.string(),
    approvalIntro: z.string(),
    approvalRoles: z.array(z.string()).min(1),
    regulatoryStatement: z.string(),
    verificationStatement: z.string(),
    verificationStatusIntro: z.string(),
    identityStatement: z.string(),
    sourceRegisterIntro: z.string(),
    changeLogSummaryIntro: z.string(),
    changeLogReviewNote: z.string(),
  }),
});
export type Templates = z.infer<typeof templateSchema>;
