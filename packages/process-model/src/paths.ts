import type { CollectionKind, Entry, ModelItem, ProcessModel, Project, Side, UnitOperation } from "./types";
import { COLLECTION_KINDS } from "./types";

/**
 * Reference grammar (dot separated):
 *   scope.<key>
 *   <side>.site.<field>
 *   <side>.uo.<uo>.<field>
 *   <side>.uo.<uo>.<collection>.<item>.<field>
 * Content files use side-less paths ("uo.compounding.presence"); the engine
 * prefixes the side to form a full reference.
 */
export type ParsedRef =
  | { side: "shared"; kind: "scope"; key: string }
  | { side: Side; kind: "site"; field: string }
  | { side: Side; kind: "uo"; uo: string; field: string }
  | { side: Side; kind: "item"; uo: string; coll: CollectionKind; item: string; field: string };

export class PathError extends Error {}

export function fullRef(side: Side | "shared", path: string): string {
  if (path.startsWith("scope.")) return path;
  if (side === "shared") throw new PathError(`Path "${path}" needs a side`);
  return `${side}.${path}`;
}

export function parseRef(ref: string): ParsedRef {
  const s = ref.split(".");
  if (s[0] === "scope" && s.length === 2) return { side: "shared", kind: "scope", key: s[1]! };
  const side = s[0];
  if (side !== "source" && side !== "target") throw new PathError(`Invalid reference "${ref}"`);
  if (s[1] === "site" && s.length === 3) return { side, kind: "site", field: s[2]! };
  if (s[1] === "uo" && s.length === 4) return { side, kind: "uo", uo: s[2]!, field: s[3]! };
  if (s[1] === "uo" && s.length === 6) {
    const coll = s[3] as CollectionKind;
    if (!COLLECTION_KINDS.includes(coll)) throw new PathError(`Unknown collection "${s[3]}" in "${ref}"`);
    return { side, kind: "item", uo: s[2]!, coll, item: s[4]!, field: s[5]! };
  }
  throw new PathError(`Invalid reference "${ref}"`);
}

/** Validates a side-less content path (as used in question binds and rule matches). */
export function isValidContentPath(path: string): boolean {
  try {
    parseRef(path.startsWith("scope.") ? path : `source.${path}`);
    return true;
  } catch {
    return false;
  }
}

export function sideOfRef(ref: string): Side | "shared" {
  return parseRef(ref).side;
}

/** Strips the side prefix: "source.uo.x.presence" -> "uo.x.presence". */
export function contentPathOf(ref: string): string {
  const p = parseRef(ref);
  return p.side === "shared" ? ref : ref.slice(p.side.length + 1);
}

export function getEntry(project: Project, ref: string): Entry | undefined {
  const p = parseRef(ref);
  if (p.side === "shared") return project.scope[p.key];
  const model = project.processes[p.side];
  if (p.kind === "site") return model.site.fields[p.field];
  const uo = model.unitOperations[p.uo];
  if (!uo) return undefined;
  if (p.kind === "uo") return uo.fields[p.field];
  return uo.collections[p.coll][p.item]?.fields[p.field];
}

/** Supplies labels for unit operations and items created on first write. */
export interface LabelResolver {
  uoLabel(uo: string): string;
  uoSequence(uo: string): number;
  itemLabel(uo: string, coll: CollectionKind, item: string): string;
}

export const KEY_LABELS: LabelResolver = {
  uoLabel: (uo) => uo,
  uoSequence: () => 999,
  itemLabel: (_uo, _coll, item) => item,
};

export function emptyCollections(): Record<CollectionKind, Record<string, ModelItem>> {
  return { param: {}, equip: {}, mat: {}, ipc: {}, study: {}, doc: {} };
}

export function ensureUnitOperation(model: ProcessModel, uo: string, labels: LabelResolver): UnitOperation {
  let u = model.unitOperations[uo];
  if (!u) {
    u = { key: uo, label: labels.uoLabel(uo), sequence: labels.uoSequence(uo), fields: {}, collections: emptyCollections() };
    model.unitOperations[uo] = u;
  }
  return u;
}

/** Writes an entry in place (callers work on a cloned draft). Creates containers as needed. */
export function putEntry(project: Project, entry: Entry, labels: LabelResolver = KEY_LABELS): void {
  const p = parseRef(entry.path);
  if (p.side === "shared") {
    project.scope[p.key] = entry;
    return;
  }
  const model = project.processes[p.side];
  if (p.kind === "site") {
    model.site.fields[p.field] = entry;
    return;
  }
  const uo = ensureUnitOperation(model, p.uo, labels);
  if (p.kind === "uo") {
    uo.fields[p.field] = entry;
    return;
  }
  const coll = uo.collections[p.coll];
  let item = coll[p.item];
  if (!item) {
    item = { key: p.item, label: labels.itemLabel(p.uo, p.coll, p.item), fields: {} };
    coll[p.item] = item;
  }
  item.fields[p.field] = entry;
}

/** Iterates every entry in the project (scope, both sides). */
export function* allEntries(project: Project): Generator<Entry> {
  yield* Object.values(project.scope);
  for (const side of ["source", "target"] as const) {
    const model = project.processes[side];
    yield* Object.values(model.site.fields);
    for (const uo of Object.values(model.unitOperations)) {
      yield* Object.values(uo.fields);
      for (const coll of COLLECTION_KINDS) {
        for (const item of Object.values(uo.collections[coll])) yield* Object.values(item.fields);
      }
    }
  }
}

/** Matches a side-less path against a glob where "*" matches exactly one segment. */
export function pathMatches(glob: string, path: string): boolean {
  const g = glob.split(".");
  const p = path.split(".");
  if (g.length !== p.length) return false;
  return g.every((seg, i) => seg === "*" || seg === p[i]);
}
