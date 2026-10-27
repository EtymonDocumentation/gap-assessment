import { addReview, removeReview, updateAssessment, usesTr44 } from "@gap/engine";
import { RISK_REVIEW_TRIGGERS, RISK_REVIEW_TRIGGER_LABEL, type RiskAssessment, type RiskReviewTrigger } from "@gap/process-model";
import { TR44_THRESHOLD_HINT } from "@gap/risk";
import { useState } from "react";
import type { Run } from "./SamplingFlow";

/*
 * Optional part of the Method step: the action threshold (PDA TR 44 layout only), the review triggers and the review history.
 *
 * Design notes (the why):
 *  - NOTHING IS PRESET. The threshold box is empty, no trigger is ticked and the next-review date is empty. The hint beside the
 *    threshold gives one worked example from the report as text; it is never put in the box.
 *  - A RISK ASSESSMENT IS A LIVING DOCUMENT (PDA TR 44 s3.3, PDA TR 65 s5.1). The triggers say when to look again; the history keeps
 *    one line per review, so a reader can see when the assessment was last looked at and why.
 */
export function RiskReview({ a, run }: { a: RiskAssessment; run: Run }) {
  const tr44 = usesTr44(a);
  const [threshold, setThreshold] = useState(a.actionThreshold !== undefined ? String(a.actionThreshold) : "");
  const [triggers, setTriggers] = useState<RiskReviewTrigger[]>(a.reviewTriggers ?? []);
  const [next, setNext] = useState(a.nextReview ?? "");
  const [rvDate, setRvDate] = useState("");
  const [rvTrigger, setRvTrigger] = useState<"" | RiskReviewTrigger>("");
  const [rvNote, setRvNote] = useState("");
  const [rvBy, setRvBy] = useState("");

  const thresholdValue = threshold.trim() === "" ? undefined : Number(threshold);
  const thresholdBad = thresholdValue !== undefined && !(Number.isFinite(thresholdValue) && thresholdValue > 0);
  const dirty =
    (tr44 && thresholdValue !== a.actionThreshold) || JSON.stringify([...triggers].sort()) !== JSON.stringify([...(a.reviewTriggers ?? [])].sort()) || next.trim() !== (a.nextReview ?? "");

  return (
    <section className="card stack" aria-labelledby="ra-review" data-testid="risk-review">
      <h2 id="ra-review">Review, and the action threshold</h2>
      <p className="muted small">Optional. A risk assessment is a living document: say what makes you look at it again, and record each review.</p>

      {tr44 && (
        <label className="field">
          <span>Action threshold: risk priority above which actions are required</span>
          <input
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            aria-describedby="ra-threshold-hint"
            data-testid="risk-threshold"
          />
          <span id="ra-threshold-hint" className="muted small">
            {TR44_THRESHOLD_HINT}
          </span>
        </label>
      )}

      <fieldset className="fs stack" data-testid="risk-triggers">
        <legend>Review triggers (tick the ones your quality system uses)</legend>
        <div className="step-checks">
          {RISK_REVIEW_TRIGGERS.map((t) => (
            <label key={t} className="check">
              <input type="checkbox" checked={triggers.includes(t)} data-testid={`risk-trigger-${t}`} onChange={(e) => setTriggers(e.target.checked ? [...triggers, t] : triggers.filter((x) => x !== t))} /> <span>{RISK_REVIEW_TRIGGER_LABEL[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Next periodic review (date)</span>
        <input type="date" value={next} onChange={(e) => setNext(e.target.value)} data-testid="risk-next-review" />
      </label>
      {thresholdBad && (
        <p className="error" role="alert">
          The action threshold must be a number above zero, or left blank.
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn primary"
          disabled={!dirty || thresholdBad}
          data-testid="risk-review-save"
          onClick={() =>
            run(
              (p, who) =>
                updateAssessment(
                  p,
                  a.id,
                  { ...(tr44 ? { actionThreshold: thresholdValue } : {}), reviewTriggers: triggers, nextReview: next },
                  who,
                ),
              "Review settings saved",
            )
          }
        >
          Save review settings
        </button>
      </div>

      <h3>Review history ({a.reviews?.length ?? 0})</h3>
      {a.reviews?.length ? (
        <ul className="plain-list small" data-testid="risk-review-history">
          {a.reviews.map((r) => (
            <li key={r.id} className="row wrap">
              <span>
                <strong>{r.id}</strong>, {r.date}
                {r.trigger ? `, ${RISK_REVIEW_TRIGGER_LABEL[r.trigger]}` : ""}: {r.note}
                {r.by ? ` (${r.by})` : ""}
              </span>
              <button type="button" className="btn small" aria-label={`Remove review ${r.id}`} data-testid={`risk-review-remove-${r.id}`} onClick={() => run((p, who) => removeReview(p, a.id, r.id, who), `${r.id} removed`)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No review recorded yet.</p>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const ok = run((p, who) => addReview(p, a.id, { date: rvDate, note: rvNote, ...(rvTrigger ? { trigger: rvTrigger } : {}), ...(rvBy ? { by: rvBy } : {}) }, who).project, "Review recorded");
          if (ok) {
            setRvDate("");
            setRvTrigger("");
            setRvNote("");
            setRvBy("");
          }
        }}
      >
        <div className="row wrap end-align">
          <label className="field">
            <span>Date of the review</span>
            <input type="date" value={rvDate} onChange={(e) => setRvDate(e.target.value)} data-testid="risk-review-date" />
          </label>
          <label className="field">
            <span>Reason</span>
            <select value={rvTrigger} onChange={(e) => setRvTrigger(e.target.value as "" | RiskReviewTrigger)} data-testid="risk-review-trigger">
              <option value="">Not given</option>
              {RISK_REVIEW_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {RISK_REVIEW_TRIGGER_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reviewed by (optional)</span>
            <input value={rvBy} onChange={(e) => setRvBy(e.target.value)} data-testid="risk-review-by" />
          </label>
        </div>
        <label className="field">
          <span>What was looked at and what changed</span>
          <textarea rows={2} value={rvNote} onChange={(e) => setRvNote(e.target.value)} data-testid="risk-review-note" />
        </label>
        <div>
          <button type="submit" className="btn" data-testid="risk-review-add">
            Record this review
          </button>
        </div>
      </form>
    </section>
  );
}
