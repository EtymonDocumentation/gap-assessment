import { z } from "zod";
import { SCHEMA_VERSION, newId } from "./entries";
import { isValidCustomKey } from "./custom";
import { categoryToType, samplingStateSchema } from "./sampling";
import { riskStateSchema } from "./risk";
import type { Project } from "./types";

const quantity = z.object({ value: z.number().finite(), unit: z.string().min(1) });
// Strict, so a malformed quantity (e.g. missing unit) is rejected instead of being silently read as an empty range.
const range = z.object({ min: quantity.optional(), max: quantity.optional() }).strict();
const entryValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), quantity, range]);

const tbdSchema = z.object({
  bestGuess: entryValue.optional(),
  owner: z.string().optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a due date is YYYY-MM-DD").optional(),
  note: z.string().optional(),
});
const locationSchema = z.object({ section: z.string().optional(), page: z.string().optional() });
// "unknown" was retired in schema 1.9.0 (merged into "tbd"): new writes of it are rejected, and an old file is converted on load.
const STATUSES = ["established", "tbd", "not_applicable", "not_established"] as const;

const verificationSchema = z.object({
  by: z.string(),
  role: z.string().optional(),
  at: z.string(),
  fingerprint: z.string(),
  status: z.enum(STATUSES).optional(),
  sameAsSource: z.boolean().optional(),
  selfVerification: z.boolean().optional(),
});

export const entrySchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    status: z.enum(STATUSES),
    value: entryValue.optional(),
    sameAsSource: z.boolean().optional(),
    justification: z.string().optional(),
    tbd: tbdSchema.optional(),
    sourceLocations: z.record(z.string(), locationSchema).optional(),
    sourceIds: z.array(z.string()),
    recordedBy: z.string(),
    recordedAt: z.string(),
    revision: z.number().int().nonnegative(),
    verification: verificationSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.status === "established" && e.value === undefined && !e.sameAsSource) {
      ctx.addIssue({ code: "custom", message: `Established entry ${e.path} has no value` });
    }
    if (e.status !== "established" && e.value !== undefined) {
      ctx.addIssue({ code: "custom", message: `Entry ${e.path} has a value but status ${e.status}` });
    }
    if (e.status === "established" && e.sourceIds.length === 0) {
      ctx.addIssue({ code: "custom", message: `Established entry ${e.path} has no source` });
    }
    // A TBD best guess lives in `tbd`, never in `value`: a guess is not an established fact and must not be mistaken for one.
    if (e.status === "tbd" && !e.tbd) ctx.addIssue({ code: "custom", message: `TBD entry ${e.path} has no TBD details` });
    if (e.status !== "tbd" && e.tbd) ctx.addIssue({ code: "custom", message: `Entry ${e.path} has TBD details but status ${e.status}` });
    for (const id of Object.keys(e.sourceLocations ?? {})) {
      if (!e.sourceIds.includes(id)) ctx.addIssue({ code: "custom", message: `Entry ${e.path} has a location for a source it does not cite` });
    }
    if (e.status === "not_applicable" && !e.justification?.trim()) {
      ctx.addIssue({ code: "custom", message: `Not-applicable entry ${e.path} needs a justification` });
    }
  });

const fields = z.record(z.string(), entrySchema);
const item = z.object({ key: z.string(), label: z.string(), custom: z.boolean().optional(), fields });
const collections = z.object({
  param: z.record(z.string(), item),
  equip: z.record(z.string(), item),
  mat: z.record(z.string(), item),
  ipc: z.record(z.string(), item),
  study: z.record(z.string(), item),
  doc: z.record(z.string(), item),
});
const unitOperation = z.object({
  key: z.string(),
  label: z.string(),
  custom: z.boolean().optional(),
  sequence: z.number(),
  fields,
  collections,
});
const processModel = (side: "source" | "target") =>
  z.object({
    side: z.literal(side),
    site: z.object({ fields }),
    unitOperations: z.record(z.string(), unitOperation),
  });

const severity = z.enum(["high", "medium", "low", "none"]);

const customKey = z.string().refine(isValidCustomKey, "must be a custom key: x_ followed by lowercase letters, digits and underscores");

export const customSchema = z
  .object({
    unitOperations: z.array(
      z.object({
        key: customKey,
        label: z.string().trim().min(1),
        sequence: z.number().finite(),
        description: z.string().optional(),
        createdBy: z.string(),
        createdAt: z.string(),
      }),
    ),
    items: z.array(
      z.object({
        uo: z.string().min(1),
        coll: z.enum(["param", "equip", "mat", "ipc"]),
        key: customKey,
        label: z.string().trim().min(1),
        dimension: z.string().min(1).optional(),
        why: z.string().optional(),
        createdBy: z.string(),
        createdAt: z.string(),
      }),
    ),
  })
  .superRefine((c, ctx) => {
    const uos = new Set<string>();
    for (const u of c.unitOperations) {
      if (uos.has(u.key)) ctx.addIssue({ code: "custom", message: `Duplicate custom unit operation ${u.key}` });
      uos.add(u.key);
    }
    const seen = new Set<string>();
    for (const i of c.items) {
      const id = `${i.uo}.${i.coll}.${i.key}`;
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `Duplicate custom item ${id}` });
      seen.add(id);
      if (i.uo.startsWith("x_") && !uos.has(i.uo)) ctx.addIssue({ code: "custom", message: `Custom item ${id} belongs to an undefined custom unit operation` });
      if (i.coll === "param" && !i.dimension) ctx.addIssue({ code: "custom", message: `Custom parameter ${id} needs a unit dimension` });
    }
  });

// A reason is offered but optional (schema 1.10.0, product owner): when it is empty the document says "No reason recorded"
// instead of refusing the scope decision. Who and when are always kept.
export const tailoringSchema = z
  .object({
    excluded: z.array(
      z.object({
        uo: z.string().min(1),
        topic: z.string().min(1),
        reason: z.string().trim().min(1).optional(),
        by: z.string(),
        at: z.string(),
      }),
    ),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const e of t.excluded) {
      const id = `${e.uo}/${e.topic}`;
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `Topic ${id} is excluded twice` });
      seen.add(id);
    }
  });

export const stepScopeSchema = z
  .object({
    excluded: z.array(
      z.object({
        uo: z.string().min(1),
        reason: z.string().trim().min(1).optional(),
        by: z.string(),
        at: z.string(),
      }),
    ),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const e of t.excluded) {
      if (seen.has(e.uo)) ctx.addIssue({ code: "custom", message: `Process step ${e.uo} is left out twice` });
      seen.add(e.uo);
    }
  });

const templateRecord = z.object({
  mode: z.enum(["builtin", "their_look", "mapped", "tags"]),
  name: z.string().trim().min(1),
  version: z.string(),
  sha256: z.string().optional(),
  fileName: z.string().optional(),
});

export const documentStateSchema = z.object({
  exports: z.array(
    z.object({
      at: z.string(),
      by: z.string().optional(),
      format: z.enum(["markdown", "html", "docx", "trd-seed-json", "trd-outline-docx", "trd-outline-html", "sampling-plan-docx", "sampling-plan-html", "sampling-cmo-instructions-docx", "sampling-cmo-instructions-html", "risk-assessment-docx", "risk-assessment-html"]),
      template: templateRecord,
      revision: z.number().int().positive().optional(),
      fingerprint: z.string(),
      changedSinceRevision: z.boolean().optional(),
      changedSincePrevious: z.boolean().optional(),
      omittedSections: z.array(z.string()).optional(),
      tbdCount: z.number().int().nonnegative().optional(),
      versions: z.object({ processModel: z.string(), catalog: z.string(), format: z.string(), stats: z.string().optional(), suggestions: z.string().optional() }).optional(),
    }),
  ),
  omittedSections: z.array(z.string()).optional(),
  // Old revisions and reviewer comments, kept exactly as written. They are deliberately not described field by field: the
  // tool no longer reads them, and a strict shape here could only ever reject or alter a record that must stay untouched.
  archivedReview: z
    .object({ archivedAt: z.string(), revisions: z.array(z.unknown()), comments: z.array(z.unknown()) })
    .optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.string(),
  meta: z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    demo: z.boolean().optional(),
  }),
  contentRefs: z.object({ catalog: z.string(), questions: z.string(), rules: z.string(), templates: z.string() }),
  settings: z.object({ entrySequence: z.enum(["paired", "sequential"]) }),
  interview: z.object({
    responder: z.object({ name: z.string(), role: z.string().optional() }).optional(),
    confirmations: z.array(
      z.object({ sectionId: z.string(), side: z.enum(["source", "target", "shared", "both"]), by: z.string(), at: z.string() }),
    ),
    answeringFrom: z
      .object({ sourceId: z.string(), sides: z.enum(["source", "target", "both"]), section: z.string().optional(), page: z.string().optional() })
      .optional(),
  }),
  scope: fields,
  processes: z.object({ source: processModel("source"), target: processModel("target") }),
  custom: customSchema,
  tailoring: tailoringSchema,
  stepScope: stepScopeSchema,
  sampling: samplingStateSchema,
  risk: riskStateSchema,
  document: documentStateSchema,
  sources: z.array(
    z.object({
      id: z.string(),
      type: z.enum([
        "interview_answer",
        "user_entry",
        "imported_file",
        "catalog_rule",
        "document_reference",
        "ai_extraction",
        "ai_suggestion",
      ]),
      label: z.string(),
      responder: z.object({ name: z.string(), role: z.string().optional() }).optional(),
      date: z.string(),
      file: z.object({ name: z.string(), sha256: z.string() }).optional(),
      docRef: z
        .object({ docType: z.string(), identifier: z.string(), title: z.string().optional(), version: z.string().optional() })
        .optional(),
      supersededBy: z.string().optional(),
    }),
  ),
  answers: z.array(
    z.object({
      id: z.string(),
      questionId: z.string(),
      side: z.enum(["source", "target", "shared"]),
      kind: z.string(),
      raw: z.unknown(),
      sourceId: z.string(),
      by: z.string(),
      at: z.string(),
    }),
  ),
  gapOverlays: z.array(
    z.object({
      gapKey: z.string(),
      severityOverride: z
        .object({ value: severity, justification: z.string().trim().min(1), by: z.string(), at: z.string() })
        .optional(),
      owner: z.string().optional(),
      status: z.enum(["open", "in_progress", "closed", "accepted_no_action"]),
      notes: z.string().optional(),
      updatedBy: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
  ),
  changeLog: z.array(
    z.object({
      at: z.string(),
      by: z.string(),
      action: z.string(),
      path: z.string().optional(),
      detail: z.string().optional(),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
    }),
  ),
});

/** Ordered migrations from older schema versions. Each takes and returns raw JSON. */
type Migrate = (raw: Record<string, unknown>, now: string) => Record<string, unknown>;
const MIGRATIONS: { from: string; to: string; migrate: Migrate }[] = [
  // 1.0.0 -> 1.1.0: custom unit operations and items. Older projects have none.
  {
    from: "1.0.0",
    to: "1.1.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.1.0", custom: raw.custom ?? { unitOperations: [], items: [] } }),
  },
  // 1.1.0 -> 1.2.0: verification records gain role, status, sameAsSource and selfVerification (all optional).
  // The one fact that can be derived is selfVerification: a verification whose verifier has the same name as the
  // entry's recorder was a self-verification. Nothing else is filled in; missing optional fields stay missing.
  {
    from: "1.1.0",
    to: "1.2.0",
    migrate: (raw) => {
      const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      next.schemaVersion = "1.2.0";
      const fixEntry = (e: any) => {
        const v = e?.verification;
        if (v && typeof v === "object" && v.selfVerification === undefined && typeof v.by === "string" && typeof e.recordedBy === "string" && sameNameRaw(v.by, e.recordedBy)) {
          v.selfVerification = true;
        }
      };
      const fixFields = (fields: any) => {
        if (fields && typeof fields === "object") for (const e of Object.values(fields)) fixEntry(e);
      };
      fixFields(next.scope);
      for (const side of ["source", "target"]) {
        const model = next.processes?.[side];
        fixFields(model?.site?.fields);
        for (const uo of Object.values<any>(model?.unitOperations ?? {})) {
          fixFields(uo?.fields);
          for (const coll of Object.values<any>(uo?.collections ?? {})) {
            for (const item of Object.values<any>(coll ?? {})) fixFields(item?.fields);
          }
        }
      }
      return next;
    },
  },
  // 1.2.0 -> 1.3.0: revision history, reviewer comments and export records. Older projects have none.
  {
    from: "1.2.0",
    to: "1.3.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.3.0", document: raw.document ?? { revisions: [], comments: [], exports: [] } }),
  },
  // 1.3.0 -> 1.4.0: the program stage per side (site.programStage). It is an ordinary site entry, so the structure does not
  // change. Older projects get no value: their stage stays "not established" until someone answers the stage question.
  {
    from: "1.3.0",
    to: "1.4.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.4.0" }),
  },
  // 1.4.0 -> 1.5.0: gap notes (GapOverlay.notes, optional, already part of the overlay) and the optional-section choice
  // (document.omittedSections). Older projects have no notes and omit nothing: the document includes everything.
  {
    from: "1.4.0",
    to: "1.5.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.5.0" }),
  },
  // 1.5.0 -> 1.6.0: bioburden-reduction (BBR) filtration is its own unit operation, and PUPSIT is its own question.
  //   - The old "BBR filter used" answer (uo.sterile_filtration.mat.prefilter.present) moves to uo.bbr_filtration.presence.
  //     The entry keeps its id, value, sources and verification; only its path changes. Any other field of the old item moves to
  //     the new BBR filter item. The old item is removed from the sterile filtration unit.
  //   - "pupsit" is taken out of the filter integrity tests answer. When an answer listed it, uo.sterile_filtration.ipc.pupsit.status
  //     is set to "performed" with the same sources, recorder and date. An answer without it leaves the PUPSIT question
  //     unanswered: no option fits "not performed" without inventing whether a justification exists.
  //   - Stored answers, gap overlays, reviewer comment anchors and change log paths follow the moved paths.
  //   - The stored labels of the sterile filtration unit and of its bioburden item follow the new names.
  //   - The dilution question (scope.dilution) and the buffer preparation unit start empty.
  {
    from: "1.5.0",
    to: "1.6.0",
    migrate: (raw) => migrateTo160(raw),
  },
  // 1.6.0 -> 1.7.0: TBD entries (status "tbd" with entry.tbd), optional citation locations (entry.sourceLocations),
  // tbdCount on revisions and exports, and the interview's "Answering from" bar. All of it is optional, so the structure of
  // an old file does not change and nothing is invented: old citations have no location, and an old "unknown" entry stays
  // "unknown" until schema 1.9.0 (it was never a TBD, because nobody named an owner or a due date for it).
  {
    from: "1.6.0",
    to: "1.7.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.7.0" }),
  },
  // 1.7.0 -> 1.8.0: tailoring (project.tailoring.excluded: topics switched off with a reason), two new unit operations
  // (DS shipping to the fill site, bulk packaging) and the labelling location question (site.labellingLocation). The new
  // unit operations and the location answer are ordinary entries that simply do not exist in an old file, so they stay
  // unanswered and visible as open items. Nothing is excluded and no location is assumed: a default would hide the
  // labelling questions without anyone having decided that.
  {
    from: "1.7.0",
    to: "1.8.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.8.0", tailoring: raw.tailoring ?? { excluded: [] } }),
  },
  // 1.8.0 -> 1.9.0: "Unknown (to be confirmed)" is retired and merged into TBD. A TBD with no details already behaved
  // exactly like Unknown (an open information item, no gap invented, cannot be verified), so nothing is lost and the
  // product owner asked for one not-known answer. Every unknown entry becomes a TBD with empty details; nothing is invented
  // (no owner, no due date, no guess). Each conversion is written to the change log (GMP: a status change is never silent).
  {
    from: "1.8.0",
    to: "1.9.0",
    migrate: (raw, now) => migrateTo190(raw, now),
  },
  // 1.9.0 -> 1.10.0: the scope step (project.stepScope: process steps left out, with an optional reason) and the end of the
  // review workflow. Nothing is excluded after the update, which is exactly how the project behaved before. Revisions and
  // reviewer comments are moved, untouched, into document.archivedReview (see migrateTo1100): formal review happens in the
  // company's document system, so the tool stops showing and editing them, but a record is never destroyed.
  {
    from: "1.9.0",
    to: "1.10.0",
    migrate: (raw, now) => migrateTo1100(raw, now),
  },
  // 1.10.0 -> 1.11.0: PPQ sampling plans (project.sampling.plans). Older projects have none, which is what they always had.
  {
    from: "1.10.0",
    to: "1.11.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.11.0", sampling: raw.sampling ?? { plans: [] } }),
  },
  // 1.11.0 -> 1.12.0: sampling plan format 1.1.0. The study type replaces the coarse point category; plans gain parties,
  // agency requests and custom subsections (all empty, which is what they had). A point of the old "routine in-process /
  // release" category becomes a point with NO type (that category hid two different kinds of sample; picking one would be a
  // guess) and the conversion is written to the change log so the open item has a trace.
  {
    from: "1.11.0",
    to: "1.12.0",
    migrate: (raw, now) => migrateTo1120(raw, now),
  },
  // 1.12.0 -> 1.13.0: sampling plan format 1.2.0. A plan gets its OWN list of process steps (plan.steps) and a point can sit on a
  // step of it (point.flow). The steps are built from the process steps the plan's points already name, in process order; each
  // such point is placed on its step with NO position (never guessed: the diagram shows "position not set", which is a label, not a
  // problem). Points on the finished product or on supporting work get no flow ("Not on the diagram"). One change-log record per
  // plan says what was built.
  {
    from: "1.12.0",
    to: "1.13.0",
    migrate: (raw, now) => migrateTo1130(raw, now),
  },
  // 1.13.0 -> 1.14.0: risk assessments (project.risk.assessments), risk format 1.0.0. Older projects have none, which is what they
  // always had: no assessment is invented and nothing in the project changes.
  {
    from: "1.13.0",
    to: "1.14.0",
    migrate: (raw) => ({ ...raw, schemaVersion: "1.14.0", risk: raw.risk ?? { assessments: [] } }),
  },
];

/**
 * Process order and labels of the catalog's unit operations, FROZEN at schema 1.13.0 for the migration below. The migration cannot
 * read the catalog (this entry point must stay free of the YAML so the laptop server can use it), and a migration is a statement
 * about the data at one moment, so a copy is the right thing here. A test checks every key against the catalog.
 */
export const STEP_ORDER_AT_1130: readonly (readonly [key: string, label: string])[] = [
  ["ds_shipping_inbound", "Drug substance shipping to the fill site"],
  ["ds_receipt_thaw", "Drug substance receipt and thaw"],
  ["buffer_prep", "Buffer preparation"],
  ["compounding", "Pooling, compounding and dilution"],
  ["bbr_filtration", "Bioburden reduction (BBR) filtration"],
  ["sterile_filtration", "Sterile filtration"],
  ["aseptic_filling", "Aseptic filling and stoppering"],
  ["stoppering", "Stoppering (stand-alone)"],
  ["lyophilization", "Lyophilization"],
  ["capping", "Capping and crimping"],
  ["visual_inspection", "Visual inspection"],
  ["bulk_packaging", "Bulk packaging"],
  ["labeling_packaging", "Labeling and packaging"],
  ["storage_shipping", "Storage and shipping from the fill site"],
];

function migrateTo1130(raw: Record<string, unknown>, now: string): Record<string, unknown> {
  const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  next.schemaVersion = "1.13.0";
  const log: Record<string, unknown>[] = [];
  const plans: any[] = Array.isArray(next.sampling?.plans) ? next.sampling.plans : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const customLabels = new Map<string, string>((Array.isArray(next.custom?.unitOperations) ? next.custom.unitOperations : []).map((u: any) => [String(u.key), String(u.label ?? u.key)])); // eslint-disable-line @typescript-eslint/no-explicit-any
  const rankOf = new Map(STEP_ORDER_AT_1130.map(([k], i) => [k, i]));
  const labelOf = new Map(STEP_ORDER_AT_1130);
  const special = new Set(["finished_product", "none", "custom_step"]);
  for (const plan of plans) {
    if (Array.isArray(plan.steps)) continue; // already has steps (a hand-edited file): keep them
    const points: any[] = Array.isArray(plan.points) ? plan.points : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const used: string[] = [];
    for (const p of points) if (typeof p.unitOp === "string" && !special.has(p.unitOp) && !used.includes(p.unitOp)) used.push(p.unitOp);
    // Catalog steps in process order; the project's own unit operations after them, in the order the points first used them.
    used.sort((a, b) => (rankOf.get(a) ?? 1000 + used.indexOf(a)) - (rankOf.get(b) ?? 1000 + used.indexOf(b)));
    plan.steps = used.map((uo, i) => ({ id: `ST-${String(i + 1).padStart(2, "0")}`, unitOp: uo, label: labelOf.get(uo) ?? customLabels.get(uo) ?? uo }));
    const stepOf = new Map<string, string>(plan.steps.map((s: any) => [s.unitOp, s.id])); // eslint-disable-line @typescript-eslint/no-explicit-any
    let placed = 0;
    for (const p of points) {
      const id = stepOf.get(p.unitOp);
      if (id) {
        p.flow = { stepId: id };
        placed++;
      }
    }
    log.push({
      at: now,
      by: SYSTEM_ACTOR,
      action: "migrate_sampling_steps",
      path: `sampling.${plan.id}`,
      detail: `Process steps built from the points (schema 1.13.0): ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}, ${placed} point${placed === 1 ? "" : "s"} placed on a step with the position not set. The other ${points.length - placed} stay "Not on the diagram".`,
      before: {},
      after: { steps: plan.steps.map((s: any) => s.label) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  }
  next.changeLog = [...(Array.isArray(next.changeLog) ? next.changeLog : []), ...log];
  return next;
}

/** Actor name on change-log records written by a file update rather than by a person. */
export const SYSTEM_ACTOR = "System (file update)";

function migrateTo190(raw: Record<string, unknown>, now: string): Record<string, unknown> {
  const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  next.schemaVersion = "1.9.0";
  const log: Record<string, unknown>[] = [];
  const convert = (fields: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!fields || typeof fields !== "object") return;
    for (const e of Object.values<any>(fields)) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!e || typeof e !== "object") continue;
      // A verification can only name the status it verified; unknown entries could not be verified, but a stray record is mapped too.
      if (e.verification?.status === "unknown") e.verification.status = "tbd";
      if (e.status !== "unknown") continue;
      const snapshot = (status: string, tbd?: object) => ({ status, ...(e.sameAsSource ? { sameAsSource: true } : {}), ...(tbd ? { tbd } : {}) });
      e.status = "tbd";
      e.tbd = {};
      log.push({
        at: now,
        by: SYSTEM_ACTOR,
        action: "migrate_status",
        path: e.path,
        detail: "Unknown converted to TBD (schema 1.9.0, no change in meaning)",
        before: snapshot("unknown"),
        after: snapshot("tbd", {}),
      });
    }
  };
  convert(next.scope);
  for (const side of ["source", "target"]) {
    const model = next.processes?.[side];
    convert(model?.site?.fields);
    for (const uo of Object.values<any>(model?.unitOperations ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
      convert(uo?.fields);
      for (const coll of Object.values<any>(uo?.collections ?? {})) { // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const item of Object.values<any>(coll ?? {})) convert(item?.fields); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    }
  }
  // The old records stay as they were written (they keep saying "Unknown"); the conversions are appended after them.
  next.changeLog = [...(Array.isArray(next.changeLog) ? next.changeLog : []), ...log];
  return next;
}

function migrateTo1120(raw: Record<string, unknown>, now: string): Record<string, unknown> {
  const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  next.schemaVersion = "1.12.0";
  const log: Record<string, unknown>[] = [];
  const plans: any[] = Array.isArray(next.sampling?.plans) ? next.sampling.plans : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const plan of plans) {
    plan.parties = Array.isArray(plan.parties) ? plan.parties : [];
    plan.agencyRequests = Array.isArray(plan.agencyRequests) ? plan.agencyRequests : [];
    plan.subsections = Array.isArray(plan.subsections) ? plan.subsections : [];
    for (const p of Array.isArray(plan.points) ? plan.points : []) {
      if (!("category" in p) && !("categoryLabel" in p)) continue;
      const category = p.category;
      const type = typeof category === "string" ? categoryToType(category) : undefined;
      if (type) p.type = type;
      if (typeof p.categoryLabel === "string" && p.categoryLabel) p.typeLabel = p.categoryLabel;
      delete p.category;
      delete p.categoryLabel;
      if (!type) {
        log.push({
          at: now,
          by: SYSTEM_ACTOR,
          action: "migrate_sampling_type",
          path: `sampling.${plan.id}.${p.id}`,
          detail: "Study type not set (schema 1.12.0): the old category \"routine in-process / release\" covered two kinds of sample. Choose in-process control or release.",
          before: { category },
          after: {},
        });
      }
    }
  }
  next.changeLog = [...(Array.isArray(next.changeLog) ? next.changeLog : []), ...log];
  return next;
}

function migrateTo1100(raw: Record<string, unknown>, now: string): Record<string, unknown> {
  const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  next.schemaVersion = "1.10.0";
  next.stepScope = next.stepScope ?? { excluded: [] };
  const doc = (next.document ??= { exports: [] });
  const revisions: unknown[] = Array.isArray(doc.revisions) ? doc.revisions : [];
  const comments: unknown[] = Array.isArray(doc.comments) ? doc.comments : [];
  delete doc.revisions;
  delete doc.comments;
  if (!Array.isArray(doc.exports)) doc.exports = [];
  if (revisions.length || comments.length) {
    doc.archivedReview = { archivedAt: now, revisions, comments };
    // The conversion is a change to the file, so it is written to the change log (a file update never changes records silently).
    next.changeLog = [
      ...(Array.isArray(next.changeLog) ? next.changeLog : []),
      {
        at: now,
        by: SYSTEM_ACTOR,
        action: "archive_review",
        path: "document.archivedReview",
        detail: `${revisions.length} revision${revisions.length === 1 ? "" : "s"} and ${comments.length} reviewer comment${comments.length === 1 ? "" : "s"} archived (schema 1.10.0): kept in the file, no longer shown`,
      },
    ];
  }
  return next;
}

const OLD_PREFILTER_PATH = "uo.sterile_filtration.mat.prefilter";
const OLD_GAP_KEY_PREFILTER = "R-FILTER-TRAIN:uo.sterile_filtration.mat.prefilter.present";
const NEW_GAP_KEY_PREFILTER = "R-BBR-PRESENCE:uo.bbr_filtration.presence";
const OLD_GAP_KEY_PUPSIT = "R-INTEGRITY-TESTS:uo.sterile_filtration.ipc.integrity.tests#pupsit";
const NEW_GAP_KEY_PUPSIT = "R-PUPSIT:uo.sterile_filtration.ipc.pupsit.status";

function remapGapKey(key: string): string {
  if (key === OLD_GAP_KEY_PREFILTER) return NEW_GAP_KEY_PREFILTER;
  if (key === OLD_GAP_KEY_PUPSIT) return NEW_GAP_KEY_PUPSIT;
  return key;
}

function remapEntryPath(path: string): string {
  const m = /^(source|target)\.(.*)$/.exec(path);
  if (!m) return path;
  const rest = m[2]!;
  if (rest === `${OLD_PREFILTER_PATH}.present`) return `${m[1]}.uo.bbr_filtration.presence`;
  if (rest.startsWith(`${OLD_PREFILTER_PATH}.`)) return `${m[1]}.uo.bbr_filtration.mat.bbr_filter.${rest.slice(OLD_PREFILTER_PATH.length + 1)}`;
  return path;
}

function migrateTo160(raw: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  next.schemaVersion = "1.6.0";
  const original = structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  for (const side of ["source", "target"] as const) {
    const model = next.processes?.[side];
    const uos = model?.unitOperations;
    const sterile = uos?.sterile_filtration;
    if (!sterile) continue;
    if (sterile.label === "Bioburden reduction and sterile filtration") sterile.label = "Sterile filtration";
    const bioburden = sterile.collections?.ipc?.bioburden;
    if (bioburden && bioburden.label === "Pre-filtration bioburden") bioburden.label = "Bioburden before the sterilizing filter";

    // BBR filter used -> uo.bbr_filtration.presence
    const prefilter = sterile.collections?.mat?.prefilter;
    if (prefilter) {
      const bbr = (uos.bbr_filtration ??= {
        key: "bbr_filtration",
        label: "Bioburden reduction (BBR) filtration",
        sequence: 25,
        fields: {},
        collections: { param: {}, equip: {}, mat: {}, ipc: {}, study: {}, doc: {} },
      });
      for (const [field, entry] of Object.entries<any>(prefilter.fields ?? {})) {
        entry.path = remapEntryPath(entry.path);
        if (field === "present") bbr.fields.presence = entry;
        else {
          bbr.collections.mat.bbr_filter ??= { key: "bbr_filter", label: "Bioburden-reduction filter", fields: {} };
          bbr.collections.mat.bbr_filter.fields[field] = entry;
        }
      }
      delete sterile.collections.mat.prefilter;
    }

    // "pupsit" in the integrity tests answer -> ipc.pupsit.status = performed
    const tests = sterile.collections?.ipc?.integrity?.fields?.tests;
    if (tests && tests.status === "established") {
      let list: unknown = tests.value;
      if (tests.sameAsSource) list = original.processes?.source?.unitOperations?.sterile_filtration?.collections?.ipc?.integrity?.fields?.tests?.value;
      if (Array.isArray(list) && list.includes("pupsit")) {
        if (!tests.sameAsSource) tests.value = (tests.value as string[]).filter((v) => v !== "pupsit");
        const entry: Record<string, unknown> = {
          id: newId("ent"),
          path: `${side}.uo.sterile_filtration.ipc.pupsit.status`,
          status: "established",
          sourceIds: [...tests.sourceIds],
          recordedBy: tests.recordedBy,
          recordedAt: tests.recordedAt,
          revision: 1,
        };
        if (tests.sameAsSource) entry.sameAsSource = true;
        else entry.value = "performed";
        sterile.collections.ipc.pupsit ??= { key: "pupsit", label: "Pre-use post-sterilization integrity test (PUPSIT)", fields: {} };
        sterile.collections.ipc.pupsit.fields.status = entry;
      }
    }
  }

  // The source side is migrated first, so a target answer that is "same as SU" now follows the source's new PUPSIT answer.
  for (const o of next.gapOverlays ?? []) if (typeof o?.gapKey === "string") o.gapKey = remapGapKey(o.gapKey);
  for (const c of next.document?.comments ?? []) {
    if (typeof c?.anchor?.gapKey === "string") c.anchor.gapKey = remapGapKey(c.anchor.gapKey);
  }
  for (const e of next.changeLog ?? []) if (typeof e?.path === "string") e.path = remapEntryPath(e.path);
  // The stored answer of the old "BBR filter used" question belongs to the new BBR presence question.
  for (const a of next.answers ?? []) if (a?.questionId === "filt.prefilter") a.questionId = "bbr.presence";
  return next;
}

function sameNameRaw(a: string, b: string): boolean {
  const n = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  return n(a) !== "" && n(a) === n(b);
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Parses, migrates and validates project JSON (a file import, browser storage or the laptop server's store).
 * `now` stamps the change-log records a migration writes; it defaults to the current time.
 */
export function parseProject(input: unknown, opts: { now?: string } = {}): Project {
  const now = opts.now ?? new Date().toISOString();
  if (typeof input !== "object" || input === null) throw new ImportError("Not a project file");
  let raw = input as Record<string, unknown>;
  let version = String(raw.schemaVersion ?? "");
  if (!version) throw new ImportError("The file has no schemaVersion; it is not a project export");
  for (const m of MIGRATIONS) {
    if (version === m.from) {
      raw = m.migrate(raw, now);
      version = m.to;
    }
  }
  if (version !== SCHEMA_VERSION) {
    throw new ImportError(`Unsupported schema version ${version} (this build reads ${SCHEMA_VERSION})`);
  }
  const res = projectSchema.safeParse(raw);
  if (!res.success) {
    throw new ImportError(
      "The project file failed validation",
      res.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return res.data as Project;
}
