import { z } from "zod";
import { SCHEMA_VERSION } from "./entries";
import { isValidCustomKey } from "./custom";
import type { Project } from "./types";

const quantity = z.object({ value: z.number().finite(), unit: z.string().min(1) });
// Strict, so a malformed quantity (e.g. missing unit) is rejected instead of being silently read as an empty range.
const range = z.object({ min: quantity.optional(), max: quantity.optional() }).strict();
const entryValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), quantity, range]);

const verificationSchema = z.object({
  by: z.string(),
  role: z.string().optional(),
  at: z.string(),
  fingerprint: z.string(),
  status: z.enum(["established", "unknown", "not_applicable", "not_established"]).optional(),
  sameAsSource: z.boolean().optional(),
  selfVerification: z.boolean().optional(),
});

export const entrySchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    status: z.enum(["established", "unknown", "not_applicable", "not_established"]),
    value: entryValue.optional(),
    sameAsSource: z.boolean().optional(),
    justification: z.string().optional(),
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

const templateRecord = z.object({
  mode: z.enum(["builtin", "their_look", "mapped", "tags"]),
  name: z.string().trim().min(1),
  version: z.string(),
  sha256: z.string().optional(),
  fileName: z.string().optional(),
});

const reviewReply = z.object({
  kind: z.enum(["reply", "resolution", "reopen"]),
  by: z.string(),
  role: z.string().optional(),
  at: z.string(),
  text: z.string().trim().min(1, "a response needs text"),
});

export const documentStateSchema = z
  .object({
    revisions: z.array(
      z.object({
        number: z.number().int().positive(),
        status: z.enum(["draft", "issued_for_review"]),
        summary: z.string().trim().min(1, "a revision needs a summary of the change"),
        by: z.string().trim().min(1),
        role: z.string().optional(),
        at: z.string(),
        fingerprint: z.string().min(1),
        template: templateRecord.optional(),
      }),
    ),
    comments: z.array(
      z.object({
        seq: z.number().int().positive(),
        anchor: z.object({ sectionId: z.string().min(1), gapKey: z.string().min(1).optional() }),
        by: z.string().trim().min(1),
        role: z.string().optional(),
        at: z.string(),
        text: z.string().trim().min(1, "a comment needs text"),
        status: z.enum(["open", "resolved"]),
        replies: z.array(reviewReply),
      }),
    ),
    exports: z.array(
      z.object({
        at: z.string(),
        by: z.string().optional(),
        format: z.enum(["markdown", "html", "docx"]),
        template: templateRecord,
        revision: z.number().int().positive().optional(),
        fingerprint: z.string(),
        changedSinceRevision: z.boolean(),
        omittedSections: z.array(z.string()).optional(),
      }),
    ),
    omittedSections: z.array(z.string()).optional(),
  })
  .superRefine((d, ctx) => {
    const nums = new Set<number>();
    for (const r of d.revisions) {
      if (nums.has(r.number)) ctx.addIssue({ code: "custom", message: `Duplicate revision number ${r.number}` });
      nums.add(r.number);
    }
    const seqs = new Set<number>();
    for (const c of d.comments) {
      if (seqs.has(c.seq)) ctx.addIssue({ code: "custom", message: `Duplicate comment number ${c.seq}` });
      seqs.add(c.seq);
    }
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
  }),
  scope: fields,
  processes: z.object({ source: processModel("source"), target: processModel("target") }),
  custom: customSchema,
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
const MIGRATIONS: { from: string; to: string; migrate: (raw: Record<string, unknown>) => Record<string, unknown> }[] = [
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
];

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

/** Parses, migrates and validates project JSON (e.g., from a file import or browser storage). */
export function parseProject(input: unknown): Project {
  if (typeof input !== "object" || input === null) throw new ImportError("Not a project file");
  let raw = input as Record<string, unknown>;
  let version = String(raw.schemaVersion ?? "");
  if (!version) throw new ImportError("The file has no schemaVersion; it is not a project export");
  for (const m of MIGRATIONS) {
    if (version === m.from) {
      raw = m.migrate(raw);
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
