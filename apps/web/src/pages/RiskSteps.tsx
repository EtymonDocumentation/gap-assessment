import { addRiskStep, catalogInsertIndex, copyRiskStepsFromScope, moveRiskStep, projectScopeSteps, removeRiskStep, stepGroups } from "@gap/engine";
import type { RiskAssessment } from "@gap/process-model";
import { useState } from "react";
import { useContent, useStore } from "../store";
import type { Run } from "./SamplingFlow";

/*
 * The "Process steps" card of a risk assessment (same idea as the sampling plan's).
 *  - THE ASSESSMENT'S STEPS ARE ITS OWN: a one-time copy of the project scope, then independent. A risk assessment may cover only
 *    part of the process, or add a step the catalog lacks.
 *  - Removing a step never deletes an item: its items become "not placed on a step", and the change log lists which.
 *  - The order changes with buttons, not dragging, so a keyboard and a screen reader work.
 */
export function RiskSteps({ a, run }: { a: RiskAssessment; run: Run }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const groups = stepGroups(content, project);
  const [custom, setCustom] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState<"replace" | "append">("append");
  const [confirmCopy, setConfirmCopy] = useState(false);
  const chosen = new Map(a.steps.filter((s) => s.unitOp).map((s) => [s.unitOp!, s]));
  const scopeCount = projectScopeSteps(content, project).length;
  const itemsOn = (stepId: string) => a.items.filter((i) => i.stepId === stepId).length;
  const remove = (stepId: string) => {
    if (run((p, actor) => removeRiskStep(p, a.id, stepId, actor), "Process step removed")) setPendingRemove(null);
  };
  const askRemove = (stepId: string) => (itemsOn(stepId) ? setPendingRemove(stepId) : remove(stepId));
  const pending = a.steps.find((s) => s.id === pendingRemove);

  return (
    <details className="card" data-testid="risk-steps-card" open={a.steps.length === 0}>
      <summary>
        <strong>Process steps ({a.steps.length})</strong>
      </summary>
      <div className="stack">
        <p className="muted small">The steps this assessment looks at, in process order. They start as a copy of the project scope; changing them does not change the scope.</p>
        {a.steps.length === 0 ? (
          <p className="notice">No process steps yet. Tick catalog steps below, add a custom step, or copy the steps of the project scope. Items can also stay unplaced.</p>
        ) : (
          <ol className="step-list" data-testid="risk-step-list" aria-label="Steps in process order">
            {a.steps.map((s, i) => {
              const n = itemsOn(s.id);
              return (
                <li key={s.id} data-testid={`risk-step-${s.id}`}>
                  <span className="step-name">
                    <strong>{s.label}</strong>{" "}
                    <span className="muted small">
                      {s.unitOp ? "catalog step" : "custom step"}; {n} {n === 1 ? "item" : "items"}
                    </span>
                  </span>
                  <span className="row wrap">
                    <button type="button" className="btn small" disabled={i === 0} aria-label={`Move up: ${s.label}`} onClick={() => run((p, actor) => moveRiskStep(p, a.id, s.id, "up", actor), `${s.label} moved earlier`)}>
                      Move up
                    </button>
                    <button type="button" className="btn small" disabled={i === a.steps.length - 1} aria-label={`Move down: ${s.label}`} onClick={() => run((p, actor) => moveRiskStep(p, a.id, s.id, "down", actor), `${s.label} moved later`)}>
                      Move down
                    </button>
                    <button type="button" className="btn small danger" aria-label={`Remove: ${s.label}`} data-testid={`risk-step-remove-${s.id}`} onClick={() => askRemove(s.id)}>
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {pending && (
          <div className="notice" role="alertdialog" aria-label={`Remove ${pending.label}`} data-testid="risk-step-remove-confirm">
            <p>
              {pending.label} holds {itemsOn(pending.id)} items. Removing the step leaves them in the assessment as "Not placed on a step". No item is deleted.
            </p>
            <div className="row wrap">
              <button type="button" className="btn danger" autoFocus onClick={() => remove(pending.id)}>
                Remove the step
              </button>
              <button type="button" className="btn" onClick={() => setPendingRemove(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <details>
          <summary>Choose catalog steps</summary>
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
                          data-testid={`risk-step-check-${s.uo}`}
                          onChange={(e) => {
                            // A ticked catalog step goes in process order among the catalog steps already there.
                            if (e.target.checked) run((p, actor) => addRiskStep(p, a.id, { unitOp: s.uo, label: s.label }, actor, catalogInsertIndex(content, a.steps, s.uo)).project, `${s.label} added`);
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
            if (run((p, actor) => addRiskStep(p, a.id, { label: custom.trim() }, actor).project, "Custom step added")) setCustom("");
          }}
        >
          <label className="field grow">
            <span>Custom step (a step the catalog does not have)</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Intermediate hold (fictional)" data-testid="risk-step-custom-input" />
          </label>
          <button type="submit" className="btn" disabled={!custom.trim()} data-testid="risk-step-custom-add">
            Add custom step
          </button>
        </form>

        <div className="row wrap end-align">
          <label className="field">
            <span>Copy steps from the project scope ({scopeCount} in scope)</span>
            <select value={copyMode} onChange={(e) => setCopyMode(e.target.value as "replace" | "append")} data-testid="risk-steps-copy-mode">
              <option value="append">Add the missing steps at the end</option>
              <option value="replace">Replace this assessment's steps with the scope's</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            data-testid="risk-steps-copy"
            onClick={() => {
              if (copyMode === "replace" && a.steps.length > 0) setConfirmCopy(true);
              else run((p, actor) => copyRiskStepsFromScope(p, a.id, projectScopeSteps(content, p), copyMode, actor), "Steps copied from the project scope");
            }}
          >
            Copy steps
          </button>
        </div>
        {confirmCopy && (
          <div className="notice" role="alertdialog" aria-label="Replace the steps" data-testid="risk-steps-copy-confirm">
            <p>Replacing keeps the steps that are also in the scope, with their items. Items on other steps stay in the assessment as "Not placed on a step".</p>
            <div className="row wrap">
              <button
                type="button"
                className="btn danger"
                autoFocus
                onClick={() => {
                  setConfirmCopy(false);
                  run((p, actor) => copyRiskStepsFromScope(p, a.id, projectScopeSteps(content, p), "replace", actor), "Steps replaced from the project scope");
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
    </details>
  );
}
