import { failure, isPositiveInt, type SampleSizeResult } from "./types";

const CITATION = "Fixed sample count set by the project; the basis is stated in the plan.";

/** A sample size that the project fixes itself (for example a protocol requirement). Both the count and the basis are required. */
export function fixedCountPlan(i: { count?: number; basis?: string }): SampleSizeResult {
  const problems: string[] = [];
  if (i.count === undefined) problems.push("Enter the fixed sample count.");
  else if (!isPositiveInt(i.count)) problems.push("The fixed sample count must be a whole number of 1 or more.");
  const basis = i.basis?.trim() ?? "";
  if (!basis) problems.push("Enter the basis for the fixed sample count (where the number comes from).");
  if (problems.length > 0) return failure("fixed", problems, CITATION);
  return {
    method: "fixed",
    ok: true,
    problems: [],
    sampleSize: i.count!,
    working: [
      { label: "Fixed sample count", value: String(i.count) },
      { label: "Basis", value: basis },
    ],
    citation: CITATION,
  };
}
