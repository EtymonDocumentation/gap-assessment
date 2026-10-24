import type { Project, SamplingPlan } from "@gap/process-model";
import type { ContentBundle } from "./content";
import type { FigureTextSuggestions } from "./sampling";
import { buildTrdSeed } from "./trd-seed";

/**
 * Suggested lines for the step boxes of the flow figure, taken from the receiving-unit parameter values of the project (the same
 * values the TRD seed carries). Only values somebody established are offered; "not established" and TBD values are skipped so a
 * suggestion never presents an open item as a fact.
 *
 * This is a SUGGESTION only. The figure reads the plan's own `figureText`; accepting a suggestion copies the lines into the plan, and
 * editing them there never writes back to the project or the TRD (the plan is its own document).
 */
export function figureTextSuggestions(content: ContentBundle, project: Project, plan: SamplingPlan): FigureTextSuggestions {
  const seed = buildTrdSeed(content, project, { exportedAt: "2000-01-01T00:00:00Z" });
  const out: FigureTextSuggestions = {};
  for (const step of plan.steps) {
    if (!step.unitOp) continue;
    const uo = seed.unitOperations.find((u) => u.key === step.unitOp);
    if (!uo) continue;
    const lines: string[] = [];
    for (const item of uo.items) {
      if (item.collection !== "param") continue;
      const val = (name: string) => {
        const f = item.fields.find((x) => x.field === name);
        return f && f.status === "established" && f.display ? f.display : undefined;
      };
      const set = val("setPoint");
      const min = val("min");
      const max = val("max");
      if (set) lines.push(`${item.label}: ${set}`);
      else if (min && max) lines.push(`${item.label}: ${min} to ${max}`);
      else if (max) lines.push(`${item.label}: up to ${max}`);
      else if (min) lines.push(`${item.label}: at least ${min}`);
    }
    if (lines.length) out[step.id] = lines.slice(0, 6);
  }
  return out;
}
