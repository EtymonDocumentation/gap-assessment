import { resolveEntry, type Project, type Side } from "@gap/process-model";
import type { ContentBundle } from "./content";

/*
 * Program stage: where each side's process stands (commercial, clinical or development).
 *
 * This is the ONE place that decides which wording a project uses. It reads the two stage answers
 * (`<side>.site.programStage`) and returns a typed wording object. Compare, labels, the document, the validation
 * plan and the web app all take their stage-dependent text from here.
 *
 * Rules:
 *   - "Validated" wording is used ONLY when the source stage is established as commercial. A clinical source,
 *     a development source and a source whose stage is not answered yet all use the non-validated wording.
 *   - Nothing is defaulted. An unanswered stage reads "[not established]" and shows up in the open items.
 *   - The stage is not compared as a gap (rule R-SITE-INFO is informational). Its effect is on the wording and
 *     on the validation expectations below, which are phrased as expectations to confirm with QA.
 *   - The tool never decides a filing category.
 *
 * Content texts hold stage variants as {{validated wording|other wording}}. adaptText() picks the first variant
 * for a validated source and the second otherwise; stagedContent() does this for a whole content bundle.
 */

export const PROGRAM_STAGES = ["commercial", "clinical", "development"] as const;
export type ProgramStage = (typeof PROGRAM_STAGES)[number];

/** Same wording as the catalog option set `programStage` (a test keeps the two in step). */
export const STAGE_LABEL: Readonly<Record<ProgramStage, string>> = {
  commercial: "Commercial (process validated)",
  clinical: "Clinical (GMP, not process validated)",
  development: "Development / engineering runs",
};

/** The site entry that holds a side's stage, and the question that asks for it. */
export const STAGE_FIELD = "programStage";
export const STAGE_BINDS = "site.programStage";
export const STAGE_QUESTION_ID = "site.stage";

/** What is printed for a stage that has not been answered. */
export const STAGE_NOT_ESTABLISHED = "[not established]";

export function isProgramStage(v: unknown): v is ProgramStage {
  return typeof v === "string" && (PROGRAM_STAGES as readonly string[]).includes(v);
}

/** The side's stage when it is established with a known value; otherwise undefined. */
export function programStage(project: Project, side: Side): ProgramStage | undefined {
  const r = resolveEntry(project, `${side}.${STAGE_BINDS}`);
  return r.status === "established" && isProgramStage(r.value) ? r.value : undefined;
}

export function stageLabel(stage: ProgramStage | undefined): string {
  return stage ? STAGE_LABEL[stage] : STAGE_NOT_ESTABLISHED;
}

/** True only when the source stage is established as commercial. */
export function sourceValidated(project: Project): boolean {
  return programStage(project, "source") === "commercial";
}

// ------------------------------------------------------------------ variants in content texts

const VARIANT = /\{\{([^{}|]*)\|([^{}]*)\}\}/g;

/** Resolves {{validated|other}} markers: the first variant for a validated source, the second otherwise. */
export function adaptText(text: string, validated: boolean): string {
  return text.includes("{{") ? text.replace(VARIANT, (_m, a: string, b: string) => (validated ? a : b)) : text;
}

/** Resolves the markers in every string of a JSON-like value. Returns the same object when nothing changed. */
function adaptDeep<T>(value: T, validated: boolean): T {
  if (typeof value === "string") return adaptText(value, validated) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((x) => {
      const y = adaptDeep(x, validated);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value)) {
      const y = adaptDeep(x, validated);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

const staged = new WeakMap<ContentBundle, { validated?: ContentBundle; other?: ContentBundle }>();

/** The loaded or effective bundle behind a staged bundle (or the bundle itself). */
export function unstagedContent(content: ContentBundle): ContentBundle {
  return content.stagedOf ?? content;
}

/**
 * The content bundle with every stage variant resolved. Memoised per bundle and wording, and idempotent:
 * staging a staged bundle for the same wording returns it; for the other wording it re-stages the original.
 * Objects without markers keep their identity, so a bundle that has none comes back almost unchanged.
 */
export function stagedContent(content: ContentBundle, validated: boolean): ContentBundle {
  if (content.sourceValidated === validated) return content;
  const raw = unstagedContent(content);
  const slot = validated ? "validated" : "other";
  let entry = staged.get(raw);
  if (!entry) staged.set(raw, (entry = {}));
  const hit = entry[slot];
  if (hit) return hit;

  const questions = adaptDeep(raw.questions, validated);
  const sections = adaptDeep(raw.sections, validated);
  const out: ContentBundle = {
    ...raw,
    catalog: adaptDeep(raw.catalog, validated),
    questions,
    sections,
    rules: adaptDeep(raw.rules, validated),
    templates: adaptDeep(raw.templates, validated),
    questionById: questions === raw.questions ? raw.questionById : new Map(questions.map((q) => [q.id, q])),
    sectionById: sections === raw.sections ? raw.sectionById : new Map(sections.map((s) => [s.id, s])),
    sourceValidated: validated,
    stagedOf: raw,
  };
  entry[slot] = out;
  return out;
}

/** The content to use for a project's wording (the bundle staged for the project's source stage). */
export function stagedFor(content: ContentBundle, project: Project): ContentBundle {
  return stagedContent(content, sourceValidated(project));
}

// ------------------------------------------------------------------ wording

export interface StageWording {
  source: ProgramStage | undefined;
  target: ProgramStage | undefined;
  /** Stage label, or "[not established]". */
  sourceLabel: string;
  targetLabel: string;
  sourceValidated: boolean;
  /** "Source — validated state" / "Source — current state". */
  sourceSideText: string;
  /** Column header of the source side in tables: "Validated state" / "Current state". */
  sourceStateColumn: string;
  /** Heading of the source summary section. */
  sourceSummaryHeading: string;
  /** Short label of the parameter range recorded for the source: "Validated range" / "Demonstrated range". */
  rangeShort: string;
}

export function stageWordingFor(source: ProgramStage | undefined, target: ProgramStage | undefined): StageWording {
  const validated = source === "commercial";
  const state = validated ? "validated state" : "current state";
  return {
    source,
    target,
    sourceLabel: stageLabel(source),
    targetLabel: stageLabel(target),
    sourceValidated: validated,
    sourceSideText: `Source — ${state}`,
    sourceStateColumn: validated ? "Validated state" : "Current state",
    sourceSummaryHeading: `Source program summary (${state})`,
    rangeShort: validated ? "Validated range" : "Demonstrated range",
  };
}

export function stageWording(project: Project): StageWording {
  return stageWordingFor(programStage(project, "source"), programStage(project, "target"));
}

// ------------------------------------------------------------------ validation expectations

/** What the stages mean for validation, as expectations to confirm with QA. Never a decision. */
export interface StageBasis {
  /** One line naming both stages. */
  statement: string;
  /** What the source stage means for evidence that can be leveraged. */
  sourcePoint: string;
  /** What the target stage means for the validation work expected. */
  targetPoint: string;
  /** The reminder that these are expectations. */
  closing: string;
}

const SOURCE_POINT: Record<ProgramStage | "none", string> = {
  commercial:
    "The source process is validated. Existing PPQ, cleaning validation, media fill and qualification evidence can be leveraged where the gap table shows it covers the target condition.",
  clinical:
    "The source is GMP clinical manufacture and is not process validated, so there is no source PPQ or process validation evidence to leverage. Aseptic process simulation (media fill) and qualification history at the source may exist and can be cited where documented.",
  development:
    "The source is development or engineering runs. There is no process validation and no GMP evidence to leverage; development data can inform the target work but do not replace GMP evidence.",
  none: "The source program stage is not established, so no source validation evidence is assumed. Answer the program stage question to complete this basis.",
};

function targetPoint(source: ProgramStage | undefined, target: ProgramStage | undefined): string {
  if (target === "commercial") {
    if (source === "commercial") {
      return "A commercial target is expected to need PPQ at the target. Its extent depends on how much of the source PPQ evidence covers the target condition (see the coverage assessment).";
    }
    if (source) return "A commercial target is expected to need PPQ at the target. From a source that is not process validated this is typically a full PPQ.";
    return "A commercial target is expected to need PPQ at the target. Its extent cannot be stated until the source stage is established.";
  }
  if (target === "clinical") {
    return "A clinical target is held to phase-appropriate expectations: GMP manufacture and aseptic process simulation still apply, but full process validation (PPQ) is not expected.";
  }
  if (target === "development") {
    return "A development target covers engineering or demonstration runs. They are not for GMP supply, so GMP validation activities are not expected.";
  }
  return "The target program stage is not established, so the validation work expected at the target cannot be stated. Answer the program stage question to complete this basis.";
}

export function stageBasis(w: StageWording): StageBasis {
  return {
    statement: `Source program stage: ${w.sourceLabel}. Target program stage: ${w.targetLabel}.`,
    sourcePoint: SOURCE_POINT[w.source ?? "none"],
    targetPoint: targetPoint(w.source, w.target),
    closing: "These are expectations to confirm with QA, not decisions. The activities below follow from the gaps in this assessment.",
  };
}

/**
 * Stage-specific note for one validation activity, or undefined when the stage changes nothing for it.
 * Phrased as an expectation to confirm with QA.
 */
export function activityStageNote(activityKey: string, w: StageWording): string | undefined {
  const parts: string[] = [];
  switch (activityKey) {
    case "ppq":
      if (w.target === "commercial") {
        parts.push(
          w.source === "commercial"
            ? "Expected at a commercial target; the extent depends on source PPQ coverage."
            : w.source
              ? "Expected at a commercial target; from a source that is not process validated this is typically a full PPQ."
              : "Expected at a commercial target; the extent depends on the source stage, which is not established.",
        );
      } else if (w.target === "clinical") parts.push("Full process validation (PPQ) is not expected at a clinical target; phase-appropriate evidence applies.");
      else if (w.target === "development") parts.push("PPQ is not expected for development or engineering runs.");
      else parts.push("Whether PPQ is expected depends on the target program stage, which is not established.");
      break;
    case "ppq_coverage_assessment":
      if (w.source === "commercial") parts.push("The source PPQ can be assessed for coverage of the target condition.");
      else if (w.source) parts.push("The source has no PPQ to assess for coverage; expect new target work instead.");
      else parts.push("Whether source PPQ exists to assess depends on the source stage, which is not established.");
      break;
    case "media_fill":
      if (w.source === "clinical") parts.push("Media fill history at the clinical GMP source may exist and can be cited; the target media fill is still assessed on its own.");
      else if (w.source === "development") parts.push("Development runs give no GMP media fill evidence to leverage.");
      if (w.target === "development") parts.push("A GMP media fill is not expected for engineering runs.");
      break;
    case "engineering_run":
      if (w.target === "development") parts.push("For a development target the engineering or demonstration runs are the main deliverable and are not for GMP supply.");
      break;
    default:
      break;
  }
  const text = parts.join(" ");
  return text ? `${text} Confirm with QA.` : undefined;
}
