import { z } from "zod";

/*
 * The excipient library (M13 job 3): an ACCOUNT-level list of saved excipient records, kept beside the account's other libraries and never
 * inside a project file. A record holds what is worth reusing from one excipient line: its name, its class, the tests its specification is
 * compared on, and the person's own prompts (other tests the team often compares). It holds no answers about a product: no supplier, no
 * grade, no limit. A line made from a record is a copy; editing the record later never changes a project by itself.
 */

/** Version of the library record format. */
export const EXCIPIENT_LIBRARY_FORMAT_VERSION = "1.0.0";

const text = z.string().trim().min(1).max(300);
const noteText = z.string().trim().min(1).max(1000);

export const excipientLibraryTestSchema = z.object({
  test: text,
  /** Key of the class list's "often compared" prompt this test came from, when it did. */
  promptKey: z.string().min(1).max(80).optional(),
  note: noteText.optional(),
});
export type ExcipientLibraryTest = z.infer<typeof excipientLibraryTestSchema>;

const contentFields = {
  name: text,
  /** Key of a class of content/excipient/classes.yaml. Never together with `classLabel`. */
  classKey: z.string().min(1).max(80).optional(),
  /** The person's own words for the role when no listed class fits. */
  classLabel: text.optional(),
  tests: z.array(excipientLibraryTestSchema).max(200),
  /** The person's own prompts: other tests the team often compares for this excipient, offered as buttons on the Specifications tab. */
  prompts: z.array(text).max(100),
};

const exactlyOneClass = (v: { classKey?: string | undefined; classLabel?: string | undefined }, ctx: z.RefinementCtx) => {
  if (v.classKey && v.classLabel) ctx.addIssue({ code: "custom", message: "A saved excipient has a listed class or the person's own words, not both" });
};
const uniqueTests = (v: { tests: { test: string }[] }, ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const t of v.tests) {
    const k = t.test.toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: "custom", message: `The test "${t.test}" is listed twice` });
    seen.add(k);
  }
};

/** An earlier version of a record: the whole content, kept so nothing is overwritten without a copy. */
export const excipientLibraryVersionSchema = z
  .object({ version: z.number().int().min(1), ...contentFields, at: z.string().max(40).optional(), by: z.string().max(120).optional() })
  .superRefine(exactlyOneClass);
export type ExcipientLibraryVersion = z.infer<typeof excipientLibraryVersionSchema>;

/** The id is made from the name ("xl_buffer_salt_a") and is the file name on the server, so only these characters are allowed. */
export const EXCIPIENT_LIBRARY_ID = /^xl_[a-z0-9_]{1,56}$/;

export const excipientLibraryRecordSchema = z
  .object({
    id: z.string().regex(EXCIPIENT_LIBRARY_ID),
    version: z.number().int().min(1),
    ...contentFields,
    at: z.string().max(40).optional(),
    by: z.string().max(120).optional(),
    history: z.array(excipientLibraryVersionSchema).max(200).optional(),
  })
  .superRefine(exactlyOneClass)
  .superRefine(uniqueTests);
export type ExcipientLibraryRecord = z.infer<typeof excipientLibraryRecordSchema>;
