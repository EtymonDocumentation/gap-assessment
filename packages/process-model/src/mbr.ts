import { z } from "zod";
import { SEED_STATUSES } from "./trd-seed";

/*
 * Master batch record (MBR) record (project schema 1.18.0). Module "mbr".
 *
 * Design notes (the why):
 *  - THE SITE DRAFTS, THE CMO COMPLETES. The record is a first draft: it lands the TRD values in the right steps and leaves a visible
 *    "To be completed by the CMO" placeholder for everything only the CMO can state (batch number, equipment IDs, signatures ...).
 *  - THE TRD VALUE IS COPIED, NEVER LINKED SILENTLY. A parameter row keeps a snapshot of the TRD value (with its source) so the record
 *    reads on its own, and the live TRD is compared with that snapshot to show "TRD value changed since this was set". The record is
 *    never rewritten without a click.
 *  - NO PRESELECTED CHOICE. The choice (same as TRD / tightened by the CMO / not decided) is absent until the author sets it; an absent
 *    choice reads "not decided". Nothing is assumed to be "same as TRD".
 *  - UNITS PER SIDE. The TRD unit and the MBR unit are held apart and never converted: a conversion would be a silent decision.
 *  - STEP NUMBERS ARE COMPUTED. Only the order of sections, blocks and steps is stored. A cross-reference is the id of a step inside the
 *    text ("[[step:ST-0007]]") and is shown as "(Step 9.14)", so adding, removing or moving a block renumbers everything correctly.
 *  - REPORT-ONLY NOTES. The record never blocks, refuses or rewrites on the strength of a comparison; the notes are information.
 *  - The record never states a regulatory filing category.
 */

/** Version of the MBR format (shapes, output). Independent of the project schema version. */
export const MBR_FORMAT_VERSION = "1.0.0";

export const MBR_CHOICES = ["same_as_trd", "tightened_by_cmo", "not_decided"] as const;
export type MbrChoice = (typeof MBR_CHOICES)[number];
/** Words for the choices. The unset choice reads as "not decided". */
export const MBR_CHOICE_LABEL: Record<MbrChoice, string> = {
  same_as_trd: "Same as TRD",
  tightened_by_cmo: "Tightened by the CMO",
  not_decided: "Not decided",
};

/** What the Choice column reads for a row. A study point is a challenge beyond a limit, not a limit, so it is never "Not decided". */
export const MBR_STUDY_POINT_CHOICE = "Study point (not a limit)";
export const mbrChoiceText = (row: { choice?: MbrChoice | undefined; studyPoint?: boolean | undefined }): string =>
  row.studyPoint ? MBR_STUDY_POINT_CHOICE : row.choice ? MBR_CHOICE_LABEL[row.choice] : "Not decided";

/** Where a TRD value is taken from. `field` is "setPoint", "nor" or "par" (the limits) or the key of an item field. */
export const MBR_TRD_COLLECTIONS = ["param", "equip", "mat", "ipc"] as const;

/** A copy of a TRD value with its place and sources, as it was when the author set it. Read-only in the MBR. */
export const mbrTrdRefSchema = z.object({
  trdId: z.string(),
  /** The TRD step (TS-nn). Absent when the TRD record has no step for this unit operation: the value is then not held by the site. */
  stepId: z.string().optional(),
  collection: z.enum(MBR_TRD_COLLECTIONS),
  itemKey: z.string().min(1),
  field: z.string().min(1),
  /** Site path of the value, e.g. "uo.sterile_filtration.param.max_pressure.setPoint". */
  path: z.string(),
  /** The TRD step the value sits in (its label), so the reader can find it. */
  section: z.string(),
  status: z.enum(SEED_STATUSES),
  /** The TRD value as a reader sees it, without the unit ("50 to 70", "72"). Absent when the TRD holds no value. */
  text: z.string().optional(),
  unit: z.string().optional(),
  /** Numeric ends of the value when the TRD gave them, for the report-only comparison. */
  min: z.number().optional(),
  max: z.number().optional(),
  provisional: z.literal(true).optional(),
  sourceIds: z.array(z.string()),
  locations: z.record(z.string(), z.object({ section: z.string().optional(), page: z.string().optional() })).optional(),
  copiedAt: z.string(),
});
export type MbrTrdRef = z.infer<typeof mbrTrdRefSchema>;

export const mbrParamRowSchema = z.object({
  /** R-0001 ... never reused inside a record. */
  id: z.string().regex(/^R-\d{4,}$/),
  /** The library parameter key this row came from (so an update from the library can match rows). */
  key: z.string().optional(),
  label: z.string().min(1),
  /** The TRD value as copied. Absent for a row with no TRD link (typed by the author). */
  trd: mbrTrdRefSchema.optional(),
  /** The MBR value as the author states it, and its own unit (never converted from the TRD unit). */
  mbrValue: z.string().optional(),
  mbrUnit: z.string().optional(),
  /** Never preselected: absent reads "not decided". */
  choice: z.enum(MBR_CHOICES).optional(),
  reason: z.string().optional(),
  /** A challenge or study value that is not a limit (e.g. a hold challenged beyond the TRD limit). No comparison note is shown. */
  studyPoint: z.literal(true).optional(),
});
export type MbrParamRow = z.infer<typeof mbrParamRowSchema>;

/** A sample row copied from the sampling plan; the plan stays the record of truth. */
export const mbrSampleRowSchema = z.object({
  id: z.string().regex(/^R-\d{4,}$/),
  planId: z.string(),
  pointId: z.string(),
  test: z.string(),
  step: z.string().optional(),
  quantity: z.string().optional(),
  container: z.string().optional(),
  storage: z.string().optional(),
  /** Hour on the plan's flow (from time zero) and the hold the sample is taken after, as text. */
  hour: z.string().optional(),
  hold: z.string().optional(),
});
export type MbrSampleRow = z.infer<typeof mbrSampleRowSchema>;

export const mbrTargetSchema = z.object({
  id: z.string().regex(/^R-\d{4,}$/),
  label: z.string().min(1),
  value: z.string().optional(),
  unit: z.string().optional(),
  /** The step range the target covers (step ids; shown as numbers). */
  fromStepId: z.string().optional(),
  toStepId: z.string().optional(),
});
export type MbrTarget = z.infer<typeof mbrTargetSchema>;

/** Two levels: the critical limit (from the TRD, with its source) and any number of targets under it. */
export const mbrTimeLimitSchema = z.object({
  id: z.string().regex(/^R-\d{4,}$/),
  label: z.string().min(1),
  key: z.string().optional(),
  trd: mbrTrdRefSchema.optional(),
  /** The critical limit as stated in the MBR (copied from the TRD value by "same as TRD", or typed). */
  value: z.string().optional(),
  unit: z.string().optional(),
  targets: z.array(mbrTargetSchema),
});
export type MbrTimeLimit = z.infer<typeof mbrTimeLimitSchema>;

export const mbrStepSchema = z.object({
  /** ST-0001 ... never reused inside a record. */
  id: z.string().regex(/^ST-\d{4,}$/),
  /** Step text. "[[step:ST-0007]]" is a cross-reference to another step and is shown as "(Step 9.14)". */
  text: z.string(),
});
export type MbrStep = z.infer<typeof mbrStepSchema>;

export const mbrBlockSchema = z.object({
  /** BL-001 ... never reused inside a record. */
  id: z.string().regex(/^BL-\d{3,}$/),
  /** The library block this was made from, and its version at that time. Absent for a block the author wrote. */
  libraryId: z.string().optional(),
  libraryVersion: z.number().int().min(1).optional(),
  title: z.string().min(1),
  steps: z.array(mbrStepSchema),
  params: z.array(mbrParamRowSchema),
  samples: z.array(mbrSampleRowSchema),
  timeLimits: z.array(mbrTimeLimitSchema),
  /** Labels of what only the CMO can state ("Batch number", "Equipment ID" ...), shown as "To be completed by the CMO". */
  cmoFields: z.array(z.string()),
  note: z.string().optional(),
});
export type MbrBlock = z.infer<typeof mbrBlockSchema>;

export const mbrSectionSchema = z.object({
  /** SC-01 ... never reused inside a record. */
  id: z.string().regex(/^SC-\d{2,}$/),
  /** Unit-operation key of the catalog. Absent for a section the author added. */
  unitOp: z.string().optional(),
  title: z.string().min(1),
  blocks: z.array(mbrBlockSchema),
});
export type MbrSection = z.infer<typeof mbrSectionSchema>;

export const mbrRecordSchema = z
  .object({
    /** MBR-001, MBR-002 ... */
    id: z.string().regex(/^MBR-\d{3,}$/),
    title: z.string().min(1),
    status: z.literal("draft"),
    docRef: z.string().optional(),
    version: z.string().optional(),
    /** What the record was started from. Both optional; a blank record has neither. */
    trdId: z.string().optional(),
    planId: z.string().optional(),
    purpose: z.string().optional(),
    sections: z.array(mbrSectionSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((r, ctx) => {
    const seen = new Map<string, string>();
    const take = (id: string, what: string) => {
      const k = `${what}:${id}`;
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `MBR ${r.id}: ${what} ${id} appears twice` });
      seen.set(k, id);
    };
    for (const s of r.sections) {
      take(s.id, "section");
      for (const b of s.blocks) {
        take(b.id, "block");
        for (const st of b.steps) take(st.id, "step");
        for (const p of b.params) take(p.id, "row");
        for (const p of b.samples) take(p.id, "row");
        for (const t of b.timeLimits) {
          take(t.id, "row");
          for (const g of t.targets) take(g.id, "row");
        }
      }
    }
  });
export type MbrRecord = z.infer<typeof mbrRecordSchema>;

/** The `mbr` part of a project (schema 1.18.0). */
export const mbrStateSchema = z.object({ records: z.array(mbrRecordSchema) }).superRefine((s, ctx) => {
  const seen = new Set<string>();
  for (const r of s.records) {
    if (seen.has(r.id)) ctx.addIssue({ code: "custom", message: `MBR ${r.id} appears twice` });
    seen.add(r.id);
  }
});
export type MbrState = z.infer<typeof mbrStateSchema>;

// ------------------------------------------------------------------ step-blocks library

/** A parameter a library block pulls from the TRD. The unit operation is the one of the section the block is placed in. */
export const mbrLibraryParamSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  collection: z.enum(MBR_TRD_COLLECTIONS),
  itemKey: z.string().min(1),
  /** "setPoint", "nor", "par" or a field key. Always stated: there is no default field. */
  field: z.string().min(1),
});
export type MbrLibraryParam = z.infer<typeof mbrLibraryParamSchema>;

export const mbrLibraryTimeLimitSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  collection: z.enum(MBR_TRD_COLLECTIONS),
  itemKey: z.string().min(1),
  field: z.string().min(1),
});
export type MbrLibraryTimeLimit = z.infer<typeof mbrLibraryTimeLimitSchema>;

/** The content of one block version (what is kept in the history when the block is edited). */
const libraryContent = {
  title: z.string().min(1),
  /** Unit operations the block is offered for. Empty: offered for any. */
  unitOps: z.array(z.string()),
  /** Step texts. They may hold "{placeholders}" for the author and "[[step:...]]" is not used in the library. */
  steps: z.array(z.string()),
  params: z.array(mbrLibraryParamSchema),
  timeLimits: z.array(mbrLibraryTimeLimitSchema),
  /** Words that select sampling-plan points for this block (matched against the point's attribute, case-insensitive). */
  sampleTypes: z.array(z.string()),
  cmoFields: z.array(z.string()),
  note: z.string().optional(),
};

export const mbrLibraryVersionSchema = z.object({ version: z.number().int().min(1), ...libraryContent, at: z.string().optional(), by: z.string().optional() });
export type MbrLibraryVersion = z.infer<typeof mbrLibraryVersionSchema>;

export const mbrLibraryBlockSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  version: z.number().int().min(1),
  ...libraryContent,
  /** True for a block the user created on the site (not in the shipped library). */
  custom: z.boolean().optional(),
  at: z.string().optional(),
  by: z.string().optional(),
  /** Earlier versions in full, newest last: a record made from version 1 can still be read after version 2 exists. */
  history: z.array(mbrLibraryVersionSchema).optional(),
});
export type MbrLibraryBlock = z.infer<typeof mbrLibraryBlockSchema>;

/** The shipped library file. */
export const mbrLibraryFileSchema = z
  .object({ formatVersion: z.string(), blocks: z.array(mbrLibraryBlockSchema) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    for (const b of f.blocks) {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", message: `Library block ${b.id} appears twice` });
      seen.add(b.id);
    }
  });
export type MbrLibraryFile = z.infer<typeof mbrLibraryFileSchema>;
