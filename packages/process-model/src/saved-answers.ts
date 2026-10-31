import { z } from "zod";
import { entryValueSchema } from "./schema";

/*
 * Saved answer sets: interview answers an author keeps outside any project (per account on the server, per browser on GitHub Pages) and
 * can offer to another project. A set is a LOAD-OUT, never a default: nothing is applied without the author's review of every answer.
 *
 * What a set holds, and why:
 *  - Only answers that are a real statement: a value, or "not applicable" with its justification. TBD, "same as SU" and unanswered
 *    questions are NOT saved. TBD stays TBD in the project it belongs to; "same as SU" would point at whatever the other project says.
 *  - Only the sending-unit (source) and/or receiving-unit (target) answers, chosen when the set is saved. Shared scoping answers are not
 *    saved: they decide which questions a project asks at all, so they belong to the project.
 *  - The question id, never the question text, so a set follows the catalog's wording as it changes. An id the catalog no longer has is
 *    shown as "not asked in this project" when the set is applied.
 */

export const SAVED_SET_FORMAT = "gap-saved-answers";
export const SAVED_SET_FORMAT_VERSION = 1;

/** One answered parameter field (set point, NOR, PAR ...): a value or a justified "not applicable", never TBD. */
const savedField = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), value: entryValueSchema }),
  z.object({ kind: z.literal("not_applicable"), justification: z.string().trim().min(1).max(2000) }),
]);

export const savedAnswerInputSchema = z.union([
  savedField,
  z.object({ kind: z.literal("composite"), fields: z.record(z.string().max(60), savedField) }),
]);
export type SavedAnswerInput = z.infer<typeof savedAnswerInputSchema>;

export const savedAnswerSchema = z.object({
  questionId: z.string().min(1).max(200),
  side: z.enum(["source", "target"]),
  input: savedAnswerInputSchema,
});
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;

export const savedAnswerSetSchema = z
  .object({
    format: z.literal(SAVED_SET_FORMAT),
    formatVersion: z.number().int().min(1).max(SAVED_SET_FORMAT_VERSION),
    id: z.string().max(80).optional(),
    name: z.string({ error: "The set needs a name." }).trim().min(1, "The set needs a name.").max(200, "The name is too long (200 characters at most)."),
    /** ISO timestamp the set was saved. */
    savedAt: z.string().max(40),
    /** Title of the project the answers came from (free text, kept for the list). */
    sourceProject: z.string().max(300),
    /** Which unit(s) the author chose when saving. */
    sides: z.enum(["source", "target", "both"]),
    answers: z.array(savedAnswerSchema).max(3000, "The set has too many answers."),
  })
  .passthrough()
  .superRefine((set, ctx) => {
    // A set saved for one unit cannot carry answers of the other: the list and the answers must say the same thing.
    set.answers.forEach((a, i) => {
      if (set.sides !== "both" && a.side !== set.sides) {
        ctx.addIssue({ code: "custom", path: ["answers", i, "side"], message: "An answer is for the other unit than the one the set says it holds." });
      }
    });
  });
/** A saved set as the tool holds it. The id is the library's own (a file the author imports has none until it is stored). */
export interface SavedAnswerSet {
  format: typeof SAVED_SET_FORMAT;
  formatVersion: number;
  id: string;
  name: string;
  savedAt: string;
  sourceProject: string;
  sides: "source" | "target" | "both";
  answers: SavedAnswer[];
}

/** Reads a saved set from untrusted JSON (an imported file or a server reply). The message is plain language for the author. */
export function parseSavedAnswerSet(raw: unknown): { ok: true; set: Omit<SavedAnswerSet, "id"> & { id?: string } } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "This file is not a saved answer set." };
  const r = raw as Record<string, unknown>;
  if (r.format !== SAVED_SET_FORMAT) return { ok: false, message: "This file is not a saved answer set. Choose a file made with Export set on the Saved answers page." };
  if (typeof r.formatVersion === "number" && r.formatVersion > SAVED_SET_FORMAT_VERSION) {
    return { ok: false, message: "This saved answer set was made by a newer version of the tool and cannot be read here." };
  }
  const res = savedAnswerSetSchema.safeParse(raw);
  if (res.success) return { ok: true, set: res.data as unknown as Omit<SavedAnswerSet, "id"> & { id?: string } };
  const issue = res.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  return { ok: false, message: `This saved answer set is damaged or incomplete: ${issue?.message ?? "it could not be read"}${where}.` };
}
