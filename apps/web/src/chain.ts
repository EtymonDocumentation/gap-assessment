import { content } from "@gap/content";
import { effectiveSuggestions } from "./expected-studies-store";
import { isAnswered, planDesignReview, type Assessment, type TrdTemplateFor } from "@gap/engine";
import { designReviewLine, type DesignReviewView } from "@gap/sampling";
import type { Project } from "@gap/process-model";
import { interviewCounts, scopeRecorded } from "./next-step";
import { excipientOpenCount, openItemsCountOrNone, trdOpenCount } from "./open-count";
import { excipientAssessments } from "@gap/process-model";

/**
 * The document chain: gap assessment, TRD, sampling plan, batch record, Process view. It is a map of how the documents lead to each
 * other, not a workflow. Every stage is optional (a TRD can start blank, the gap assessment can be skipped), nothing is blocked or
 * required, and a stage that is not started says so in plain words. All status text is derived from the project, so it reads the
 * same in the browser-only build and in server mode.
 */
export type ChainId = "gap" | "risk" | "excipient" | "trd" | "sampling" | "mbr" | "view";

/** The stages that sit beside the chain: shown in the strip, with no number and never the Back or Next document. */
export const ALONGSIDE_STAGES: readonly ChainId[] = ["risk", "excipient"];

/** Which modules the account may use. The gap assessment and the chain itself are always there. */
export interface ChainAllowed {
  trd: boolean;
  sampling: boolean;
  mbr: boolean;
  risk: boolean;
  /** The excipient assessment. Absent counts as not included. */
  excipient?: boolean;
}

export interface ChainLink {
  label: string;
  path: string;
  params?: Record<string, string>;
}

export interface ChainStage extends ChainLink {
  id: ChainId;
  /** The stage's own name, without "Next:" or "Back:". */
  name: string;
  status: string;
  current: boolean;
}

export interface ChainBar {
  back?: ChainLink;
  next?: ChainLink;
  /** Shown when there is no next link, e.g. the Process view opens from a batch record. */
  nextNote?: string;
  /** "Optional" reminder under the Next link. */
  hint?: string;
  /** Documents that already use the one on screen (batch records built from this TRD or plan). */
  related?: { heading: string; links: ChainLink[] };
}

export interface ChainRoute {
  path: string;
  params: URLSearchParams;
}

const NAMES: Record<ChainId, string> = { gap: "Gap assessment", risk: "Risk assessment", excipient: "Excipient assessment", trd: "TRD", sampling: "Sampling plan", mbr: "Batch record", view: "Process view" };
const GAP_PATHS = ["/scope", "/interview", "/compare", "/register", "/validation", "/document"];

/** Which stage a route belongs to, or undefined when the route is not part of the chain (libraries, templates...). */
export function chainStageOf(path: string): ChainId | undefined {
  if (GAP_PATHS.includes(path)) return "gap";
  // The risk assessment sits beside the chain: its page shows the strip, but it has no number and no Back / Next (see chainBar).
  if (path === "/risk") return "risk";
  if (path === "/excipient") return "excipient";
  if (path === "/trd") return "trd";
  if (path === "/sampling") return "sampling";
  if (path === "/mbr") return "mbr";
  if (path === "/mbr/view") return "view";
  return undefined;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function gapStatus(project: Project, a: Assessment | null): string {
  if (!a) return "Not started";
  const total = a.instances.length;
  const answered = a.instances.filter((i) => isAnswered(project, i)).length;
  if (answered === 0 && !scopeRecorded(project)) return "Not started";
  // "To be decided" answers count as still open here as everywhere else (see interviewCounts).
  const counts = interviewCounts(project, a.instances);
  if (total > 0 && counts.open > 0) return `${counts.known} of ${total} questions answered, ${openItemsCountOrNone(a.openItems.length)}`;
  const differences = a.gaps.filter((g) => g.category !== "equivalent").length;
  return plural(differences, "difference", "differences");
}

function trdStatus(project: Project, trdTemplate?: TrdTemplateFor): string {
  const docs = project.trd.documents;
  if (docs.length === 0) return "Not started";
  // The one TRD count (open-count.ts): entries still open plus blank fields in the descriptions, the same number the TRD page header shows.
  const open = docs.reduce((n, d) => n + trdOpenCount(project, d, undefined, trdTemplate?.(d)).total, 0);
  const name = docs.length === 1 ? docs[0]!.id : `${docs.length} TRDs`;
  return `${name}, ${openItemsCountOrNone(open)}`;
}

/** The excipient stage: the assessment ids, then the one open-items count the assessment's own pages use (open-count.ts). */
function excipientStatus(project: Project): string {
  const list = excipientAssessments(project);
  if (list.length === 0) return "Not started";
  const open = list.reduce((n, x) => n + excipientOpenCount(project, x), 0);
  const name = list.length === 1 ? list[0]!.id : `${list.length} assessments`;
  return `${name}, ${openItemsCountOrNone(open)}`;
}

function countStatus(ids: string[], many: string): string {
  if (ids.length === 0) return "Not started";
  return ids.length === 1 ? ids[0]! : `${ids.length} ${many}`;
}

/**
 * The sampling stage: the plan ids, plus how many design review questions are still open (unanswered or to look at again), so the
 * strip says when the team has questions to answer. A project with several plans shows the total.
 */
function samplingStatus(project: Project): string {
  const base = countStatus(project.sampling.plans.map((p) => p.id), "plans");
  const total = { questions: 0, unanswered: 0, lookAgain: 0 };
  for (const plan of project.sampling.plans) {
    const v = planDesignReview(content, project, plan, effectiveSuggestions());
    total.questions += v.questions;
    total.unanswered += v.unanswered;
    total.lookAgain += v.lookAgain;
  }
  // The same words as the plan's Overview tab ("15 design review questions not answered yet, 1 to look at again").
  return total.unanswered + total.lookAgain === 0 ? base : `${base}, ${designReviewLine(total as DesignReviewView).replace(/^Design review: /, "")}`;
}

/** The stages shown for this account and project, in chain order, with the route's stage marked current. */
export function chainStages(project: Project, a: Assessment | null, allowed: ChainAllowed, route?: ChainRoute, trdTemplate?: TrdTemplateFor): ChainStage[] {
  const here = route ? chainStageOf(route.path) : undefined;
  const records = project.mbr.records;
  // The Process view needs a batch record: the one on screen, else the first. Without any, its link goes to the batch record list.
  const mbrParam = route?.params.get("mbr");
  const viewRec = records.find((r) => r.id === mbrParam) ?? records[0];
  const all: Omit<ChainStage, "current">[] = [
    { id: "gap", name: NAMES.gap, label: NAMES.gap, path: "/scope", status: gapStatus(project, a) },
    // The risk assessment follows the gap assessment in the process but is not a link of the chain: Back / Next skip it (see chainBar).
    ...(allowed.risk
      ? [{ id: "risk" as const, name: NAMES.risk, label: NAMES.risk, path: "/risk", status: countStatus(project.risk.assessments.map((r) => r.id), "assessments") }]
      : []),
    ...(allowed.excipient ? [{ id: "excipient" as const, name: NAMES.excipient, label: NAMES.excipient, path: "/excipient", status: excipientStatus(project) }] : []),
    ...(allowed.trd ? [{ id: "trd" as const, name: NAMES.trd, label: NAMES.trd, path: "/trd", status: trdStatus(project, trdTemplate) }] : []),
    ...(allowed.sampling
      ? [{ id: "sampling" as const, name: NAMES.sampling, label: NAMES.sampling, path: "/sampling", status: samplingStatus(project) }]
      : []),
    ...(allowed.mbr
      ? [
          { id: "mbr" as const, name: NAMES.mbr, label: NAMES.mbr, path: "/mbr", status: countStatus(records.map((r) => r.id), "records") },
          {
            id: "view" as const,
            name: NAMES.view,
            label: NAMES.view,
            path: viewRec ? "/mbr/view" : "/mbr",
            ...(viewRec ? { params: { mbr: viewRec.id } } : {}),
            // Ease-of-use pass (EOU-30): the Process view is a tab of a batch record, not a document of its own. The strip lists it as the last
            // stage of the chain, so its status line says what it is instead of leaving "5 · Process view (you are here)" to read as a fifth document.
            status: viewRec ? "A tab of the batch record" : "A tab of a batch record, once there is one",
          },
        ]
      : []),
  ];
  return all.map((s) => ({ ...s, current: s.id === here }));
}

/**
 * Back / Next for the page on screen. The neighbour is the next allowed stage in chain order; when the page is one particular
 * document, Next goes to the document already linked to it if there is one (a batch record's own plan, the batch record built
 * from a plan), otherwise to that module's list or start.
 */
export function chainBar(project: Project, a: Assessment | null, allowed: ChainAllowed, route: ChainRoute, trdTemplate?: TrdTemplateFor): ChainBar {
  // The risk assessment sits beside the chain: it is shown in the strip but is never the Back or Next document.
  const stages = chainStages(project, a, allowed, route, trdTemplate).filter((s) => !ALONGSIDE_STAGES.includes(s.id));
  const at = stages.findIndex((s) => s.current);
  if (at < 0) return {};
  const here = stages[at]!;
  const records = project.mbr.records;
  const link = (s: ChainStage, prefix: "Back" | "Next"): ChainLink => ({ label: `${prefix}: ${s.name}`, path: s.path, ...(s.params ? { params: s.params } : {}) });
  const bar: ChainBar = {};
  const prev = stages[at - 1];
  const next = stages[at + 1];
  const trdParam = route.params.get("trd");
  const planParam = route.params.get("plan");
  const rec = records.find((r) => r.id === route.params.get("mbr"));

  // The gap steps have their own Back / Next bar; only the last one (the document) hands over to the chain.
  if (here.id === "gap" && route.path !== "/document") return {};
  if (prev && here.id !== "gap") bar.back = link(prev, "Back");
  if (next) bar.next = link(next, "Next");

  if (here.id === "trd") {
    // A TRD is written after the gap assessment document, so Back goes to that document (not to the first step).
    bar.back = { label: "Back: Gap assessment document", path: "/document" };
    const users = records.filter((r) => trdParam && r.trdId === trdParam);
    if (users.length > 0) bar.related = { heading: `Batch records started from ${trdParam}`, links: users.map((r) => ({ label: `${r.id}: ${r.title}`, path: "/mbr", params: { mbr: r.id } })) };
  }
  if (here.id === "gap") bar.hint = "Optional. A TRD can also start blank.";
  if (here.id === "sampling") {
    const users = records.filter((r) => planParam && r.planId === planParam);
    if (users[0] && allowed.mbr) {
      bar.next = { label: `Next: Batch record ${users[0].id}`, path: "/mbr", params: { mbr: users[0].id } };
      if (users.length > 1) bar.related = { heading: `Batch records started from ${planParam}`, links: users.map((r) => ({ label: `${r.id}: ${r.title}`, path: "/mbr", params: { mbr: r.id } })) };
    }
  }
  if (here.id === "mbr") {
    if (rec) {
      const plan = project.sampling.plans.find((p) => p.id === rec.planId);
      if (plan && allowed.sampling) bar.back = { label: `Back: Sampling plan ${plan.id}`, path: "/sampling", params: { plan: plan.id } };
      const trd = project.trd.documents.find((d) => d.id === rec.trdId);
      if (trd && allowed.trd) bar.related = { heading: "Linked TRD", links: [{ label: `${trd.id}: ${trd.title}`, path: "/trd", params: { trd: trd.id } }] };
      bar.next = { label: "Next: Process view", path: "/mbr/view", params: { mbr: rec.id } };
    } else if (!records[0]) {
      delete bar.next;
      bar.nextNote = "The Process view opens from a batch record. Start one above to see it.";
    }
  }
  if (here.id === "view") {
    delete bar.next;
    if (rec) bar.back = { label: `Back: Batch record ${rec.id}`, path: "/mbr", params: { mbr: rec.id } };
  }
  return bar;
}

/**
 * The follow-on to offer once the gap assessment is under way: the first document of the chain that has nothing yet. It is shown next
 * to (never instead of) the gap step, because the project cannot show that a register was read. Risk sits beside the chain, not in it.
 */
export function thenStep(project: Project, allowed: ChainAllowed): ChainLink | null {
  if (allowed.trd && project.trd.documents.length === 0) return { label: "Start a TRD", path: "/trd" };
  if (allowed.sampling && project.sampling.plans.length === 0) return { label: "Start a sampling plan", path: "/sampling" };
  if (allowed.mbr && project.mbr.records.length === 0) return { label: "Start a batch record", path: "/mbr" };
  if (allowed.risk && project.risk.assessments.length === 0) return { label: "Start a risk assessment", path: "/risk" };
  const rec = project.mbr.records[0];
  if (allowed.mbr && rec) return { label: "Open the Process view", path: "/mbr/view", params: { mbr: rec.id } };
  return null;
}
