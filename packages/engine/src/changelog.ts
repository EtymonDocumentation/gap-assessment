import { parseRef, type ChangeEvent, type EntryValue, type Project } from "@gap/process-model";
import { formatValue, STATUS_TEXT } from "./format";
import { cell } from "./csv";
import type { ContentBundle } from "./content";
import { effectiveStaged } from "./custom";
import { displaySideTags, entryLabel, locationText, sideName } from "./labels";

/**
 * Human-readable views of the project change log: filterable rows for the Change log page, CSV export and
 * action counts for the document. The stored events are the audit trail; nothing here changes them.
 */

export const ACTION_LABELS: Record<string, string> = {
  answer: "Answer recorded",
  migrate_status: "Status converted (file update)",
  verify: "Verified",
  unverify: "Verification withdrawn",
  verify_many: "Bulk verification",
  add_source: "Source added",
  update_source: "Source edited",
  remove_source: "Source removed",
  attach_source: "Source attached",
  set_answering_from: "Answering-from bar set",
  clear_answering_from: "Answering-from bar cleared",
  detach_source: "Source detached",
  revert_on_source_removal: "Value reverted (source removed)",
  revert_on_source_detach: "Value reverted (last source detached)",
  answer_cleared: "Answer cleared",
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
  sampling_plan_add: "Sampling plan added",
  sampling_plan_update: "Sampling plan edited",
  sampling_plan_remove: "Sampling plan removed",
  sampling_batch_add: "Sampling batch added",
  sampling_batch_update: "Sampling batch edited",
  sampling_batch_remove: "Sampling batch removed",
  sampling_point_add: "Sampling point added",
  sampling_point_update: "Sampling point edited",
  sampling_point_remove: "Sampling point removed",
  sampling_step_add: "Process step added to a sampling plan",
  sampling_step_update: "Process step of a sampling plan edited",
  sampling_step_move: "Process step of a sampling plan moved",
  sampling_step_remove: "Process step removed from a sampling plan",
  sampling_steps_copy: "Process steps copied from the project scope",
  migrate_sampling_steps: "Process steps added to a sampling plan (schema upgrade)",
  risk_assessment_add: "Risk assessment added",
  risk_assessment_update: "Risk assessment edited",
  risk_assessment_remove: "Risk assessment removed",
  risk_method_set: "Risk method set or edited",
  risk_item_add: "Risk item added",
  risk_item_update: "Risk item edited",
  risk_item_remove: "Risk item removed",
  risk_action_add: "Risk action added",
  risk_action_update: "Risk action edited",
  risk_action_remove: "Risk action removed",
  risk_step_add: "Process step added to a risk assessment",
  risk_step_update: "Process step of a risk assessment edited",
  risk_step_move: "Process step of a risk assessment moved",
  risk_step_remove: "Process step removed from a risk assessment",
  risk_steps_copy: "Process steps copied from the project scope (risk assessment)",
  trd_add: "TRD added",
  trd_update: "TRD edited",
  trd_remove: "TRD removed",
  trd_override_set: "TRD value overridden or entered",
  trd_override_clear: "TRD override removed",
  trd_step_add: "Process step added to a TRD",
  trd_step_update: "Process step of a TRD edited",
  trd_step_move: "Process step of a TRD moved",
  trd_step_remove: "Process step removed from a TRD",
  trd_item_add: "Item added to a TRD",
  trd_item_update: "Item of a TRD edited",
  trd_item_remove: "Item removed from a TRD",
  trd_limits_update: "TRD set point, NOR or PAR edited",
  trd_update_accept: "TRD difference accepted from the project or a newer seed",
  trd_update_keep_override: "TRD override kept while the project value was brought up to date",
  trd_origin_update: "TRD brought up to date with the project or a seed",
  mbr_add: "Batch record added",
  mbr_update: "Batch record edited",
  mbr_remove: "Batch record removed",
  mbr_section_add: "Section added to a batch record",
  mbr_section_update: "Section of a batch record renamed",
  mbr_section_move: "Section of a batch record moved",
  mbr_section_remove: "Section removed from a batch record",
  mbr_block_add: "Block added to a batch record",
  mbr_block_update: "Block of a batch record edited",
  mbr_block_move: "Block of a batch record moved",
  mbr_block_remove: "Block removed from a batch record",
  mbr_block_library_update: "Block of a batch record updated from the library",
  mbr_step_add: "Step added to a batch record",
  mbr_step_update: "Step of a batch record edited",
  mbr_step_move: "Step of a batch record moved",
  mbr_step_remove: "Step removed from a batch record",
  mbr_row_add: "Parameter row added to a batch record",
  mbr_row_update: "Parameter row of a batch record edited",
  mbr_row_remove: "Parameter row removed from a batch record",
  mbr_trd_refresh: "TRD value brought up to date in a batch record",
  mbr_time_limit_add: "Time limit added to a batch record",
  mbr_time_limit_update: "Time limit of a batch record edited",
  mbr_time_limit_remove: "Time limit removed from a batch record",
  mbr_target_add: "Time target added to a batch record",
  mbr_target_update: "Time target of a batch record edited",
  mbr_target_remove: "Time target removed from a batch record",
  mbr_sample_add: "Sample rows added to a batch record",
  mbr_sample_remove: "Sample row removed from a batch record",
  mbr_sample_refresh: "Sample row brought up to date with the sampling plan",
  tailor_exclude: "Topic switched off (scope)",
  tailor_include: "Topic switched on (scope)",
  scope_exclude_uo: "Process step left out (scope)",
  scope_include_uo: "Process step put back (scope)",
  archive_review: "Revisions and comments archived",
  issue_revision: "Revision issued",
  add_comment: "Comment added",
  reply_comment: "Comment reply",
  resolve_comment: "Comment resolved",
  reopen_comment: "Comment reopened",
};

/**
 * Actions of the retired review workflow (revisions and reviewer comments, removed in schema 1.10.0). An old project can still
 * carry them in its change log, where they stay readable. The document's own Change log summary leaves them out: that history
 * is archived, not part of the assessment the document describes.
 */
/** "C-001" for comment number 1 (old comments appear in the change log of projects from before schema 1.10.0). */
function commentDisplayId(seq: number): string {
  return `C-${String(seq).padStart(3, "0")}`;
}


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
/** How the retired "Unknown" answer reads in old change-log records. Not used for anything the tool shows as current. */
const RETIRED_UNKNOWN_TEXT = "Unknown";

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
  tbd?: { bestGuess?: EntryValue; owner?: string; due?: string; note?: string };
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
    text = s.value !== undefined ? formatValue(content, l.question, s.value, optionSet) : s.sameAsSource ? "Same as SU" : NONE;
    if (s.sameAsSource && s.value !== undefined) text += " (same as SU)";
    else if (s.sameAsSource) text = "Same as SU";
  } else if (s.status === "not_applicable") {
    text = s.justification ? `Not applicable: ${s.justification}` : STATUS_TEXT.not_applicable;
  } else if (s.status === "unknown") {
    // History is shown as it was recorded: "Unknown" was a separate answer until schema 1.9.0, and old log records are never rewritten.
    text = RETIRED_UNKNOWN_TEXT;
  } else if (s.status === "tbd") {
    // Everything that was recorded about the TBD is part of the audit trail, so a change of owner or due date is visible.
    const t = s.tbd ?? {};
    const bits = [
      t.bestGuess !== undefined ? `best guess ${formatValue(content, l.question, t.bestGuess, optionSet)} (provisional)` : "no best guess",
      t.owner ? `owner ${t.owner}` : "",
      t.due ? `due ${t.due}` : "",
      t.note ? `note: ${t.note}` : "",
    ].filter(Boolean);
    text = `${STATUS_TEXT.tbd} — ${bits.join("; ")}`;
  }
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

/** Fields of a sampling plan, batch or point that matter when reading a change: short text for the Before and After columns. */
const SAMPLING_FIELD_TEXT: Record<string, string> = {
  title: "Title",
  notes: "Notes",
  batchRationale: "Rationale for the number of batches",
  label: "Label",
  plannedLotSizeUnits: "Planned lot size (units)",
  batchSize: "Batch size",
  batchSizeUnit: "Batch size unit",
  category: "Category",
  categoryLabel: "Category label",
  unitOp: "Process step",
  attribute: "Attribute",
  testMethodRef: "Test method",
  materialType: "Material",
  timing: "Timing",
  locationsCount: "Locations per batch",
  sampleSize: "Sample size",
  containerUnitsPerSample: "Containers per sample",
  quantity: "Quantity",
  storageCondition: "Storage",
  destinationLab: "Destination lab",
  acceptance: "Acceptance",
  rationale: "Rationale",
  appliesTo: "Applies to",
  sourceIds: "Sources",
  flow: "Place on the process flow",
  steps: "Process steps",
  step: "Process step",
  order: "Step order",
  movedToTray: "Moved to Not on the diagram",
  failureMode: "Failure mode",
  effect: "Effect",
  causes: "Causes",
  controlsPrevention: "Prevention controls",
  controlsDetection: "Detection controls",
  stepId: "Process step",
  initial: "Initial score",
  residual: "Residual score",
  gapIds: "Gaps",
  samplingPointIds: "Sampling points",
  scopeNote: "Scope",
  context: "Context",
  method: "Method",
  config: "Method configuration",
  scores: "Scores cleared",
  text: "Description",
  owner: "Owner",
  due: "Due",
  status: "Status",
  approvals: "Approvals",
  item: "Item",
  actions: "Actions",
  docRef: "Document reference",
  version: "Version",
  purpose: "Purpose",
  mbrValue: "MBR value",
  mbrUnit: "MBR unit",
  choice: "Choice",
  reason: "Reason",
  studyPoint: "Study point, not a limit",
  trdValue: "TRD value",
  value: "Value",
  unit: "Unit",
  fromStep: "From step",
  toStep: "To step",
  cmoFields: "To be completed by the CMO",
  blocks: "Blocks",
  test: "Test",
  container: "Container",
  storage: "Storage",
  hour: "Hour",
  hold: "Hold",
  targets: "Targets",
};

function samplingValueText(v: unknown): string {
  if (v === undefined || v === null || v === "") return NONE;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  const text = JSON.stringify(v);
  return text.length > 400 ? `${text.slice(0, 400)} ...` : text;
}

/**
 * Old and new value of a sampling edit, field by field. For an added or removed plan, batch or point there is only one side:
 * it is shown whole, so the log keeps everything that was removed.
 */
function samplingDiff(before: unknown, after: unknown): { before: string; after: string } {
  if (!isObj(before) || !isObj(after)) {
    const one = (o: unknown) => (isObj(o) ? Object.entries(o).filter(([k]) => k in SAMPLING_FIELD_TEXT || k === "points" || k === "batches").map(([k, v]) => `${SAMPLING_FIELD_TEXT[k] ?? k}: ${samplingValueText(v)}`).join("; ") || NONE : NONE);
    return { before: one(before), after: one(after) };
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !["updatedAt", "createdAt"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const side = (o: Record<string, unknown>) => keys.map((k) => `${SAMPLING_FIELD_TEXT[k] ?? k}: ${samplingValueText(o[k])}`).join("; ") || NONE;
  return { before: side(before), after: side(after) };
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
    case "migrate_status":
    case "revert_on_source_removal":
    case "revert_on_source_detach":
    case "answer_cleared": {
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
        const locOf = (o: unknown) => (isObj(o) && isObj(o.location) ? locationText(o.location as { section?: string; page?: string }) : "");
        const locAfter = locOf(ev.after) || locOf(ev.before);
        row.before = `Sources: ${sourceNames(project, b)}`;
        row.after = `Sources: ${sourceNames(project, a)}`;
        row.detail = (ev.action === "attach_source" ? "Attached: " : "Detached: ") + (ev.detail ?? "") + (locAfter ? ` (${locAfter})` : "");
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
      row.subject = sec ? `${sec.title} (${sideName(String(a?.side))})` : (ev.detail ?? "");
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
      if (ev.action.startsWith("sampling_") || ev.action === "migrate_sampling_steps" || ev.action.startsWith("risk_") || ev.action.startsWith("trd_") || ev.action.startsWith("mbr_")) {
        row.subject = ev.detail ?? ev.path ?? "";
        const d = samplingDiff(ev.before, ev.after);
        row.before = d.before;
        row.after = d.after;
      } else if (ev.action.startsWith("tailor_") || ev.action.startsWith("scope_")) {
        row.subject = ev.detail ?? ev.path ?? "";
        const uo = ev.path?.split(".")[1];
        const sec = uo ? content.sections.find((s) => s.kind === "uo" && s.uo === uo) : undefined;
        withSection(sec?.id, sec?.title);
        const reason = (o: unknown) => (isObj(o) ? (typeof o.reason === "string" ? `Excluded: ${o.reason}` : `Excluded: No reason recorded`) : NONE);
        row.before = reason(ev.before);
        row.after = reason(ev.after);
      } else if (ev.action.startsWith("custom_")) {
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
    const raw = toRow(eff, project, ev, i);
    // Older records may carry "[source]" / "[target]" in a stored label; the log shows "[SU]" / "[RU]" (display only).
    const row: ChangeRow = { ...raw, subject: displaySideTags(raw.subject), before: displaySideTags(raw.before), after: displaySideTags(raw.after), detail: displaySideTags(raw.detail) };
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
