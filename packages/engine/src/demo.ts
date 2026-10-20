import { z } from "zod";
import { addSource, emptyProject, verifyEntry, type Actor, type DocRef, type Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { PARAMETER_FIELDS, type ParameterField } from "./content-schema";
import { assess } from "./compare";
import { buildDocument } from "./document";
import { applyAnswer, type AnswerInput, type FieldAnswer } from "./interview";
import { addComment, issueRevision, replyToComment, resolveComment } from "./review";
import { setGapOverlay } from "./overlays";
import type { QuestionInstance } from "./sequencer";

const fieldValue = z.union([z.literal("unknown"), z.literal("same"), z.unknown()]);

const answerSchema = z.object({
  q: z.string(),
  side: z.enum(["shared", "source", "target"]),
  value: z.unknown().optional(),
  unknown: z.boolean().optional(),
  same: z.boolean().optional(),
  fields: z.record(z.string(), fieldValue).optional(),
  docs: z.array(z.string()).optional(),
});

/** A later, dated action by a named person: add a source, verify entries, or change an answer. */
const stepSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  addSource: z.object({ identifier: z.string(), docType: z.string(), title: z.string().optional(), version: z.string().optional() }).optional(),
  verify: z.array(z.string()).optional(),
  /** Confirms that the verifier is the person who recorded the entries. */
  selfVerification: z.boolean().optional(),
  answer: answerSchema.optional(),
});

/** A named person acting at a fixed time in the demo script. */
const personAtSchema = z.object({ at: z.string(), by: z.string(), role: z.string().optional() });

/**
 * Review of the generated document, applied after everything else: one revision, then comments. Comments are not
 * part of the document fingerprint, so the revision still reads as current afterwards.
 */
const reviewSchema = z.object({
  revision: personAtSchema.extend({ status: z.enum(["draft", "issued_for_review"]), summary: z.string() }),
  comments: z.array(
    personAtSchema.extend({
      section: z.string(),
      gapKey: z.string().optional(),
      text: z.string(),
      replies: z.array(personAtSchema.extend({ text: z.string() })).default([]),
      resolution: personAtSchema.extend({ text: z.string() }).optional(),
    }),
  ),
});

const demoSchema = z.object({
  demo: z.object({ id: z.string(), title: z.string(), version: z.string() }),
  responder: z.object({ name: z.string(), role: z.string().optional() }),
  date: z.string(),
  entrySequence: z.enum(["paired", "sequential"]).default("paired"),
  documents: z.array(z.object({ identifier: z.string(), docType: z.string(), title: z.string().optional(), version: z.string().optional() })).default([]),
  answers: z.array(answerSchema),
  overlays: z
    .array(
      z.object({
        gapKey: z.string(),
        owner: z.string().optional(),
        status: z.enum(["open", "in_progress", "closed", "accepted_no_action"]).optional(),
        severityOverride: z.object({ value: z.enum(["high", "medium", "low", "none"]), justification: z.string() }).optional(),
      }),
    )
    .default([]),
  followUp: z.array(stepSchema).default([]),
  review: reviewSchema.optional(),
});

export type DemoScript = z.infer<typeof demoSchema>;

function fieldAnswer(v: unknown): FieldAnswer {
  if (v === "unknown") return { kind: "unknown" };
  if (v === "same") return { kind: "same_as_source" };
  return { kind: "value", value: v as never };
}

function applyScripted(project: Project, content: ContentBundle, a: z.infer<typeof answerSchema>, actor: Actor, docs: Map<string, DocRef>): Project {
  const q = content.questionById.get(a.q);
  if (!q) throw new Error(`Demo: unknown question ${a.q}`);
  const section = content.sectionById.get(q.section)!;
  const inst: QuestionInstance = { key: `${q.id}@${a.side}`, question: q, side: a.side, section, depth: 0 };
  let input: AnswerInput;
  if (a.unknown) input = { kind: "unknown" };
  else if (a.same) input = { kind: "same_as_source" };
  else if (a.fields) {
    const fields: Partial<Record<ParameterField, FieldAnswer>> = {};
    for (const [k, v] of Object.entries(a.fields)) {
      if (!PARAMETER_FIELDS.includes(k as ParameterField)) throw new Error(`Demo: unknown parameter field ${k} in ${a.q}`);
      fields[k as ParameterField] = fieldAnswer(v);
    }
    input = { kind: "composite", fields };
  } else input = { kind: "value", value: a.value as never };
  const docRefs = (a.docs ?? []).map((id) => {
    const d = docs.get(id);
    if (!d) throw new Error(`Demo: unknown document ${id}`);
    return d;
  });
  try {
    return applyAnswer(project, content, inst, input, actor, { docRefs });
  } catch (e) {
    throw new Error(`Demo answer ${a.q}@${a.side}: ${(e as Error).message}`);
  }
}

const actorOf = (p: { at: string; by: string; role?: string | undefined }): Actor => ({ name: p.by, at: p.at, ...(p.role ? { role: p.role } : {}) });

/** Issues the scripted revision on the document as it stands, then records the scripted comments, replies and resolutions. */
function applyReview(start: Project, content: ContentBundle, review: z.infer<typeof reviewSchema>): Project {
  const rev = review.revision;
  let project = start;
  try {
    const doc = buildDocument(content, project, assess(content, project), rev.at);
    project = issueRevision(project, doc, { status: rev.status, summary: rev.summary }, actorOf(rev));
    for (const c of review.comments) {
      const seq = project.document.comments.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
      project = addComment(project, { sectionId: c.section, ...(c.gapKey ? { gapKey: c.gapKey } : {}), text: c.text }, actorOf(c));
      for (const r of c.replies) project = replyToComment(project, seq, r.text, actorOf(r));
      if (c.resolution) project = resolveComment(project, seq, c.resolution.text, actorOf(c.resolution));
    }
  } catch (e) {
    throw new Error(`Demo review: ${(e as Error).message}`);
  }
  return project;
}

/**
 * Builds the fictional demonstration project by replaying scripted interview
 * answers through the same code path a user takes, so every demo entry has
 * a real interview source, responder and date.
 */
export function buildDemoProject(content: ContentBundle, raw: unknown): Project {
  const demo = demoSchema.parse(raw);
  const actor: Actor = { name: demo.responder.name, at: demo.date, ...(demo.responder.role ? { role: demo.responder.role } : {}) };
  let project = emptyProject({
    title: demo.demo.title,
    actor,
    contentRefs: content.versions,
    entrySequence: demo.entrySequence,
  });
  project.meta.demo = true;
  project.interview.responder = demo.responder;
  const docs = new Map<string, DocRef>(demo.documents.map((d) => [d.identifier, d]));

  for (const a of demo.answers) project = applyScripted(project, content, a, actor, docs);
  for (const o of demo.overlays) {
    project = setGapOverlay(project, o.gapKey, { ...o }, actor);
  }
  // Follow-up steps happen after the interview, in script order, each by its own named person at its own time.
  for (const step of demo.followUp) {
    const who: Actor = { name: step.by, at: step.at, ...(step.role ? { role: step.role } : {}) };
    if (step.addSource) project = addSource(project, { type: "document_reference", docRef: step.addSource }, who).project;
    for (const ref of step.verify ?? []) {
      try {
        project = verifyEntry(project, ref, who, step.selfVerification ? { selfVerification: true } : {});
      } catch (e) {
        throw new Error(`Demo verification of ${ref}: ${(e as Error).message}`);
      }
    }
    if (step.answer) project = applyScripted(project, content, step.answer, who, docs);
  }
  if (demo.review) project = applyReview(project, content, demo.review);
  return project;
}
