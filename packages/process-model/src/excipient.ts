import { z } from "zod";
import type { Entry, EntryValue, Project, SourceLocation } from "./types";

/*
 * Excipient assessment shapes (project schema 1.31.0; excipient format 1.0.0).
 *
 * Design notes (the why):
 *  - A DRAFTING AID, NOT A JUDGE. The module records what the team knows about each excipient and what is still open, and it puts the
 *    sending site's and the receiving site's facts side by side. It never says an excipient, a grade, a supplier or a limit is
 *    acceptable, and it never names a filing category. Where a difference could matter for a filing the only words are
 *    "Requires regulatory affairs assessment" (see EXCIPIENT_REGULATORY_SENTENCE).
 *  - NO DEFAULTS. The option lists below are what a person may choose from, never an answer. A line starts with no class, no grade and
 *    no supplier; an unanswered fact stays visible as "Not established" in the screens, the open items and the document.
 *  - FACTS ARE ENTRIES. Every fact is the same `Entry` record the gap assessment uses (status, value, justification, TBD details,
 *    sources, verification), so verification, source removal and the change log work the same way. A fact that can differ between the
 *    two sites exists once per side; the receiving side may be set "same as sending" (the existing `sameAsSource` flag, read here as
 *    "same as the sending site").
 *  - EVERYTHING IS KEPT ON THE EXCIPIENT SIDE. The links to the gap assessment, the risk assessment and the technical requirements
 *    document live only on the line, so none of those formats changes.
 */

/** Version of the excipient assessment format (shapes, class list, wording, output). Independent of the project schema version. */
export const EXCIPIENT_FORMAT_VERSION = "1.0.0";

/** The only wording the tool uses where a difference between the sites could matter for a filing. It never names a category. */
export const EXCIPIENT_REGULATORY_SENTENCE = "Requires regulatory affairs assessment";

export const EXCIPIENT_SIDES = ["sending", "receiving"] as const;
export type ExcipientSide = (typeof EXCIPIENT_SIDES)[number];
export const EXCIPIENT_SIDE_LABEL: Readonly<Record<ExcipientSide, string>> = { sending: "Sending site", receiving: "Receiving site" };

// ------------------------------------------------------------------ the facts of a line

export const EXCIPIENT_FACT_GROUPS = ["identity", "quality", "supply", "origin", "impurities", "storage"] as const;
export type ExcipientFactGroup = (typeof EXCIPIENT_FACT_GROUPS)[number];
export const EXCIPIENT_FACT_GROUP_LABEL: Readonly<Record<ExcipientFactGroup, string>> = {
  identity: "Identity",
  quality: "Quality",
  supply: "Supply",
  origin: "Origin",
  impurities: "Impurities",
  storage: "Storage and notes",
};

export type ExcipientFactKind = "text" | "long_text" | "choice" | "multi_choice" | "quantity";

export interface ExcipientFactDef {
  key: string;
  /** Plain label, also used in the source register ("Excipient answer: ..."). The question wording is in content/excipient/wording.yaml. */
  label: string;
  kind: ExcipientFactKind;
  group: ExcipientFactGroup;
  /** True: asked and stored once for each site. False: one answer for the whole product. */
  perSide: boolean;
  /** The option values of a choice. The words shown for them are in the wording file; a content test checks the two lists agree. */
  options?: readonly string[];
  /** The units a quantity may be given in. */
  units?: readonly string[];
}

export const WHERE_ADDED = ["drug_substance", "buffer_prep", "compounding", "other"] as const;
/** The two places that only exist when the program dilutes or formulates with a buffer (scope.dilution). */
export const BUFFER_STEP_PLACES: readonly string[] = ["buffer_prep", "compounding"];
export const GRADE_STANDARDS = ["ph_eur", "usp_nf", "jp", "other", "none"] as const;
export const SUPPLIER_STATUSES = ["qualified", "not_yet", "unknown"] as const;
export const SOURCES_OF_SUPPLY = ["one", "more_than_one"] as const;
export const ORIGINS = ["plant", "synthetic", "mineral", "fermentation", "animal", "mixed", "not_known"] as const;
/** The origins for which the animal-origin questions are asked. "Not known" is itself the open item, so the detail is not asked yet. */
export const ANIMAL_ORIGINS: readonly string[] = ["animal", "mixed"];
export const ANIMAL_STATEMENTS = ["held", "not_held"] as const;
/** Whether a topic (nitrosamine, elemental impurities) was looked at. "Not applicable here" is the usual exit, not a choice. */
export const TOPIC_STATUSES = ["evaluated", "not_yet"] as const;
export const AMOUNT_UNITS = ["mg/mL", "g/L", "mM", "%"] as const;

export const EXCIPIENT_FACTS: readonly ExcipientFactDef[] = [
  { key: "whereAdded", label: "Where it is added", kind: "multi_choice", group: "identity", perSide: false, options: WHERE_ADDED },
  { key: "amount", label: "Concentration in the product", kind: "quantity", group: "identity", perSide: false, units: AMOUNT_UNITS },
  { key: "grade", label: "Compendial standards", kind: "multi_choice", group: "quality", perSide: true, options: GRADE_STANDARDS },
  { key: "gradeEdition", label: "Monograph edition", kind: "text", group: "quality", perSide: true },
  { key: "qualityStatement", label: "Supplier's quality statement", kind: "text", group: "quality", perSide: true },
  { key: "supplier", label: "Supplier", kind: "text", group: "supply", perSide: true },
  { key: "manufacturingSite", label: "Manufacturing site", kind: "text", group: "supply", perSide: true },
  { key: "supplierStatus", label: "Supplier status", kind: "choice", group: "supply", perSide: true, options: SUPPLIER_STATUSES },
  { key: "sourcesOfSupply", label: "Sources of supply", kind: "choice", group: "supply", perSide: true, options: SOURCES_OF_SUPPLY },
  { key: "origin", label: "Origin", kind: "choice", group: "origin", perSide: true, options: ORIGINS },
  { key: "animalDetail", label: "Animal origin detail", kind: "text", group: "origin", perSide: true },
  { key: "animalStatement", label: "Statement on TSE or BSE", kind: "choice", group: "origin", perSide: true, options: ANIMAL_STATEMENTS },
  { key: "tseEvidence", label: "TSE evidence", kind: "text", group: "origin", perSide: true },
  { key: "nitrosamine", label: "Nitrosamine", kind: "choice", group: "impurities", perSide: false, options: TOPIC_STATUSES },
  { key: "nitrosamineRef", label: "Where the nitrosamine evaluation is written", kind: "text", group: "impurities", perSide: false },
  { key: "elemental", label: "Elemental impurities", kind: "choice", group: "impurities", perSide: false, options: TOPIC_STATUSES },
  { key: "elementalRef", label: "Where the elemental-impurity evaluation is written", kind: "text", group: "impurities", perSide: false },
  { key: "endotoxin", label: "Endotoxin limit", kind: "text", group: "impurities", perSide: false },
  { key: "bioburden", label: "Bioburden", kind: "text", group: "impurities", perSide: false },
  { key: "residualSolvents", label: "Residual solvents", kind: "text", group: "impurities", perSide: false },
  { key: "particulates", label: "Particulates", kind: "text", group: "impurities", perSide: false },
  { key: "sterilisation", label: "Sterilisation or depyrogenation by the supplier", kind: "text", group: "impurities", perSide: false },
  { key: "storage", label: "Storage conditions and retest or shelf life", kind: "text", group: "storage", perSide: true },
  { key: "notes", label: "Notes", kind: "long_text", group: "storage", perSide: false },
];

const FACT_BY_KEY = new Map(EXCIPIENT_FACTS.map((f) => [f.key, f]));
export const excipientFactDef = (key: string): ExcipientFactDef | undefined => FACT_BY_KEY.get(key);

/** The animal-origin questions. They are asked for a side only when that side's origin is animal or mixed. */
export const ANIMAL_FACT_KEYS: readonly string[] = ["animalDetail", "animalStatement", "tseEvidence"];

/** Path of one fact: excipient.EXA-001.EXL-001.grade.receiving (a fact for the whole product has no side). */
export function excipientFactPath(assessmentId: string, lineId: string, key: string, side?: ExcipientSide): string {
  return `excipient.${assessmentId}.${lineId}.${key}${side ? `.${side}` : ""}`;
}

export interface ParsedExcipientPath {
  assessmentId: string;
  lineId: string;
  key: string;
  side?: ExcipientSide;
}
/** Reads a fact path back into its parts, or undefined when the text is not a fact path. */
export function parseExcipientPath(ref: string): ParsedExcipientPath | undefined {
  const m = /^excipient\.(EXA-\d+)\.(EXL-\d+)\.([A-Za-z]+)(?:\.(sending|receiving))?$/.exec(ref);
  if (!m) return undefined;
  return { assessmentId: m[1]!, lineId: m[2]!, key: m[3]!, ...(m[4] ? { side: m[4] as ExcipientSide } : {}) };
}

// ------------------------------------------------------------------ specification rows

/**
 * What one site's specification says about one test. "open" means nothing was entered (the comparison says "Not compared yet"),
 * "stated" means the criterion is written, "not_tested" means the person says this site's specification does not hold the test at all.
 * Keeping "not tested" apart from "open" is what lets the comparison say "Only at the sending site" instead of guessing from a blank.
 */
export type SpecSideState = "open" | "stated" | "not_tested";

export interface ExcipientSpecSide {
  state: SpecSideState;
  /** The test method, as written in the site's specification. */
  method?: string;
  /** The acceptance criterion exactly as written. A criterion that is a plain number (with an optional relation such as "<=") is compared as a number. */
  criterion?: string;
  unit?: string;
  /** Document references (specification, CoA) from the source register. Encouraged, never needed to save. */
  sourceIds: string[];
  sourceLocations?: Record<string, SourceLocation>;
}

export interface ExcipientSpecRow {
  /** EXR-001, unique inside the line (and never reused). */
  id: string;
  /** The test (attribute), in the person's or the list's words. */
  test: string;
  /** Key of the "often compared" prompt it was added from (content/excipient/classes.yaml), when it came from the list. */
  promptKey?: string;
  note?: string;
  sending: ExcipientSpecSide;
  receiving: ExcipientSpecSide;
}

export interface ExcipientLinks {
  /** Gap ids (G-014) chosen from the project's gaps. */
  gapIds: string[];
  /** The draft risk items started from this excipient: the pair {assessment id, item id}. */
  riskItems: { assessmentId: string; itemId: string }[];
  /** The buffer or diluent material of a technical requirements document this line belongs to. */
  trdItem?: { trdId: string; stepKey: string; itemKey: string };
  /** Where the regulatory affairs assessment is written (a free-text document reference). The marker stays whether or not it is filled. */
  regulatoryReference?: string;
}

export interface ExcipientLine {
  /** EXL-001, unique inside the assessment (and never reused). */
  id: string;
  name: string;
  /** Key of a class of content/excipient/classes.yaml. Never together with `classLabel`. */
  classKey?: string;
  /** The person's own words for the role when no listed class fits. */
  classLabel?: string;
  /** The facts, keyed by their full path (see excipientFactPath). */
  facts: Record<string, Entry>;
  specs: ExcipientSpecRow[];
  links: ExcipientLinks;
  createdAt: string;
  updatedAt: string;
}

export interface ExcipientAssessment {
  /** EXA-001. */
  id: string;
  title: string;
  status: "draft";
  /** Purpose and scope, in the user's words. */
  scopeNote?: string;
  lines: ExcipientLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ExcipientState {
  assessments: ExcipientAssessment[];
}

/** The assessments of a project; a project from before 1.31.0 that was never migrated has none. */
export function excipientAssessments(project: Pick<Project, "excipients">): ExcipientAssessment[] {
  return project.excipients?.assessments ?? [];
}

/** The fact entry a path points to, or undefined. Used by getEntry so verification, sources and clearing work on facts too. */
export function excipientEntryAt(project: Pick<Project, "excipients">, ref: string): Entry | undefined {
  const p = parseExcipientPath(ref);
  if (!p) return undefined;
  return excipientAssessments(project)
    .find((a) => a.id === p.assessmentId)
    ?.lines.find((l) => l.id === p.lineId)?.facts[ref];
}

/** Every fact entry of every line, for the places that walk all entries (source removal). */
export function* allExcipientEntries(project: Pick<Project, "excipients">): Generator<Entry> {
  for (const a of excipientAssessments(project)) for (const l of a.lines) yield* Object.values(l.facts);
}

/** Every specification side of every line, for source removal. */
export function* allExcipientSpecSides(project: Pick<Project, "excipients">): Generator<ExcipientSpecSide> {
  for (const a of excipientAssessments(project)) for (const l of a.lines) for (const r of l.specs) yield r.sending, r.receiving;
}

// ------------------------------------------------------------------ zod

const locationSchema = z.object({ section: z.string().optional(), page: z.string().optional() });

/**
 * Builds the schemas. They need the project's entry schema, which lives in schema.ts, and schema.ts imports this file: so the entry schema
 * is handed in instead of imported here (no import cycle at load time).
 */
export function buildExcipientSchemas(entry: z.ZodTypeAny) {
  const specSide = z
    .object({
      state: z.enum(["open", "stated", "not_tested"]),
      method: z.string().optional(),
      criterion: z.string().optional(),
      unit: z.string().optional(),
      sourceIds: z.array(z.string()),
      sourceLocations: z.record(z.string(), locationSchema).optional(),
    })
    .superRefine((s, ctx) => {
      if (s.state === "stated" && !s.criterion?.trim()) ctx.addIssue({ code: "custom", message: "A stated criterion needs its text" });
      if (s.state !== "stated" && s.criterion !== undefined) ctx.addIssue({ code: "custom", message: "Only a stated criterion has text" });
      for (const id of Object.keys(s.sourceLocations ?? {})) if (!s.sourceIds.includes(id)) ctx.addIssue({ code: "custom", message: `A location is kept for source ${id}, which the row does not cite` });
    });
  const specRow = z.object({
    id: z.string().regex(/^EXR-\d+$/),
    test: z.string().trim().min(1),
    promptKey: z.string().optional(),
    note: z.string().optional(),
    sending: specSide,
    receiving: specSide,
  });
  const line = z
    .object({
      id: z.string().regex(/^EXL-\d+$/),
      name: z.string().trim().min(1),
      classKey: z.string().min(1).optional(),
      classLabel: z.string().trim().min(1).optional(),
      facts: z.record(z.string(), entry),
      specs: z.array(specRow),
      links: z.object({
        gapIds: z.array(z.string()),
        riskItems: z.array(z.object({ assessmentId: z.string(), itemId: z.string() })),
        trdItem: z.object({ trdId: z.string(), stepKey: z.string(), itemKey: z.string() }).optional(),
        regulatoryReference: z.string().optional(),
      }),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .superRefine((l, ctx) => {
      if (l.classKey && l.classLabel) ctx.addIssue({ code: "custom", message: `${l.id} has both a listed class and the person's own words` });
      for (const [path, e] of Object.entries(l.facts as Record<string, { path: string }>)) if (e.path !== path) ctx.addIssue({ code: "custom", message: `Fact ${path} is stored under another path (${e.path})` });
      const rows = new Set<string>();
      for (const r of l.specs) {
        if (rows.has(r.id)) ctx.addIssue({ code: "custom", message: `${l.id} has comparison row ${r.id} twice` });
        rows.add(r.id);
      }
    });
  const assessment = z
    .object({
      id: z.string().regex(/^EXA-\d+$/),
      title: z.string().trim().min(1),
      status: z.literal("draft"),
      scopeNote: z.string().optional(),
      lines: z.array(line),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .superRefine((a, ctx) => {
      const ids = new Set<string>();
      for (const l of a.lines) {
        if (ids.has(l.id)) ctx.addIssue({ code: "custom", message: `${a.id} has excipient ${l.id} twice` });
        ids.add(l.id);
      }
    });
  const state = z.object({ assessments: z.array(assessment) }).superRefine((s, ctx) => {
    const ids = new Set<string>();
    for (const a of s.assessments) {
      if (ids.has(a.id)) ctx.addIssue({ code: "custom", message: `Excipient assessment ${a.id} exists twice` });
      ids.add(a.id);
    }
  });
  return { assessment, state };
}

/** What a stored value of a fact must look like, said as a type so the engine and the tests agree. */
export type ExcipientFactValue = EntryValue;
