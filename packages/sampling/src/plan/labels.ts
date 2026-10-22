import type { BatchResult, SamplingCategory, SamplingMethod, SamplingPoint, TimingOption } from "@gap/process-model";

/**
 * Words for the plan's option lists. They live here, next to the logic, so the web pages, the Word and HTML protocol and the
 * tests all say the same thing. The keys (stored in files) never change; only these labels may be reworded.
 */

export const CATEGORY_LABEL: Record<SamplingCategory, string> = {
  routine_ipc_release: "Routine in-process / release",
  ppq_enhanced: "PPQ enhanced sampling",
  characterization: "Characterization",
  supporting_study: "Supporting study",
  other: "Other",
};

/** Plain-language help per category, shown in the point editor. */
export const CATEGORY_HELP: Record<SamplingCategory, string> = {
  routine_ipc_release: "Tests that are done on every batch in routine manufacture. They always need an acceptance criterion.",
  ppq_enhanced: "Extra sampling done only during the PPQ batches to show the process is consistent. It needs an acceptance criterion.",
  characterization: "Material taken to learn about the product or process. It may be collected and reported without a criterion.",
  supporting_study: "Material taken for a study that rides on the PPQ batches (hold time, shipping, stability placement). It may be report only.",
  other: "Anything else. Say what it is in the label. It may be report only.",
};

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

export function categoryText(p: Pick<SamplingPoint, "category" | "categoryLabel">): string {
  const base = CATEGORY_LABEL[p.category];
  return p.categoryLabel?.trim() ? `${base}: ${p.categoryLabel.trim()}` : base;
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
