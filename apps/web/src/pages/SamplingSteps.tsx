import { addStep, copyStepsFromScope, moveStep, projectScopeSteps, removeStep, stepGroups, updateStep } from "@gap/engine";
import type { SamplingPlan } from "@gap/process-model";
import { pointsOnStep } from "@gap/sampling";
import { useState } from "react";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

/*
 * The "Process steps" card of a sampling plan.
 *
 * Design notes (the why):
 *  - THE PLAN'S STEPS ARE ITS OWN. They are copied once from the project scope when a plan is created, and "Copy steps from the project
 *    scope" copies them again on request (replace or append). After that, editing the plan's steps never changes the gap Scope, and
 *    editing the Scope never changes the plan. A sampling plan can cover only part of the process, or add a step the catalog lacks.
 *  - The steps drive the diagram (one box per step, in this order) and the suggestions (only these steps are offered). The order is
 *    changed with buttons, not by dragging, so it works with a keyboard and a screen reader; the diagram announces nothing here.
 *  - Removing a step never deletes a sample. A step that holds samples asks first, in words, and moves them to "Not on the diagram".
 *  - A custom step is a label only (no catalog key). Its samples carry the unit operation "custom_step".
 */

export function ProcessStepsCard({ plan, run }: { plan: SamplingPlan; run: Run }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const groups = stepGroups(content, project);
  const [custom, setCustom] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState<"replace" | "append">("append");
  const [confirmCopy, setConfirmCopy] = useState(false);

  const chosen = new Map(plan.steps.filter((s) => s.unitOp).map((s) => [s.unitOp!, s]));
  const scopeCount = projectScopeSteps(content, project).length;
  const remove = (stepId: string, withPoints: boolean) => {
    if (run((p, actor) => removeStep(p, plan.id, stepId, actor, withPoints ? { movePointsToTray: true } : {}), "Process step removed")) setPendingRemove(null);
  };
  const askRemove = (stepId: string) => (pointsOnStep(plan, stepId).length ? setPendingRemove(stepId) : remove(stepId, false));
  const pending = plan.steps.find((s) => s.id === pendingRemove);

  return (
    <section className="card stack" aria-labelledby="sp-steps-h" id="sp-steps" data-testid="steps-card">
      <h2 id="sp-steps-h">Process steps ({plan.steps.length})</h2>
      <p className="muted small">
        The steps this plan samples from, in process order. Each becomes a box in the process flow below. These steps belong to this plan: they start as a copy of the project scope, and changing them does not change the scope.
      </p>

      {plan.steps.length === 0 ? (
        <p className="notice" data-testid="steps-empty">
          No process steps yet. Tick the steps below, add a custom step, or copy the steps of the project scope.
        </p>
      ) : (
        <ol className="step-list" data-testid="step-list" aria-label="Steps in process order">
          {plan.steps.map((s, i) => {
            const n = pointsOnStep(plan, s.id).length;
            return (
              <li key={s.id} data-testid={`step-${s.id}`}>
                <span className="step-name">
                  <strong>{s.label}</strong> <span className="muted small">{s.unitOp ? "catalog step" : "custom step"}; {n} {n === 1 ? "sample" : "samples"}</span>
                </span>
                <span className="row wrap">
                  <button type="button" className="btn small" disabled={i === 0} aria-label={`Move up: ${s.label}`} data-testid={`step-up-${s.id}`} onClick={() => run((p, actor) => moveStep(p, plan.id, s.id, "up", actor), `${s.label} moved earlier`)}>
                    Move up
                  </button>
                  <button type="button" className="btn small" disabled={i === plan.steps.length - 1} aria-label={`Move down: ${s.label}`} data-testid={`step-down-${s.id}`} onClick={() => run((p, actor) => moveStep(p, plan.id, s.id, "down", actor), `${s.label} moved later`)}>
                    Move down
                  </button>
                  <button type="button" className="btn small danger" aria-label={`Remove: ${s.label}`} data-testid={`step-remove-${s.id}`} onClick={() => askRemove(s.id)}>
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {pending && (
        <div className="notice" role="alertdialog" aria-label={`Remove ${pending.label}`} data-testid="step-remove-confirm">
          <p>
            {pending.label} holds {pointsOnStep(plan, pending.id).length} samples. Removing the step moves them to Not on the diagram. No sample is deleted.
          </p>
          <div className="row wrap">
            <button type="button" className="btn danger" autoFocus data-testid="step-remove-move" onClick={() => remove(pending.id, true)}>
              Move the samples and remove the step
            </button>
            <button type="button" className="btn" data-testid="step-remove-cancel" onClick={() => setPendingRemove(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <details>
        <summary data-testid="steps-choose">Choose catalog steps</summary>
        <div className="stack">
          {groups.map((g) => (
            <fieldset key={g.key} className="fs stack">
              <legend>{g.label}</legend>
              <div className="step-checks">
                {g.steps.map((s) => {
                  const present = chosen.get(s.uo);
                  return (
                    <label key={s.uo} className="check">
                      <input
                        type="checkbox"
                        checked={!!present}
                        data-testid={`step-check-${s.uo}`}
                        onChange={(e) => {
                          if (e.target.checked) run((p, actor) => addStep(p, plan.id, { unitOp: s.uo, label: s.label }, actor).project, `${s.label} added`);
                          else if (present) askRemove(present.id);
                        }}
                      />{" "}
                      <span>{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </details>

      <form
        className="row wrap end-align"
        onSubmit={(e) => {
          e.preventDefault();
          if (!custom.trim()) return;
          if (run((p, actor) => addStep(p, plan.id, { label: custom.trim() }, actor).project, "Custom step added")) setCustom("");
        }}
      >
        <label className="field grow">
          <span>Custom step (a step the catalog does not have)</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Intermediate hold (fictional)" data-testid="step-custom-input" />
        </label>
        <button type="submit" className="btn" disabled={!custom.trim()} data-testid="step-custom-add">
          Add custom step
        </button>
      </form>

      <div className="stack">
        <div className="row wrap end-align">
          <label className="field">
            <span>Copy steps from the project scope ({scopeCount} in scope)</span>
            <select value={copyMode} onChange={(e) => setCopyMode(e.target.value as "replace" | "append")} data-testid="steps-copy-mode">
              <option value="append">Add the missing steps at the end</option>
              <option value="replace">Replace this plan's steps with the scope's</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            data-testid="steps-copy"
            onClick={() => {
              if (copyMode === "replace" && plan.steps.length > 0) setConfirmCopy(true);
              else run((p, actor) => copyStepsFromScope(p, plan.id, projectScopeSteps(content, p), copyMode, actor), "Steps copied from the project scope");
            }}
          >
            Copy steps
          </button>
        </div>
        {confirmCopy && (
          <div className="notice" role="alertdialog" aria-label="Replace the steps" data-testid="steps-copy-confirm">
            <p>Replacing keeps the steps that are also in the scope, with their samples. Steps that are not in the scope are removed and their samples move to Not on the diagram.</p>
            <div className="row wrap">
              <button
                type="button"
                className="btn danger"
                autoFocus
                data-testid="steps-copy-confirm-yes"
                onClick={() => {
                  setConfirmCopy(false);
                  run((p, actor) => copyStepsFromScope(p, plan.id, projectScopeSteps(content, p), "replace", actor), "Steps replaced from the project scope");
                }}
              >
                Replace the steps
              </button>
              <button type="button" className="btn" onClick={() => setConfirmCopy(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {plan.steps.some((s) => s.notes !== undefined) && <RenameNote plan={plan} run={run} />}
    </section>
  );
}

/** Steps that carry a note show it for editing. Kept small: a note is optional text, never required. */
function RenameNote({ plan, run }: { plan: SamplingPlan; run: Run }) {
  return (
    <ul className="plain-list small">
      {plan.steps
        .filter((s) => s.notes !== undefined)
        .map((s) => (
          <li key={s.id}>
            <label className="field">
              <span>Note for {s.label}</span>
              <input
                defaultValue={s.notes}
                onBlur={(e) => {
                  if (e.target.value !== s.notes) run((p, actor) => updateStep(p, plan.id, s.id, { notes: e.target.value }, actor), "Step note saved");
                }}
              />
            </label>
          </li>
        ))}
    </ul>
  );
}
