import { z } from "zod";

/**
 * PPQ sampling plans (added in process-model 1.1.0, project schema 1.11.0).
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
 *  - "Report only" (collect and report, no acceptance criterion) is allowed only for characterization, supporting studies and
 *    other work, never for routine in-process and release testing or for enhanced PPQ testing.
 */

/** Format version of the plan data (semver). A new optional field is a minor change; a removed or re-meant field is major. */
export const SAMPLING_PLAN_FORMAT_VERSION = "1.0.0";

/** Run types. Only PPQ is built; the field exists so clinical GMP and engineering runs can be added without a schema break. */
export const SAMPLING_RUN_TYPES = ["ppq"] as const;
export type SamplingRunType = (typeof SAMPLING_RUN_TYPES)[number];

export const SAMPLING_METHODS = ["company-table", "fixed", "conf-rel", "aql-105e", "var-414"] as const;
export type SamplingMethod = (typeof SAMPLING_METHODS)[number];

export const SAMPLING_CATEGORIES = ["routine_ipc_release", "ppq_enhanced", "characterization", "supporting_study", "other"] as const;
export type SamplingCategory = (typeof SAMPLING_CATEGORIES)[number];

/** Categories whose points may be "report only". */
export const REPORT_ONLY_CATEGORIES: readonly SamplingCategory[] = ["characterization", "supporting_study", "other"];
export const reportOnlyAllowed = (category: SamplingCategory): boolean => REPORT_ONLY_CATEGORIES.includes(category);

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

export const samplingPointSchema = z
  .object({
    /** SP-001, SP-002 ... never reused inside a plan. */
    id: z.string().regex(/^SP-\d{3,}$/),
    origin: samplingOriginSchema,
    category: z.enum(SAMPLING_CATEGORIES),
    /** What "other" means (and an optional wording for any category). */
    categoryLabel: z.string().optional(),
    /** A unit-operation key of the catalog (or a custom "x_" one), "finished_product" or "none". */
    unitOp: z.string().min(1),
    attribute: z.string(),
    testMethodRef: z.string().optional(),
    materialType: z.string().optional(),
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
    destinationLab: z.string().optional(),
    acceptance: samplingAcceptanceSchema.optional(),
    rationale: z.string(),
    /** "all" batches, or the ids of the batches the point applies to. */
    appliesTo: z.union([z.literal("all"), z.array(z.string()).min(1)]),
    /** Ids of sources in the project's source register that the point cites (documents, interview records). */
    sourceIds: z.array(z.string()),
    /** Reserved for the later labels add-on. Not read by anything yet. */
    labelFields: z.record(z.string(), z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((p, ctx) => {
    if (p.acceptance?.kind === "report_only" && !reportOnlyAllowed(p.category)) {
      ctx.addIssue({ code: "custom", message: `Point ${p.id}: "report only" is not allowed for this category` });
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

export const samplingPlanSchema = z
  .object({
    /** SPL-001, SPL-002 ... */
    id: z.string().regex(/^SPL-\d{3,}$/),
    title: z.string().min(1),
    runType: z.enum(SAMPLING_RUN_TYPES),
    status: z.literal("draft"),
    notes: z.string().optional(),
    /** The batches. How many is the person's decision: there is no default count. */
    batches: z.array(samplingBatchSchema),
    /** Why this number of batches. Required for the plan to be complete. */
    batchRationale: z.string(),
    points: z.array(samplingPointSchema),
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
    const batchIds = new Set(plan.batches.map((b) => b.id));
    for (const p of plan.points) {
      if (p.appliesTo === "all") continue;
      for (const id of p.appliesTo) {
        if (!batchIds.has(id)) ctx.addIssue({ code: "custom", message: `Point ${p.id} applies to a batch (${id}) that is not in plan ${plan.id}` });
      }
    }
  });
export type SamplingPlan = z.infer<typeof samplingPlanSchema>;

/** The `sampling` part of a project (schema 1.11.0). */
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
