import { z } from "zod";

/**
 * TRD seed: the receiving unit's (RU, the target side) planned state of a process, exported as versioned JSON so that a
 * technology transfer document (TRD) generator can start from it. The format lives in the process model, not in the gap
 * engine, so the TRD tool can read a seed without any gap-assessment code.
 *
 * Rules the format enforces (they are GMP rules, not conveniences):
 *  - NO DEFAULTS. A value is present only when it is established, or when it is the best guess of a TBD (then the field says
 *    `provisional: true`). An unknown item is listed with status "not_established" and no value; the exporter never fills one in.
 *  - The RU value and the SU (source) reference are kept apart. A SU value only ever appears under `reference.su`, for
 *    traceability, and never in a field the TRD would read as the RU value.
 *  - Inactive values (unit operations left out of scope, tailored-out topics, removed custom items) are not exported at all.
 *  - The seed never states a regulatory filing category; that is for regulatory affairs to assess.
 */

export const TRD_SEED_FORMAT = "gap-assessment.trd-seed";
/** Format version (semver). A new optional field is a minor change; removing or renaming a field, or changing its meaning, is major. */
export const TRD_SEED_VERSION = "1.0.0";

const quantity = z.object({ value: z.number(), unit: z.string() });
const range = z.object({ min: quantity.optional(), max: quantity.optional() });

/** A recorded value: text, number, yes/no, a list of choices, a quantity (value and unit) or a range (min and max). */
export const seedValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), quantity, range]);
export type SeedValue = z.infer<typeof seedValueSchema>;

export const SEED_STATUSES = ["established", "not_applicable", "not_established", "tbd"] as const;
export type SeedStatus = (typeof SEED_STATUSES)[number];

export const SEED_VERIFICATIONS = ["verified", "withdrawn", "self_verified", "unverified"] as const;
export type SeedVerification = (typeof SEED_VERIFICATIONS)[number];

/** Parameter classification as the catalog names it. */
export const SEED_CLASSIFICATIONS = ["CPP", "KPP", "non_critical"] as const;
export type SeedClassification = (typeof SEED_CLASSIFICATIONS)[number];

export const SEED_COLLECTIONS = ["param", "equip", "mat", "ipc", "study", "doc"] as const;
export type SeedCollection = (typeof SEED_COLLECTIONS)[number];

/** How a seed value is invariant-checked; see seedAnswerSchema. */
function checkAnswer(a: { status: SeedStatus; value?: unknown; provisional?: boolean; tbd?: unknown; justification?: string }, ctx: z.RefinementCtx): void {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const hasValue = a.value !== undefined;
  if (a.status === "established" && !hasValue) issue("An established answer needs a value");
  if (a.status === "established" && a.provisional) issue("Only a TBD answer can be provisional");
  if ((a.status === "not_established" || a.status === "not_applicable") && hasValue) issue(`A ${a.status} answer must not carry a value (no defaults)`);
  if (a.status === "tbd" && hasValue && !a.provisional) issue("A TBD answer may carry a best guess only when it is marked provisional");
  if (a.status === "tbd" && a.provisional && !hasValue) issue("A provisional answer needs the best guess it is based on");
  if (a.status !== "tbd" && a.tbd !== undefined) issue("TBD details (owner, due, note) belong to a TBD answer");
}

const tbdDetail = z.object({ owner: z.string().optional(), due: z.string().optional(), note: z.string().optional() });

/** One answer: status, and the value when there is one. `display` is the value as people read it (option labels instead of codes). */
const answerShape = {
  status: z.enum(SEED_STATUSES),
  value: seedValueSchema.optional(),
  display: z.string().optional(),
  /** Unit of a quantity or range value, repeated for readers that do not want to inspect the value. */
  unit: z.string().optional(),
  /** True when the value is a TBD best guess. Never shown as a confirmed value. */
  provisional: z.literal(true).optional(),
  tbd: tbdDetail.optional(),
  /** Why an answer is "not_applicable". */
  justification: z.string().optional(),
};

export const seedAnswerSchema = z.object(answerShape).superRefine(checkAnswer);
export type SeedAnswer = z.infer<typeof seedAnswerSchema>;

/** The SU value an RU value can be traced to. Reference only: the TRD must not read it as the RU value. */
export const seedReferenceSchema = z.object({
  su: z
    .object({
      status: z.enum(SEED_STATUSES),
      value: seedValueSchema.optional(),
      display: z.string().optional(),
      unit: z.string().optional(),
      provisional: z.literal(true).optional(),
    })
    .optional(),
  /** Display ids of the gap register rows that compare this value (G-001 ...). They can renumber between assessments. */
  gapIds: z.array(z.string()),
});
export type SeedReference = z.infer<typeof seedReferenceSchema>;

export const seedFieldSchema = z
  .object({
    /** Side-less content path, e.g. "uo.sterile_filtration.param.max_pressure.setPoint". */
    path: z.string(),
    /** Last segment of the path (the field of the item), e.g. "setPoint". */
    field: z.string(),
    label: z.string(),
    ...answerShape,
    /** The RU asserted "same as SU"; the value is the SU value by that assertion. */
    sameAsSu: z.literal(true).optional(),
    sourceIds: z.array(z.string()),
    /** Where in the cited documents the value is found, by source id. */
    locations: z.record(z.string(), z.object({ section: z.string().optional(), page: z.string().optional() })).optional(),
    verification: z.enum(SEED_VERIFICATIONS),
    reference: seedReferenceSchema.optional(),
  })
  .superRefine(checkAnswer);
export type SeedField = z.infer<typeof seedFieldSchema>;

export const seedItemSchema = z.object({
  collection: z.enum(SEED_COLLECTIONS),
  key: z.string(),
  label: z.string(),
  /** True for an item the project added (key starts with "x_"). */
  custom: z.boolean(),
  /** Parameter classification when the RU side established one. Absent means not known; it is never taken from the SU. */
  classification: z.enum(SEED_CLASSIFICATIONS).optional(),
  /** The SU classification of the same parameter, for traceability only. Never read it as the RU classification. */
  reference: z.object({ suClassification: z.enum(SEED_CLASSIFICATIONS) }).optional(),
  fields: z.array(seedFieldSchema),
});
export type SeedItem = z.infer<typeof seedItemSchema>;

const stageGroupRef = z.object({ key: z.string(), label: z.string() });

export const seedUnitOperationSchema = z.object({
  key: z.string(),
  label: z.string(),
  sequence: z.number(),
  custom: z.boolean(),
  /** Absent for a unit operation the project added. */
  stageGroup: stageGroupRef.optional(),
  /** Answers about the unit operation itself (is it performed). */
  fields: z.array(seedFieldSchema),
  items: z.array(seedItemSchema),
});
export type SeedUnitOperation = z.infer<typeof seedUnitOperationSchema>;

export const seedSourceSchema = z.object({
  id: z.string(),
  /** The number the gap assessment document's source register gives this source (e.g. "S-012"), for cross-reference. */
  gapRegisterRef: z.string().optional(),
  type: z.string(),
  label: z.string(),
  date: z.string(),
  /** A cited document. The seed names it; it never carries the file. */
  document: z.object({ docType: z.string(), identifier: z.string(), title: z.string().optional(), version: z.string().optional() }).optional(),
  /** Name and checksum of an uploaded file, no bytes. */
  file: z.object({ name: z.string(), sha256: z.string() }).optional(),
  /** Who gave the answer, for an interview record. */
  responder: z.object({ name: z.string(), role: z.string().optional() }).optional(),
});
export type SeedSource = z.infer<typeof seedSourceSchema>;

export const seedMetaSchema = z.object({
  format: z.literal(TRD_SEED_FORMAT),
  formatVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  exportedAt: z.string(),
  generator: z.object({ name: z.string(), version: z.string() }),
  processModelVersion: z.string(),
  /** Versions of the content the project was assessed with (catalog, gap overlay, questions, rules, templates). */
  contentVersions: z.record(z.string(), z.string()),
  projectSchemaVersion: z.string(),
  project: z.object({ id: z.string(), name: z.string() }),
  product: z.object({ program: seedAnswerSchema, modality: seedAnswerSchema, dosageForm: seedAnswerSchema, presentation: seedAnswerSchema }),
  receivingSite: z.object({ name: seedAnswerSchema, line: seedAnswerSchema, programStage: seedAnswerSchema }),
  /** The gap assessment this seed came from. `revision` is absent when no revision was issued (the tool issues none since schema 1.10.0). */
  gapAssessment: z.object({ documentFingerprint: z.string(), revision: z.number().int().positive().optional() }),
});
export type SeedMeta = z.infer<typeof seedMetaSchema>;

export const seedScopeSchema = z.object({
  /** Unit operations in scope, in process order. A `note` says when one waits for an unanswered scoping question (nothing is exported for it yet). */
  included: z.array(z.object({ key: z.string(), label: z.string(), sequence: z.number(), stageGroup: stageGroupRef.optional(), custom: z.boolean(), note: z.string().optional() })),
  /** Left out by the project in the Scope step, on both sides. Nothing is exported for them. */
  excluded: z.array(z.object({ key: z.string(), label: z.string(), stageGroup: stageGroupRef.optional(), reason: z.string(), by: z.string(), at: z.string() })),
  /** Not applicable because of an answer (for example the dosage form), with the answer that decided it. */
  notApplicable: z.array(z.object({ key: z.string(), label: z.string(), stageGroup: stageGroupRef.optional(), reason: z.string() })),
  /** Topics of an included unit operation that were switched off. Nothing is exported for them. */
  topicsLeftOut: z.array(z.object({ uo: z.string(), uoLabel: z.string(), topic: z.string(), topicLabel: z.string(), reason: z.string(), by: z.string(), at: z.string() })),
});
export type SeedScope = z.infer<typeof seedScopeSchema>;

export const trdSeedSchema = z.object({
  meta: seedMetaSchema,
  scope: seedScopeSchema,
  /** Facility answers of the receiving site (barrier, background grade, ...). */
  site: z.object({ fields: z.array(seedFieldSchema) }),
  unitOperations: z.array(seedUnitOperationSchema),
  sources: z.array(seedSourceSchema),
});
export type TrdSeed = z.infer<typeof trdSeedSchema>;

export class TrdSeedError extends Error {}

/**
 * Reads a TRD seed from JSON text or an already parsed object. Throws TrdSeedError (with the problems listed) when it is not a
 * seed, is a seed of another major format version, or breaks a format rule (for example a value on a not-established field).
 */
export function parseTrdSeed(input: unknown): TrdSeed {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new TrdSeedError("The file is not valid JSON.");
    }
  }
  const meta = (raw as { meta?: { format?: unknown; formatVersion?: unknown } } | null)?.meta;
  if (meta?.format !== TRD_SEED_FORMAT) throw new TrdSeedError(`Not a TRD seed (format "${String(meta?.format)}", expected "${TRD_SEED_FORMAT}").`);
  const major = (v: unknown) => String(v).split(".")[0];
  if (major(meta.formatVersion) !== major(TRD_SEED_VERSION)) {
    throw new TrdSeedError(`This reader supports TRD seed format ${major(TRD_SEED_VERSION)}.x; the file is ${String(meta.formatVersion)}.`);
  }
  const r = trdSeedSchema.safeParse(raw);
  if (!r.success) throw new TrdSeedError(`Invalid TRD seed:\n- ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n- ")}`);
  return r.data;
}
