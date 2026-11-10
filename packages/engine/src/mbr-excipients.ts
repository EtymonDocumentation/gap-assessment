import {
  GRADE_STANDARD_LABEL,
  excipientAssessments,
  mbrRecordSchema,
  type Actor,
  type ChangeEvent,
  type ExcipientAssessment,
  type ExcipientLine,
  type MbrExcipientUsed,
  type MbrRecord,
  type Project,
} from "@gap/process-model";
import { excipientFactResolved } from "./excipient-analysis";
import { locationText, sourceShort } from "./labels";
import { MbrError } from "./mbr";

/*
 * The optional "Excipients used" table of a batch record (M13 job 4C, MBR format 1.3.0, project schema 1.32.0).
 *
 * Why it exists: the batch record has no dispensing material list (the bill of materials is an entry only the CMO makes), yet a reader of the
 * record wants to see which excipients the process uses and to what grade and specification. The excipient assessment already holds that, so
 * the record can show a short table of it.
 *
 * Rules these functions keep:
 *  - NOTHING IS ADDED BY ITSELF. A line is offered (only lines linked to the TRD the record was built from) and the author ticks the ones to add.
 *  - THE ROW IS A COPY. It keeps its own name, grade statement and specification reference, and says where it came from. The excipient
 *    assessment stays the record of truth: a newer line is only offered as an update, with old and new side by side, and only that click
 *    changes the copy (one logged edit). A deleted source line is said so and the copy stays.
 *  - UNKNOWN STAYS VISIBLE. A value the assessment does not hold is not copied; the table then says "Not established". Nothing is filled in.
 *  - EVERYTHING CAN BE REMOVED, one row or the whole table, with a reason that is kept in the change log.
 *  - The table decides nothing and states no filing category.
 */

/** The words of the table, shared by the app, the HTML and the Word document so all three say the same. */
export const MBR_EXCIPIENTS_TITLE = "Excipients used";
export const MBR_EXCIPIENTS_COLUMNS = ["Excipient", "Grade", "Specification reference", "From the excipient assessment"] as const;
/** The words for a value the excipient assessment does not hold (the excipient assessment document says the same). */
export const MBR_EXCIPIENTS_NOT_ESTABLISHED = "Not established";
export const MBR_EXCIPIENTS_INTRO =
  "The excipients the excipient assessment lists for this record's TRD, as the assessment said when each row was added. Grade and specification are those of the receiving site. The bill of materials stays an entry only the CMO makes.";
export const MBR_EXCIPIENTS_CHANGED = "Changed in the excipient assessment";
export const MBR_EXCIPIENTS_GONE = "No longer in the excipient assessment. This row keeps its copy.";

type Ev = Omit<ChangeEvent, "at" | "by">;
const text = (v: string | undefined | null) => (v ?? "").trim();
const stop = (s: string): string => (/[.!?]$/.test(s.trimEnd()) ? s : `${s}.`);

// ------------------------------------------------------------------ what a line says, in the words of the table

/** The three values a row copies. An empty text means the assessment holds nothing for it. */
export interface ExcipientCopy {
  name: string;
  grade: string;
  specification: string;
}

/** The grade statement for the receiving site: the compendial standards, the monograph edition and the supplier's own words, as far as they are stated. */
function gradeText(project: Project, a: ExcipientAssessment, line: ExcipientLine): string {
  const stated = (key: string) => {
    const r = excipientFactResolved(project, a.id, line.id, key, "receiving");
    return r.status === "established" && !r.provisional && r.value !== undefined ? r.value : undefined;
  };
  const labels: Readonly<Record<string, string>> = GRADE_STANDARD_LABEL;
  const parts: string[] = [];
  const standards = stated("grade");
  if (Array.isArray(standards) && standards.length) parts.push(stop(standards.map((s) => labels[String(s)] ?? String(s)).join(", ")));
  const edition = stated("gradeEdition");
  if (typeof edition === "string" && text(edition)) parts.push(stop(`Monograph edition: ${text(edition)}`));
  const statement = stated("qualityStatement");
  if (typeof statement === "string" && text(statement)) parts.push(stop(`Supplier's statement: ${text(statement)}`));
  return parts.join(" ");
}

/**
 * The documents cited for the receiving site's specification, each named once with the places in it that were recorded ("DOC-1 - Title
 * (§3.1 p.2, §3.3 p.2)"), so a long specification does not repeat its title on every test row.
 */
function specificationText(project: Project, line: ExcipientLine): string {
  const byDoc = new Map<string, { name: string; places: string[] }>();
  for (const row of line.specs) {
    for (const id of row.receiving.sourceIds) {
      const s = project.sources.find((x) => x.id === id);
      if (!s) continue;
      const doc = byDoc.get(sourceShort(s)) ?? { name: sourceShort(s), places: [] };
      const place = locationText(row.receiving.sourceLocations?.[id]);
      if (place && !doc.places.includes(place)) doc.places.push(place);
      byDoc.set(doc.name, doc);
    }
  }
  return [...byDoc.values()].map((d) => (d.places.length ? `${d.name} (${d.places.join(", ")})` : d.name)).join("; ");
}

/** What the excipient assessment says now about one line, for the table. */
export function excipientCopyOf(project: Project, assessmentId: string, lineId: string): ExcipientCopy | undefined {
  const a = excipientAssessments(project).find((x) => x.id === assessmentId);
  const line = a?.lines.find((l) => l.id === lineId);
  if (!a || !line) return undefined;
  return { name: line.name, grade: gradeText(project, a, line), specification: specificationText(project, line) };
}

/** A copied value as the table prints it: an empty one reads "Not established", never a guess. */
export const mbrExcipientValue = (v: string | undefined): string => (text(v) ? text(v) : MBR_EXCIPIENTS_NOT_ESTABLISHED);

/** The row of the printed table (the same in the app, the HTML and the Word document). */
export function mbrExcipientTableRow(x: MbrExcipientUsed): string[] {
  return [x.name, mbrExcipientValue(x.grade), mbrExcipientValue(x.specification), `${x.from.assessmentId}, ${x.from.lineId}`];
}

// ------------------------------------------------------------------ what can be added

export interface MbrExcipientOffer extends ExcipientCopy {
  assessmentId: string;
  assessmentTitle: string;
  lineId: string;
}

export interface MbrExcipientOffers {
  offers: MbrExcipientOffer[];
  /** One plain sentence about why there is nothing to add; empty when there is. */
  none: string;
}

/**
 * The lines the author can add: only those linked (on the excipient side) to the TRD the record was built from, and not already in the
 * table. When there are none the answer says why in one sentence.
 */
export function mbrExcipientOffers(project: Project, rec: MbrRecord): MbrExcipientOffers {
  if (!rec.trdId) return { offers: [], none: "This record was not started from a TRD, so no excipient is linked to it." };
  const have = new Set((rec.excipients ?? []).map((x) => `${x.from.assessmentId}/${x.from.lineId}`));
  const linked: MbrExcipientOffer[] = [];
  for (const a of excipientAssessments(project)) {
    for (const l of a.lines) {
      if (l.links.trdItem?.trdId !== rec.trdId) continue;
      if (have.has(`${a.id}/${l.id}`)) continue;
      linked.push({ assessmentId: a.id, assessmentTitle: a.title, lineId: l.id, name: l.name, grade: gradeText(project, a, l), specification: specificationText(project, l) });
    }
  }
  if (linked.length) return { offers: linked, none: "" };
  const anyLinked = excipientAssessments(project).some((a) => a.lines.some((l) => l.links.trdItem?.trdId === rec.trdId));
  return { offers: [], none: anyLinked ? `Every excipient linked to ${rec.trdId} is already in the table.` : `No excipient lines are linked to ${rec.trdId} yet.` };
}

// ------------------------------------------------------------------ changed since

export type MbrExcipientState = "current" | "changed" | "gone";

export interface MbrExcipientNotice {
  rowId: string;
  state: MbrExcipientState;
  /** What the assessment says now (absent when the line is gone). */
  now?: ExcipientCopy;
  /** Which of the three values differ from the copy (at least one when the state is changed). */
  differs: ("name" | "grade" | "specification")[];
}

const VALUE_KEYS = ["name", "grade", "specification"] as const;

/** Which of the three copied values differ from what the line says now. */
function differences(project: Project, x: MbrExcipientUsed): { gone: boolean; now?: ExcipientCopy; differs: ("name" | "grade" | "specification")[] } {
  const now = excipientCopyOf(project, x.from.assessmentId, x.from.lineId);
  if (!now) return { gone: true, differs: [] };
  const mine = { name: x.name, grade: text(x.grade), specification: text(x.specification) };
  return { gone: false, now, differs: VALUE_KEYS.filter((k) => now[k] !== mine[k]) };
}

/**
 * Where each row stands against the excipient assessment.
 * "changed": at least one of the three copied values differs from the line now. A line edited in a part the table does not show (or edited
 * and put back) leaves the copy current, so nothing is offered. "gone": the line is no longer in the assessment.
 */
export function mbrExcipientStates(project: Project, rec: MbrRecord): Map<string, MbrExcipientState> {
  const out = new Map<string, MbrExcipientState>();
  for (const x of rec.excipients ?? []) {
    const d = differences(project, x);
    out.set(x.id, d.gone ? "gone" : d.differs.length ? "changed" : "current");
  }
  return out;
}

/** The sentence a row says about itself when it is not current (the same words in the app, the HTML and the Word document). */
export const mbrExcipientStateText = (s: MbrExcipientState): string => (s === "changed" ? MBR_EXCIPIENTS_CHANGED : s === "gone" ? MBR_EXCIPIENTS_GONE : "");

/** What each row needs: its state, what the line says now and which values differ (for the Update offer's old and new). */
export function mbrExcipientNotices(project: Project, rec: MbrRecord): MbrExcipientNotice[] {
  return (rec.excipients ?? []).map((x): MbrExcipientNotice => {
    const d = differences(project, x);
    const state: MbrExcipientState = d.gone ? "gone" : d.differs.length ? "changed" : "current";
    return state === "changed" ? { rowId: x.id, state, now: d.now!, differs: d.differs } : { rowId: x.id, state, differs: [] };
  });
}
// ------------------------------------------------------------------ edits

function nextId(project: Project, rec: MbrRecord): string {
  let max = 0;
  const take = (id: string | undefined) => {
    const m = /^EU-(\d+)$/.exec(id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  };
  (rec.excipients ?? []).forEach((x) => take(x.id));
  // A row that only survives in the change log still counts as taken, so an old log entry can never point at a new, different row.
  for (const ev of project.changeLog) {
    const parts = (ev.path ?? "").split(".");
    if (parts[0] === "mbr" && parts[1] === rec.id && parts[2] === "excipients") take(parts[3]);
  }
  return `EU-${String(max + 1).padStart(3, "0")}`;
}

/** One edit on a copy of the project. An edit that returns nothing leaves the project as it was. */
function change(project: Project, recordId: string, actor: Actor, fn: (rec: MbrRecord) => Ev[]): Project {
  const next = structuredClone(project);
  const rec = next.mbr.records.find((r) => r.id === recordId);
  if (!rec) throw new MbrError(`Batch record ${recordId} does not exist`);
  const events = fn(rec);
  if (!events.length) return project;
  rec.updatedAt = actor.at;
  const res = mbrRecordSchema.safeParse(rec);
  if (!res.success) throw new MbrError(res.error.issues[0]?.message ?? "The batch record is not valid");
  for (const ev of events) next.changeLog.push({ at: actor.at, by: actor.name, ...ev });
  return next;
}

const path = (rec: MbrRecord, id: string) => `mbr.${rec.id}.excipients.${id}`;

const reasonOf = (reason: string | undefined, what: string): string => {
  const r = text(reason);
  if (!r) throw new MbrError(`Say why you are removing ${what}. The reason is kept in the change log.`);
  return r;
};

const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o)) if ((o as Record<string, unknown>)[k] === undefined) delete (o as Record<string, unknown>)[k];
  return o;
};

/**
 * Adds the ticked lines to the table, each with its own copy and one change-log event. Only a line linked to the record's TRD can be added,
 * and a line already in the table cannot be added twice.
 */
export function addExcipientsUsed(project: Project, recordId: string, picks: readonly { assessmentId: string; lineId: string }[], actor: Actor): Project {
  return change(project, recordId, actor, (rec) => {
    const events: Ev[] = [];
    for (const pick of picks) {
      const a = excipientAssessments(project).find((x) => x.id === pick.assessmentId);
      const line = a?.lines.find((l) => l.id === pick.lineId);
      if (!a || !line) throw new MbrError(`Excipient ${pick.lineId} is not in the excipient assessment ${pick.assessmentId}`);
      if (!rec.trdId || line.links.trdItem?.trdId !== rec.trdId) throw new MbrError(`${line.name} is not linked to the TRD this record was built from, so it is not offered.`);
      if ((rec.excipients ?? []).some((x) => x.from.assessmentId === a.id && x.from.lineId === line.id)) throw new MbrError(`${line.name} is already in the table.`);
      const copy = excipientCopyOf(project, a.id, line.id)!;
      const row: MbrExcipientUsed = clean({
        id: nextId(project, rec),
        name: copy.name,
        grade: copy.grade || undefined,
        specification: copy.specification || undefined,
        from: { assessmentId: a.id, lineId: line.id, updatedAt: line.updatedAt },
        copiedAt: actor.at,
      });
      (rec.excipients ??= []).push(row);
      events.push({ action: "mbr_excipient_add", path: path(rec, row.id), detail: `Excipient "${row.name}" added to the excipients used in ${rec.id}, copied from ${a.id} ${line.id}`, after: structuredClone(row) });
    }
    return events;
  });
}

/** Brings one row up to date with the excipient assessment (the "Update" the author chose). The old values stay in the change log. */
export function updateExcipientUsed(project: Project, recordId: string, rowId: string, actor: Actor): Project {
  return change(project, recordId, actor, (rec) => {
    const row = (rec.excipients ?? []).find((x) => x.id === rowId);
    if (!row) throw new MbrError(`Excipient row ${rowId} is not in ${rec.id}`);
    const a = excipientAssessments(project).find((x) => x.id === row.from.assessmentId);
    const line = a?.lines.find((l) => l.id === row.from.lineId);
    if (!a || !line) throw new MbrError(`${row.name} is no longer in the excipient assessment, so there is nothing to update from.`);
    const copy = excipientCopyOf(project, a.id, line.id)!;
    const before = structuredClone(row);
    row.name = copy.name;
    if (copy.grade) row.grade = copy.grade;
    else delete row.grade;
    if (copy.specification) row.specification = copy.specification;
    else delete row.specification;
    row.from.updatedAt = line.updatedAt;
    row.copiedAt = actor.at;
    return [{ action: "mbr_excipient_update", path: path(rec, row.id), detail: `Excipient "${row.name}" brought up to date with ${a.id} ${line.id} in ${rec.id}`, before, after: structuredClone(row) }];
  });
}

/** Removes one row. A reason is needed and is kept, with the whole row, in the change log. */
export function removeExcipientUsed(project: Project, recordId: string, rowId: string, reason: string, actor: Actor): Project {
  const why = reasonOf(reason, `excipient row ${rowId}`);
  return change(project, recordId, actor, (rec) => {
    const row = (rec.excipients ?? []).find((x) => x.id === rowId);
    if (!row) throw new MbrError(`Excipient row ${rowId} is not in ${rec.id}`);
    rec.excipients = rec.excipients!.filter((x) => x.id !== rowId);
    if (!rec.excipients.length) delete rec.excipients;
    return [{ action: "mbr_excipient_remove", path: path(rec, row.id), detail: `Excipient "${row.name}" removed from the excipients used in ${rec.id}: ${why}`, before: structuredClone(row), after: { reason: why } }];
  });
}

/** Removes the whole table. One event keeps every row and the reason. */
export function removeExcipientsUsedTable(project: Project, recordId: string, reason: string, actor: Actor): Project {
  const why = reasonOf(reason, "the excipients used table");
  return change(project, recordId, actor, (rec) => {
    const rows = rec.excipients ?? [];
    if (!rows.length) return [];
    delete rec.excipients;
    return [{ action: "mbr_excipient_table_remove", path: `mbr.${rec.id}.excipients`, detail: `The excipients used table (${rows.length} ${rows.length === 1 ? "row" : "rows"}) removed from ${rec.id}: ${why}`, before: structuredClone(rows), after: { reason: why } }];
  });
}
