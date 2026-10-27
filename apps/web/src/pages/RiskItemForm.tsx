import { evaluateItem, gapSeeds, linkedConfidence, pointRef, removeItem, samplingPointExists, thresholdReading, updateItem, usesTr44 } from "@gap/engine";
import { RISK_INTERVENTION_FACTORS, type RiskAccepted, type RiskAssessment, type RiskIntervention, type RiskItem, type RiskLmh } from "@gap/process-model";
import { INTERVENTION_LABEL, INTERVENTION_SIMULATION_HINT, interventionTally, LMH_LABEL, severityConfidenceText, TR44_GUIDANCE } from "@gap/risk";
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
  const tr44 = usesTr44(a);
  const [accepted, setAccepted] = useState<"" | RiskAccepted>(item.accepted ?? "");
  const [wantIv, setWantIv] = useState(!!item.intervention);
  const [iv, setIv] = useState<RiskIntervention>(item.intervention ?? {});
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
            // Only the PDA TR 44 layout has these two answers; blank stays blank (no default).
            ...(tr44 ? { accepted: accepted || undefined, intervention: wantIv ? iv : undefined } : {}),
          },
          actor,
        ),
      `${item.id} saved`,
    );
    if (ok) onDone();
  }

  // Live reading of the typed scores against the team's threshold. Nothing is stored until Save.
  const live = tr44 && a.config ? thresholdReading(a, evaluateItem(a, { ...item, initial: formToScore(initial), residual: wantResidual && !formIsEmpty(residual) ? formToScore(residual) : undefined })) : undefined;
  const flag = (above: boolean | undefined, t: number | undefined) => (above === undefined ? (t === undefined ? "No action threshold entered yet" : "Not compared") : above ? `⚑ Above the action threshold (${t})` : `Not above the action threshold (${t})`);
  const confidences = tr44 ? linkedConfidence(project, item) : [];
  const tally = interventionTally(iv);

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
        {tr44 && (
          <ul className="muted small" data-testid="item-tr44-guidance">
            {TR44_GUIDANCE.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
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

      {tr44 && live && (
        <div className="notice" data-testid="item-priority">
          <p>
            <strong>Risk priority (S x O x D):</strong> {live.priority ?? "Not scored"}
            {live.priority !== undefined ? `. ${flag(live.above, live.threshold)}.` : ""}
          </p>
          {live.residualPriority !== undefined && (
            <p>
              <strong>After actions:</strong> {live.residualPriority}. {flag(live.residualAbove, live.threshold)}.
            </p>
          )}
        </div>
      )}
      {tr44 && (
        <label className="field">
          <span>Risk accepted? (the team's decision; the tool does not answer it)</span>
          <select value={accepted} onChange={(e) => setAccepted(e.target.value as "" | RiskAccepted)} data-testid="item-accepted">
            <option value="">Not answered</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      )}
      {tr44 && (
        <fieldset className="fs stack" data-testid="item-intervention">
          <legend>Intervention scoring (optional, for aseptic interventions)</legend>
          <label className="check">
            <input type="checkbox" checked={wantIv} onChange={(e) => setWantIv(e.target.checked)} data-testid="item-intervention-on" /> <span>Score this row as an intervention (PDA TR 22 Example 3)</span>
          </label>
          {wantIv && (
            <>
              <div className="row wrap">
                {RISK_INTERVENTION_FACTORS.map((k) => (
                  <label key={k} className="field">
                    <span>{INTERVENTION_LABEL[k]}</span>
                    <select value={iv[k] ?? ""} onChange={(e) => setIv({ ...iv, [k]: e.target.value || undefined })} data-testid={`item-iv-${k}`}>
                      <option value="">Not rated</option>
                      {(["low", "medium", "high"] as RiskLmh[]).map((l) => (
                        <option key={l} value={l}>
                          {LMH_LABEL[l]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="muted small" data-testid="item-iv-tally">
                Answers so far: {tally.high} high, {tally.medium} medium, {tally.low} low
                {tally.missing.length ? `; not rated: ${tally.missing.join(", ")}` : ""}. The tool counts but does not choose the overall level.
              </p>
              <label className="field">
                <span>Overall level (your choice)</span>
                <select value={iv.level ?? ""} onChange={(e) => setIv({ ...iv, level: (e.target.value || undefined) as RiskLmh | undefined })} data-testid="item-iv-level">
                  <option value="">Not chosen</option>
                  {(["low", "medium", "high"] as RiskLmh[]).map((l) => (
                    <option key={l} value={l}>
                      {LMH_LABEL[l]}
                    </option>
                  ))}
                </select>
              </label>
              {iv.level && <p className="muted small" data-testid="item-iv-hint">{INTERVENTION_SIMULATION_HINT[iv.level]} A hint for the media fill plan, not a decision.</p>}
            </>
          )}
        </fieldset>
      )}

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
          {tr44 && (
            <p className="muted small" data-testid="item-confidence-hint">
              {severityConfidenceText()}
              {confidences.length ? ` Entered on the linked points: ${confidences.map((c) => `${c.ref} ${c.confidencePercent !== undefined ? c.confidencePercent + " %" : "not entered"}`).join("; ")}.` : ""}
            </p>
          )}
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
