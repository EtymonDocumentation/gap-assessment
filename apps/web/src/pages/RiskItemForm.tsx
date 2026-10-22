import { gapSeeds, pointRef, removeItem, samplingPointExists, updateItem } from "@gap/engine";
import type { RiskAssessment, RiskItem } from "@gap/process-model";
import { useMemo, useState } from "react";
import { useSamplingAllowed } from "../risk-module";
import { useContent, useStore } from "../store";
import { blankScore, formIsEmpty, formToScore, ScoreInputs, scoreToForm } from "./RiskScore";
import type { Run } from "./SamplingFlow";

/** Text for a sampling point in a list: id, what is sampled, and the step. */
export function pointText(ref: string, attribute: string): string {
  return `${ref}: ${attribute || "attribute not described"}`;
}

/** Every sampling point of the project with its qualified id, for the link list. */
export function useProjectPoints() {
  const project = useStore((s) => s.project)!;
  return useMemo(() => project.sampling.plans.flatMap((pl) => pl.points.map((pt) => ({ ref: pointRef(pl.id, pt.id), planTitle: pl.title, attribute: pt.attribute, unitOp: pt.unitOp }))), [project.sampling.plans]);
}

/**
 * The full form of one item: description, the scores the method asks for, optional residual, links, notes. It is shown inline under
 * the item (by-step view) or in a dialog (table view). Scores are entered from the method's own values; nothing is pre-selected.
 */
export function RiskItemForm({ a, item, run, onDone, onCancel }: { a: RiskAssessment; item: RiskItem; run: Run; onDone: () => void; onCancel: () => void }) {
  const content = useContent();
  const project = useStore((s) => s.project)!;
  const samplingAllowed = useSamplingAllowed();
  const points = useProjectPoints();
  const [stepId, setStepId] = useState(item.stepId ?? "");
  const [failureMode, setFailureMode] = useState(item.failureMode);
  const [effect, setEffect] = useState(item.effect ?? "");
  const [causes, setCauses] = useState(item.causes ?? "");
  const [prevention, setPrevention] = useState(item.controlsPrevention ?? "");
  const [detection, setDetection] = useState(item.controlsDetection ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [initial, setInitial] = useState(() => scoreToForm(item.initial));
  const [wantResidual, setWantResidual] = useState(!!item.residual);
  const [residual, setResidual] = useState(() => (item.residual ? scoreToForm(item.residual) : blankScore()));
  const [links, setLinks] = useState<string[]>(item.samplingPointIds);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seeds = useMemo(() => gapSeeds(content, project, a), [content, project, a]);

  function save() {
    const ok = run(
      (p, actor) =>
        updateItem(
          p,
          a.id,
          item.id,
          {
            stepId: stepId || undefined,
            failureMode,
            effect,
            causes,
            controlsPrevention: prevention,
            controlsDetection: detection,
            notes,
            initial: formToScore(initial),
            residual: wantResidual && !formIsEmpty(residual) ? formToScore(residual) : undefined,
            samplingPointIds: links,
          },
          actor,
        ),
      `${item.id} saved`,
    );
    if (ok) onDone();
  }

  const linkedGaps = item.gapIds.map((g) => seeds.find((s) => s.gapId === g) ?? { gapId: g, attribute: "(gap no longer in the assessment)", severity: "" });

  return (
    <form
      className="stack"
      data-testid={`risk-item-form-${item.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="field">
        <span>Process step</span>
        <select value={stepId} onChange={(e) => setStepId(e.target.value)} data-testid="item-step">
          <option value="">Not placed on a step</option>
          {a.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Failure mode (what can go wrong)</span>
        <input value={failureMode} onChange={(e) => setFailureMode(e.target.value)} data-testid="item-failure-mode" />
      </label>
      <label className="field">
        <span>Effect</span>
        <textarea rows={2} value={effect} onChange={(e) => setEffect(e.target.value)} data-testid="item-effect" />
      </label>
      <label className="field">
        <span>Causes</span>
        <textarea rows={2} value={causes} onChange={(e) => setCauses(e.target.value)} />
      </label>
      <label className="field">
        <span>Current controls: prevention</span>
        <textarea rows={2} value={prevention} onChange={(e) => setPrevention(e.target.value)} />
      </label>
      <label className="field">
        <span>Current controls: detection</span>
        <textarea rows={2} value={detection} onChange={(e) => setDetection(e.target.value)} />
      </label>

      <fieldset className="fs stack">
        <legend>Score</legend>
        {a.config ? (
          <ScoreInputs config={a.config} form={initial} onChange={setInitial} which="initial" />
        ) : (
          <p className="notice">Choose a method on step 1 to score this item. Until then it stays "Not scored".</p>
        )}
        {a.config && (
          <>
            <label className="check">
              <input type="checkbox" checked={wantResidual} onChange={(e) => setWantResidual(e.target.checked)} data-testid="item-residual-on" /> <span>Add a residual score (after the actions; optional)</span>
            </label>
            {wantResidual && <ScoreInputs config={a.config} form={residual} onChange={setResidual} which="residual" />}
          </>
        )}
      </fieldset>

      {linkedGaps.length > 0 && (
        <div data-testid="item-gaps">
          <p className="small">
            <strong>Linked gaps</strong> (the gap severity is shown for reference only; it is never copied into the score)
          </p>
          <ul className="plain-list small">
            {linkedGaps.map((g) => (
              <li key={g.gapId}>
                {g.gapId}: {g.attribute}
                {g.severity ? ` - gap severity (reference only): ${g.severity}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {samplingAllowed && points.length > 0 && (
        <fieldset className="fs stack" data-testid="item-points">
          <legend>Linked sampling points</legend>
          <p className="muted small">Sampling points that detect or control this failure mode.</p>
          <div className="step-checks">
            {points.map((p) => (
              <label key={p.ref} className="check">
                <input type="checkbox" checked={links.includes(p.ref)} data-testid={`item-link-${p.ref}`} onChange={(e) => setLinks(e.target.checked ? [...links, p.ref] : links.filter((x) => x !== p.ref))} /> <span>{pointText(p.ref, p.attribute)}</span>
              </label>
            ))}
            {links
              .filter((l) => !samplingPointExists(project, l))
              .map((l) => (
                <label key={l} className="check">
                  <input type="checkbox" checked onChange={() => setLinks(links.filter((x) => x !== l))} /> <span>{l} (this sampling point no longer exists)</span>
                </label>
              ))}
          </div>
        </fieldset>
      )}

      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="row wrap">
        <button type="submit" className="btn primary" data-testid="item-save">
          Save {item.id}
        </button>
        <button type="button" className="btn" onClick={onCancel} data-testid="item-cancel">
          Cancel
        </button>
        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)} data-testid="item-delete">
          Delete item
        </button>
      </div>
      {confirmDelete && (
        <div className="notice" role="alertdialog" aria-label={`Delete ${item.id}`} data-testid="item-delete-confirm">
          <p>
            Delete {item.id}
            {a.actions.some((x) => x.itemId === item.id) ? " and its actions" : ""}? The change log keeps what it said.
          </p>
          <div className="row wrap">
            <button
              type="button"
              className="btn danger"
              autoFocus
              data-testid="item-delete-yes"
              onClick={() => {
                if (run((p, actor) => removeItem(p, a.id, item.id, actor), `${item.id} deleted`)) onDone();
                else setConfirmDelete(false);
              }}
            >
              Delete {item.id}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
