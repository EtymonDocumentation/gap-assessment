import { type Actor, type ChangeEvent, type Project, type ReviewDoc, type ReviewItem, type StageReview, type TrdPart } from "@gap/process-model";
import { sampleMethodView } from "@gap/sampling";
import type { ContentBundle } from "./content";
import { mbrPpqOnlyItems, type MbrStageItem } from "./mbr-stage";
import { leftOutSentence, ppqOnlyLeftOut, pointStageReminder, riskStageLine, samplingStageWording, trdRangeIntro } from "./stage-chain";
import { activityStageNote, isOpenReviewItem, programStage, resolveStageMarkers, STAGE_MARKER_OPEN, STAGE_SHORT, stageBasis, stageWordingFor, type ProgramStage } from "./stage";
import { partIsIn } from "./trd-writeup";

/*
 * The stage review: what to look at after the project stage changed (STAGEUP spec, section 6).
 *
 * Every item is DERIVED from the real code, never typed in: for each document the project has, the real wording functions are called for
 * the old stage and for the new stage, and an item is made only when the two results differ. So a wording that really changes always
 * shows up in the review, and a wording that does not change never does. The guard test (test/stage-review.test.ts) fails when a function
 * exported by stage-chain.ts is not used here, so a new stage-aware wording cannot be forgotten.
 *
 * The before and after texts are frozen into the review when the stage changes: editing the document later does not rewrite the review.
 * Nothing in a review changes the project, and the tool never says whether a change is acceptable: the person looks and ticks.
 */

const name = (s: ProgramStage | undefined) => (s ? STAGE_SHORT[s] : "not set");
const NO_WORDING = "No stage wording: the project stage was not set, so the plain wording applied.";
/** The product's name is not needed to see what the stage changes, so the purpose sentences are shown for "the product". */
const THE_PRODUCT = "the product";

const link: Record<ReviewDoc, string> = { gap: "/validation", trd: "/trd", sampling: "/sampling", mbr: "/mbr", risk: "/risk" };

function make(key: string, doc: ReviewDoc, title: string, before: string, after: string, check: string): ReviewItem {
  return { key, doc, title, before, after, check, link: link[doc] };
}

const partLabel = (p: TrdPart) => p.title || p.caption || p.text.slice(0, 60) || p.id;
const partTexts = (p: TrdPart): string[] => [p.text, ...(p.kind === "table" ? (p.rows ?? []).flat() : [])];

/** What the batch record leaves out at a stage: the real rule (ppqOnlyLeftOut) applied to the record's PPQ-only items. */
function mbrView(all: MbrStageItem[], stage: ProgramStage | undefined) {
  const out = ppqOnlyLeftOut(stage);
  const leftOut = out ? all.filter((i) => !i.includedAnyway) : [];
  const keptIn = out ? all.filter((i) => i.includedAnyway) : [];
  return { leftOut, keptIn, sentence: leftOut.length ? leftOutSentence(stage, leftOut.length) : "" };
}

const itemLines = (items: MbrStageItem[]) => items.map((i) => `- ${i.where}: ${i.text}`);

/**
 * The review items for a change of the project stage, in document order (gap assessment, TRD, sampling plan, batch record, risk). Only
 * documents the project has get items. `from` or `to` may be undefined (stage not set).
 */
export function stageReviewItems(project: Project, content: ContentBundle, from: ProgramStage | undefined, to: ProgramStage | undefined): ReviewItem[] {
  const items: ReviewItem[] = [];

  // --- Gap assessment (stage never counts as a gap: R-SITE-INFO stays informational)
  const source = programStage(project, "source");
  const w0 = stageWordingFor(source, from);
  const w1 = stageWordingFor(source, to);
  const g1 = [stageBasis(w0).targetPoint, stageBasis(w1).targetPoint] as const;
  if (g1[0] !== g1[1]) items.push(make("G1", "gap", "Validation expectations", g1[0], g1[1], "Confirm the expected PPQ work with QA."));
  const notes = content.catalog.activities
    .map((a) => ({ label: a.label, b: activityStageNote(a.key, w0), a: activityStageNote(a.key, w1) }))
    .filter((n) => n.b !== n.a);
  if (notes.length) {
    items.push(
      make(
        "G2",
        "gap",
        "Activity notes",
        notes.map((n) => `${n.label}: ${n.b ?? "no stage note"}`).join("\n"),
        notes.map((n) => `${n.label}: ${n.a ?? "no stage note"}`).join("\n"),
        "Read each changed note against the gap table.",
      ),
    );
  }

  // --- TRD
  const docs = project.trd.documents;
  for (const d of docs) {
    const of = docs.length > 1 ? ` (${d.id})` : "";
    const r0 = trdRangeIntro(from);
    const r1 = trdRangeIntro(to);
    if (r0 !== r1) {
      items.push(
        make(
          `T1@${d.id}`,
          "trd",
          `How the ranges are described${of}`,
          r0 ?? NO_WORDING,
          r1 ?? NO_WORDING,
          `Look at every hold time and time limit: until PPQ shows it, it reads "more than N h", not a validated limit.`,
        ),
      );
    }
    for (const w of d.writeups ?? []) {
      for (const p of w.parts) {
        // An optional part the author never switched follows the stage. One the author switched keeps their choice, so it is not an item.
        if (p.optional && p.included === undefined) {
          const in0 = partIsIn(p, from);
          const in1 = partIsIn(p, to);
          if (in0 !== in1) {
            const word = (v: boolean) => (v ? "In the write-up" : "Left out of the write-up");
            items.push(make(`T2@${d.id}.${w.id}.${p.id}`, "trd", `Optional part: ${partLabel(p)}${of}`, word(in0), word(in1), "Keep or switch it with the part's own switch."));
          }
        }
        // Text with a {{@stage ...}} marker reads differently at the two stages (only parts that are in the document at either stage).
        if ((partIsIn(p, from) || partIsIn(p, to)) && partTexts(p).some((t) => t.includes(STAGE_MARKER_OPEN))) {
          const pairs = partTexts(p)
            .filter((t) => t.includes(STAGE_MARKER_OPEN))
            .map((t) => [resolveStageMarkers(t, from), resolveStageMarkers(t, to)] as const)
            .filter(([x, y]) => x !== y);
          if (pairs.length) {
            items.push(make(`T3@${d.id}.${w.id}.${p.id}`, "trd", `Stage wording in the write-up "${w.title}"${of}`, pairs.map((x) => x[0]).join("\n\n"), pairs.map((x) => x[1]).join("\n\n"), "Read the sentence in the write-up."));
          }
        }
      }
    }
  }

  // --- Sampling plan (one set per plan)
  const sw0 = samplingStageWording(from);
  const sw1 = samplingStageWording(to);
  const plans = project.sampling.plans;
  for (const plan of plans) {
    const of = plans.length > 1 ? ` (${plan.id})` : "";
    if (sw0.title !== sw1.title || sw0.purpose(THE_PRODUCT) !== sw1.purpose(THE_PRODUCT)) {
      items.push(make(`P1@${plan.id}`, "sampling", `Title and purpose${of}`, `${sw0.title}\n${sw0.purpose(THE_PRODUCT)}`, `${sw1.title}\n${sw1.purpose(THE_PRODUCT)}`, "Is this still the plan you mean?"));
    }
    if (sw0.batchesTitle !== sw1.batchesTitle || sw0.ppqDesign !== sw1.ppqDesign) {
      const text = (s: typeof sw0) =>
        `Section "${s.batchesTitle}". ${s.ppqDesign ? "The smallest, middle and largest batch size is part of this plan's PPQ design." : "The smallest, middle and largest batch size is a PPQ design only."}`;
      items.push(make(`P2@${plan.id}`, "sampling", `Batches section${of}`, text(sw0), text(sw1), "Check that the batches listed are the ones this stage needs."));
    }
    const label = (pt: { id: string; attribute: string }) => `${pt.id} ${pt.attribute}`;
    const reminders = plan.points
      .map((pt) => ({ pt, b: pointStageReminder(from, pt), a: pointStageReminder(to, pt) }))
      .filter((r) => r.b !== r.a);
    if (reminders.length) {
      items.push(
        make(
          `P3@${plan.id}`,
          "sampling",
          `Reminders on points${of}`,
          reminders.map((r) => `${label(r.pt)}: ${r.b ?? "no reminder"}`).join("\n"),
          reminders.map((r) => `${label(r.pt)}: ${r.a ?? "no reminder"}`).join("\n"),
          "Keep, change or remove each point yourself. The tool removes nothing.",
        ),
      );
    }
    const tags = plan.points
      .map((pt) => ({ pt, b: sampleMethodView(pt, from)?.studyTag, a: sampleMethodView(pt, to)?.studyTag }))
      .filter((r) => r.b !== r.a);
    if (tags.length) {
      items.push(
        make(
          `P4@${plan.id}`,
          "sampling",
          `Tags${of}`,
          tags.map((r) => `${label(r.pt)}: ${r.b ?? "no tag"}`).join("\n"),
          tags.map((r) => `${label(r.pt)}: ${r.a ?? "no tag"}`).join("\n"),
          `Check the tag on each point added only for the study ("PPQ only" or "study only").`,
        ),
      );
    }
  }

  // --- Batch record (one set per record)
  const records = project.mbr.records;
  for (const rec of records) {
    const of = records.length > 1 ? ` (${rec.id})` : "";
    const all = mbrPpqOnlyItems(project, rec);
    const v0 = mbrView(all, from);
    const v1 = mbrView(all, to);
    const ids = (xs: MbrStageItem[]) => xs.map((i) => i.id).join(",");
    if (ids(v0.leftOut) === ids(v1.leftOut) && ids(v0.keptIn) === ids(v1.keptIn)) continue;
    const text = (v: ReturnType<typeof mbrView>) =>
      [v.sentence || "No PPQ-only items are left out.", ...itemLines(v.leftOut), ...(v.keptIn.length ? [`Kept in with "Include anyway":`, ...itemLines(v.keptIn)] : [])].join("\n");
    items.push(make(`M1@${rec.id}`, "mbr", `PPQ-only items${of}`, text(v0), text(v1), `Use "Include anyway" for any item you still need.`));
  }

  // --- Risk assessment
  if (project.risk.assessments.length) {
    const b = riskStageLine(from);
    const a = riskStageLine(to);
    if (b !== a) items.push(make("R1", "risk", "Ratings and stage line", b, a, "Open the risk list and re-read each rating at the new stage; ratings are not changed by the tool."));
  }

  return items;
}

// ------------------------------------------------------------------ carry-over

/** An open item of an earlier review that a new review takes over. */
export interface ReplacedItem {
  reviewId: string;
  item: ReviewItem;
  /** The id of the new review. */
  by: string;
  /** The version label of the earlier review ("v2"): the change the item has been open since. */
  sinceLabel: string;
}

/**
 * The items of the new review, with the still-open items of earlier reviews taken over: an open item with the same key becomes ONE item in
 * the new review ("open since the change to Clinical", keeping the older "before" text so the whole journey is visible) and the old one is
 * marked replaced. Nothing closes silently: the caller logs each replacement. An open old item with no counterpart stays open where it is.
 */
export function planStageReview(
  project: Project,
  content: ContentBundle,
  from: ProgramStage | undefined,
  to: ProgramStage | undefined,
  newReviewId: string,
): { items: ReviewItem[]; replaced: ReplacedItem[] } {
  const reviews = project.versionHistory?.reviews ?? [];
  const replaced: ReplacedItem[] = [];
  const items = stageReviewItems(project, content, from, to).map((it) => {
    for (const r of [...reviews].reverse()) {
      const old = r.items.find((o) => o.key === it.key && isOpenReviewItem(o));
      if (!old) continue;
      replaced.push({ reviewId: r.id, item: old, by: newReviewId, sinceLabel: r.versionLabel });
      return { ...it, before: old.before, carried: { fromReviewId: r.id, sinceStage: r.toStage, sinceLabel: r.versionLabel } };
    }
    return it;
  });
  return { items, replaced };
}

/** Marks the replaced items in the reviews (a copy; the stored reviews are not edited in place). */
export function markReplaced(reviews: StageReview[], replaced: ReplacedItem[], at: string): StageReview[] {
  return reviews.map((r) => {
    const mine = replaced.filter((x) => x.reviewId === r.id);
    if (!mine.length) return r;
    return { ...r, items: r.items.map((i) => (mine.some((x) => x.item.key === i.key) ? { ...i, replaced: { byReviewId: mine[0]!.by, at } } : i)) };
  });
}

/** The change-log record for an item that a later review took over. */
export function replacedRecord(actor: Actor, item: ReviewItem, sinceLabel: string, byLabel: string): ChangeEvent {
  return {
    at: actor.at,
    by: actor.name,
    action: "stage_review_replaced",
    path: item.key,
    detail: `${item.title}: still open from ${sinceLabel}, carried into the review of ${byLabel}`,
  };
}

// ------------------------------------------------------------------ reading and ticking

/** Items that count in a review (those a later review took over do not). */
export const countedItems = (r: StageReview): ReviewItem[] => r.items.filter((i) => !i.replaced);

export function reviewProgress(r: StageReview): { done: number; total: number } {
  const items = countedItems(r);
  return { done: items.filter((i) => i.reviewed).length, total: items.length };
}

/** Every item still to be reviewed, over all reviews, newest review first. */
export function openReviewItems(project: Project): { review: StageReview; item: ReviewItem }[] {
  return [...(project.versionHistory?.reviews ?? [])].reverse().flatMap((review) => review.items.filter(isOpenReviewItem).map((item) => ({ review, item })));
}

/** Open items per document, for the "3 to review" counts. */
export function openReviewCount(project: Project, doc?: ReviewDoc): number {
  return openReviewItems(project).filter((x) => !doc || x.item.doc === doc).length;
}

export class StageReviewError extends Error {}

/**
 * Ticks an item "reviewed" (who and when, with an optional note), or un-ticks it. Both are logged. The tick is the free-text name of the
 * person, as everywhere in the tool: it is not a signature and approves nothing. There is deliberately no "tick everything" function:
 * reviewing means looking at each item.
 */
export function setReviewItemReviewed(project: Project, reviewId: string, itemKey: string, reviewed: boolean, actor: Actor, note = ""): Project {
  const h = project.versionHistory;
  const review = h?.reviews.find((r) => r.id === reviewId);
  const item = review?.items.find((i) => i.key === itemKey);
  if (!h || !review || !item) throw new StageReviewError("That review item is not in the project.");
  if (item.replaced) throw new StageReviewError("This item was carried into a later review. Tick it there.");
  if (!!item.reviewed === reviewed) return project;
  const by = actor.name.trim();
  if (reviewed && !by) throw new StageReviewError("Enter your name to tick an item as reviewed.");
  const text = note.trim();
  const nextItem: ReviewItem = { ...item };
  if (reviewed) nextItem.reviewed = { by, at: actor.at, ...(text ? { note: text } : {}) };
  else delete nextItem.reviewed;
  const reviews = h.reviews.map((r) => (r.id === reviewId ? { ...r, items: r.items.map((i) => (i.key === itemKey ? nextItem : i)) } : r));
  const event: ChangeEvent = {
    at: actor.at,
    by: actor.name,
    action: "stage_review_item",
    path: item.key,
    detail: `${reviewed ? "Reviewed" : "Reopened"}: ${item.title} (${review.versionLabel})${reviewed && text ? `. Note: ${text}` : ""}`,
    before: { reviewed: !reviewed },
    after: { reviewed },
  };
  return { ...project, versionHistory: { ...h, reviews }, changeLog: [...project.changeLog, event] };
}
