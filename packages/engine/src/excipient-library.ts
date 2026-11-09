import {
  excipientLibraryRecordSchema,
  type Actor,
  type ExcipientLibraryRecord,
  type ExcipientLibraryTest,
  type ExcipientLibraryVersion,
  type ExcipientLine,
  type ExcipientSide,
  type ExcipientSpecRow,
  type Project,
} from "@gap/process-model";
import { specCounts } from "./excipient-analysis";
import { addExcipientLine, addSpecRow, updateExcipientLine, updateSpecRow, type ExcipientClassCheck, type SpecSidePatch } from "./excipient";

/*
 * The excipient library: pure rules (no storage, so they are tested on their own). Same rules as the write-up library.
 *
 *  - A record is versioned. Saving an edit makes version + 1 and keeps the WHOLE earlier content in `history`.
 *  - A line made from a record is a copy. A library edit never reaches a project by itself; "Update from library" shows what differs and
 *    the person chooses item by item. Nothing the person wrote is replaced unless they choose it.
 *  - The library holds no facts about a product (no supplier, grade or limit), so nothing in it can be taken for an answer.
 *  - The project file stores no link to the library, so the library can be emptied or changed without touching any project.
 */

export class ExcipientLibraryError extends Error {}

const clean = (r: ExcipientLibraryRecord): ExcipientLibraryRecord => {
  const ok = excipientLibraryRecordSchema.safeParse(r);
  if (!ok.success) throw new ExcipientLibraryError(ok.error.issues[0]?.message ?? "The saved excipient is not valid.");
  return ok.data;
};

const trimmed = (t: string | undefined): string => (t ?? "").trim();
const key = (t: string): string => t.trim().toLowerCase();

export interface ExcipientLibraryInput {
  name: string;
  classKey?: string | undefined;
  classLabel?: string | undefined;
  tests?: ExcipientLibraryTest[] | undefined;
  prompts?: string[] | undefined;
}

/** Tests with a blank name dropped and repeats (same name, any case) kept once, in their order. */
function cleanTests(tests: readonly ExcipientLibraryTest[] = []): ExcipientLibraryTest[] {
  const seen = new Set<string>();
  const out: ExcipientLibraryTest[] = [];
  for (const t of tests) {
    const name = trimmed(t.test);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    const note = trimmed(t.note);
    out.push({ test: name, ...(t.promptKey ? { promptKey: t.promptKey } : {}), ...(note ? { note } : {}) });
  }
  return out;
}

function cleanPrompts(prompts: readonly string[] = []): string[] {
  const seen = new Set<string>();
  return prompts.map(trimmed).filter((p) => p && !seen.has(key(p)) && seen.add(key(p)));
}

const classOf = (i: ExcipientLibraryInput): { classKey?: string; classLabel?: string } => {
  const classKey = trimmed(i.classKey);
  const classLabel = trimmed(i.classLabel);
  return classKey ? { classKey } : classLabel ? { classLabel } : {};
};

/** The id for a new record: "xl_" and the name in lower case with underscores, made unique among the ids already in the library. */
export function libraryIdFor(name: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  const base = `xl_${key(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 44) || "excipient"}`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** The content of a record version (no history, no bookkeeping beyond who and when). */
export function recordVersionOf(r: ExcipientLibraryRecord | ExcipientLibraryVersion): ExcipientLibraryVersion {
  return {
    version: r.version,
    name: r.name,
    ...(r.classKey ? { classKey: r.classKey } : {}),
    ...(r.classLabel ? { classLabel: r.classLabel } : {}),
    tests: structuredClone(r.tests),
    prompts: [...r.prompts],
    ...(r.at ? { at: r.at } : {}),
    ...(r.by ? { by: r.by } : {}),
  };
}

/** A new library record (version 1). */
export function newLibraryRecord(id: string, input: ExcipientLibraryInput, now: string, by: string): ExcipientLibraryRecord {
  return clean({ id, version: 1, name: trimmed(input.name), ...classOf(input), tests: cleanTests(input.tests), prompts: cleanPrompts(input.prompts), at: now, by });
}

/** The record a line makes: its name, its class and the tests of its comparison table (not the values written in them). */
export function libraryRecordFromLine(line: ExcipientLine, id: string, now: string, by: string): ExcipientLibraryRecord {
  return newLibraryRecord(id, { name: line.name, classKey: line.classKey, classLabel: line.classLabel, tests: line.specs.map((r) => ({ test: r.test, ...(r.promptKey ? { promptKey: r.promptKey } : {}), ...(r.note ? { note: r.note } : {}) })) }, now, by);
}

const contentOf = (i: ExcipientLibraryInput): string => JSON.stringify({ name: trimmed(i.name), ...classOf(i), tests: cleanTests(i.tests), prompts: cleanPrompts(i.prompts) });

/** True when an edit changes anything. An unchanged save does not make a version. */
export function editChangesRecord(cur: ExcipientLibraryRecord, edit: ExcipientLibraryInput): boolean {
  return contentOf(cur) !== contentOf(edit);
}

/** The record after an edit: the next version, with the whole earlier content kept in the history. */
export function editLibraryRecord(cur: ExcipientLibraryRecord, edit: ExcipientLibraryInput, now: string, by: string): ExcipientLibraryRecord {
  if (!editChangesRecord(cur, edit)) return cur;
  return clean({ id: cur.id, version: cur.version + 1, name: trimmed(edit.name), ...classOf(edit), tests: cleanTests(edit.tests), prompts: cleanPrompts(edit.prompts), at: now, by, history: [...(cur.history ?? []), recordVersionOf(cur)] });
}

/** The saved excipient with this name (any capitals), or undefined. Used to offer "new version of the saved one" and the library's own prompts. */
export function findLibraryMatch(records: readonly ExcipientLibraryRecord[], name: string): ExcipientLibraryRecord | undefined {
  const k = key(name);
  return k ? records.find((r) => key(r.name) === k) : undefined;
}

// ------------------------------------------------------------------ start from the library

/**
 * Adds one line for each chosen record to an assessment: the name, the class and the tests (both sites open). No fact is filled in.
 * The line is a copy; the project keeps no link back to the record.
 */
export function addLibraryLines(project: Project, assessmentId: string, records: readonly ExcipientLibraryRecord[], actor: Actor, check: ExcipientClassCheck = {}): { project: Project; lineIds: string[] } {
  let p = project;
  const lineIds: string[] = [];
  for (const r of records) {
    // A class that left the class list is not carried: the line starts without a class rather than with one the tool does not offer.
    const classOk = !!r.classKey && (!check.classKeys || check.classKeys.includes(r.classKey));
    const added = addExcipientLine(p, assessmentId, { name: r.name, ...(classOk ? { classKey: r.classKey! } : r.classLabel ? { classLabel: r.classLabel } : {}) }, actor, check);
    p = added.project;
    lineIds.push(added.lineId);
    for (const t of r.tests) {
      const row = addSpecRow(p, assessmentId, added.lineId, { test: t.test, ...(t.promptKey ? { promptKey: t.promptKey } : {}) }, actor);
      p = row.project;
      if (t.note) p = updateSpecRow(p, assessmentId, added.lineId, row.rowId, { note: t.note }, actor);
    }
  }
  return { project: p, lineIds };
}

// ------------------------------------------------------------------ update from the library

export interface LibraryChange {
  /** "name", "class", "test:<lower-case test>" or "note:<lower-case test>". */
  key: string;
  kind: "name" | "class" | "test_added" | "note";
  label: string;
  /** What the line has now (empty for a test the line does not have). */
  mine: string;
  /** What the library has. */
  library: string;
}

/** What the saved excipient says that the line does not: a different name or class, a note that differs, and tests the line lacks. Tests only the line has are left alone. */
export function compareLineToLibrary(line: ExcipientLine, record: ExcipientLibraryRecord, classLabelOf: (key: string) => string = (k) => k): LibraryChange[] {
  const out: LibraryChange[] = [];
  if (line.name !== record.name) out.push({ key: "name", kind: "name", label: "Name", mine: line.name, library: record.name });
  const libClass = record.classKey ? classLabelOf(record.classKey) : record.classLabel;
  const myClass = line.classKey ? classLabelOf(line.classKey) : line.classLabel;
  const sameClass = record.classKey ? line.classKey === record.classKey : line.classLabel === record.classLabel && !line.classKey;
  if (libClass && !sameClass) out.push({ key: "class", kind: "class", label: "Role", mine: myClass ?? "", library: libClass });
  for (const t of record.tests) {
    const row = line.specs.find((r) => key(r.test) === key(t.test));
    if (!row) out.push({ key: `test:${key(t.test)}`, kind: "test_added", label: `Test: ${t.test}`, mine: "", library: t.note ? `${t.test} (${t.note})` : t.test });
    else if (t.note && (row.note ?? "") !== t.note) out.push({ key: `note:${key(t.test)}`, kind: "note", label: `Note on ${row.test}`, mine: row.note ?? "", library: t.note });
  }
  return out;
}

/**
 * Applies the chosen changes (their keys) and nothing else. A change not chosen leaves the line exactly as it was. Never touches a fact,
 * a value written in a comparison row or a link.
 */
export function applyLibraryChanges(project: Project, assessmentId: string, lineId: string, record: ExcipientLibraryRecord, chosen: readonly string[], actor: Actor, check: ExcipientClassCheck = {}): Project {
  const line = project.excipients?.assessments.find((x) => x.id === assessmentId)?.lines.find((l) => l.id === lineId);
  if (!line) throw new ExcipientLibraryError(`There is no excipient ${lineId} in ${assessmentId}.`);
  const wanted = new Set(chosen);
  let p = project;
  for (const c of compareLineToLibrary(line, record)) {
    if (!wanted.has(c.key)) continue;
    if (c.kind === "name") {
      p = updateExcipientLine(p, assessmentId, lineId, { name: record.name }, actor, check);
      continue;
    }
    if (c.kind === "class") {
      const classOk = !!record.classKey && (!check.classKeys || check.classKeys.includes(record.classKey));
      if (classOk) p = updateExcipientLine(p, assessmentId, lineId, { classKey: record.classKey! }, actor, check);
      else if (record.classLabel) p = updateExcipientLine(p, assessmentId, lineId, { classLabel: record.classLabel }, actor, check);
      continue;
    }
    const testKey = c.key.slice(c.key.indexOf(":") + 1);
    const t = record.tests.find((x) => key(x.test) === testKey);
    if (!t) continue;
    if (c.kind === "test_added") {
      const row = addSpecRow(p, assessmentId, lineId, { test: t.test, ...(t.promptKey ? { promptKey: t.promptKey } : {}) }, actor);
      p = row.project;
      if (t.note) p = updateSpecRow(p, assessmentId, lineId, row.rowId, { note: t.note }, actor);
    } else {
      const now = p.excipients?.assessments.find((x) => x.id === assessmentId)?.lines.find((l) => l.id === lineId)?.specs.find((r) => key(r.test) === testKey);
      if (now && t.note) p = updateSpecRow(p, assessmentId, lineId, now.id, { note: t.note }, actor);
    }
  }
  return p;
}

// ------------------------------------------------------------------ copy rows from the other site

/**
 * What "Copy from the other site" would write into one side of a test: the other side's method, criterion, unit and cited documents, but
 * only into boxes that are still empty on this side. Nothing already written is replaced, and a test marked "no such test" is left as it
 * is. Returns undefined when there is nothing to copy.
 */
export function copyFromOtherSite(row: ExcipientSpecRow, into: ExcipientSide): SpecSidePatch | undefined {
  const from = row[into === "sending" ? "receiving" : "sending"];
  const to = row[into];
  if (to.state === "not_tested") return undefined;
  const patch: SpecSidePatch = {};
  if (from.method && !to.method) patch.method = from.method;
  if (from.state === "stated" && from.criterion && to.state === "open") {
    patch.criterion = from.criterion;
    if (from.unit && !to.unit) patch.unit = from.unit;
  } else if (from.unit && !to.unit && to.state === "stated") patch.unit = from.unit;
  if (from.sourceIds.length > 0 && to.sourceIds.length === 0) {
    patch.sourceIds = [...from.sourceIds];
    if (from.sourceLocations) patch.sourceLocations = structuredClone(from.sourceLocations);
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** How many tests of a line can take something from the other site into this side (for the button's label). */
export function copyableTests(line: ExcipientLine, into: ExcipientSide): number {
  return line.specs.filter((r) => copyFromOtherSite(r, into)).length;
}

/**
 * The text of one excipient in the Specifications tab's picker: its name, how many tests it has, how many differ (only when some do) and
 * how many are not compared. Kept short because a closed list cuts long text at 390 px; the full counts sit under the list.
 */
export function specPickerText(name: string, line: Pick<ExcipientLine, "specs">): string {
  const c = specCounts(line);
  if (c.rows === 0) return `${name} (no tests yet)`;
  const differ = c.different + c.onlyAtOneSite;
  return `${name} (${c.rows} ${c.rows === 1 ? "test" : "tests"}${differ > 0 ? `, ${differ} differ` : ""}, ${c.notCompared} not compared)`;
}
