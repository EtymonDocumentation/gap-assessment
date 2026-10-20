import { z } from "zod";
import { emptyProject, type Actor, type DocRef, type Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { PARAMETER_FIELDS, type ParameterField } from "./content-schema";
import { applyAnswer, type AnswerInput, type FieldAnswer } from "./interview";
import { setGapOverlay } from "./overlays";
import type { QuestionInstance } from "./sequencer";

const fieldValue = z.union([z.literal("unknown"), z.literal("same"), z.unknown()]);

const demoSchema = z.object({
  demo: z.object({ id: z.string(), title: z.string(), version: z.string() }),
  responder: z.object({ name: z.string(), role: z.string().optional() }),
  date: z.string(),
  entrySequence: z.enum(["paired", "sequential"]).default("paired"),
  documents: z.array(z.object({ identifier: z.string(), docType: z.string(), title: z.string().optional(), version: z.string().optional() })).default([]),
  answers: z.array(
    z.object({
      q: z.string(),
      side: z.enum(["shared", "source", "target"]),
      value: z.unknown().optional(),
      unknown: z.boolean().optional(),
      same: z.boolean().optional(),
      fields: z.record(z.string(), fieldValue).optional(),
      docs: z.array(z.string()).optional(),
    }),
  ),
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
});

export type DemoScript = z.infer<typeof demoSchema>;

function fieldAnswer(v: unknown): FieldAnswer {
  if (v === "unknown") return { kind: "unknown" };
  if (v === "same") return { kind: "same_as_source" };
  return { kind: "value", value: v as never };
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

  for (const a of demo.answers) {
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
      project = applyAnswer(project, content, inst, input, actor, { docRefs });
    } catch (e) {
      throw new Error(`Demo answer ${a.q}@${a.side}: ${(e as Error).message}`);
    }
  }
  for (const o of demo.overlays) {
    project = setGapOverlay(project, o.gapKey, { ...o }, actor);
  }
  return project;
}
