import type { PlanStep, ReviewAnswer, SamplingPlan, SamplingPoint, SamplingType, StudyEquipmentItem } from "@gap/process-model";
import { placementText, stepOf } from "./flow.js";
import { isBagSample, isPortLikeAccess, sampleMethodView } from "./method.js";
import { mlText, volumeTakenPerBatch } from "./volume.js";

/**
 * The sampling plan's DESIGN REVIEW (M11): findings worded as QUESTIONS the team answers while the plan is still a draft.
 * completeness.ts says whether an entry is filled in; nothing there says whether the DESIGN looks sound. These checks read facts
 * already in the plan (and, when given, the project's process steps, risk assessment and the expected-study marks of the catalog).
 *
 * Rules the checks keep (GMP reasons, not conveniences):
 *  - QUESTIONS, NOT VERDICTS. The words are "does", "how", "is": never a statement that something is wrong. Each finding says what the plan
 *    states, gives one plain reason it is worth a look, and asks. The tool never decides that a design is adequate or what a change means
 *    for a filing; the team's answer and reason are the record.
 *  - NO GUESSING. A check whose facts are missing stays silent, except the two SUMMARY findings (A8, B4) that say the fact is missing so
 *    other checks cannot look. Nothing is filled in and nothing blocks saving or export.
 *  - STABLE KEYS. A finding's key is its check id plus the ids it is about, so a stored answer finds its finding again. The answer also
 *    stores a fingerprint of the facts it was based on; if the facts change later the answer is kept and shown "look again".
 *  - Free-text matching (bioburden and similar words) is CASE-INSENSITIVE and only a fallback to the study type and catalog key.
 *
 * Group C (volume taken and draw order on a shared port) reads the same volume arithmetic as the batch record's Process view (volume.ts).
 */

export type ReviewGroup = "A" | "B" | "C" | "D";

/** Plain headings for the groups (the card list uses them). */
export const REVIEW_GROUP_TITLE: Record<ReviewGroup, string> = {
  A: "How the samples are taken",
  B: "Where the samples sit",
  C: "How much is taken, and in what order",
  D: "What the plan may have left out",
};

/** Every check of this job, in display order. `title` is the short name used on a card and in the "switched off" list. */
export const REVIEW_CHECKS = [
  { id: "A1", group: "A", title: "Port not flushed" },
  { id: "A2", group: "A", title: "Shared port not flushed between samples" },
  { id: "A3", group: "A", title: "Shared-port lists that do not agree" },
  { id: "A4", group: "A", title: "Port or connector added only for the study" },
  { id: "A5", group: "A", title: "Equipment used only to take samples" },
  { id: "A6", group: "A", title: "Sample drawn open" },
  { id: "A7", group: "A", title: "Bag sample not mixed first" },
  { id: "A8", group: "A", title: "How the sample is taken not stated" },
  { id: "B1", group: "B", title: "Sample after the sterile filtration" },
  { id: "B2", group: "B", title: "Filter without a bioburden sample before it" },
  { id: "B3", group: "B", title: "Process steps without samples" },
  { id: "B4", group: "B", title: "Samples not placed on the diagram" },
  { id: "B5", group: "B", title: "Risk failure modes without a linked sample" },
  { id: "C1", group: "C", title: "Volume taken from each batch" },
  { id: "C2", group: "C", title: "Draw order on a shared port" },
  { id: "D1", group: "D", title: "Process step not in the plan" },
  { id: "D2", group: "D", title: "Expected study missing" },
] as const satisfies readonly { id: string; group: ReviewGroup; title: string }[];
export type ReviewCheckId = (typeof REVIEW_CHECKS)[number]["id"];
export const reviewCheck = (id: string) => REVIEW_CHECKS.find((c) => c.id === id);

/** One question the review raises. */
export interface ReviewFinding {
  /** Check id plus the ids the finding is about ("A1:SP-003"). Stable while the plan changes elsewhere. */
  key: string;
  checkId: ReviewCheckId;
  group: ReviewGroup;
  /** Short heading of the card. */
  title: string;
  /** Sample ids (SP-), step ids (ST-) and unit-operation keys the finding is about, for links and highlighting. */
  subjects: string[];
  /** What the plan says (the facts the check read), in plain words. */
  states: string;
  /** One plain GMP reason this is worth a look. */
  why: string;
  /** The question, never a verdict. */
  question: string;
  /** Hash of exactly the facts read, including the expected marks for D2. A different value later means "look again". */
  factsFingerprint: string;
}

/** A process step the plan is compared with: a catalog unit-operation key when the source has one, else only a label. */
export interface ReviewProcessStep {
  unitOp?: string;
  label: string;
}

/** One failure mode of the project's risk assessment that sits on a step. */
export interface ReviewRiskItem {
  id: string;
  failureMode: string;
  /** The assessment step's unit operation, and its label. */
  unitOp?: string;
  label: string;
  /** Sampling points the item links to. */
  pointIds: string[];
}

/** A catalog entry marked `expected: true` (a typical fill/finish PPQ is expected to cover it). */
export interface ReviewExpectedStudy {
  key: string;
  uo: string;
  type: SamplingType;
  attribute: string;
}

/** The optional project facts. A missing part makes the checks that need it stay silent. */
export interface ReviewContext {
  /** Steps of the project's TRD (the first that exists is the process source for D1). */
  trdSteps?: ReviewProcessStep[];
  /** Included unit operations of the project Scope (D1's source when there is no TRD step). */
  scopeSteps?: ReviewProcessStep[];
  riskItems?: ReviewRiskItem[];
  expected?: ReviewExpectedStudy[];
  /** The project stage key. Outside PPQ (and when it is not set, PPQ stays) the questions say "these batches" instead of PPQ. */
  stage?: string;
}

/**
 * The questions are written for PPQ. At any other project stage the same question is asked about "these batches" (the engineering runs,
 * the clinical batches or routine production), so a clinical team is not asked about PPQ it is not running. Only the words change: the
 * check, the key and the facts fingerprint stay the same, so a saved answer still belongs to its question.
 */
const NOT_PPQ_WORDS: [RegExp, string][] = [
  [/Does PPQ still represent the commercial process/g, "Do these batches still represent the commercial process"],
  [/so that PPQ represents the commercial process/g, "so that these batches represent the commercial process"],
  [/the assembly PPQ runs on, so PPQ may not show what routine production does/g, "the assembly these batches run on, so they may not show what routine production does"],
  [/only to take PPQ samples/g, "only to take study samples"],
  [/used only for PPQ sampling/g, "used only for study sampling"],
  [/and PPQ may not show what routine production does/g, "and these batches may not show what routine production does"],
  [/a step PPQ shows nothing about/g, "a step these batches show nothing about"],
  [/nothing in PPQ can detect is a risk PPQ does not show on the batches it covers/g, "nothing in these batches can detect is a risk they do not show"],
  [/need sampling in PPQ/g, "need sampling in these batches"],
  [/A typical fill[/]finish PPQ covers this/g, "A typical fill/finish study covers this"],
];
const stageWords = (s: string): string => NOT_PPQ_WORDS.reduce((t, [re, to]) => t.replace(re, to), s);
const ppqStage = (stage: string | undefined): boolean => stage === undefined || stage === "ppq";

// ------------------------------------------------------------------ small helpers

/** A short stable hash (cyrb53) of the facts a finding read. Not security: it only has to differ when the facts differ. */
export function factsHash(facts: unknown): string {
  const s = JSON.stringify(facts);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const trim = (s: string | undefined) => (s ?? "").trim();
/** "SP-003 (Bioburden of the bulk)": the id with the attribute when the point has one. */
const nameOf = (p: SamplingPoint) => (trim(p.attribute) ? `${p.id} (${trim(p.attribute)})` : p.id);
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The text of a point that may name what it is (CASE-INSENSITIVE matching below). */
const pointText = (p: SamplingPoint) => [p.attribute, p.typeLabel, p.materialType, p.origin.kind === "seeded" ? p.origin.suggestionKey : ""].filter(Boolean).join(" ");
const BIOBURDEN = /bio[\s-]?burden|\bcfu\b|microbial\s+(load|count)/i;
/** A bioburden sample: named so in its attribute, type label, material or catalog key (case-insensitive). */
export const isBioburdenPoint = (p: SamplingPoint): boolean => BIOBURDEN.test(pointText(p));

/** Samples that are taken from filled units rather than from the bulk: release, retain and stability samples, finished product, or named so. */
const FILLED_TYPES: readonly SamplingType[] = ["release", "retain_reserve", "stability"];
const FILLED_WORDS = /\bfilled\b|\bvials?\b|\bsyringes?\b|\bcartridges?\b|finished\s+(product|unit)/i;
function fromFilledUnits(p: SamplingPoint): boolean {
  return (p.type !== undefined && FILLED_TYPES.includes(p.type)) || p.unitOp === "finished_product" || FILLED_WORDS.test([p.materialType, p.container].filter(Boolean).join(" "));
}

const BBR = "bbr_filtration";
const SF = "sterile_filtration";
const FILLING = "aseptic_filling";

function finding(f: Omit<ReviewFinding, "group" | "title" | "factsFingerprint"> & { facts: unknown }): ReviewFinding {
  const c = reviewCheck(f.checkId)!;
  const { facts, ...rest } = f;
  return { ...rest, group: c.group, title: c.title, factsFingerprint: factsHash(facts) };
}

// ------------------------------------------------------------------ group A: how the samples are taken

function methodChecks(plan: SamplingPlan): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const byId = new Map(plan.points.map((p) => [p.id, p]));
  const seenPairs = new Set<string>();
  for (const p of plan.points) {
    const m = p.method;
    if (!m) continue;
    const how = sampleMethodView(p)?.accessText ?? "an unstated way";

    // A1: liquid standing in a port or dead leg is not the bulk.
    if (isPortLikeAccess(m.access) && m.flush?.practice === "none_stated_reason") {
      const reason = trim(m.flush.reason);
      out.push(
        finding({
          key: `A1:${p.id}`,
          checkId: "A1",
          subjects: [p.id],
          states: `${nameOf(p)} is taken through a ${how}. The plan says the port is not flushed first${reason ? `. Reason written: "${reason}"` : " and gives no reason"}.`,
          why: "Liquid that has stood in a port or dead leg can differ from the bulk, so a sample drawn without a flush may not represent it.",
          question: "Does the liquid standing in the port still represent the bulk at the time this sample is drawn?",
          facts: [p.id, p.attribute, m.access, m.flush.practice, m.flush.reason],
        }),
      );
    }

    // A2: a shared port that is not flushed between samples.
    if (m.access === "shared_port" && m.shared?.flushBetween === false) {
      const others = m.shared.pointIds ?? [];
      out.push(
        finding({
          key: `A2:${p.id}`,
          checkId: "A2",
          subjects: [p.id, ...others],
          states: `${nameOf(p)} is taken through a port shared${others.length ? ` with ${list(others)}` : " with other samples"}. The plan says the port is not flushed between samples.`,
          why: "A port used for several samples can carry liquid from one draw into the next.",
          question: "Could liquid from one sample carry over into the next on this shared port, and is that acceptable for these samples?",
          facts: [p.id, p.attribute, m.access, others, m.shared.flushBetween],
        }),
      );
    }

    // A3: shared-port lists must agree both ways.
    if (m.shared?.pointIds?.length) {
      for (const other of m.shared.pointIds) {
        const o = byId.get(other);
        const reverse = o?.method?.access === "shared_port" && (o.method.shared?.pointIds ?? []).includes(p.id);
        if (reverse) continue;
        const pair = [p.id, other].sort().join("+");
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        const what = !o ? `${other} is not a sample of this plan` : o.method?.access !== "shared_port" ? `${nameOf(o)} is not a shared-port sample` : `${nameOf(o)} does not name ${p.id}`;
        out.push(
          finding({
            key: `A3:${[p.id, other].sort().join("+")}`,
            checkId: "A3",
            subjects: [p.id, other],
            states: `${nameOf(p)} says it shares a port with ${other}, but ${what}.`,
            why: "The lists of samples on a shared port are what the order and the flush between samples are read from, so they need to agree.",
            question: `Do ${p.id} and ${other} share a port, and should both samples say so?`,
            facts: [p.id, p.method?.access, m.shared.pointIds, other, o ? [o.method?.access, o.method?.shared?.pointIds] : null],
          }),
        );
      }
    }

    // A4: a port, connector or manifold put on only for the study.
    const addedForStudy = m.added?.forStudyOnly === true || (m.access === "added_y_connector" && m.added?.forStudyOnly !== false);
    const a = m.added;
    if (addedForStudy && !(a?.inCommercialAssembly === true && a.validatedAssembly === true && a.removedAfter === false)) {
      const asks: string[] = [];
      if (a?.inCommercialAssembly !== true) asks.push(a?.inCommercialAssembly === false ? "Does PPQ still represent the commercial process when this part is not in the commercial assembly?" : "Is this part in the commercial assembly, so that PPQ represents the commercial process?");
      if (a?.validatedAssembly !== true) asks.push(a?.validatedAssembly === false ? "Which extractables and integrity evidence covers the modified assembly?" : "Is the modified assembly covered by the assembly qualification (extractables and integrity)?");
      if (a?.removedAfter !== false) asks.push(a?.removedAfter === true ? "Is the removal itself a risk to the system, and is it written in the batch record?" : "Is the part removed afterwards, and if so is the removal written in the batch record?");
      const said = [
        a?.inCommercialAssembly === undefined ? "whether it is in the commercial assembly is not stated" : a.inCommercialAssembly ? "it is in the commercial assembly" : "it is not in the commercial assembly",
        a?.validatedAssembly === undefined ? "whether the assembly qualification covers it is not stated" : a.validatedAssembly ? "the assembly qualification covers it" : "the assembly qualification does not cover it",
        a?.removedAfter === undefined ? "whether it is removed afterwards is not stated" : a.removedAfter ? "it is removed afterwards" : "it is not removed afterwards",
      ];
      out.push(
        finding({
          key: `A4:${p.id}`,
          checkId: "A4",
          subjects: [p.id],
          states: `${nameOf(p)} is taken through a ${how} added only for the study. For this part ${list(said)}.`,
          why: "A part added only for sampling changes the assembly PPQ runs on, so PPQ may not show what routine production does.",
          question: asks.join(" "),
          facts: [p.id, p.attribute, m.access, a?.forStudyOnly, a?.inCommercialAssembly, a?.validatedAssembly, a?.removedAfter],
        }),
      );
    }

    // A6: an open draw.
    if (m.closedSystem === "open" || (m.access === "grab_open" && m.closedSystem !== "closed")) {
      const cls = trim(m.openClass);
      out.push(
        finding({
          key: `A6:${p.id}`,
          checkId: "A6",
          subjects: [p.id],
          states: `${nameOf(p)} is drawn open${cls ? `, under ${cls}` : ""}${m.closedSystem === "open" ? "" : " (open grab)"}.`,
          why: "An open draw exposes the product to the room, so the environment it is drawn in needs to be one the process already uses.",
          question: "Is the environment this sample is drawn in the one stated, and does that match routine practice?",
          facts: [p.id, p.attribute, m.access, m.closedSystem, m.openClass],
        }),
      );
    }

    // A7: a bag sample that is not mixed first.
    if (isBagSample(p) && m.bag?.mixedFirst === false) {
      out.push(
        finding({
          key: `A7:${p.id}`,
          checkId: "A7",
          subjects: [p.id],
          states: `${nameOf(p)} is drawn from a bag or hold vessel. The plan says the bag is not mixed first${trim(m.bag.drawFrom) ? `; it is drawn from ${trim(m.bag.drawFrom)}` : ""}.`,
          why: "Liquid in an unmixed bag can differ from top to bottom, so where the sample is drawn decides what it shows.",
          question: "Is the bag homogeneous at the point of the draw, and what shows that?",
          facts: [p.id, p.attribute, m.bag.fromBag, m.access, p.flow?.holdId, m.bag.mixedFirst, m.bag.drawFrom],
        }),
      );
    }
  }
  return out;
}

/** A8: samples with no "how taken" answer cannot be looked at by A1 to A7. One summary finding. */
function methodUnstated(plan: SamplingPlan): ReviewFinding[] {
  const missing = plan.points.filter((p) => !p.method?.access);
  if (missing.length === 0) return [];
  const ids = missing.map((p) => p.id);
  return [
    finding({
      key: "A8:plan",
      checkId: "A8",
      subjects: ids,
      states: `${missing.length} of ${plan.points.length} ${missing.length === 1 ? "sample has" : "samples have"} no answer for how the sample is taken: ${list(ids)}.`,
      why: "Ports, flushing, mixing and open draws can only be reviewed for samples whose way of being taken is written down.",
      question: "Should these samples say how they are taken, so the other checks can look at them?",
      facts: ids,
    }),
  ];
}

/** A5: equipment used only to take samples (plan-level question, then the items with unknowns). */
function studyEquipment(plan: SamplingPlan): ReviewFinding[] {
  const se = plan.designReview?.studyEquipment;
  const out: ReviewFinding[] = [];
  if (plan.points.length === 0) return out;
  if (se?.used === undefined) {
    out.push(
      finding({
        key: "A5:plan",
        checkId: "A5",
        subjects: [],
        states: "The plan does not say whether any equipment is used only to take PPQ samples.",
        why: "Extra bags, manifolds, tubing sets, pumps or connectors used only for sampling are not part of the commercial process, and PPQ may not show what routine production does.",
        question: "Is any equipment used only to take PPQ samples (extra bags, manifolds, tubing sets, pumps, sampling devices, connectors)?",
        facts: ["unanswered"],
      }),
    );
    return out;
  }
  if (!se.used) return out;
  for (const item of se.items) {
    const unknown = unknownOf(item);
    if (unknown.length === 0) continue;
    out.push(
      finding({
        key: `A5:${item.id}`,
        checkId: "A5",
        subjects: [...(item.stepId ? [item.stepId] : []), ...(item.pointIds ?? [])],
        states: `${item.id}: "${trim(item.what) || "(not described)"}" is listed as used only for sampling. Not stated: ${list(unknown)}.`,
        why: "Equipment used only for PPQ sampling should be shown to be qualified, absent from or present in the commercial process on purpose, and removed or not afterwards.",
        question: `For ${trim(item.what) ? `"${trim(item.what)}"` : item.id}: ${unknown.map((u) => ASK[u]).join(" ")}`,
        facts: [item],
      }),
    );
  }
  return out;
}
const ASK: Record<string, string> = {
  "which step or samples it is used for": "Which step and which samples is it used for?",
  "whether it is in the commercial process": "Is it in the commercial process?",
  "whether it is qualified": "Is it qualified?",
  "whether it is removed afterwards": "Is it removed afterwards?",
};
function unknownOf(item: StudyEquipmentItem): string[] {
  const u: string[] = [];
  if (!item.stepId && !(item.pointIds ?? []).length) u.push("which step or samples it is used for");
  if (item.inCommercialProcess === undefined) u.push("whether it is in the commercial process");
  if (item.qualified === undefined) u.push("whether it is qualified");
  if (item.removedAfter === undefined) u.push("whether it is removed afterwards");
  return u;
}

// ------------------------------------------------------------------ group B: where the samples sit

/**
 * Where the sterile filtration sits in a list of unit operations (plan steps or the sections of a batch record), -1 when there is none.
 * The plan's B1 reads the last such step (the final filter), the batch record's check S5 the first section: one place knows the key.
 */
export function sterileFilterIndex(unitOps: readonly (string | undefined)[], which: "first" | "last"): number {
  return which === "first" ? unitOps.indexOf(SF) : unitOps.lastIndexOf(SF);
}

const stepIndex = (plan: SamplingPlan, step: PlanStep | undefined) => (step ? plan.steps.findIndex((s) => s.id === step.id) : -1);

/**
 * B1: a sample taken on the sterile side of the final filter (after the sterile filtration, on a step between it and filling, or on a
 * hold of the filtered bulk) that is not taken from filled units. The batch record's check S5 is the same question for a record; the
 * facts are found here once. Steps are recognised by their catalog key ("sterile_filtration", "aseptic_filling"); a custom step is not.
 */
export function samplesAfterSterileFilter(plan: SamplingPlan): SamplingPoint[] {
  const sf = sterileFilterIndex(plan.steps.map((s) => s.unitOp), "last");
  if (sf < 0) return [];
  const filling = plan.steps.findIndex((s, i) => i > sf && s.unitOp === FILLING);
  const end = filling < 0 ? sf : filling - 1;
  return plan.points.filter((p) => {
    const step = stepOf(plan, p);
    if (!step || fromFilledUnits(p)) return false;
    const i = stepIndex(plan, step);
    if (i === sf) return p.flow?.at === "after" || !!p.flow?.holdId;
    return i > sf && i <= end;
  });
}

function afterSterileFilter(plan: SamplingPlan): ReviewFinding[] {
  return samplesAfterSterileFilter(plan).map((p) =>
    finding({
      key: `B1:${p.id}`,
      checkId: "B1",
      subjects: [p.id, ...(p.flow ? [p.flow.stepId] : [])],
      states: `${nameOf(p)} is placed at ${placementText(plan, p)}, which is after the sterile filtration, and is not taken from filled units.`,
      why: "A volume drawn from the sterile side of the final filter is an aseptic withdrawal: it can put the sterility of the filtered bulk at risk and it leaves the product.",
      question: "How is the sterility of the filtered bulk protected when this sample is drawn, and could filled units be used instead?",
      facts: [p.id, p.attribute, p.type, p.unitOp, p.flow, p.materialType, p.container],
    }),
  );
}

/**
 * B2: a bioburden-reduction or sterile filtration step with no bioburden sample right before it. "Right before" = a bioburden sample on the
 * filter step before the step, or on the step just ahead of it (not before that step). When a bioburden sample exists but its place is not
 * set, the check stays silent (B4 says so): it does not guess.
 */
/** True when a bioburden sample's step or position is not set: placement checks cannot tell where it sits, so they stay silent (B4 says so). */
const hasUnplacedBioburden = (plan: SamplingPlan, bio: SamplingPoint[]) => bio.some((p) => !stepOf(plan, p) || (p.flow?.at === undefined && !p.flow?.holdId));

/**
 * The bioburden samples "right before" the step at index i: one on the step itself at its start ("before"), or on the step just ahead of it at
 * any position but its start (a sample at the end of, or a hold after, the previous step is what reaches this step). Shared by B2 and D2 so
 * both say the same thing about the same plan.
 */
function bioburdenBefore(plan: SamplingPlan, i: number, bio: SamplingPoint[]): SamplingPoint[] {
  const step = plan.steps[i];
  const prev = plan.steps[i - 1];
  if (!step) return [];
  return bio.filter((p) => {
    const at = p.flow;
    if (!at) return false;
    if (at.stepId === step.id) return at.at === "before";
    return prev !== undefined && at.stepId === prev.id && at.at !== "before";
  });
}

function filterBioburden(plan: SamplingPlan): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const bio = plan.points.filter(isBioburdenPoint);
  if (hasUnplacedBioburden(plan, bio)) return out;
  plan.steps.forEach((step, i) => {
    if (step.unitOp !== BBR && step.unitOp !== SF) return;
    const prev = plan.steps[i - 1];
    if (bioburdenBefore(plan, i, bio).length > 0) return;
    out.push(
      finding({
        key: `B2:${step.id}`,
        checkId: "B2",
        subjects: [step.id],
        states: `${step.label} has no bioburden sample placed right before it${prev ? ` (checked at the start of the step and at ${prev.label})` : ""}.`,
        why: "A filter is only shown to cope with the microbial load that reaches it if that load is measured just before it.",
        question: "Is the bioburden before this filter measured somewhere else, or should a bioburden sample be added before it?",
        facts: [step.id, step.unitOp, prev?.id, bio.map((p) => [p.id, p.flow])],
      }),
    );
  });
  return out;
}

/** B3: process steps of the plan with no sample at all (one summary). Silent while the plan has no samples. */
function stepsWithoutSamples(plan: SamplingPlan): ReviewFinding[] {
  if (plan.points.length === 0) return [];
  const bare = plan.steps.filter((s) => !plan.points.some((p) => p.flow?.stepId === s.id));
  if (bare.length === 0) return [];
  return [
    finding({
      key: "B3:plan",
      checkId: "B3",
      subjects: bare.map((s) => s.id),
      states: `${bare.length} of ${plan.steps.length} process ${bare.length === 1 ? "step has" : "steps have"} no sample: ${list(bare.map((s) => s.label))}.`,
      why: "A step with no sample is a step PPQ shows nothing about, which is sometimes intended and sometimes forgotten.",
      question: "Is it intended that these steps have no samples?",
      facts: bare.map((s) => [s.id, s.label]),
    }),
  ];
}

/** B4: samples not on the diagram, or on a step with no position, so B1 and B2 cannot look at them (one summary). */
function notPlaced(plan: SamplingPlan): ReviewFinding[] {
  const loose = plan.points.filter((p) => !stepOf(plan, p) || (p.flow?.at === undefined && !p.flow?.holdId));
  if (loose.length === 0) return [];
  const ids = loose.map((p) => p.id);
  return [
    finding({
      key: "B4:plan",
      checkId: "B4",
      subjects: ids,
      states: `${loose.length} of ${plan.points.length} ${loose.length === 1 ? "sample is" : "samples are"} not placed on a step or have no position on it: ${list(ids)}.`,
      why: "Where a sample sits decides what it shows, and the placement checks can only look at samples that are placed.",
      question: "Should these samples be placed on a step, with a position, so the placement checks can look at them?",
      facts: loose.map((p) => [p.id, p.flow]),
    }),
  ];
}

/** B5: failure modes of the project's risk assessment on a step of this plan that link to no sample of the plan. */
function riskWithoutSample(plan: SamplingPlan, ctx: ReviewContext | undefined): ReviewFinding[] {
  const items = ctx?.riskItems ?? [];
  if (items.length === 0) return [];
  // The risk assessment stores a link as "SPL-001.SP-009" (point ids are only unique inside a plan), a plan's own points are "SP-009". Both
  // spellings count, and a link to another plan's point does not: otherwise a covered failure mode is reported as bare, and a review that
  // raises false alarms stops being trusted. The link lives only on the risk side (a sample does not list risks), so that is the side read.
  const known = new Set(plan.points.flatMap((p) => [p.id, `${plan.id}.${p.id}`]));
  const out: ReviewFinding[] = [];
  for (const step of plan.steps) {
    const here = items.filter((it) => (step.unitOp && it.unitOp === step.unitOp) || (!step.unitOp && !it.unitOp && it.label.trim().toLowerCase() === step.label.trim().toLowerCase()));
    const bare = here.filter((it) => !it.pointIds.some((id) => known.has(id)));
    if (bare.length === 0) continue;
    out.push(
      finding({
        key: `B5:${step.id}`,
        checkId: "B5",
        subjects: [step.id],
        states: `${bare.length} failure ${bare.length === 1 ? "mode" : "modes"} of the risk assessment at ${step.label} ${bare.length === 1 ? "has" : "have"} no linked sample: ${bare.map((b) => `${b.id} "${trim(b.failureMode)}"`).join("; ")}.`,
        why: "A failure mode that nothing in PPQ can detect is a risk PPQ does not show on the batches it covers.",
        question: "Is detection of these failure modes covered elsewhere, or should a sample be linked to them?",
        facts: [step.id, bare.map((b) => [b.id, b.failureMode])],
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------ group C: how much is taken, and in what order

const pct = (n: number) => `${Math.round(n * 10) / 10} %`;

/**
 * C1: the liquid the plan takes from each batch (samples plus flushed liquid), smallest batch first. Samples are small next to a commercial
 * batch but not next to a small bracketed PPQ batch, and flushed liquid is lost as well. The numbers come from volumeTakenPerBatch, the
 * same arithmetic as the batch record's volume tracker. With no "flag above __ %" set the finding shows the numbers once to confirm; with it
 * set the finding is raised only above it, or when something is missing so the comparison cannot be made (never a guess).
 */
function volumeTaken(plan: SamplingPlan): ReviewFinding[] {
  const rows = volumeTakenPerBatch(plan);
  if (!rows.some((r) => r.sampleMl + r.flushMl > 0)) return [];
  const limit = plan.designReview?.volumeFlagPercent;
  const total = (r: (typeof rows)[number]) => r.sampleMl + r.flushMl;
  const noSize = (r: (typeof rows)[number]) => r.percent === undefined;
  const missing = [...new Set(rows.flatMap((r) => r.missing))];
  const over = rows.filter((r) => limit !== undefined && r.percent !== undefined && r.percent > limit);
  if (limit !== undefined && over.length === 0 && !rows.some(noSize) && missing.length === 0) return [];
  const line = (r: (typeof rows)[number]) => {
    const size = r.batchSizeMl !== undefined ? `, batch size ${r.batchSizeText}` : r.batchSizeText ? `, batch size ${r.batchSizeText} (not in litres, so not compared)` : ", no batch size stated";
    const flush = r.flushMl > 0 ? ` and ${mlText(r.flushMl)} flushed` : "";
    return `${r.label}${size}: ${mlText(r.sampleMl)} of samples${flush}, ${mlText(total(r))} in all${r.percent !== undefined ? ` (${pct(r.percent)} of the batch)` : ""}`;
  };
  const flagged = limit !== undefined ? ` The plan asks to be flagged above ${limit} %.` : "";
  return [
    finding({
      key: "C1:plan",
      checkId: "C1",
      subjects: [...new Set(rows.flatMap((r) => r.pointIds))],
      states: `Per batch the plan takes ${rows.map(line).join("; ")}.${flagged}${missing.length ? ` Not counted because not stated: ${list(missing)}, so these are lower figures.` : ""}`,
      why: "Liquid drawn as samples and flushed away leaves the batch, and a small PPQ batch may have little to spare for filling.",
      question: limit !== undefined && over.length ? `Is it acceptable that sampling takes more than ${limit} % of ${list(over.map((r) => r.label))}?` : "Is this much liquid taken from each batch acceptable, and is enough left to fill the batch as planned?",
      facts: [limit, rows.map((r) => [r.batchId, r.batchSizeMl, r.sampleMl, r.flushMl, r.pointIds]), missing],
    }),
  ];
}

/** A sample that reports microbial quality (bioburden, endotoxin, sterility, "micro..."). Case-insensitive, like the other word matches. */
const MICROBIAL = /bio[\s-]?burden|\bcfu\b|endotoxin|sterility|\bmicro/i;
export const isMicrobialPoint = (p: SamplingPoint): boolean => MICROBIAL.test(pointText(p));

/** The groups of points that draw from one shared port: the shared lists joined up, so A-names-B and B-names-C are one port. Single points are dropped. */
function sharedPortGroups(plan: SamplingPlan): SamplingPoint[][] {
  const byId = new Map(plan.points.map((p) => [p.id, p]));
  const parent = new Map<string, string>();
  const root = (x: string): string => (parent.get(x) === undefined || parent.get(x) === x ? x : root(parent.get(x)!));
  for (const p of plan.points) {
    if (p.method?.access !== "shared_port") continue;
    parent.set(p.id, parent.get(p.id) ?? p.id);
    for (const o of p.method.shared?.pointIds ?? []) {
      if (!byId.has(o)) continue;
      parent.set(o, parent.get(o) ?? o);
      parent.set(root(o), root(p.id));
    }
  }
  const groups = new Map<string, SamplingPoint[]>();
  for (const id of parent.keys()) groups.set(root(id), [...(groups.get(root(id)) ?? []), byId.get(id)!]);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.id.localeCompare(b.id)));
}

/** Where a point is named in the typed order: its id, or for a microbial sample also the microbial word. Undefined when it is not named. */
function orderPosition(order: string, p: SamplingPoint): number | undefined {
  const at = [order.indexOf(p.id)];
  if (isMicrobialPoint(p)) at.push(order.search(MICROBIAL));
  const found = at.filter((n) => n >= 0);
  return found.length ? Math.min(...found) : undefined;
}

/**
 * C2: on a shared port a microbial sample drawn after other samples can pick up what they leave in the port. The order is the typed text of
 * the samples on the port ("SP-003, then SP-001"); it is read by the sample ids, or the microbial word for the microbial sample. If no
 * order is written, or it names no microbial sample, the finding says the order cannot be read: it does not guess.
 */
function drawOrder(plan: SamplingPlan): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const group of sharedPortGroups(plan)) {
    const micro = group.filter(isMicrobialPoint);
    if (micro.length === 0) continue;
    const ids = group.map((p) => p.id);
    const order = group.map((p) => trim(p.method?.shared?.order)).filter(Boolean);
    const text = order.join(" ; ");
    const positions = group.map((p) => ({ p, at: orderPosition(text, p) })).filter((x): x is { p: SamplingPoint; at: number } => x.at !== undefined);
    const firstOne = positions.sort((a, b) => a.at - b.at)[0];
    const readable = firstOne !== undefined && positions.some((x) => isMicrobialPoint(x.p));
    if (readable && isMicrobialPoint(firstOne.p)) continue;
    const common = { key: `C2:${ids.join("+")}`, checkId: "C2" as const, subjects: ids, why: "A port that has drawn other samples can carry liquid into the next one, and a microbial result is the one that carry-over spoils most.", facts: [ids, order] };
    out.push(
      finding(
        readable
          ? { ...common, states: `${list(ids)} are drawn from one shared port. The order written is "${order.join("; ")}", which puts ${nameOf(firstOne.p)} before the microbial sample ${list(micro.map(nameOf))}.`, question: "Is the microbial sample drawn first on this port, or do the order and the flushing protect its result?" }
          : { ...common, states: `${list(ids)} are drawn from one shared port, and ${list(micro.map(nameOf))} ${micro.length === 1 ? "is a microbial sample" : "are microbial samples"}. ${order.length ? `The order written is "${order.join("; ")}", which does not name ${micro.length === 1 ? "it" : "them"}` : "No order is written"}, so the draw order cannot be read.`, question: "In what order are these samples drawn, and is the microbial sample drawn first or protected by the flushing?" },
      ),
    );
  }
  return out;
}

// ------------------------------------------------------------------ group D: what the plan may have left out

/** The process the plan is compared with: the project's TRD steps, else the Scope's included unit operations. */
export function reviewProcess(ctx: ReviewContext | undefined): { source: "trd" | "scope"; steps: ReviewProcessStep[] } | undefined {
  if (ctx?.trdSteps?.length) return { source: "trd", steps: ctx.trdSteps };
  if (ctx?.scopeSteps?.length) return { source: "scope", steps: ctx.scopeSteps };
  return undefined;
}

const SOURCE_WORDS = { trd: "the TRD", scope: "the scope of the project" } as const;

function stepNotInPlan(plan: SamplingPlan, ctx: ReviewContext | undefined): ReviewFinding[] {
  const proc = reviewProcess(ctx);
  if (!proc) return [];
  const planOps = new Set(plan.steps.flatMap((s) => (s.unitOp ? [s.unitOp] : [])));
  const planLabels = new Set(plan.steps.map((s) => s.label.trim().toLowerCase()));
  const out: ReviewFinding[] = [];
  const seen = new Set<string>();
  for (const s of proc.steps) {
    const id = s.unitOp ?? `custom:${s.label.trim().toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (s.unitOp ? planOps.has(s.unitOp) : planLabels.has(s.label.trim().toLowerCase())) continue;
    out.push(
      finding({
        key: `D1:${id}`,
        checkId: "D1",
        subjects: [s.unitOp ?? s.label],
        states: `${SOURCE_WORDS[proc.source][0]!.toUpperCase()}${SOURCE_WORDS[proc.source].slice(1)} lists the step "${s.label}", and the plan has no step for it.`,
        why: "A plan written without the full process can leave out a whole step, and every other check only looks at what is in the plan.",
        question: `Does "${s.label}" need sampling in PPQ, or is it intentionally outside this plan?`,
        facts: [proc.source, s.unitOp, s.label],
      }),
    );
  }
  return out;
}

/**
 * A catalog entry for a test done on the FILTER and written in the batch record (integrity before and after use). Nothing is drawn, so it is
 * not a sample: "no sample covers it" would be a false alarm on every plan. D2 asks whether the batch record has the step instead (the
 * simpler of the two honest options: the project holds no structured integrity-test step to match against).
 */
const isRecordedTest = (e: ReviewExpectedStudy) => e.type === "filter_study" && /integrity/i.test(e.attribute);

/**
 * D2: catalog entries marked `expected` for a unit operation of the plan (or of D1's process) that nothing in the plan covers. The marked
 * subset is a starting list (the catalog's `expected: true`); the fingerprint holds the marks, so changing them says "look again".
 *
 * A plan point covers an entry when
 *  1. it records that catalog key as its origin (a suggestion that was added), or
 *  2. it sits on that unit operation with the same study type, or
 *  3. the entry is a bioburden test (named so in its key or attribute) and a bioburden sample sits right before that step. This is the same
 *     "right before" rule as B2. A team that wrote its own sample ("bioburden before the BBR filter", 100 mL, 10 CFU/100 mL) did cover the
 *     study, and a name or step that differs from the catalog's must not read as missing.
 * A bioburden sample whose place is not set makes the bioburden entries stay silent: the tool does not guess where it sits.
 */
function expectedMissing(plan: SamplingPlan, ctx: ReviewContext | undefined): ReviewFinding[] {
  const expected = ctx?.expected ?? [];
  if (expected.length === 0) return [];
  const ops = new Set<string>([...plan.steps.flatMap((s) => (s.unitOp ? [s.unitOp] : [])), ...(reviewProcess(ctx)?.steps.flatMap((s) => (s.unitOp ? [s.unitOp] : [])) ?? [])]);
  const bio = plan.points.filter(isBioburdenPoint);
  const bioUnplaced = hasUnplacedBioburden(plan, bio);
  const out: ReviewFinding[] = [];
  for (const e of expected) {
    if (!ops.has(e.uo)) continue;
    const covered = plan.points.some((p) => (p.origin.kind === "seeded" && (p.origin.suggestionKey === e.key || p.origin.suggestionKey === `cat:${e.key}`)) || (p.unitOp === e.uo && p.type === e.type));
    if (covered) continue;
    const stepIdx = plan.steps.findIndex((s) => s.unitOp === e.uo);
    if (BIOBURDEN.test(`${e.key} ${e.attribute}`) && (bioUnplaced || (stepIdx >= 0 && bioburdenBefore(plan, stepIdx, bio).length > 0))) continue;
    const stepLabel = plan.steps.find((s) => s.unitOp === e.uo)?.label ?? reviewProcess(ctx)?.steps.find((s) => s.unitOp === e.uo)?.label ?? e.uo;
    const recorded = isRecordedTest(e);
    out.push(
      finding({
        key: `D2:${e.key}`,
        checkId: "D2",
        subjects: [e.uo],
        states: recorded
          ? `The list of expected studies has "${e.attribute}" for ${stepLabel}. It is a test written in the batch record, not a sample.`
          : `The list of expected studies has "${e.attribute}" for ${stepLabel}, and no sample of the plan covers it.`,
        why: recorded ? "A filter is only shown to have worked if its integrity was tested around the use, and that test is a step of the batch record." : "A typical fill/finish PPQ covers this, and a plan written without a procedure can omit it without anyone noticing.",
        question: recorded ? `Is "${e.attribute}" a step of the batch record for ${stepLabel}?` : `Should "${e.attribute}" be added to the plan, or is there a reason it is not needed?`,
        facts: [e.key, e.uo, e.type, e.attribute, true],
      }),
    );
  }
  return out;
}

// ------------------------------------------------------------------ the whole review

const ORDER = new Map<string, number>(REVIEW_CHECKS.map((c, i) => [c.id, i]));

/**
 * Every question the checks raise for the plan, in group then check order. A check the team switched off for this plan raises nothing.
 * The stored answers are not read here (see designReviewView).
 */
export function designReview(plan: SamplingPlan, ctx?: ReviewContext): ReviewFinding[] {
  const off = plan.designReview?.off ?? {};
  const all = [...studyEquipment(plan), ...methodChecks(plan), ...methodUnstated(plan), ...afterSterileFilter(plan), ...filterBioburden(plan), ...stepsWithoutSamples(plan), ...notPlaced(plan), ...riskWithoutSample(plan, ctx), ...volumeTaken(plan), ...drawOrder(plan), ...stepNotInPlan(plan, ctx), ...expectedMissing(plan, ctx)];
  return all
    .filter((f) => !(f.checkId in off))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (ORDER.get(a.f.checkId)! - ORDER.get(b.f.checkId)!) || a.i - b.i)
    .map((x) => (ppqStage(ctx?.stage) ? x.f : { ...x.f, states: stageWords(x.f.states), why: stageWords(x.f.why), question: stageWords(x.f.question) }));
}

export type ReviewState = "unanswered" | "answered" | "look_again";
export interface ReviewItem {
  finding: ReviewFinding;
  state: ReviewState;
  answer?: ReviewAnswer;
}
export interface ReviewOffCheck {
  checkId: ReviewCheckId;
  group: ReviewGroup;
  title: string;
  /** "" when no reason was given. */
  reason: string;
}
export interface DesignReviewView {
  items: ReviewItem[];
  groups: { group: ReviewGroup; title: string; items: ReviewItem[] }[];
  off: ReviewOffCheck[];
  /** All questions now raised. */
  questions: number;
  /** Questions with no answer. */
  unanswered: number;
  /** Answered questions whose facts changed since: the team should look again. */
  lookAgain: number;
}

/**
 * The questions with the team's stored answers: an answer whose fingerprint still matches is "answered"; one whose facts changed is kept and
 * shown "look again"; an answer whose finding no longer arises is ignored (and stays in the plan data, in case the finding returns).
 */
export function designReviewView(plan: SamplingPlan, ctx?: ReviewContext): DesignReviewView {
  const answers = plan.designReview?.answers ?? {};
  const items = designReview(plan, ctx).map((finding): ReviewItem => {
    const answer = answers[finding.key];
    if (!answer) return { finding, state: "unanswered" };
    return { finding, answer, state: answer.factsFingerprint === finding.factsFingerprint ? "answered" : "look_again" };
  });
  const groups = (["A", "B", "C", "D"] as const).map((group) => ({ group, title: REVIEW_GROUP_TITLE[group], items: items.filter((i) => i.finding.group === group) })).filter((g) => g.items.length > 0);
  const off = Object.entries(plan.designReview?.off ?? {}).flatMap(([id, reason]) => {
    const c = reviewCheck(id);
    return c ? [{ checkId: c.id, group: c.group, title: c.title, reason }] : [];
  });
  off.sort((a, b) => (ORDER.get(a.checkId)! - ORDER.get(b.checkId)!));
  return { items, groups, off, questions: items.length, unanswered: items.filter((i) => i.state === "unanswered").length, lookAgain: items.filter((i) => i.state === "look_again").length };
}

/**
 * One phrase for the Overview tab and the plan export, worded like an open item: "15 design review questions not answered yet" (with
 * ", 1 to look at again" when facts changed). It is kept apart from the plan's own open items on purpose: those are entries missing from the
 * plan, these are the team's answers to questions, and unanswered ones are still open work that must not be invisible.
 */
export function designReviewLine(v: DesignReviewView): string {
  if (v.questions === 0) return "Design review: no questions";
  const again = v.lookAgain ? `${v.lookAgain} to look at again` : "";
  if (v.unanswered === 0) return again ? `Design review: ${again}` : `Design review: all ${v.questions} ${v.questions === 1 ? "question" : "questions"} answered`;
  return `${v.unanswered} design review ${v.unanswered === 1 ? "question" : "questions"} not answered yet${again ? `, ${again}` : ""}`;
}
