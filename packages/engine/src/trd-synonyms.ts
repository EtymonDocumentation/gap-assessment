import { z } from "zod";

/**
 * The word lists of the fixed-rule reader for documents written by somebody else (content/trd-import/synonyms.yaml). They are
 * WORDS TO RECOGNISE, never answers: a word here lets the reader suggest where a number in the file belongs, and a person still accepts
 * every suggestion. The schema is strict, so a stray key or a value in the file stops the build.
 */

export const SYNONYMS_ID = "trd-import-synonyms";

/** Table header kinds. "limit", "hold" and "time" are recognised but do not say which range they belong to, so they stay unresolved. */
export const COLUMN_KINDS = ["name", "step", "set", "nor", "par", "unit", "low", "high", "limit", "hold", "time"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

const words = z.array(z.string().min(1)).min(1);

export const trdSynonymsSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(SYNONYMS_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  /** Heading words -> the TRD text field the paragraphs below the heading are suggested for. */
  sections: z.array(z.strictObject({ field: z.enum(["trd.purpose", "trd.scopeNote"]), words })).min(1),
  /** "Label: value" lines and two-column tables -> document and product fields. */
  labels: z.array(z.strictObject({ field: z.string().regex(/^trd\.(title|docRef|version|purpose|scopeNote|detail\.[a-zA-Z]+)$/), words })).min(1),
  /** Table header words -> parameter columns. */
  columns: z.array(z.strictObject({ kind: z.enum(COLUMN_KINDS), words })).min(1),
  /** Words that name a process step (the catalog's own step names are used as well). */
  steps: z.array(z.strictObject({ uo: z.string().min(1), words })).default([]),
  /** Unit words by kind, for the rows that only count with a unit of that kind. */
  unitKinds: z.record(z.string().regex(/^[a-z]+$/), words),
  /** Extra names of catalog parameters. */
  parameters: z
    .array(
      z.strictObject({
        uo: z.string().min(1),
        key: z.string().regex(/^[a-z0-9_]+$/),
        words: words,
        /** Words that only count when the document gives a unit of this kind ("fill weight" is a fill volume only when the unit is a volume). */
        onlyWithUnit: z.array(z.strictObject({ kind: z.string().regex(/^[a-z]+$/), words })).default([]),
      }),
    )
    .default([]),
});
export type TrdSynonyms = z.infer<typeof trdSynonymsSchema>;

/** Validates the raw YAML; throws a readable message. The unit operations and parameters are checked against the catalog when it is given. */
export function parseTrdSynonyms(raw: unknown, params: readonly { uo: string; key: string }[] = [], unitOps: readonly string[] = []): TrdSynonyms {
  const r = trdSynonymsSchema.safeParse(raw);
  if (!r.success) throw new Error(`TRD import synonyms are invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  if (unitOps.length) {
    for (const s of r.data.steps) if (!unitOps.includes(s.uo)) throw new Error(`TRD import synonyms are invalid: unknown unit operation "${s.uo}"`);
  }
  if (params.length) {
    for (const p of r.data.parameters) if (!params.some((x) => x.uo === p.uo && x.key === p.key)) throw new Error(`TRD import synonyms are invalid: "${p.uo}" has no parameter "${p.key}"`);
  }
  for (const p of r.data.parameters) for (const o of p.onlyWithUnit) if (!(o.kind in r.data.unitKinds)) throw new Error(`TRD import synonyms are invalid: unknown unit kind "${o.kind}"`);
  return r.data;
}
