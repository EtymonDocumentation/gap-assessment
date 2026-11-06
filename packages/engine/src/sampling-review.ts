import type { Project, SamplingPlan } from "@gap/process-model";
import { designReviewView, type DesignReviewView, type ReviewContext } from "@gap/sampling";
import type { ContentBundle } from "./content";
import { projectStage } from "./stage";
import { projectScopeSteps } from "./sampling";
import type { SamplingSuggestions } from "./sampling-seed";

/** The catalog entries marked `expected` (a typical fill/finish PPQ covers them), in the shape the review reads. Shared with the Process view's Coverage group. */
export function expectedStudies(suggestions?: SamplingSuggestions) {
  return (suggestions?.candidates ?? []).filter((c) => c.expected).map((c) => ({ key: c.key, uo: c.uo, type: c.type, attribute: c.attribute }));
}

/**
 * The project facts the sampling design review reads besides the plan itself (see review.ts in @gap/sampling): the TRD steps, the
 * Scope's included unit operations, the failure modes of the risk assessments and the catalog entries marked `expected`. Each part is
 * left out when the project has none of it, and a check that needs it then stays silent: nothing is guessed.
 */
export function reviewContext(content: ContentBundle, project: Project, suggestions?: SamplingSuggestions): ReviewContext {
  const trd = project.trd.documents.find((d) => d.steps.length > 0);
  const scope = projectScopeSteps(content, project);
  const riskItems = project.risk.assessments.flatMap((a) =>
    a.items.flatMap((it) => {
      const step = it.stepId ? a.steps.find((s) => s.id === it.stepId) : undefined;
      return step ? [{ id: `${a.id}/${it.id}`, failureMode: it.failureMode, ...(step.unitOp ? { unitOp: step.unitOp } : {}), label: step.label, pointIds: it.samplingPointIds }] : [];
    }),
  );
  const expected = expectedStudies(suggestions);
  return {
    ...(trd ? { trdSteps: trd.steps.map((s) => ({ ...(s.key ? { unitOp: s.key } : {}), label: s.label })) } : {}),
    ...(scope.length ? { scopeSteps: scope.map((s) => ({ ...(s.unitOp ? { unitOp: s.unitOp } : {}), label: s.label })) } : {}),
    ...(riskItems.length ? { riskItems } : {}),
    ...(expected.length ? { expected } : {}),
    ...(projectStage(project) ? { stage: projectStage(project)! } : {}),
  };
}

/** The plan's design review with the project's facts and the team's stored answers. */
export function planDesignReview(content: ContentBundle, project: Project, plan: SamplingPlan, suggestions?: SamplingSuggestions): DesignReviewView {
  return designReviewView(plan, reviewContext(content, project, suggestions));
}
