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

const quantity = z.object({ value: z.number(), unit: z.string() });
const literal = z.union([z.string(), z.number(), z.boolean()]);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { eq: [string, string | number | boolean] }
  | { in: [string, (string | number | boolean)[]] }
  | { includes: [string, string] }
  | { answered: string }
  | { isUnknown: string }
  | { isTrue: string }
  | { uoPresent: string }
  | { changed: string }
  | { increased: string }
  | { decreased: string }
  | { ratioAbove: [string, number] }
  | { gt: [string, string | number | { value: number; unit: string }] }
  | { gte: [string, string | number | { value: number; unit: string }] }
  | { lt: [string, string | number | { value: number; unit: string }] }
  | { lte: [string, string | number | { value: number; unit: string }] };

const cmpOperand = z.union([z.string(), z.number(), quantity]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({ eq: z.tuple([z.string(), literal]) }).strict(),
    z.object({ in: z.tuple([z.string(), z.array(literal).min(1)]) }).strict(),
    z.object({ includes: z.tuple([z.string(), z.string()]) }).strict(),
    z.object({ answered: z.string() }).strict(),
    z.object({ isUnknown: z.string() }).strict(),
    z.object({ isTrue: z.string() }).strict(),
    z.object({ uoPresent: z.string() }).strict(),
    z.object({ changed: z.string() }).strict(),
    z.object({ increased: z.string() }).strict(),
    z.object({ decreased: z.string() }).strict(),
    z.object({ ratioAbove: z.tuple([z.string(), z.number()]) }).strict(),
    z.object({ gt: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ gte: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ lt: z.tuple([z.string(), cmpOperand]) }).strict(),
    z.object({ lte: z.tuple([z.string(), cmpOperand]) }).strict(),
  ]),
) as z.ZodType<Condition>;

export const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type Option = z.infer<typeof optionSchema>;

const versionString = z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver x.y.z");

// ---------------------------------------------------------------- catalog

export const catalogSchema = z.object({
  catalog: z.object({ id: z.string(), version: versionString }),
  unitOperations: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      sequence: z.number(),
      description: z.string(),
      /** First milestone in which the unit operation has questions. */
      milestone: z.number().int(),
      applicableWhen: conditionSchema.optional(),
      items: z
        .array(
          z.object({
            coll: z.enum(["param", "equip", "mat", "ipc", "study", "doc"]),
            key: z.string(),
            label: z.string(),
          }),
        )
        .default([]),
    }),
  ),
  fieldLabels: z.record(z.string(), z.string()),
  optionSets: z.record(z.string(), z.array(optionSchema).min(1)),
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
export type Catalog = z.infer<typeof catalogSchema>;

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
    revisionHistoryIntro: z.string(),
    revisionStatement: z.string(),
    reviewerCommentsIntro: z.string(),
  }),
});
export type Templates = z.infer<typeof templateSchema>;
