import { z } from "zod";

/**
 * PPQ sampling plans (added in process-model 1.1.0, project schema 1.11.0; study types, reporting instructions, agency requests
 * and custom subsections added in process-model 1.2.0, project schema 1.12.0; the plan's own process steps and the flow position of
 * a point added in process-model 1.3.0, project schema 1.13.0).
 *
 * A sampling plan says which samples are pulled from which process steps during the process performance qualification (PPQ)
 * batches, why, and how many. The shapes live here, next to the other shared data, so a later tool (risk assessment, master
 * batch record) can read a plan without any gap-assessment code. The calculation of sample sizes and totals is in @gap/sampling.
 *
 * Rules the shapes keep (GMP rules, not conveniences):
 *  - NO DEFAULTS. Every field that decides a number or a judgement (method, confidence, reliability, AQL, inspection level, lot
 *    size, batch count, acceptance) is optional here and has no preset value. A missing input makes the point "incomplete",
 *    which is shown as an open item; it is never filled in.
 *  - The plan stores what a person chose and the arithmetic that followed. It never states whether a choice is adequate: that
 *    belongs to QA and statistics.
 *  - "Report only" (collect and report, no acceptance criterion) is allowed only for characterization, supporting studies,
 *    stability (reported against the stability protocol), regulatory commitments and other work. It is never allowed for
 *    in-process and release testing, enhanced PPQ testing, mixing, hold-time or filter studies: those need a criterion text.
 *  - The tool never judges regulatory impact. An agency request is kept as the person quoted it and linked to the points that
 *    answer it; nothing here says what a request means for a filing.
 */

/** Format version of the plan data (semver). A new optional field is a minor change; a removed or re-meant field is major. */
export const SAMPLING_PLAN_FORMAT_VERSION = "1.2.0";

/** Run types. Only PPQ is built; the field exists so clinical GMP and engineering runs can be added without a schema break. */
export const SAMPLING_RUN_TYPES = ["ppq"] as const;
export type SamplingRunType = (typeof SAMPLING_RUN_TYPES)[number];

export const SAMPLING_METHODS = ["company-table", "fixed", "conf-rel", "aql-105e", "var-414"] as const;
export type SamplingMethod = (typeof SAMPLING_METHODS)[number];

/**
 * The coarse category of plan format 1.0.0. It is no longer stored on a point (the study type replaced it); the list stays only so
 * that a migration and a reader of old files can name the old values.
 */
export const SAMPLING_CATEGORIES = ["routine_ipc_release", "ppq_enhanced", "characterization", "supporting_study", "other"] as const;
export type SamplingCategory = (typeof SAMPLING_CATEGORIES)[number];

/** Categories whose points could be "report only" in plan format 1.0.0. Kept for migration and old-file readers only. */
export const REPORT_ONLY_CATEGORIES: readonly SamplingCategory[] = ["characterization", "supporting_study", "other"];

/**
 * The study / sample type of a point (plan format 1.1.0). It decides which type-specific questions apply, which entries are
 * required, and where the point appears in the protocol. A point can have no type yet (migrated from "routine in-process /
 * release", which hid two different things): that is an open item, never a guess.
 */
export const SAMPLING_TYPES = [
  "ipc",
  "release",
  "ppq_enhanced",
  "mixing_homogeneity",
  "hold_time",
  "filter_study",
  "stability",
  "retain_reserve",
  "characterization",
  "supporting_study",
  "regulatory_commitment",
  "other",
] as const;
export type SamplingType = (typeof SAMPLING_TYPES)[number];

/** Types whose points may be "report only". Stability counts only when the person says results go against the stability protocol. */
export const REPORT_ONLY_TYPES: readonly SamplingType[] = ["characterization", "supporting_study", "stability", "regulatory_commitment", "other"];
export const reportOnlyAllowed = (type: SamplingType | undefined): boolean => type !== undefined && REPORT_ONLY_TYPES.includes(type);

/**
 * Old category -> new type. "routine in-process / release" maps to NOTHING: it covered two different kinds of sample, and
 * choosing one for the person would be a guess. The point is left without a type and listed as an open item.
 */
export function categoryToType(category: string): SamplingType | undefined {
  switch (category) {
    case "ppq_enhanced":
    case "characterization":
    case "supporting_study":
    case "other":
      return category;
    default:
      return undefined;
  }
}

export const TIMING_OPTIONS = [
  "beginning",
  "middle",
  "end",
  "after_intervention",
  "after_stoppage",
  "interval",
  "per_needle",
  "per_lyo_shelf",
  "per_closure_lot",
  "composite",
  "other",
] as const;
export type TimingOption = (typeof TIMING_OPTIONS)[number];

export const INTERVAL_UNITS = ["units", "minutes"] as const;
export const INSPECTIONS = ["normal", "tightened", "reduced"] as const;

/** The unit-operation value of a point that belongs to no single process step. */
export const UNIT_OP_FINISHED_PRODUCT = "finished_product";
export const UNIT_OP_NONE = "none";

/**
 * The unit-operation value of a point that sits on a CUSTOM step of the plan (a step with a free label and no catalog key).
 * Chosen so the code that reads `unitOp` (suggestions, completeness, documents) keeps working: the point belongs to "a step"
 * without claiming it is one of the catalog's. The step's own label is what people see (see `flow`).
 */
export const UNIT_OP_CUSTOM_STEP = "custom_step";

/**
 * Where on a step a sample is taken (plan format 1.2.0). "before" is at the start of the step, "during" inside it, "after" at its
 * end. These are options a person may choose; none is ever set for them (a point on a step with no position is a normal state).
 */
export const FLOW_POSITIONS = ["before", "during", "after"] as const;
export type FlowPosition = (typeof FLOW_POSITIONS)[number];

/**
 * A step of the PLAN's own process scope (plan format 1.2.0). The array order of `plan.steps` is the process order. The plan's step
 * list starts as a one-time copy of the project's Scope and is then independent: editing either never changes the other. A custom
 * step has no `unitOp`, so nothing is restricted to the catalog.
 */
export const planStepSchema = z.object({
  /** ST-01, ST-02 ... never reused inside a plan. */
  id: z.string().regex(/^ST-\d{2,}$/),
  /** A unit-operation key of the catalog (or a project custom one). Absent for a custom step. */
  unitOp: z.string().min(1).optional(),
  label: z.string().min(1),
  notes: z.string().optional(),
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** Where a point is drawn on the flow diagram. A point without `flow` is "Not on the diagram", which is a normal state. */
export const pointFlowSchema = z.object({ stepId: z.string().min(1), at: z.enum(FLOW_POSITIONS).optional() });
export type PointFlow = z.infer<typeof pointFlowSchema>;

/** Who does a piece of work. The names are free text next to the kind. */
export const RESPONSIBLE_PARTIES = ["cmo", "sponsor", "contract_lab", "other"] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

/** A company sampling table as kept inside a point: the whole table at the time it was used (see the Sampling tables library). */
export const companyTableSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  documentRef: z.string().optional(),
  owner: z.string().optional(),
  rows: z.array(
    z.object({
      lotMin: z.number().int().nonnegative(),
      lotMax: z.number().int().nonnegative().nullable(),
      sampleSize: z.number().int().nonnegative(),
      accept: z.number().int().nonnegative().optional(),
      reject: z.number().int().nonnegative().optional(),
      testKey: z.string().optional(),
    }),
  ),
  note: z.string().optional(),
});
export type CompanyTableSnapshot = z.infer<typeof companyTableSnapshotSchema>;

/** Inputs of the chosen method. Only the inputs of that method are used; none has a default. */
export const samplingInputsSchema = z.object({
  /** Company table: the table as it was when chosen, and (for a per-test table) the test key. */
  table: companyTableSnapshotSchema.optional(),
  testKey: z.string().optional(),
  /** Fixed count: the number and the written basis for it. */
  count: z.number().int().optional(),
  basis: z.string().optional(),
  /** Confidence / reliability, as fractions (0.95 for 95 %). */
  confidence: z.number().optional(),
  reliability: z.number().optional(),
  allowedFailures: z.number().int().nonnegative().optional(),
  /** Attribute AQL (MIL-STD-105E) and variables (MIL-STD-414): the level is the standard's own name ("II", "S-3", ...). */
  level: z.string().optional(),
  aql: z.number().optional(),
  inspection: z.enum(INSPECTIONS).optional(),
  limits: z.enum(["single", "double"]).optional(),
});
export type SamplingInputs = z.infer<typeof samplingInputsSchema>;

const workingLine = z.object({ label: z.string(), value: z.string() });

/** What one method worked out for one batch, kept as a record of the arithmetic at the time the point was last saved. */
export const batchResultSchema = z.object({
  batchId: z.string(),
  /** Lot size (units) the result used, when the method needs one. */
  lotSize: z.number().optional(),
  ok: z.boolean(),
  problems: z.array(z.string()),
  sampleSize: z.number().optional(),
  hundredPercent: z.boolean().optional(),
  accept: z.number().optional(),
  reject: z.number().optional(),
  k: z.number().optional(),
  maxPercentNonconforming: z.number().optional(),
  codeLetter: z.string().optional(),
  working: z.array(workingLine),
  citation: z.string(),
});
export type BatchResult = z.infer<typeof batchResultSchema>;

export const pointSampleSizeSchema = z.object({
  /** Absent until the person chooses a method. There is no default method. */
  method: z.enum(SAMPLING_METHODS).optional(),
  inputs: samplingInputsSchema,
  /** The arithmetic as last saved. Open and print use a fresh calculation; this record shows what the point said when it was edited. */
  result: z.object({ statsVersion: z.string(), at: z.string(), perBatch: z.array(batchResultSchema) }).optional(),
});
export type PointSampleSize = z.infer<typeof pointSampleSizeSchema>;

export const samplingOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("seeded"),
    /** Side-less content path of the item the suggestion came from (e.g. "uo.aseptic_filling.ipc.fill_weight"). */
    itemPath: z.string().optional(),
    /** Key of the suggestion in the suggestions catalog. */
    suggestionKey: z.string().optional(),
    /** Gap register ids (G-001 ...) of the gaps behind the suggestion. They can renumber when the gap assessment changes. */
    gapIds: z.array(z.string()),
    /** Key of the validation activity the suggestion came from. */
    validationActivity: z.string().optional(),
  }),
  z.object({ kind: z.literal("manual") }),
]);
export type SamplingOrigin = z.infer<typeof samplingOriginSchema>;

export const samplingAcceptanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("criterion"), text: z.string() }),
  z.object({ kind: z.literal("report_only") }),
]);
export type SamplingAcceptance = z.infer<typeof samplingAcceptanceSchema>;

// ------------------------------------------------------------------ type-specific detail (plan format 1.1.0)

export const MIXING_POSITIONS = ["top", "middle", "bottom", "other"] as const;
export const HOLD_UNITS = ["minutes", "hours", "days"] as const;
export const FILTER_TESTS = ["integrity_pre_post", "bioburden_pre_filtration", "flush", "other"] as const;
/** Where a run's value sits in the range being studied (a free pointer, never checked). */
export const RUN_TAGS = ["min", "target", "max", "other"] as const;
/** What a run may challenge. A convenience list only: the study design is the person's, nothing here is required. */
export const WORST_CASES = ["homogeneity", "shear_protein_quality", "other"] as const;
export type WorstCase = (typeof WORST_CASES)[number];
/** The kind of range a parameter row supports. The person chooses; "unset" is allowed and is the same as leaving it out. */
export const RANGE_KINDS = ["PAR", "NOR", "other", "unset"] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];
export const RETAIN_PURPOSES = ["retain", "reserve", "both"] as const;

const text = z.string().optional();

/** A mixing parameter at a run: value, unit and where it sits in the range. Every part optional; a missing part is an open item. */
export const runParameterSchema = z.object({ value: z.number().positive().optional(), unit: text, tag: z.enum(RUN_TAGS).optional() });
export type RunParameter = z.infer<typeof runParameterSchema>;
/** One run of the optional study design. Everything but the label is optional. */
export const mixingRunSchema = z.object({
  label: z.string(),
  batchSize: runParameterSchema.optional(),
  speed: runParameterSchema.optional(),
  mixTime: runParameterSchema.optional(),
  /** What the run challenges, from the convenience list; "other" is described in challengesOther. */
  challenges: z.array(z.enum(WORST_CASES)).optional(),
  challengesOther: text,
  attributes: text,
  rationale: text,
});
export type MixingRun = z.infer<typeof mixingRunSchema>;
/** A parameter and the range the study is meant to support, in the person's words. */
export const rangeSupportSchema = z.object({ parameter: z.string(), rangeKind: z.enum(RANGE_KINDS).optional(), text });
export type RangeSupport = z.infer<typeof rangeSupportSchema>;
/** The optional study design of a mixing point. Presets (load-outs) only fill it in; the person edits or ignores them. */
export const mixingDesignSchema = z.object({
  /** A free label, e.g. "Worst-case bracketing". */
  approach: text,
  runs: z.array(mixingRunSchema).optional(),
  rangeSupport: z.array(rangeSupportSchema).optional(),
});
export type MixingDesignData = z.infer<typeof mixingDesignSchema>;

/**
 * A preset of the study design (a "load-out"), kept in versioned content. Applying one copies its runs and range rows into a point;
 * the person then edits or ignores them. Values are blank in the catalog: it supplies a shape, never numbers.
 */
export const designLoadoutSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  design: mixingDesignSchema,
});
export type DesignLoadout = z.infer<typeof designLoadoutSchema>;
export const designLoadoutsSchema = z.strictObject({ catalog: z.strictObject({ version: z.string().min(1) }), loadouts: z.array(designLoadoutSchema) });
export type DesignLoadouts = z.infer<typeof designLoadoutsSchema>;

/**
 * The structured answers that only one study type asks. Each group belongs to one type (see TYPE_DETAIL_KEY in @gap/sampling);
 * a group of another type is never read. Every field is optional: what is missing is an open item for that type.
 */
export const typeDetailSchema = z.object({
  /** mixing_homogeneity */
  mixing: z
    .object({
      vesselRef: text,
      parameters: text,
      positions: z.array(z.enum(MIXING_POSITIONS)).optional(),
      positionsOther: text,
      timePoints: z.array(z.object({ label: z.string(), time: z.string() })).optional(),
      criterionBasis: text,
      /** Optional study design (runs and range support). Never required, never checked. */
      design: mixingDesignSchema.optional(),
    })
    .optional(),
  /** hold_time */
  hold: z
    .object({
      /** A unit-operation key: the step after which the material is held. */
      holdStep: text,
      start: text,
      end: text,
      durations: z.array(z.object({ value: z.number().positive(), unit: z.enum(HOLD_UNITS) })).optional(),
      condition: text,
      container: text,
      timePointsSampled: text,
      /** What the result supports (a proposed maximum hold, in the person's words). */
      supports: text,
    })
    .optional(),
  /** ppq_enhanced */
  enhanced: z.object({ interventions: text, intervalDefinition: text, perNeedleShelf: text }).optional(),
  /** filter_study */
  filter: z
    .object({
      filterRef: text,
      test: z.enum(FILTER_TESTS).optional(),
      testOther: text,
      /** Read-only reference to the PUPSIT answer in the gap project: the content path of the item. */
      pupsitItemPath: text,
    })
    .optional(),
  /** stability */
  stability: z
    .object({
      protocolRef: text,
      conditions: z.array(z.object({ label: z.string(), detail: z.string() })).optional(),
      orientation: text,
      timePoints: z.array(z.object({ label: z.string() })).optional(),
      unitsPerPull: z.number().int().min(1).optional(),
      /** The person says the results are reported against the stability protocol (this is what allows "report only"). */
      reportedAgainstProtocol: z.boolean().optional(),
    })
    .optional(),
  /** retain_reserve */
  retain: z
    .object({
      purpose: z.enum(RETAIN_PURPOSES).optional(),
      /** The basis of the quantity, typed by the person ("twice the full release testing quantity"). Never pre-filled. */
      quantityBasis: text,
      retentionPeriod: text,
      storage: text,
      /** The requirement the quantity and period come from, cited by the person. The tool carries no regulation text. */
      requirementRef: text,
      /** Units retained or reserved per batch. */
      unitsPerBatch: z.number().int().min(1).optional(),
    })
    .optional(),
  /** characterization and supporting_study */
  analyses: z.object({ analyses: z.array(z.object({ name: z.string(), methodRef: z.string() })).optional(), informs: text }).optional(),
  /** regulatory_commitment (the linked agency requests are on the point itself) */
  commitment: z.object({ answer: text }).optional(),
});
export type TypeDetail = z.infer<typeof typeDetailSchema>;

// ------------------------------------------------------------------ reporting instructions (plan format 1.1.0)

export const REPORT_WHAT = ["individual", "mean", "range", "sd_rsd", "pass_fail", "trend", "raw_data_ref", "other"] as const;
export type ReportWhat = (typeof REPORT_WHAT)[number];
export const REPORT_PRESENTATION = ["per_batch", "across_batches", "by_location", "by_time_point"] as const;
export type ReportPresentation = (typeof REPORT_PRESENTATION)[number];

/**
 * What the CMO is asked to report for one point. The acceptance statement is NOT stored: it is generated from the point's own
 * acceptance, so the two cannot disagree. `acceptanceExtra` is the person's additional text.
 */
export const reportingSchema = z.object({
  what: z.array(z.enum(REPORT_WHAT)).optional(),
  whatOther: text,
  presentation: z.array(z.enum(REPORT_PRESENTATION)).optional(),
  acceptanceExtra: text,
  /** The CMO's procedure for deviations, OOS and OOT results (for example its SOP id). */
  deviationRef: text,
  additional: text,
});
export type PointReporting = z.infer<typeof reportingSchema>;

export const samplingPointSchema = z
  .object({
    /** SP-001, SP-002 ... never reused inside a plan. */
    id: z.string().regex(/^SP-\d{3,}$/),
    origin: samplingOriginSchema,
    /** The study / sample type. Absent when a migrated point still has to be classified: an open item, never a guess. */
    type: z.enum(SAMPLING_TYPES).optional(),
    /** What "other" means (and an optional wording for any type). */
    typeLabel: z.string().optional(),
    /**
     * A unit-operation key of the catalog (or a custom "x_" one), "finished_product", "none" or "custom_step". It stays consistent
     * with `flow`: a point on a catalog step carries that step's key, a point on a custom step carries "custom_step".
     */
    unitOp: z.string().min(1),
    /** Where the point is drawn on the plan's flow diagram (plan format 1.2.0). Absent = "Not on the diagram". */
    flow: pointFlowSchema.optional(),
    attribute: z.string(),
    testMethodRef: z.string().optional(),
    materialType: z.string().optional(),
    /** Who takes, tests or holds the sample. */
    responsible: z.object({ party: z.enum(RESPONSIBLE_PARTIES), name: z.string().optional() }).optional(),
    container: z.string().optional(),
    closure: z.string().optional(),
    timing: z.object({
      options: z.array(z.enum(TIMING_OPTIONS)),
      interval: z.object({ every: z.number().positive(), unit: z.enum(INTERVAL_UNITS) }).optional(),
      other: z.string().optional(),
      note: z.string().optional(),
    }),
    /** How many locations or time points are sampled per batch. Required for the point to be complete; never defaulted. */
    locationsCount: z.number().int().min(1).optional(),
    sampleSize: pointSampleSizeSchema,
    containerUnitsPerSample: z.number().int().min(1).optional(),
    quantity: z.object({ value: z.number().positive(), unit: z.string().min(1) }).optional(),
    storageCondition: z.string().optional(),
    transportCondition: z.string().optional(),
    chainOfCustody: z.string().optional(),
    destinationLab: z.string().optional(),
    acceptance: samplingAcceptanceSchema.optional(),
    /** Purpose and rationale: why this point is sampled. */
    rationale: z.string(),
    /** "all" batches, or the ids of the batches the point applies to. */
    appliesTo: z.union([z.literal("all"), z.array(z.string()).min(1)]),
    /** Ids of sources in the project's source register that the point cites (documents, interview records). */
    sourceIds: z.array(z.string()),
    /** Ids (AR-001 ...) of the plan's agency requests this point answers or relates to. Any type may link them. */
    agencyRequestIds: z.array(z.string()).optional(),
    detail: typeDetailSchema.optional(),
    reporting: reportingSchema.optional(),
    /** Reserved for the later labels add-on. Not read by anything yet. */
    labelFields: z.record(z.string(), z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((p, ctx) => {
    if (p.acceptance?.kind === "report_only" && !reportOnlyAllowed(p.type)) {
      ctx.addIssue({ code: "custom", message: `Point ${p.id}: "report only" is not allowed for this study type` });
    }
  });
export type SamplingPoint = z.infer<typeof samplingPointSchema>;

export const samplingBatchSchema = z.object({
  /** B-001, B-002 ... never reused inside a plan. */
  id: z.string().regex(/^B-\d{3,}$/),
  /** e.g. "PPQ batch 1". */
  label: z.string().min(1),
  /** Planned lot size in sampling units (containers). The sampling tables of the methods read it. */
  plannedLotSizeUnits: z.number().int().min(1).optional(),
  batchSize: z.number().positive().optional(),
  batchSizeUnit: z.string().optional(),
  notes: z.string().optional(),
});
export type SamplingBatch = z.infer<typeof samplingBatchSchema>;

// ------------------------------------------------------------------ agency requests (plan format 1.1.0)

export const AGENCY_REQUEST_KINDS = ["information_request", "deficiency_or_query_letter", "commitment", "post_approval_commitment", "other"] as const;
export type AgencyRequestKind = (typeof AGENCY_REQUEST_KINDS)[number];
export const AGENCY_REQUEST_STATUSES = ["open", "answered", "closed"] as const;
export type AgencyRequestStatus = (typeof AGENCY_REQUEST_STATUSES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are written year-month-day.");

/**
 * An agency request or answer that refers to PPQ samples or studies (an information request, a deficiency letter, a commitment).
 * The question is kept as quoted; the tool does not interpret it and never says what it means for a filing.
 */
export const agencyRequestSchema = z.object({
  /** AR-001, AR-002 ... never reused inside a plan. */
  id: z.string().regex(/^AR-\d{3,}$/),
  agency: z.string(),
  marketCode: z.string().optional(),
  kind: z.enum(AGENCY_REQUEST_KINDS).optional(),
  reference: z.string().optional(),
  dateReceived: isoDay.optional(),
  /** The question, quoted as received. */
  question: z.string(),
  /** The response given, or the commitment made. */
  response: z.string().optional(),
  responseDate: isoDay.optional(),
  status: z.enum(AGENCY_REQUEST_STATUSES).optional(),
  /** The letter and the response, cited from the source register. */
  sourceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgencyRequest = z.infer<typeof agencyRequestSchema>;

// ------------------------------------------------------------------ custom subsections (plan format 1.1.0)

/**
 * A small structured body: paragraphs, bullet lists and simple tables, all plain text. Raw HTML is not a thing here; the
 * renderers escape every value, and the editor strips control characters.
 */
export const subsectionBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("list"), items: z.array(z.string()) }),
  z.object({ type: z.literal("table"), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
]);
export type SubsectionBlock = z.infer<typeof subsectionBlockSchema>;

/** Where a subsection goes: after a section of the protocol, inside a point, inside a study-type section, or in an appendix. */
export const PLACEMENT_PATTERN = /^(appendix|after_section:[a-z0-9-]+|in_point:SP-\d{3,}|in_study_type:[a-z_]+)$/;
export const placementSchema = z.string().regex(PLACEMENT_PATTERN, "Choose where the subsection goes.");

export const subsectionOriginSchema = z.discriminatedUnion("kind", [
  /** Copied from the Plan subsections library; the id and version are those of the library item when it was copied. */
  z.object({ kind: z.literal("library"), itemId: z.string().min(1), version: z.string(), name: z.string() }),
  z.object({ kind: z.literal("manual") }),
]);
export type SubsectionOrigin = z.infer<typeof subsectionOriginSchema>;

export const customSubsectionSchema = z.object({
  /** CS-001, CS-002 ... never reused inside a plan. */
  id: z.string().regex(/^CS-\d{3,}$/),
  title: z.string(),
  blocks: z.array(subsectionBlockSchema),
  placement: placementSchema,
  /** Position among the subsections with the same placement (smaller first). */
  order: z.number().int().nonnegative(),
  /** Also print this subsection in the CMO reporting instructions. */
  includeInCmo: z.boolean(),
  origin: subsectionOriginSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomSubsection = z.infer<typeof customSubsectionSchema>;

/** A reusable subsection kept in the Plan subsections library (browser or laptop server). The history is kept on the record. */
export const subsectionLibraryItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string(),
  owner: z.string().optional(),
  blocks: z.array(subsectionBlockSchema),
  /** A placement the owner suggests. Not binding: the plan chooses its own. */
  suggestedPlacement: z.string().optional(),
  note: z.string().optional(),
});
export type SubsectionLibraryItem = z.infer<typeof subsectionLibraryItemSchema>;

/** A responsible party named at plan level (the sampling interview asks "who does what"). */
export const planPartySchema = z.object({ party: z.enum(RESPONSIBLE_PARTIES), name: z.string(), role: z.string().optional() });
export type PlanParty = z.infer<typeof planPartySchema>;

export const samplingPlanSchema = z
  .object({
    /** SPL-001, SPL-002 ... */
    id: z.string().regex(/^SPL-\d{3,}$/),
    title: z.string().min(1),
    runType: z.enum(SAMPLING_RUN_TYPES),
    status: z.literal("draft"),
    notes: z.string().optional(),
    /** The plan's own process steps, in process order (plan format 1.2.0). Separate from the gap assessment's Scope. */
    steps: z.array(planStepSchema),
    /** The batches. How many is the person's decision: there is no default count. */
    batches: z.array(samplingBatchSchema),
    /** Why this number of batches. Required for the plan to be complete. */
    batchRationale: z.string(),
    /** Who is responsible for sampling, testing and reporting (plan level). */
    parties: z.array(planPartySchema),
    /** The register of agency requests that refer to PPQ samples or studies. */
    agencyRequests: z.array(agencyRequestSchema),
    /** The person says there are no such requests. Without this and without any request, the question is an open item. */
    noAgencyRequests: z.boolean().optional(),
    points: z.array(samplingPointSchema),
    subsections: z.array(customSubsectionSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((plan, ctx) => {
    const dup = (ids: string[], what: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: "custom", message: `Plan ${plan.id}: ${what} ${id} appears twice` });
        seen.add(id);
      }
    };
    dup(plan.batches.map((b) => b.id), "batch");
    dup(plan.points.map((p) => p.id), "point");
    dup(plan.agencyRequests.map((r) => r.id), "agency request");
    dup(plan.subsections.map((s) => s.id), "subsection");
    dup(plan.steps.map((s) => s.id), "step");
    const stepIds = new Set(plan.steps.map((s) => s.id));
    const batchIds = new Set(plan.batches.map((b) => b.id));
    const requestIds = new Set(plan.agencyRequests.map((r) => r.id));
    const pointIds = new Set(plan.points.map((p) => p.id));
    for (const p of plan.points) {
      if (p.flow && !stepIds.has(p.flow.stepId)) ctx.addIssue({ code: "custom", message: `Point ${p.id} sits on a step (${p.flow.stepId}) that is not in plan ${plan.id}` });
      if (p.appliesTo !== "all") {
        for (const id of p.appliesTo) {
          if (!batchIds.has(id)) ctx.addIssue({ code: "custom", message: `Point ${p.id} applies to a batch (${id}) that is not in plan ${plan.id}` });
        }
      }
      for (const id of p.agencyRequestIds ?? []) {
        if (!requestIds.has(id)) ctx.addIssue({ code: "custom", message: `Point ${p.id} links an agency request (${id}) that is not in plan ${plan.id}` });
      }
    }
    for (const s of plan.subsections) {
      const m = /^in_point:(SP-\d+)$/.exec(s.placement);
      if (m && !pointIds.has(m[1]!)) ctx.addIssue({ code: "custom", message: `Subsection ${s.id} is placed in a point (${m[1]}) that is not in plan ${plan.id}` });
      const t = /^in_study_type:(.+)$/.exec(s.placement);
      if (t && !(SAMPLING_TYPES as readonly string[]).includes(t[1]!)) ctx.addIssue({ code: "custom", message: `Subsection ${s.id} is placed in an unknown study type (${t[1]})` });
    }
  });
export type SamplingPlan = z.infer<typeof samplingPlanSchema>;

/** The `sampling` part of a project (schema 1.13.0). */
export const samplingStateSchema = z
  .object({ plans: z.array(samplingPlanSchema) })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const p of s.plans) {
      if (seen.has(p.id)) ctx.addIssue({ code: "custom", message: `Sampling plan ${p.id} appears twice` });
      seen.add(p.id);
    }
  });
export type SamplingState = z.infer<typeof samplingStateSchema>;
