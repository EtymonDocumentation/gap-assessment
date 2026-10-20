import { z } from "zod";
import { SCHEMA_VERSION } from "./entries";
import type { Project } from "./types";

const quantity = z.object({ value: z.number().finite(), unit: z.string().min(1) });
// Strict, so a malformed quantity (e.g. missing unit) is rejected instead of being silently read as an empty range.
const range = z.object({ min: quantity.optional(), max: quantity.optional() }).strict();
const entryValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), quantity, range]);

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
    verification: z.object({ by: z.string(), at: z.string(), fingerprint: z.string() }).optional(),
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
  // First schema version; no migrations yet. Add { from: "1.0.0", to: "1.1.0", migrate } entries here.
];

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
