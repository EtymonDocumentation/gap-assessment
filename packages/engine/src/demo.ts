import { z } from "zod";
import { addSource, companyTableSnapshotSchema, emptyProject, verifyEntry, type Actor, type CompanyTableSnapshot, type DocRef, type Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { PARAMETER_FIELDS, type ParameterField } from "./content-schema";
import { applyAnswer, type AnswerInput, type FieldAnswer } from "./interview";
import { setGapOverlay } from "./overlays";
import { acceptSuggestion, addBatch, addPoint, createPlan, updatePlan, updatePoint, type PointPatch } from "./sampling";
import { suggestPoints, type SamplingSuggestions } from "./sampling-seed";
import type { QuestionInstance } from "./sequencer";

const fieldValue = z.union([z.literal("tbd"), z.literal("same"), z.unknown()]);

const answerSchema = z.object({
  q: z.string(),
  side: z.enum(["shared", "source", "target"]),
  value: z.unknown().optional(),
  same: z.boolean().optional(),
  /** A TBD answer: the best guess (same shape as value) is optional, so is everything else; `tbd: {}` is a TBD with no details. */
  tbd: z.object({ bestGuess: z.unknown().optional(), owner: z.string().optional(), due: z.string().optional(), note: z.string().optional() }).optional(),
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
 * The demo sampling plan: batches and points are replayed through the same editing functions a person uses, so the change log
 * and the saved arithmetic are real. A point either accepts a suggestion (`suggestion` is its id) or is added by hand
 * (`unitOp` + `category`); `patch` is what the person then filled in. `table` names one of `tables` and is copied into the point.
 */
const samplingDemoSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  /** Fictional company sampling tables. They are also offered to the tables library when the demo is opened. */
  tables: z.array(companyTableSnapshotSchema).default([]),
  plans: z.array(
    z.object({
      title: z.string(),
      notes: z.string().optional(),
      batchRationale: z.string(),
      batches: z.array(z.object({ label: z.string(), plannedLotSizeUnits: z.number().int().optional(), batchSize: z.number().optional(), batchSizeUnit: z.string().optional(), notes: z.string().optional() })),
      points: z.array(
        z.object({
          suggestion: z.string().optional(),
          unitOp: z.string().optional(),
          category: z.string().optional(),
          attribute: z.string().optional(),
          table: z.string().optional(),
          /** Id of an RU-data suggestion (e.g. "ipc:uo.x.ipc.y") whose item path, gap ids and activity this point is traced to. */
          originFrom: z.string().optional(),
          /** Identifiers of demo documents the point cites as sources. */
          docs: z.array(z.string()).default([]),
          patch: z.record(z.string(), z.unknown()).default({}),
        }),
      ),
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
        notes: z.string().optional(),
        status: z.enum(["open", "in_progress", "closed", "accepted_no_action"]).optional(),
        severityOverride: z.object({ value: z.enum(["high", "medium", "low", "none"]), justification: z.string() }).optional(),
      }),
    )
    .default([]),
  followUp: z.array(stepSchema).default([]),
  sampling: samplingDemoSchema.optional(),
});

export type DemoScript = z.infer<typeof demoSchema>;

function fieldAnswer(v: unknown): FieldAnswer {
  if (v === "tbd") return { kind: "tbd" };
  if (v === "same") return { kind: "same_as_source" };
  return { kind: "value", value: v as never };
}

function applyScripted(project: Project, content: ContentBundle, a: z.infer<typeof answerSchema>, actor: Actor, docs: Map<string, DocRef>): Project {
  const q = content.questionById.get(a.q);
  if (!q) throw new Error(`Demo: unknown question ${a.q}`);
  const section = content.sectionById.get(q.section)!;
  const inst: QuestionInstance = { key: `${q.id}@${a.side}`, question: q, side: a.side, section, depth: 0 };
  let input: AnswerInput;
  if (a.tbd) input = { kind: "tbd", ...(a.tbd.bestGuess !== undefined ? { bestGuess: a.tbd.bestGuess as never } : {}), ...(a.tbd.owner ? { owner: a.tbd.owner } : {}), ...(a.tbd.due ? { due: a.tbd.due } : {}), ...(a.tbd.note ? { note: a.tbd.note } : {}) };
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

/**
 * Builds the fictional demonstration project by replaying scripted interview
 * answers through the same code path a user takes, so every demo entry has
 * a real interview source, responder and date.
 */
export function buildDemoProject(content: ContentBundle, raw: unknown, suggestions?: SamplingSuggestions): Project {
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
  // The sampling plan is added only when the caller has the suggestions catalog (the app does); other callers get the project without it.
  if (demo.sampling && suggestions) project = applySamplingDemo(project, content, demo.sampling, suggestions);
  return project;
}

/** The fictional company tables of a demo script, for the tables library. */
export function demoSamplingTables(raw: unknown): CompanyTableSnapshot[] {
  return demoSchema.parse(raw).sampling?.tables ?? [];
}

function applySamplingDemo(project: Project, content: ContentBundle, s: z.infer<typeof samplingDemoSchema>, suggestions: SamplingSuggestions): Project {
  const who: Actor = { name: s.by, at: s.at, ...(s.role ? { role: s.role } : {}) };
  const tables = new Map(s.tables.map((t) => [t.id, t]));
  for (const pl of s.plans) {
    const created = createPlan(project, { title: pl.title, ...(pl.notes ? { notes: pl.notes } : {}) }, who);
    project = updatePlan(created.project, created.planId, { batchRationale: pl.batchRationale }, who);
    for (const b of pl.batches) project = addBatch(project, created.planId, b, who).project;
    for (const pt of pl.points) {
      const all = suggestPoints(content, project, suggestions);
      const offered0 = pt.suggestion ? all.find((x) => x.id === pt.suggestion) : undefined;
      const trace = pt.originFrom ? all.find((x) => x.id === pt.originFrom) : undefined;
      if (pt.originFrom && !trace) throw new Error(`Demo sampling: RU item suggestion ${pt.originFrom} is not offered for this project`);
      // The point keeps its catalog suggestion key but is traced to the real RU item, gap ids and validation activity behind it.
      const offered = offered0 && trace ? { ...offered0, ...(trace.itemPath ? { itemPath: trace.itemPath } : {}), gapIds: trace.gapIds, ...(trace.validationActivity ? { validationActivity: trace.validationActivity } : {}) } : offered0;
      if (pt.suggestion && !offered) throw new Error(`Demo sampling: suggestion ${pt.suggestion} is not offered for this project`);
      const r = offered
        ? acceptSuggestion(project, created.planId, offered, who)
        : addPoint(project, created.planId, { unitOp: pt.unitOp ?? "", category: (pt.category ?? "other") as never, ...(pt.attribute ? { attribute: pt.attribute } : {}) }, who);
      project = r.project;
      const patch = { ...pt.patch } as Record<string, unknown>;
      if (pt.docs.length > 0) {
        patch.sourceIds = pt.docs.map((id) => {
          const s = project.sources.find((x) => x.docRef?.identifier === id);
          if (!s) throw new Error(`Demo sampling: document ${id} is not a source of the demo project`);
          return s.id;
        });
      }
      if (pt.table) {
        const t = tables.get(pt.table);
        if (!t) throw new Error(`Demo sampling: unknown table ${pt.table}`);
        const ss = (patch.sampleSize ?? {}) as { method?: string; inputs?: Record<string, unknown> };
        patch.sampleSize = { ...ss, inputs: { ...(ss.inputs ?? {}), table: t } };
      }
      if (Object.keys(patch).length > 0) project = updatePoint(project, created.planId, r.pointId, patch as PointPatch, who);
    }
  }
  return project;
}
