import { z } from "zod";

/*
 * Readers for the two content files of the Excipient assessment: content/excipient/classes.yaml (the class list with the tests teams
 * often compare and the topics they often look at) and content/excipient/wording.yaml (the words of the interview and of the markers).
 * Both are OPTIONS AND WORDS ONLY: no limits, no numbers, no verdict, no default. They are editable without code; a content test keeps
 * them in step with the facts the engine derives.
 */

const keySchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "keys are lower case with underscores");
const changelog = z.array(z.object({ version: z.string(), note: z.string() }).passthrough()).optional();

const oftenComparedSchema = z.object({ key: keySchema, test: z.string().min(1) }).strict();

export const EXCIPIENT_LOOK_AT_TOPICS = ["origin", "nitrosamine", "elemental"] as const;
export type ExcipientLookAtTopic = (typeof EXCIPIENT_LOOK_AT_TOPICS)[number];

const excipientClassSchema = z
  .object({
    key: keySchema,
    label: z.string().min(1),
    /** One plain sentence: what an excipient of this class does. */
    summary: z.string().min(1),
    /** Tests teams often compare between two sites' specifications. Offered as a prompt list; a row is only added when a person picks it. */
    oftenCompared: z.array(oftenComparedSchema),
    /** "Teams often look at" notes. Never says the excipient has the issue. */
    teamsOftenLookAt: z.object({ origin: z.string().min(1).optional(), nitrosamine: z.string().min(1).optional(), elemental: z.string().min(1).optional() }).strict(),
  })
  .strict();
export type ExcipientClass = z.infer<typeof excipientClassSchema>;

export const excipientClassesSchema = z.object({ version: z.string().min(1), changelog, classes: z.array(excipientClassSchema).min(1) }).strict();
export type ExcipientClasses = z.infer<typeof excipientClassesSchema>;

/** Reads content/excipient/classes.yaml. Throws with the first problem named. */
export function parseExcipientClasses(raw: unknown): ExcipientClasses {
  const r = excipientClassesSchema.safeParse(raw);
  if (!r.success) throw new Error(`excipient/classes.yaml: ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  const keys = r.data.classes.map((c) => c.key);
  const dup = keys.find((k, n) => keys.indexOf(k) !== n);
  if (dup) throw new Error(`excipient/classes.yaml: class ${dup} appears twice`);
  for (const c of r.data.classes) {
    const t = c.oftenCompared.map((x) => x.key);
    const d = t.find((k, n) => t.indexOf(k) !== n);
    if (d) throw new Error(`excipient/classes.yaml: ${c.key} lists test ${d} twice`);
  }
  return r.data;
}

export const excipientClassOf = (classes: ExcipientClasses, key: string | undefined): ExcipientClass | undefined => (key ? classes.classes.find((c) => c.key === key) : undefined);

// ------------------------------------------------------------------ wording

const questionWordingSchema = z
  .object({
    prompt: z.string().min(1),
    why: z.string().min(1),
    hint: z.string().optional(),
    /** Glossary term ids (the hint links to #/glossary?term=<id>). */
    glossary: z.array(z.string()).optional(),
    /** The words shown for the option values of a choice (option value -> label). */
    choices: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();
export type ExcipientQuestionWording = z.infer<typeof questionWordingSchema>;

const markerWordingSchema = z.object({ explanation: z.string().min(1) }).strict();

export const excipientWordingSchema = z
  .object({
    version: z.string().min(1),
    changelog,
    /** Keys: `line:class` and `fact:<fact key>`. A prompt of a fact asked for each site holds {site}, replaced by "the sending site" or "the receiving site". */
    questions: z.record(z.string(), questionWordingSchema),
    /** One explanation per change-risk marker key (the label is in code). May hold {{@stage ...}} markers. */
    markers: z.record(z.string(), markerWordingSchema),
  })
  .strict();
export type ExcipientWording = z.infer<typeof excipientWordingSchema>;

/** Reads content/excipient/wording.yaml. Throws with the first problem named. */
export function parseExcipientWording(raw: unknown): ExcipientWording {
  const r = excipientWordingSchema.safeParse(raw);
  if (!r.success) throw new Error(`excipient/wording.yaml: ${r.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}
