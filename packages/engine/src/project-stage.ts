import type { Actor, Project } from "@gap/process-model";
import type { ContentBundle } from "./content";
import { applyAnswer } from "./interview";
import type { QuestionInstance } from "./sequencer";
import { projectStage, STAGE_ADAPTS, STAGE_QUESTION_ID, type ProgramStage } from "./stage";

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
