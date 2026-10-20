import {
  CUSTOM_ITEM_KINDS,
  UNITS,
  customKeyFromLabel,
  isCustomKey,
  unitsForDimension,
  type Actor,
  type CollectionKind,
  type CustomDefinitions,
  type CustomItem,
  type CustomItemKind,
  type CustomUnitOperation,
  type Entry,
  type Project,
} from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { Catalog, Question, Section } from "./content-schema";

/**
 * Custom unit operations and custom items.
 *
 * Definitions are stored in the project (`project.custom`). effectiveContent() turns them into ordinary
 * Section and Question objects, so the sequencer, interview, comparison, register, CSV and document
 * handle them with no special cases. The synthesized questions use these paths, which the existing
 * rules already match:
 *   uo.<x_uo>.presence                         yes/no, paired        -> R-UO-PRESENCE
 *   uo.<uo>.param.<x_key>                      parameter, paired     -> R-PARAM-RANGE
 *   uo.<uo>.equip.<x_key>.operatingPrinciple   text, paired          -> R-GEN-EQUIP-PRINCIPLE
 *   uo.<uo>.equip.<x_key>.capacity             quantity, paired      -> R-EQUIP-CAPACITY (only with a dimension)
 *   uo.<uo>.mat.<x_key>.present                yes/no, paired        -> R-GEN-MAT-PRESENCE
 *   uo.<uo>.mat.<x_key>.supplier / .partNumber text, when present    -> R-COMPONENT
 *   uo.<uo>.ipc.<x_key>.description            text, paired          -> R-GEN-IPC-DESCRIPTION
 */

export class CustomError extends Error {}

export const CUSTOM_TAG = "custom";
const MAX_LABEL = 80;
/** Section order of the site section; custom unit operations are always placed after it. */
const FIRST_UO_ORDER = 10;

export const CUSTOM_KIND_LABELS: Record<CustomItemKind, string> = {
  param: "Process parameter",
  equip: "Equipment",
  mat: "Material or component",
  ipc: "In-process control",
};

// ------------------------------------------------------------------ dimensions

export interface UnitDimension {
  dimension: string;
  label: string;
  units: string[];
}

/** Dimensions available for custom parameters, from the units table. */
export function unitDimensions(): UnitDimension[] {
  const out = new Map<string, UnitDimension>();
  for (const u of UNITS) {
    const d = out.get(u.dimension) ?? {
      dimension: u.dimension,
      label: u.dimension.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      units: [],
    };
    d.units.push(u.symbol);
    out.set(u.dimension, d);
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ synthesis

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

function defaultWhy(what: string, by: string, at: string): string {
  return `${what} added by ${by} on ${dateOf(at)}.`;
}

function unitSymbols(dimension: string | undefined): string[] {
  return dimension ? unitsForDimension(dimension).map((u) => u.symbol) : [];
}

function itemQuestions(item: CustomItem, sectionId: string): Question[] {
  const why = item.why?.trim() || defaultWhy("Custom item", item.createdBy, item.createdAt);
  const base = `uo.${item.uo}.${item.coll}.${item.key}`;
  const id = (suffix = "") => `x.${item.uo}.${item.coll}.${item.key}${suffix}`;
  const common = { section: sectionId, why, sides: "paired" as const, tags: [CUSTOM_TAG] };
  const label = item.label;
  switch (item.coll) {
    case "param": {
      const units = unitSymbols(item.dimension);
      if (!units.length) return [];
      return [
        {
          ...common,
          id: id(),
          prompt: `What are the classification, set point and operating ranges for ${label}?`,
          label,
          binds: `uo.${item.uo}.param.${item.key}`,
          input: { type: "parameter", dimension: item.dimension!, units },
        },
      ];
    }
    case "equip": {
      const out: Question[] = [
        {
          ...common,
          id: id(".principle"),
          prompt: `What is the operating principle of ${label}?`,
          label: `${label}: operating principle`,
          binds: `${base}.operatingPrinciple`,
          input: { type: "text", placeholder: "Describe how the equipment works" },
        },
      ];
      const units = unitSymbols(item.dimension);
      if (units.length) {
        out.push({
          ...common,
          id: id(".capacity"),
          prompt: `What is the capacity or size of ${label}?`,
          label: `${label}: capacity`,
          binds: `${base}.capacity`,
          input: { type: "quantity", dimension: item.dimension!, units },
        });
      }
      return out;
    }
    case "mat": {
      // Supplier and part number are asked only where the material is used on both sides; a difference
      // in use is already reported by the presence comparison.
      const whenUsed = { all: [{ isTrue: `source.${base}.present` }, { isTrue: `target.${base}.present` }] };
      return [
        {
          ...common,
          id: id(".present"),
          prompt: `Is ${label} used?`,
          label: `${label}: used`,
          binds: `${base}.present`,
          input: { type: "yes_no" },
        },
        {
          ...common,
          id: id(".supplier"),
          parent: id(".present"),
          prompt: `Who supplies ${label}?`,
          label: `${label}: supplier`,
          binds: `${base}.supplier`,
          input: { type: "text", placeholder: "Supplier name" },
          showWhen: whenUsed,
        },
        {
          ...common,
          id: id(".part_number"),
          parent: id(".present"),
          prompt: `What is the part number of ${label}?`,
          label: `${label}: part number`,
          binds: `${base}.partNumber`,
          input: { type: "text", placeholder: "Part number" },
          showWhen: whenUsed,
        },
      ];
    }
    case "ipc":
      return [
        {
          ...common,
          id: id(),
          prompt: `How is ${label} performed (method, frequency and acceptance criteria)?`,
          label,
          binds: `${base}.description`,
          input: { type: "text", placeholder: "Describe the control" },
        },
      ];
  }
}

function presenceQuestion(sectionId: string, uo: string, label: string, why: string, custom: boolean): Question {
  return {
    id: `x.${uo}.presence`,
    section: sectionId,
    prompt: `Is ${label} performed at this site?`,
    label: `${label} performed`,
    why,
    sides: "paired",
    binds: `uo.${uo}.presence`,
    input: { type: "yes_no" },
    ...(custom ? { tags: [CUSTOM_TAG] } : {}),
  };
}

function hasDefinitions(c: CustomDefinitions | undefined): c is CustomDefinitions {
  return !!c && (c.unitOperations.length > 0 || c.items.length > 0);
}

function synthesize(base: ContentBundle, custom: CustomDefinitions): ContentBundle {
  const sections: Section[] = [...base.sections];
  const questions: Question[] = [...base.questions];
  const have = new Set(sections.map((s) => s.id));

  const catalogUos: Catalog["unitOperations"] = base.catalog.unitOperations.map((u) => ({
    ...u,
    items: [...u.items, ...custom.items.filter((i) => i.uo === u.key).map((i) => ({ coll: i.coll, key: i.key, label: i.label }))],
  }));
  for (const u of custom.unitOperations) {
    catalogUos.push({
      key: u.key,
      label: u.label,
      sequence: u.sequence,
      description: u.description?.trim() || defaultWhy("Custom unit operation", u.createdBy, u.createdAt),
      milestone: 0,
      items: custom.items.filter((i) => i.uo === u.key).map((i) => ({ coll: i.coll, key: i.key, label: i.label })),
    });
  }
  catalogUos.sort((a, b) => a.sequence - b.sequence);

  const customUos = new Map(custom.unitOperations.map((u) => [u.key, u]));
  const withItems = new Set(custom.items.map((i) => i.uo));
  for (const u of catalogUos) {
    const id = `uo.${u.key}`;
    const isCustom = customUos.has(u.key);
    const needsSection = !have.has(id) && (isCustom || withItems.has(u.key));
    if (!needsSection) continue;
    const def = customUos.get(u.key);
    sections.push({
      id,
      title: u.label,
      kind: "uo",
      uo: u.key,
      order: u.sequence,
      ...(isCustom ? { intro: u.description } : {}),
    });
    have.add(id);
    questions.push(
      presenceQuestion(
        id,
        u.key,
        u.label,
        def ? def.description?.trim() || defaultWhy("Custom unit operation", def.createdBy, def.createdAt) : "Establishes whether the unit operation exists at each site.",
        isCustom,
      ),
    );
  }

  const known = new Set(catalogUos.map((u) => u.key));
  const order = (c: CustomItemKind) => CUSTOM_ITEM_KINDS.indexOf(c);
  const items = custom.items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => known.has(item.uo))
    .sort((a, b) => order(a.item.coll) - order(b.item.coll) || a.i - b.i);
  for (const { item } of items) questions.push(...itemQuestions(item, `uo.${item.uo}`));

  sections.sort((a, b) => a.order - b.order);
  return {
    ...base,
    catalog: { ...base.catalog, unitOperations: catalogUos },
    sections,
    questions,
    questionById: new Map(questions.map((q) => [q.id, q])),
    sectionById: new Map(sections.map((s) => [s.id, s])),
    effectiveOf: base,
  };
}

const byReference = new WeakMap<ContentBundle, WeakMap<CustomDefinitions, ContentBundle>>();
const bySignature = new WeakMap<ContentBundle, Map<string, ContentBundle>>();
const SIGNATURE_CACHE_SIZE = 32;

/** The loaded bundle behind an effective bundle (or the bundle itself). */
export function baseContent(content: ContentBundle): ContentBundle {
  return content.effectiveOf ?? content;
}

/**
 * The content bundle to use for a project: the loaded bundle plus Section and Question objects
 * synthesized from the project's custom definitions. A project with no custom definitions gets the
 * loaded bundle itself. Memoised by reference (the same definitions object gives the same bundle) and
 * by definition value (a cloned project with equal definitions also gets the same bundle).
 */
export function effectiveContent(content: ContentBundle, project: Pick<Project, "custom">): ContentBundle {
  const base = baseContent(content);
  const custom = project.custom;
  if (!hasDefinitions(custom)) return base;
  let refs = byReference.get(base);
  if (!refs) byReference.set(base, (refs = new WeakMap()));
  const hit = refs.get(custom);
  if (hit) return hit;
  let sigs = bySignature.get(base);
  if (!sigs) bySignature.set(base, (sigs = new Map()));
  const sig = JSON.stringify(custom);
  let bundle = sigs.get(sig);
  if (!bundle) {
    bundle = synthesize(base, custom);
    if (sigs.size >= SIGNATURE_CACHE_SIZE) sigs.delete(sigs.keys().next().value!);
    sigs.set(sig, bundle);
  }
  refs.set(custom, bundle);
  return bundle;
}

/** True for questions synthesized from custom definitions. */
export function isCustomQuestion(q: Question): boolean {
  return !!q.tags?.includes(CUSTOM_TAG);
}

/** True for the section of a custom unit operation. */
export function isCustomSection(s: Section): boolean {
  return s.kind === "uo" && !!s.uo && isCustomKey(s.uo);
}

// ------------------------------------------------------------------ definitions: helpers

function clean(label: string, what: string): string {
  const t = label.replace(/\s+/g, " ").trim();
  if (!t) throw new CustomError(`Enter a name for the ${what}.`);
  if (t.length > MAX_LABEL) throw new CustomError(`The name of the ${what} is longer than ${MAX_LABEL} characters.`);
  return t;
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

function modelKeys(project: Project, pick: (p: Project, side: "source" | "target") => Iterable<string>): string[] {
  return (["source", "target"] as const).flatMap((s) => [...pick(project, s)]);
}

function logged(project: Project, actor: Actor, action: string, path: string, detail: string, extra: { before?: unknown; after?: unknown } = {}): void {
  project.changeLog.push({ at: actor.at, by: actor.name, action, path, detail, ...extra });
}

function ensureCustom(next: Project): CustomDefinitions {
  next.custom ??= { unitOperations: [], items: [] };
  return next.custom;
}

/** Entries recorded for a custom unit operation (all of it) or one custom item. Not-established placeholders are not counted. */
export function recordedEntries(project: Project, target: { uo: string; coll?: CollectionKind; key?: string }): Entry[] {
  const out: Entry[] = [];
  for (const side of ["source", "target"] as const) {
    const uo = project.processes[side].unitOperations[target.uo];
    if (!uo) continue;
    if (target.coll && target.key) {
      out.push(...Object.values(uo.collections[target.coll][target.key]?.fields ?? {}));
    } else {
      out.push(...Object.values(uo.fields));
      for (const coll of Object.values(uo.collections)) for (const item of Object.values(coll)) out.push(...Object.values(item.fields));
    }
  }
  return out.filter((e) => e.status !== "not_established");
}

// ------------------------------------------------------------------ unit operations

export interface NewCustomUnitOperation {
  label: string;
  description?: string;
  /** Place the new unit operation directly after this one (catalog or custom key). Omit to add it at the end. */
  after?: string;
}

export function addCustomUnitOperation(project: Project, content: ContentBundle, input: NewCustomUnitOperation, actor: Actor): Project {
  const eff = effectiveContent(content, project);
  const label = clean(input.label, "unit operation");
  const uos = eff.catalog.unitOperations;
  if (uos.some((u) => same(u.label, label))) throw new CustomError(`A unit operation named “${label}” already exists.`);

  let sequence: number;
  if (input.after === undefined) {
    sequence = (uos.length ? Math.max(...uos.map((u) => u.sequence)) : 0) + 10;
  } else {
    const i = uos.findIndex((u) => u.key === input.after);
    if (i < 0) throw new CustomError("Choose a unit operation from the list to place the new one after.");
    const prev = uos[i]!.sequence;
    const nextSeq = uos[i + 1]?.sequence;
    sequence = nextSeq === undefined ? prev + 10 : Math.round(((prev + nextSeq) / 2) * 1e6) / 1e6;
    if (nextSeq !== undefined && (sequence <= prev || sequence >= nextSeq)) throw new CustomError("There is no room to add a unit operation at that position.");
  }
  sequence = Math.max(sequence, FIRST_UO_ORDER + 0.5);

  const taken = [
    ...uos.map((u) => u.key),
    ...project.custom.unitOperations.map((u) => u.key),
    ...modelKeys(project, (p, s) => Object.keys(p.processes[s].unitOperations)),
  ];
  const key = customKeyFromLabel(label, taken);
  const def: CustomUnitOperation = {
    key,
    label,
    sequence,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    createdBy: actor.name,
    createdAt: actor.at,
  };
  const next = structuredClone(project);
  ensureCustom(next).unitOperations.push(def);
  logged(next, actor, "custom_uo_add", `uo.${key}`, `Added unit operation “${label}”`, { after: def });
  return next;
}

export function renameCustomUnitOperation(project: Project, key: string, label: string, actor: Actor): Project {
  const def = project.custom.unitOperations.find((u) => u.key === key);
  if (!def) throw new CustomError("That custom unit operation no longer exists.");
  const text = clean(label, "unit operation");
  if (project.custom.unitOperations.some((u) => u.key !== key && same(u.label, text))) throw new CustomError(`A unit operation named “${text}” already exists.`);
  const next = structuredClone(project);
  const d = next.custom.unitOperations.find((u) => u.key === key)!;
  d.label = text;
  for (const side of ["source", "target"] as const) {
    const uo = next.processes[side].unitOperations[key];
    if (uo) uo.label = text;
  }
  logged(next, actor, "custom_uo_rename", `uo.${key}`, `Renamed “${def.label}” to “${text}”`, { before: { label: def.label }, after: { label: text } });
  return next;
}

/**
 * Removes the definition of a custom unit operation, and of its custom items. Values already recorded
 * stay in the project; they become inactive (excluded from comparison and document, and listed as inactive).
 */
export function removeCustomUnitOperation(project: Project, key: string, actor: Actor): Project {
  const def = project.custom.unitOperations.find((u) => u.key === key);
  if (!def) throw new CustomError("That custom unit operation no longer exists.");
  const kept = recordedEntries(project, { uo: key }).length;
  const next = structuredClone(project);
  next.custom.unitOperations = next.custom.unitOperations.filter((u) => u.key !== key);
  const dropped = next.custom.items.filter((i) => i.uo === key);
  next.custom.items = next.custom.items.filter((i) => i.uo !== key);
  logged(
    next,
    actor,
    "custom_uo_remove",
    `uo.${key}`,
    `Removed unit operation “${def.label}” and ${dropped.length} custom item definition(s); ${kept} recorded value(s) kept as inactive`,
    { before: { definition: def, items: dropped } },
  );
  return next;
}

// ------------------------------------------------------------------ items

export interface NewCustomItem {
  uo: string;
  coll: CustomItemKind;
  label: string;
  /** Parameters: required. Equipment: optional, enables a capacity question. Not used for materials or controls. */
  dimension?: string;
  why?: string;
}

export interface CustomItemRef {
  uo: string;
  coll: CustomItemKind;
  key: string;
}

export function addCustomItem(project: Project, content: ContentBundle, input: NewCustomItem, actor: Actor): Project {
  const eff = effectiveContent(content, project);
  const uo = eff.catalog.unitOperations.find((u) => u.key === input.uo);
  if (!uo) throw new CustomError("Choose a unit operation for the new item.");
  if (!CUSTOM_ITEM_KINDS.includes(input.coll)) throw new CustomError("Choose what kind of item to add.");
  const label = clean(input.label, "item");
  if (uo.items.some((i) => i.coll === input.coll && same(i.label, label))) {
    throw new CustomError(`${uo.label} already has ${CUSTOM_KIND_LABELS[input.coll].toLowerCase()} “${label}”.`);
  }
  const dimension = input.dimension?.trim() || undefined;
  if (input.coll === "param" && !dimension) throw new CustomError("Choose the unit dimension for the parameter.");
  if (dimension) {
    if (input.coll !== "param" && input.coll !== "equip") throw new CustomError("Only parameters and equipment take a unit dimension.");
    if (!unitsForDimension(dimension).length) throw new CustomError(`Unknown unit dimension “${dimension}”.`);
  }
  const taken = [
    ...uo.items.map((i) => i.key),
    ...modelKeys(project, (p, s) => {
      const m = p.processes[s].unitOperations[input.uo];
      return m ? CUSTOM_ITEM_KINDS.flatMap((c) => Object.keys(m.collections[c])) : [];
    }),
  ];
  const key = customKeyFromLabel(label, taken);
  const def: CustomItem = {
    uo: input.uo,
    coll: input.coll,
    key,
    label,
    ...(dimension ? { dimension } : {}),
    ...(input.why?.trim() ? { why: input.why.trim() } : {}),
    createdBy: actor.name,
    createdAt: actor.at,
  };
  const next = structuredClone(project);
  ensureCustom(next).items.push(def);
  logged(next, actor, "custom_item_add", `uo.${input.uo}.${input.coll}.${key}`, `Added ${CUSTOM_KIND_LABELS[input.coll].toLowerCase()} “${label}” to ${uo.label}`, { after: def });
  return next;
}

function findItem(project: Project, ref: CustomItemRef): CustomItem {
  const def = project.custom.items.find((i) => i.uo === ref.uo && i.coll === ref.coll && i.key === ref.key);
  if (!def) throw new CustomError("That custom item no longer exists.");
  return def;
}

export function renameCustomItem(project: Project, ref: CustomItemRef, label: string, actor: Actor): Project {
  const def = findItem(project, ref);
  const text = clean(label, "item");
  if (project.custom.items.some((i) => i !== def && i.uo === ref.uo && i.coll === ref.coll && same(i.label, text))) {
    throw new CustomError(`An item named “${text}” already exists here.`);
  }
  const next = structuredClone(project);
  next.custom.items.find((i) => i.uo === ref.uo && i.coll === ref.coll && i.key === ref.key)!.label = text;
  for (const side of ["source", "target"] as const) {
    const item = next.processes[side].unitOperations[ref.uo]?.collections[ref.coll][ref.key];
    if (item) item.label = text;
  }
  logged(next, actor, "custom_item_rename", `uo.${ref.uo}.${ref.coll}.${ref.key}`, `Renamed “${def.label}” to “${text}”`, {
    before: { label: def.label },
    after: { label: text },
  });
  return next;
}

/** Removes a custom item definition. Recorded values are kept and become inactive. */
export function removeCustomItem(project: Project, ref: CustomItemRef, actor: Actor): Project {
  const def = findItem(project, ref);
  const kept = recordedEntries(project, { uo: ref.uo, coll: ref.coll, key: ref.key }).length;
  const next = structuredClone(project);
  next.custom.items = next.custom.items.filter((i) => !(i.uo === ref.uo && i.coll === ref.coll && i.key === ref.key));
  logged(next, actor, "custom_item_remove", `uo.${ref.uo}.${ref.coll}.${ref.key}`, `Removed “${def.label}”; ${kept} recorded value(s) kept as inactive`, { before: def });
  return next;
}

/** Parses a bound path into the custom definition it belongs to, if any. */
export function customDefinitionOf(binds: string): { uo: string; coll?: CustomItemKind; key?: string } | undefined {
  const s = binds.split(".");
  if (s[0] !== "uo" || s.length < 3) return undefined;
  if (s.length >= 4 && isCustomKey(s[3]!) && (CUSTOM_ITEM_KINDS as readonly string[]).includes(s[2]!)) {
    return { uo: s[1]!, coll: s[2] as CustomItemKind, key: s[3]! };
  }
  if (s.length === 3 && s[2] === "presence" && isCustomKey(s[1]!)) return { uo: s[1]! };
  return undefined;
}
