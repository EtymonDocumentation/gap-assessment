import { STAGE_SHORT, type ProgramStage } from "./stage";

/*
 * What each project stage changes in the documents after the gap assessment (job L2): the TRD, the sampling plan, the batch record and
 * the risk assessment. Everything here is WORDING and REMINDERS: nothing is removed from saved data and nothing is blocked (a point, a
 * step or a part that a stage would normally leave out stays listed and can be included). A stage that is not established takes the
 * wider wording and the open item "Project stage not set" (see stageOpenItems).
 *
 * The tool never says that a stage makes a process validated and never decides a filing category: the project stage is the team's
 * statement of what the receiving site's next batches are, and the company's document control approves the documents.
 */

/**
 * The paragraph that opens the TRD's parameter section, by stage: what the NOR, PAR, hold times and time limits MEAN at this stage.
 * GMP reasons: a TRD written before PPQ states a hold or time limit as "more than N h" (a target), not as a validated limit; every hold
 * and time is run in every PPQ lot; the validated limit is the most conservative PPQ lot value. Undefined when the stage is not set (the
 * document then keeps its plain wording and lists the open item).
 */
export function trdRangeIntro(stage: ProgramStage | undefined): string | undefined {
  switch (stage) {
    case "development":
      return 'Project stage: Engineering. The ranges are proposed from development or sending-site data. A hold time or time limit is a target, written as "more than N h", not a validated limit.';
    case "clinical":
      return 'Project stage: Clinical. The ranges are those used to make clinical supply, which is not process-validated. They are not validated ranges of the receiving site. A hold time or time limit is written as "more than N h" until PPQ shows it.';
    case "ppq":
      return "Project stage: PPQ. The ranges are targets to be confirmed by PPQ. Until PPQ is complete, a hold time or time limit is a target to exceed (for example more than 24 h), not a validated value, and every hold and time is run in every PPQ lot. After PPQ, the proven acceptable range (PAR) of a hold time or time limit is set to the most conservative (lowest) value achieved across the PPQ lots, not to the full range tested.";
    case "commercial":
      return "Project stage: Commercial. The ranges are validated ranges. The proven acceptable range (PAR) of a hold time or time limit is the most conservative (lowest) value reached across the PPQ lots, not the full range tested.";
    default:
      return undefined;
  }
}

/** Wording of the sampling plan for a stage: its title, what it is for, and what its batch section is called. */
export interface SamplingStageWording {
  /** The document title. */
  title: string;
  /** The sentence that says which samples the plan sets out. `p` is the product name or its not-established wording. */
  purpose: (p: string) => string;
  /** Title of the section about the batches. The smallest, middle and largest batch size is a PPQ design only. */
  batchesTitle: string;
  /** What to call one batch in running text ("PPQ batch"). */
  batchWord: string;
  /** The batches the plan is for, after "during" in the page's one-line purpose ("the clinical batches"). */
  during: string;
  /** True when the PPQ design decisions (bracketing, readiness, sampling after PPQ) are the plan's own design at this stage. */
  ppqDesign: boolean;
}

const WHAT_PLAN_DOES =
  "It records the choices made by the team and the arithmetic that followed from them. It does not judge whether a choice is adequate for the process: that decision belongs to QA and statistics.";

export function samplingStageWording(stage: ProgramStage | undefined): SamplingStageWording {
  switch (stage) {
    case "development":
      return {
        title: "Engineering-run sampling plan — draft",
        purpose: (p) => `This draft plan sets out which samples are taken from which process steps during the engineering runs of ${p} at the receiving unit (RU), how many, and why. The samples are taken to learn how the process behaves: they support no release claim. ${WHAT_PLAN_DOES}`,
        batchesTitle: "Batches in scope",
        batchWord: "batch",
        during: "the engineering runs",
        ppqDesign: false,
      };
    case "clinical":
      return {
        title: "Clinical batch sampling plan — draft",
        purpose: (p) => `This draft plan sets out which samples are taken from which process steps during the clinical batches of ${p} at the receiving unit (RU), how many, and why: release testing plus the in-process controls. The process is not validated at this stage. ${WHAT_PLAN_DOES}`,
        batchesTitle: "Batches in scope",
        batchWord: "batch",
        during: "the clinical batches",
        ppqDesign: false,
      };
    case "ppq":
      return {
        title: "PPQ sampling plan — draft",
        purpose: (p) => `This draft plan sets out which samples are taken from which process steps during the process performance qualification (PPQ) of ${p} at the receiving unit (RU), how many, and why. ${WHAT_PLAN_DOES}`,
        batchesTitle: "PPQ batches",
        batchWord: "PPQ batch",
        during: "the PPQ (process performance qualification) batches",
        ppqDesign: true,
      };
    case "commercial":
      return {
        title: "Routine sampling plan — draft",
        purpose: (p) => `This draft plan sets out which samples are taken from which process steps during routine production of ${p} at the receiving unit (RU), how many, and why: routine release plus ongoing monitoring (continued process verification). ${WHAT_PLAN_DOES}`,
        batchesTitle: "Batches in scope",
        batchWord: "batch",
        during: "routine production",
        ppqDesign: false,
      };
    default:
      return {
        title: "Sampling plan — draft",
        purpose: (p) => `This draft plan sets out which samples are taken from which process steps at the receiving unit (RU) for ${p}, how many, and why. The project stage is not set, so the plan does not say which kind of batches it is for. ${WHAT_PLAN_DOES}`,
        batchesTitle: "Batches",
        batchWord: "batch",
        during: "the batches",
        ppqDesign: true,
      };
  }
}

/** Reminder text for a sampling point that does not fit the project stage, or undefined. Points are never removed by it. */
export function pointStageReminder(stage: ProgramStage | undefined, point: { type?: string | undefined; afterPpq?: string | undefined }): string | undefined {
  const ppqPoint = point.type === "ppq_enhanced" || point.afterPpq === "ppq_only";
  if (stage === "development" || stage === "clinical") {
    return ppqPoint ? `PPQ point: ${stage === "clinical" ? "clinical" : "engineering"} batches usually don't need it.` : undefined;
  }
  if (stage === "commercial") {
    if (point.afterPpq === "ppq_only") return "Not part of routine sampling.";
    if (point.afterPpq === "continues") return "Part of the routine set.";
    return point.type === "ppq_enhanced" ? "PPQ point: routine production usually doesn't need it." : undefined;
  }
  return undefined;
}

/** The one line the risk assessment prints about the stage its ratings were made at (cover row and document summary). */
export function riskStageLine(stage: ProgramStage | undefined): string {
  return stage
    ? `Ratings reflect the ${STAGE_SHORT[stage]} stage; review them when the stage changes.`
    : "The project stage is not set, so the stage the ratings reflect is not stated. Review the ratings when the stage is set.";
}

/** True when the batch record leaves PPQ-only items out at this stage. Not set = everything is included. */
export function ppqOnlyLeftOut(stage: ProgramStage | undefined): boolean {
  return stage !== undefined && stage !== "ppq";
}

/**
 * "3 PPQ-only items are left out because the project stage is Clinical." (the one sentence the app, the HTML and Word all use). "Items",
 * not "steps": the list mixes steps, parameter rows and sample rows.
 */
export function leftOutSentence(stage: ProgramStage | undefined, count: number): string {
  const what = count === 1 ? "1 PPQ-only item is" : `${count} PPQ-only items are`;
  return `${what} left out because the project stage is ${stage ? STAGE_SHORT[stage] : "not set"}.`;
}

/**
 * Stage note for activities that qualify or validate something. The stage decides when the work is expected, not whether the team does
 * it: always phrased as an expectation to confirm with QA.
 */
const QUALIFICATION_ACTIVITIES: ReadonlySet<string> = new Set([
  "equipment_qualification",
  "equipment_requalification",
  "cleaning_validation",
  "cci_study",
  "cci_method_validation",
  "rsf_study",
  "filter_bacterial_retention",
  "bbr_filter_validation",
  "filter_integrity_validation",
  "pupsit_assembly_qualification",
  "avi_qualification",
  "inspector_qualification",
  "shipping_validation",
  "temperature_mapping",
  "csv_assessment",
  "serialization_verification",
]);

/** Activities that are studies of the process itself (run before or during PPQ to learn or support the ranges). */
const PROCESS_STUDY_ACTIVITIES: ReadonlySet<string> = new Set([
  "mixing_study",
  "hold_time_study",
  "filter_compatibility",
  "extractables_leachables",
  "filter_sizing",
  "fill_accuracy_study",
  "product_quality_impact",
  "freeze_thaw_study",
  "lyo_cycle_verification",
  "stopper_position_study",
  "stability_assessment",
  "scientific_justification",
  "comparability_assessment",
]);

/** Paperwork and information activities: the stage changes only how complete they must be when the batches start. */
const DOCUMENT_ACTIVITIES: ReadonlySet<string> = new Set([
  "information_gathering",
  "risk_assessment_update",
  "procedure_update",
  "training",
  "environmental_monitoring_assessment",
  "buffer_supply_assessment",
  "supplier_qualification",
]);

/** The generic stage note for an activity that has no note of its own. Undefined when the stage is not set (the plan then says so once). */
export function genericActivityStageNote(activityKey: string, target: ProgramStage | undefined): string | undefined {
  if (!target) return undefined;
  if (QUALIFICATION_ACTIVITIES.has(activityKey)) {
    return {
      development: "Not expected for engineering runs, which are not for GMP supply.",
      clinical: "The extent is phase-appropriate at a clinical project; it is not necessarily complete validation.",
      ppq: "Expected to be complete, or planned with a date, before the PPQ batches start.",
      commercial: "Expected to be in place before commercial supply.",
    }[target];
  }
  if (PROCESS_STUDY_ACTIVITIES.has(activityKey)) {
    return {
      development: "A study to learn the process; its results are targets, not validated limits.",
      clinical: "Supports the ranges used for clinical supply; the process is not validated.",
      ppq: "Its results are the targets the PPQ batches confirm.",
      commercial: "Its results belong in the validated file; a repeat for a changed condition follows change control.",
    }[target];
  }
  if (DOCUMENT_ACTIVITIES.has(activityKey)) {
    return {
      development: "Needed in a light form for engineering runs.",
      clinical: "Needed in full before clinical batches are made.",
      ppq: "Needed in full before the PPQ batches are made.",
      commercial: "Needed in full and under document control before commercial supply.",
    }[target];
  }
  return undefined;
}
