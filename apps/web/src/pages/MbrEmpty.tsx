import { addSection, projectScopeSteps } from "@gap/engine";
import type { MbrRecord, SamplingPlan, TrdDocument } from "@gap/process-model";
import { countOf } from "../lib";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

/*
 * Ease-of-use pass (EOU-27): a record started from a technical requirements document or a sampling plan opened with "0 sections" and
 * "No sections yet. Add one below.", with no word on where the steps of a record come from. The record keeps its parameter values and
 * sample rows inside ready-made steps, and those sit in sections, one section for each step of the process. So the empty record says
 * where the steps come from (the document or plan it started from, or else the project's scope) and offers one button that adds the
 * sections for them. Nothing is added until the button is pressed, and the sections stay empty: which ready-made steps go in each one
 * is still the author's choice.
 */
export function EmptySections({ rec, trd, plan, run }: { rec: MbrRecord; trd: TrdDocument | undefined; plan: SamplingPlan | undefined; run: Run }) {
  const project = useStore((s) => s.project)!;
  const content = useContent();
  const source = trd
    ? { text: `the technical requirements document ${trd.id}`, steps: trd.steps.filter((s) => s.key).map((s) => ({ unitOp: s.key as string, title: s.label })) }
    : plan
      ? { text: `the sampling plan ${plan.id}`, steps: plan.steps.map((s) => ({ unitOp: s.unitOp, title: s.label })) }
      : { text: "this project's scope", steps: projectScopeSteps(content, project).map((s) => ({ unitOp: s.unitOp, title: s.label })) };
  // One section for a process step, even if a source lists the step twice.
  const seen = new Set<string>();
  const steps = source.steps.filter((s) => {
    const key = s.unitOp ?? `title:${s.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  function addAll() {
    const ok = run(
      (p, actor) => steps.reduce((acc, s) => addSection(acc, rec.id, { ...(s.unitOp ? { unitOp: s.unitOp } : {}), title: s.title }, actor).project, p),
      `${countOf(steps.length, "section")} added`,
    );
    // The button is gone once the sections exist: the cursor goes to the list of sections, not back to the top of the page.
    if (ok)
      setTimeout(() => {
        const el = document.getElementById("mbr-sections-h");
        el?.scrollIntoView({ block: "start" });
        el?.focus();
      }, 50);
  }

  return (
    <div className="stack small" data-testid="mbr-empty-sections">
      <p className="muted">
        No sections yet. A record is built from sections, one for each step of the process. The steps come from {source.text}.
      </p>
      {steps.length > 0 ? (
        <div>
          <button type="button" className="btn primary" onClick={addAll} data-testid="mbr-add-source-sections">
            Add {countOf(steps.length, "section")} from {source.text}
          </button>
          <p className="muted">The sections start empty. Then open each one and choose its ready-made steps.</p>
        </div>
      ) : (
        <p className="muted">{source.text.charAt(0).toUpperCase() + source.text.slice(1)} has no steps yet, so add a section below.</p>
      )}
    </div>
  );
}
