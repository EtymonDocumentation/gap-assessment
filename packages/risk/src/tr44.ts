import type { FmeaConfig, RiskConfig, RiskIntervention, RiskInterventionFactor, RiskLmh } from "@gap/process-model";
import { RISK_INTERVENTION_FACTORS } from "@gap/process-model";

/*
 * The optional PDA TR 44 style FMEA layout, and the two small helps taken from PDA TR 60 and TR 22. Paraphrased guidance only; no
 * table or wording of the reports is reproduced. References: TR 44 s4.1 (FMEA columns, reversed detection scale, loss of sterility),
 * TR 44 Example 3 (occurrence by intervention frequency, an example action threshold), TR 60 s6.1 Table 6.1-2 (severity and the
 * statistical confidence), TR 22 Example 3 (intervention risk scoring).
 *
 * Design notes (the why):
 *  - NOTHING HERE FILLS AN ANSWER. These are texts to read and comparisons to show. A hint never selects a score, a confidence level
 *    or an "accepted" answer; the team still types every one.
 *  - THE TOOL NEVER CALLS A ROW ACCEPTABLE. It compares a risk priority with the threshold the team typed and says "above" or "not
 *    above"; whether the remaining risk is accepted is the team's own answer.
 */

export const isTr44 = (config: RiskConfig | undefined): config is FmeaConfig & { layout: "tr44" } => config?.method === "fmea" && config.layout === "tr44";

/** What the reversed detection scale means, in the words the Method page, the item form and the document use. */
export const TR44_DETECTION_TEXT = "Detection is a REVERSED scale: a high number means the failure is poorly detected (1 = almost certain to be detected, 10 = almost certain not to be detected).";

/** Guidance for scoring, shown next to the scales. Hints only: nothing is preselected. */
export const TR44_GUIDANCE: readonly string[] = [
  "For loss of sterility the severity is always high, so a risk is reduced through occurrence (preferred) or through detection, not through severity.",
  "For an aseptic intervention, occurrence can follow how often the intervention is done: more than once an hour is high, less than once an hour is medium, less than once a shift is low.",
  TR44_DETECTION_TEXT,
];

/** The hint shown beside the action threshold. The figure is one worked example, never a default. */
export const TR44_THRESHOLD_HINT = "The threshold is your organisation's decision and is left blank. One worked example in PDA TR 44 used 100. A row whose risk priority is above the threshold needs recommended actions.";

/** Where the descriptions of the scale ends come from: direction only, not what a middle number means. */
export const TR44_SCALE_ENDS = {
  severity: [
    { value: 1, description: "Least severe effect (scale direction only)" },
    { value: 10, description: "Most severe effect (scale direction only)" },
  ],
  occurrence: [
    { value: 1, description: "Failure very unlikely to occur (scale direction only)" },
    { value: 10, description: "Failure almost certain to occur (scale direction only)" },
  ],
  detection: [
    { value: 1, description: "Almost certain to be detected: best detection (reversed scale)" },
    { value: 10, description: "Almost certain NOT to be detected: poorest detection (reversed scale)" },
  ],
} as const;

/** Is the risk priority above the team's threshold? Undefined when there is no threshold or no score to compare. */
export function aboveThreshold(priority: number | undefined, threshold: number | undefined): boolean | undefined {
  if (priority === undefined || threshold === undefined) return undefined;
  return priority > threshold;
}

// ------------------------------------------------------------------ PDA TR 60: severity and statistical confidence

/** Severity class and the confidence PDA TR 60 (Table 6.1-2) links to it. A hint for the sampling plan, never copied in by the tool. */
export const SEVERITY_CONFIDENCE_HINT: readonly { severity: "high" | "medium" | "low"; percent: number }[] = [
  { severity: "high", percent: 99 },
  { severity: "medium", percent: 95 },
  { severity: "low", percent: 90 },
];
export const severityConfidenceText = (): string =>
  `PDA TR 60 links the severity of the failure to the statistical confidence of the sampling: ${SEVERITY_CONFIDENCE_HINT.map((x) => `${x.severity} severity ${x.percent} %`).join(", ")}. A hint only: the confidence of a sample set is the team's own entry.`;

// ------------------------------------------------------------------ PDA TR 22: intervention risk

export const INTERVENTION_LABEL: Record<RiskInterventionFactor, string> = {
  complexity: "Complexity",
  duration: "Duration",
  proximity: "Proximity to the product",
  frequency: "Frequency",
  airflow: "Disruption of the airflow",
};
export const LMH_LABEL: Record<RiskLmh, string> = { low: "Low", medium: "Medium", high: "High" };

/** The simulation frequency PDA TR 22 pairs with each overall level. A hint beside the level the team chose. */
export const INTERVENTION_SIMULATION_HINT: Record<RiskLmh, string> = {
  high: "Suggested in PDA TR 22: simulate twice a year, with at least the routine number of these interventions.",
  medium: "Suggested in PDA TR 22: simulate twice a year.",
  low: "Suggested in PDA TR 22: simulate once a year, with fewer of these interventions.",
};

export interface InterventionTally {
  high: number;
  medium: number;
  low: number;
  /** Aspects with no answer yet, by label. */
  missing: string[];
  /** The five answers in words, for a table cell: "Complexity high, Duration low ...". Only the answers that were given. */
  text: string;
}

/** Counts the answers of an intervention. It does NOT derive the overall level: that is the team's choice. */
export function interventionTally(iv: RiskIntervention | undefined): InterventionTally {
  const t: InterventionTally = { high: 0, medium: 0, low: 0, missing: [], text: "" };
  const parts: string[] = [];
  for (const k of RISK_INTERVENTION_FACTORS) {
    const v = iv?.[k];
    if (!v) t.missing.push(INTERVENTION_LABEL[k]);
    else {
      t[v] += 1;
      parts.push(`${INTERVENTION_LABEL[k]} ${v}`);
    }
  }
  t.text = parts.join(", ");
  return t;
}

/** True if nothing about the intervention was entered. */
export const interventionIsEmpty = (iv: RiskIntervention | undefined): boolean => !iv || [...RISK_INTERVENTION_FACTORS, "level" as const].every((k) => !iv[k]);
