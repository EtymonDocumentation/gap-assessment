import { z } from "zod";
import { addSource, companyTableSnapshotSchema, emptyProject, subsectionBlockSchema, subsectionLibraryItemSchema, verifyEntry, type Actor, type CompanyTableSnapshot, type DesignLoadouts, type DocRef, type Project, type SubsectionLibraryItem } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { PARAMETER_FIELDS, type ParameterField } from "./content-schema";
import { applyAnswer, type AnswerInput, type FieldAnswer } from "./interview";
import { setGapOverlay } from "./overlays";
import { acceptSuggestion, addAgencyRequest, addBatch, addPoint, addStep, addSubsection, applyDesignLoadout, createPlan, setParties, setPointFlow, updatePlan, updatePoint, type PointPatch } from "./sampling";
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
 * (`unitOp` + `type`); `patch` is what the person then filled in. `table` names one of `tables` and is copied into the point.
 */
const samplingDemoSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  /** Fictional company sampling tables. They are also offered to the tables library when the demo is opened. */
  tables: z.array(companyTableSnapshotSchema).default([]),
  /** Fictional reusable plan subsections. They are also offered to the Plan subsections library when the demo is opened. */
  subsectionLibrary: z.array(subsectionLibraryItemSchema).default([]),
  plans: z.array(
    z.object({
      title: z.string(),
      notes: z.string().optional(),
      batchRationale: z.string(),
      parties: z.array(z.object({ party: z.enum(["cmo", "sponsor", "contract_lab", "other"]), name: z.string(), role: z.string().optional() })).default([]),
      /** Agency requests in order; a point links one by its `ref`. The plan assigns the AR-### ids. */
      agencyRequests: z.array(z.object({ ref: z.string(), agency: z.string(), marketCode: z.string().optional(), kind: z.string().optional(), reference: z.string().optional(), dateReceived: z.string().optional(), question: z.string(), response: z.string().optional(), responseDate: z.string().optional(), status: z.string().optional() })).default([]),
      /** Plan subsections. `library` names an item of `subsectionLibrary`: the plan gets a copy that remembers its id and version. `placement` may say `in_point:#N` (the N-th point of this plan, from 1). */
      subsections: z.array(z.object({ title: z.string(), blocks: z.array(subsectionBlockSchema), placement: z.string(), includeInCmo: z.boolean().default(false), library: z.string().optional() })).default([]),
      /** The plan's process steps in order. `unitOp` is a catalog step (its label comes from the catalog); `custom` is the label of a step of the plan's own. `ref` is what a point's `flow.step` names. */
      steps: z.array(z.object({ ref: z.string(), unitOp: z.string().optional(), custom: z.string().optional() })).default([]),
      batches: z.array(z.object({ label: z.string(), plannedLotSizeUnits: z.number().int().optional(), batchSize: z.number().optional(), batchSizeUnit: z.string().optional(), notes: z.string().optional() })),
      points: z.array(
        z.object({
          suggestion: z.string().optional(),
          unitOp: z.string().optional(),
          type: z.string().optional(),
          /** Refs of the plan's agency requests this point answers. */
          agency: z.array(z.string()).default([]),
          /** A study-design load-out (id) applied to a mixing point, then the values the person filled into its runs, in run order. */
          loadout: z.string().optional(),
          runValues: z.array(z.record(z.string(), z.unknown())).default([]),
          /** The words the person wrote on the load-out's range rows, in row order. */
          rangeText: z.array(z.string()).default([]),
          attribute: z.string().optional(),
          /** Where the point sits on the plan's process flow: a step `ref` and, optionally, before / during / after. Left out = Not on the diagram. */
          flow: z.object({ step: z.string(), at: z.enum(["before", "during", "after"]).optional() }).optional(),
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
export function buildDemoProject(content: ContentBundle, raw: unknown, suggestions?: SamplingSuggestions, loadouts?: DesignLoadouts): Project {
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
  if (demo.sampling && suggestions) project = applySamplingDemo(project, content, demo.sampling, suggestions, loadouts);
  return project;
}

/** The fictional reusable subsections of a demo script, for the Plan subsections library. */
export function demoSubsectionLibrary(raw: unknown): SubsectionLibraryItem[] {
  return demoSchema.parse(raw).sampling?.subsectionLibrary ?? [];
}

/** The fictional company tables of a demo script, for the tables library. */
export function demoSamplingTables(raw: unknown): CompanyTableSnapshot[] {
  return demoSchema.parse(raw).sampling?.tables ?? [];
}

function applySamplingDemo(project: Project, content: ContentBundle, s: z.infer<typeof samplingDemoSchema>, suggestions: SamplingSuggestions, loadouts?: DesignLoadouts): Project {
  const who: Actor = { name: s.by, at: s.at, ...(s.role ? { role: s.role } : {}) };
  const tables = new Map(s.tables.map((t) => [t.id, t]));
  for (const pl of s.plans) {
    const created = createPlan(project, { title: pl.title, ...(pl.notes ? { notes: pl.notes } : {}) }, who);
    project = updatePlan(created.project, created.planId, { batchRationale: pl.batchRationale }, who);
    for (const b of pl.batches) project = addBatch(project, created.planId, b, who).project;
    if (pl.parties.length) project = setParties(project, created.planId, pl.parties, who);
    const stepIds = new Map<string, string>();
    for (const st of pl.steps) {
      const def = st.unitOp ? content.catalog.unitOperations.find((u) => u.key === st.unitOp) : undefined;
      if (st.unitOp && !def) throw new Error(`Demo sampling: unknown unit operation ${st.unitOp}`);
      const added = addStep(project, created.planId, { ...(st.unitOp ? { unitOp: st.unitOp } : {}), label: def?.label ?? st.custom ?? "" }, who);
      project = added.project;
      stepIds.set(st.ref, added.stepId);
    }
    const requestIds = new Map<string, string>();
    for (const r of pl.agencyRequests) {
      const { ref, ...input } = r;
      const added = addAgencyRequest(project, created.planId, { ...input, sourceIds: [] } as never, who);
      project = added.project;
      requestIds.set(ref, added.requestId);
    }
    const pointIds: string[] = [];
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
        : addPoint(project, created.planId, { unitOp: pt.unitOp ?? "", ...(pt.type ? { type: pt.type as never } : {}), ...(pt.attribute ? { attribute: pt.attribute } : {}) }, who);
      project = r.project;
      pointIds.push(r.pointId);
      const patch = { ...pt.patch } as Record<string, unknown>;
      if (pt.agency.length) {
        patch.agencyRequestIds = pt.agency.map((ref) => {
          const id = requestIds.get(ref);
          if (!id) throw new Error(`Demo sampling: unknown agency request ${ref}`);
          return id;
        });
      }
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
      if (pt.flow) {
        const stepId = stepIds.get(pt.flow.step);
        if (!stepId) throw new Error(`Demo sampling: unknown process step ${pt.flow.step}`);
        project = setPointFlow(project, created.planId, r.pointId, { stepId, ...(pt.flow.at ? { at: pt.flow.at } : {}) }, who);
      }
      if (pt.loadout) {
        const lo = loadouts?.loadouts.find((l) => l.id === pt.loadout);
        if (!lo) throw new Error(`Demo sampling: unknown design load-out ${pt.loadout}`);
        project = applyDesignLoadout(project, created.planId, r.pointId, lo, "replace", who);
        if (pt.runValues.length || pt.rangeText.length) {
          const cur = project.sampling.plans.find((p) => p.id === created.planId)!.points.find((p) => p.id === r.pointId)!;
          const design = structuredClone(cur.detail?.mixing?.design ?? {});
          design.runs = (design.runs ?? []).map((run, i) => (pt.runValues[i] ? ({ ...run, ...pt.runValues[i] } as typeof run) : run));
          design.rangeSupport = (design.rangeSupport ?? []).map((row, i) => (pt.rangeText[i] ? { ...row, text: pt.rangeText[i] } : row));
          project = updatePoint(project, created.planId, r.pointId, { detail: { ...cur.detail, mixing: { ...cur.detail?.mixing, design } } }, who);
        }
      }
    }
    for (const sub of pl.subsections) {
      const lib = sub.library ? s.subsectionLibrary.find((x) => x.id === sub.library) : undefined;
      if (sub.library && !lib) throw new Error(`Demo sampling: unknown library subsection ${sub.library}`);
      const placement = sub.placement.replace(/^in_point:#(\d+)$/, (_m, n: string) => {
        const id = pointIds[Number(n) - 1];
        if (!id) throw new Error(`Demo sampling: placement ${sub.placement} names no point`);
        return `in_point:${id}`;
      });
      project = addSubsection(project, created.planId, { title: sub.title, blocks: sub.blocks, placement, includeInCmo: sub.includeInCmo, ...(lib ? { origin: { kind: "library", itemId: lib.id, version: lib.version, name: lib.name } } : {}) }, who).project;
    }
  }
  return project;
}
