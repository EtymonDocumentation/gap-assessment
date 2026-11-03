import { resolveEntry, type Project, type Side, type StageCheck } from "@gap/process-model";
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
 *   - Nothing is defaulted. An unanswered stage reads "[TBD]" and shows up in the open items.
 *   - The stage is not compared as a gap (rule R-SITE-INFO is informational). Its effect is on the wording and
 *     on the validation expectations below, which are phrased as expectations to confirm with QA.
 *   - The tool never decides a filing category.
 *
 * Content texts hold stage variants as {{validated wording|other wording}}. adaptText() picks the first variant
 * for a validated source and the second otherwise; stagedContent() does this for a whole content bundle.
 */

/** Lifecycle order: every list of stages (chooser, options, tables) runs from development to commercial. */
export const PROGRAM_STAGES = ["development", "clinical", "ppq", "commercial"] as const;
export type ProgramStage = (typeof PROGRAM_STAGES)[number];

/** Long form (lists, cover, chooser). Same wording as the catalog option set `programStage` (a test keeps the two in step). */
export const STAGE_LABEL: Readonly<Record<ProgramStage, string>> = {
  development: "Engineering / development runs",
  clinical: "Clinical batches (GMP, not process-validated)",
  ppq: "PPQ batches (process performance qualification)",
  commercial: "Commercial batches (process validated)",
};

/** Short form (the header chip, the Word page header). */
export const STAGE_SHORT: Readonly<Record<ProgramStage, string>> = {
  development: "Engineering",
  clinical: "Clinical",
  ppq: "PPQ",
  commercial: "Commercial",
};

/** One line on what each stage means, shown with the options of every chooser so a first-time user can pick without help. */
export const STAGE_MEANING: Readonly<Record<ProgramStage, string>> = {
  development: "Engineering or demonstration runs to learn the process. Not for GMP supply.",
  clinical: "GMP batches for clinical use. The process is not yet validated.",
  ppq: "Batches that prove the process works at the receiving site (process performance qualification).",
  commercial: "Batches for the market, made with a validated process.",
};

/** What a change of project stage adapts, for the summary shown after the change. The chain modules read the stage; none of it is hidden or deleted. */
export const STAGE_ADAPTS: readonly string[] = [
  "The wording of the TRD ranges and limits",
  "The purpose of the sampling plan",
  "The PPQ steps of the batch record",
  "The stage line in the header of every Word file",
];

/** Said after every change, because the stage only changes wording and reminders. */
export const STAGE_OWN_TEXT_NOTE = "Your own text is not changed or deleted.";

/** The site entry that holds a side's stage, and the question that asks for it. */
export const STAGE_FIELD = "programStage";
export const STAGE_BINDS = "site.programStage";
export const STAGE_QUESTION_ID = "site.stage";

/** What is printed for a stage that has not been answered. */
export const STAGE_NOT_ESTABLISHED = "[TBD]";

export function isProgramStage(v: unknown): v is ProgramStage {
  return typeof v === "string" && (PROGRAM_STAGES as readonly string[]).includes(v);
}

/** The side's stage when it is established with a known value; otherwise undefined. */
export function programStage(project: Project, side: Side): ProgramStage | undefined {
  const r = resolveEntry(project, `${side}.${STAGE_BINDS}`);
  return r.status === "established" && isProgramStage(r.value) ? r.value : undefined;
}

/**
 * The PROJECT stage: what the receiving site's next batches are. It is the receiving side's answer to the stage question, so it works
 * without a gap assessment as soon as any editor sets it. (The sending side's answer, programStage(project, "source"), only describes
 * the source process and drives the {{validated|other}} wording.)
 */
export function projectStage(project: Project): ProgramStage | undefined {
  return programStage(project, "target");
}

export function stageLabel(stage: ProgramStage | undefined): string {
  return stage ? STAGE_LABEL[stage] : STAGE_NOT_ESTABLISHED;
}

/** Short form for the header chip and the Word page header; the not-established wording when the stage is not set. */
export function stageShort(stage: ProgramStage | undefined, notSet = "not set"): string {
  return stage ? STAGE_SHORT[stage] : notSet;
}

/** What a cover prints for a project stage that is not set. */
export const STAGE_COVER_NOT_ESTABLISHED = "[not established]";

/**
 * The project stage facts every document cover carries: the long label (or "[not established]") and the short form the Word page
 * header and the screen preview repeat ("Project stage: PPQ"). One function so every document words it the same.
 */
export function coverStage(stage: ProgramStage | undefined): { targetStage: string; stageShort: string } {
  return { targetStage: stage ? STAGE_LABEL[stage] : STAGE_COVER_NOT_ESTABLISHED, stageShort: stageShort(stage) };
}

/** The text of a stage check as shown on Home, in the chooser and as an open item in every document. */
export const STAGE_CHECK_TEXT: Readonly<Record<StageCheck, string>> = {
  "commercial-before-ppq":
    "Check the project stage: it was saved as Commercial before PPQ could be chosen. Choose the stage again (Commercial too, if it is right) to clear this.",
  "trd-differed":
    "Check the project stage: the old TRD form held a different stage from the project's own answer. The project's answer was kept and the old text is in the change log. Choose the stage again to clear this.",
};

/**
 * The stage check to show, or undefined. A check only means something while a stage is set (a stage that was cleared since has nothing
 * to check), so it is hidden then.
 */
export function stageCheckOf(project: Project): StageCheck | undefined {
  return projectStage(project) ? project.meta.stageCheck : undefined;
}

/**
 * Open items every document lists about the project stage: not set (so wording that depends on it shows the wider version) and the
 * stage check. The gap assessment lists the unanswered question itself, so it only adds the check.
 */
export function stageOpenItems(project: Project, opts: { withNotSet?: boolean } = {}): string[] {
  const out: string[] = [];
  if (!projectStage(project) && opts.withNotSet !== false) {
    out.push("Project stage not set. Wording and reminders that depend on the stage show the wider version until it is set.");
  }
  const check = stageCheckOf(project);
  if (check) out.push(STAGE_CHECK_TEXT[check]);
  return out;
}

/**
 * Whether an item that may carry a `stages` list applies at the project stage. No list = always; a listed stage = yes; a stage that is
 * not established = yes (show more rather than less, with the open item "Project stage not set"). Nothing is hidden by this alone:
 * callers keep the item listed and offer a way to include it.
 */
export function appliesAtStage(item: { stages?: readonly ProgramStage[] | undefined }, stage: ProgramStage | undefined): boolean {
  if (!item.stages || item.stages.length === 0) return true;
  return stage === undefined ? true : item.stages.includes(stage);
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

// ------------------------------------------------------------------ project-stage wording in content texts

/*
 * A short phrase that depends on the PROJECT stage is written inline as
 *     {{@stage development, clinical: text ;; ppq: text ;; commercial: text ;; else: text}}
 * `else` is required: it is the wording when the stage is not established (and for a stage no branch lists). The leading `@` and the `;;`
 * separator keep these markers apart from the TRD blanks {{key|Fallback}} and from the two-way {{validated|other}} markers; a stage
 * marker never contains `|`, `{{` or `}}`. Longer differences use a `stages` list on the item instead (appliesAtStage).
 */
const STAGE_MARKER = /\{\{@stage([^{}|]*)\}\}/g;
/** Any opening of a stage marker, to let a lint find one that does not parse (for example one that contains a `|`). */
export const STAGE_MARKER_OPEN = "{{@stage";

export type StageBranch = { stages: ProgramStage[] | "else"; text: string };

/** Parses the inside of a stage marker. Returns the branches, or the reason the marker is wrong. */
export function parseStageMarker(inner: string): { branches: StageBranch[] } | { error: string } {
  const branches: StageBranch[] = [];
  for (const part of inner.split(";;")) {
    const m = /^\s*([A-Za-z ,]+?)\s*:([\s\S]*)$/.exec(part);
    if (!m) return { error: `branch "${part.trim()}" is not "stages: text"` };
    const names = m[1]!.split(",").map((x) => x.trim()).filter(Boolean);
    const text = m[2]!.trim();
    if (names.length === 1 && names[0] === "else") {
      branches.push({ stages: "else", text });
      continue;
    }
    const unknown = names.filter((n) => !isProgramStage(n));
    if (names.length === 0 || unknown.length) return { error: `unknown stage "${unknown.join(", ") || m[1]}"` };
    branches.push({ stages: names as ProgramStage[], text });
  }
  if (!branches.some((b) => b.stages === "else")) return { error: "no else branch" };
  return { branches };
}

/** Resolves {{@stage ...}} markers for a project stage (undefined = not established, which takes the `else` branch). */
export function resolveStageMarkers(text: string, stage: ProgramStage | undefined): string {
  if (!text.includes(STAGE_MARKER_OPEN)) return text;
  return text.replace(STAGE_MARKER, (whole, inner: string) => {
    const parsed = parseStageMarker(inner);
    if ("error" in parsed) return whole; // left as written so a test (and a reviewer) can see it; the lint fails on it
    const hit = stage ? parsed.branches.find((b) => b.stages !== "else" && b.stages.includes(stage)) : undefined;
    return (hit ?? parsed.branches.find((b) => b.stages === "else")!).text;
  });
}

/** Resolves the markers in every string of a JSON-like value. Returns the same object when nothing changed. */
function adaptDeep<T>(value: T, f: (s: string) => string): T {
  if (typeof value === "string") return f(value) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((x) => {
      const y = adaptDeep(x, f);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value)) {
      const y = adaptDeep(x, f);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

const staged = new WeakMap<ContentBundle, Map<string, ContentBundle>>();

/** The loaded or effective bundle behind a staged bundle (or the bundle itself). */
export function unstagedContent(content: ContentBundle): ContentBundle {
  return content.stagedOf ?? content;
}

/**
 * The content bundle with every stage variant resolved: the {{@stage ...}} markers for the project stage first, then the two-way
 * {{validated|other}} markers for the sending-site stage. Memoised per bundle and wording, and idempotent: staging a staged bundle for
 * the same wording returns it; for other wording it re-stages the original. Objects without markers keep their identity, so a bundle
 * that has none comes back almost unchanged.
 */
export function stagedContent(content: ContentBundle, validated: boolean, stage?: ProgramStage): ContentBundle {
  const stageKey = stage ?? "none";
  if (content.sourceValidated === validated && (content.projectStage ?? "none") === stageKey) return content;
  const raw = unstagedContent(content);
  const slot = `${validated ? "validated" : "other"}|${stageKey}`;
  let entry = staged.get(raw);
  if (!entry) staged.set(raw, (entry = new Map()));
  const hit = entry.get(slot);
  if (hit) return hit;

  const f = (s: string) => adaptText(resolveStageMarkers(s, stage), validated);
  const questions = adaptDeep(raw.questions, f);
  const sections = adaptDeep(raw.sections, f);
  const out: ContentBundle = {
    ...raw,
    catalog: adaptDeep(raw.catalog, f),
    questions,
    sections,
    rules: adaptDeep(raw.rules, f),
    templates: adaptDeep(raw.templates, f),
    questionById: questions === raw.questions ? raw.questionById : new Map(questions.map((q) => [q.id, q])),
    sectionById: sections === raw.sections ? raw.sectionById : new Map(sections.map((s) => [s.id, s])),
    sourceValidated: validated,
    projectStage: stageKey,
    stagedOf: raw,
  };
  entry.set(slot, out);
  return out;
}

/** The content to use for a project's wording (the bundle staged for the project's sending-site stage and project stage). */
export function stagedFor(content: ContentBundle, project: Project): ContentBundle {
  return stagedContent(content, sourceValidated(project), projectStage(project));
}

// ------------------------------------------------------------------ wording

export interface StageWording {
  source: ProgramStage | undefined;
  target: ProgramStage | undefined;
  /** Stage label, or "[TBD]". */
  sourceLabel: string;
  targetLabel: string;
  sourceValidated: boolean;
  /** "SU — validated state" / "SU — current state". */
  sourceSideText: string;
  /** Column header of the source side in tables: "Validated state" / "Current state". */
  sourceStateColumn: string;
  /** Heading of the SU summary section: "Sending unit program summary (current state)". */
  sourceSummaryHeading: string;
  /** Heading of the RU summary section: "Receiving unit summary (planned state)". */
  targetSummaryHeading: string;
  /** Short label of the parameter range recorded for the SU: "Validated range" / "Demonstrated range". */
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
    sourceSideText: `SU — ${state}`,
    sourceStateColumn: validated ? "Validated state" : "Current state",
    sourceSummaryHeading: `Sending unit program summary (${state})`,
    targetSummaryHeading: "Receiving unit summary (planned state)",
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
  /** What the SU stage means for evidence that can be leveraged. */
  sourcePoint: string;
  /** What the RU stage means for the validation work expected. */
  targetPoint: string;
  /** The reminder that these are expectations. */
  closing: string;
}

const SOURCE_POINT: Record<ProgramStage | "none", string> = {
  commercial:
    "The SU process is validated. Existing PPQ, cleaning validation, media fill and qualification evidence can be leveraged where the gap table shows it covers the RU condition.",
  clinical:
    "The SU is GMP clinical manufacture and is not process validated, so there is no SU PPQ or process validation evidence to leverage. Aseptic process simulation (media fill) and qualification history at the SU may exist and can be cited where documented.",
  ppq:
    "The SU is running PPQ batches. Its process is not yet validated, so there is no completed SU PPQ to leverage until the PPQ report is approved. Aseptic process simulation (media fill) and qualification history at the SU may exist and can be cited where documented.",
  development:
    "The SU is development or engineering runs. There is no process validation and no GMP evidence to leverage; development data can inform the RU work but do not replace GMP evidence.",
  none: "The SU program stage is TBD, so no SU validation evidence is assumed. Answer the program stage question to complete this basis.",
};

function targetPoint(source: ProgramStage | undefined, target: ProgramStage | undefined): string {
  if (target === "commercial") {
    if (source === "commercial") {
      return "A commercial RU is expected to need PPQ at the RU. Its extent depends on how much of the SU PPQ evidence covers the RU condition (see the coverage assessment).";
    }
    if (source) return "A commercial RU is expected to need PPQ at the RU. From an SU that is not process validated this is typically a full PPQ.";
    return "A commercial RU is expected to need PPQ at the RU. Its extent cannot be stated until the SU stage is established.";
  }
  if (target === "clinical") {
    return "A clinical RU is held to phase-appropriate expectations: GMP manufacture and aseptic process simulation still apply, but full process validation (PPQ) is not expected.";
  }
  if (target === "ppq") {
    return "A PPQ RU runs process performance qualification batches to confirm the process at the RU. The extent depends on how much SU evidence covers the RU condition (see the coverage assessment).";
  }
  if (target === "development") {
    return "A development RU covers engineering or demonstration runs. They are not for GMP supply, so GMP validation activities are not expected.";
  }
  return "The RU program stage is TBD, so the validation work expected at the RU cannot be stated. Answer the program stage question to complete this basis.";
}

export function stageBasis(w: StageWording): StageBasis {
  return {
    statement: `Sending-site stage: ${w.sourceLabel}. Project stage: ${w.targetLabel}.`,
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
            ? "Expected at a commercial RU; the extent depends on SU PPQ coverage."
            : w.source
              ? "Expected at a commercial RU; from an SU that is not process validated this is typically a full PPQ."
              : "Expected at a commercial RU; the extent depends on the SU stage, which is TBD.",
        );
      } else if (w.target === "ppq") parts.push("PPQ batches are the work at a PPQ RU; the extent depends on the SU evidence, which the coverage assessment shows.");
      else if (w.target === "clinical") parts.push("Full process validation (PPQ) is not expected at a clinical RU; phase-appropriate evidence applies.");
      else if (w.target === "development") parts.push("PPQ is not expected for development or engineering runs.");
      else parts.push("Whether PPQ is expected depends on the RU program stage, which is TBD.");
      break;
    case "ppq_coverage_assessment":
      if (w.source === "commercial") parts.push("The SU PPQ can be assessed for coverage of the RU condition.");
      else if (w.source) parts.push("The SU has no PPQ to assess for coverage; expect new RU work instead.");
      else parts.push("Whether SU PPQ exists to assess depends on the SU stage, which is TBD.");
      break;
    case "media_fill":
      if (w.source === "clinical") parts.push("Media fill history at the clinical GMP SU may exist and can be cited; the RU media fill is still assessed on its own.");
      else if (w.source === "development") parts.push("Development runs give no GMP media fill evidence to leverage.");
      else if (w.source === "ppq") parts.push("Media fill history at the PPQ SU may exist and can be cited; the RU media fill is still assessed on its own.");
      if (w.target === "development") parts.push("A GMP media fill is not expected for engineering runs.");
      break;
    case "engineering_run":
      if (w.target === "development") parts.push("For a development RU the engineering or demonstration runs are the main deliverable and are not for GMP supply.");
      break;
    default:
      break;
  }
  const text = parts.join(" ");
  return text ? `${text} Confirm with QA.` : undefined;
}
