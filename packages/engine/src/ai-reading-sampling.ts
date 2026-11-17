import { z } from "zod";
import { AI_EVIDENCE_PREFIX, aiCountText, locateQuote } from "./ai-reading";
import { linkCells } from "./import-shared";
import {
  checkSamplingValue,
  emptyField,
  resolveSamplingType,
  SAMPLING_COLUMN_LABEL,
  SAMPLING_COLUMNS,
  type SamplingColumn,
  type SamplingField,
  type SamplingImportSession,
  type SamplingRow,
} from "./sampling-import";
import type { SamplingImportSynonyms } from "./sampling-synonyms";
import { TYPE_LABEL } from "@gap/sampling";

/**
 * The PRE-RECORDED "AI reading" of the example finished sampling plan (job AI2). No AI runs: a fixed list of suggested sampling POINTS was
 * written in advance for ONE fictional Word file (content/ai-reading/example-sampling-plan.yaml). This module checks that list and lays it
 * on top of the review session the fixed rules built from that file, as whole extra rows.
 *
 * It keeps the same promises as the example TRD reading (ai-reading.ts), which it shares its words and its quote finder with:
 *  - A SUGGESTION IS NEVER AN ANSWER. Every AI value is "ai_suggested" (label "AI suggestion"): no "Accept all" takes it; the person
 *    accepts or rejects each point.
 *  - THE RULES KEEP WHAT THEY FOUND. A point whose passage a rule already read, or that has the same step and attribute as a rule's row,
 *    is skipped, never laid over theirs.
 *  - EVERY POINT SHOWS ITS SOURCE. A point with a quote that is not in the file as read is skipped.
 *  - NOTHING IS INVENTED OR CONVERTED. The attribute, test, amount and timing are the words of a quote, unit as written. Only the
 *    process step and the study type are mapped to the catalogue's names; a point never gets a value the passage does not give.
 */

export const AI_SAMPLING_READING_ID = "ai-reading-example-sampling-plan";

export const aiSamplingReadingSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(AI_SAMPLING_READING_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  points: z
    .array(
      z.strictObject({
        /** The catalogue step name this point belongs to ("Sterile filtration"). A mapping, so it need not be in a quote. */
        step: z.string().min(1),
        attribute: z.string().min(1).optional(),
        test: z.string().min(1).optional(),
        /** One number with its unit, as written ("100 mL"). */
        amount: z.string().min(1).optional(),
        timing: z.string().min(1).optional(),
        /** The study type, by the tool's own name ("Hold time"). A mapping, so it need not be in a quote. */
        type: z.string().min(1).optional(),
        /** The passages the point rests on, word for word. */
        quotes: z.array(z.string().min(1)).min(1),
        where: z.string().min(1),
        why: z.string().min(1),
        /** A point a careful reviewer should reject (for the tests and the walkthrough). */
        reject: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type AiSamplingReading = z.infer<typeof aiSamplingReadingSchema>;
export type AiSamplingPoint = AiSamplingReading["points"][number];

/** Validates the raw YAML; throws a readable message. */
export function parseAiSamplingReading(raw: unknown): AiSamplingReading {
  const r = aiSamplingReadingSchema.safeParse(raw);
  if (!r.success) throw new Error(`The AI reading of the sampling plan is invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  return r.data;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The columns an AI point can give, in the order of the review table. */
const VALUE_COLUMNS = ["attribute", "test", "amount", "timing"] as const;

export interface AiSamplingContext {
  syn: SamplingImportSynonyms;
  /** The catalogue's step names (and "Finished product"): a point's step must be one of them. */
  stepLabels: readonly string[];
}

export interface AiSamplingOverlayResult {
  session: SamplingImportSession;
  /** Points that are now rows of the session. */
  added: number;
  skipped: { point: string; reason: string }[];
}

const pointName = (s: AiSamplingPoint) => `${s.step}: ${s.attribute ?? s.test ?? s.quotes[0]!.slice(0, 40)}`;

/**
 * Lays the recorded points over a level-3 session built from the example file. The session is copied; the rules' own rows are not
 * touched. Each point becomes one new row (one card on the screen) after the rules' rows.
 */
export function overlaySamplingAiReading(base: SamplingImportSession, reading: AiSamplingReading, ctx: AiSamplingContext): AiSamplingOverlayResult {
  const session: SamplingImportSession = {
    ...base,
    rows: base.rows.map((r) => ({ ...r })),
    fields: base.fields.map((f) => ({ ...f })),
    cellFields: structuredClone(base.cellFields),
    fieldCells: structuredClone(base.fieldCells),
    aiExample: true,
  };
  const skipped: AiSamplingOverlayResult["skipped"] = [];
  let added = 0;
  const ruleKey = (row: number) => {
    const v = (c: SamplingColumn) => squash(base.fields.find((f) => f.row === row && f.column === c)?.value ?? "");
    return `${v("step")}|${v("attribute")}`;
  };
  const ruleKeys = new Set(base.rows.map((r) => ruleKey(r.n)));
  const stepNames = new Map(ctx.stepLabels.map((l) => [squash(l), l]));
  let n = Math.max(0, ...base.rows.map((r) => r.n));

  for (const s of reading.points) {
    const name = pointName(s);
    const skip = (reason: string) => skipped.push({ point: name, reason });
    const step = stepNames.get(squash(s.step));
    if (!step) {
      skip("the step is not a step of the catalogue");
      continue;
    }
    const where = s.quotes.map((q) => locateQuote(session.blocks, q));
    if (where.some((w) => !w)) {
      skip("a quote is not in the file");
      continue;
    }
    // The rules read a passage: the point is theirs, not the AI's.
    if (where.some((w) => (base.cellFields[w!]?.length ?? 0) > 0)) {
      skip("the fixed rules already read that passage");
      continue;
    }
    if (ruleKeys.has(`${squash(step)}|${squash(s.attribute ?? "")}`)) {
      skip("the fixed rules already found a point with this step and attribute");
      continue;
    }
    // Every value is the words of a quote; the unit stays as written.
    const quoteText = s.quotes.map(squash);
    const inQuote = (v: string) => quoteText.some((q) => q.includes(squash(v)));
    const bad = VALUE_COLUMNS.find((c) => s[c] !== undefined && !inQuote(s[c]!));
    if (bad) {
      skip(`the ${bad} is not in the quote`);
      continue;
    }
    const kind = s.type ? resolveSamplingType(s.type, ctx.syn) : undefined;
    if (s.type && !kind) {
      skip("the type is not a study type of the tool");
      continue;
    }
    const typeLabel = kind ? TYPE_LABEL[kind] : undefined;
    const value: Record<SamplingColumn, string | undefined> = { step, attribute: s.attribute, test: s.test, amount: s.amount, timing: s.timing, type: typeLabel };
    const unreadable = SAMPLING_COLUMNS.map((c) => (value[c] ? checkSamplingValue(c, value[c]!, ctx.syn) : undefined)).find(Boolean);
    if (unreadable) {
      skip(unreadable);
      continue;
    }

    n++;
    const row: SamplingRow = { n, label: `AI point ${added + 1}`, where: s.where, ai: { quotes: s.quotes, where: s.where, why: s.why } };
    session.rows.push(row);
    SAMPLING_COLUMNS.forEach((c) => {
      const f: SamplingField = emptyField(n, c, SAMPLING_COLUMN_LABEL[c], `AI reading: ${SAMPLING_COLUMN_LABEL[c]} not found in the document`);
      const v = value[c];
      if (v) {
        // The evidence is the passage that holds the value; the step and the type are read from the whole point, so they cite the first.
        const q = s.quotes.find((x) => squash(x).includes(squash(v))) ?? s.quotes[0]!;
        Object.assign(f, { value: v, confidence: "ai_suggested" as const, source: `${AI_EVIDENCE_PREFIX}${q}`, ai: { quote: q, where: s.where, why: s.why } });
        const at = where[s.quotes.indexOf(q)]!;
        linkCells(session, f.id, at);
      }
      session.fields.push(f);
    });
    added++;
  }
  return { session, added, skipped };
}

/** The rows that are AI suggestions (one card each). */
export const aiRowsOf = (s: SamplingImportSession): SamplingRow[] => s.rows.filter((r) => r.ai);

/** The text of an AI row as a point reads: "Sterile filtration, bioburden, 100 mL, at the end of the hold". */
export function aiRowFields(s: SamplingImportSession, row: SamplingRow): SamplingField[] {
  return SAMPLING_COLUMNS.map((c) => s.fields.find((f) => f.row === row.n && f.column === c)!);
}

/** "Rules found N. AI suggests M more." Both count points (rows): the rules' rows with at least one value, and the AI's rows. */
export function samplingAiCounts(s: SamplingImportSession): { rules: number; ai: number } {
  const rules = s.rows.filter((r) => !r.ai && s.fields.some((f) => f.row === r.n && f.value !== "")).length;
  return { rules, ai: aiRowsOf(s).length };
}

export const samplingAiCountText = (c: { rules: number; ai: number }) => aiCountText(c);

