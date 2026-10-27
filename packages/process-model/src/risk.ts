import { z } from "zod";
import { planStepSchema } from "./sampling";

/*
 * Risk assessment shapes (project schema 1.14.0; the PDA TR 44 layout, review triggers and intervention scoring from schema 1.24.0).
 * Framework: ICH Q9(R1) quality risk management.
 *
 * Design notes (the why):
 *  - THE TOOL SUPPORTS THE USER'S METHOD, IT NEVER IMPOSES ONE. There is no default method, scale, band or matrix anywhere in these
 *    shapes: an assessment starts with no method at all, and every number below is something a person (or a load-out the person
 *    picked and may edit) put there. A "load-out" is a preset that is COPIED into the assessment; afterwards the assessment owns it.
 *  - ONE METHOD PER ASSESSMENT. Mixing methods in one register makes the scores incomparable, so the method is chosen once and the
 *    item scores all use it.
 *  - FLAT ON PURPOSE. An item score is `values` (factor key -> whole number) plus optional `level` and `reason`, and bands, matrix
 *    cells and actions are plain arrays of plain records. A later CSV export can then write one row per item or per action without
 *    walking a nested structure.
 *  - Nothing here judges acceptability. A band label and its note are the user's words, shown back as written.
 */

/** Version of the risk assessment format (shapes, method configs, output). Independent of the project schema version. */
export const RISK_FORMAT_VERSION = "1.1.0";

export const RISK_METHODS = ["fmea", "matrix", "custom", "qualitative"] as const;
export type RiskMethod = (typeof RISK_METHODS)[number];

/** Whole-number scale of one factor, with an optional description per level (the user's own wording). */
export const riskScaleSchema = z
  .object({
    min: z.number().int(),
    max: z.number().int(),
    levels: z.array(z.object({ value: z.number().int(), description: z.string().min(1) })),
  })
  .superRefine((s, ctx) => {
    if (s.min > s.max) ctx.addIssue({ code: "custom", message: `A scale cannot start at ${s.min} and end at ${s.max}` });
    const seen = new Set<number>();
    for (const l of s.levels) {
      if (l.value < s.min || l.value > s.max) ctx.addIssue({ code: "custom", message: `Scale level ${l.value} is outside ${s.min} to ${s.max}` });
      if (seen.has(l.value)) ctx.addIssue({ code: "custom", message: `Scale level ${l.value} is described twice` });
      seen.add(l.value);
    }
  });
export type RiskScale = z.infer<typeof riskScaleSchema>;

/**
 * A band of the user's: a label, the score range it covers, and a note in the user's words. The range fields are called `minRpn` and
 * `maxRpn` after the FMEA case; for a user-defined method they hold the combined score.
 */
export const riskBandSchema = z.object({
  label: z.string().min(1),
  minRpn: z.number(),
  maxRpn: z.number(),
  note: z.string().optional(),
});
export type RiskBand = z.infer<typeof riskBandSchema>;

/** A scale level with a name (matrix rows and columns, qualitative levels). */
export const riskLevelSchema = z.object({ label: z.string().min(1), description: z.string().optional() });
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/** Where a saved method came from: the library entry it was copied from. The assessment keeps its own copy of the numbers. */
const libraryRef = z.object({ id: z.string().min(1), name: z.string().min(1), version: z.string().min(1) }).optional();
/** The load-out the config started from (an id of the load-out catalog). Informational only. */
const loadoutId = z.string().min(1).optional();

export const fmeaConfigSchema = z.object({
  method: z.literal("fmea"),
  severity: riskScaleSchema,
  occurrence: riskScaleSchema,
  detection: riskScaleSchema,
  bands: z.array(riskBandSchema),
  /**
   * Optional presentation layout. "tr44" is the PDA TR 44 style FMEA register (S x O x D on 1 to 10 with a REVERSED detection scale,
   * "risk accepted?" per row, an action threshold). It changes what the page and the document show and which answers count as open
   * items; it never changes how a score is calculated. Absent = the plain FMEA every project had before.
   */
  layout: z.literal("tr44").optional(),
  /** Only if the user enters it: a severity at or above `min` triggers `label` whatever the RPN is. */
  severityTrigger: z.object({ min: z.number().int(), label: z.string().min(1), note: z.string().optional() }).optional(),
  loadoutId,
  libraryRef,
});

export const matrixConfigSchema = z
  .object({
    method: z.literal("matrix"),
    /** Rows: likelihood levels, in the order shown (top to bottom). */
    likelihood: z.array(riskLevelSchema).min(1),
    /** Columns: severity levels, in the order shown (left to right). */
    severity: z.array(riskLevelSchema).min(1),
    /** Cell -> the user's risk label. 1-based row (likelihood) and column (severity). A cell without a label is an open question. */
    cells: z.array(z.object({ row: z.number().int().min(1), col: z.number().int().min(1), label: z.string() })),
    loadoutId,
    libraryRef,
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    for (const c of m.cells) {
      if (c.row > m.likelihood.length || c.col > m.severity.length) ctx.addIssue({ code: "custom", message: `Matrix cell ${c.row},${c.col} is outside the grid` });
      const k = `${c.row},${c.col}`;
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Matrix cell ${k} is set twice` });
      seen.add(k);
    }
  });

export const RISK_COMBINES = ["product", "sum", "max", "lookup"] as const;
export type RiskCombine = (typeof RISK_COMBINES)[number];

export const riskFactorSchema = z.object({
  /** Stable key of the factor inside the config (used as the key in an item's `values`). */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  scale: riskScaleSchema,
});
export type RiskFactor = z.infer<typeof riskFactorSchema>;

export const customConfigSchema = z
  .object({
    method: z.literal("custom"),
    /** Two to four factors. */
    factors: z.array(riskFactorSchema).min(2).max(4),
    combine: z.enum(RISK_COMBINES),
    /** For `lookup`: one entry per combination the user filled in. `levels` are in factor order. */
    lookup: z.array(z.object({ levels: z.array(z.number().int()), label: z.string() })),
    bands: z.array(riskBandSchema),
    loadoutId,
    libraryRef,
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    for (const f of c.factors) {
      if (seen.has(f.key)) ctx.addIssue({ code: "custom", message: `Factor key ${f.key} appears twice` });
      seen.add(f.key);
    }
    for (const e of c.lookup) {
      if (e.levels.length !== c.factors.length) ctx.addIssue({ code: "custom", message: `A lookup entry needs ${c.factors.length} levels` });
    }
  });

export const qualitativeConfigSchema = z.object({
  method: z.literal("qualitative"),
  levels: z.array(riskLevelSchema).min(1),
  loadoutId,
  libraryRef,
});

export const riskConfigSchema = z.discriminatedUnion("method", [fmeaConfigSchema, matrixConfigSchema, customConfigSchema, qualitativeConfigSchema]);
export type RiskConfig = z.infer<typeof riskConfigSchema>;
export type FmeaConfig = z.infer<typeof fmeaConfigSchema>;
export type MatrixConfig = z.infer<typeof matrixConfigSchema>;
export type CustomConfig = z.infer<typeof customConfigSchema>;
export type QualitativeConfig = z.infer<typeof qualitativeConfigSchema>;

/**
 * One score of an item. `values` holds the whole-number answers by factor key: FMEA uses `severity`, `occurrence`, `detection`; the
 * matrix uses `likelihood` and `severity` as 1-based positions; a user-defined method uses its own factor keys. A qualitative score
 * uses `level` (a label of the method) and `reason`. A missing answer is simply absent: the item is "not scored", never guessed.
 */
export const riskScoreSchema = z.object({
  values: z.record(z.string(), z.number().int()),
  level: z.string().optional(),
  reason: z.string().optional(),
});
export type RiskScore = z.infer<typeof riskScoreSchema>;

export const RISK_ACTION_STATUSES = ["open", "in_progress", "done", "dropped"] as const;
export type RiskActionStatus = (typeof RISK_ACTION_STATUSES)[number];

export const riskActionSchema = z.object({
  /** AC-001 ... never reused inside an assessment. */
  id: z.string().regex(/^AC-\d{3,}$/),
  itemId: z.string().regex(/^RA-\d{3,}$/),
  text: z.string().min(1),
  owner: z.string().optional(),
  due: z.string().optional(),
  status: z.enum(RISK_ACTION_STATUSES),
});
export type RiskAction = z.infer<typeof riskActionSchema>;

export const RISK_ORIGIN_KINDS = ["gap", "catalog", "free"] as const;
export const riskOriginSchema = z.object({
  kind: z.enum(RISK_ORIGIN_KINDS),
  /** Catalog suggestion key (kind "catalog"). */
  suggestionKey: z.string().optional(),
  /** Where the suggestion came from, for the record. */
  catalogVersion: z.string().optional(),
});

/** "Risk accepted?" of one register row (PDA TR 44 FMEA). It is the team's answer; a missing answer is an open item, never a "no". */
export const RISK_ACCEPTED = ["yes", "no"] as const;
export type RiskAccepted = (typeof RISK_ACCEPTED)[number];

/**
 * Intervention risk scoring after the PDA TR 22 worked example: five aspects of an aseptic intervention, each low, medium or high.
 * The OVERALL level is chosen by the team (`level`); the tool shows a tally of the five answers but does not turn it into a level,
 * because the cut-offs are the organisation's decision. A missing aspect stays absent (shown as "Not given").
 */
export const RISK_INTERVENTION_FACTORS = ["complexity", "duration", "proximity", "frequency", "airflow"] as const;
export type RiskInterventionFactor = (typeof RISK_INTERVENTION_FACTORS)[number];
export const RISK_LMH = ["low", "medium", "high"] as const;
export type RiskLmh = (typeof RISK_LMH)[number];
export const riskInterventionSchema = z.object({
  complexity: z.enum(RISK_LMH).optional(),
  duration: z.enum(RISK_LMH).optional(),
  /** Closeness to the product or to open product-contact surfaces. */
  proximity: z.enum(RISK_LMH).optional(),
  frequency: z.enum(RISK_LMH).optional(),
  /** Disruption of the unidirectional airflow. */
  airflow: z.enum(RISK_LMH).optional(),
  level: z.enum(RISK_LMH).optional(),
});
export type RiskIntervention = z.infer<typeof riskInterventionSchema>;

export const riskItemSchema = z.object({
  /** RA-001, RA-002 ... stable, never reused inside an assessment. */
  id: z.string().regex(/^RA-\d{3,}$/),
  /** A step of the assessment's own step list. Absent = not placed on a step (a normal state). */
  stepId: z.string().min(1).optional(),
  failureMode: z.string(),
  effect: z.string().optional(),
  causes: z.string().optional(),
  controlsPrevention: z.string().optional(),
  controlsDetection: z.string().optional(),
  initial: riskScoreSchema,
  /** Optional: only if the person fills it in. */
  residual: riskScoreSchema.optional(),
  /** PDA TR 44 layout: the team's answer to "risk accepted?". Absent = not answered yet (an open item). */
  accepted: z.enum(RISK_ACCEPTED).optional(),
  /** Optional intervention scoring (PDA TR 22 example) for an item that is an aseptic intervention. */
  intervention: riskInterventionSchema.optional(),
  gapIds: z.array(z.string()),
  samplingPointIds: z.array(z.string()),
  sourceIds: z.array(z.string()),
  notes: z.string().optional(),
  origin: riskOriginSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RiskItem = z.infer<typeof riskItemSchema>;

/** Reasons to look at an assessment again (PDA TR 44 lists these as review triggers). A list the team ticks; none is preselected. */
export const RISK_REVIEW_TRIGGERS = ["investigation", "new_risk", "change_control", "process_change", "periodic"] as const;
export type RiskReviewTrigger = (typeof RISK_REVIEW_TRIGGERS)[number];
export const RISK_REVIEW_TRIGGER_LABEL: Record<RiskReviewTrigger, string> = {
  investigation: "An investigation (deviation, out-of-specification result, complaint)",
  new_risk: "A new risk is found",
  change_control: "A change control",
  process_change: "A process change",
  periodic: "Periodic review",
};

/** One line of the revision history: a review that took place (the assessment is a living document). */
export const riskReviewSchema = z.object({
  /** RV-001 ... never reused inside an assessment. */
  id: z.string().regex(/^RV-\d{3,}$/),
  date: z.string().min(1),
  trigger: z.enum(RISK_REVIEW_TRIGGERS).optional(),
  note: z.string().min(1),
  by: z.string().optional(),
});
export type RiskReview = z.infer<typeof riskReviewSchema>;

export const riskApprovalSchema = z.object({ role: z.string().min(1), name: z.string().optional(), date: z.string().optional() });
export type RiskApproval = z.infer<typeof riskApprovalSchema>;

export const riskAssessmentSchema = z
  .object({
    /** RAS-001, RAS-002 ... */
    id: z.string().regex(/^RAS-\d{3,}$/),
    title: z.string().min(1),
    status: z.literal("draft"),
    /** Purpose and scope of the assessment, in the user's words. */
    scopeNote: z.string().optional(),
    /** The context the assessment was made in (product, change, run type ...), free text. */
    context: z.string().optional(),
    /** The chosen method. Absent until the person chooses: there is no default. */
    method: z.enum(RISK_METHODS).optional(),
    config: riskConfigSchema.optional(),
    /** The assessment's own process steps, in process order (a one-time copy of the project scope, then independent). */
    steps: z.array(planStepSchema),
    items: z.array(riskItemSchema),
    actions: z.array(riskActionSchema),
    /**
     * PDA TR 44 layout: the risk priority above which actions are required. Blank by default: the threshold is the organisation's
     * decision, not the tool's. The page only compares a row's priority with it; it never calls a row acceptable.
     */
    actionThreshold: z.number().positive().optional(),
    /** Review triggers the team ticked, the planned next review date and the history of reviews held. */
    reviewTriggers: z.array(z.enum(RISK_REVIEW_TRIGGERS)).optional(),
    nextReview: z.string().optional(),
    reviews: z.array(riskReviewSchema).optional(),
    /** Optional section: who approves. Empty = the section is not in the output unless chosen. */
    approvals: z.array(riskApprovalSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((a, ctx) => {
    const dup = (ids: string[], what: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: "custom", message: `Assessment ${a.id}: ${what} ${id} appears twice` });
        seen.add(id);
      }
    };
    dup(a.items.map((i) => i.id), "item");
    dup(a.actions.map((x) => x.id), "action");
    dup(a.steps.map((s) => s.id), "step");
    dup((a.reviews ?? []).map((r) => r.id), "review");
    dup(a.reviewTriggers ?? [], "review trigger");
    if ((a.method ?? null) !== (a.config?.method ?? null)) ctx.addIssue({ code: "custom", message: `Assessment ${a.id}: the method and its configuration do not match` });
    const stepIds = new Set(a.steps.map((s) => s.id));
    const itemIds = new Set(a.items.map((i) => i.id));
    for (const i of a.items) {
      if (i.stepId && !stepIds.has(i.stepId)) ctx.addIssue({ code: "custom", message: `Item ${i.id} sits on a step (${i.stepId}) that is not in assessment ${a.id}` });
    }
    for (const x of a.actions) {
      if (!itemIds.has(x.itemId)) ctx.addIssue({ code: "custom", message: `Action ${x.id} belongs to an item (${x.itemId}) that is not in assessment ${a.id}` });
    }
  });
export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

/** The `risk` part of a project (schema 1.14.0). */
export const riskStateSchema = z
  .object({ assessments: z.array(riskAssessmentSchema) })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const a of s.assessments) {
      if (seen.has(a.id)) ctx.addIssue({ code: "custom", message: `Risk assessment ${a.id} appears twice` });
      seen.add(a.id);
    }
  });
export type RiskState = z.infer<typeof riskStateSchema>;

/**
 * A saved method of the METHOD LIBRARY (company level, like the lot-size tables library): a name, a version, the document that
 * defines it, an owner, and the configuration. Applying one copies the configuration into an assessment.
 */
export const riskMethodSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  docRef: z.string().optional(),
  owner: z.string().optional(),
  config: riskConfigSchema,
});
export type RiskMethodSnapshot = z.infer<typeof riskMethodSnapshotSchema>;

/** A preset method (a "load-out"), kept in versioned content. It supplies a shape the person then edits. */
export const riskLoadoutSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  config: riskConfigSchema,
});
export type RiskLoadout = z.infer<typeof riskLoadoutSchema>;
export const riskLoadoutsSchema = z.strictObject({ catalog: z.strictObject({ version: z.string().min(1) }), loadouts: z.array(riskLoadoutSchema) });
export type RiskLoadouts = z.infer<typeof riskLoadoutsSchema>;

/** One typical failure mode of a unit operation, offered as a suggestion. Nothing is added to an assessment automatically. */
export const failureModeSuggestionSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  unitOp: z.string().min(1),
  failureMode: z.string().min(1),
  effect: z.string().min(1),
  causes: z.string().min(1),
  controlsPrevention: z.string().optional(),
  controlsDetection: z.string().optional(),
  /** Why this failure mode is typical for the step: general GMP knowledge, not a finding about any product. */
  rationale: z.string().min(1),
  /** Optional id of an entry of the Guidance library. */
  guidanceRef: z.string().optional(),
});
export type FailureModeSuggestion = z.infer<typeof failureModeSuggestionSchema>;
export const failureModeSuggestionsSchema = z.strictObject({
  catalog: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }),
  suggestions: z.array(failureModeSuggestionSchema),
});
export type FailureModeSuggestions = z.infer<typeof failureModeSuggestionsSchema>;
