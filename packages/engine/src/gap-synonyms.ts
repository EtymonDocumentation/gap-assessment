import { z } from "zod";

/**
 * The word lists of the fixed-rule reader for a gap assessment written by somebody else (content/gap-import/synonyms.yaml).
 * They are WORDS TO RECOGNISE, never answers: a word here lets the reader suggest which question of the catalogue a row of the document
 * is about, or which column holds the sending or the receiving answer, and a person still accepts every suggestion. The schema is strict,
 * so a stray key or a value in the file stops the build.
 */

export const GAP_SYNONYMS_ID = "gap-import-synonyms";

/** What a header of a question table can name. "answer" is ONE answer column that does not say which site it is about. */
export const GAP_COLUMN_KINDS = ["question", "source", "target", "answer"] as const;
export type GapColumnKind = (typeof GAP_COLUMN_KINDS)[number];

const words = z.array(z.string().min(1)).min(1);

export const gapSynonymsSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(GAP_SYNONYMS_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  /** Table header words -> the column. */
  columns: z.array(z.strictObject({ kind: z.enum(GAP_COLUMN_KINDS), words })).min(1),
  /** Other ways documents write a question of the catalogue (the question's own prompt and label are used as well). */
  questions: z.array(z.strictObject({ id: z.string().min(1), words })).default([]),
  /** Words that mean yes / no in an answer cell. */
  yesNo: z.strictObject({ yes: words, no: words }),
  /** Words in a heading that name a section of the catalogue (its own title is used as well). */
  sections: z.array(z.strictObject({ id: z.string().min(1), words })).default([]),
});
export type GapImportSynonyms = z.infer<typeof gapSynonymsSchema>;

/** Validates the raw YAML; throws a readable message. Question and section ids are checked against the catalogue when it is given. */
export function parseGapImportSynonyms(raw: unknown, ids: { questions?: readonly string[]; sections?: readonly string[] } = {}): GapImportSynonyms {
  const r = gapSynonymsSchema.safeParse(raw);
  if (!r.success) throw new Error(`Gap import synonyms are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  if (ids.questions?.length) for (const q of r.data.questions) if (!ids.questions.includes(q.id)) throw new Error(`Gap import synonyms are invalid: unknown question "${q.id}"`);
  if (ids.sections?.length) for (const s of r.data.sections) if (!ids.sections.includes(s.id)) throw new Error(`Gap import synonyms are invalid: unknown section "${s.id}"`);
  return r.data;
}
