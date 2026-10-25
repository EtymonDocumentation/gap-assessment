import { z } from "zod";
import { trdWriteupSchema } from "./trd-writeups";
import { SEED_COLLECTIONS, SEED_STATUSES, seedSourceSchema, SEED_VERIFICATIONS, seedReferenceSchema, seedValueSchema, type SeedAnswer } from "./trd-seed";

/*
 * Technical requirements document (TRD) record (project schema 1.15.0). Module "trd".
 *
 * Design notes (the why):
 *  - THE TRD IS THE USER'S DOCUMENT; THE SEED IS ONLY WHERE IT STARTED. A field keeps the value as it came in (`pulled`, the seed
 *    field untouched) and, separately, what the user entered over it (`override`). The TRD value is the override if there is one,
 *    else the pulled value. Keeping both is what lets a later "update from project" show "project now says X" for a field the
 *    user overrode, instead of silently replacing the user's decision.
 *  - NO DEFAULTS. A blank TRD has no pulled values. A field with neither pulled value nor override is "not established" and is
 *    listed as an open item. Nothing here fills a value in.
 *  - RU VALUE AND SU REFERENCE STAY APART. The pulled seed field carries the SU value only under `reference.su`; the TRD value is
 *    never read from it.
 *  - PAR AND NOR ARE ENTERED, NEVER ASSUMED. They come from documents (a PPQ summary report, development reports ...), so each range
 *    has its own source citations. A pulled project range is not taken to be a PAR or a NOR; the user copies it on purpose.
 *  - The record never states a regulatory filing category.
 */

/** Version of the TRD format (shapes, output). Independent of the project schema version and of the seed format version. */
export const TRD_FORMAT_VERSION = "1.2.0";

/** Suggestions for the basis of a PAR or NOR (load-outs: the user may type any other text). */
export const TRD_BASIS_LOADOUTS = ["Proposed from process development", "Confirmed by PPQ summary report", "Internal technical report"] as const;

/** Suggestions for the document type of a source (load-outs: the type is free text, so any other still works). */
export const TRD_SOURCE_DOC_TYPES = ["PPQ summary report", "Process development report", "Characterization study report", "Internal technical report"] as const;

/** What the user entered over a pulled (or empty) field. The reason is optional: an empty one shows as "No reason recorded". */
export const trdOverrideSchema = z
  .object({
    status: z.enum(SEED_STATUSES),
    /** The value as people read it, typed by the user. */
    display: z.string().optional(),
    unit: z.string().optional(),
    reason: z.string().optional(),
    by: z.string(),
    at: z.string(),
  })
  .superRefine((o, ctx) => {
    if (o.status === "established" && !(o.display ?? "").trim()) ctx.addIssue({ code: "custom", message: "An established value needs the value" });
    if ((o.status === "not_established" || o.status === "not_applicable") && (o.display ?? "").trim()) ctx.addIssue({ code: "custom", message: `A ${o.status} entry must not carry a value (no defaults)` });
  });
export type TrdOverride = z.infer<typeof trdOverrideSchema>;

/**
 * A seed field as it came into the TRD. It is the seed field's own shape (status, value, display, unit, provisional, TBD detail,
 * sources, verification, SU reference), except that `path`, `verification` and `locations` may be missing: the product and
 * site details come from the seed's meta, which is a plain answer without them. Kept as received, never edited.
 */
export const trdPulledSchema = z.object({
  path: z.string().optional(),
  status: z.enum(SEED_STATUSES),
  value: seedValueSchema.optional(),
  display: z.string().optional(),
  unit: z.string().optional(),
  provisional: z.literal(true).optional(),
  tbd: z.object({ owner: z.string().optional(), due: z.string().optional(), note: z.string().optional() }).optional(),
  justification: z.string().optional(),
  sameAsSu: z.literal(true).optional(),
  sourceIds: z.array(z.string()),
  locations: z.record(z.string(), z.object({ section: z.string().optional(), page: z.string().optional() })).optional(),
  verification: z.enum(SEED_VERIFICATIONS).optional(),
  reference: seedReferenceSchema.optional(),
});
export type TrdPulled = z.infer<typeof trdPulledSchema>;
/** A seed answer fits the pulled shape (meta answers have no sources: they are given an empty list). */
export const pulledFromAnswer = (a: SeedAnswer): TrdPulled => ({ ...a, sourceIds: [] });

export const trdFieldSchema = z.object({
  /** The seed field name ("setPoint", "make" ...) or, for details, the detail key. */
  key: z.string().min(1),
  label: z.string().min(1),
  /** The seed field as it came in. Absent in a blank TRD and on an item or field the user added. */
  pulled: trdPulledSchema.optional(),
  override: trdOverrideSchema.optional(),
});
export type TrdField = z.infer<typeof trdFieldSchema>;

/** A source citation: ids of the project's source register, and where in each document the value is found. */
const citation = {
  sourceIds: z.array(z.string()),
  locations: z.record(z.string(), z.object({ section: z.string().optional(), page: z.string().optional() })).optional(),
};

/** A numeric range of a PAR or NOR. At least one end must be given; a range with neither is not a range. */
export const trdRangeSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().optional(),
    ...citation,
    /** Free text label with load-outs (TRD_BASIS_LOADOUTS). */
    basis: z.string().optional(),
    /** True when the range was copied from a TBD (provisional) project value. Shown as provisional, never as confirmed. */
    provisional: z.literal(true).optional(),
    note: z.string().optional(),
  })
  .refine((r) => r.min !== undefined || r.max !== undefined, { message: "A range needs a minimum, a maximum or both" });
export type TrdRange = z.infer<typeof trdRangeSchema>;

export const trdSetPointSchema = z.object({ value: z.number(), unit: z.string().optional(), provisional: z.literal(true).optional(), ...citation });
export type TrdSetPoint = z.infer<typeof trdSetPointSchema>;

export const trdLimitsSchema = z.object({ setPoint: trdSetPointSchema.optional(), nor: trdRangeSchema.optional(), par: trdRangeSchema.optional() });
export type TrdLimits = z.infer<typeof trdLimitsSchema>;

export const trdItemSchema = z.object({
  collection: z.enum(SEED_COLLECTIONS),
  /** Seed item key, or "x_..." for an item the user added in the TRD. Unique inside a step and collection. */
  key: z.string().min(1),
  label: z.string().min(1),
  /** True for an item the project (or the TRD) added, not in the catalog. */
  custom: z.boolean(),
  /** True for an item typed in the TRD (blank TRD or added later): it has no pulled values. */
  entered: z.boolean().optional(),
  /**
   * The item's fields. For a parameter the first is "classification" (the catalog's CPP / KPP / non-critical, pulled when the
   * project established one) so a user override of it is logged and reviewed like any other.
   */
  fields: z.array(trdFieldSchema),
  /** PAR / NOR / set point of a parameter (also allowed on an IPC). */
  limits: trdLimitsSchema.optional(),
});
export type TrdItem = z.infer<typeof trdItemSchema>;

export const trdStepSchema = z.object({
  /** TS-01, TS-02 ... never reused inside a TRD. */
  id: z.string().regex(/^TS-\d{2,}$/),
  /** Unit-operation key of the seed or catalog. Absent for a custom step typed in the TRD. */
  key: z.string().min(1).optional(),
  label: z.string().min(1),
  custom: z.boolean(),
  /** Position in the seed's process order, so a step added by a later update lands in the right place. */
  sequence: z.number().optional(),
  /** True for a step typed or inserted in the TRD itself: it is never reported as "removed from the project". */
  entered: z.boolean().optional(),
  stageGroup: z.object({ key: z.string(), label: z.string() }).optional(),
  /** The user's own narrative for the step. */
  description: z.string().optional(),
  /** Answers about the step itself (is it performed). */
  fields: z.array(trdFieldSchema),
  items: z.array(trdItemSchema),
});
export type TrdStep = z.infer<typeof trdStepSchema>;

export const TRD_ORIGIN_KINDS = ["project", "seed-import", "blank"] as const;
export const trdOriginSchema = z.object({
  kind: z.enum(TRD_ORIGIN_KINDS),
  /** The seed the TRD was last brought up to date with (project and seed-import origins). */
  seed: z
    .object({
      formatVersion: z.string(),
      exportedAt: z.string(),
      projectId: z.string(),
      projectName: z.string(),
      gapFingerprint: z.string(),
      /** Fingerprint of the seed content (not the export time): a different value later means the source changed. */
      fingerprint: z.string(),
    })
    .optional(),
  /** The sources of the seed, kept so pulled citations can be read when the seed came from another project (seed-import). */
  seedSources: z.array(seedSourceSchema).optional(),
  /** When the TRD was started. */
  importedAt: z.string(),
  /** When it was last brought up to date from the project or a newer seed. */
  updatedFromAt: z.string().optional(),
});
export type TrdOrigin = z.infer<typeof trdOriginSchema>;

export const trdApprovalSchema = z.object({ role: z.string().min(1), name: z.string().optional(), date: z.string().optional() });
export type TrdApproval = z.infer<typeof trdApprovalSchema>;

/** The product and site details of a TRD: key and label. */
export const TRD_DETAIL_KEYS = [
  ["program", "Program"],
  ["modality", "Modality"],
  ["dosageForm", "Dosage form"],
  ["presentation", "Presentation"],
  ["site", "Receiving site"],
  ["line", "Filling line"],
  ["programStage", "Program stage"],
] as const;

export const trdDocumentSchema = z
  .object({
    /** TRD-001, TRD-002 ... */
    id: z.string().regex(/^TRD-\d{3,}$/),
    title: z.string().min(1),
    status: z.literal("draft"),
    /** The document reference the user gives it (optional). */
    docRef: z.string().optional(),
    /** The user's own document version label (optional). */
    version: z.string().optional(),
    origin: trdOriginSchema,
    /** Product, presentation, receiving site, line and stage (pulled or typed). */
    details: z.array(trdFieldSchema),
    purpose: z.string().optional(),
    scopeNote: z.string().optional(),
    steps: z.array(trdStepSchema),
    approvals: z.array(trdApprovalSchema).optional(),
    /** Process descriptions and TRD-level prose (TRD format 1.2.0 adds pictures, table rows and the author's place). Absent in a TRD made before; it then exports as it always did. */
    writeups: z.array(trdWriteupSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const s of d.steps) {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `TRD ${d.id}: step ${s.id} appears twice` });
      seen.add(s.id);
      const keys = new Set<string>();
      for (const i of s.items) {
        const k = `${i.collection}.${i.key}`;
        if (keys.has(k)) ctx.addIssue({ code: "custom", message: `TRD ${d.id}: ${s.id} has ${k} twice` });
        keys.add(k);
      }
    }
    const wu = new Set<string>();
    for (const w of d.writeups ?? []) {
      if (wu.has(w.id)) ctx.addIssue({ code: "custom", message: `TRD ${d.id}: write-up ${w.id} appears twice` });
      wu.add(w.id);
    }
  });
export type TrdDocument = z.infer<typeof trdDocumentSchema>;

/** The `trd` part of a project (schema 1.15.0). */
export const trdStateSchema = z.object({ documents: z.array(trdDocumentSchema) }).superRefine((s, ctx) => {
  const seen = new Set<string>();
  for (const d of s.documents) {
    if (seen.has(d.id)) ctx.addIssue({ code: "custom", message: `TRD ${d.id} appears twice` });
    seen.add(d.id);
  }
});
export type TrdState = z.infer<typeof trdStateSchema>;
