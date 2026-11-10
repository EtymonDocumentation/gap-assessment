import { FACILITY_GRADE_LABEL, facilityAreas, type FacilityArea, type FacilityGrade, type FacilityUnit, type Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { InterviewMapWording } from "./interview-map-content";
import { notApplicableReason, stepExclusions } from "./scope";
import { INTERVIEW_DOCUMENT_GROUP, type InterviewQuestion } from "./trd-interview";
import { isAnswered, isTbdAnswer, type QuestionInstance } from "./sequencer";

/**
 * The interview map (M14): the clickable maps of an interview, by PROCESS STEP and by FACILITY AREA. Everything here is DERIVED from the
 * questions and their state and from the project's areas; nothing is stored, so a tile can never disagree with the list or the banners.
 *
 * It is generic on purpose: a map is built from a small list of question summaries ({ key, stepKey, state }) and a list of steps, and two
 * adapters (the TRD interview and the gap interview) make those. Another interview later needs only a third adapter.
 *
 * A map is one more way to reach the SAME questions. It holds no answer, blocks nothing and decides nothing. The words of the counts come
 * from ONE function (`mapCountsText`) so the list, the banners and the tiles cannot drift apart.
 */

/** answered (a value, or "not applicable here"), open, tbd ("to be decided": open, counted apart) or to_confirm (a project value waiting to be kept). */
export type MapQuestionState = "answered" | "open" | "tbd" | "to_confirm";

export interface MapQuestion {
  key: string;
  /** The process step, or null for a question that belongs to no step (scope and site, document and details). */
  stepKey: string | null;
  state: MapQuestionState;
  /** True for "More detail" questions (TRD). They are counted only when the map is built with `includeDetail`. */
  detail?: boolean;
}

export interface MapStep {
  key: string;
  label: string;
  /** Set when the step is left out of the project (by the person in Scope, or because an answer makes it not apply). Never clickable into a run. */
  leftOut?: { reason?: string; cause: "scope" | "answer"; /** The interview question that decides it, when one can be named. */ questionKey?: string };
}

export interface MapInput {
  questions: MapQuestion[];
  /** The steps of the process, in process order. A step with no question is still listed (it says "No questions here"). */
  steps: MapStep[];
  /** The name of the node for questions that belong to no step. */
  wholeLabel: string;
}

export interface MapCounts {
  total: number;
  answered: number;
  open: number;
  tbd: number;
  toConfirm: number;
}

export type MapNodeKind = "step" | "area" | "whole" | "unplaced";
export type MapStatus = "all_answered" | "open" | "to_be_decided" | "nothing_to_ask" | "left_out";

export interface MapNodeStep {
  key: string;
  label: string;
  number: number;
  /** The names of the OTHER areas of this unit the step is also done in ("also done in ..."). Empty on the process map. */
  alsoIn: string[];
  leftOut?: boolean;
}

export interface MapNode {
  /** "whole", "unplaced", "step:<key>" or "area:<id>". */
  id: string;
  kind: MapNodeKind;
  label: string;
  /** Position of a step in process order (1-based). */
  number?: number;
  /** Areas only. */
  areaId?: string;
  grade?: FacilityGrade;
  parentId?: string;
  /** 0 for a top-level area, 1 for an area inside another. */
  depth?: number;
  fromExample?: boolean;
  /** The steps done here (areas and the "not placed" node), in process order. */
  steps?: MapNodeStep[];
  /** A step node: the names of the areas it is done in, when areas were given. */
  areaNames?: string[];
  /** Every question reachable from this node, in list order, counted once. */
  questionKeys: string[];
  counts: MapCounts;
  /** Questions of "More detail" that are not counted because the level in view is Essentials. */
  moreDetail?: { total: number; open: number };
  status: MapStatus;
  /** Why a left-out step is left out. */
  reason?: string;
  leftOutCause?: "scope" | "answer";
  leftOutQuestionKey?: string;
}

export interface InterviewMap {
  view: "process" | "areas";
  nodes: MapNode[];
  /** Overall counts, every question once (a step in two areas is counted once). */
  totals: MapCounts;
  /** Areas map only: the unit has no areas, so there is nothing to show but the empty state. */
  empty?: boolean;
}

export interface MapOptions {
  /** Count the "More detail" questions too. Default false: Essentials only. */
  includeDetail?: boolean;
}

const zero = (): MapCounts => ({ total: 0, answered: 0, open: 0, tbd: 0, toConfirm: 0 });

function countOf(qs: readonly MapQuestion[]): MapCounts {
  const c = zero();
  for (const q of qs) {
    c.total += 1;
    if (q.state === "answered") c.answered += 1;
    else {
      c.open += 1;
      if (q.state === "tbd") c.tbd += 1;
      if (q.state === "to_confirm") c.toConfirm += 1;
    }
  }
  return c;
}

export function mapStatusOf(counts: MapCounts): MapStatus {
  if (counts.total === 0) return "nothing_to_ask";
  if (counts.open === 0) return "all_answered";
  return counts.tbd > 0 ? "to_be_decided" : "open";
}

// ------------------------------------------------------------------ words

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

/**
 * The ONE counts text, for a tile, a list heading, a banner and the gap Progress map: "All 9 answered", "3 of 9 answered, 6 open",
 * "3 of 9 answered, 6 open (1 to be decided)", "No questions here". A tbd answer is still open; it is only named apart.
 */
export function mapCountsText(c: MapCounts, w: InterviewMapWording): string {
  if (c.total === 0) return w.status.nothingToAsk;
  if (c.open === 0) return fill(w.status.allAnswered, { total: c.total });
  const parts = [c.tbd > 0 ? fill(w.status.tbdPart, { tbd: c.tbd }) : "", c.toConfirm > 0 ? fill(w.status.toConfirmPart, { toConfirm: c.toConfirm }) : ""].filter(Boolean);
  return fill(w.status.someOpen, { answered: c.answered, total: c.total, open: c.open }) + (parts.length ? ` (${parts.join(", ")})` : "");
}

/** The state line of a node: its counts, or "Left out of this project: <reason>". */
export function mapStatusText(n: MapNode, w: InterviewMapWording): string {
  if (n.status === "left_out") return n.reason ? fill(w.status.leftOutWithReason, { reason: n.reason }) : w.status.leftOut;
  return mapCountsText(n.counts, w);
}

export type MapIcon = "check" | "circle" | "half-circle" | "dash" | "question";
export type MapBorder = "solid" | "dashed" | "dotted";

/** Icon and border of a node. The state is always ALSO in words, so neither is a colour-only cue. */
export function mapStatusStyle(n: Pick<MapNode, "kind" | "status">): { icon: MapIcon; border: MapBorder } {
  if (n.kind === "unplaced") return { icon: "question", border: "dashed" };
  switch (n.status) {
    case "all_answered":
      return { icon: "check", border: "solid" };
    case "open":
      return { icon: "circle", border: "dashed" };
    case "to_be_decided":
      return { icon: "half-circle", border: "dashed" };
    case "nothing_to_ask":
    case "left_out":
      return { icon: "dash", border: "dotted" };
  }
}

/** The "plus N more in More detail" line of a step tile, or undefined when there is nothing to say. */
export function mapMoreDetailText(n: MapNode, w: InterviewMapWording): string | undefined {
  return n.moreDetail && n.moreDetail.open > 0 ? fill(w.steps.moreDetail, { n: n.moreDetail.open }) : undefined;
}

/** "also done in <areas>" for a step that is in several areas, or undefined. */
export function mapAlsoDoneInText(s: MapNodeStep, w: InterviewMapWording): string | undefined {
  return s.alsoIn.length ? fill(w.areas.alsoDoneIn, { areas: s.alsoIn.join(", ") }) : undefined;
}

/** The text announced after a run: "Back on the map. Sterile filtration: 5 of 9 answered, 4 open." */
export function mapBackOnMapText(n: MapNode, w: InterviewMapWording): string {
  return fill(w.run.backOnMap, { label: n.label, status: mapStatusText(n, w) });
}

/** The end-of-run text: "That was the last question in Sterile filtration. 4 left open." */
export function mapEndOfNodeText(n: MapNode, w: InterviewMapWording): string {
  return fill(w.run.endOfNode, { label: n.label, open: n.counts.open });
}

/** The accessible name of a tile: number, name, grade, areas, counts and state, e.g. "Sterile filtration, step 5, 3 of 9 answered, 6 open". */
export function mapNodeName(n: MapNode, w: InterviewMapWording): string {
  const bits: string[] = [n.label];
  if (n.kind === "step" && n.number !== undefined) bits.push(`step ${n.number}`);
  if (n.kind === "area") bits.push(n.grade ? FACILITY_GRADE_LABEL[n.grade] : w.areas.gradeNotStated);
  if (n.areaNames?.length) bits.push(`in ${n.areaNames.join(", ")}`);
  bits.push(mapStatusText(n, w));
  return bits.join(", ");
}

// ------------------------------------------------------------------ building

/** Questions in view: the "More detail" ones only when asked for. */
const inView = (qs: readonly MapQuestion[], o: MapOptions) => qs.filter((q) => (o.includeDetail ? true : !q.detail));

/** Process order of a question: the "whole" ones first, then by step position. Unknown steps go last. */
function processOrder(input: MapInput): (q: MapQuestion) => number {
  const at = new Map(input.steps.map((s, n) => [s.key, n] as const));
  return (q) => (q.stepKey === null ? -1 : at.get(q.stepKey) ?? input.steps.length);
}

function moreDetailOf(all: readonly MapQuestion[], o: MapOptions): { total: number; open: number } | undefined {
  if (o.includeDetail) return undefined;
  const d = all.filter((q) => q.detail);
  return d.length ? { total: d.length, open: d.filter((q) => q.state !== "answered").length } : undefined;
}

function nodeOf(base: Pick<MapNode, "id" | "kind" | "label"> & Partial<MapNode>, all: readonly MapQuestion[], o: MapOptions): MapNode {
  const mine = inView(all, o);
  const counts = countOf(mine);
  const detail = moreDetailOf(all, o);
  return { ...base, questionKeys: mine.map((q) => q.key), counts, ...(detail ? { moreDetail: detail } : {}), status: mapStatusOf(counts) };
}

const byStep = (qs: readonly MapQuestion[], keys: ReadonlySet<string>) => qs.filter((q) => q.stepKey !== null && keys.has(q.stepKey));

/**
 * The steps shown as "Left out of this project": left out AND with no question in this interview. The map must agree with the list, so a step
 * the project leaves out but that the interview still asks about (a TRD keeps every step it was made with) keeps its real counts and only
 * carries the reason; a gap interview never asks about a left-out step, so there it is always a left-out node.
 */
function outKeys(input: MapInput): Set<string> {
  const asked = new Set(input.questions.map((q) => q.stepKey));
  return new Set(input.steps.filter((s) => s.leftOut && !asked.has(s.key)).map((s) => s.key));
}

function wholeNode(qs: readonly MapQuestion[], label: string, o: MapOptions): MapNode | undefined {
  const mine = qs.filter((q) => q.stepKey === null);
  return inView(mine, o).length ? nodeOf({ id: "whole", kind: "whole", label }, mine, o) : undefined;
}

function sumTotals(nodes: readonly MapNode[], qs: readonly MapQuestion[]): MapCounts {
  const keys = new Set(nodes.flatMap((n) => n.questionKeys));
  return countOf(qs.filter((q) => keys.has(q.key)));
}

/**
 * The process-steps map: the "whole" node first (when it has questions), then one node per step in process order. A step that is left out
 * is a node too ("Left out of this project", with the reason), so the decision stays visible; it holds no questions. `areas` (optional)
 * names the areas each step is done in, for the tile's accessible name.
 */
export function buildProcessMap(input: MapInput, opts: MapOptions & { areas?: readonly FacilityArea[] } = {}): InterviewMap {
  const live = input.questions;
  const out = outKeys(input);
  const nodes: MapNode[] = [];
  const whole = wholeNode(live, input.wholeLabel, opts);
  if (whole) nodes.push(whole);
  input.steps.forEach((s, n) => {
    const areaNames = (opts.areas ?? []).filter((a) => a.stepKeys.includes(s.key)).map((a) => a.name);
    const extra: Partial<MapNode> = { number: n + 1, ...(areaNames.length ? { areaNames } : {}) };
    if (s.leftOut && out.has(s.key)) {
      nodes.push({
        id: `step:${s.key}`,
        kind: "step",
        label: s.label,
        ...extra,
        questionKeys: [],
        counts: zero(),
        status: "left_out",
        ...(s.leftOut.reason ? { reason: s.leftOut.reason } : {}),
        leftOutCause: s.leftOut.cause,
        ...(s.leftOut.questionKey ? { leftOutQuestionKey: s.leftOut.questionKey } : {}),
      });
      return;
    }
    // Left out but still asked about: real counts, plus the reason so the page can say so.
    const note: Partial<MapNode> = s.leftOut ? { ...(s.leftOut.reason ? { reason: s.leftOut.reason } : {}), leftOutCause: s.leftOut.cause, ...(s.leftOut.questionKey ? { leftOutQuestionKey: s.leftOut.questionKey } : {}) } : {};
    nodes.push(nodeOf({ id: `step:${s.key}`, kind: "step", label: s.label, ...extra, ...note }, byStep(live, new Set([s.key])), opts));
  });
  return { view: "process", nodes, totals: sumTotals(nodes, live) };
}

/**
 * The facility-areas map for ONE unit. Each area is a node in the order the user listed them, with its parent and depth so the page can nest
 * an area inside another. A step done in several areas shows under each ("also done in <other area>") and its questions are counted ONCE in
 * the totals. Steps in no area of this unit gather in the "Not placed in an area yet" node, so every question stays reachable. The "whole"
 * questions are the first node ("About the whole site"). With no areas at all the map is empty and the page shows the empty state.
 */
export function buildAreaMap(input: MapInput, areas: readonly FacilityArea[], wording: InterviewMapWording, opts: MapOptions = {}): InterviewMap {
  if (areas.length === 0) return { view: "areas", nodes: [], totals: zero(), empty: true };
  const live = input.questions;
  const out = outKeys(input);
  const stepByKey = new Map(input.steps.map((s, n) => [s.key, { s, n: n + 1 }] as const));
  const nameOf = new Map(areas.map((a) => [a.id, a.name] as const));
  const nodes: MapNode[] = [];
  const whole = wholeNode(live, wording.nodes.wholeAreas, opts);
  if (whole) nodes.push(whole);

  const stepsOf = (keys: readonly string[], self?: FacilityArea): MapNodeStep[] =>
    keys
      .filter((k) => stepByKey.has(k))
      .map((k) => ({ k, ...stepByKey.get(k)! }))
      .sort((a, b) => a.n - b.n)
      .map(({ k, s, n }) => ({
        key: k,
        label: s.label,
        number: n,
        alsoIn: areas.filter((a) => a !== self && a.stepKeys.includes(k)).map((a) => a.name),
        ...(out.has(k) ? { leftOut: true } : {}),
      }));

  const depthOf = (a: FacilityArea): number => {
    let d = 0;
    for (let at = a.insideAreaId; at && d < areas.length; at = areas.find((x) => x.id === at)?.insideAreaId) d += 1;
    return d;
  };

  for (const a of areas) {
    const steps = stepsOf(a.stepKeys, a);
    const liveKeys = new Set(steps.filter((s) => !s.leftOut).map((s) => s.key));
    const node = nodeOf(
      {
        id: `area:${a.id}`,
        kind: "area",
        label: a.name,
        areaId: a.id,
        depth: depthOf(a),
        ...(a.grade ? { grade: a.grade } : {}),
        ...(a.insideAreaId && nameOf.has(a.insideAreaId) ? { parentId: `area:${a.insideAreaId}` } : {}),
        ...(a.fromExample ? { fromExample: true } : {}),
        steps,
      },
      byStep(live, liveKeys),
      opts,
    );
    // An area whose steps are all left out says so, instead of reading "No questions here".
    if (steps.length > 0 && liveKeys.size === 0) node.status = "left_out";
    nodes.push(node);
  }

  const placed = new Set(areas.flatMap((a) => a.stepKeys));
  const loose = input.steps.filter((s) => !placed.has(s.key));
  if (loose.length) {
    const liveKeys = new Set(loose.filter((s) => !out.has(s.key)).map((s) => s.key));
    nodes.push(nodeOf({ id: "unplaced", kind: "unplaced", label: wording.status.notPlaced, steps: stepsOf(loose.map((s) => s.key)) }, byStep(live, liveKeys), opts));
  }
  return { view: "areas", nodes, totals: sumTotals(nodes, live) };
}

/** The areas of one unit of a project, for `buildAreaMap` / `buildProcessMap`. */
export const mapAreasOf = (project: Pick<Project, "facility">, unit: FacilityUnit): FacilityArea[] => facilityAreas(project, unit);

/** The first question that is not answered, in process order ("Go to the next open question"), or undefined when everything in view is answered. */
export function firstOpenQuestion(input: MapInput, opts: MapOptions = {}): MapQuestion | undefined {
  const rank = processOrder(input);
  const live = inView(input.questions, opts)
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i);
  return live.find((x) => x.q.state !== "answered")?.q;
}

// ------------------------------------------------------------------ adapters

/**
 * The steps of a project in process order (catalog and custom), each marked when left out. A step is listed when it has questions or is left
 * out; a step with neither is not part of this interview. Left out by the person (Scope) keeps its reason; left out because an answer makes it
 * not apply keeps that answer's words and the question that decides it.
 */
function mapSteps(content: ContentBundle, project: Project, withQuestions: ReadonlySet<string>, extraLabels: ReadonlyMap<string, string>): MapStep[] {
  const all = [...content.catalog.unitOperations.map((u) => ({ key: u.key, label: u.label, sequence: u.sequence })), ...(project.custom?.unitOperations ?? []).map((u) => ({ key: u.key, label: u.label, sequence: u.sequence }))].sort((a, b) => a.sequence - b.sequence);
  const excluded = new Map(stepExclusions(content, project).map((e) => [e.uo, e] as const));
  const steps: MapStep[] = [];
  const seen = new Set<string>();
  for (const u of all) {
    seen.add(u.key);
    const ex = excluded.get(u.key);
    const na = ex ? undefined : notApplicableReason(content, project, u.key);
    if (ex) steps.push({ key: u.key, label: u.label, leftOut: { cause: "scope", ...(ex.reason ? { reason: ex.reason } : {}) } });
    else if (na) steps.push({ key: u.key, label: u.label, leftOut: { cause: "answer", reason: na.text.replace(/^Not applicable:\s*/i, ""), ...(na.questionKey ? { questionKey: na.questionKey } : {}) } });
    else if (withQuestions.has(u.key)) steps.push({ key: u.key, label: u.label });
  }
  // A question for a step the catalog does not know (nothing today) still gets a tile, at the end, so it stays reachable.
  for (const k of withQuestions) if (!seen.has(k)) steps.push({ key: k, label: extraLabels.get(k) ?? k });
  return steps;
}

/**
 * The TRD interview as a map. `level` says which questions are in view: "essentials" or "all" (Essentials and More detail). Counts equal
 * `trdInterviewProgress` for the same level, because the state words are mapped the same way: "not applicable here" is answered, a project
 * value counts as answered only once it is kept, "to be decided" is open.
 */
export function trdMapInput(content: ContentBundle, project: Project, questions: readonly InterviewQuestion[], wording: InterviewMapWording, kept: ReadonlySet<string> = new Set()): MapInput {
  const stateOf = (q: InterviewQuestion): MapQuestionState =>
    q.state === "answered" || q.state === "not_applicable" ? "answered" : q.state === "from_project" ? (kept.has(q.key) ? "answered" : "to_confirm") : q.state === "tbd" ? "tbd" : "open";
  const qs: MapQuestion[] = questions.map((q) => ({ key: q.key, stepKey: q.stepKey === INTERVIEW_DOCUMENT_GROUP ? null : q.stepKey, state: stateOf(q), ...(q.essential ? {} : { detail: true }) }));
  const withQuestions = new Set(qs.flatMap((q) => (q.stepKey === null ? [] : [q.stepKey])));
  const labels = new Map(questions.map((q) => [q.stepKey, q.stepLabel] as const));
  return { questions: qs, steps: mapSteps(content, project, withQuestions, labels), wholeLabel: wording.nodes.wholeTrd };
}

/**
 * The gap interview as a map. Each question instance (question and side) is one map question; a section of a unit operation is a step and
 * "Scope and site" is the whole node. A "to be decided" answer is open here (it is recorded, but the step is not finished); the existing
 * `progress()` counts it as answered and says "N to be decided" apart, so the totals match: total equal, and answered + tbd equal.
 */
export function gapMapInput(content: ContentBundle, project: Project, instances: readonly QuestionInstance[], wording: InterviewMapWording): MapInput {
  const qs: MapQuestion[] = instances.map((i) => ({
    key: i.key,
    stepKey: i.section.kind === "uo" && i.section.uo ? i.section.uo : null,
    state: !isAnswered(project, i) ? "open" : isTbdAnswer(project, i) ? "tbd" : "answered",
  }));
  const withQuestions = new Set(qs.flatMap((q) => (q.stepKey === null ? [] : [q.stepKey])));
  const labels = new Map(instances.flatMap((i) => (i.section.uo ? [[i.section.uo, i.section.title] as const] : [])));
  return { questions: qs, steps: mapSteps(content, project, withQuestions, labels), wholeLabel: wording.nodes.wholeGap };
}
