import { z } from "zod";
import { AI_EVIDENCE_PREFIX, aiCountText, locateQuote } from "./ai-reading";
import type { ContentBundle } from "./content";
import type { Question } from "./content-schema";
import { emptyGapField, ensureGapRow, GAP_SIDE_LABEL, sortGapRows, checkGapValue, type GapField, type GapImportSession, type GapRow, type GapSide } from "./gap-import";
import type { GapImportSynonyms } from "./gap-synonyms";
import { linkCells } from "./import-shared";

/**
 * The PRE-RECORDED "AI reading" of the example finished gap assessment (job AI3). No AI runs: a fixed list of suggested gap ITEMS was written
 * in advance for ONE fictional Word file (content/ai-reading/example-gap-assessment.yaml). A gap item is one question of the catalogue with its
 * answer for the sending unit, the receiving unit, or both. This module checks that list and lays it on top of the review session the
 * fixed rules built from that file, as whole extra rows (one card each on the screen).
 *
 * It keeps the promises of the other two example readings (ai-reading.ts, ai-reading-sampling.ts), whose words and quote finder it shares:
 *  - A SUGGESTION IS NEVER AN ANSWER. Every AI answer is "ai_suggested" (label "AI suggestion"): no "Accept all" takes it; the person
 *    accepts or rejects each item.
 *  - THE RULES KEEP WHAT THEY FOUND. An item for a question a rule already read, or from a passage a rule already read, is skipped.
 *  - EVERY ITEM SHOWS ITS SOURCE. An item with a quote that is not in the file as read is skipped.
 *  - THE TOOL NEVER RATES. An answer is a choice or a value of the question, put in only when it parses exactly like a typed answer (the
 *    same checkGapValue as the review screen), so nothing is converted or defaulted. An answer the text does not state stays empty, and
 *    a recorded answer a careful reviewer should reject (an inferred rating, an item that is already closed) is marked for the walkthrough.
 *  - The tool never decides a filing category: nothing here touches one.
 */

export const AI_GAP_READING_ID = "ai-reading-example-gap-assessment";

export const aiGapReadingSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(AI_GAP_READING_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  items: z
    .array(
      z.strictObject({
        /** The catalogue question this item answers ("rt.thaw_principle"). */
        question: z.string().min(1),
        /** The answer for each unit the question is asked of, in the question's own words (a choice's label, a number with its unit). */
        source: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        shared: z.string().min(1).optional(),
        /** The passages the item rests on, word for word. */
        quotes: z.array(z.string().min(1)).min(1),
        where: z.string().min(1),
        why: z.string().min(1),
        /** An item a careful reviewer should reject (for the tests and the walkthrough). */
        reject: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type AiGapReading = z.infer<typeof aiGapReadingSchema>;
export type AiGapItem = AiGapReading["items"][number];

/** Validates the raw YAML; throws a readable message. */
export function parseAiGapReading(raw: unknown): AiGapReading {
  const r = aiGapReadingSchema.safeParse(raw);
  if (!r.success) throw new Error(`The AI reading of the gap assessment is invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  const seen = new Set<string>();
  for (const it of r.data.items) {
    if (seen.has(it.question)) throw new Error(`The AI reading of the gap assessment is invalid: question ${it.question} is suggested twice.`);
    seen.add(it.question);
    if (!it.source && !it.target && !it.shared) throw new Error(`The AI reading of the gap assessment is invalid: question ${it.question} has no answer.`);
  }
  return r.data;
}

export interface AiGapOverlayResult {
  session: GapImportSession;
  /** Items that are now rows of the session. */
  added: number;
  skipped: { item: string; reason: string }[];
}

const SIDES: GapSide[] = ["source", "target", "shared"];

/**
 * Lays the recorded items over a level-3 session built from the example file. The session is copied; the rules' own rows are not touched.
 * Each item becomes one new row (one card on the screen), placed in the order of the catalogue.
 */
export function overlayGapAiReading(base: GapImportSession, reading: AiGapReading, ctx: { content: ContentBundle; syn: GapImportSynonyms }): AiGapOverlayResult {
  const { content, syn } = ctx;
  const session: GapImportSession = {
    ...base,
    rows: base.rows.map((r) => ({ ...r })),
    fields: base.fields.map((f) => ({ ...f })),
    cellFields: structuredClone(base.cellFields),
    fieldCells: structuredClone(base.fieldCells),
    aiExample: true,
  };
  const skipped: AiGapOverlayResult["skipped"] = [];
  let added = 0;
  const ruleQuestions = new Set(base.rows.map((r) => r.questionId));

  for (const it of reading.items) {
    const skip = (reason: string) => skipped.push({ item: it.question, reason });
    const q = content.questionById.get(it.question);
    if (!q) {
      skip("the question is not in the catalogue");
      continue;
    }
    // The rules read a question: the item is theirs, not the AI's.
    if (ruleQuestions.has(q.id)) {
      skip("the fixed rules already read this question");
      continue;
    }
    const where = it.quotes.map((x) => locateQuote(session.blocks, x));
    if (where.some((w) => !w)) {
      skip("a quote is not in the file");
      continue;
    }
    if (where.some((w) => (base.cellFields[w!]?.length ?? 0) > 0)) {
      skip("the fixed rules already read that passage");
      continue;
    }
    const row0: GapRow = ensureGapRowFor(content, q);
    const given = SIDES.filter((s) => it[s] !== undefined);
    const wrongSide = given.find((s) => !row0.sides.includes(s));
    if (wrongSide) {
      skip(`the question is not asked of ${GAP_SIDE_LABEL[wrongSide]}`);
      continue;
    }
    const unreadable = given.map((s) => checkGapValue(content, q, s, it[s]!, syn)).find(Boolean);
    if (unreadable) {
      skip(unreadable);
      continue;
    }

    const row = ensureGapRow(content, session, q, it.where);
    row.ai = { quotes: it.quotes, where: it.where, why: it.why };
    for (const side of row.sides) {
      const f: GapField = emptyGapField(q.id, side, `AI reading: no answer for the ${GAP_SIDE_LABEL[side]} in the document`);
      const v = it[side];
      if (v !== undefined) {
        // One passage holds the answers of one item; the first quote is the evidence, the others only show more of the same item.
        Object.assign(f, { value: v, confidence: "ai_suggested" as const, source: `${AI_EVIDENCE_PREFIX}${it.quotes[0]}`, ai: { quote: it.quotes[0]!, where: it.where, why: it.why } });
        linkCells(session, f.id, where[0]!);
      }
      session.fields.push(f);
    }
    added++;
  }
  sortGapRows(content, session);
  return { session, added, skipped };
}

/** What the row of a question looks like (its sides), without adding it to any session. */
function ensureGapRowFor(content: ContentBundle, q: Question): GapRow {
  const scratch = { rows: [] as GapRow[] } as unknown as GapImportSession;
  return ensureGapRow(content, scratch, q);
}

/** The rows that are AI suggestions (one card each). */
export const aiGapRowsOf = (s: GapImportSession): GapRow[] => s.rows.filter((r) => r.ai);

/** The fields of an AI row: one for each unit the question is asked of (an empty one is "not established"). */
export const aiGapRowFields = (s: GapImportSession, row: GapRow): GapField[] => s.fields.filter((f) => f.row === row.questionId);

/** "Rules found N. AI suggests M more." Both count gap items (rows): the rules' rows with at least one answer, and the AI's rows. */
export function gapAiCounts(s: GapImportSession): { rules: number; ai: number } {
  const rules = s.rows.filter((r) => !r.ai && s.fields.some((f) => f.row === r.questionId && f.value !== "")).length;
  return { rules, ai: aiGapRowsOf(s).length };
}

export const gapAiCountText = (c: { rules: number; ai: number }) => aiCountText(c);
