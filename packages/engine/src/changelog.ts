import { parseRef, type ChangeEvent, type EntryValue, type Project } from "@gap/process-model";
import { formatValue, STATUS_TEXT } from "./format";
import { cell } from "./csv";
import type { ContentBundle } from "./content";
import { effectiveStaged } from "./custom";
import { entryLabel } from "./labels";
import { commentDisplayId } from "./review";

/**
 * Human-readable views of the project change log: filterable rows for the Change log page, CSV export and
 * action counts for the document. The stored events are the audit trail; nothing here changes them.
 */

export const ACTION_LABELS: Record<string, string> = {
  answer: "Answer recorded",
  verify: "Verified",
  unverify: "Verification withdrawn",
  verify_many: "Bulk verification",
  add_source: "Source added",
  update_source: "Source edited",
  remove_source: "Source removed",
  attach_source: "Source attached",
  detach_source: "Source detached",
  revert_on_source_removal: "Value reverted (source removed)",
  revert_on_source_detach: "Value reverted (last source detached)",
  gap_update: "Gap updated",
  confirm_section: "Section confirmed",
  set_responder: "Responder changed",
  set_entry_sequence: "Entry order changed",
  custom_uo_add: "Custom unit operation added",
  custom_uo_rename: "Custom unit operation renamed",
  custom_uo_remove: "Custom unit operation removed",
  custom_item_add: "Custom item added",
  custom_item_rename: "Custom item renamed",
  custom_item_remove: "Custom item removed",
  issue_revision: "Revision issued",
  add_comment: "Comment added",
  reply_comment: "Comment reply",
  resolve_comment: "Comment resolved",
  reopen_comment: "Comment reopened",
};

/**
 * Actions that record the review of the document (revisions and reviewer comments). The document's own Change log
 * summary leaves them out: they are listed in its revision history and reviewer comments, and counting them there
 * would make the document look changed every time a revision is issued or a comment is added.
 */
export const REVIEW_ACTIONS: readonly string[] = ["issue_revision", "add_comment", "reply_comment", "resolve_comment", "reopen_comment"];

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]!;
  const t = action.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface ChangeRow {
  /** Position in the stored log, starting at 1 (stable; newest has the highest number). */
  no: number;
  at: string;
  time: string;
  by: string;
  action: string;
  actionLabel: string;
  /** The attribute, source, gap or definition the change is about. */
  subject: string;
  sectionId?: string;
  sectionTitle?: string;
  before: string;
  after: string;
  detail: string;
}

export interface ChangeLogFilter {
  actor?: string;
  action?: string;
  section?: string;
  text?: string;
}

const NONE = "—";

function isEntryRef(path: string | undefined): path is string {
  if (!path) return false;
  if (!/^(scope\.|source\.(site|uo)\.|target\.(site|uo)\.)/.test(path)) return false;
  try {
    parseRef(path);
    return true;
  } catch {
    return false;
  }
}

interface ValueState {
  status?: string;
  value?: EntryValue;
  sameAsSource?: boolean;
  justification?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function valueStateText(content: ContentBundle, project: Project, ref: string, v: unknown): string {
  if (v === undefined || v === null) return NONE;
  if (!isObj(v)) return String(v);
  const s = v as ValueState;
  const l = entryLabel(content, project, ref);
  const optionSet = l.question?.input.type === "parameter" && l.field === "classification" ? "classification" : l.field === "rangeBasis" ? "rangeBasis" : undefined;
  let text: string;
  if (s.status === "established" || (s.status === undefined && s.value !== undefined)) {
    text = s.value !== undefined ? formatValue(content, l.question, s.value, optionSet) : s.sameAsSource ? "Same as source" : NONE;
    if (s.sameAsSource && s.value !== undefined) text += " (same as source)";
    else if (s.sameAsSource) text = "Same as source";
  } else if (s.status === "not_applicable") {
    text = s.justification ? `Not applicable: ${s.justification}` : STATUS_TEXT.not_applicable;
  } else if (s.status === "unknown") text = STATUS_TEXT.unknown;
  else if (s.status === "not_established") text = STATUS_TEXT.not_established;
  else text = NONE;
  return text;
}

function sourceNames(project: Project, ids: unknown): string {
  if (!Array.isArray(ids) || ids.length === 0) return "no source";
  return ids
    .map((id) => {
      const s = project.sources.find((x) => x.id === id);
      if (s) return s.docRef ? s.docRef.identifier : s.label;
      // A removed source is no longer in the register: read its name from the log entry that recorded it.
      for (const ev of project.changeLog) {
        const rec = [ev.before, ev.after].find((o) => isObj(o) && o.id === id) as Record<string, unknown> | undefined;
        if (rec) return isObj(rec.docRef) && typeof rec.docRef.identifier === "string" ? rec.docRef.identifier : typeof rec.label === "string" ? rec.label : String(id);
      }
      return String(id);
    })
    .join("; ");
}

function overlayDiff(before: unknown, after: unknown): { before: string; after: string } {
  const b = (isObj(before) ? before : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const a = (isObj(after) ? after : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", closed: "Closed", accepted_no_action: "Accepted, no action" };
  const parts: [string, string, string][] = [];
  const push = (name: string, x: string, y: string) => {
    if (x !== y) parts.push([name, x, y]);
  };
  push("Status", STATUS[b.status] ?? NONE, STATUS[a.status] ?? NONE);
  push("Owner", b.owner ?? NONE, a.owner ?? NONE);
  push("Notes", b.notes ?? NONE, a.notes ?? NONE);
  const sev = (o: any) => (o.severityOverride ? `${o.severityOverride.value} (${o.severityOverride.justification})` : NONE); // eslint-disable-line @typescript-eslint/no-explicit-any
  push("Severity", sev(b), sev(a));
  return { before: parts.map(([n, x]) => `${n}: ${x}`).join("; ") || NONE, after: parts.map(([n, , y]) => `${n}: ${y}`).join("; ") || NONE };
}

function gapSubject(content: ContentBundle, key: string): { subject: string; sectionId?: string; sectionTitle?: string } {
  const m = /^[^:]+:([^#]+)(?:#(.+))?$/.exec(key);
  const binds = m?.[1];
  const q = binds ? content.questions.find((x) => x.binds === binds) : undefined;
  if (!q) return { subject: `Gap ${key}` };
  const sec = content.sectionById.get(q.section);
  return { subject: `Gap: ${q.label ?? q.prompt}${m?.[2] ? ` (${m[2]})` : ""}`, sectionId: q.section, ...(sec ? { sectionTitle: sec.title } : {}) };
}

function toRow(content: ContentBundle, project: Project, ev: ChangeEvent, i: number): ChangeRow {
  const row: ChangeRow = {
    no: i + 1,
    at: ev.at,
    time: ev.at.replace("T", " ").slice(0, 16) + " UTC",
    by: ev.by,
    action: ev.action,
    actionLabel: actionLabel(ev.action),
    subject: ev.path ?? ev.detail ?? "",
    before: NONE,
    after: NONE,
    detail: ev.detail ?? "",
  };
  const withSection = (id?: string, title?: string) => {
    if (id) row.sectionId = id;
    if (title) row.sectionTitle = title;
  };

  switch (ev.action) {
    case "answer":
    case "revert_on_source_removal":
    case "revert_on_source_detach": {
      if (isEntryRef(ev.path)) {
        const l = entryLabel(content, project, ev.path);
        row.subject = l.text;
        withSection(l.sectionId, l.sectionTitle);
        row.before = valueStateText(content, project, ev.path, ev.before);
        row.after = valueStateText(content, project, ev.path, ev.after);
        if (ev.action !== "answer" && !row.detail) row.detail = "The value is kept only in this log.";
      }
      return row;
    }
    case "verify":
    case "unverify": {
      if (isEntryRef(ev.path)) {
        const l = entryLabel(content, project, ev.path);
        row.subject = l.text;
        withSection(l.sectionId, l.sectionTitle);
        const b = isObj(ev.before) ? ev.before : {};
        const a = isObj(ev.after) ? ev.after : {};
        const valueText = (o: Record<string, unknown>) => (o.status !== undefined ? valueStateText(content, project, ev.path!, o) : "");
        const join = (o: Record<string, unknown>) => [String(o.verification ?? NONE), valueText(o)].filter(Boolean).join(" — value: ");
        row.before = join(b);
        row.after = join(a);
        if (ev.action === "unverify") row.detail = `Reason: ${ev.detail ?? ""}`;
      }
      return row;
    }
    case "attach_source":
    case "detach_source": {
      if (isEntryRef(ev.path)) {
        const l = entryLabel(content, project, ev.path);
        row.subject = l.text;
        withSection(l.sectionId, l.sectionTitle);
        const b = isObj(ev.before) ? ev.before.sourceIds : undefined;
        const a = isObj(ev.after) ? ev.after.sourceIds : undefined;
        row.before = `Sources: ${sourceNames(project, b)}`;
        row.after = `Sources: ${sourceNames(project, a)}`;
        row.detail = (ev.action === "attach_source" ? "Attached: " : "Detached: ") + (ev.detail ?? "");
      }
      return row;
    }
    case "add_source":
    case "update_source":
    case "remove_source": {
      const b = isObj(ev.before) ? ev.before : undefined;
      const a = isObj(ev.after) ? ev.after : undefined;
      const name = (o: Record<string, unknown> | undefined) => {
        if (!o) return undefined;
        const d = o.docRef;
        if (isObj(d)) return [d.docType, d.identifier, d.title, d.version ? `v${d.version}` : ""].filter(Boolean).join(" ");
        return typeof o.label === "string" ? o.label : undefined;
      };
      row.subject = (ev.action === "remove_source" ? b?.label : a?.label) as string ?? ev.detail ?? "";
      if (ev.action === "update_source") {
        row.before = name(b) ?? NONE;
        row.after = name(a) ?? NONE;
      } else if (ev.action === "add_source") {
        row.after = name(a) ?? NONE;
      } else {
        row.before = name(b) ?? NONE;
        if (a) row.detail = `Cited by ${String(a.citingEntries)} entries; ${String(a.reverted)} reverted to Not established`;
      }
      return row;
    }
    case "gap_update": {
      const g = gapSubject(content, ev.path ?? "");
      row.subject = g.subject;
      withSection(g.sectionId, g.sectionTitle);
      const d = overlayDiff(ev.before, ev.after);
      row.before = d.before;
      row.after = d.after;
      return row;
    }
    case "confirm_section": {
      const a = isObj(ev.after) ? ev.after : undefined;
      const id = typeof a?.sectionId === "string" ? a.sectionId : undefined;
      const sec = id ? content.sectionById.get(id) : undefined;
      row.subject = sec ? `${sec.title} (${String(a?.side)})` : (ev.detail ?? "");
      withSection(id, sec?.title);
      return row;
    }
    case "set_responder": {
      const r = (o: unknown) => (isObj(o) && typeof o.name === "string" ? `${o.name}${typeof o.role === "string" && o.role ? ` (${o.role})` : ""}` : NONE);
      row.subject = "Responder";
      row.before = r(ev.before);
      row.after = r(ev.after);
      return row;
    }
    case "set_entry_sequence": {
      row.subject = "Entry order";
      row.before = String(ev.before ?? NONE);
      row.after = String(ev.after ?? NONE);
      return row;
    }
    case "issue_revision": {
      const a = isObj(ev.after) ? ev.after : undefined;
      row.subject = typeof a?.number === "number" ? `Document revision ${a.number}` : "Document revision";
      return row;
    }
    case "add_comment":
    case "reply_comment":
    case "resolve_comment":
    case "reopen_comment": {
      const seq = Number(/^document\.comment\.(\d+)$/.exec(ev.path ?? "")?.[1]);
      row.subject = Number.isInteger(seq) && seq > 0 ? `Reviewer comment ${commentDisplayId(seq)}` : "Reviewer comment";
      const status = (o: unknown) => (isObj(o) && (o.status === "open" || o.status === "resolved") ? (o.status === "open" ? "Open" : "Resolved") : NONE);
      row.before = status(ev.before);
      row.after = status(ev.after);
      return row;
    }
    default: {
      if (ev.action.startsWith("custom_")) {
        row.subject = ev.detail ?? ev.path ?? "";
        const uo = ev.path?.split(".")[1];
        const sec = uo ? content.sections.find((s) => s.kind === "uo" && s.uo === uo) : undefined;
        withSection(sec?.id, sec?.title);
        const lab = (o: unknown) => (isObj(o) && typeof o.label === "string" ? o.label : NONE);
        row.before = lab(ev.before);
        row.after = lab(ev.after);
      } else if (isEntryRef(ev.path)) {
        const l = entryLabel(content, project, ev.path);
        row.subject = l.text;
        withSection(l.sectionId, l.sectionTitle);
      }
      return row;
    }
  }
}

/** Rows of the change log, newest first, with the optional filters applied. */
export function changeLogView(content: ContentBundle, project: Project, filter: ChangeLogFilter = {}): ChangeRow[] {
  const eff = effectiveStaged(content, project);
  const text = (filter.text ?? "").trim().toLowerCase();
  const rows: ChangeRow[] = [];
  project.changeLog.forEach((ev, i) => {
    if (filter.actor && ev.by.trim().toLowerCase() !== filter.actor.trim().toLowerCase()) return;
    if (filter.action && ev.action !== filter.action) return;
    const row = toRow(eff, project, ev, i);
    if (filter.section && row.sectionId !== filter.section) return;
    if (text && ![row.time, row.by, row.actionLabel, row.subject, row.before, row.after, row.detail].join(" ").toLowerCase().includes(text)) return;
    rows.push(row);
  });
  return rows.reverse();
}

export interface ChangeLogOptions {
  actors: string[];
  actions: { value: string; label: string }[];
  sections: { id: string; title: string }[];
}

/** Values for the filter drop-downs: only those that occur in this project's log. */
export function changeLogOptions(content: ContentBundle, project: Project): ChangeLogOptions {
  const rows = changeLogView(content, project, {});
  const actors = [...new Set(rows.map((r) => r.by))].sort((a, b) => a.localeCompare(b));
  const actions = [...new Set(rows.map((r) => r.action))].map((value) => ({ value, label: actionLabel(value) })).sort((a, b) => a.label.localeCompare(b.label));
  const secs = new Map<string, string>();
  for (const r of rows) if (r.sectionId && r.sectionTitle) secs.set(r.sectionId, r.sectionTitle);
  return { actors, actions, sections: [...secs].map(([id, title]) => ({ id, title })) };
}

export const CHANGE_LOG_COLUMNS = ["No.", "Time", "Actor", "Action", "Subject", "Section", "Before", "After", "Detail"] as const;

/** CSV of the (optionally filtered) log in the order it happened. Every cell goes through the formula-safe cell(). */
export function changeLogToCsv(content: ContentBundle, project: Project, filter: ChangeLogFilter = {}): string {
  const rows = changeLogView(content, project, filter).reverse();
  const body = rows.map((r) => [String(r.no), r.time, r.by, r.actionLabel, r.subject, r.sectionTitle ?? "", r.before, r.after, r.detail]);
  return [CHANGE_LOG_COLUMNS as readonly string[], ...body].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export interface ActionCount {
  action: string;
  label: string;
  count: number;
}

/** Number of events per action, most frequent first. With `excludeReview`, revision and comment events are left out. */
export function changeLogActionCounts(project: Project, opts: { excludeReview?: boolean } = {}): ActionCount[] {
  const m = new Map<string, number>();
  for (const ev of project.changeLog) {
    if (opts.excludeReview && REVIEW_ACTIONS.includes(ev.action)) continue;
    m.set(ev.action, (m.get(ev.action) ?? 0) + 1);
  }
  return [...m]
    .map(([action, count]) => ({ action, label: actionLabel(action), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
