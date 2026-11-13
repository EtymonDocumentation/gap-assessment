import { effectiveField, type InterviewQuestion, type TrdOpenItem } from "@gap/engine";
import type { TrdDocument, TrdField } from "@gap/process-model";

/*
 * Small pure helpers of the TRD interview screens: where the tab sits, which filter opens, the one-question-at-a-time sequence and the
 * two per-viewer conveniences kept in the browser (the Keep marks and the last question looked at). Nothing here touches the TRD.
 */

/** A field that holds something a person or a source said. A "TBD" or empty pulled field is not a value. */
const hasValue = (f: TrdField): boolean => Boolean(f.override) || f.pulled?.status === "established" || f.pulled?.status === "not_applicable";

/**
 * True for a TRD that holds no value at all: no detail, no step field, no item field, limit or control, and nothing from an upload (an
 * upload writes overrides). Such a TRD opens on the Interview tab, because there is nothing to look at yet but plenty to answer.
 */
export function trdIsEmpty(d: TrdDocument): boolean {
  if (d.details.some(hasValue)) return false;
  return !d.steps.some((s) => s.fields.some(hasValue) || s.items.some((i) => i.fields.some(hasValue) || i.limits || i.control));
}

/**
 * The interview question that asks for what an open item is missing, so the Open items tab can link to it. `keys` are the keys of the questions
 * the interview offers for this TRD. A detail asks `detail:<field>`; a field of an item asks `field:<step>.<collection>.<item>.<field>`; a set
 * point, NOR or PAR asks one `limits:` question for the whole item. An open item the interview has no question for (a field of a step itself)
 * gives undefined, and the tab then links to the form that holds it.
 */
export function openItemQuestionKey(d: TrdDocument, o: TrdOpenItem, keys: ReadonlySet<string>): string | undefined {
  if (o.itemRef) {
    const step = d.steps.find((s) => s.id === o.itemRef!.stepId);
    if (!step) return undefined;
    const item = `${step.key}.${o.itemRef.collection}.${o.itemRef.key}`;
    const candidates = o.fieldKey ? [`field:${item}.${o.fieldKey}`, `limits:${item}`] : [`limits:${item}`];
    return candidates.find((k) => keys.has(k));
  }
  if (!o.stepId && o.fieldKey) return [`detail:${o.fieldKey}`].find((k) => keys.has(k));
  return undefined;
}

/** "Only what is still open" is the first view when the TRD already holds values (a project start, a seed, an upload); an empty TRD shows everything. */
export function defaultInterviewShow(d: TrdDocument): "all" | "open" {
  return trdIsEmpty(d) ? "all" : "open";
}

/** The Interview tab comes first for an empty TRD, otherwise right after "1. Details". `ids` is the tab order without it. */
export function placeInterviewTab<T extends string>(ids: readonly T[], interview: T, empty: boolean): T[] {
  if (empty) return [interview, ...ids];
  const [first, ...rest] = ids;
  return first === undefined ? [interview] : [first, interview, ...rest];
}

// ------------------------------------------------------------------ one question at a time

/** The questions of the one-at-a-time run, by key, in list order. A snapshot: an answered question keeps its place until the run ends. */
export function interviewSequence(visible: readonly { key: string }[]): string[] {
  return visible.map((q) => q.key);
}

export interface SequencePosition {
  /** 1-based position among the questions of the same step. */
  n: number;
  of: number;
  stepLabel: string;
}

/**
 * "Question 7 of 23 in Sterile filtration": counted inside the step of the question at `index`. Generic over anything with a step, so an interview that
 * follows a template's headings (where the "step" is a heading and a writing box is one of its cards) is counted the same way.
 */
export function sequencePosition<T extends { stepKey: string; stepLabel: string }>(qs: readonly T[], index: number): SequencePosition | undefined {
  const q = qs[index];
  if (!q) return undefined;
  const same = qs.filter((x) => x.stepKey === q.stepKey);
  return { n: same.indexOf(q) + 1, of: same.length, stepLabel: q.stepLabel };
}

/** The next index after `from` (step +1 or -1) that is not skipped for this sitting; -1 when the run is over (or at the start). */
export function nextIndex(qs: readonly { key: string }[], from: number, step: 1 | -1, skipped: ReadonlySet<string>): number {
  for (let i = from + step; i >= 0 && i < qs.length; i += step) if (!skipped.has(qs[i]!.key)) return i;
  return -1;
}

// ------------------------------------------------------------------ what the question shows about its value

export function sourceText(q: InterviewQuestion): string {
  const s = q.source;
  if (!s) return "";
  const where = [s.name, s.section ? `section ${s.section}` : "", s.page ? `page ${s.page}` : ""].filter(Boolean).join(", ");
  return `From the ${s.kind}${where ? ` (${where})` : ""}`;
}

export interface QuestionStatus {
  /** A symbol plus the words: the state never rests on colour. */
  icon: string;
  text: string;
  tone: "open" | "done" | "project";
}

export function statusOf(q: InterviewQuestion, kept: boolean): QuestionStatus {
  switch (q.state) {
    case "answered":
      return { icon: "\u2713", text: "Answered", tone: "done" };
    case "not_applicable":
      return { icon: "\u2013", text: "Not applicable here", tone: "done" };
    case "tbd":
      return { icon: "\u25D0", text: "To be decided (TBD)", tone: "open" };
    case "from_project":
      return kept ? { icon: "\u2713", text: `Kept: ${sourceText(q).toLowerCase() || "from the project"}`, tone: "done" } : { icon: "\u2197", text: `${sourceText(q) || "From the project"}, not yet looked at`, tone: "project" };
    default:
      return { icon: "\u25CB", text: "Open", tone: "open" };
  }
}

/** The field of the TRD that a field, detail or step question reads, to show the project value beside an entry. */
export function fieldOfQuestion(d: TrdDocument, q: InterviewQuestion): TrdField | undefined {
  const t = q.target;
  if (t.kind === "detail") return d.details.find((f) => f.key === t.field);
  const step = (op: string) => d.steps.find((s) => s.key === op);
  if (t.kind === "presence") return step(t.unitOp)?.fields.find((f) => f.key === "presence");
  if (t.kind === "field") return step(t.unitOp)?.items.find((i) => i.collection === t.collection && i.key === t.itemKey)?.fields.find((f) => f.key === t.field);
  return undefined;
}

/** What the project said for a question whose value was typed over, so it can stay shown beside the entry. */
export function projectValueText(d: TrdDocument, q: InterviewQuestion): string | undefined {
  const f = fieldOfQuestion(d, q);
  if (!f?.pulled) return undefined;
  const v = effectiveField(f);
  return v.overridden ? v.pulledText : undefined;
}

// ------------------------------------------------------------------ browser storage (a per-viewer convenience)

const KEPT = "gap-trd-interview-kept";
const LAST = "gap-trd-interview-last";
const where = (projectId: string, trdId: string) => `${projectId}:${trdId}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is blocked or full: the page works without it. A Keep mark is only a tally, never a loss.
  }
}

/** The questions whose project value the person has looked at and kept, for this TRD in this project. Empty when storage is unavailable. */
export function readKept(projectId: string, trdId: string): Set<string> {
  try {
    const raw = JSON.parse(read(`${KEPT}:${where(projectId, trdId)}`) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
export function writeKept(projectId: string, trdId: string, kept: ReadonlySet<string>): void {
  write(`${KEPT}:${where(projectId, trdId)}`, JSON.stringify([...kept]));
}

/** The key of the question last looked at, so "Continue where you left off" can return to it. */
export function readLast(projectId: string, trdId: string): string | undefined {
  return read(`${LAST}:${where(projectId, trdId)}`) ?? undefined;
}
export function writeLast(projectId: string, trdId: string, key: string): void {
  write(`${LAST}:${where(projectId, trdId)}`, key);
}

// ------------------------------------------------------------------ the maps (M14): view, remembered choice, address, node-limited run

export type InterviewView = "list" | "process" | "areas";
export const INTERVIEW_VIEWS: readonly InterviewView[] = ["list", "process", "areas"];

/** The view named in an address or in storage; anything else is "no view named" (undefined), never a guess. */
export function parseInterviewView(v: string | null | undefined): InterviewView | undefined {
  return INTERVIEW_VIEWS.find((x) => x === v);
}

const VIEW = "gap-trd-interview-view";
const ONE = "gap-trd-interview-one";

/** The view this person last chose for this TRD, if the browser kept it. */
export function readView(projectId: string, trdId: string): InterviewView | undefined {
  return parseInterviewView(read(`${VIEW}:${where(projectId, trdId)}`));
}
export function writeView(projectId: string, trdId: string, view: InterviewView): void {
  write(`${VIEW}:${where(projectId, trdId)}`, view);
}

/** True when the person last left the list on "one question at a time". False when the browser kept nothing. */
export function readOne(projectId: string, trdId: string): boolean {
  return read(`${ONE}:${where(projectId, trdId)}`) === "1";
}
export function writeOne(projectId: string, trdId: string, one: boolean): void {
  write(`${ONE}:${where(projectId, trdId)}`, one ? "1" : "0");
}

/**
 * The address (the part after #) with `view` and `node` set or taken out, every other parameter kept, so a link opens the same view.
 * The list is the plain address: no `view` at all.
 */
export function interviewHash(currentHash: string, view: InterviewView, node?: string, keep: Record<string, string> = {}): string {
  const raw = currentHash.replace(/^#/, "");
  const [path = "/", query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  params.delete("view");
  params.delete("node");
  for (const [k, v] of Object.entries(keep)) params.set(k, v);
  if (view !== "list") {
    params.set("view", view);
    if (node) params.set("node", node);
  }
  const q = params.toString();
  return `#${path}${q ? `?${q}` : ""}`;
}

/** The questions of a node-limited run: the visible questions (the filters in force) that belong to the node, in list order. */
export function nodeRunKeys(visibleKeys: readonly string[], nodeKeys: readonly string[]): string[] {
  const mine = new Set(nodeKeys);
  return visibleKeys.filter((k) => mine.has(k));
}

/** Where a run starts: the first question of the run that is still open, else the first one. */
export function runStartIndex(runKeys: readonly string[], openKeys: ReadonlySet<string>): number {
  const at = runKeys.findIndex((k) => openKeys.has(k));
  return at < 0 ? 0 : at;
}

interface NodeLike {
  id: string;
  questionKeys: readonly string[];
  counts: { open: number };
  status: string;
}

/** The node that holds a question (the first one, in map order), for the tile that gets the focus back. */
export function nodeOfQuestion<T extends NodeLike>(nodes: readonly T[], key: string): T | undefined {
  return nodes.find((n) => n.questionKeys.includes(key));
}

/** "Next step with open questions": the next node after this one that still has an open question, going round to the start; undefined when none is left. */
export function nextNodeWithOpen<T extends NodeLike>(nodes: readonly T[], currentId: string): T | undefined {
  const at = nodes.findIndex((n) => n.id === currentId);
  const ordered = at < 0 ? [...nodes] : [...nodes.slice(at + 1), ...nodes.slice(0, at)];
  return ordered.find((n) => n.status !== "left_out" && n.counts.open > 0);
}

/** A node can be opened into a run when it has questions in view; a left-out step or an empty one is only a tile. */
export const nodeIsOpenable = (n: NodeLike): boolean => n.status !== "left_out" && n.questionKeys.length > 0;

// ------------------------------------------------------------------ the gap interview map (M14 job 3)

const GAP_VIEW = "gap-interview-view";

/** The map view ("process" or "areas") this person last opened in the gap interview of this project; the list is never stored (it is the default). */
export function readGapView(projectId: string): "process" | "areas" | undefined {
  const v = parseInterviewView(read(`${GAP_VIEW}:${projectId}`));
  return v === "process" || v === "areas" ? v : undefined;
}
export function writeGapView(projectId: string, view: "process" | "areas"): void {
  write(`${GAP_VIEW}:${projectId}`, view);
}

/** The unit an area view follows for a question side: a sending question belongs to the sending unit, a receiving one to the receiving unit, a shared one keeps the unit already shown. */
export function unitOfSide(side: "source" | "target" | "shared" | undefined, current: "su" | "ru"): "su" | "ru" {
  if (side === "source") return "su";
  if (side === "target") return "ru";
  return current;
}

/** The unit named by `unit=` in an address (the "Your areas" page links back with it), or undefined. */
export function unitFromHash(hash: string): "su" | "ru" | undefined {
  const v = new URLSearchParams(hash.replace(/^#/, "").split("?")[1] ?? "").get("unit");
  return v === "su" || v === "ru" ? v : undefined;
}

/** The help text of the "Show the questions as" group, the same in both interviews. */
export const VIEWS_HELP =
  "The list shows every question, grouped by step. A map shows one tile for each step, or one card for each area of your site. Pick a tile to answer its questions one at a time. The questions and answers are the same in every view. Areas are optional: you set them up on the Your areas page.";
