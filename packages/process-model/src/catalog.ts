import { z } from "zod";
import { conditionRefs, conditionSchema, optionSchema } from "./condition";
import { COLLECTION_KINDS } from "./types";

/**
 * The unit-operation catalog of the process model: stage groups, unit operations with their items, field labels and option
 * sets. It describes WHAT a fill/finish process is made of, not how a tool compares or documents it, so it holds nothing that
 * is specific to the gap assessment (gap activities and comparison categories are a gap overlay in the content package).
 * It never supplies answers: option sets are the choices a person may pick, and an item with no recorded value is "not established".
 */

const versionString = z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver x.y.z");

export const catalogSchema = z.object({
  catalog: z.object({ id: z.string(), version: versionString }),
  /** The broad process stages, in process order. Every unit operation is in exactly one group. */
  stageGroups: z.array(
    z.object({
      key: z.string().regex(/^[a-z0-9_]+$/),
      label: z.string(),
      description: z.string(),
      unitOperations: z.array(z.string()).min(1),
    }),
  ),
  unitOperations: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      sequence: z.number(),
      description: z.string(),
      /** First milestone in which the unit operation has questions. */
      milestone: z.number().int(),
      applicableWhen: conditionSchema.optional(),
      /**
       * Hides the whole unit operation for a side when the condition is true for that side. Unlike applicableWhen it may
       * read the side's own site answers ("site.labellingLocation"), so one side can be out of scope while the other is not.
       */
      hiddenWhen: conditionSchema.optional(),
      /**
       * Explicit tailoring topics. Without them the topics are the item collections (parameters, equipment, materials, ...)
       * the unit operation's questions bind to. When declared, every non-presence question of the unit operation names one.
       */
      topics: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]+$/), label: z.string(), description: z.string().optional() })).optional(),
      items: z
        .array(
          z.object({
            coll: z.enum(["param", "equip", "mat", "ipc", "study", "doc"]),
            key: z.string(),
            label: z.string(),
          }),
        )
        .default([]),
    }),
  ),
  fieldLabels: z.record(z.string(), z.string()),
  optionSets: z.record(z.string(), z.array(optionSchema).min(1)),
});
export type Catalog = z.infer<typeof catalogSchema>;

export class CatalogError extends Error {
  constructor(readonly problems: string[]) {
    super(`Catalog validation failed:\n- ${problems.join("\n- ")}`);
  }
}

const COLLECTION_KEYS = new Set<string>(COLLECTION_KINDS);

/**
 * Problems found in a parsed catalog that its schema cannot see: stage groups and unit operations must agree, topics must not
 * shadow an item collection, and conditions may only read the references their kind allows. Returned as a list so a caller can
 * report every problem at once; an empty list means the catalog is sound.
 */
export function catalogProblems(catalog: Catalog): string[] {
  const p: string[] = [];
  const uoKeys = new Set(catalog.unitOperations.map((u) => u.key));
  if (uoKeys.size !== catalog.unitOperations.length) p.push("duplicate unit operation key");

  // A unit operation that is in no group could never be left out of a scope, and one in two groups would have two ticks for one decision.
  const groupOf = new Map<string, string>();
  for (const g of catalog.stageGroups) {
    for (const u of g.unitOperations) {
      if (!uoKeys.has(u)) p.push(`stage group ${g.key}: unknown unit operation "${u}"`);
      else if (groupOf.has(u)) p.push(`unit operation ${u} is in two stage groups (${groupOf.get(u)} and ${g.key})`);
      else groupOf.set(u, g.key);
    }
  }
  for (const u of uoKeys) if (!groupOf.has(u)) p.push(`unit operation ${u} is in no stage group`);

  for (const u of catalog.unitOperations) {
    if (u.applicableWhen) {
      const refs = { refs: [] as string[], paths: [] as string[], uos: [] as string[] };
      conditionRefs(u.applicableWhen, refs);
      for (const r of refs.refs) if (!r.startsWith("scope.")) p.push(`unit operation ${u.key}: applicableWhen may only use scope.* references`);
    }
    if (u.hiddenWhen) {
      const refs = { refs: [] as string[], paths: [] as string[], uos: [] as string[] };
      conditionRefs(u.hiddenWhen, refs);
      for (const r of refs.refs) if (!r.startsWith("site.")) p.push(`unit operation ${u.key}: hiddenWhen may only use site.* references`);
      if (refs.paths.length || refs.uos.length) p.push(`unit operation ${u.key}: hiddenWhen may only compare site.* answers`);
    }
    const topicKeys = new Set((u.topics ?? []).map((t) => t.key));
    if (topicKeys.size !== (u.topics ?? []).length) p.push(`unit operation ${u.key}: duplicate topic key`);
    for (const k of topicKeys) if (COLLECTION_KEYS.has(k)) p.push(`unit operation ${u.key}: topic "${k}" collides with an item collection name`);
  }
  return p;
}

/** Parses and cross-checks a raw catalog (for example parsed YAML). Throws CatalogError listing every problem. */
export function loadCatalog(raw: unknown): Catalog {
  const r = catalogSchema.safeParse(raw);
  if (!r.success) throw new CatalogError(r.error.issues.map((i) => `catalog: ${i.path.map(String).join(".")}: ${i.message}`));
  const problems = catalogProblems(r.data);
  if (problems.length) throw new CatalogError(problems);
  return r.data;
}
