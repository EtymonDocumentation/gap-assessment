import { SAMPLING_TYPES } from "@gap/process-model";
import { z } from "zod";

/**
 * The word lists of the fixed-rule reader for a sampling plan written by somebody else (content/sampling-import/synonyms.yaml).
 * They are WORDS TO RECOGNISE, never answers: a word here lets the reader suggest where a cell of the document belongs, and a person
 * still accepts every suggestion. The schema is strict, so a stray key or a value in the file stops the build.
 */

export const SAMPLING_SYNONYMS_ID = "sampling-import-synonyms";

/** What a header of a points table can name. */
export const SAMPLING_COLUMN_KINDS = ["step", "attribute", "test", "amount", "timing", "type"] as const;
export type SamplingColumnKind = (typeof SAMPLING_COLUMN_KINDS)[number];

/** The timing words the reader can turn into one of the plan's timing options. Only these three are positions in the run. */
export const TIMING_WORD_OPTIONS = ["beginning", "middle", "end"] as const;

const words = z.array(z.string().min(1)).min(1);

export const samplingSynonymsSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(SAMPLING_SYNONYMS_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  /** Table header words -> the point column. */
  columns: z.array(z.strictObject({ kind: z.enum(SAMPLING_COLUMN_KINDS), words })).min(1),
  /** Words that name a study type ("in-process", "lot release"). The tool's own type names are recognised as well. */
  types: z.array(z.strictObject({ type: z.enum(SAMPLING_TYPES), words })).min(1),
  /** Extra names of process steps (the catalog's own step names are used as well). */
  steps: z.array(z.strictObject({ uo: z.string().min(1), words })).default([]),
  /** Words in a timing cell that stand for a position in the run. */
  timing: z.array(z.strictObject({ option: z.enum(TIMING_WORD_OPTIONS), words })).min(1),
});
export type SamplingImportSynonyms = z.infer<typeof samplingSynonymsSchema>;

/** Validates the raw YAML; throws a readable message. The unit operations are checked against the catalog when it is given. */
export function parseSamplingImportSynonyms(raw: unknown, unitOps: readonly string[] = []): SamplingImportSynonyms {
  const r = samplingSynonymsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Sampling import synonyms are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  if (unitOps.length) {
    for (const s of r.data.steps) if (!unitOps.includes(s.uo)) throw new Error(`Sampling import synonyms are invalid: unknown unit operation "${s.uo}"`);
  }
  return r.data;
}
