import { newId, type Actor, type Project, type StageReview, type VersionEntry } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { applyAnswer } from "./interview";
import type { QuestionInstance } from "./sequencer";
import { PROGRAM_STAGES, projectStage, STAGE_ADAPTS, STAGE_BINDS, STAGE_QUESTION_ID, STAGE_SHORT, type ProgramStage } from "./stage";
import { markReplaced, planStageReview, replacedRecord } from "./stage-review";
import { historyOf, nextVersionNumber, REASON_MAX, REASON_MIN, saveBeforeChange, saveStageChangeVersion, versionLabelOf } from "./version-history";

/** What a change of the project stage did, for the summary shown after it. */
export interface ProjectStageChange {
  project: Project;
  /** False when the stage was already this one and no check was waiting: nothing was written. */
  changed: boolean;
  /** What adapts to the stage (the summary lists these). */
  adapts: readonly string[];
}

/**
 * Sets the PROJECT stage: the receiving site's answer to the stage question. Every editor (the interview, the header chip, Home and the
 * TRD form) calls this one function, so the value, its provenance and its change-log record are the same wherever it was set, and the
 * stage check is cleared the same way (applyAnswer does that). Choosing the stage the project already has writes nothing, unless a
 * check is waiting: then it is written again so that the person's confirmation is on record and the check clears.
 */
export function setProjectStage(project: Project, content: ContentBundle, stage: ProgramStage, actor: Actor): ProjectStageChange {
  const question = content.questionById.get(STAGE_QUESTION_ID);
  const section = question ? content.sectionById.get(question.section) : undefined;
  if (!question || !section) throw new Error("The stage question is missing from the content");
  if (projectStage(project) === stage && !project.meta.stageCheck) return { project, changed: false, adapts: [] };
  const inst: QuestionInstance = { key: `${question.id}@target`, question, side: "target", section, depth: 0 };
  return { project: applyAnswer(project, content, inst, { kind: "value", value: stage }, actor), changed: true, adapts: STAGE_ADAPTS };
}

// ------------------------------------------------------------------ the stage change with its version and review (STAGEUP spec, section 5)

/** A problem with a stage change that the person can fix; the message is shown as it is. */
export class StageChangeError extends Error {}

/** What a stage change did. `entry` and `review` exist only when the stage really changed. */
export interface StageChangeResult extends ProjectStageChange {
  /** The major version saved by the change (the project right after it). */
  entry?: VersionEntry;
  /** The minor version saved first because there were edits since the last version. */
  autoEntry?: VersionEntry;
  review?: StageReview;
}

/**
 * Changes the project stage the way every editor now does: a short reason, a MAJOR version of the project right after the change (v1 to
 * v2), and a stage review listing what the new stage changes in each document. Async because a version is compressed. Pure: it returns the
 * new project and the store applies it in one update, so autosave sees one change and a refusal leaves the project untouched.
 *
 *  1. Choosing the stage the project already has saves no version and asks no reason; it only clears a waiting stage check (setProjectStage).
 *  2. A reason is required, unless the stage was not set before (then it is "first set" and the reason is optional).
 *  3. When the working copy differs from the last version, a minor "before-change" version is saved first, so no edit is missing.
 *  4. setProjectStage writes the answer and clears the check, then the major version is saved WITH the stage_change record inside it.
 *  5. The review is built (see stage-review.ts) and stored with the version. Going back a stage is allowed with a reason and is NOT a
 *     restore: no data is rolled back, only the wording follows the stage. For old data, open the old version.
 */
export async function changeProjectStage(project: Project, content: ContentBundle, to: ProgramStage, actor: Actor, reason: string): Promise<StageChangeResult> {
  const from = projectStage(project);
  if (from === to) return setProjectStage(project, content, to, actor);

  const why = reason.trim();
  if (from !== undefined && !why) throw new StageChangeError("Say why the project stage is changing.");
  if (why && why.length < REASON_MIN) throw new StageChangeError(`Say why the project stage is changing (at least ${REASON_MIN} characters).`);
  if (why.length > REASON_MAX) throw new StageChangeError(`The reason can be at most ${REASON_MAX} characters.`);

  const withAuto = await saveBeforeChange(project, actor, STAGE_SHORT[to]);
  const autoEntry = withAuto === project ? undefined : historyOf(withAuto).entries.at(-1);

  const inner = setProjectStage(withAuto, content, to, actor);
  const direction: StageReview["direction"] = from === undefined ? "first-set" : PROGRAM_STAGES.indexOf(to) > PROGRAM_STAGES.indexOf(from) ? "forward" : "back";
  const reviewId = newId("rev");
  const plan = planStageReview(inner.project, content, from, to, reviewId);
  const next = nextVersionNumber(historyOf(inner.project), "stage-change");
  const nextLabel = versionLabelOf(next.major, next.minor);
  const directionWord = direction === "first-set" ? "first set" : direction === "back" ? "going back" : "forward";

  // The records that belong to this change are written BEFORE the version is frozen, so the version holds them and the working copy
  // does not show "unsaved changes" the moment the change is saved.
  const staged: Project = {
    ...inner.project,
    changeLog: [...inner.project.changeLog, ...plan.replaced.map((r) => replacedRecord(actor, r.item, r.sinceLabel, nextLabel))],
  };
  const saved = await saveStageChangeVersion(staged, actor, {
    fromStage: from,
    reason: why,
    makeRecord: (label) => ({
      at: actor.at,
      by: actor.name,
      action: "stage_change",
      path: STAGE_BINDS_PATH,
      detail: `${directionWord}, ${label}${why ? `, reason: ${why}` : ""}, ${plan.items.length} ${plan.items.length === 1 ? "item" : "items"} to review`,
      before: from ?? null,
      after: to,
    }),
  });
  const review: StageReview = {
    id: reviewId,
    versionId: saved.entry.id,
    versionLabel: saved.entry.label,
    ...(from ? { fromStage: from } : {}),
    toStage: to,
    direction,
    reason: why,
    at: actor.at,
    by: actor.name,
    items: plan.items,
  };
  const h = historyOf(saved.project);
  const out: Project = { ...saved.project, versionHistory: { ...h, reviews: [...markReplaced(h.reviews, plan.replaced, actor.at), review] } };
  return { project: out, changed: true, adapts: STAGE_ADAPTS, entry: saved.entry, ...(autoEntry ? { autoEntry } : {}), review };
}

const STAGE_BINDS_PATH = `target.${STAGE_BINDS}`;
