import { z } from "zod";
import type { ViewBlock } from "./import-shared";
import type { ImportField, ImportSession } from "./trd-import";

/**
 * The PRE-RECORDED "AI reading" of the example finished TRD (job AI1). No AI runs: a fixed list of suggestions was written in advance
 * for ONE fictional Word file (content/ai-reading/example-trd.yaml). This module checks that list and lays it on top of the review
 * session the fixed rules built from that file, so the review screen can show what the rules found and what an AI reader could add.
 *
 * What it guarantees (each one is a GMP or product rule):
 *  - A SUGGESTION IS NEVER AN ANSWER. Every AI value gets the confidence "ai_suggested" (label "AI suggestion"). It is not "exact" and not
 *    "matched", so no "Accept all" button takes it; the person accepts or rejects each one.
 *  - THE RULES KEEP WHAT THEY FOUND. A suggestion for a field the fixed rules already filled is skipped, never laid over their value.
 *  - EVERY SUGGESTION SHOWS ITS SOURCE. A suggestion whose quote cannot be found in the file as read is skipped, so nothing is shown
 *    without the passage it came from.
 *  - The evidence kept in the change log says where the value came from: "AI suggestion (pre-recorded example): <quote>".
 */

export const AI_READING_ID = "ai-reading-example-trd";

/** The words in front of the quote in the change-log evidence and on the review row. */
export const AI_EVIDENCE_PREFIX = "AI suggestion (pre-recorded example): ";

export const aiReadingSchema = z.strictObject({
  catalog: z.strictObject({ id: z.literal(AI_READING_ID), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  suggestions: z
    .array(
      z.strictObject({
        field: z.string().min(1),
        value: z.string().min(1),
        quote: z.string().min(1),
        where: z.string().min(1),
        why: z.string().min(1),
        /** A suggestion a careful reviewer should reject (for the tests and the walkthrough). */
        reject: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type AiReading = z.infer<typeof aiReadingSchema>;
export type AiSuggestion = AiReading["suggestions"][number];

/** Validates the raw YAML; throws a readable message. */
export function parseAiReading(raw: unknown): AiReading {
  const r = aiReadingSchema.safeParse(raw);
  if (!r.success) throw new Error(`The AI reading is invalid:\n${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("\n")}`);
  const seen = new Set<string>();
  for (const s of r.data.suggestions) {
    if (seen.has(s.field)) throw new Error(`The AI reading is invalid: field ${s.field} is suggested twice.`);
    seen.add(s.field);
  }
  return r.data;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Where a quote sits in the document as read: a paragraph ("block:p") or a table cell ("block:row:col"), the same keys the review
 * screen uses to focus a passage. Undefined when the quote is not in the document.
 */
export function locateQuote(blocks: readonly ViewBlock[], quote: string): string | undefined {
  const q = squash(quote);
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]!;
    if (b.kind === "para" && squash(b.text).includes(q)) return `${bi}:p`;
    if (b.kind === "table") {
      for (let ri = 0; ri < b.rows.length; ri++) {
        const row = b.rows[ri]!;
        for (let ci = 0; ci < row.length; ci++) if (!row[ci]!.vContinue && squash(row[ci]!.text).includes(q)) return `${bi}:${ri}:${ci}`;
      }
    }
  }
  return undefined;
}

export interface AiOverlayResult {
  session: ImportSession;
  /** Suggestions that are now fields of the session. */
  added: number;
  /** Suggestions left out, with the reason (the field is unknown, the rules had it, or the quote is not in the file). */
  skipped: { field: string; reason: string }[];
}

/**
 * Lays the recorded suggestions over a level-3 session built from the example file. The session is copied; the rules' own fields are not
 * touched. Fields that gain a suggestion keep their id, label and group, so the review screen shows them in the same row as the rule's values.
 */
export function overlayAiReading(base: ImportSession, reading: AiReading): AiOverlayResult {
  const session: ImportSession = { ...base, fields: base.fields.map((f) => ({ ...f })), cellFields: structuredClone(base.cellFields), fieldCells: structuredClone(base.fieldCells), aiExample: true };
  const skipped: AiOverlayResult["skipped"] = [];
  let added = 0;
  for (const s of reading.suggestions) {
    const f = session.fields.find((x) => x.id === s.field);
    if (!f) {
      skipped.push({ field: s.field, reason: "the field is not in the catalogue" });
      continue;
    }
    if (f.confidence !== "not_found" || f.value !== "") {
      skipped.push({ field: s.field, reason: "the fixed rules already found a value" });
      continue;
    }
    const at = locateQuote(session.blocks, s.quote);
    if (!at) {
      skipped.push({ field: s.field, reason: "the quote is not in the file" });
      continue;
    }
    f.value = s.value;
    f.confidence = "ai_suggested";
    f.source = `${AI_EVIDENCE_PREFIX}${s.quote}`;
    f.ai = { quote: s.quote, where: s.where, why: s.why };
    (session.cellFields[at] ??= []).push(f.id);
    (session.fieldCells[f.id] ??= []).push(at);
    added++;
  }
  return { session, added, skipped };
}

/**
 * What the person sees and decides on: ONE CARD per parameter (all the parts the AI read for it: set point, limits, unit) and one per
 * document or product field. A parameter is not split into "value" and "unit" cards: one Accept writes all its parts, one Reject
 * rejects all of them. The count line counts these cards.
 */
export interface AiCard {
  /** The parameter's id without the part ("trd.step.<step>.param.<key>"), or the field id for a document or product field. */
  key: string;
  /** The parameter name, or the field label. */
  title: string;
  /** The fields (parts) the card holds, in the order of the session. */
  fields: ImportField[];
  /** The value as the parameter would read, for example "PAR up to 24 h". */
  valueText: string;
  /** The passages the card rests on, each once (parts of one parameter usually share one sentence). */
  quotes: string[];
  where: string;
  why: string;
}

const PARAM_PART = /^(trd.step.[^.]+.param.[^.]+).(set|nor_low|nor_high|par_low|par_high|unit)$/;
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

/** "Set point 20 °C, PAR up to 24 h": the parts of one parameter in the words a reader of the TRD would use. */
export function paramValueText(parts: Record<string, string>): string {
  const u = parts.unit ? ` ${parts.unit}` : "";
  const range = (name: string, lo?: string, hi?: string) => (lo && hi ? `${name} ${lo} to ${hi}${u}` : lo ? `${name} from ${lo}${u}` : hi ? `${name} up to ${hi}${u}` : "");
  const out = [parts.set ? `Set point ${parts.set}${u}` : "", range("NOR", parts.nor_low, parts.nor_high), range("PAR", parts.par_low, parts.par_high)].filter(Boolean);
  return out.length > 0 ? out.join(", ") : parts.unit ?? "";
}

/** Groups the AI suggestions among these fields into cards, in order of first appearance. */
export function aiCardsOf(fields: ImportField[]): AiCard[] {
  const cards = new Map<string, { m: RegExpExecArray | null; fields: ImportField[] }>();
  for (const f of fields) {
    if (!f.ai || f.value === "" || f.confidence !== "ai_suggested") continue;
    const m = PARAM_PART.exec(f.id);
    const key = m ? m[1]! : f.id;
    const c = cards.get(key) ?? { m, fields: [] };
    c.fields.push(f);
    cards.set(key, c);
  }
  return [...cards].map(([key, c]) => {
    const first = c.fields[0]!;
    const parts: Record<string, string> = {};
    for (const f of c.fields) {
      const m = PARAM_PART.exec(f.id);
      if (m) parts[m[2]!] = f.value;
    }
    return {
      key,
      title: c.m ? first.sub || first.label : first.label,
      fields: c.fields,
      valueText: c.m ? paramValueText(parts) : first.value,
      quotes: uniq(c.fields.map((f) => f.ai!.quote)),
      where: uniq(c.fields.map((f) => f.ai!.where)).join("; "),
      why: first.ai!.why, // the first part carries the reason; later parts (the unit) only repeat where to look
    };
  });
}

/** "Rules found N. AI suggests M more." The numbers come from the session as it is: both count what a person sees, a parameter once. */
export function aiCounts(s: ImportSession): { rules: number; ai: number } {
  // The rules' values are counted the same way, so the two numbers are comparable: a parameter counts once, not once per part.
  const found = new Set<string>();
  for (const f of s.fields) if (f.value !== "" && (f.confidence === "exact" || f.confidence === "matched")) found.add(PARAM_PART.exec(f.id)?.[1] ?? f.id);
  return { rules: found.size, ai: aiCardsOf(s.fields).length };
}

export function aiCountText(c: { rules: number; ai: number }): string {
  return `Rules found ${c.rules}. AI suggests ${c.ai} more.`;
}
