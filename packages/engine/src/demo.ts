import { z } from "zod";
import { addSource, readTrdImage, companyTableSnapshotSchema, emptyProject, subsectionBlockSchema, subsectionLibraryItemSchema, verifyEntry, type Actor, type CompanyTableSnapshot, type DesignLoadouts, type DocRef, type FailureModeSuggestions, type MbrLibraryBlock, type TrdLibraryWriteup, type RiskLoadouts, type Project, type SubsectionLibraryItem } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { PARAMETER_FIELDS, type ParameterField } from "./content-schema";
import { applyAnswer, type AnswerInput, type FieldAnswer } from "./interview";
import { setGapOverlay } from "./overlays";
import { addAction, addItem, createAssessment, pointRef, setMethod, updateItem } from "./risk";
import { addItemFromGap, addItemFromSuggestion, gapSeeds, suggestFailureModes } from "./risk-seed";
import { acceptSuggestion, addAgencyRequest, addBatch, addFigureItem, addPoint, addStep, addSubsection, applyDesignLoadout, createPlan, projectScopeSteps, setParties, setPointFlow, setTimeZero, updatePlan, updatePoint, updateStep, type PointPatch } from "./sampling";
import { suggestPoints, type SamplingSuggestions } from "./sampling-seed";
import { addTarget, createMbr, setParam, stepRefToken, updateMbrStep } from "./mbr";
import { createTrd, setLimits, setOverride, updateTrd, updateTrdStep } from "./trd";
import { buildTrdSeed } from "./trd-seed";
import { addWriteupFromLibrary, moveWriteup, removePart, setBlankValue, setNotApplicable, setPartImage, setPartIncluded, setPartText, setTableRows } from "./trd-writeup";
import { placeholderPng } from "./demo-image";
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
  /** A not-applicable answer: the reason (the justification is required, as in the interview). */
  notApplicable: z.string().optional(),
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
      parties: z.array(z.object({ party: z.enum(["cmo", "sponsor", "contract_lab", "other"]), name: z.string(), role: z.string().optional(), department: z.string().optional(), memoLine: z.enum(["from", "to", "cc"]).optional() })).default([]),
      /** Agency requests in order; a point links one by its `ref`. The plan assigns the AR-### ids. */
      agencyRequests: z.array(z.object({ ref: z.string(), agency: z.string(), marketCode: z.string().optional(), kind: z.string().optional(), reference: z.string().optional(), dateReceived: z.string().optional(), question: z.string(), response: z.string().optional(), responseDate: z.string().optional(), status: z.string().optional() })).default([]),
      /** Plan subsections. `library` names an item of `subsectionLibrary`: the plan gets a copy that remembers its id and version. `placement` may say `in_point:#N` (the N-th point of this plan, from 1). */
      subsections: z.array(z.object({ title: z.string(), blocks: z.array(subsectionBlockSchema), placement: z.string(), includeInCmo: z.boolean().default(false), library: z.string().optional() })).default([]),
      /** The plan's process steps in order. `unitOp` is a catalog step (its label comes from the catalog); `custom` is the label of a step of the plan's own. `ref` is what a point's `flow.step` names. */
      steps: z.array(z.object({ ref: z.string(), unitOp: z.string().optional(), custom: z.string().optional(), /** Planned hours and the lines of the box in the flow figure; `subProcess` names one of this plan's `subProcesses` refs. */ hours: z.number().optional(), text: z.array(z.string()).default([]), subProcess: z.string().optional() })).default([]),
      /** Holds after a step (`after` is a step ref); a point may sit on one through `flow.hold`. */
      holds: z.array(z.object({ ref: z.string(), after: z.string(), label: z.string(), durationText: z.string().optional(), hours: z.number().optional(), condition: z.string().optional() })).default([]),
      /** Time targets between two step edges (`from` and `to` are step refs). */
      timeTargets: z.array(z.object({ label: z.string(), from: z.string(), fromEdge: z.enum(["start", "end"]), to: z.string(), toEdge: z.enum(["start", "end"]), comparator: z.enum([">=", "<="]), hours: z.number(), note: z.string().optional() })).default([]),
      /** Sub-processes such as buffer preparation; `feeds` is a step ref of the main process. */
      subProcesses: z.array(z.object({ ref: z.string(), label: z.string(), feeds: z.string().optional(), processingTarget: z.object({ comparator: z.enum([">=", "<="]), hours: z.number() }).optional() })).default([]),
      timeZero: z.object({ step: z.string(), edge: z.enum(["start", "end"]) }).optional(),
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
          flow: z.object({ step: z.string(), at: z.enum(["before", "during", "after"]).optional(), hold: z.string().optional() }).optional(),
          /** Hours since time zero at which the sample is taken (for the flow figure). */
          hour: z.number().optional(),
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

/**
 * The demo risk assessment: replayed through the same editing functions a person uses. An item is seeded from a gap (`gap` is the
 * gap's attribute text, which survives gap renumbering), from the failure-mode catalog (`suggestion` is its key) or written by hand
 * (`step` is a catalog unit operation); `points` are 1-based point numbers of the demo's first sampling plan. The scores are the
 * fictional team's own judgement, typed in here, never derived from a gap severity.
 */
const riskDemoSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  title: z.string(),
  scopeNote: z.string().optional(),
  context: z.string().optional(),
  loadout: z.string(),
  items: z.array(
    z.object({
      gap: z.string().optional(),
      suggestion: z.string().optional(),
      step: z.string().optional(),
      points: z.array(z.number().int()).default([]),
      failureMode: z.string().optional(),
      effect: z.string().optional(),
      causes: z.string().optional(),
      controlsPrevention: z.string().optional(),
      controlsDetection: z.string().optional(),
      initial: z.record(z.string(), z.number().int()).optional(),
      residual: z.record(z.string(), z.number().int()).optional(),
      actions: z.array(z.object({ text: z.string(), owner: z.string().optional(), due: z.string().optional(), status: z.enum(["open", "in_progress", "done", "dropped"]).optional() })).default([]),
    }),
  ),
});

/**
 * The demo TRD: replayed through the same editing functions a person uses, started from the demo project's own seed. The cited
 * documents are fictional and are added to the source register here (a PPQ summary report and a process development report).
 * `item` is "collection.key"; a limit part names its source by document identifier. The numbers are the fictional team's own entries,
 * never copied from the project values, and two of them are chosen to show the check (a NOR above its PAR, and units that differ).
 */
const trdCite = { source: z.string().optional(), section: z.string().optional(), page: z.string().optional() };
const trdDemoSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  title: z.string(),
  docRef: z.string().optional(),
  /** Document-level text a person types on the first tab: version, purpose, scope note and the named approval roles (all optional). */
  version: z.string().optional(),
  purpose: z.string().optional(),
  scopeNote: z.string().optional(),
  approvals: z.array(z.object({ role: z.string(), name: z.string().optional(), date: z.string().optional() })).default([]),
  sources: z.array(z.object({ identifier: z.string(), docType: z.string(), title: z.string().optional(), version: z.string().optional() })).default([]),
  steps: z.array(z.object({ uo: z.string(), description: z.string() })).default([]),
  overrides: z.array(z.object({ uo: z.string(), item: z.string(), field: z.string(), display: z.string(), unit: z.string().optional(), reason: z.string().optional() })).default([]),
  limits: z
    .array(
      z.object({
        uo: z.string(),
        item: z.string(),
        setPoint: z.object({ value: z.number(), unit: z.string().optional(), ...trdCite }).optional(),
        nor: z.object({ min: z.number().optional(), max: z.number().optional(), unit: z.string().optional(), basis: z.string().optional(), ...trdCite }).optional(),
        par: z.object({ min: z.number().optional(), max: z.number().optional(), unit: z.string().optional(), basis: z.string().optional(), ...trdCite }).optional(),
      }),
    )
    .default([]),
  /**
   * Process descriptions (write-ups): the demo TRD is created with the shipped library; these entries then do what a person does.
   * `writeup` is the library id (wu_<unit op> or sec_<key>), `part` a part id of that write-up.
   */
  writeups: z
    .object({
      /** Library write-ups that a new TRD does not start with (marked autoAdd false, offered in the "Add from library" picker); added first, like a person would. */
      add: z.array(z.string()).default([]),
      /** Move a process description up (negative) or down (positive) by this many places, one step at a time like the arrow buttons; a blocked move stops there. */
      move: z.array(z.object({ writeup: z.string(), by: z.number().int() })).default([]),
      values: z.array(z.object({ writeup: z.string(), key: z.string(), value: z.string() })).default([]),
      optional: z.array(z.object({ writeup: z.string(), part: z.string() })).default([]),
      edits: z.array(z.object({ writeup: z.string(), part: z.string(), text: z.string() })).default([]),
      removed: z.array(z.object({ writeup: z.string(), part: z.string() })).default([]),
      notApplicable: z.array(z.string()).default([]),
      /** Rows typed into a table part (each row has one cell per column; a cell may hold a blank). */
      tableRows: z.array(z.object({ writeup: z.string(), part: z.string(), rows: z.array(z.array(z.string())) })).default([]),
      /** A figure with a caption, alternative text and a small GENERATED placeholder picture (no image file is stored in the repository). */
      figures: z.array(z.object({ writeup: z.string(), part: z.string(), caption: z.string(), alt: z.string(), picture: z.object({ width: z.number().int().min(16).max(800), height: z.number().int().min(16).max(800) }).optional() })).default([]),
    })
    .optional(),
});

/**
 * The demo batch record: built from the demo TRD and the demo sampling plan through the same editing functions a person uses.
 * `sections` name library blocks by id. Every parameter row whose TRD value is established is set to "same as TRD" (the usual case), except
 * the rows named in `undecided`; `rows` then edit single rows (a tightened value with its reason, a study point), and `limits` add the
 * targets under a critical time limit. Rows are found by unit operation and row key; steps by their place (1 = first) in the block.
 */
// A step is named by its place (1 = first) in the block that holds the time limit or, for a limit that spans stages, by unit operation,
// library block and place in that block.
const stepPlace = z.union([z.number().int(), z.object({ uo: z.string(), block: z.string(), step: z.number().int() })]);

const mbrDemoSchema = z.object({
  at: z.string(),
  by: z.string(),
  role: z.string().optional(),
  title: z.string(),
  docRef: z.string().optional(),
  sections: z.array(z.object({ uo: z.string().optional(), title: z.string().optional(), blocks: z.array(z.string()) })),
  undecided: z.array(z.string()).default([]),
  rows: z
    .array(
      z.object({
        uo: z.string(),
        row: z.string(),
        choice: z.enum(["same_as_trd", "tightened_by_cmo", "not_decided"]).optional(),
        mbrValue: z.string().optional(),
        mbrUnit: z.string().optional(),
        reason: z.string().optional(),
        studyPoint: z.boolean().optional(),
      }),
    )
    .default([]),
  // A cross-reference inside a step: `insert` goes right after `find` in the text of the step, and {ref} in it becomes the automatic
  // reference to the step named by `to` (stored as an id, shown as "(Step 6.6)" and renumbered when steps move).
  refs: z.array(z.object({ uo: z.string(), block: z.string(), step: z.number().int(), find: z.string(), insert: z.string(), to: z.object({ uo: z.string(), block: z.string(), step: z.number().int() }) })).default([]),
  limits: z
    .array(
      z.object({
        uo: z.string(),
        limit: z.string(),
        targets: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string().optional(), fromStep: stepPlace.optional(), toStep: stepPlace.optional() })),
      }),
    )
    .default([]),
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
  risk: riskDemoSchema.optional(),
  trd: trdDemoSchema.optional(),
  mbr: mbrDemoSchema.optional(),
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
  else if (a.notApplicable) input = { kind: "not_applicable", justification: a.notApplicable };
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
export function buildDemoProject(content: ContentBundle, raw: unknown, suggestions?: SamplingSuggestions, loadouts?: DesignLoadouts, risk?: { loadouts: RiskLoadouts; failureModes: FailureModeSuggestions }, mbr?: { library: readonly MbrLibraryBlock[] }, trd?: { writeups: readonly TrdLibraryWriteup[] }): Project {
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
  // Likewise the risk assessment needs the method load-outs and the failure-mode catalog; its sampling-point links need the plan above.
  if (demo.risk && risk) project = applyRiskDemo(project, content, demo.risk, risk.loadouts, risk.failureModes);
  // The TRD starts from the project's own seed, so it needs nothing but the content.
  if (demo.trd) project = applyTrdDemo(project, content, demo.trd, trd?.writeups);
  // The batch record takes its values from the TRD and its sample rows from the plan, so it comes last and needs the step-blocks library.
  if (demo.mbr && mbr && project.trd.documents.length > 0) project = applyMbrDemo(project, content, demo.mbr, mbr.library);
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
      if (st.hours !== undefined || st.text.length) project = updateStep(project, created.planId, added.stepId, { ...(st.hours !== undefined ? { durationHours: st.hours } : {}), ...(st.text.length ? { figureText: st.text } : {}) }, who);
    }
    const stepOf = (ref: string) => {
      const id = stepIds.get(ref);
      if (!id) throw new Error(`Demo sampling: unknown process step ${ref}`);
      return id;
    };
    const holdIds = new Map<string, string>();
    for (const h of pl.holds) {
      const r = addFigureItem(project, created.planId, "holds", { afterStepId: stepOf(h.after), label: h.label, ...(h.durationText ? { durationText: h.durationText } : {}), ...(h.hours !== undefined ? { durationHours: h.hours } : {}), ...(h.condition ? { condition: h.condition } : {}) }, who);
      project = r.project;
      holdIds.set(h.ref, r.itemId);
    }
    const subIds = new Map<string, string>();
    for (const b of pl.subProcesses) {
      const r = addFigureItem(project, created.planId, "subProcesses", { label: b.label, ...(b.feeds ? { feedsStepId: stepOf(b.feeds) } : {}), ...(b.processingTarget ? { processingTarget: b.processingTarget } : {}) }, who);
      project = r.project;
      subIds.set(b.ref, r.itemId);
    }
    for (const st of pl.steps) {
      if (!st.subProcess) continue;
      const sid = subIds.get(st.subProcess);
      if (!sid) throw new Error(`Demo sampling: unknown sub-process ${st.subProcess}`);
      project = updateStep(project, created.planId, stepOf(st.ref), { subProcess: sid }, who);
    }
    for (const t of pl.timeTargets) {
      project = addFigureItem(project, created.planId, "timeTargets", { label: t.label, fromStepId: stepOf(t.from), fromEdge: t.fromEdge, toStepId: stepOf(t.to), toEdge: t.toEdge, comparator: t.comparator, hours: t.hours, ...(t.note ? { note: t.note } : {}) }, who).project;
    }
    if (pl.timeZero) project = setTimeZero(project, created.planId, { stepId: stepOf(pl.timeZero.step), edge: pl.timeZero.edge }, who);
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
        const holdId = pt.flow.hold ? holdIds.get(pt.flow.hold) : undefined;
        if (pt.flow.hold && !holdId) throw new Error(`Demo sampling: unknown hold ${pt.flow.hold}`);
        project = setPointFlow(project, created.planId, r.pointId, { stepId, ...(pt.flow.at ? { at: pt.flow.at } : {}), ...(holdId ? { holdId } : {}) }, who);
      }
      if (pt.hour !== undefined) project = updatePoint(project, created.planId, r.pointId, { takenAtHour: pt.hour }, who);
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

function applyMbrDemo(project: Project, content: ContentBundle, m: z.infer<typeof mbrDemoSchema>, library: readonly MbrLibraryBlock[]): Project {
  const who: Actor = { name: m.by, at: m.at, ...(m.role ? { role: m.role } : {}) };
  const lib = new Map(library.map((b) => [b.id, b]));
  const uoLabel = (key: string) => content.catalog.unitOperations.find((u) => u.key === key)?.label ?? key;
  const created = createMbr(
    project,
    {
      title: m.title,
      ...(m.docRef ? { docRef: m.docRef } : {}),
      trdId: project.trd.documents[0]!.id,
      // A demo without a sampling plan gets a batch record without sample tables: the plan is a source the author chooses, not a requirement.
      ...(project.sampling.plans[0] ? { planId: project.sampling.plans[0].id } : {}),
      sections: m.sections.map((sec) => ({
        ...(sec.uo ? { unitOp: sec.uo } : {}),
        title: sec.title ?? (sec.uo ? uoLabel(sec.uo) : "General"),
        blocks: sec.blocks.map((id) => {
          const b = lib.get(id);
          if (!b) throw new Error(`Demo MBR: unknown library block ${id}`);
          return b;
        }),
      })),
    },
    who,
  );
  project = created.project;
  const recordId = created.recordId;
  const rec = () => project.mbr.records.find((r) => r.id === recordId)!;
  const sectionFor = (uo: string) => {
    const s = rec().sections.find((x) => x.unitOp === uo);
    if (!s) throw new Error(`Demo MBR: no section for ${uo}`);
    return s;
  };
  const rowOf = (uo: string, key: string) => {
    for (const b of sectionFor(uo).blocks) {
      const r = b.params.find((p) => p.key === key);
      if (r) return r;
    }
    throw new Error(`Demo MBR: ${uo} has no row ${key}`);
  };
  // The usual case: the CMO adopts the TRD value. Only rows with an established TRD value can say so; the others stay "not decided".
  for (const s of rec().sections) {
    for (const b of s.blocks) {
      for (const r of b.params) {
        if (r.trd?.status !== "established" || !r.trd.text) continue;
        if (s.unitOp && m.undecided.includes(`${s.unitOp}.${r.key}`)) continue;
        project = setParam(project, recordId, r.id, { choice: "same_as_trd" }, who);
      }
    }
  }
  for (const e of m.rows) {
    const row = rowOf(e.uo, e.row);
    project = setParam(
      project,
      recordId,
      row.id,
      { ...(e.choice ? { choice: e.choice } : {}), ...(e.mbrValue !== undefined ? { mbrValue: e.mbrValue } : {}), ...(e.mbrUnit !== undefined ? { mbrUnit: e.mbrUnit } : {}), ...(e.reason !== undefined ? { reason: e.reason } : {}), ...(e.studyPoint !== undefined ? { studyPoint: e.studyPoint } : {}) },
      who,
    );
  }
  const stepAt = (uo: string, blockId: string, place: number) => {
    const id = sectionFor(uo).blocks.find((b) => b.libraryId === blockId)?.steps[place - 1]?.id;
    if (!id) throw new Error(`Demo MBR: ${uo} has no step ${place} in block ${blockId}`);
    return id;
  };
  for (const r of m.refs) {
    const from = sectionFor(r.uo).blocks.find((b) => b.libraryId === r.block)?.steps[r.step - 1];
    if (!from || !from.text.includes(r.find)) throw new Error(`Demo MBR: ${r.uo} step ${r.step} of ${r.block} has no text "${r.find}"`);
    const text = from.text.replace(r.find, () => r.find + r.insert.replace("{ref}", stepRefToken(stepAt(r.to.uo, r.to.block, r.to.step))));
    project = updateMbrStep(project, recordId, from.id, text, who);
  }
  for (const l of m.limits) {
    const sec = sectionFor(l.uo);
    const block = sec.blocks.find((b) => b.timeLimits.some((t) => t.key === l.limit));
    const limit = block?.timeLimits.find((t) => t.key === l.limit);
    if (!block || !limit) throw new Error(`Demo MBR: ${l.uo} has no time limit ${l.limit}`);
    // A step place becomes a step id of the record as it stands now (every edit returns a new project, so it is looked up each time).
    const stepId = (p: z.infer<typeof stepPlace>): string | undefined => {
      if (typeof p === "number") return block.steps[p - 1]?.id;
      const owner = sectionFor(p.uo).blocks.find((b) => b.libraryId === p.block);
      const id = owner?.steps[p.step - 1]?.id;
      if (!id) throw new Error(`Demo MBR: ${p.uo} has no step ${p.step} in block ${p.block}`);
      return id;
    };
    for (const t of l.targets) {
      project = addTarget(
        project,
        recordId,
        limit.id,
        { label: t.label, value: t.value, ...(t.unit ? { unit: t.unit } : {}), ...(t.fromStep !== undefined ? { fromStepId: stepId(t.fromStep) } : {}), ...(t.toStep !== undefined ? { toStepId: stepId(t.toStep) } : {}) },
        who,
      ).project;
    }
  }
  return project;
}

function applyTrdDemo(project: Project, content: ContentBundle, t: z.infer<typeof trdDemoSchema>, library?: readonly TrdLibraryWriteup[]): Project {
  const who: Actor = { name: t.by, at: t.at, ...(t.role ? { role: t.role } : {}) };
  const sourceIds = new Map<string, string>();
  // A document the project already lists (the "documents" block) is cited, not added a second time: a duplicate would print twice in the
  // References list under two almost identical titles. Only the sources that are new to the project are added here.
  for (const s of [...t.sources, ...project.sources.flatMap((x) => (x.docRef ? [x.docRef] : []))]) {
    const known = project.sources.find((x) => x.docRef?.identifier === s.identifier);
    if (known) {
      sourceIds.set(s.identifier, known.id);
      continue;
    }
    const r = addSource(project, { type: "document_reference", docRef: s }, who);
    project = r.project;
    sourceIds.set(s.identifier, r.source.id);
  }
  const seed = buildTrdSeed(content, project, { exportedAt: t.at });
  const created = createTrd(project, { title: t.title, ...(t.docRef ? { docRef: t.docRef } : {}), start: { kind: "project", seed }, ...(library ? { library } : {}) }, who);
  project = created.project;
  const id = created.trdId;
  const doc = () => project.trd.documents.find((d) => d.id === id)!;
  const stepFor = (uo: string) => {
    const s = doc().steps.find((x) => x.key === uo);
    if (!s) throw new Error(`Demo TRD: ${uo} is not a step of the demo TRD`);
    return s;
  };
  const itemRef = (uo: string, item: string) => {
    const [collection, key] = item.split(".");
    const found = stepFor(uo).items.find((i) => i.collection === collection && i.key === key);
    if (!found) throw new Error(`Demo TRD: ${uo} has no item ${item}`);
    return { stepId: stepFor(uo).id, collection: found.collection, key: found.key };
  };
  const cite = (c: { source?: string | undefined; section?: string | undefined; page?: string | undefined }) => {
    if (!c.source) return { sourceIds: [] as string[] };
    const sid = sourceIds.get(c.source);
    if (!sid) throw new Error(`Demo TRD: source ${c.source} is not listed under sources`);
    const loc = { ...(c.section ? { section: c.section } : {}), ...(c.page ? { page: c.page } : {}) };
    return { sourceIds: [sid], ...(Object.keys(loc).length ? { locations: { [sid]: loc } } : {}) };
  };
  if (t.version || t.purpose || t.scopeNote || t.approvals.length) {
    project = updateTrd(
      project,
      id,
      { ...(t.version ? { version: t.version } : {}), ...(t.purpose ? { purpose: t.purpose } : {}), ...(t.scopeNote ? { scopeNote: t.scopeNote } : {}), ...(t.approvals.length ? { approvals: t.approvals.map((a) => ({ role: a.role, ...(a.name ? { name: a.name } : {}), ...(a.date ? { date: a.date } : {}) })) } : {}) },
      who,
    );
  }
  for (const s of t.steps) project = updateTrdStep(project, id, stepFor(s.uo).id, { description: s.description }, who);
  for (const o of t.overrides) {
    const ref = itemRef(o.uo, o.item);
    project = setOverride(project, id, { part: "item", ...ref, field: o.field }, { status: "established", display: o.display, ...(o.unit ? { unit: o.unit } : {}), ...(o.reason ? { reason: o.reason } : {}) }, who);
  }
  for (const l of t.limits) {
    const range = (r: NonNullable<typeof l.nor>) => ({ ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}), ...(r.unit ? { unit: r.unit } : {}), ...(r.basis ? { basis: r.basis } : {}), ...cite(r) });
    project = setLimits(
      project,
      id,
      itemRef(l.uo, l.item),
      { ...(l.setPoint ? { setPoint: { value: l.setPoint.value, ...(l.setPoint.unit ? { unit: l.setPoint.unit } : {}), ...cite(l.setPoint) } } : {}), ...(l.nor ? { nor: range(l.nor) } : {}), ...(l.par ? { par: range(l.par) } : {}) },
      who,
    );
  }
  if (t.writeups && library) {
    const wu = (libId: string) => {
      const w = (doc().writeups ?? []).find((x) => x.libraryId === libId);
      if (!w) throw new Error(`Demo TRD: no process description from library entry ${libId}`);
      return w.id;
    };
    for (const libId of t.writeups.add) {
      const lib = library.find((x) => x.id === libId);
      if (!lib) throw new Error(`Demo TRD: unknown library write-up ${libId}`);
      project = addWriteupFromLibrary(project, id, lib, lib.kind === "unitOp" ? stepFor(lib.key!).id : undefined, who).project;
    }
    for (const m of t.writeups.move) {
      for (let n = 0; n < Math.abs(m.by); n++) {
        try {
          project = moveWriteup(project, id, wu(m.writeup), m.by < 0 ? -1 : 1, who);
        } catch {
          break;
        }
      }
    }
    for (const e of t.writeups.edits) project = setPartText(project, id, wu(e.writeup), e.part, { text: e.text }, who);
    for (const o of t.writeups.optional) project = setPartIncluded(project, id, wu(o.writeup), o.part, true, who);
    for (const r of t.writeups.removed) project = removePart(project, id, wu(r.writeup), r.part, who);
    for (const n of t.writeups.notApplicable) project = setNotApplicable(project, id, wu(n), true, who);
    for (const v of t.writeups.values) project = setBlankValue(project, id, wu(v.writeup), v.key, v.value, who);
    for (const r of t.writeups.tableRows) project = setTableRows(project, id, wu(r.writeup), r.part, r.rows, who);
    for (const fg of t.writeups.figures) {
      project = setPartText(project, id, wu(fg.writeup), fg.part, { caption: fg.caption, alt: fg.alt }, who);
      if (fg.picture) project = setPartImage(project, id, wu(fg.writeup), fg.part, readTrdImage(placeholderPng(fg.picture.width, fg.picture.height), { name: "placeholder.png" }), who);
    }
  }
  return project;
}

function applyRiskDemo(project: Project, content: ContentBundle, r: z.infer<typeof riskDemoSchema>, loadouts: RiskLoadouts, library: FailureModeSuggestions): Project {
  const who: Actor = { name: r.by, at: r.at, ...(r.role ? { role: r.role } : {}) };
  const created = createAssessment(project, { title: r.title, ...(r.scopeNote ? { scopeNote: r.scopeNote } : {}), ...(r.context ? { context: r.context } : {}), steps: projectScopeSteps(content, project) }, who);
  const id = created.assessmentId;
  const lo = loadouts.loadouts.find((l) => l.id === r.loadout);
  if (!lo) throw new Error(`Demo risk: unknown method load-out ${r.loadout}`);
  project = setMethod(created.project, id, structuredClone(lo.config), who);
  const plan = project.sampling.plans[0];
  const asm = () => project.risk.assessments.find((a) => a.id === id)!;
  for (const it of r.items) {
    let itemId: string;
    if (it.gap) {
      const seed = gapSeeds(content, project, asm()).find((g) => g.attribute === it.gap);
      if (!seed) throw new Error(`Demo risk: gap "${it.gap}" is not a gap of the demo project`);
      ({ project, itemId } = addItemFromGap(project, id, seed, who));
    } else if (it.suggestion) {
      const offer = suggestFailureModes(library, asm()).find((o) => o.key === it.suggestion);
      if (!offer) throw new Error(`Demo risk: failure-mode suggestion ${it.suggestion} is not offered for the demo steps`);
      ({ project, itemId } = addItemFromSuggestion(project, id, offer, library.catalog.version, who));
    } else {
      const step = asm().steps.find((s) => s.unitOp === it.step);
      if (it.step && !step) throw new Error(`Demo risk: unknown step ${it.step}`);
      ({ project, itemId } = addItem(project, id, step ? { stepId: step.id } : {}, who));
    }
    const links = it.points.map((n) => {
      const pt = plan?.points[n - 1];
      if (!plan || !pt) throw new Error(`Demo risk: sampling point #${n} does not exist`);
      return pointRef(plan.id, pt.id);
    });
    project = updateItem(
      project,
      id,
      itemId,
      {
        ...(it.failureMode ? { failureMode: it.failureMode } : {}),
        ...(it.effect ? { effect: it.effect } : {}),
        ...(it.causes ? { causes: it.causes } : {}),
        ...(it.controlsPrevention ? { controlsPrevention: it.controlsPrevention } : {}),
        ...(it.controlsDetection ? { controlsDetection: it.controlsDetection } : {}),
        ...(links.length ? { samplingPointIds: links } : {}),
        ...(it.initial ? { initial: { values: it.initial } } : {}),
        ...(it.residual ? { residual: { values: it.residual } } : {}),
      },
      who,
    );
    for (const a of it.actions) project = addAction(project, id, { itemId, text: a.text, ...(a.owner ? { owner: a.owner } : {}), ...(a.due ? { due: a.due } : {}), ...(a.status ? { status: a.status } : {}) }, who).project;
  }
  return project;
}
