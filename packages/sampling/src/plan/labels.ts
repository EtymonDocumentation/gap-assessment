import {
  FILTER_TESTS,
  SAMPLING_TYPES,
  type AgencyRequestKind,
  type AgencyRequestStatus,
  type BatchResult,
  type RangeKind,
  type WorstCase,
  RUN_TAGS,
  type ReportPresentation,
  type ReportWhat,
  type ResponsibleParty,
  type SamplingMethod,
  type SamplingPoint,
  type SamplingType,
  type TimingOption,
} from "@gap/process-model";

/**
 * Words for the plan's option lists. They live here, next to the logic, so the web pages, the Word and HTML protocol and the
 * tests all say the same thing. The keys (stored in files) never change; only these labels may be reworded.
 */

export const TYPE_LABEL: Record<SamplingType, string> = {
  ipc: "In-process control (IPC)",
  release: "Release testing",
  ppq_enhanced: "PPQ enhanced sampling",
  mixing_homogeneity: "Mixing / homogeneity",
  hold_time: "Hold time",
  filter_study: "Filter study",
  stability: "Stability",
  retain_reserve: "Retain / reserve",
  characterization: "Characterization",
  supporting_study: "Supporting study",
  regulatory_commitment: "Regulatory commitment",
  other: "Other",
};

/** Plain-language help per study type, shown in the interview and the point editor. */
export const TYPE_HELP: Record<SamplingType, string> = {
  ipc: "A test done during manufacture, between process steps. It always needs an acceptance criterion.",
  release: "A test done on the finished batch before release. It always needs an acceptance criterion.",
  ppq_enhanced: "Extra sampling done only during the PPQ batches (for example beginning, middle and end, or after interventions) to show the process is consistent. It needs an acceptance criterion.",
  mixing_homogeneity: "Samples from several positions and times in a vessel to show the content is uniform. It needs a criterion.",
  hold_time: "Samples taken after holding material for a stated time, to support a maximum hold time. It needs a criterion.",
  filter_study: "A test on a filter used in the process (integrity before or after use, bioburden before filtration, flush). It needs a criterion.",
  stability: "Units put on the stability programme from the PPQ batches. The number of pulls and units is worked out from the conditions and time points you enter. Results may be reported against the stability protocol.",
  retain_reserve: "Units kept back from each batch as a retain or a reserve. You enter the number of units and the requirement they come from.",
  characterization: "Material taken to learn about the product or process. It may be collected and reported without a criterion.",
  supporting_study: "Material taken for a study that rides on the PPQ batches. It may be report only.",
  regulatory_commitment: "A sample or study that answers an agency request or a commitment made to an agency. It may be report only.",
  other: "Anything else. Say what it is in the label. It may be report only.",
};

/** The order study types are printed in the plan and offered in the by-type view. */
export const TYPE_ORDER: readonly SamplingType[] = SAMPLING_TYPES;

export const RESPONSIBLE_LABEL: Record<ResponsibleParty, string> = { cmo: "CMO", sponsor: "Sponsor", contract_lab: "Contract laboratory", other: "Other" };

export const REPORT_WHAT_LABEL: Record<ReportWhat, string> = {
  individual: "Individual results",
  mean: "Mean",
  range: "Range (minimum and maximum)",
  sd_rsd: "Standard deviation and RSD",
  pass_fail: "Pass or fail against the criterion",
  trend: "Trend over time points or locations",
  raw_data_ref: "Reference to chromatograms or raw data",
  other: "Other",
};

export const REPORT_PRESENTATION_LABEL: Record<ReportPresentation, string> = {
  per_batch: "One table per batch",
  across_batches: "One table across batches",
  by_location: "By location",
  by_time_point: "By time point",
};

export const AGENCY_KIND_LABEL: Record<AgencyRequestKind, string> = {
  information_request: "Information request",
  deficiency_or_query_letter: "Deficiency or query letter",
  commitment: "Commitment",
  post_approval_commitment: "Post-approval commitment",
  other: "Other",
};
export const AGENCY_STATUS_LABEL: Record<AgencyRequestStatus, string> = { open: "Open", answered: "Answered", closed: "Closed" };

export const METHOD_LABEL: Record<SamplingMethod, string> = {
  "company-table": "Company sampling table",
  fixed: "Fixed count with written basis",
  "conf-rel": "Confidence and reliability",
  "aql-105e": "Attribute sampling, AQL (MIL-STD-105E)",
  "var-414": "Variables sampling (MIL-STD-414)",
};

/** One or two sentences per method: when you would use it. Never says a method is adequate for a process. */
export const METHOD_HELP: Record<SamplingMethod, string> = {
  "company-table":
    "Use this when your own quality system already sets the sample size by lot size. Pick one of your sampling tables and the tool reads the row that holds the batch's lot size.",
  fixed:
    "Use this when the number is set by a document, a pharmacopoeia or a decision. Type the number and write down where it comes from. The tool does not check the basis.",
  "conf-rel":
    "Use this to show with a stated confidence that at least a stated share of the lot is good. The tool finds the smallest sample for the confidence, the reliability and the failures you allow.",
  "aql-105e":
    "Use this for pass/fail counts when you sample by an acceptable quality level. The tool reads the MIL-STD-105E tables from the lot size, the level and the AQL you choose.",
  "var-414":
    "Use this for measured values when you sample by an acceptable quality level and want a smaller sample than counting would need. The tool reads the MIL-STD-414 tables.",
};

export const TIMING_LABEL: Record<TimingOption, string> = {
  beginning: "Beginning of run",
  middle: "Middle of run",
  end: "End of run",
  after_intervention: "After each intervention",
  after_stoppage: "After stoppages",
  interval: "At defined intervals",
  per_needle: "Per filling needle / nozzle",
  per_lyo_shelf: "Per lyophilizer shelf / location",
  per_closure_lot: "Per container-closure lot",
  composite: "Composite",
  other: "Other",
};

/** "Beginning of run, at defined intervals (every 500 units)" ... or "" when nothing is chosen. */
export function timingText(p: Pick<SamplingPoint, "timing">): string {
  const t = p.timing;
  const parts = t.options.map((o) => {
    if (o === "interval") return t.interval ? `${TIMING_LABEL.interval} (every ${t.interval.every} ${t.interval.unit})` : TIMING_LABEL.interval;
    if (o === "other") return t.other?.trim() ? `Other: ${t.other.trim()}` : TIMING_LABEL.other;
    return TIMING_LABEL[o];
  });
  if (t.note?.trim()) parts.push(t.note.trim());
  return parts.join("; ");
}

/** "Hold time" or "Other: Visual study"; "Not chosen yet" while a migrated point has no type. Nothing is guessed. */
export function typeText(p: Pick<SamplingPoint, "type" | "typeLabel">): string {
  if (!p.type) return "Study type not chosen yet";
  const base = TYPE_LABEL[p.type];
  return p.typeLabel?.trim() ? `${base}: ${p.typeLabel.trim()}` : base;
}

/** Writes a fraction as a percentage without float noise: 0.95 -> "95%", 0.999 -> "99.9%". */
export const percentText = (f: number): string => `${Number((f * 100).toPrecision(8))}%`;

/**
 * The inputs a point chose for its method, in one line, for tables ("Level II, AQL 0.65, normal inspection"). Inputs not given are
 * said to be missing; nothing is filled in.
 */
export function methodInputsText(p: Pick<SamplingPoint, "sampleSize">): string {
  const { method, inputs: i } = p.sampleSize;
  if (!method) return "No method chosen";
  const missing = "not given";
  switch (method) {
    case "company-table":
      return i.table ? `${i.table.name} version ${i.table.version}${i.testKey ? `, test key ${i.testKey}` : ""}` : "No table chosen";
    case "fixed":
      return `Count ${i.count ?? missing}; basis: ${i.basis?.trim() || missing}`;
    case "conf-rel":
      return `Confidence ${i.confidence !== undefined ? percentText(i.confidence) : missing}, reliability ${i.reliability !== undefined ? percentText(i.reliability) : missing}, allowed failures ${i.allowedFailures ?? missing}`;
    case "aql-105e":
      return `Level ${i.level ?? missing}, AQL ${i.aql ?? missing}, ${i.inspection ?? missing} inspection`;
    case "var-414":
      return `Level ${i.level ?? missing}, AQL ${i.aql ?? missing}, ${i.inspection ?? missing} inspection, ${i.limits ?? missing} limit${i.limits === "double" ? "s" : ""}`;
  }
}

/** One batch result in words: "n = 13, accept 1, reject 2 (code letter E)", "100% of lot", or the problem. */
export function resultText(r: BatchResult): string {
  if (!r.ok || r.sampleSize === undefined) return r.problems.join(" ") || "Not worked out";
  const bits = [r.hundredPercent ? "100% of lot" : `n = ${r.sampleSize}`];
  if (r.accept !== undefined && r.reject !== undefined) bits.push(`accept ${r.accept}, reject ${r.reject}`);
  if (r.k !== undefined) bits.push(`k = ${r.k}`);
  if (r.maxPercentNonconforming !== undefined) bits.push(`M = ${r.maxPercentNonconforming}%`);
  if (r.codeLetter) bits.push(`code letter ${r.codeLetter}`);
  return bits.join(", ");
}

export const RANGE_KIND_LABEL: Record<RangeKind, string> = { PAR: "PAR", NOR: "NOR", other: "Other range", unset: "Range kind not chosen" };

/**
 * Help for the optional study design. Information only: the design is the team's, nothing here is required, and the tool never
 * fills it in unless the person applies a load-out and then edits or ignores it.
 */
export const MIXING_DESIGN_HELP =
  "Optional. Describe how the study is designed if you want it in the plan: the runs (batch size, speed, mix time, what each run challenges) and the range each parameter is meant to support. One common practice: three batches at target, or worst-case bracketing (the largest batch at the slowest speed challenges homogeneity; the smallest batch at the fastest speed challenges shear and protein quality). Another: the plan establishes the PAR and the TRD later sets the NOR inside it. These are examples, not rules; the range kind stays your choice.";

export const RUN_TAG_LABEL: Record<(typeof RUN_TAGS)[number], string> = { min: "Minimum", target: "Target", max: "Maximum", other: "Other" };
export const WORST_CASE_LABEL: Record<WorstCase, string> = { homogeneity: "Homogeneity", shear_protein_quality: "Shear and protein quality", other: "Other" };

/** The filter tests a filter-study point can name (shown in the interview and written in the reporting instructions). */
export const FILTER_TEST_LABEL: Record<(typeof FILTER_TESTS)[number], string> = {
  integrity_pre_post: "Integrity test before and after use",
  bioburden_pre_filtration: "Bioburden before filtration",
  flush: "Flush",
  other: "Other",
};
